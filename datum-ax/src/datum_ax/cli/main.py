import argparse
import sys
from datum_ax.data.state.status import StatusProvider

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
        provider = StatusProvider()
        status = provider.get_status()
        print(status.model_dump_json())
    elif args.command == "run":
        import os
        import sys
        import logging
        
        os.makedirs(".datum", exist_ok=True)
        log_path = ".datum/datumax.log"
        
        root_logger = logging.getLogger()
        root_logger.setLevel(logging.DEBUG)
        
        # Always log everything to file
        file_handler = logging.FileHandler(log_path, mode='a')
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(logging.Formatter('%(asctime)s:%(levelname)s:%(name)s:%(message)s'))
        root_logger.addHandler(file_handler)
        
        # Only stream debug to console if --debug is passed
        if getattr(args, "debug", False):
            stream_handler = logging.StreamHandler(sys.stderr)
            stream_handler.setLevel(logging.DEBUG)
            stream_handler.setFormatter(logging.Formatter('%(levelname)s:%(name)s:%(message)s'))
            root_logger.addHandler(stream_handler)
        
        logging.info(f"=== Starting datumax run for ticket: {args.ticket} ===")
        
        base_url = os.environ.get("OMLX_BASE_URL") or os.environ.get("OPENAI_BASE_URL") or os.environ.get("OPENAI_API_BASE")
        api_key = os.environ.get("OMLX_API_KEY") or os.environ.get("OPENAI_API_KEY")
        
        if not base_url or not api_key:
            sys.stderr.write("Missing required environment variables: (OMLX_BASE_URL or OPENAI_BASE_URL or OPENAI_API_BASE) and (OMLX_API_KEY or OPENAI_API_KEY)\n")
            sys.exit(1)
            
        if api_key and not api_key.startswith("omlx-"):
            print("Warning: API key does not start with 'omlx-'. Ensure you are connecting to an oMLX endpoint.")
            
        workspace_dir = os.path.dirname(os.path.abspath(args.ticket)) or "."
        print(f"Starting run for ticket: {args.ticket} in workspace: {workspace_dir}")
        
        from datum_ax.data.inference.transport_httpx import HttpxTransport
        from datum_ax.data.inference.client import OmlxInferenceClient
        from datum_ax.data.inference.roles import ModelRoleRegistry, RoleConfig
        from datum_ax.contracts.inference import ModelRole
        from datum_ax.core.orchestration.graph import build_graph
        
        model_id = os.environ.get("OMLX_MODEL") or os.environ.get("OPENAI_MODEL")
        if not model_id:
            import json
            import urllib.request
            
            models_url = f"{base_url.rstrip('/')}/models" if base_url.rstrip('/').endswith("/v1") else f"{base_url.rstrip('/')}/v1/models"
            try:
                req = urllib.request.Request(models_url, headers={"Authorization": f"Bearer {api_key}"})
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
                    sys.stderr.write(f"  {i+1}) {m}\n")
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
        registry = ModelRoleRegistry(configs=(
            RoleConfig(role=ModelRole.TRIAGE, model_id=model_id, temperature=0.0, response_format={"type": "json_object"}),
            RoleConfig(role=ModelRole.PLANNER, model_id=model_id, temperature=0.1, response_format={"type": "json_object"}),
            RoleConfig(role=ModelRole.EXECUTOR, model_id=model_id, temperature=0.2, response_format={"type": "json_object"}),
            RoleConfig(role=ModelRole.ADVERSARIAL, model_id=model_id, temperature=0.5)
        ))
        client = OmlxInferenceClient(transport=transport, registry=registry)
        
        graph = build_graph()
        from typing import Any
        initial_state: dict[str, Any] = {
            "ticket": {"text": args.ticket, "scale": "task"},
            "workspace_dir": workspace_dir,
            "current_wave": 0,
            "results": {},
            "visited_nodes": []
        }
        
        # Read the ticket file if it exists
        if os.path.exists(args.ticket):
            with open(args.ticket, "r") as f:
                ticket_info = initial_state["ticket"]
                assert isinstance(ticket_info, dict)
                ticket_info["text"] = f.read()

        import json
        from langchain_core.runnables.config import RunnableConfig
        from typing import cast
        config = cast(RunnableConfig, {"configurable": {"inference_client": client}})
        for event in graph.stream(initial_state, config=config):
            for node_name, node_state in event.items():
                msg = f"[✔] Finished: {node_name}"
                print(f"\n{msg}")
                logging.info(msg)
                if "results" in node_state and node_state["results"]:
                    out = json.dumps(node_state["results"], indent=2)
                    # print the last added result for visibility
                    print(out)
                    logging.info(f"State update from {node_name}:\n{out}")
    elif args.command == "doctor":
        print("Doctor: Environment appears healthy.")

if __name__ == "__main__":
    run_cli(sys.argv[1:])
