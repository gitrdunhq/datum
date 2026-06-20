import argparse
import json
import os
import sys
import urllib.request
from typing import Any, cast

from datum_ax.observability import configure_logging, get_logger
from datum_ax.presentation.composition import build_status_source

logger = get_logger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="datum-ax CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Run command
    run_parser = subparsers.add_parser("run", help="Start the orchestration DAG.")
    run_parser.add_argument("--ticket", required=True, help="Ticket or file path to run.")
    run_parser.add_argument("--debug", action="store_true", help="Enable debug logging.")

    # Status command
    subparsers.add_parser("status", help="Get LiveStatus JSON of the current pipeline.")

    # Doctor command
    subparsers.add_parser("doctor", help="Check environment health.")

    return parser


def run_cli(args_list: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(args_list)

    if args.command == "status":
        status = build_status_source().get_status()
        print(status.model_dump_json())
    elif args.command == "run":
        os.makedirs(".datum", exist_ok=True)
        # Always trace to the run logfile; stream to the console only with --debug (ADR-0013).
        configure_logging(
            level="DEBUG",
            logfile=".datum/datumax.log",
            console=getattr(args, "debug", False),
        )

        logger.info("run_started", ticket=args.ticket)

        base_url = (
            os.environ.get("OMLX_BASE_URL")
            or os.environ.get("OPENAI_BASE_URL")
            or os.environ.get("OPENAI_API_BASE")
        )
        api_key = os.environ.get("OMLX_API_KEY") or os.environ.get("OPENAI_API_KEY")

        if not base_url or not api_key:
            sys.stderr.write(
                "Missing required environment variables: (OMLX_BASE_URL or OPENAI_BASE_URL or OPENAI_API_BASE) and (OMLX_API_KEY or OPENAI_API_KEY)\n"
            )
            sys.exit(1)

        if api_key and not api_key.startswith("omlx-"):
            print(
                "Warning: API key does not start with 'omlx-'. Ensure you are connecting to an oMLX endpoint."
            )

        workspace_dir = os.path.dirname(os.path.abspath(args.ticket)) or "."
        print(f"Starting run for ticket: {args.ticket} in workspace: {workspace_dir}")

        # Heavy deps imported lazily so `status`/`doctor` stay fast (no langgraph/transport load).
        from datum_ax.data.inference.client import OmlxInferenceClient
        from datum_ax.data.inference.roles import ModelRoleRegistry, RoleConfig
        from datum_ax.contracts.inference import ModelRole
        from datum_ax.core.orchestration.graph import build_graph

        model_id = os.environ.get("OMLX_MODEL") or os.environ.get("OPENAI_MODEL")
        if not model_id:
            models_url = (
                f"{base_url.rstrip('/')}/models"
                if base_url.rstrip("/").endswith("/v1")
                else f"{base_url.rstrip('/')}/v1/models"
            )
            try:
                req = urllib.request.Request(
                    models_url, headers={"Authorization": f"Bearer {api_key}"}
                )
                with urllib.request.urlopen(req, timeout=3) as response:
                    data = json.loads(response.read().decode())
                    available_models = [m["id"] for m in data.get("data", [])]
            except Exception as e:
                sys.stderr.write(f"Warning: Failed to fetch models from {models_url}: {e}\n")
                available_models = []

            if not available_models:
                sys.stderr.write("Falling back to default model: gpt-4\n")
                model_id = "gpt-4"
            elif len(available_models) == 1 or not sys.stdin.isatty():
                model_id = available_models[0]
                sys.stderr.write(f"Auto-selected model: {model_id}\n")
            else:
                sys.stderr.write("\nAvailable models:\n")
                for i, m in enumerate(available_models):
                    sys.stderr.write(f"  {i + 1}) {m}\n")
                while True:
                    try:
                        choice = input(f"\nSelect a model [1-{len(available_models)}]: ")
                        idx = int(choice) - 1
                        if 0 <= idx < len(available_models):
                            model_id = available_models[idx]
                            break
                        sys.stderr.write("Invalid selection.\n")
                    except (ValueError, EOFError):
                        sys.stderr.write("Invalid selection.\n")
                    except KeyboardInterrupt:
                        sys.exit(1)

        use_native_mlx = os.environ.get("DATUM_NATIVE_MLX") == "1"
        if use_native_mlx:
            from datum_ax.data.inference.transport_mlx import NativeMlxTransport

            transport = NativeMlxTransport()
        else:
            from datum_ax.data.inference.transport_httpx import HttpxTransport

            transport = HttpxTransport(base_url=base_url, api_key=api_key)
        registry = ModelRoleRegistry(
            configs=(
                RoleConfig(
                    role=ModelRole.TRIAGE,
                    model_id=model_id,
                    temperature=0.0,
                    response_format={"type": "json_object"},
                ),
                RoleConfig(
                    role=ModelRole.PLANNER,
                    model_id=model_id,
                    temperature=0.1,
                    response_format={"type": "json_object"},
                ),
                RoleConfig(
                    role=ModelRole.EXECUTOR,
                    model_id=model_id,
                    temperature=0.2,
                    response_format={"type": "json_object"},
                ),
                RoleConfig(role=ModelRole.ADVERSARIAL, model_id=model_id, temperature=0.5),
            )
        )
        client = OmlxInferenceClient(transport=transport, registry=registry)

        from datum_ax.data.execution.local import LocalHost

        host = LocalHost(workspace_dir=workspace_dir)

        from datum_ax.presentation.composition import build_context_crane

        crane = build_context_crane()

        graph = build_graph()
        initial_state: dict[str, Any] = {
            "ticket": {"text": args.ticket, "scale": "task"},
            "workspace_dir": workspace_dir,
            "current_wave": 0,
            "results": {},
            "visited_nodes": [],
        }

        # Read the ticket file if it exists
        if os.path.exists(args.ticket):
            with open(args.ticket, "r") as f:
                ticket_info = initial_state["ticket"]
                assert isinstance(ticket_info, dict)
                ticket_info["text"] = f.read()

        from langchain_core.runnables.config import RunnableConfig

        config = cast(
            RunnableConfig,
            {
                "configurable": {
                    "inference_client": client,
                    "execution_host": host,
                    "context_crane": crane,
                }
            },
        )
        for event in graph.stream(initial_state, config=config):
            for node_name, node_state in event.items():
                print(f"\n[✔] Finished: {node_name}")  # user-facing CLI progress
                logger.info("node_finished", node=node_name)
                if "results" in node_state and node_state["results"]:
                    out = json.dumps(node_state["results"], indent=2)
                    # print the last added result for visibility
                    print(out)
                    logger.info("node_results", node=node_name, results=node_state["results"])
    elif args.command == "doctor":
        print("Doctor: Environment appears healthy.")


if __name__ == "__main__":
    run_cli(sys.argv[1:])
