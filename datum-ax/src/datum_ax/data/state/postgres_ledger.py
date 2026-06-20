"""PostgresLedger — centralized `RunLedger` adapter (ADR-0031).

The swap point for the local SQLite default (`LibSQLLedger`): same port, same `trace` schema, same
metering semantics — only the driver and SQL dialect change. Selected by URL (`postgresql://…`) in the
composition root; `core` depends on the `RunLedger` Protocol, never this class (ADR-0026).

`psycopg` is imported lazily on first connect (or a connection is injected for tests), so importing
this module — and building the graph offline — never requires the optional `[database]` extra.
"""

from __future__ import annotations

from typing import Any

from datum_ax.observability import get_logger

logger = get_logger(__name__)

# Mirrors LibSQLLedger's table exactly so traces are portable. `deterministic` stays INTEGER (0/1) so
# `get_trace` returns the same value types as SQLite; identity PK keeps the id-ordered read stable.
_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS trace (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id TEXT NOT NULL DEFAULT 'run',
    node TEXT NOT NULL,
    model_role TEXT,
    model_id TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    duration_s DOUBLE PRECISION,
    attempt INTEGER,
    deterministic INTEGER,
    verdict TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""

_TOTALS_SQL = (
    "SELECT COUNT(*) AS nodes, "
    "COALESCE(SUM(input_tokens), 0) AS input_tokens, "
    "COALESCE(SUM(output_tokens), 0) AS output_tokens FROM trace"
)


class PostgresLedger:
    """Implements the `RunLedger` port on PostgreSQL via psycopg (libSQL-compatible semantics)."""

    def __init__(self, dsn: str, *, connection: Any = None) -> None:
        self._dsn = dsn
        self._connection: Any = connection
        self._initialized = False
        if connection is not None:
            # An injected connection (tests) is ready now — create the schema eagerly.
            self._ensure_schema()

    def _conn(self) -> Any:
        if self._connection is None:
            import psycopg
            from psycopg.rows import dict_row

            self._connection = psycopg.connect(self._dsn, row_factory=dict_row)
            self._ensure_schema()
        return self._connection

    def _ensure_schema(self) -> None:
        if self._initialized:
            return
        with self._connection.cursor() as cur:
            cur.execute(_CREATE_TABLE)
        self._connection.commit()
        self._initialized = True

    def record_node(
        self,
        node: str,
        model_id: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        duration_s: float | None = None,
        *,
        model_role: str | None = None,
        attempt: int | None = None,
        deterministic: bool | None = None,
        verdict: str | None = None,
        run_id: str = "run",
    ) -> None:
        det = None if deterministic is None else int(bool(deterministic))
        conn = self._conn()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO trace
                    (run_id, node, model_role, model_id, input_tokens, output_tokens,
                     duration_s, attempt, deterministic, verdict)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    run_id,
                    node,
                    model_role,
                    model_id,
                    input_tokens,
                    output_tokens,
                    duration_s,
                    attempt,
                    det,
                    verdict,
                ),
            )
        conn.commit()

    def get_trace(self, run_id: str | None = None) -> list[dict[str, Any]]:
        conn = self._conn()
        with conn.cursor() as cur:
            if run_id is None:
                cur.execute("SELECT * FROM trace ORDER BY id ASC")
            else:
                cur.execute("SELECT * FROM trace WHERE run_id = %s ORDER BY id ASC", (run_id,))
            return [dict(row) for row in cur.fetchall()]

    def totals(self, run_id: str | None = None) -> dict[str, int]:
        """Token metering. `run_id=None` aggregates across all runs."""
        conn = self._conn()
        with conn.cursor() as cur:
            if run_id is None:
                cur.execute(_TOTALS_SQL)
            else:
                cur.execute(_TOTALS_SQL + " WHERE run_id = %s", (run_id,))
            row = cur.fetchone()
        inp, out = int(row["input_tokens"]), int(row["output_tokens"])
        return {
            "nodes": int(row["nodes"]),
            "input_tokens": inp,
            "output_tokens": out,
            "total_tokens": inp + out,
        }

    def tokens_spent(self, run_id: str | None = None) -> int:
        """Cumulative tokens — the figure the global token-budget backstop checks (ADR-0013)."""
        return self.totals(run_id)["total_tokens"]

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
