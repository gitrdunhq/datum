import sqlite3
from typing import Any


class LibSQLLedger:
    """Durable run trace + token metering (ADR-0005/0013).

    Per-run scoped node records (role, tokens, attempt, verdict, determinism) on SQLite (libSQL is
    SQLite-compatible). `totals`/`tokens_spent` back the global token-budget backstop; file-backed
    instances persist across reconnect.
    """

    def __init__(self, db_path: str = ":memory:"):
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self._init_db()

    def _init_db(self) -> None:
        with self.conn:
            self.conn.execute(
                """
                CREATE TABLE IF NOT EXISTS trace (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL DEFAULT 'default',
                    node TEXT NOT NULL,
                    model_role TEXT,
                    model_id TEXT,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    duration_s REAL,
                    attempt INTEGER,
                    deterministic INTEGER,
                    verdict TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
                """
            )

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
        run_id: str = "default",
    ) -> None:
        det = None if deterministic is None else int(bool(deterministic))
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO trace
                    (run_id, node, model_role, model_id, input_tokens, output_tokens,
                     duration_s, attempt, deterministic, verdict)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    def get_trace(self, run_id: str | None = None) -> list[dict[str, Any]]:
        cur = self.conn.cursor()
        if run_id is None:
            cur.execute("SELECT * FROM trace ORDER BY id ASC")
        else:
            cur.execute("SELECT * FROM trace WHERE run_id = ? ORDER BY id ASC", (run_id,))
        return [dict(row) for row in cur.fetchall()]

    def totals(self, run_id: str | None = None) -> dict[str, int]:
        """Token metering. `run_id=None` aggregates across all runs."""
        sql = (
            "SELECT COUNT(*) AS nodes, "
            "COALESCE(SUM(input_tokens), 0) AS input_tokens, "
            "COALESCE(SUM(output_tokens), 0) AS output_tokens FROM trace"
        )
        cur = self.conn.cursor()
        if run_id is None:
            cur.execute(sql)
        else:
            cur.execute(sql + " WHERE run_id = ?", (run_id,))
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
        self.conn.close()
