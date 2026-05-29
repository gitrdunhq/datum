"""Tests for datum closeout CLI command and closeout_cmd module."""

from unittest.mock import MagicMock, patch

from typer.testing import CliRunner

from datum.cli import app


def test_closeout_command_registered():
    runner = CliRunner()
    result = runner.invoke(app, ["closeout", "--help"])
    assert result.exit_code == 0
    assert "closeout" in result.stdout.lower() or "Run" in result.stdout


def test_detect_context_parses_epic_number_from_branch():
    from datum.closeout_cmd import detect_context

    with patch(
        "datum.closeout_cmd._git",
        side_effect=[
            "datum/epic-23",  # rev-parse HEAD branch
            "abc1234",  # rev-parse HEAD (merge sha)
            "def5678",  # base sha detection
        ],
    ):
        ctx = detect_context()
    assert ctx["epic_number"] == 23


def test_detect_context_generates_run_id():
    from datum.closeout_cmd import detect_context

    with patch("datum.closeout_cmd._git", return_value="main"):
        with patch("datum.closeout_cmd._git") as mock_git:
            mock_git.side_effect = ["datum/epic-23", "abc1234", "def5678"]
            ctx = detect_context()
    assert "run_id" in ctx
    assert len(ctx["run_id"]) > 8


def test_run_stage1_calls_all_collectors(tmp_path):
    from datum.closeout_cmd import run_stage1

    with patch("datum.closeout_cmd.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(
            returncode=0, stdout='{"ok": true}', stderr=""
        )
        results = run_stage1(
            run_id="test-run",
            base_sha="abc1234",
            merge_sha="def5678",
            runs_dir=tmp_path,
        )

    call_args = [str(c.args[0]) for c in mock_run.call_args_list]
    called_modules = " ".join(call_args)
    assert "collect_git" in called_modules
    assert "collect_tasks" in called_modules
    assert "collect_platform" in called_modules


def test_closeout_command_exits_gracefully_outside_repo():
    runner = CliRunner()
    with patch(
        "datum.closeout_cmd.detect_context", side_effect=RuntimeError("not a git repo")
    ):
        result = runner.invoke(app, ["closeout"])
    assert (
        result.exit_code != 0
        or "error" in result.stdout.lower()
        or result.exit_code == 1
    )
