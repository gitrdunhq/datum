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
            "no-closeout-commits-here",  # log scan for previous epic's closeout commit
            "def5678",  # merge-base fallback
        ],
    ):
        ctx = detect_context()
    assert ctx["epic_number"] == 23


def test_detect_context_parses_epic_number_from_bug_squash_branch():
    """#301: bug-squash-NNN branches (see docs/epics/datum/) resolve epic_number."""
    from datum.closeout_cmd import detect_context

    with patch(
        "datum.closeout_cmd._git",
        side_effect=[
            "datum/bug-squash-281",  # rev-parse HEAD branch
            "abc1234",  # rev-parse HEAD (merge sha)
            "no-closeout-commits-here",  # log scan for previous epic's closeout commit
            "def5678",  # merge-base fallback
        ],
    ):
        ctx = detect_context()
    assert ctx["epic_number"] == 281


def test_detect_context_unrecognized_branch_warns_and_uses_sentinel(caplog):
    """#301: an unrecognized branch slug must not silently default to 0 —
    it should log a warning and use an obviously-invalid sentinel instead."""
    from datum.closeout_cmd import UNKNOWN_EPIC_NUMBER, detect_context

    with patch(
        "datum.closeout_cmd._git",
        side_effect=[
            "datum/bug-squash-round-2",  # rev-parse HEAD branch (no numeric suffix)
            "abc1234",  # rev-parse HEAD (merge sha)
            "no-closeout-commits-here",  # log scan for previous epic's closeout commit
            "def5678",  # merge-base fallback
        ],
    ):
        with caplog.at_level("WARNING", logger="datum.closeout_cmd"):
            ctx = detect_context()

    assert ctx["epic_number"] == UNKNOWN_EPIC_NUMBER
    assert ctx["epic_number"] != 0
    assert any("epic number" in record.message.lower() for record in caplog.records)


def test_detect_context_explicit_epic_number_wins_over_branch_parse():
    """#301: an explicit --epic-number always overrides branch-name parsing,
    even for an unrecognized branch slug."""
    from datum.closeout_cmd import detect_context

    with patch(
        "datum.closeout_cmd._git",
        side_effect=[
            "some-random-branch",  # rev-parse HEAD branch
            "abc1234",  # rev-parse HEAD (merge sha)
            "no-closeout-commits-here",  # log scan for previous epic's closeout commit
            "def5678",  # merge-base fallback
        ],
    ):
        ctx = detect_context(epic_number=42)
    assert ctx["epic_number"] == 42


def test_detect_context_generates_run_id():
    from datum.closeout_cmd import detect_context

    with patch("datum.closeout_cmd._git", return_value="main"):
        with patch("datum.closeout_cmd._git") as mock_git:
            mock_git.side_effect = [
                "datum/epic-23",
                "abc1234",
                "no-closeout-commits-here",
                "def5678",
            ]
            ctx = detect_context()
    assert "run_id" in ctx
    assert len(ctx["run_id"]) > 8


def test_detect_context_base_sha_prefers_previous_epic_closeout_commit_over_stale_main():
    """FU-3 (20260707-173926 follow-ups): epics chain linearly on one branch
    without fast-forwarding `main` after each merge, so `git merge-base main
    HEAD` can resolve to a base far older than the immediately-prior epic's
    real merge point. The previous epic's own `closeout(...)` commit is the
    correct, reliable base — it must win over the merge-base fallback."""
    from datum.closeout_cmd import detect_context

    with patch(
        "datum.closeout_cmd._git",
        side_effect=[
            "datum/epic-23",  # rev-parse HEAD branch
            "abc1234",  # rev-parse HEAD (merge sha)
            (
                "abc1234 fix: unrelated\n"
                "d86cb6f closeout(20260707-093851): archive pipeline artifacts\n"
                "badb2a9 chore(deps): ancient commit predating even the prior epic"
            ),  # log scan for previous epic's closeout commit
        ],
    ) as mock_git:
        ctx = detect_context()

    assert ctx["base_sha"] == "d86cb6f"
    # Only 3 _git calls: merge-base fallback must not fire once a
    # closeout(...) commit is found in history.
    assert mock_git.call_count == 3


def test_detect_context_base_sha_falls_back_to_merge_base_when_no_prior_closeout():
    """No closeout(...) commit anywhere in history (e.g. the very first
    epic ever) — must fall back to the old merge-base behavior, not crash."""
    from datum.closeout_cmd import detect_context

    with patch(
        "datum.closeout_cmd._git",
        side_effect=[
            "datum/epic-23",  # rev-parse HEAD branch
            "abc1234",  # rev-parse HEAD (merge sha)
            "abc1234 fix: unrelated\nbadb2a9 chore(deps): initial commit",  # log scan, no match
            "def5678",  # merge-base fallback
        ],
    ):
        ctx = detect_context()

    assert ctx["base_sha"] == "def5678"


def test_run_stage1_calls_all_collectors(tmp_path):
    from datum.closeout_cmd import run_stage1

    with patch("datum.closeout_cmd.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(
            returncode=0, stdout='{"ok": true}', stderr=""
        )
        run_stage1(
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
