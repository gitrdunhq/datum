"""Tests for datum.memory.ledger and datum.memory.generic_chunker.

All tests run offline: real sqlite in tmp_path for ledger; pure string logic
for the chunker.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from datum.memory.generic_chunker import GenericChunker, TextChunk, _infer_type
from datum.memory.ledger import IngestionLedger

# ===========================================================================
# IngestionLedger
# ===========================================================================


class TestIngestionLedger:
    def _ledger(self, tmp_path: Path) -> IngestionLedger:
        return IngestionLedger(tmp_path / "ledger.db")

    # --- LedgerProtocol compliance ---

    def test_satisfies_ledger_protocol(self, tmp_path: Path) -> None:
        from datum.memory.ingest import LedgerProtocol

        ledger = self._ledger(tmp_path)
        assert isinstance(ledger, LedgerProtocol)
        ledger.close()

    # --- is_ingested ---

    def test_is_ingested_false_for_new_file(self, tmp_path: Path) -> None:
        ledger = self._ledger(tmp_path)
        assert not ledger.is_ingested("/some/file.md", "abc123")
        ledger.close()

    def test_is_ingested_true_after_record(self, tmp_path: Path) -> None:
        ledger = self._ledger(tmp_path)
        ledger.record_ingestion("/some/file.md", "sha_a", "doc", 5)
        assert ledger.is_ingested("/some/file.md", "sha_a")
        ledger.close()

    def test_different_sha256_not_ingested(self, tmp_path: Path) -> None:
        """Same path, different content hash → treated as new version."""
        ledger = self._ledger(tmp_path)
        ledger.record_ingestion("/f.md", "sha_v1", "doc", 3)
        assert not ledger.is_ingested("/f.md", "sha_v2")
        ledger.close()

    # --- record_ingestion idempotency ---

    def test_record_ingestion_twice_is_idempotent(self, tmp_path: Path) -> None:
        ledger = self._ledger(tmp_path)
        ledger.record_ingestion("/f.md", "sha1", "doc", 3)
        ledger.record_ingestion("/f.md", "sha1", "doc", 3)  # must not raise
        records = ledger.all_records()
        assert len(records) == 1
        ledger.close()

    def test_record_ingestion_updates_entries_written(self, tmp_path: Path) -> None:
        ledger = self._ledger(tmp_path)
        ledger.record_ingestion("/f.md", "sha1", "doc", 3)
        ledger.record_ingestion("/f.md", "sha1", "doc", 7)  # ON CONFLICT DO UPDATE
        records = ledger.all_records()
        assert records[0]["entries_written"] == 7
        ledger.close()

    # --- persistence across instances ---

    def test_ledger_survives_close_and_reopen(self, tmp_path: Path) -> None:
        db = tmp_path / "ledger.db"
        ledger_a = IngestionLedger(db)
        ledger_a.record_ingestion("/f.md", "sha1", "doc", 2)
        ledger_a.close()

        ledger_b = IngestionLedger(db)
        assert ledger_b.is_ingested("/f.md", "sha1")
        ledger_b.close()

    # --- stats ---

    def test_stats_returns_totals(self, tmp_path: Path) -> None:
        ledger = self._ledger(tmp_path)
        ledger.record_ingestion("/a.md", "sha_a", "doc", 4)
        ledger.record_ingestion("/b.md", "sha_b", "doc", 6)
        s = ledger.stats()
        assert s["total_files"] == 2
        assert s["total_entries"] == 10
        assert s["last_ingested"] is not None
        ledger.close()

    def test_stats_on_empty_db(self, tmp_path: Path) -> None:
        ledger = self._ledger(tmp_path)
        s = ledger.stats()
        assert s["total_files"] == 0
        ledger.close()

    # --- dedup use-case: force bypass ---

    def test_force_ingest_records_multiple_rows_for_same_sha(
        self, tmp_path: Path
    ) -> None:
        """When caller sets force=True it skips is_ingested; record_ingestion with same
        (path, sha) simply upserts (no duplicate rows due to PK)."""
        ledger = self._ledger(tmp_path)
        ledger.record_ingestion("/f.md", "sha1", "doc", 1)
        ledger.record_ingestion("/f.md", "sha1", "doc", 2)  # upsert
        assert len(ledger.all_records()) == 1
        assert ledger.all_records()[0]["entries_written"] == 2
        ledger.close()


# ===========================================================================
# GenericChunker — type inference
# ===========================================================================


class TestInferType:
    @pytest.mark.parametrize(
        ("source", "expected"),
        [
            ("README.md", "markdown"),
            ("docs/guide.MARKDOWN", "markdown"),
            ("config.toml", "toml"),
            ("specs/f70.TOML", "toml"),
            ("script.py", "text"),
            ("data.jsonl", "text"),
            ("", "text"),
        ],
    )
    def test_extensions(self, source: str, expected: str) -> None:
        assert _infer_type(source) == expected


# ===========================================================================
# GenericChunker — constructor validation
# ===========================================================================


class TestGenericChunkerInit:
    def test_zero_max_chars_raises(self) -> None:
        with pytest.raises(ValueError, match="max_chars"):
            GenericChunker(max_chars=0)

    def test_negative_overlap_raises(self) -> None:
        with pytest.raises(ValueError, match="overlap"):
            GenericChunker(max_chars=100, overlap=-1)

    def test_overlap_ge_max_chars_raises(self) -> None:
        with pytest.raises(ValueError, match="overlap"):
            GenericChunker(max_chars=100, overlap=100)


# ===========================================================================
# GenericChunker — empty / trivial input
# ===========================================================================


class TestGenericChunkerEmpty:
    def test_empty_string_returns_empty(self) -> None:
        c = GenericChunker()
        assert c.chunk("", "src") == []

    def test_whitespace_only_returns_empty(self) -> None:
        c = GenericChunker()
        assert c.chunk("   \n\t  ", "src") == []

    def test_chunk_returns_text_chunks(self) -> None:
        c = GenericChunker()
        results = c.chunk("hello world", "test")
        assert all(isinstance(r, TextChunk) for r in results)


# ===========================================================================
# GenericChunker — plain text windowing
# ===========================================================================


class TestGenericChunkerText:
    def test_short_text_is_single_chunk(self) -> None:
        c = GenericChunker(max_chars=200)
        chunks = c.chunk("short text", "src", content_type="text")
        assert len(chunks) == 1
        assert chunks[0].text == "short text"

    def test_long_text_is_windowed(self) -> None:
        c = GenericChunker(max_chars=50, overlap=10)
        long_text = "a" * 200
        chunks = c.chunk(long_text, "src", content_type="text")
        assert len(chunks) > 1
        for ch in chunks:
            assert len(ch.text) <= 50

    def test_chunk_ids_are_deterministic(self) -> None:
        c = GenericChunker()
        t = "deterministic content"
        ids_a = [ch.chunk_id for ch in c.chunk(t, "src")]
        ids_b = [ch.chunk_id for ch in c.chunk(t, "src")]
        assert ids_a == ids_b

    def test_chunk_ids_differ_for_different_text(self) -> None:
        c = GenericChunker()
        id_a = c.chunk("text_a", "src")[0].chunk_id
        id_b = c.chunk("text_b", "src")[0].chunk_id
        assert id_a != id_b

    def test_source_label_stored_in_chunk(self) -> None:
        c = GenericChunker()
        chunks = c.chunk("hello", "docs/guide.md")
        assert chunks[0].source == "docs/guide.md"


# ===========================================================================
# GenericChunker — markdown splitting
# ===========================================================================


class TestGenericChunkerMarkdown:
    MD = """# Introduction

This is the preamble text before any headers.

## Installation

Run the install command.

## Configuration

Set the config values.

### Sub-section

Details here.
"""

    def test_markdown_produces_multiple_chunks(self) -> None:
        c = GenericChunker()
        chunks = c.chunk(self.MD, "guide.md", content_type="markdown")
        assert len(chunks) >= 3

    def test_section_labels_come_from_headers(self) -> None:
        c = GenericChunker()
        chunks = c.chunk(self.MD, "guide.md", content_type="markdown")
        sections = {ch.section for ch in chunks}
        assert any("Installation" in s for s in sections)
        assert any("Configuration" in s for s in sections)

    def test_preamble_captured_separately(self) -> None:
        """Preamble text before the first header is captured with section='preamble'."""
        c = GenericChunker()
        md_with_preamble = "This is front matter text.\n\n" + self.MD
        chunks = c.chunk(md_with_preamble, "guide.md", content_type="markdown")
        sections = [ch.section for ch in chunks]
        assert "preamble" in sections

    def test_inferred_as_markdown_from_extension(self) -> None:
        c = GenericChunker()
        chunks_explicit = c.chunk(self.MD, "guide.md", content_type="markdown")
        chunks_inferred = c.chunk(self.MD, "guide.md")
        assert len(chunks_explicit) == len(chunks_inferred)

    def test_no_headers_falls_back_to_body(self) -> None:
        c = GenericChunker()
        chunks = c.chunk("plain content no headers", "src.md", content_type="markdown")
        assert chunks[0].section == "body"

    def test_long_section_is_windowed(self) -> None:
        long_section = "## Big Section\n\n" + ("word " * 400)
        c = GenericChunker(max_chars=100, overlap=10)
        chunks = c.chunk(long_section, "src.md", content_type="markdown")
        assert len(chunks) > 1
        for ch in chunks:
            assert len(ch.text) <= 100


# ===========================================================================
# GenericChunker — TOML splitting
# ===========================================================================


class TestGenericChunkerToml:
    TOML = """
# top-level comment

[task]
name = "test feature"
description = "build something"

[red]
prompt = "write failing test"
target_files = ["tests/test_foo.py"]

[green]
prompt = "make test pass"
target_files = ["datum/foo.py"]

[commit]
message = "feat: add foo"
"""

    def test_toml_splits_on_sections(self) -> None:
        c = GenericChunker()
        chunks = c.chunk(self.TOML, "spec.toml", content_type="toml")
        sections = {ch.section for ch in chunks}
        assert "task" in sections
        assert "red" in sections
        assert "green" in sections

    def test_toml_inferred_from_extension(self) -> None:
        c = GenericChunker()
        chunks = c.chunk(self.TOML, "spec.toml")
        assert len(chunks) >= 3

    def test_no_sections_falls_back_to_body(self) -> None:
        c = GenericChunker()
        chunks = c.chunk("key = 'value'\n", "src.toml", content_type="toml")
        assert chunks[0].section == "body"


# ===========================================================================
# GenericChunker — chunk_file
# ===========================================================================


class TestGenericChunkerFile:
    def test_chunk_file_reads_and_chunks(self, tmp_path: Path) -> None:
        f = tmp_path / "doc.md"
        f.write_text("## Hello\n\nworld content\n", encoding="utf-8")
        c = GenericChunker()
        chunks = c.chunk_file(f)
        assert len(chunks) >= 1
        assert any("world" in ch.text for ch in chunks)

    def test_chunk_file_uses_relative_label(self, tmp_path: Path) -> None:
        f = tmp_path / "doc.md"
        f.write_text("## Hello\n\ncontent\n", encoding="utf-8")
        c = GenericChunker()
        chunks = c.chunk_file(f, source_label="docs/doc.md")
        assert chunks[0].source == "docs/doc.md"

    def test_chunk_file_missing_returns_empty(self, tmp_path: Path) -> None:
        c = GenericChunker()
        chunks = c.chunk_file(tmp_path / "nonexistent.md")
        assert chunks == []

    def test_chunk_file_empty_file_returns_empty(self, tmp_path: Path) -> None:
        f = tmp_path / "empty.md"
        f.write_text("", encoding="utf-8")
        c = GenericChunker()
        assert c.chunk_file(f) == []
