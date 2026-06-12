"""IngestionLedger — sqlite-backed file-level dedup for the ingest pipeline.

Schema (single table):

    CREATE TABLE IF NOT EXISTS ingestion_ledger (
        path           TEXT NOT NULL,
        sha256         TEXT NOT NULL,
        artifact_type  TEXT NOT NULL DEFAULT '',
        entries_written INTEGER NOT NULL DEFAULT 0,
        ingested_at    TEXT NOT NULL,   -- ISO-8601 UTC
        PRIMARY KEY (path, sha256)
    )

The PRIMARY KEY on (path, sha256) means: if the same file path re-appears
with a *different* sha256, it is treated as a new ingestion (the old row is
kept as history; only is_ingested checks for the exact (path, sha256) pair).

Satisfies LedgerProtocol from datum.memory.ingest.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_DDL = """
CREATE TABLE IF NOT EXISTS ingestion_ledger (
    path            TEXT NOT NULL,
    sha256          TEXT NOT NULL,
    artifact_type   TEXT NOT NULL DEFAULT '',
    entries_written INTEGER NOT NULL DEFAULT 0,
    ingested_at     TEXT NOT NULL,
    PRIMARY KEY (path, sha256)
)
"""


def _now_utc() -> str:
    return datetime.now(tz=UTC).isoformat()


class IngestionLedger:
    """Sqlite-backed ingestion dedup store.

    Args:
        db_path: Path to the sqlite database file.  Parent directory must
                 exist (or will be created by the caller).

    The ledger is opened lazily on first use so construction never fails due
    to permissions — errors surface on the first actual read or write.
    """

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._conn: sqlite3.Connection | None = None

    # ------------------------------------------------------------------ #
    # Connection management                                                #
    # ------------------------------------------------------------------ #

    def _connect(self) -> sqlite3.Connection:
        if self._conn is None:
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(self._db_path))
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute(_DDL)
            self._conn.commit()
        return self._conn

    def close(self) -> None:
        """Close the database connection (idempotent)."""
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    # ------------------------------------------------------------------ #
    # LedgerProtocol implementation                                        #
    # ------------------------------------------------------------------ #

    def is_ingested(self, path: str, sha256: str) -> bool:
        """Return True if (path, sha256) has already been recorded."""
        conn = self._connect()
        row = conn.execute(
            "SELECT 1 FROM ingestion_ledger WHERE path = ? AND sha256 = ? LIMIT 1",
            (path, sha256),
        ).fetchone()
        return row is not None

    def record_ingestion(
        self,
        path: str,
        sha256: str,
        artifact_type: str,
        entries_written: int,
    ) -> None:
        """Insert or replace the ledger record for (path, sha256)."""
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO ingestion_ledger
                (path, sha256, artifact_type, entries_written, ingested_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(path, sha256) DO UPDATE SET
                artifact_type   = excluded.artifact_type,
                entries_written = excluded.entries_written,
                ingested_at     = excluded.ingested_at
            """,
            (path, sha256, artifact_type, entries_written, _now_utc()),
        )
        conn.commit()

    # ------------------------------------------------------------------ #
    # Query helpers                                                        #
    # ------------------------------------------------------------------ #

    def stats(self) -> dict[str, Any]:
        """Return a summary dict for CLI status display."""
        conn = self._connect()
        row = conn.execute("""
            SELECT
                COUNT(*) AS total_files,
                SUM(entries_written) AS total_entries,
                MAX(ingested_at) AS last_ingested
            FROM ingestion_ledger
            """).fetchone()
        return dict(row) if row else {}

    def all_records(self) -> list[dict[str, Any]]:
        """Return all ledger rows as dicts (for testing / introspection)."""
        conn = self._connect()
        rows = conn.execute(
            "SELECT path, sha256, artifact_type, entries_written, ingested_at "
            "FROM ingestion_ledger ORDER BY ingested_at"
        ).fetchall()
        return [dict(r) for r in rows]
