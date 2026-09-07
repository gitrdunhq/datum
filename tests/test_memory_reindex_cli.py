"""Tests for `datum memory reindex` and `datum memory delete-chunks` CLI subcommands.

Both wire up existing-but-unwired RAGEngine methods (index_all/reindex_all/
delete_chunks) that previously had no CLI entry point, despite RAGEngine's own
error messages telling users to run `datum memory reindex` to rebuild embeddings.

Acceptance criteria:
1. `memory reindex` with no reviewers/ directory drops zero collections and
   indexes zero reviewers, exits 0.
2. `memory reindex` with a reviewers/<id>/KNOWLEDGE.md present indexes it and
   reports a nonzero chunk count for that reviewer.
3. `memory delete-chunks` removes the given chunk ids from a reviewer's
   collection and reports the deleted count.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from typer.testing import CliRunner

from datum.cli import app


def test_memory_reindex_with_no_reviewers_dir(tmp_path, monkeypatch):
    """AC1: no reviewers/ dir -> zero dropped, zero indexed, exit 0."""
    monkeypatch.chdir(tmp_path)

    runner = CliRunner()
    result = runner.invoke(app, ["memory", "reindex", "--repo", str(tmp_path)])

    assert result.exit_code == 0, result.output
    data = json.loads(re.search(r"\{.*\}", result.output).group(0))
    assert data["dropped_collections"] == 0
    assert data["indexed"] == {}


def test_memory_reindex_indexes_reviewer_knowledge(tmp_path, monkeypatch):
    """AC2: a reviewers/<id>/KNOWLEDGE.md gets indexed with a nonzero chunk count."""
    monkeypatch.chdir(tmp_path)
    reviewers_dir = tmp_path / "reviewers" / "security"
    reviewers_dir.mkdir(parents=True)
    (reviewers_dir / "KNOWLEDGE.md").write_text(
        "## Patterns Found\n"
        "- [2026-01-01] Always validate input at trust boundaries. (Source: PR #1)\n"
    )

    runner = CliRunner()
    result = runner.invoke(app, ["memory", "reindex", "--repo", str(tmp_path)])

    assert result.exit_code == 0, result.output
    data = json.loads(re.search(r"\{.*\}", result.output).group(0))
    assert data["indexed"].get("security", 0) > 0


def test_memory_delete_chunks_removes_given_ids(tmp_path, monkeypatch):
    """AC3: `memory delete-chunks` deletes chunk ids from a reviewer's collection."""
    monkeypatch.chdir(tmp_path)
    reviewers_dir = tmp_path / "reviewers" / "security"
    reviewers_dir.mkdir(parents=True)
    (reviewers_dir / "KNOWLEDGE.md").write_text(
        "## Patterns Found\n"
        "- [2026-01-01] Always validate input at trust boundaries. (Source: PR #1)\n"
    )

    runner = CliRunner()
    reindex_result = runner.invoke(app, ["memory", "reindex", "--repo", str(tmp_path)])
    assert reindex_result.exit_code == 0, reindex_result.output

    store_dir = Path.home() / ".datum" / "projects" / tmp_path.name / "knowledge"
    meta_path = store_dir / "numpy_index" / "reviewer_security.meta.jsonl"
    assert meta_path.exists(), "expected reviewer_security collection on disk"
    first_meta = json.loads(meta_path.read_text().splitlines()[0])
    ids = [first_meta["chunk_id"]]

    delete_result = runner.invoke(
        app,
        [
            "memory",
            "delete-chunks",
            "--repo",
            str(tmp_path),
            "--reviewer-id",
            "security",
            "--chunk-id",
            ids[0],
        ],
    )

    assert delete_result.exit_code == 0, delete_result.output
    data = json.loads(re.search(r"\{.*\}", delete_result.output).group(0))
    assert data["deleted"] == 1
