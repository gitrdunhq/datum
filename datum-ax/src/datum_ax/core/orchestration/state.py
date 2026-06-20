from typing import Any, Optional, TypedDict


class OrchestratorState(TypedDict, total=False):
    """The LangGraph state schema (ADR-0002).
    Represents the overall pipeline state in the graph.
    """
    
    ticket: dict[str, Any]
    workspace_dir: str
    dag: Optional[dict[str, Any]]
    current_wave: int
    results: dict[str, Any]
    error: Optional[str]
    visited_nodes: list[str]
