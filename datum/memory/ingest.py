"""IngestEngine — walks dev artifact directories and feeds entries into ChromaDB.

Responsibilities:
  1. Parser registry: maps artifact types to parser callables.
  2. Scope classifier: pure function that decides global vs project scope.
  3. ingest_file: SHA-256 dedup via IngestionLedger, parses, writes to vector store.
  4. ingest_directory: walks a tree, filters by merged branches, aggregates results.

The engine accepts any object that satisfies the ledger protocol
(is_ingested / record_ingestion). In production this is IngestionLedger.
In tests it can be a MagicMock.
"""

from __future__ import annotations

import hashlib
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Scope classification constants — PROP-003 deterministic rules
# ---------------------------------------------------------------------------

_GLOBAL_CATEGORIES: frozenset[str] = frozenset(
    {"security", "correctness", "performance", "reliability"}
)
_GLOBAL_SEVERITY_THRESHOLD: int = 7


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class ParsedEntry:
    """A single unit extracted from an artifact file."""

    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class IngestResult:
    """Result of ingesting a single file."""

    path: str
    skipped: bool
    artifact_type: str = ""
    entries_written: int = 0
    parse_error: bool = False


@dataclass
class BatchResult:
    """Aggregated result of ingesting a directory."""

    files_processed: int = 0
    files_skipped: int = 0
    total_entries_written: int = 0
    errors: int = 0


# ---------------------------------------------------------------------------
# Ledger protocol — satisfied by IngestionLedger and test mocks
# ---------------------------------------------------------------------------


@runtime_checkable
class LedgerProtocol(Protocol):
    """Contract for ingestion dedup stores. Satisfied by IngestionLedger and test mocks."""

    def is_ingested(self, path: str, sha256: str) -> bool: ...

    def record_ingestion(
        self, path: str, sha256: str, artifact_type: str, entries_written: int
    ) -> None: ...


# ---------------------------------------------------------------------------
# Pure scope classifier — PROP-003 no I/O, no randomness
# ---------------------------------------------------------------------------


def classify_scope(
    artifact_type: str,
    parsed_data: dict[str, Any],
    project_name: str = "datum",
) -> str:
    """Return the scope string for a parsed entry.

    Rules (PROP-003 — must be deterministic):
      - artifact_type == "pattern" → "global"
      - artifact_type == "review"
          AND severity >= 7
          AND category in {security, correctness, performance, reliability}
        → "global"
      - everything else → "project:{project_name}"
    """
    if artifact_type == "pattern":
        return "global"

    if artifact_type == "review":
        severity = parsed_data.get("severity", 0)
        categories = parsed_data.get("categories", [])
        if isinstance(categories, str):
            categories = [categories]
        if (
            isinstance(severity, (int, float))
            and severity >= _GLOBAL_SEVERITY_THRESHOLD
            and any(c in _GLOBAL_CATEGORIES for c in categories)
        ):
            return "global"

    return f"project:{project_name}"


# ---------------------------------------------------------------------------
# Artifact type detection
# ---------------------------------------------------------------------------

_TYPE_PATTERNS: list[tuple[str, str]] = [
    ("review", "REVIEW-"),
    ("agent_report", "agent-report"),
    ("plan", "TASKS.md"),
    ("task_history", "task_history.jsonl"),
]

_UUID_JSONL_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$",
    re.IGNORECASE,
)


def _is_session_jsonl(name: str) -> bool:
    """Return True if filename matches the UUID.jsonl pattern of session logs."""
    return _UUID_JSONL_RE.match(name) is not None


def _detect_artifact_type(path: Path) -> str:
    """Return a string artifact type based on filename patterns."""
    name = path.name
    for artifact_type, pattern in _TYPE_PATTERNS:
        if pattern in name:
            return artifact_type
    if _is_session_jsonl(name):
        return "agent_output"
    return "doc"


# ---------------------------------------------------------------------------
# IngestEngine
# ---------------------------------------------------------------------------


class IngestEngine:
    """Walks artifact directories and writes parsed entries into the vector store.

    The engine is deliberately decoupled from ChromaDB — callers supply a
    vector_store callable (or None to skip vector writes) and a ledger that
    satisfies LedgerProtocol.
    """

    def __init__(
        self,
        store: LedgerProtocol,
        project_name: str,
        vector_writer: Callable[[str, ParsedEntry], None] | None = None,
        force: bool = False,
    ) -> None:
        """
        Args:
            store: Object satisfying LedgerProtocol (IngestionLedger or mock).
            project_name: Repo/project name used in scope strings.
            vector_writer: Optional callable(scope, entry) that writes to ChromaDB.
                           When None, vector writes are skipped (ledger-only mode).
            force: When True, bypass ledger checks and re-ingest everything.
        """
        self._store = store
        self._project_name = project_name
        self._vector_writer = vector_writer
        self._force = force
        self._parsers: dict[str, Callable[[Path], list[ParsedEntry]]] = {}

    # ------------------------------------------------------------------
    # Parser registry
    # ------------------------------------------------------------------

    def register_parser(
        self, artifact_type: str, parser_fn: Callable[[Path], list[ParsedEntry]]
    ) -> None:
        """Register a parser function for a given artifact type."""
        self._parsers[artifact_type] = parser_fn

    def get_parser(self, artifact_type: str) -> Callable[[Path], list[ParsedEntry]] | None:
        """Return the registered parser for artifact_type, or None."""
        return self._parsers.get(artifact_type)

    # ------------------------------------------------------------------
    # Artifact type detection (thin wrapper around module function)
    # ------------------------------------------------------------------

    def detect_artifact_type(self, path: Path) -> str:
        """Return artifact type string for path (delegates to module-level detector)."""
        return _detect_artifact_type(path)

    # ------------------------------------------------------------------
    # Core ingestion
    # ------------------------------------------------------------------

    def ingest_file(self, path: Path) -> IngestResult:
        """Ingest a single file into the vector store.

        Steps:
          1. SHA-256 hash the file.
          2. Check ledger — skip if already ingested.
          3. Detect artifact type, call registered parser.
          4. For each entry: classify scope, write via vector_writer.
          5. Record ingestion in ledger.
        """
        content = path.read_bytes()
        sha256 = hashlib.sha256(content).hexdigest()  # pragma: allowlist secret
        path_str = str(path)
        artifact_type = self.detect_artifact_type(path)

        if not self._force and self._store.is_ingested(path_str, sha256):
            return IngestResult(path=path_str, skipped=True, artifact_type=artifact_type)

        parser = self._parsers.get(artifact_type)
        entries: list[ParsedEntry] = []
        parse_failed = False
        if parser is not None:
            try:
                entries = parser(path)
            except (OSError, KeyError, ValueError, TypeError, RuntimeError):
                logger.warning(
                    "Parser failed for %s (%s), skipping entries",
                    path,
                    artifact_type,
                    exc_info=True,
                )
                entries = []
                parse_failed = True

        if parse_failed:
            return IngestResult(
                path=path_str, skipped=False, artifact_type=artifact_type, parse_error=True
            )

        written = 0
        if self._vector_writer is not None:
            for entry in entries:
                scope = classify_scope(artifact_type, entry.metadata, self._project_name)
                try:
                    self._vector_writer(scope, entry)
                    written += 1
                except (OSError, RuntimeError, ValueError):
                    logger.warning("Vector write failed for entry in %s", path, exc_info=True)

        self._store.record_ingestion(path_str, sha256, artifact_type, written)
        return IngestResult(
            path=path_str,
            skipped=False,
            artifact_type=artifact_type,
            entries_written=written,
        )

    def ingest_directory(
        self,
        root_path: Path,
        merged_branches: set[str],
    ) -> BatchResult:
        """Walk root_path and ingest all eligible artifact files.

        Args:
            root_path: Directory to walk recursively.
            merged_branches: Set of merged branch names. When non-empty, only
                             paths that contain one of these names are processed.
                             An empty set disables branch filtering (process all).
        """
        result = BatchResult()
        resolved_root = root_path.resolve()
        for candidate in sorted(root_path.rglob("*")):
            if not candidate.is_file():
                continue
            if not candidate.resolve().is_relative_to(resolved_root):
                logger.warning("Skipping symlink outside scope: %s", candidate)
                continue
            if merged_branches and not _path_matches_branches(candidate, merged_branches):
                continue
            file_result = self.ingest_file(candidate)
            if file_result.skipped:
                result.files_skipped += 1
            elif file_result.parse_error:
                result.errors += 1
            else:
                result.files_processed += 1
                result.total_entries_written += file_result.entries_written

        return result


# ---------------------------------------------------------------------------
# Branch filter helper
# ---------------------------------------------------------------------------


def _path_matches_branches(path: Path, merged_branches: set[str]) -> bool:
    """Return True if any part of path matches a merged branch name."""
    parts = path.parts
    return any(branch in parts for branch in merged_branches)
