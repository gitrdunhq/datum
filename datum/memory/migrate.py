"""Schema migration registry and one-time JSONL → SQLite migration.

Usage:
    from datum.memory.migrate_wfc import migrate_jsonl_to_sqlite
    migrate_jsonl_to_sqlite(old_dir=Path("datum/memory"), db_path=Path("~/.datum/projects/datum/memory/memory.db"))

    # Registered automatically from MemoryStore.__init__
    from datum.memory.migrate_wfc import run_migrations, EXPECTED_SCHEMA_VERSION

`MemoryStore` is imported lazily inside the function bodies to break the
circular import: `store.py` imports `EXPECTED_SCHEMA_VERSION` and
`run_migrations` at module level so that init-time schema stamping has
access to the registry.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

from datum.shared.logging import get_logger

if TYPE_CHECKING:
    from .store import MemoryStore

logger = get_logger(__name__)

# Schema version the current DDL produces. Bump when a migration is added.
EXPECTED_SCHEMA_VERSION: int = 4

# Registry of schema migrations. Keys are the TARGET version a migration
# produces. Values are callables that mutate the sqlite3 connection in place.
# MIGRATIONS[2] adds the ingested_artifacts table for the memory backfill engine.
MIGRATIONS: dict[int, Callable[[sqlite3.Connection], None]] = {}


class SchemaMigrationError(RuntimeError):
    """Raised when the migration registry cannot safely reach the target version."""


def _upgrade_to_v2(conn: sqlite3.Connection) -> None:
    """v1 → v2: add ingested_artifacts table for memory backfill deduplication.

    Schema MUST match IngestionLedger._DDL in ledger.py — single source of truth.
    """
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ingested_artifacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            artifact_type TEXT NOT NULL,
            entries_written INTEGER DEFAULT 0,
            ingested_at TEXT DEFAULT (datetime('now')),
            UNIQUE(path, sha256)
        );
        CREATE INDEX IF NOT EXISTS idx_ingested_path ON ingested_artifacts(path);
        """)


MIGRATIONS[2] = _upgrade_to_v2


def _upgrade_to_v3(conn: sqlite3.Connection) -> None:
    """v2 → v3: rebuild ingested_artifacts with correct schema.

    Drops the v2 table (which used entries_written and lacked scope) and
    recreates it with the canonical columns used by MemoryStore ledger methods:
    scope, entries_created, entries_deduped. PRIMARY KEY on (path, sha256).
    Safe because the table has never been populated by production backfill runs.
    """
    conn.executescript("""
        DROP TABLE IF EXISTS ingested_artifacts;
        CREATE TABLE ingested_artifacts (
            path TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            ingested_at TEXT DEFAULT (datetime('now')),
            artifact_type TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT '',
            entries_created INTEGER DEFAULT 0,
            entries_deduped INTEGER DEFAULT 0,
            PRIMARY KEY (path, sha256)
        );
        CREATE INDEX IF NOT EXISTS idx_ingested_path ON ingested_artifacts(path);
        """)


MIGRATIONS[3] = _upgrade_to_v3


def _reflexion_has_column(conn: sqlite3.Connection, column: str) -> bool:
    """Check whether the reflexion table already has a given column."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(reflexion)").fetchall()}
    return column in cols


def _upgrade_to_v4(conn: sqlite3.Connection) -> None:
    """v3 → v4: reflexion dedup, hit counting, and entry type classification.

    Adds hit_count, last_seen, entry_type columns. Backfills entry_type from
    rule patterns. Collapses duplicate rows by (rule, evidence prefix),
    summing hit_count and keeping the latest created_at.
    """
    if not _reflexion_has_column(conn, "hit_count"):
        conn.execute("ALTER TABLE reflexion ADD COLUMN hit_count INTEGER DEFAULT 1")
    if not _reflexion_has_column(conn, "last_seen"):
        conn.execute("ALTER TABLE reflexion ADD COLUMN last_seen TEXT")
    if not _reflexion_has_column(conn, "entry_type"):
        conn.execute(
            "ALTER TABLE reflexion ADD COLUMN entry_type TEXT DEFAULT 'hook_event'"
        )

    conn.execute("UPDATE reflexion SET last_seen = created_at WHERE last_seen IS NULL")

    conn.execute(
        "UPDATE reflexion SET entry_type = 'review_finding' WHERE rule LIKE 'review-finding%'"
    )
    conn.execute(
        "UPDATE reflexion SET entry_type = 'plan_entry' WHERE rule = 'plan-generated'"
    )

    conn.execute("""
        UPDATE reflexion SET hit_count = (
            SELECT COUNT(*) FROM reflexion AS r2
            WHERE r2.rule = reflexion.rule
            AND SUBSTR(r2.evidence, 1, 200) = SUBSTR(reflexion.evidence, 1, 200)
        ), last_seen = (
            SELECT MAX(r2.created_at) FROM reflexion AS r2
            WHERE r2.rule = reflexion.rule
            AND SUBSTR(r2.evidence, 1, 200) = SUBSTR(reflexion.evidence, 1, 200)
        )
    """)

    conn.execute("""
        DELETE FROM reflexion WHERE id NOT IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY rule, SUBSTR(evidence, 1, 200)
                    ORDER BY created_at DESC
                ) AS rn
                FROM reflexion
            ) WHERE rn = 1
        )
    """)

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_reflexion_entry_type ON reflexion(entry_type)"
    )


MIGRATIONS[4] = _upgrade_to_v4


def get_expected_schema_version() -> int:
    """Public accessor for `EXPECTED_SCHEMA_VERSION`.

    Exists so consumers can fetch the constant without importing the module
    attribute directly, which keeps the import surface explicit.
    """
    return EXPECTED_SCHEMA_VERSION


def get_schema_version(store: MemoryStore) -> int:
    """Return the stored schema version via SQLite `PRAGMA user_version`.

    A fresh SQLite database reports 0 until a migration sets the pragma.
    Uses the public `MemoryStore.user_version` property instead  # planning-id-ok
    of reaching into `_conn`.
    """
    return store.user_version


def _require_store_connection(store: MemoryStore) -> sqlite3.Connection | None:
    """Return the underlying sqlite connection when the store exposes one."""

    conn = getattr(store, "_conn", None)
    return conn if isinstance(conn, sqlite3.Connection) else None


def _apply_migration_step(
    store: MemoryStore,
    *,
    version: int,
    migrator: Callable[[sqlite3.Connection], None],
) -> None:
    """Apply one migration and stamp its version atomically when possible."""

    conn = _require_store_connection(store)
    if conn is None:
        store.apply_migration(migrator)
        store.set_user_version(version)
        return

    conn.execute("BEGIN IMMEDIATE")
    try:
        store.apply_migration(migrator)
        conn.execute(  # nosemgrep: sql-injection, subprocess-f-string-sql, formatted-sql-query, sqlalchemy-execute-raw-query -- int()-cast version constant, no user input
            f"PRAGMA user_version = {int(version)}"
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def _expected_path_versions(current: int, target: int) -> list[int]:
    """Return the required migration versions from current to target.

    Version 0 is the unstamped bootstrap state after the base DDL has already
    created the v1 shape, so the first required migration is version 2.
    """

    baseline = 1 if current == 0 else current
    return list(range(baseline + 1, target + 1))


def run_migrations(store: MemoryStore) -> int:
    """Bring the store up to `EXPECTED_SCHEMA_VERSION`.

    Reads the current `PRAGMA user_version`, runs any registered migration
    whose target version is greater than current and less than or equal to
    `EXPECTED_SCHEMA_VERSION`, stamping `user_version` after each one. If no
    migrations apply and the store is below `EXPECTED_SCHEMA_VERSION`, the
    store is stamped directly to `EXPECTED_SCHEMA_VERSION` — Phase 0 has no
    real v0→v1 upgrade, the DDL already produces the v1 shape, so the stamp
    alone is semantically correct.

    Returns the final schema version after migrations complete.

    Idempotent: calling on an already-current store is a no-op.
    """
    current = get_schema_version(store)
    target = EXPECTED_SCHEMA_VERSION

    if current >= target:
        return current

    path_versions = _expected_path_versions(current, target)
    if not path_versions:
        store.set_user_version(target)
        return target

    missing_versions = [
        version for version in path_versions if version not in MIGRATIONS
    ]
    if missing_versions:
        raise SchemaMigrationError(
            "Migration gap: "
            f"current={current} target={target} "
            f"missing={missing_versions} registry={sorted(MIGRATIONS)}"
        )

    for version in path_versions:
        logger.info("run_migrations: applying v%d → v%d", current, version)
        _apply_migration_step(store, version=version, migrator=MIGRATIONS[version])
        current = version

    return current


def _read_jsonl(jsonl_file: Path) -> list[dict]:
    """Read all valid JSON records from a JSONL file, skipping malformed lines."""
    records: list[dict] = []
    with open(jsonl_file, encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                logger.warning(
                    "migrate: skipping malformed line %d in %s: %s",
                    lineno,
                    jsonl_file.name,
                    exc,
                )
    return records


def migrate_jsonl_to_sqlite(old_dir: Path, db_path: Path) -> dict[str, int]:
    """Import all JSONL records from old_dir into a MemoryStore at db_path.

    Returns counts: {"reflexion": N, "metrics": N, "patterns": N}.
    Idempotent — safe to run multiple times. Reflexion entries use UNIQUE constraint
    for dedup. Metric entries use INSERT OR IGNORE with UNIQUE(timestamp, task_id, complexity).

    Uses batch_log_reflexion() and batch_log_metrics() for bulk imports (single
    transaction per table) rather than per-row inserts.
    """
    # Lazy import to break the module-level circular dep with store.py.
    from .store import MemoryStore

    counts: dict[str, int] = {"reflexion": 0, "metrics": 0, "patterns": 0}
    old_dir = Path(old_dir).expanduser()
    if not old_dir.exists():
        logger.info("migrate: old_dir %s does not exist, nothing to migrate", old_dir)
        return counts

    with MemoryStore(Path(db_path).expanduser()) as store:
        reflexion_file = old_dir / "reflexion.jsonl"
        if reflexion_file.exists():
            records = _read_jsonl(reflexion_file)
            if records:
                counts["reflexion"] = store.batch_log_reflexion(records)

        metrics_file = old_dir / "workflow_metrics.jsonl"
        if metrics_file.exists():
            records = _read_jsonl(metrics_file)
            if records:
                counts["metrics"] = store.batch_log_metrics(records)

        patterns_file = old_dir / "operational_patterns.jsonl"
        if patterns_file.exists():
            records = _read_jsonl(patterns_file)
            for record in records:
                try:
                    store.save_pattern(record)
                    counts["patterns"] += 1
                except KeyError as exc:
                    logger.warning(
                        "migrate: skipping pattern with missing key: %s", exc
                    )

    logger.info("migrate: imported %s", counts)
    return counts


def migrate_knowledge_to_chromadb(
    reviewers_dir: Path,
    store_dir: Path,
    engine_kwargs: dict[str, Any] | None = None,
) -> dict[str, int]:
    """Index all KNOWLEDGE.md files from reviewers_dir into ChromaDB.

    For each reviewer subdirectory that contains a KNOWLEDGE.md, chunks the
    file using KnowledgeChunker and upserts all chunks into a ChromaDB
    collection named ``reviewer_{reviewer_id}``.  The original KNOWLEDGE.md
    files are never deleted or modified.

    Idempotent: ChromaDB upsert semantics mean running twice produces the same
    result as running once (chunk IDs are deterministic SHA-256 prefixes).

    Args:
        reviewers_dir: Path to the directory containing reviewer sub-dirs.
        store_dir: Path passed to ``RAGEngine`` as ``store_dir``.
        engine_kwargs: Extra keyword arguments forwarded to ``RAGEngine``
            (e.g. ``{"embedding_provider": FakeProvider()}`` for tests).

    Returns:
        Dict mapping reviewer_id to the number of chunks indexed.
        Reviewers without a KNOWLEDGE.md are omitted from the result.
    """
    from datum.memory.rag_engine import RAGEngine

    reviewers_dir = Path(reviewers_dir).expanduser()
    store_dir = Path(store_dir).expanduser()

    if not reviewers_dir.is_dir():
        logger.info(
            "migrate_knowledge_to_chromadb: reviewers_dir %s does not exist, nothing to do",
            reviewers_dir,
        )
        return {}

    kwargs: dict[str, Any] = engine_kwargs or {}
    engine = RAGEngine(store_dir=store_dir, **kwargs)

    counts: dict[str, int] = {}
    for reviewer_dir in sorted(reviewers_dir.iterdir()):
        if not reviewer_dir.is_dir():
            continue
        knowledge_path = reviewer_dir / "KNOWLEDGE.md"
        if not knowledge_path.is_file():
            continue
        reviewer_id = reviewer_dir.name
        indexed = engine.index(reviewer_id, knowledge_path)
        counts[reviewer_id] = indexed
        logger.info(
            "migrate_knowledge_to_chromadb: indexed %d chunks for reviewer %s",
            indexed,
            reviewer_id,
        )

    logger.info("migrate_knowledge_to_chromadb: finished %s", counts)
    return counts
