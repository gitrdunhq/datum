"""Tests for the deterministic artifact scoring rubric (issue #92).

Four sub-checks, no LLM anywhere:
  (a) concreteness ratio  — lines with backticks/paths/code refs vs abstract prose
  (b) grounding ratio     — % of real project dirs/files actually referenced
  (c) git drift           — rev-list count since the artifact was last updated
  (d) reference validation — extracted path-like refs must exist on disk

Filesystem and git lookups are injected callables so every test here is pure.
"""

from __future__ import annotations

import json

import pytest

from datum.artifact_score import (
    CheckResult,
    check_concreteness,
    check_git_drift,
    check_grounding,
    check_references,
    extract_path_refs,
    score_artifact,
)

# ── Fixtures ────────────────────────────────────────────────────────────────

VAGUE_PROSE = (
    "The system should be robust and scalable.\n"
    "We will improve the overall quality of the solution.\n"
    "Various components interact in a flexible manner.\n"
    "Stakeholders expect a seamless experience going forward.\n"
    "This approach leverages synergies across the architecture.\n"
)

CONCRETE_PROSE = (
    "Add `score_artifact()` to datum/artifact_score.py.\n"
    "Wire it into datum/gate.py behind the `score-context` phase.\n"
    "Tests live in tests/test_artifact_score.py and use `pytest`.\n"
    "Thresholds are module constants next to `check_concreteness()`.\n"
)


def _entries() -> list[str]:
    return ["datum", "tests", "docs", "pyproject.toml"]


def _exists_none(_ref: str) -> bool:
    return False


def _exists_all(_ref: str) -> bool:
    return True


# ── (a) Concreteness ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "content,expected",
    [
        # all-vague filler scores the floor
        (VAGUE_PROSE, 0.0),
        # fully concrete (paths + backticks on every line) scores the ceiling
        (CONCRETE_PROSE, 1.0),
        # 1 concrete line out of 5 prose lines = 0.2 ratio -> mid band
        (
            "Mention of `datum/gate.py` here.\n"
            "The system should be robust.\n"
            "We value quality and flexibility.\n"
            "Stakeholders expect great things.\n"
            "Synergy is leveraged holistically.\n",
            0.7,
        ),
        # 1 concrete line out of 12 ≈ 0.083 -> low band
        (
            "See `gate.py` for details.\n" + "Abstract filler prose line here.\n" * 11,
            0.4,
        ),
    ],
)
def test_concreteness_graduated_bands(content: str, expected: float):
    result = check_concreteness(content)
    assert result.name == "concreteness"
    assert result.score == expected
    assert result.reasons  # always explains itself


def test_concreteness_empty_content_scores_zero():
    result = check_concreteness("")
    assert result.score == 0.0
    assert any("no prose" in r for r in result.reasons)


def test_concreteness_headings_excluded_from_denominator():
    # Only headings + one concrete line: ratio is 1/1, not 1/3
    content = "## Summary\n\n### Details\n\nRun `datum gate refine` first.\n"
    result = check_concreteness(content)
    assert result.score == 1.0


def test_concreteness_code_fence_lines_count_as_concrete():
    content = "```python\nx = 1\ny = compute(x)\n```\n"
    result = check_concreteness(content)
    assert result.score == 1.0


# ── (b) Grounding ───────────────────────────────────────────────────────────


def test_grounding_real_refs_score_high():
    content = "Edit `datum/gate.py` and add tests in tests/test_gate_fixes.py.\n"
    result = check_grounding(content, _entries())
    assert result.name == "grounding"
    # 2 of 4 real entries referenced = 0.5 ratio -> top band
    assert result.score == 1.0
    assert result.details["referenced"] == ["datum", "tests"]


def test_grounding_vague_artifact_scores_zero():
    result = check_grounding(VAGUE_PROSE, _entries())
    assert result.score == 0.0
    assert any("no real project" in r.lower() for r in result.reasons)


def test_grounding_hallucinated_dirs_do_not_count():
    content = "All logic lives in `enterprise/core/` and megaframework/app.py.\n"
    result = check_grounding(content, _entries())
    assert result.score == 0.0


def test_grounding_single_entry_of_many_is_partial():
    entries = [f"dir{i}" for i in range(20)] + ["datum"]
    content = "Touch `datum/gate.py` only.\n"
    result = check_grounding(content, entries)
    # 1 of 21 ≈ 0.048 -> partial credit, not zero
    assert 0.0 < result.score < 1.0


def test_grounding_no_project_entries_is_negative_path():
    result = check_grounding(CONCRETE_PROSE, [])
    assert result.score == 0.0
    assert any("no project entries" in r.lower() for r in result.reasons)


# ── (c) Git drift ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "commits,expected",
    [
        (0, 1.0),
        (3, 1.0),
        (4, 0.7),
        (10, 0.7),
        (11, 0.4),
        (25, 0.4),
        (26, 0.0),
        (200, 0.0),
    ],
)
def test_git_drift_graduated_bands(commits: int, expected: float):
    result = check_git_drift("SPEC.md", lambda _p: commits)
    assert result.name == "git_drift"
    assert result.score == expected
    assert result.details["commits_since_update"] == commits


def test_git_drift_unavailable_history_is_skipped_not_failed():
    result = check_git_drift("SPEC.md", lambda _p: None)
    assert result.score == 1.0
    assert result.details["skipped"] is True
    assert any("unavailable" in r.lower() for r in result.reasons)


def test_git_drift_no_artifact_path_is_skipped():
    result = check_git_drift(None, lambda _p: 99)
    assert result.score == 1.0
    assert result.details["skipped"] is True


# ── (d) Reference validation ────────────────────────────────────────────────


def test_extract_path_refs_finds_slash_paths_and_strips_punctuation():
    content = "See datum/gate.py, and `tests/test_units.py`.\nAlso docs/DATUM.md!\n"
    refs = extract_path_refs(content)
    assert refs == ["datum/gate.py", "tests/test_units.py", "docs/DATUM.md"]


def test_extract_path_refs_skips_urls_globs_and_placeholders():
    content = (
        "Fetch https://example.com/a/b.json then match src/*.py and "
        "docs/epics/<branch>/SPEC.md plus .datum/runs/{run_id}/state.json\n"
    )
    refs = extract_path_refs(content)
    assert refs == []


def test_references_all_exist_scores_top():
    content = "Edit datum/gate.py and tests/test_units.py.\n"
    result = check_references(content, _exists_all)
    assert result.name == "reference_validation"
    assert result.score == 1.0
    assert result.details["missing"] == []


def test_references_missing_ref_named_in_reasons():
    content = "Edit datum/gate.py and datum/imaginary_module.py.\n"

    def exists(ref: str) -> bool:
        return ref == "datum/gate.py"

    result = check_references(content, exists)
    # 1 of 2 exists = 0.5 -> low band
    assert result.score == 0.4
    assert result.details["missing"] == ["datum/imaginary_module.py"]
    assert any("datum/imaginary_module.py" in r for r in result.reasons)


def test_references_all_missing_scores_zero():
    content = "See ghost/dir/file.py and phantom/mod.py.\n"
    result = check_references(content, _exists_none)
    assert result.score == 0.0


def test_references_no_checkable_refs_is_vacuous_pass():
    result = check_references(VAGUE_PROSE, _exists_none)
    assert result.score == 1.0
    assert result.details["skipped"] is True


# ── Aggregate scoring ───────────────────────────────────────────────────────


def _score(content: str, **overrides):
    kwargs = dict(
        artifact_path="SPEC.md",
        path_exists=_exists_all,
        project_entries=_entries(),
        commits_since=lambda _p: 0,
    )
    kwargs.update(overrides)
    return score_artifact(content, **kwargs)


def test_score_artifact_structured_output_shape():
    result = _score(CONCRETE_PROSE)
    payload = result.to_dict()
    assert payload["schema_version"] == "1.0"
    assert payload["artifact"] == "SPEC.md"
    assert [c["name"] for c in payload["checks"]] == [
        "concreteness",
        "grounding",
        "git_drift",
        "reference_validation",
    ]
    for check in payload["checks"]:
        assert set(check) == {"name", "score", "reasons", "details"}
    # must be JSON-serializable for the #79 evaluator
    json.dumps(payload)


def test_score_artifact_concrete_grounded_artifact_passes():
    result = _score(CONCRETE_PROSE)
    assert result.overall_score == 1.0
    assert result.verdict == "pass"


def test_score_artifact_vague_artifact_fails():
    result = _score(VAGUE_PROSE)
    # concreteness 0, grounding 0, drift 1.0, references vacuous 1.0 -> 0.5
    assert result.overall_score == 0.5
    assert result.verdict == "fail"


def test_score_artifact_drifted_claims_downgrade_verdict():
    result = _score(CONCRETE_PROSE, commits_since=lambda _p: 50)
    # 1.0 + 1.0 + 0.0 + 1.0 -> 0.75
    assert result.overall_score == 0.75
    assert result.verdict == "warn"


def test_score_artifact_missing_references_drag_score_down():
    result = _score(
        "Edit datum/gate.py and datum/ghost.py and datum/phantom.py.\n",
        path_exists=lambda ref: ref == "datum/gate.py",
    )
    ref_check = {c.name: c for c in result.checks}["reference_validation"]
    assert ref_check.score == 0.0
    assert result.verdict in ("warn", "fail")


def test_score_artifact_is_deterministic():
    a = _score(CONCRETE_PROSE).to_dict()
    b = _score(CONCRETE_PROSE).to_dict()
    assert a == b


def test_check_result_is_immutable():
    result = check_concreteness(CONCRETE_PROSE)
    assert isinstance(result, CheckResult)
    with pytest.raises(AttributeError):
        result.score = 0.0  # type: ignore[misc]


# ── gate.py wiring ──────────────────────────────────────────────────────────


def test_score_context_quality_on_real_artifact(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    src = tmp_path / "src"
    src.mkdir()
    (src / "main.py").write_text("x = 1\n")
    (tmp_path / "SPEC.md").write_text(
        "Implement `score()` in src/main.py.\n"
        "Wire src/main.py into the CLI entry point.\n"
    )

    from datum.gate import score_context_quality

    payload = score_context_quality("SPEC.md")
    assert payload["artifact"].endswith("SPEC.md")
    assert payload["verdict"] == "pass"
    checks = {c["name"]: c for c in payload["checks"]}
    # tmp_path is not a git repo: drift must be skipped, not crash
    assert checks["git_drift"]["details"]["skipped"] is True
    assert checks["reference_validation"]["score"] == 1.0


def test_score_context_quality_vague_artifact_fails(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "SPEC.md").write_text(VAGUE_PROSE)

    from datum.gate import score_context_quality

    payload = score_context_quality("SPEC.md")
    assert payload["verdict"] == "fail"


def test_score_context_quality_missing_artifact(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    from datum.gate import score_context_quality

    payload = score_context_quality("SPEC.md")
    assert payload["verdict"] == "fail"
    assert "not found" in payload["error"]


def test_gate_score_context_dispatch_exit_codes(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "SPEC.md").write_text(VAGUE_PROSE)

    from datum.gate import gate_score_context

    with pytest.raises(SystemExit) as exc:
        gate_score_context({}, "SPEC.md")
    assert exc.value.code == 1
    out = json.loads(capsys.readouterr().out)
    assert out["passed"] is False
    assert out["score"]["verdict"] == "fail"
