"""Tests for datum.memory.ingest — pure logic and the IngestEngine.

No network, no vector store: the engine's seams (LedgerProtocol,
vector_writer callable, parser registry) are exercised with in-memory
fakes and tmp_path files.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from datum.memory.ingest import (
    IngestEngine,
    LedgerProtocol,
    ParsedEntry,
    classify_scope,
)

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeLedger:
    """In-memory LedgerProtocol implementation."""

    def __init__(self) -> None:
        self.records: list[tuple[str, str, str, int]] = []
        self._seen: set[tuple[str, str]] = set()

    def is_ingested(self, path: str, sha256: str) -> bool:
        return (path, sha256) in self._seen

    def record_ingestion(
        self, path: str, sha256: str, artifact_type: str, entries_written: int
    ) -> None:
        self.records.append((path, sha256, artifact_type, entries_written))
        self._seen.add((path, sha256))


def _doc_parser(path: Path) -> list[ParsedEntry]:
    return [ParsedEntry(text=path.read_text())]


# ---------------------------------------------------------------------------
# classify_scope — pure, deterministic (PROP-003)
# ---------------------------------------------------------------------------


class TestClassifyScope:
    def test_pattern_is_always_global(self) -> None:
        assert classify_scope("pattern", {}) == "global"

    @pytest.mark.parametrize(
        "category", ["security", "correctness", "performance", "reliability"]
    )
    def test_high_severity_review_in_global_category_is_global(
        self, category: str
    ) -> None:
        parsed = {"severity": 7, "categories": [category]}
        assert classify_scope("review", parsed) == "global"

    def test_high_severity_review_in_other_category_is_project(self) -> None:
        parsed = {"severity": 9, "categories": ["style"]}
        assert classify_scope("review", parsed) == "project:datum"

    def test_low_severity_security_review_is_project(self) -> None:
        parsed = {"severity": 6, "categories": ["security"]}
        assert classify_scope("review", parsed) == "project:datum"

    def test_categories_accepts_bare_string(self) -> None:
        parsed = {"severity": 8, "categories": "security"}
        assert classify_scope("review", parsed) == "global"

    def test_non_numeric_severity_is_project(self) -> None:
        parsed = {"severity": "high", "categories": ["security"]}
        assert classify_scope("review", parsed) == "project:datum"

    def test_other_types_use_project_name(self) -> None:
        assert classify_scope("doc", {}, project_name="acme") == "project:acme"


# ---------------------------------------------------------------------------
# Artifact type detection
# ---------------------------------------------------------------------------


class TestDetectArtifactType:
    @pytest.fixture()
    def engine(self) -> IngestEngine:
        return IngestEngine(store=FakeLedger(), project_name="datum")

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("REVIEW-2026-06-11.md", "review"),
            ("agent-report-lane3.json", "agent_report"),
            ("TASKS.md", "plan"),
            ("task_history.jsonl", "task_history"),
            ("0d4f19c3-3336-41fd-806a-334a5d573667.jsonl", "agent_output"),
            ("0D4F19C3-3336-41FD-806A-334A5D573667.jsonl", "agent_output"),
            ("notes.md", "doc"),
            ("not-a-uuid.jsonl", "doc"),
        ],
    )
    def test_filename_patterns(
        self, engine: IngestEngine, name: str, expected: str
    ) -> None:
        assert engine.detect_artifact_type(Path(name)) == expected


# ---------------------------------------------------------------------------
# IngestEngine.ingest_file
# ---------------------------------------------------------------------------


class TestIngestFile:
    def test_fake_ledger_satisfies_protocol(self) -> None:
        assert isinstance(FakeLedger(), LedgerProtocol)

    def test_new_file_is_parsed_written_and_recorded(self, tmp_path: Path) -> None:
        ledger = FakeLedger()
        written: list[tuple[str, ParsedEntry]] = []
        engine = IngestEngine(
            store=ledger,
            project_name="datum",
            vector_writer=lambda scope, entry: written.append((scope, entry)),
        )
        engine.register_parser("doc", _doc_parser)
        doc = tmp_path / "notes.md"
        doc.write_text("remember this")

        result = engine.ingest_file(doc)

        assert not result.skipped
        assert result.artifact_type == "doc"
        assert result.entries_written == 1
        assert written == [("project:datum", ParsedEntry(text="remember this"))]
        assert len(ledger.records) == 1
        assert ledger.records[0][3] == 1  # entries_written persisted

    def test_already_ingested_file_is_skipped(self, tmp_path: Path) -> None:
        ledger = FakeLedger()
        engine = IngestEngine(store=ledger, project_name="datum")
        engine.register_parser("doc", _doc_parser)
        doc = tmp_path / "notes.md"
        doc.write_text("once only")

        first = engine.ingest_file(doc)
        second = engine.ingest_file(doc)

        assert not first.skipped
        assert second.skipped
        assert len(ledger.records) == 1

    def test_force_bypasses_ledger_dedup(self, tmp_path: Path) -> None:
        ledger = FakeLedger()
        engine = IngestEngine(store=ledger, project_name="datum", force=True)
        engine.register_parser("doc", _doc_parser)
        doc = tmp_path / "notes.md"
        doc.write_text("again and again")

        engine.ingest_file(doc)
        result = engine.ingest_file(doc)

        assert not result.skipped
        assert len(ledger.records) == 2

    def test_parser_failure_reports_error_and_records_nothing(
        self, tmp_path: Path
    ) -> None:
        ledger = FakeLedger()
        engine = IngestEngine(store=ledger, project_name="datum")

        def _broken(_path: Path) -> list[ParsedEntry]:
            raise ValueError("malformed artifact")

        engine.register_parser("doc", _broken)
        doc = tmp_path / "notes.md"
        doc.write_text("unparseable")

        result = engine.ingest_file(doc)

        assert result.parse_error
        assert not result.skipped
        assert result.entries_written == 0
        assert ledger.records == []  # failed parses must stay re-ingestable

    def test_vector_write_failure_does_not_abort_remaining_entries(
        self, tmp_path: Path
    ) -> None:
        ledger = FakeLedger()
        calls: list[str] = []

        def _flaky_writer(scope: str, entry: ParsedEntry) -> None:
            calls.append(entry.text)
            if entry.text == "bad":
                raise RuntimeError("vector store hiccup")

        def _multi_parser(_path: Path) -> list[ParsedEntry]:
            return [ParsedEntry(text="bad"), ParsedEntry(text="good")]

        engine = IngestEngine(
            store=ledger, project_name="datum", vector_writer=_flaky_writer
        )
        engine.register_parser("doc", _multi_parser)
        doc = tmp_path / "notes.md"
        doc.write_text("x")

        result = engine.ingest_file(doc)

        assert calls == ["bad", "good"]
        assert result.entries_written == 1
        assert ledger.records[0][3] == 1

    def test_unregistered_type_writes_nothing_but_records(self, tmp_path: Path) -> None:
        ledger = FakeLedger()
        engine = IngestEngine(store=ledger, project_name="datum")
        doc = tmp_path / "notes.md"
        doc.write_text("no parser for docs")

        result = engine.ingest_file(doc)

        assert not result.skipped
        assert result.entries_written == 0
        assert len(ledger.records) == 1


# ---------------------------------------------------------------------------
# IngestEngine.ingest_directory
# ---------------------------------------------------------------------------


class TestIngestDirectory:
    def _engine(self) -> tuple[IngestEngine, FakeLedger]:
        ledger = FakeLedger()
        engine = IngestEngine(store=ledger, project_name="datum")
        engine.register_parser("doc", _doc_parser)
        return engine, ledger

    def test_empty_branch_set_processes_everything(self, tmp_path: Path) -> None:
        engine, _ = self._engine()
        (tmp_path / "a.md").write_text("one")
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "b.md").write_text("two")

        result = engine.ingest_directory(tmp_path, merged_branches=set())

        assert result.files_processed == 2
        assert result.files_skipped == 0
        assert result.errors == 0

    def test_branch_filter_only_processes_matching_paths(self, tmp_path: Path) -> None:
        engine, ledger = self._engine()
        (tmp_path / "feat-x").mkdir()
        (tmp_path / "feat-x" / "a.md").write_text("merged work")
        (tmp_path / "feat-y").mkdir()
        (tmp_path / "feat-y" / "b.md").write_text("unmerged work")

        result = engine.ingest_directory(tmp_path, merged_branches={"feat-x"})

        assert result.files_processed == 1
        assert len(ledger.records) == 1
        assert "feat-x" in ledger.records[0][0]

    def test_aggregates_skips_and_errors(self, tmp_path: Path) -> None:
        ledger = FakeLedger()
        engine = IngestEngine(store=ledger, project_name="datum")

        def _broken(_path: Path) -> list[ParsedEntry]:
            raise ValueError("nope")

        engine.register_parser("review", _broken)
        engine.register_parser("doc", _doc_parser)
        (tmp_path / "REVIEW-1.md").write_text("bad")
        (tmp_path / "good.md").write_text("good")

        first = engine.ingest_directory(tmp_path, merged_branches=set())
        second = engine.ingest_directory(tmp_path, merged_branches=set())

        assert first.files_processed == 1
        assert first.errors == 1
        # good.md deduped on second pass; broken review errors again.
        assert second.files_skipped == 1
        assert second.errors == 1
