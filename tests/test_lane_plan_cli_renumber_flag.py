"""`datum lane-plan --renumber` must reach lane_plan.main through the Typer CLI.

The plan workflow calls `datum lane-plan ... --renumber` for a fresh epic
(skills/src/shared/plan-steps.ts). The argparse main accepted the flag, but
the Typer wrapper in datum/cli.py never forwarded it, so the CLI answered
"No such option: --renumber" and every fresh epic failed plan_build_failed
(run wf_a3714853-a15). The wiring tests call main() directly and could not
see that gap; these go through the CLI.
"""

from __future__ import annotations

import json
import sys

from typer.testing import CliRunner

from datum import cli as datum_cli


def _tasks_file(tmp_path):
    tasks = tmp_path / "tasks.json"
    tasks.write_text(json.dumps({"tasks": []}))
    return tasks


def test_cli_forwards_renumber_to_lane_plan_main(tmp_path, monkeypatch):
    # Catches: the Typer wrapper dropping --renumber so argparse never sees it.
    seen: list[list[str]] = []

    def fake_main() -> None:
        seen.append(list(sys.argv))

    monkeypatch.setattr("datum.lane_plan.main", fake_main)
    tasks = _tasks_file(tmp_path)
    result = CliRunner().invoke(
        datum_cli.app,
        ["lane-plan", "--renumber", "--input", str(tasks), "--output", str(tmp_path / "lp.json"), "--md-output", str(tmp_path / "TASKS.md")],
    )
    assert result.exit_code == 0, result.output
    assert seen and "--renumber" in seen[0]
    assert "--input" in seen[0] and str(tasks) in seen[0]


def test_cli_without_renumber_does_not_forward_it(tmp_path, monkeypatch):
    # Catches: the flag being forwarded unconditionally (renumbering an
    # existing epic's ids would break every depends_on reference).
    seen: list[list[str]] = []
    monkeypatch.setattr("datum.lane_plan.main", lambda: seen.append(list(sys.argv)))
    tasks = _tasks_file(tmp_path)
    result = CliRunner().invoke(datum_cli.app, ["lane-plan", "--input", str(tasks)])
    assert result.exit_code == 0, result.output
    assert seen and "--renumber" not in seen[0]


def test_cli_validate_with_renumber_leaves_tasks_json_byte_identical(tmp_path):
    # Catches: --validate --renumber rewriting the input (the argparse main
    # guards this; the CLI must not bypass that guard).
    tasks = _tasks_file(tmp_path)
    before = tasks.read_bytes()
    CliRunner().invoke(datum_cli.app, ["lane-plan", "--validate", "--renumber", "--input", str(tasks)])
    assert tasks.read_bytes() == before
