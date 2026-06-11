"""Tool risk-class metadata and retry-safety classification (#77).

Defines ToolRiskClass — an enum describing the side-effect profile of each
tool in the agent loop's TOOL_CATALOG — and two pure helper functions:

  classify_tool(tool_name) -> ToolRiskClass
      Returns the risk class for a named tool; defaults to ``destructive``
      for any unknown name (fail-safe).

  retry_safe(risk_class) -> bool
      True only for read_only and compute_only.  Write, process, and
      destructive operations must never be silently retried.

TOOL_RISK_MAP is the canonical mapping; it is imported by agent_loop.py to
populate the third element of each TOOL_CATALOG tuple and by the retry/
no-progress logic to gate automatic retries.

Idempotency reasoning by class:

  read_only         — no side effects; retry is always safe.
  compute_only      — pure transformation, no I/O; retry is safe.
  write_local       — overwrites working-tree files; a retry on an already-
                      written file is safe IFF the content is identical, but
                      the caller cannot know that without re-reading. Mark
                      non-retryable; callers must re-verify before retrying.
  process_execution — runs an external process; unknown side effects; never
                      auto-retry (the subprocess may have mutated state).
  destructive       — catch-all for anything not explicitly classified; must
                      never be auto-retried.

This is a pure module: no I/O, no subprocess, no LLM, stdlib + enum only.
"""

from __future__ import annotations

from enum import StrEnum


class ToolRiskClass(StrEnum):
    """Side-effect profile of a tool in the agent loop."""

    read_only = "read_only"
    compute_only = "compute_only"
    write_local = "write_local"
    process_execution = "process_execution"
    destructive = "destructive"


# Canonical tool → risk-class mapping.
# Kept in insertion order matching TOOL_CATALOG for easy diff review.
TOOL_RISK_MAP: dict[str, ToolRiskClass] = {
    # ── read-only: no side effects, always retry-safe ─────────────────────
    "read_file": ToolRiskClass.read_only,
    "read_file_range": ToolRiskClass.read_only,
    "list_dir": ToolRiskClass.read_only,
    "grep_search": ToolRiskClass.read_only,
    "find_callers": ToolRiskClass.read_only,
    "filter_gitnexus_output": ToolRiskClass.read_only,
    "read_todos": ToolRiskClass.read_only,
    "corpus_sql": ToolRiskClass.read_only,
    # ── process_execution: external process, unknown side-effects ─────────
    "run_command": ToolRiskClass.process_execution,
    # ── write_local: mutates the working tree, not retry-safe ─────────────
    "write_to_file": ToolRiskClass.write_local,
    "replace_file_content": ToolRiskClass.write_local,
    "multi_replace_file_content": ToolRiskClass.write_local,
    "write_todos": ToolRiskClass.write_local,
}

# Classes for which automatic retry is safe (transient failures only).
_RETRY_SAFE_CLASSES: frozenset[ToolRiskClass] = frozenset(
    {ToolRiskClass.read_only, ToolRiskClass.compute_only}
)


def classify_tool(tool_name: str) -> ToolRiskClass:
    """Return the ToolRiskClass for *tool_name*.

    Falls back to ``ToolRiskClass.destructive`` for any unrecognised name —
    fail-safe: an unknown tool is assumed to have the worst possible profile.
    """
    return TOOL_RISK_MAP.get(tool_name, ToolRiskClass.destructive)


def retry_safe(risk_class: ToolRiskClass) -> bool:
    """True when a transient failure on a tool of *risk_class* may be retried.

    Only read_only and compute_only operations are retry-safe.  All others
    (write_local, process_execution, destructive) must not be auto-retried
    because their side effects may not be idempotent.

    Raises TypeError for non-ToolRiskClass arguments so callers do not
    accidentally pass a raw string.
    """
    if not isinstance(risk_class, ToolRiskClass):
        raise TypeError(
            f"retry_safe expects a ToolRiskClass, got {type(risk_class).__name__!r}"
        )
    return risk_class in _RETRY_SAFE_CLASSES
