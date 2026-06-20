"""Composition root (presentation tier) — wire concrete ``data`` adapters into the core graph.

Presentation is the only tier allowed to import both ``core`` and ``data`` (ADR-0026). The core graph
depends on the ``contracts`` Protocols and receives concrete adapters via ``config['configurable']``.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from typing import Any, cast

from datum_ax.contracts.checkpoint import CheckpointStore
from datum_ax.contracts.context_assembler import ContextAssembler
from datum_ax.contracts.execution import ExecutionHost
from datum_ax.contracts.inference import InferenceClient, ModelRole, TokenBudget
from datum_ax.contracts.ledger import RunLedger
from datum_ax.contracts.persona import PersonaRegistry
from datum_ax.contracts.projection import IssueProjector
from datum_ax.contracts.review import ReviewGate
from datum_ax.contracts.rules import RuleBinder, RuleRegistry
from datum_ax.contracts.status import StatusSource
from datum_ax.contracts.tokens import TokenCounter, default_token_count
from datum_ax.data.persona import PERSONA_REGISTRIES
from datum_ax.data.projection import ISSUE_PROJECTORS
from datum_ax.data.review import REVIEW_GATES
from datum_ax.data.rules import RULE_REGISTRIES
from datum_ax.data.state.checkpoint import InMemoryCheckpointer
from datum_ax.data.state.ledger import LibSQLLedger
from datum_ax.data.state.status import StatusProvider
from datum_ax.core.orchestration.assemblers import CONTEXT_ASSEMBLERS
from datum_ax.data.context.adapters import (
    Context7DocContext,
    HeadroomNlCompressor,
    SerenaTokenSaveContext,
)
from datum_ax.data.context.dcp import DynamicContextPruner
from datum_ax.data.execution.local import LocalHost
from datum_ax.data.inference.client import OmlxInferenceClient
from datum_ax.data.inference.roles import ModelRoleRegistry, RoleConfig

# Packaged persona + rule artifacts ship with the library.
_PACKAGED_PERSONA_ROOT = str(Path(__file__).resolve().parent.parent / "personas")
_PACKAGED_RULES_ROOT = str(Path(__file__).resolve().parent.parent / "rules")


def _learned_rules_root(workspace_dir: str = ".") -> str:
    """Writable dir where compound-engineering auto-bound rules land (ADR-0020), read alongside the
    packaged rules so the loop compounds across runs. Anchored to the **workspace** (absolute), not
    cwd-relative, so binding and reading agree no matter the process directory (review #5)."""
    override = os.environ.get("DATUM_LEARNED_RULES_ROOT")
    if override:
        return str(Path(override).resolve())
    return str((Path(workspace_dir).resolve() / ".datum" / "rules"))


def build_inference_client_from_env() -> InferenceClient:
    """Construct the oMLX InferenceClient from environment configuration."""
    base_url = (
        os.environ.get("OMLX_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or os.environ.get("OPENAI_API_BASE")
        or "http://localhost:12201/v1"
    )
    api_key = os.environ.get("OMLX_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    model_id = (
        os.environ.get("OMLX_MODEL")
        or os.environ.get("OPENAI_MODEL")
        or os.environ.get("DATUM_MODEL", "gpt-4")
    )

    # Lazy by design: transport_mlx pulls in mlx_lm (Apple-Silicon only), so only the
    # selected backend is imported — never import the unused one at module load.
    if os.environ.get("DATUM_NATIVE_MLX") == "1":
        from datum_ax.data.inference.transport_mlx import NativeMlxTransport

        transport: Any = NativeMlxTransport()
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
    return OmlxInferenceClient(transport=transport, registry=registry)


def build_local_host(workspace_dir: str = ".") -> ExecutionHost:
    return LocalHost(workspace_dir=workspace_dir)


def build_token_counter() -> TokenCounter:
    """Real tokenizer by default when `[tokenizer]` is installed, else the ~4-chars/token heuristic
    (ADR-0030/0034). `DATUM_TOKENIZER=heuristic` forces the heuristic.

    **Lazy:** tiktoken's *encoding* (the part that can hit the network on first use) is resolved on the
    first count, not here — so building the crane / loading the graph never downloads anything
    (offline-safe). When tiktoken isn't installed at all we return the heuristic directly (a cheap
    ``find_spec`` check, no import side effects), so the counter is exactly the heuristic."""
    if os.environ.get("DATUM_TOKENIZER") == "heuristic":
        return default_token_count
    if importlib.util.find_spec("tiktoken") is None:
        return default_token_count

    resolved: dict[str, TokenCounter] = {}

    def counter(text: str) -> int:
        if "fn" not in resolved:
            try:
                from datum_ax.data.tokenizers import build_tiktoken_counter

                resolved["fn"] = build_tiktoken_counter()
            except Exception:  # encoding unavailable (e.g. offline first run)
                resolved["fn"] = default_token_count
        return resolved["fn"](text)

    return counter


def build_context_crane(
    budget: TokenBudget | None = None, name: str | None = None, workspace_dir: str = "."
) -> ContextAssembler:
    """Resolve the (mandatory) context assembler by key from `CONTEXT_ASSEMBLERS` (ADR-0030/0032),
    wired with the data adapters + DCP + persona registry + token counter. Default: the crane.
    Construction is offline-safe — no network until a node actually infers/counts."""
    name = name or os.environ.get("DATUM_CONTEXT_ASSEMBLER") or "crane"
    return CONTEXT_ASSEMBLERS.create(
        name,
        code_context=SerenaTokenSaveContext(),
        doc_context=Context7DocContext(),
        nl_compressor=HeadroomNlCompressor(),
        pruner=DynamicContextPruner(),
        budget=budget or TokenBudget(max_input=8000, max_output=2000, window_target=10000),
        persona=build_persona_registry(),
        rules=build_rule_registry(workspace_dir=workspace_dir),
        token_counter=build_token_counter(),
    )


def build_rule_registry(
    name: str | None = None, workspace_dir: str = ".", **kwargs: Any
) -> RuleRegistry:
    """Resolve a rule-registry plugin by name (ADR-0020/0032). Default: file-backed, reading the
    packaged ``datum_ax/rules/`` **and** the workspace's writable learned-rules dir (so auto-bound
    rules from past runs are lifted too)."""
    name = name or os.environ.get("DATUM_RULE_REGISTRY") or "file"
    if name == "file" and "root" not in kwargs:
        kwargs["root"] = [_PACKAGED_RULES_ROOT, _learned_rules_root(workspace_dir)]
    return RULE_REGISTRIES.create(name, **kwargs)


def build_rule_binder(workspace_dir: str = ".", **kwargs: Any) -> RuleBinder:
    """The write side of the rules registry (ADR-0020 capture) — persists learned rules into the
    workspace's writable learned-rules dir (same path the crane's registry reads). CLOSEOUT auto-binds
    through this."""
    kwargs.setdefault("root", _learned_rules_root(workspace_dir))
    # FileRuleRegistry implements both the read (RuleRegistry) and write (RuleBinder) ports.
    return cast(RuleBinder, RULE_REGISTRIES.create("file", **kwargs))


# Centralized schemes recognized but not yet wired (fail loudly rather than fall back to SQLite).
_UNWIRED_LEDGER_SCHEMES = ("libsql", "mysql", "turso")


def build_ledger(url: str | None = None) -> RunLedger:
    """Select the ledger backend by URL — the single swap point (ADR-0031).

    Local SQLite is the default (``:memory:``, a path, or ``sqlite:///path``). Postgres
    (``postgresql://…``) is wired as a centralized ``RunLedger`` adapter; other centralized schemes
    (libsql/mysql/turso) fail loudly until their adapter lands — no core changes either way.
    """
    url = url or os.environ.get("DATUM_LEDGER_URL") or ":memory:"
    scheme = url.split("://", 1)[0] if "://" in url else ""
    if scheme in ("postgresql", "postgres"):
        from datum_ax.data.state.postgres_ledger import PostgresLedger

        return PostgresLedger(url)
    if scheme in _UNWIRED_LEDGER_SCHEMES:
        raise NotImplementedError(
            f"centralized ledger backend '{scheme}' is not wired yet — this is the swap point "
            f"(ADR-0031): add a RunLedger adapter in data/state and dispatch it in build_ledger(). "
            f"Local SQLite (default) and Postgres are wired."
        )
    if url.startswith("sqlite:///"):
        path = url[len("sqlite:///") :]
    elif url.startswith("sqlite://"):
        path = url[len("sqlite://") :] or ":memory:"
    else:
        path = url  # ":memory:" or a filesystem path
    return LibSQLLedger(path)


def build_checkpointer(url: str | None = None) -> CheckpointStore:
    """Select the checkpoint backend by URL — the swap point (ADR-0032).

    In-memory by default (`memory://`, resume within a process). A centralized store
    (`redis://`/`rediss://`/`valkey://`/`valkeys://`) drops in as the `RedisCheckpointer` adapter,
    dispatched here — no core changes. Unrecognized schemes fail loudly.
    """
    url = url or os.environ.get("DATUM_CHECKPOINT_URL") or "memory://"
    scheme = url.split("://", 1)[0] if "://" in url else url
    if scheme in ("memory", ""):
        return InMemoryCheckpointer()
    if scheme in ("valkey", "valkeys", "redis", "rediss"):
        from datum_ax.data.state.redis_checkpoint import RedisCheckpointer

        return RedisCheckpointer(url)
    raise ValueError(f"unrecognized checkpoint URL: {url!r}")


def build_review_gate(name: str | None = None, **kwargs: Any) -> ReviewGate:
    """Resolve a review-gate plugin by name (ADR-0006/0032). Default: eedom."""
    name = name or os.environ.get("DATUM_REVIEW_GATE") or "eedom"
    return REVIEW_GATES.create(name, **kwargs)


def _default_persona_registry_name() -> str:
    """RAG by default when the embedding backend is installed, else the deterministic file registry
    (ADR-0034). The semantic adapter itself also degrades, so this is just to avoid wrapping when
    there's no benefit."""
    import importlib.util

    if importlib.util.find_spec("sentence_transformers") is not None:
        return "semantic"
    return "file"


def build_persona_registry(name: str | None = None, **kwargs: Any) -> PersonaRegistry:
    """Resolve a persona-registry plugin by name (ADR-0033/0032/0034). Default: semantic (RAG) when
    available, else file (deterministic). Both read the packaged ``datum_ax/personas/`` (override
    with ``DATUM_PERSONA_ROOT`` or ``root=``)."""
    name = name or os.environ.get("DATUM_PERSONA_REGISTRY") or _default_persona_registry_name()
    if name in ("file", "semantic") and "root" not in kwargs:
        kwargs["root"] = os.environ.get("DATUM_PERSONA_ROOT", _PACKAGED_PERSONA_ROOT)
    return PERSONA_REGISTRIES.create(name, **kwargs)


def build_issue_projector(name: str | None = None, **kwargs: Any) -> IssueProjector:
    """Resolve an issue-projector plugin by name (ADR-0023/0032). Default: fake; a GitHub-MCP
    adapter drops in behind the same port."""
    name = name or os.environ.get("DATUM_ISSUE_PROJECTOR") or "fake"
    return ISSUE_PROJECTORS.create(name, **kwargs)


def build_status_source() -> StatusSource:
    """The live-status producer (ADR-0029)."""
    return StatusProvider()


def default_configurable(workspace_dir: str = ".") -> dict[str, Any]:
    """The injected dependencies the core graph expects under ``config['configurable']``.

    Construction is offline-safe: the HTTP transport connects only on a real `complete()`, the ledger
    is in-memory, the tokenizer resolves lazily on first count, and registries read local files — so
    building this (and `studio.make_graph`) never touches the network at graph-load time.
    """
    return {
        "configurable": {
            "inference_client": build_inference_client_from_env(),
            "execution_host": build_local_host(workspace_dir),
            "context_crane": build_context_crane(workspace_dir=workspace_dir),
            "run_ledger": build_ledger(),
            "rule_binder": build_rule_binder(workspace_dir),
            "review_gate": build_review_gate(),
        }
    }
