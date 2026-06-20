"""LangGraph Studio entrypoint (presentation tier).

Returns the core graph with concrete ``data`` adapters bound from the environment, so Studio runs
without the core ever importing ``data`` (ADR-0026). Referenced by ``langgraph.json``.
"""

from __future__ import annotations

from typing import Any

from datum_ax.core.orchestration.graph import build_graph
from datum_ax.presentation.composition import default_configurable


def make_graph() -> Any:
    """Factory: env-wired graph for LangGraph Studio."""
    return build_graph().with_config(default_configurable())
