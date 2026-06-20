"""Composition root (presentation tier) — wire concrete ``data`` adapters into the core graph.

Presentation is the only tier allowed to import both ``core`` and ``data`` (ADR-0026). The core graph
depends on the ``contracts`` Protocols and receives concrete adapters via ``config['configurable']``.
"""

from __future__ import annotations

import os
from typing import Any

from datum_ax.contracts.execution import ExecutionHost
from datum_ax.contracts.inference import InferenceClient, ModelRole, TokenBudget
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

    if os.environ.get("DATUM_NATIVE_MLX") == "1":
        from datum_ax.data.inference.transport_mlx import NativeMlxTransport

        transport: Any = NativeMlxTransport()
    else:
        from datum_ax.data.inference.transport_httpx import HttpxTransport

        transport = HttpxTransport(base_url=base_url, api_key=api_key)

    registry = ModelRoleRegistry(
        configs=(
            RoleConfig(role=ModelRole.TRIAGE, model_id=model_id, temperature=0.0,
                       response_format={"type": "json_object"}),
            RoleConfig(role=ModelRole.PLANNER, model_id=model_id, temperature=0.1,
                       response_format={"type": "json_object"}),
            RoleConfig(role=ModelRole.EXECUTOR, model_id=model_id, temperature=0.2,
                       response_format={"type": "json_object"}),
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
    )


def default_configurable(workspace_dir: str = ".") -> dict[str, Any]:
    """The injected dependencies the core graph expects under ``config['configurable']``."""
    return {
        "configurable": {
            "inference_client": build_inference_client_from_env(),
            "execution_host": build_local_host(workspace_dir),
            "context_crane": build_context_crane(),
        }
    }
