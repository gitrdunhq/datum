"""Swappable ledger backend (ADR-0031): one port, local SQLite now, centralized DB later."""

from __future__ import annotations

import pytest

from datum_ax.contracts.ledger import RunLedger
from datum_ax.data.state.ledger import LibSQLLedger
from datum_ax.presentation.composition import build_ledger


def _sqlite_factory() -> RunLedger:
    return LibSQLLedger(":memory:")


# Add a Postgres/Turso factory here when that adapter lands — the conformance suite runs over all.
LEDGER_FACTORIES = [_sqlite_factory]


class TestLedgerPort:
    def test_sqlite_satisfies_port(self):
        assert isinstance(LibSQLLedger(":memory:"), RunLedger)

    def test_build_ledger_defaults_to_local_sqlite(self):
        led = build_ledger(":memory:")
        assert isinstance(led, RunLedger)
        led.record_node("plan", input_tokens=3, output_tokens=2, run_id="r")
        assert led.tokens_spent("r") == 5

    def test_build_ledger_sqlite_file(self, tmp_path):
        led = build_ledger(f"sqlite:///{tmp_path / 'l.db'}")
        assert isinstance(led, RunLedger)
        led.record_node("a", input_tokens=1, output_tokens=1, run_id="r")
        assert led.tokens_spent("r") == 2

    def test_postgres_backend_is_wired(self):
        # postgresql:// resolves to the centralized adapter — lazily, so no connection is made here.
        from datum_ax.data.state.postgres_ledger import PostgresLedger

        led = build_ledger("postgresql://user@host/db")
        assert isinstance(led, PostgresLedger)
        assert isinstance(led, RunLedger)

    def test_unwired_centralized_backend_is_a_clear_seam(self):
        # Schemes without an adapter yet fail loudly (not silently to sqlite).
        with pytest.raises(NotImplementedError):
            build_ledger("turso://host/db")

    @pytest.mark.parametrize("factory", LEDGER_FACTORIES)
    def test_port_conformance(self, factory):
        # Substitutability: every RunLedger impl satisfies the same metering contract.
        led = factory()
        assert isinstance(led, RunLedger)
        led.record_node("a", input_tokens=10, output_tokens=5, run_id="r1")
        led.record_node("b", input_tokens=1, output_tokens=1, run_id="r2")
        assert led.totals("r1")["total_tokens"] == 15
        assert led.tokens_spent("r2") == 2
        assert led.totals()["nodes"] == 2
        assert len(led.get_trace("r1")) == 1
