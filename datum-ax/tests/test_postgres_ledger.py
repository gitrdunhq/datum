"""PostgresLedger — centralized RunLedger adapter (ADR-0031).

Postgres can't run in this offline sandbox, so the adapter's SQL/mapping logic is unit-tested against a
recording fake connection (asserts the values it binds and how it maps rows back), and a full
conformance run against a real server is opt-in via DATUM_TEST_POSTGRES_URL.
"""

from __future__ import annotations

import os
from typing import Any

import pytest

from datum_ax.contracts.ledger import RunLedger
from datum_ax.data.state.postgres_ledger import PostgresLedger


class _RecordingCursor:
    def __init__(self, conn: "_RecordingConn") -> None:
        self._conn = conn

    def __enter__(self) -> "_RecordingCursor":
        return self

    def __exit__(self, *exc: Any) -> None:
        return None

    def execute(self, sql: str, params: Any = None) -> None:
        self._conn.executed.append((" ".join(sql.split()), params))
        self._conn.last_rows = self._conn.rows_for(sql, params)

    def fetchall(self) -> list[dict[str, Any]]:
        return list(self._conn.last_rows)

    def fetchone(self) -> dict[str, Any] | None:
        return self._conn.last_rows[0] if self._conn.last_rows else None


class _RecordingConn:
    """Stands in for a psycopg connection: records executed SQL+params, returns canned rows."""

    def __init__(self, rows_for: Any = None) -> None:
        self.executed: list[tuple[str, Any]] = []
        self.commits = 0
        self.last_rows: list[dict[str, Any]] = []
        self.rows_for: Any = rows_for or (lambda sql, params: [])

    def cursor(self) -> _RecordingCursor:
        return _RecordingCursor(self)

    def commit(self) -> None:
        self.commits += 1

    def close(self) -> None:
        pass


def _inserts(conn: _RecordingConn) -> list[tuple[str, Any]]:
    return [(sql, params) for sql, params in conn.executed if sql.startswith("INSERT INTO trace")]


def test_satisfies_port_without_connecting() -> None:
    # No injected connection + lazy psycopg import => constructing never touches the driver/network.
    led = PostgresLedger("postgresql://user@host/db")
    assert isinstance(led, RunLedger)


def test_schema_created_eagerly_for_injected_connection() -> None:
    conn = _RecordingConn()
    PostgresLedger("postgresql://x", connection=conn)
    assert any("CREATE TABLE IF NOT EXISTS trace" in sql for sql, _ in conn.executed)
    assert conn.commits >= 1


def test_record_node_binds_expected_values_and_coerces_deterministic() -> None:
    conn = _RecordingConn()
    led = PostgresLedger("postgresql://x", connection=conn)
    led.record_node(
        "plan",
        input_tokens=3,
        output_tokens=2,
        model_role="planner",
        attempt=2,
        deterministic=True,
        verdict="approve",
        run_id="r1",
    )
    inserts = _inserts(conn)
    assert len(inserts) == 1
    _, params = inserts[0]
    # Column order matches LibSQLLedger: run_id, node, model_role, model_id, input, output,
    # duration_s, attempt, deterministic, verdict — and the bool is coerced to int 1.
    assert params == ("r1", "plan", "planner", None, 3, 2, None, 2, 1, "approve")
    assert conn.commits >= 2  # schema + insert


@pytest.mark.parametrize("value,expected", [(True, 1), (False, 0), (None, None)])
def test_deterministic_coercion(value: bool | None, expected: int | None) -> None:
    conn = _RecordingConn()
    led = PostgresLedger("postgresql://x", connection=conn)
    led.record_node("n", deterministic=value, run_id="r")
    _, params = _inserts(conn)[0]
    assert params[8] == expected  # deterministic column


def test_get_trace_scopes_by_run_id_and_maps_rows() -> None:
    canned = [{"id": 1, "run_id": "r1", "node": "a", "attempt": 3, "verdict": None}]

    def rows_for(sql: str, params: Any) -> list[dict[str, Any]]:
        return canned if "SELECT * FROM trace" in " ".join(sql.split()) else []

    conn = _RecordingConn(rows_for)
    led = PostgresLedger("postgresql://x", connection=conn)
    trace = led.get_trace("r1")
    assert trace == canned
    # scoped read used a parameterized WHERE clause
    selects = [(sql, params) for sql, params in conn.executed if "SELECT * FROM trace" in sql]
    assert selects[-1][0].endswith("WHERE run_id = %s ORDER BY id ASC")
    assert selects[-1][1] == ("r1",)


def test_get_trace_unscoped_reads_all() -> None:
    conn = _RecordingConn(lambda sql, params: [])
    led = PostgresLedger("postgresql://x", connection=conn)
    led.get_trace()
    selects = [sql for sql, _ in conn.executed if "SELECT * FROM trace" in sql]
    assert selects[-1] == "SELECT * FROM trace ORDER BY id ASC"


def test_totals_and_tokens_spent_aggregate() -> None:
    def rows_for(sql: str, params: Any) -> list[dict[str, Any]]:
        if "COUNT(*)" in sql:
            return [{"nodes": 2, "input_tokens": 10, "output_tokens": 5}]
        return []

    conn = _RecordingConn(rows_for)
    led = PostgresLedger("postgresql://x", connection=conn)
    assert led.totals("r1") == {
        "nodes": 2,
        "input_tokens": 10,
        "output_tokens": 5,
        "total_tokens": 15,
    }
    assert led.tokens_spent("r1") == 15


# --- Opt-in conformance against a real Postgres (set DATUM_TEST_POSTGRES_URL) -------------------

_PG_URL = os.environ.get("DATUM_TEST_POSTGRES_URL")


@pytest.mark.skipif(not _PG_URL, reason="no real Postgres (set DATUM_TEST_POSTGRES_URL)")
def test_real_postgres_conformance() -> None:
    led = PostgresLedger(_PG_URL)  # type: ignore[arg-type]
    conn = led._conn()
    with conn.cursor() as cur:  # clean slate so the global-count assertion is deterministic
        cur.execute("TRUNCATE trace")
    conn.commit()
    led.record_node("a", input_tokens=10, output_tokens=5, run_id="r1")
    led.record_node("b", input_tokens=1, output_tokens=1, run_id="r2")
    assert led.totals("r1")["total_tokens"] == 15
    assert led.tokens_spent("r2") == 2
    assert led.totals()["nodes"] == 2
    assert len(led.get_trace("r1")) == 1
    led.close()
