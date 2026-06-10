import pathlib
from pathlib import Path
from unittest.mock import patch
from datum.walkthrough import generate_walkthrough


def test_walkthrough_template_exists_and_has_headers():
    template_path = pathlib.Path("templates/WALKTHROUGH.md")

    # This assertion will fail because the file does not exist
    assert template_path.exists(), f"Template file {template_path} does not exist."

    content = template_path.read_text()
    required_headers = [
        "Summary of Changes",
        "Lane Narratives",
        "Files Touched",
        "Key Design Decisions",
        "Excluded from Scope",
    ]

    for header in required_headers:
        assert header in content, f"Header '{header}' not found in {template_path}"


_STRUCTURED_RESULT = {
    "result": {
        "data": {
            "summary": "test summary",
            "lanes": ["RED: tests written", "GREEN: implemented"],
            "files_touched": ["datum/walkthrough.py"],
            "key_decisions": ["use sidecar_docs phase"],
            "excluded": ["HTML output"],
        },
        "raw": '{"summary":"test summary",...}',
        "tokens": 42,
        "time_s": 1.0,
        "model": "gemma",
        "quality": {"ok": True},
    },
    "escalated": False,
    "phase": "sidecar_docs",
}


@patch("datum.walkthrough.run_phase")
def test_generate_walkthrough_returns_path(mock_run_phase, tmp_path):
    mock_run_phase.return_value = _STRUCTURED_RESULT
    result = generate_walkthrough(tmp_path)
    assert isinstance(result, Path)
    assert result.name.endswith("WALKTHROUGH.md")


@patch("datum.walkthrough.run_phase")
def test_generate_walkthrough_creates_file(mock_run_phase, tmp_path):
    mock_run_phase.return_value = _STRUCTURED_RESULT
    result = generate_walkthrough(tmp_path)
    assert result.exists()


@patch("datum.walkthrough.run_phase")
def test_generate_walkthrough_llm_content_rendered(mock_run_phase, tmp_path):
    mock_run_phase.return_value = _STRUCTURED_RESULT
    result = generate_walkthrough(tmp_path)
    content = result.read_text()
    assert "test summary" in content
    assert "RED: tests written" in content
    assert "datum/walkthrough.py" in content


@patch("datum.walkthrough.run_phase")
def test_generate_walkthrough_fallback(mock_run_phase, tmp_path):
    mock_run_phase.return_value = {
        "result": None,
        "escalated": True,
        "phase": "sidecar_docs",
    }
    result = generate_walkthrough(tmp_path)
    assert isinstance(result, Path)
    assert result.name.endswith("WALKTHROUGH.md")


def test_walkthrough_cli_registered():
    from typer.testing import CliRunner
    from datum.cli import app

    runner = CliRunner()
    result = runner.invoke(app, ["walkthrough", "--help"])
    assert result.exit_code == 0
    assert "Generate a walkthrough document" in result.stdout


def test_walkthrough_summary_schema_validates():
    from datum.models.walkthrough_schema import WalkthroughSummary

    ws = WalkthroughSummary(
        summary="Epic summary",
        lanes=["RED: wrote tests", "GREEN: implemented", "REFACTOR: cleaned"],
        files_touched=["datum/walkthrough.py", "datum/models/walkthrough_schema.py"],
        key_decisions=[
            "Use sidecar_docs phase",
            "Deterministic fallback if LLM unavailable",
        ],
        excluded=["HTML output", "Claude escalation"],
    )
    assert ws.summary == "Epic summary"
    assert len(ws.lanes) == 3
    assert len(ws.files_touched) == 2
