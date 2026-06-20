"""G8 — close the compounding loop (ADR-0020). CLOSEOUT reads the run ledger, derives Lessons
deterministically, harvests them into tiered rules, and auto-binds the safe ones into the rule
registry so the next run's crane lifts them."""

from __future__ import annotations

from datum_ax.core.compound.closeout import lessons_from_trace, run_closeout_harvest
from datum_ax.data.rules.file_registry import FileRuleRegistry
from datum_ax.schemas.compound import LessonSource


class _FakeLedger:
    # Implements the RunLedger port; only get_trace carries behavior (the harvest reads the trace).
    def __init__(self, trace):
        self._trace = trace

    def get_trace(self, run_id=None):
        return self._trace

    def record_node(self, *args, **kwargs):
        pass

    def totals(self, run_id=None):
        return {"nodes": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

    def tokens_spent(self, run_id=None):
        return 0


def test_lessons_derived_from_trace():
    trace = [
        {"node": "PhaseB", "verdict": "reject", "attempt": 1},
        {"node": "synthesize_impl", "attempt": 3},
        {"node": "ROUTE", "attempt": 1},  # nothing to learn
    ]
    lessons = lessons_from_trace(trace, run_id="run-7")
    sources = {lsn.source for lsn in lessons}
    assert LessonSource.EEDOM_REJECT in sources  # from the reject verdict
    assert LessonSource.REPEATED_FAILURE in sources  # from attempt>=2
    assert all(lsn.evidence_ref.startswith("run-7:") for lsn in lessons)  # evidence-backed


def test_closeout_auto_binds_regression_and_persists(tmp_path):
    binder = FileRuleRegistry(root=str(tmp_path))
    ledger = _FakeLedger([{"node": "synthesize_impl", "attempt": 3}])  # a retried failure
    result = run_closeout_harvest(ledger, binder, run_id="run-9")

    assert result.auto_bound  # a regression-test rule was auto-bound
    # ...and it's on disk for the next run.
    reloaded = FileRuleRegistry(root=str(tmp_path))
    assert reloaded.all_rule_ids()  # learned rule persisted
    assert any(r.scope_tags for r in reloaded.all_rules())


def test_closeout_surfaces_rejects_for_gating_not_autobind(tmp_path):
    binder = FileRuleRegistry(root=str(tmp_path))
    ledger = _FakeLedger([{"node": "PhaseB", "verdict": "needs_review", "attempt": 1}])
    result = run_closeout_harvest(ledger, binder, run_id="run-3")
    assert result.proposed  # a new discipline rule is proposed, not auto-bound
    assert not result.auto_bound
    assert FileRuleRegistry(root=str(tmp_path)).all_rule_ids() == ()  # nothing written


def test_loop_closes_learned_rule_visible_to_multi_root_read(tmp_path):
    # CLOSEOUT binds into the learned dir; the crane's registry reads packaged + learned together.
    learned = tmp_path / "learned"
    packaged = tmp_path / "packaged"
    packaged.mkdir()
    binder = FileRuleRegistry(root=str(learned))
    run_closeout_harvest(_FakeLedger([{"node": "x", "attempt": 2}]), binder, run_id="r1")

    crane_view = FileRuleRegistry(root=[str(packaged), str(learned)])
    assert crane_view.all_rule_ids()  # the rule learned this run is lifted next run
