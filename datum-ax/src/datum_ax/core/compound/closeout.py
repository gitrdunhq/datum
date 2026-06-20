"""CLOSEOUT harvest (ADR-0020) — turn a run's ledger trace into durable rules.

Deterministic: each ledger record that carries a learnable signal (a blocking verdict, a retried
failure) becomes an evidence-backed `Lesson`; `harvest` tiers them; the auto-bound ones are persisted
via the injected `RuleBinder` so the next run's crane lifts them. Reads the `RunLedger` + `RuleBinder`
ports only — no data-tier import, so this stays in `core`.
"""

from __future__ import annotations

from typing import Any

from datum_ax.contracts.ledger import RunLedger
from datum_ax.contracts.rules import RuleBinder
from datum_ax.core.compound.harvest import harvest
from datum_ax.schemas.compound import HarvestResult, Lesson, LessonSource
from datum_ax.schemas.rules import RuleKind

_BLOCKING = {"reject", "needs_review"}


def lessons_from_trace(trace: list[dict[str, Any]], run_id: str = "run") -> tuple[Lesson, ...]:
    """Derive evidence-backed lessons from ledger records (deterministic)."""
    lessons: list[Lesson] = []
    for rec in trace:
        node = str(rec.get("node") or "node")
        verdict = rec.get("verdict")
        attempt = int(rec.get("attempt") or 0)
        if verdict in _BLOCKING:
            lessons.append(
                Lesson(
                    id=f"{run_id}-{node}-policy",
                    source=LessonSource.EEDOM_REJECT,
                    statement=f"Guard against the policy issue {node} hit ({verdict}).",
                    evidence_ref=f"{run_id}:{node}:{verdict}",
                    proposed_kind=RuleKind.DISCIPLINE,
                    scope_tags=("code",),
                )
            )
        if attempt >= 2:
            lessons.append(
                Lesson(
                    id=f"{run_id}-{node}-regression",
                    source=LessonSource.REPEATED_FAILURE,
                    statement=f"Add a regression test for the failure {node} retried on (attempt {attempt}).",
                    evidence_ref=f"{run_id}:{node}:attempt-{attempt}",
                    proposed_kind=RuleKind.TEST,
                    scope_tags=("code", "testing"),
                )
            )
    return tuple(lessons)


def run_closeout_harvest(
    ledger: RunLedger, binder: RuleBinder, run_id: str = "run"
) -> HarvestResult:
    """Read the trace → derive lessons → harvest → auto-bind. Returns the result (proposed rules are
    surfaced for a human yes/no; auto-bound ones are already persisted)."""
    trace = ledger.get_trace(run_id)
    lessons = lessons_from_trace(trace, run_id)
    result = harvest(lessons, existing_rule_ids=frozenset(binder.all_rule_ids()))
    for entry in result.auto_bound:
        binder.add_rule(entry)
    return result
