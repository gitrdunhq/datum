"""RED tests for gate_properties' Integration Invariants + per-question coverage.

gate_properties() currently only checks the 11 category keywords and a
loose traceability-table sniff. This lane adds two new checks:

1. The '## Integration Invariants' table (datum.integration_invariants)
   must be present and well formed.
2. Every answered question in QUESTIONS.md must have exactly one invariant
   row whose Source column is 'question:Q<N>' — no fewer, no more.

These tests drive gate_properties end-to-end against tmp_path epic
fixtures, the same way tests/test_gate_review.py does, and assert on the
specific new message strings this lane owns: missing_integration_invariants_section,
invariant_missing_for_question, invariant_duplicate_for_question. They also
pin gate.answered_question_ids() as a standalone unit and the
single-read-per-invocation performance NFR.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from datum import gate
from datum.integration_invariants import parse_integration_invariants

REQUIRED_CATEGORIES = [
    "SAFETY",
    "LIVENESS",
    "INVARIANT",
    "BOUNDARY",
    "IDEMPOTENT",
    "ORDERING",
    "ISOLATION",
    "PERFORMANCE",
    "SECURITY",
    "OBSERVABILITY",
    "COMPATIBILITY",
]


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + args, cwd=cwd, capture_output=True, text=True, check=True
    )


def _init_repo(repo: Path, branch: str = "datum/epic-properties") -> str:
    repo.mkdir(parents=True, exist_ok=True)
    _git(["init", "-q", "-b", branch], cwd=repo)
    _git(["config", "core.hooksPath", "/dev/null"], cwd=repo)
    _git(["config", "user.email", "t@example.com"], cwd=repo)
    _git(["config", "user.name", "T"], cwd=repo)
    (repo / "README.md").write_text("# fixture\n")
    _git(["add", "README.md"], cwd=repo)
    _git(["commit", "-q", "-m", "init"], cwd=repo)
    return branch


@pytest.fixture
def epic_repo(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    branch = _init_repo(repo)
    monkeypatch.chdir(repo)
    epic_dir = repo / "docs" / "epics" / branch
    epic_dir.mkdir(parents=True)
    return epic_dir


def _fail_json(capsys):
    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    return json.loads(lines[-1])


def _categories_and_traceability() -> str:
    body = "\n".join(f"- {c}: documented." for c in REQUIRED_CATEGORIES)
    return f"# PROPERTIES.md\n\n{body}\n\nSee task-001 for traceability.\n"


def _invariants_table(rows: list[tuple[str, str, str, str]]) -> str:
    header = (
        "## Integration Invariants\n\n"
        "| ID | Invariant | Covers | Source |\n"
        "| --- | --- | --- | --- |\n"
    )
    body = "".join(f"| {i} | {inv} | {cov} | {src} |\n" for i, inv, cov, src in rows)
    return header + body


def _properties_md(invariants_section: str | None) -> str:
    base = _categories_and_traceability()
    if invariants_section is None:
        return base
    return base + "\n" + invariants_section


def _questions_md(blocks: list[tuple[str, str | None]]) -> str:
    """blocks: list of (question_id, answer_text_or_None-for-absent-line)."""
    out = ["## Refine\n"]
    for qid, answer in blocks:
        out.append(f"### {qid}: [Scope] {qid} question?\n")
        if answer is not None:
            out.append(f"[Answer]: {answer}\n")
        out.append("\n")
    return "".join(out)


def _write(epic_dir: Path, name: str, body: str) -> None:
    (epic_dir / name).write_text(body)


# ── AC: missing_integration_invariants_section ──────────────────────────


def test_gate_properties_fails_when_integration_invariants_heading_absent(
    epic_repo, capsys
):
    _write(epic_repo, "PROPERTIES.md", _properties_md(None))
    _write(epic_repo, "QUESTIONS.md", _questions_md([]))

    with pytest.raises(SystemExit) as exc:
        gate.gate_properties(True, {})

    assert exc.value.code == 1
    payload = _fail_json(capsys)
    assert payload["passed"] is False
    assert "missing_integration_invariants_section" in payload["message"]


# ── AC: IntegrationInvariantError message surfaced verbatim ─────────────


def test_gate_properties_surfaces_malformed_row_error_verbatim(epic_repo, capsys):
    malformed_section = (
        "## Integration Invariants\n\n"
        "| ID | Invariant | Covers | Source |\n"
        "| --- | --- | --- | --- |\n"
        "| INV-001 | Task IDs are unique | task-001 |\n"
    )
    with pytest.raises(Exception) as parse_exc:
        parse_integration_invariants(malformed_section)
    expected_message = str(parse_exc.value)
    assert expected_message.startswith("malformed_invariant_row:")

    _write(epic_repo, "PROPERTIES.md", _properties_md(malformed_section))
    _write(epic_repo, "QUESTIONS.md", _questions_md([]))

    with pytest.raises(SystemExit) as exc:
        gate.gate_properties(True, {})

    assert exc.value.code == 1
    payload = _fail_json(capsys)
    assert payload["passed"] is False
    assert payload["message"] == expected_message


# ── AC: answered_question_ids ────────────────────────────────────────────


def test_answered_question_ids_returns_only_non_empty_answers():
    text = _questions_md(
        [
            ("Q1", "yes it does."),
            ("Q2", ""),
            ("Q3", None),
            ("Q4", "confirmed by team"),
        ]
    )

    result = gate.answered_question_ids(text)

    assert result == ["Q1", "Q4"]


def test_answered_question_ids_excludes_all_when_none_answered():
    text = _questions_md([("Q5", ""), ("Q6", None)])

    result = gate.answered_question_ids(text)

    assert result == []


# ── AC: invariant_missing_for_question ───────────────────────────────────


def test_gate_properties_fails_with_missing_invariant_for_answered_question(
    epic_repo, capsys
):
    invariants = _invariants_table(
        [("INV-001", "Task IDs unique", "task-001", "question:Q1")]
    )
    _write(epic_repo, "PROPERTIES.md", _properties_md(invariants))
    _write(
        epic_repo,
        "QUESTIONS.md",
        _questions_md([("Q1", "yes"), ("Q2", "also yes")]),
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_properties(True, {})

    assert exc.value.code == 1
    payload = _fail_json(capsys)
    assert payload["passed"] is False
    assert "invariant_missing_for_question: Q2" in payload["message"]


# ── AC: invariant_duplicate_for_question ─────────────────────────────────


def test_gate_properties_fails_with_duplicate_invariant_for_question(epic_repo, capsys):
    invariants = _invariants_table(
        [
            ("INV-001", "Task IDs unique", "task-001", "question:Q1"),
            ("INV-002", "Task IDs unique again", "task-002", "question:Q1"),
        ]
    )
    _write(epic_repo, "PROPERTIES.md", _properties_md(invariants))
    _write(epic_repo, "QUESTIONS.md", _questions_md([("Q1", "yes")]))

    with pytest.raises(SystemExit) as exc:
        gate.gate_properties(True, {})

    assert exc.value.code == 1
    payload = _fail_json(capsys)
    assert payload["passed"] is False
    assert "invariant_duplicate_for_question: Q1" in payload["message"]


# ── AC: passes when every answered question has exactly one row ─────────


def test_gate_properties_passes_with_exactly_one_matching_row_per_question(
    epic_repo, capsys, monkeypatch
):
    invariants = _invariants_table(
        [
            ("INV-001", "Task IDs unique", "task-001", "question:Q1"),
            ("INV-002", "Coverage complete", "task-002", "question:Q2"),
        ]
    )
    _write(epic_repo, "PROPERTIES.md", _properties_md(invariants))
    _write(
        epic_repo,
        "QUESTIONS.md",
        _questions_md([("Q1", "yes"), ("Q2", "also yes")]),
    )

    questions_reads = {"count": 0}
    original_read_text = Path.read_text

    def counting_read_text(self, *args, **kwargs):
        if self.name == "QUESTIONS.md":
            questions_reads["count"] += 1
        return original_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", counting_read_text)

    with pytest.raises(SystemExit) as exc:
        gate.gate_properties(True, {})

    assert exc.value.code == 0
    assert _fail_json(capsys) == {"passed": True, "message": "Properties gate passed"}
    # Proves the per-question coverage check actually ran against
    # QUESTIONS.md rather than the gate trivially passing without checking.
    assert questions_reads["count"] == 1


# ── AC: Covers < 2 with spec: source fails; question: source passes ─────


def test_gate_properties_fails_spec_sourced_row_with_fewer_than_two_covers(
    epic_repo, capsys
):
    invariants = _invariants_table(
        [("INV-001", "Single coverage", "task-001", "spec:section-3")]
    )
    _write(epic_repo, "PROPERTIES.md", _properties_md(invariants))
    _write(epic_repo, "QUESTIONS.md", _questions_md([]))

    with pytest.raises(SystemExit) as exc:
        gate.gate_properties(True, {})

    assert exc.value.code == 1
    payload = _fail_json(capsys)
    assert payload["passed"] is False


def test_gate_properties_passes_question_sourced_row_with_fewer_than_two_covers(
    epic_repo, capsys, monkeypatch
):
    invariants = _invariants_table(
        [("INV-001", "Single coverage", "task-001", "question:Q1")]
    )
    _write(epic_repo, "PROPERTIES.md", _properties_md(invariants))
    _write(epic_repo, "QUESTIONS.md", _questions_md([("Q1", "yes")]))

    questions_reads = {"count": 0}
    original_read_text = Path.read_text

    def counting_read_text(self, *args, **kwargs):
        if self.name == "QUESTIONS.md":
            questions_reads["count"] += 1
        return original_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", counting_read_text)

    with pytest.raises(SystemExit) as exc:
        gate.gate_properties(True, {})

    assert exc.value.code == 0
    assert _fail_json(capsys) == {"passed": True, "message": "Properties gate passed"}
    # Proves the Covers-count-vs-Source rule actually evaluated this row
    # instead of the gate trivially passing without checking.
    assert questions_reads["count"] == 1


# ── NFR: PROPERTIES.md and QUESTIONS.md each read once per invocation ───


def test_gate_properties_reads_each_artifact_exactly_once(
    epic_repo, capsys, monkeypatch
):
    invariants = _invariants_table(
        [("INV-001", "Task IDs unique", "task-001", "question:Q1")]
    )
    _write(epic_repo, "PROPERTIES.md", _properties_md(invariants))
    _write(epic_repo, "QUESTIONS.md", _questions_md([("Q1", "yes")]))

    read_counts: dict[str, int] = {}
    original_read_text = Path.read_text

    def counting_read_text(self, *args, **kwargs):
        if self.name in ("PROPERTIES.md", "QUESTIONS.md"):
            read_counts[self.name] = read_counts.get(self.name, 0) + 1
        return original_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", counting_read_text)

    with pytest.raises(SystemExit) as exc:
        gate.gate_properties(True, {})

    assert exc.value.code == 0
    assert read_counts.get("PROPERTIES.md") == 1
    assert read_counts.get("QUESTIONS.md") == 1
