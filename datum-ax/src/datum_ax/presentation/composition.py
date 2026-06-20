"""Composition root (presentation tier) — wire concrete ``data`` adapters into the core graph.

Presentation is the only tier allowed to import both ``core`` and ``data`` (ADR-0026). The core graph
depends on the ``contracts`` Protocols and receives concrete adapters via ``config['configurable']``.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from datum_ax.contracts.checkpoint import CheckpointStore
from datum_ax.contracts.execution import ExecutionHost
from datum_ax.contracts.inference import InferenceClient, ModelRole, TokenBudget
from datum_ax.contracts.ledger import RunLedger
from datum_ax.contracts.persona import PersonaRegistry
from datum_ax.contracts.review import ReviewGate
from datum_ax.contracts.status import StatusSource
from datum_ax.data.persona import PERSONA_REGISTRIES
from datum_ax.data.review import REVIEW_GATES
from datum_ax.data.state.checkpoint import InMemoryCheckpointer
from datum_ax.data.state.ledger import LibSQLLedger
from datum_ax.data.state.status import StatusProvider
from datum_ax.core.orchestration.crane import ContextCrane
from datum_ax.data.context.adapters import (
    Context7DocContext,
    HeadroomNlCompressor,
    SerenaTokenSaveContext,
)
from datum_ax.data.context.dcp import DynamicContextPruner
from datum_ax.data.execution.local import LocalHost
from datum_ax.data.inference.client import OmlxInferenceClient
from datum_ax.data.inference.roles import ModelRoleRegistry, RoleConfig

# Packaged persona artifacts ship with the library (datum_ax/personas/).
_PACKAGED_PERSONA_ROOT = str(Path(__file__).resolve().parent.parent / "personas")


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


def build_context_crane(budget: TokenBudget | None = None) -> ContextCrane:
    """The single context-assembly authority (ADR-0030), wired with the data adapters + DCP."""
    return ContextCrane(
        code_context=SerenaTokenSaveContext(),
        doc_context=Context7DocContext(),
        nl_compressor=HeadroomNlCompressor(),
        pruner=DynamicContextPruner(),
        budget=budget or TokenBudget(max_input=8000, max_output=2000, window_target=10000),
        persona=build_persona_registry(),
    )


_REMOTE_SCHEMES = ("postgresql", "postgres", "libsql", "mysql", "turso")


def build_ledger(url: str | None = None) -> RunLedger:
    """Select the ledger backend by URL — the single swap point (ADR-0031).

    Local SQLite is the default (``:memory:``, a path, or ``sqlite:///path``). A centralized backend
    (Postgres/Turso) is added as another ``RunLedger`` adapter and dispatched here — no core changes.
    """
    url = url or os.environ.get("DATUM_LEDGER_URL") or ":memory:"
    scheme = url.split("://", 1)[0] if "://" in url else ""
    if scheme in _REMOTE_SCHEMES:
        raise NotImplementedError(
            f"centralized ledger backend '{scheme}' is not wired yet — this is the swap point "
            f"(ADR-0031): add a RunLedger adapter in data/state and dispatch it in build_ledger(). "
            f"Local SQLite remains the default."
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
    (`valkey://`/`redis://`) drops in as another `CheckpointStore` adapter, dispatched here — no core
    changes. Unwired schemes fail loudly.
    """
    url = url or os.environ.get("DATUM_CHECKPOINT_URL") or "memory://"
    scheme = url.split("://", 1)[0] if "://" in url else url
    if scheme in ("memory", ""):
        return InMemoryCheckpointer()
    if scheme in ("valkey", "redis", "rediss"):
        raise NotImplementedError(
            f"centralized checkpoint backend '{scheme}' is not wired yet — this is the swap point "
            f"(ADR-0032): add a CheckpointStore adapter in data/state and dispatch it in "
            f"build_checkpointer(). In-memory remains the default."
        )
    raise ValueError(f"unrecognized checkpoint URL: {url!r}")


def build_review_gate(name: str | None = None, **kwargs: Any) -> ReviewGate:
    """Resolve a review-gate plugin by name (ADR-0006/0032). Default: eedom."""
    name = name or os.environ.get("DATUM_REVIEW_GATE") or "eedom"
    return REVIEW_GATES.create(name, **kwargs)


def build_persona_registry(name: str | None = None, **kwargs: Any) -> PersonaRegistry:
    """Resolve a persona-registry plugin by name (ADR-0033/0032). Default: file-backed.

    The default root is the packaged ``datum_ax/personas/`` (override with ``DATUM_PERSONA_ROOT``
    or ``root=``).
    """
    name = name or os.environ.get("DATUM_PERSONA_REGISTRY") or "file"
    if name == "file" and "root" not in kwargs:
        kwargs["root"] = os.environ.get("DATUM_PERSONA_ROOT", _PACKAGED_PERSONA_ROOT)
    return PERSONA_REGISTRIES.create(name, **kwargs)


def build_status_source() -> StatusSource:
    """The live-status producer (ADR-0029)."""
    return StatusProvider()


def default_configurable(workspace_dir: str = ".") -> dict[str, Any]:
    """The injected dependencies the core graph expects under ``config['configurable']``."""
    return {
        "configurable": {
            "inference_client": build_inference_client_from_env(),
            "execution_host": build_local_host(workspace_dir),
            "context_crane": build_context_crane(),
        }
    }
