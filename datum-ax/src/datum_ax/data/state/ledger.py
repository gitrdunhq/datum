import sqlite3
from typing import Any


class LibSQLLedger:
    """Adapter for the libSQL ledger (ADR-0005/0013).
    Durable run trace, token metering, and telemetry.
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
                    node TEXT NOT NULL,
                    model_id TEXT,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    duration_s REAL
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
    ) -> None:
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO trace (node, model_id, input_tokens, output_tokens, duration_s)
                VALUES (?, ?, ?, ?, ?)
                """,
                (node, model_id, input_tokens, output_tokens, duration_s),
            )

    def get_trace(self) -> list[dict[str, Any]]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM trace ORDER BY id ASC")
        return [dict(row) for row in cursor.fetchall()]
