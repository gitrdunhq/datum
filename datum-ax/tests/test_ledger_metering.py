"""G6: ledger deepening — run-scoping, token metering, persistence (ADR-0013)."""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from datum_ax.data.state.ledger import LibSQLLedger


class TestLedgerMetering:
    def test_run_scoping_isolates_totals(self):
        # Isolation: one run's records never bleed into another's totals.
        ledger = LibSQLLedger(":memory:")
        ledger.record_node("plan", input_tokens=100, output_tokens=50, run_id="r1")
        ledger.record_node("plan", input_tokens=10, output_tokens=5, run_id="r2")
        assert ledger.totals("r1") == {
            "nodes": 1, "input_tokens": 100, "output_tokens": 50, "total_tokens": 150
        }
        assert ledger.totals("r2")["total_tokens"] == 15
        assert ledger.totals()["total_tokens"] == 165  # global across runs
        assert len(ledger.get_trace("r1")) == 1

    def test_tokens_spent_is_monotonic(self):
        ledger = LibSQLLedger(":memory:")
        assert ledger.tokens_spent("r1") == 0
        ledger.record_node("a", input_tokens=10, output_tokens=20, run_id="r1")
        first = ledger.tokens_spent("r1")
        ledger.record_node("b", input_tokens=5, output_tokens=5, run_id="r1")
        assert first == 30
        assert ledger.tokens_spent("r1") >= first  # Monotonicity

    def test_records_role_attempt_verdict(self):
        ledger = LibSQLLedger(":memory:")
        ledger.record_node(
            "review", model_role="adversarial", attempt=2, deterministic=False,
            verdict="reject", input_tokens=5, output_tokens=1, run_id="r1",
        )
        row = ledger.get_trace("r1")[0]
        assert row["model_role"] == "adversarial"
        assert row["attempt"] == 2
        assert row["deterministic"] == 0
        assert row["verdict"] == "reject"

    def test_persists_across_reconnect(self, tmp_path):
        # Availability: a file-backed ledger survives a reconnect.
        db = str(tmp_path / "ledger.db")
        a = LibSQLLedger(db)
        a.record_node("plan", input_tokens=7, output_tokens=3, run_id="r1")
        a.close()
        b = LibSQLLedger(db)
        assert b.totals("r1")["total_tokens"] == 10
        assert len(b.get_trace("r1")) == 1

    def test_backward_compatible_positional(self):
        ledger = LibSQLLedger(":memory:")
        ledger.record_node("plan", "sonnet", 100, 50, 1.5)
        row = ledger.get_trace()[0]
        assert row["node"] == "plan" and row["model_id"] == "sonnet"


class TestLedgerProperties:
    @given(
        toks=st.lists(
            st.tuples(st.integers(0, 1000), st.integers(0, 1000)), min_size=0, max_size=20
        )
    )
    def test_totals_equal_sum_and_every_node_persists(self, toks):
        ledger = LibSQLLedger(":memory:")
        for i, (inp, out) in enumerate(toks):
            ledger.record_node(f"n{i}", input_tokens=inp, output_tokens=out, run_id="r")
        t = ledger.totals("r")
        assert t["nodes"] == len(toks)  # Non-repudiation: every record persists
        assert t["input_tokens"] == sum(i for i, _ in toks)  # Determinism: faithful aggregate
        assert t["output_tokens"] == sum(o for _, o in toks)
        assert t["total_tokens"] == sum(i + o for i, o in toks)
        assert len(ledger.get_trace("r")) == len(toks)
