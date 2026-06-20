"""G8/ADR-0020 — the compounding loop, end to end through the real graph.

The review found the loop *wired but inert*: ``run_id`` was never set, nothing called
``ledger.record_node``, and the ReviewGate was never wired in — so CLOSEOUT always harvested ``[]``.
These tests run ``build_graph().invoke(...)`` with a flaky model (forces synthesis retries) + an
injected ledger + binder + a fake review gate, and assert the run actually *learns*: a retried failure
becomes an auto-bound regression rule a fresh multi-root registry then lifts, and a blocking verdict
becomes a proposed (gated) policy rule.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

from langchain_core.runnables import RunnableConfig

from datum_ax.contracts.inference import TokenBudget
from datum_ax.contracts.review import (
    DecisionVerdict,
    PolicyEvaluation,
    ReviewDecision,
)
from datum_ax.core.orchestration.crane import ContextCrane
from datum_ax.core.orchestration.graph import build_graph
from datum_ax.data.context.adapters import (
    Context7DocContext,
    HeadroomNlCompressor,
    SerenaTokenSaveContext,
)
from datum_ax.data.context.dcp import DynamicContextPruner
from datum_ax.data.rules.file_registry import FileRuleRegistry
from datum_ax.data.state.ledger import LibSQLLedger
from datum_ax.presentation.composition import build_persona_registry
from fakes import FakeExecutionHost


def _crane() -> ContextCrane:
    return ContextCrane(
        code_context=SerenaTokenSaveContext(),
        doc_context=Context7DocContext(),
        nl_compressor=HeadroomNlCompressor(),
        pruner=DynamicContextPruner(),
        budget=TokenBudget(max_input=8000, max_output=2000, window_target=10000),
        persona=build_persona_registry(),
    )


class _FakeGate:
    """A ReviewGate that always blocks — the verdict source for EEDOM_REJECT learning."""

    def __init__(self, verdict: DecisionVerdict = DecisionVerdict.REJECT) -> None:
        self.verdict = verdict
        self.seen: list[str] = []

    def evaluate(self, diff: str, properties=None) -> ReviewDecision:
        self.seen.append(diff)
        return ReviewDecision(
            decision_id="fake",
            decision=self.verdict,
            policy_evaluation=PolicyEvaluation(decision=self.verdict, policy_bundle_version="fake"),
            should_comment=True,
            should_mark_unstable=True,
            created_at=datetime.now(timezone.utc),
        )


def _flaky_client() -> MagicMock:
    """A model whose every reply fails strict validation — planning falls back to a stub lane and
    synthesis exhausts its 3 attempts (attempt==3 → a REPEATED_FAILURE signal in the ledger)."""
    client = MagicMock()
    client.complete.return_value.text = "this is not valid json"
    return client


def _run(ledger, binder, gate):
    config: RunnableConfig = {
        "configurable": {
            "inference_client": _flaky_client(),
            "execution_host": FakeExecutionHost(),
            "context_crane": _crane(),
            "run_ledger": ledger,
            "rule_binder": binder,
            "review_gate": gate,
        }
    }
    return build_graph().invoke(
        {"ticket": {"text": "build a thing", "scale": "task"}, "results": {}},
        config=config,
    )


def test_run_threads_a_run_id_and_populates_the_ledger(tmp_path):
    ledger = LibSQLLedger(":memory:")
    final = _run(ledger, FileRuleRegistry(root=str(tmp_path)), _FakeGate())

    run_id = final["run_id"]
    assert run_id  # minted at ROUTE, threaded through state
    trace = ledger.get_trace(run_id)
    nodes = [r["node"] for r in trace]
    assert "ROUTE" in nodes and "PhaseA" in nodes and "CLOSEOUT" in nodes  # nodes recorded
    # The per-lane record carries the retried-attempt count and the gate verdict.
    lane_recs = [r for r in trace if r["attempt"] and r["attempt"] >= 2]
    assert lane_recs, "a retried lane should be recorded with attempt>=2"
    assert any(r["verdict"] == "reject" for r in trace)


def test_retried_failure_compounds_into_a_lifted_regression_rule(tmp_path):
    # CLOSEOUT binds into the learned (writable) root; a fresh multi-root registry lifts it next run.
    learned = tmp_path / "learned"
    packaged = tmp_path / "packaged"
    packaged.mkdir()
    ledger = LibSQLLedger(":memory:")
    binder = FileRuleRegistry(root=str(learned))

    final = _run(ledger, binder, _FakeGate())

    closeout = final["results"]["closeout"]
    assert closeout["auto_bound"], "a retried failure should auto-bind a regression rule"
    # The next run's crane reads packaged + learned together and sees the rule learned this run.
    crane_view = FileRuleRegistry(root=[str(packaged), str(learned)])
    assert crane_view.all_rule_ids()


def test_blocking_verdict_is_proposed_not_autobound(tmp_path):
    ledger = LibSQLLedger(":memory:")
    binder = FileRuleRegistry(root=str(tmp_path))

    final = _run(ledger, binder, _FakeGate(DecisionVerdict.NEEDS_REVIEW))

    closeout = final["results"]["closeout"]
    assert closeout["proposed"], "a blocking verdict should surface a proposed (gated) policy rule"


def test_loop_is_inert_without_a_ledger():
    # Fail-open: no ledger injected → the loop still completes, it just records/harvests nothing.
    config: RunnableConfig = {
        "configurable": {
            "inference_client": _flaky_client(),
            "execution_host": FakeExecutionHost(),
            "context_crane": _crane(),
        }
    }
    final = build_graph().invoke(
        {"ticket": {"text": "x", "scale": "task"}, "results": {}}, config=config
    )
    assert final["visited_nodes"] == ["ROUTE", "PhaseA", "PhaseB", "CLOSEOUT"]
    assert "closeout" not in final["results"]  # nothing harvested
