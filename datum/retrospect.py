"""
retrospect.py — Post-run analysis and pattern extraction for datum.

Issue #89: "the model stays the same, the harness absorbs every failure."
Reads last N .datum/runs/*/events.jsonl files, groups failures by FailureLayer,
emits structured insights including recurring failure patterns, slow phases,
tool usage stats, and suggested harness patch locations.

Usage::

    from datum.retrospect import RetrospectConfig, run_retrospect

    cfg = RetrospectConfig(datum_dir=Path(".datum"))
    result = run_retrospect(cfg)
    print(result.to_dict())
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from datum.failure_layer import FailureLayer

# ── Threshold: phases with total_s above this are flagged as "slow" ────────
_SLOW_PHASE_THRESHOLD_S = 60.0


# ── Configuration ─────────────────────────────────────────────────────────────


@dataclass
class RetrospectConfig:
    """Configuration for a retrospect analysis pass.

    Parameters
    ----------
    datum_dir:
        Root of the .datum directory tree.  Runs live under
        ``datum_dir / "runs" / <run_id> / events.jsonl``.
    last_n_runs:
        Maximum number of runs to analyse (most-recent first by directory
        name lexicographic order, which matches the ``YYYYMMDD`` prefix
        convention).  Ignored when ``run_id`` is set.
    run_id:
        If set, analyse only this single run directory.  Takes precedence
        over ``last_n_runs``.
    slow_phase_threshold_s:
        Cumulative seconds for a phase to be considered "slow".
    """

    datum_dir: Path
    last_n_runs: int = 10
    run_id: str | None = None
    slow_phase_threshold_s: float = _SLOW_PHASE_THRESHOLD_S


# ── Result ────────────────────────────────────────────────────────────────────


@dataclass
class RetrospectResult:
    """Structured insights produced by a retrospect pass.

    Attributes
    ----------
    runs_analysed:
        Number of run directories processed.
    total_failures:
        Total escalated/failed events across all analysed runs.
    failures_by_layer:
        Mapping of FailureLayer value → event count.
    slow_phases:
        List of ``{"phase": str, "total_s": float, "event_count": int}``
        dicts for phases that exceeded the slow-phase threshold.  Sorted
        descending by ``total_s``.
    tool_usage:
        Mapping of tool name → invocation count across all analysed runs.
    suggestions:
        Human-readable improvement suggestions derived from the failure
        distribution and recurring patterns.  Each entry names a concrete
        harness patch location or remediation action.
    recurring_patterns:
        Failures that appeared in more than one run.  Each entry is
        ``{"reason": str, "layer": str, "run_count": int, "total_occurrences": int}``.
    """

    runs_analysed: int = 0
    total_failures: int = 0
    failures_by_layer: dict[str, int] = field(default_factory=dict)
    slow_phases: list[dict[str, Any]] = field(default_factory=list)
    tool_usage: dict[str, int] = field(default_factory=dict)
    suggestions: list[str] = field(default_factory=list)
    recurring_patterns: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-safe dict representation."""
        return {
            "runs_analysed": self.runs_analysed,
            "total_failures": self.total_failures,
            "failures_by_layer": self.failures_by_layer,
            "slow_phases": self.slow_phases,
            "tool_usage": self.tool_usage,
            "suggestions": self.suggestions,
            "recurring_patterns": self.recurring_patterns,
        }


# ── Internal helpers ──────────────────────────────────────────────────────────


def _iter_run_dirs(cfg: RetrospectConfig) -> list[Path]:
    """Return sorted run directories to analyse, respecting config limits."""
    runs_root = cfg.datum_dir / "runs"
    if not runs_root.exists():
        return []

    if cfg.run_id is not None:
        target = runs_root / cfg.run_id
        return [target] if target.is_dir() else []

    all_runs = sorted(
        (p for p in runs_root.iterdir() if p.is_dir()),
        key=lambda p: p.name,
        reverse=True,
    )
    return all_runs[: cfg.last_n_runs]


def _load_events(run_dir: Path) -> list[dict]:
    """Load all events from a run directory's events.jsonl."""
    events_file = run_dir / "events.jsonl"
    if not events_file.exists():
        return []
    events: list[dict] = []
    for line in events_file.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def _is_failure_event(event: dict) -> bool:
    """Return True if the event represents a failure or escalation."""
    status = event.get("status", "")
    event_type = event.get("event_type", "")
    return status == "failed" or event_type == "escalation"


def _extract_failure_layer(event: dict) -> str:
    """Derive the FailureLayer value for a failure event.

    Strategy (in priority order):
    1. payload.failure_layer — already classified upstream
    2. payload.reason — derive via FailureLayer.from_reason()
    3. Fall back to UNKNOWN
    """
    payload = event.get("payload") or {}
    raw_layer = payload.get("failure_layer")
    if raw_layer:
        # Validate it's a known layer value; fall back to UNKNOWN if not
        valid = {layer.value for layer in FailureLayer}
        if raw_layer in valid:
            return raw_layer
        return FailureLayer.UNKNOWN.value

    reason = payload.get("reason") or event.get("message", "")
    return FailureLayer.from_reason(reason).value


# ── Suggestion generation ─────────────────────────────────────────────────────

_LAYER_SUGGESTIONS: dict[str, list[str]] = {
    FailureLayer.VERIFICATION.value: [
        "gate.py: tighten AC checks — add explicit assertion steps before gate passes",
        "tdd_driver.py: enforce RED→GREEN before allowing act-phase continuation",
        "gate.py: add test-count ratchet to block passes when no new tests exist",
    ],
    FailureLayer.PLANNING.value: [
        "agent_loop.py: lower max_steps or add early loop-detection sentinel",
        "lane_plan.py: decompose tasks into smaller, verifiable sub-tasks",
        "agent_loop.py: add no-progress counter; escalate after 3 consecutive idle steps",
    ],
    FailureLayer.INFRASTRUCTURE.value: [
        "gate.py: add pre-flight environment check (timeouts, disk, subprocess health)",
        "agent_loop.py: wrap subprocess calls with explicit timeout + retry cap",
        "diagnose_failure.py: expand ENVIRONMENTAL patterns for timeout/path failures",
    ],
    FailureLayer.CONSTRAINT.value: [
        "budget.py: review budget thresholds — consider raising for complex tasks",
        "command_guard.py: audit hook-blocked patterns, ensure they are still valid",
        "gate.py: surface constraint violations earlier in the pipeline (plan phase)",
    ],
    FailureLayer.CONTEXT.value: [
        "memory_extract.py: increase extraction confidence threshold for stale signals",
        "agent_loop.py: inject fresher context at each retry — avoid re-using stale payload",
        "gc.py: shorten transcript retention to prevent stale-context drift",
    ],
    FailureLayer.MODEL.value: [
        "local_llm.py: add token-budget guard before structured generation",
        "schemas.py: add fallback schema with lower token ceiling for recovery path",
        "agent_loop.py: catch structured_output_decode_error and retry with simpler prompt",
    ],
    FailureLayer.SPEC.value: [
        "diagnose_failure.py: flag ambiguous-spec failures to Plan phase for re-brief",
        "lane_plan.py: require explicit AC list before transitioning to act phase",
        "rules_doctor.py: add spec-completeness preflight check",
    ],
    FailureLayer.UNKNOWN.value: [
        "learn_patterns.py: run --review to classify unknown failures into pattern library",
        "diagnose_failure.py: expand pattern library with newly-observed failure signatures",
    ],
}


def _build_suggestions(
    failures_by_layer: dict[str, int],
    recurring_patterns: list[dict],
) -> list[str]:
    """Derive actionable suggestions from the failure distribution.

    Returns a deduplicated, ranked list of suggestion strings.
    """
    if not failures_by_layer:
        return []

    suggestions: list[str] = []
    seen: set[str] = set()

    # Sort layers by failure count descending — address the most painful first
    ranked_layers = sorted(failures_by_layer.items(), key=lambda x: -x[1])

    for layer, _count in ranked_layers:
        for s in _LAYER_SUGGESTIONS.get(layer, []):
            if s not in seen:
                suggestions.append(s)
                seen.add(s)

    # Add a cross-cutting suggestion when recurring patterns exist
    if recurring_patterns:
        recurring_reasons = ", ".join(p["reason"] for p in recurring_patterns[:3])
        msg = (
            f"learn_patterns.py: promote recurring failure reasons "
            f"({recurring_reasons}) to pattern-library.md for faster diagnosis"
        )
        if msg not in seen:
            suggestions.append(msg)

    return suggestions


# ── Core analysis ─────────────────────────────────────────────────────────────


def run_retrospect(cfg: RetrospectConfig) -> RetrospectResult:
    """Analyse completed datum runs and extract structured insights.

    Parameters
    ----------
    cfg:
        Configuration controlling which runs to analyse and thresholds.

    Returns
    -------
    RetrospectResult
        Structured analysis: failure distribution by FailureLayer, slow
        phases, tool usage stats, recurring patterns, and improvement
        suggestions.
    """
    run_dirs = _iter_run_dirs(cfg)
    if not run_dirs:
        return RetrospectResult()

    # Accumulators
    layer_counter: Counter[str] = Counter()
    phase_durations: dict[str, float] = defaultdict(float)
    phase_counts: dict[str, int] = defaultdict(int)
    tool_counter: Counter[str] = Counter()

    # For recurring pattern detection: reason → set of run_ids
    reason_runs: dict[str, set[str]] = defaultdict(set)
    # reason → (layer, total_occurrences)
    reason_info: dict[str, dict[str, Any]] = {}

    runs_analysed = 0

    for run_dir in run_dirs:
        events = _load_events(run_dir)
        if not events:
            # Count empty run dirs only if the directory itself exists
            # (skip — no events to analyse)
            continue
        runs_analysed += 1

        for event in events:
            # ── Failure classification ──────────────────────────────────────
            if _is_failure_event(event):
                layer_val = _extract_failure_layer(event)
                layer_counter[layer_val] += 1

                # Track reason → run mapping for recurring patterns
                payload = event.get("payload") or {}
                reason = payload.get("reason") or ""
                if reason:
                    reason_runs[reason].add(run_dir.name)
                    if reason not in reason_info:
                        reason_info[reason] = {"layer": layer_val, "count": 0}
                    reason_info[reason]["count"] += 1

            # ── Phase duration accumulation ─────────────────────────────────
            phase = event.get("phase", "")
            payload = event.get("payload") or {}
            duration = payload.get("duration_s")
            if phase and isinstance(duration, (int, float)):
                phase_durations[phase] += float(duration)
                phase_counts[phase] += 1

            # ── Tool usage ──────────────────────────────────────────────────
            if event.get("event_type") == "tool_call":
                tool = payload.get("tool", "")
                if tool:
                    tool_counter[tool] += 1

    # ── Post-process: slow phases ─────────────────────────────────────────
    slow_phases = [
        {
            "phase": phase,
            "total_s": round(total_s, 2),
            "event_count": phase_counts[phase],
        }
        for phase, total_s in phase_durations.items()
        if total_s >= cfg.slow_phase_threshold_s
    ]
    slow_phases.sort(key=lambda x: -x["total_s"])

    # ── Post-process: recurring patterns (appeared in >1 run) ────────────
    recurring_patterns = [
        {
            "reason": reason,
            "layer": reason_info[reason]["layer"],
            "run_count": len(run_ids),
            "total_occurrences": reason_info[reason]["count"],
        }
        for reason, run_ids in reason_runs.items()
        if len(run_ids) > 1
    ]
    recurring_patterns.sort(key=lambda x: (-x["run_count"], -x["total_occurrences"]))

    failures_by_layer = dict(layer_counter)
    total_failures = sum(layer_counter.values())

    suggestions = _build_suggestions(failures_by_layer, recurring_patterns)

    return RetrospectResult(
        runs_analysed=runs_analysed,
        total_failures=total_failures,
        failures_by_layer=failures_by_layer,
        slow_phases=slow_phases,
        tool_usage=dict(tool_counter),
        suggestions=suggestions,
        recurring_patterns=recurring_patterns,
    )
