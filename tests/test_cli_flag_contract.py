"""Producer/consumer contract between the workflow scripts and the CLI.

Every `datum <cmd> --flag` that skills/src (scripts + prompts) passes must be a
flag the real target accepts. Several `datum` commands are pass-through
wrappers (allow_extra_args → `python -m datum.<module>` or a scripts/ file),
so their own `--help` says nothing about the flags they forward; the check
resolves those to the module/script that actually parses them.

A renamed or dropped flag fails here, not in a consumer repo's Act phase.
"""

from __future__ import annotations

import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

from typer.testing import CliRunner

from datum.cli import app

ROOT = Path(__file__).resolve().parents[1]
SKILLS_SRC = ROOT / "skills" / "src"

# Pass-through typer commands → the argparse module that owns their flags.
MODULE_WRAPPERS: dict[str, str] = {
    "gate": "datum.gate",
    "skeleton": "datum.skeleton_creator",
    "contract-preflight": "datum.contract_preflight",
    "closeout-archive": "datum.closeout.archive",
    "closeout-collate": "datum.closeout.collate",
    "closeout-collect-git": "datum.closeout.collect_git",
    "closeout-collect-tasks": "datum.closeout.collect_tasks",
    "closeout-collect-token-metrics": "datum.closeout.collect_token_metrics",
}
# `datum dev <name>` → scripts/<file>; flags are whatever the script parses.
SCRIPT_WRAPPERS: dict[str, Path] = {
    "dev test-count-gate": ROOT / "scripts" / "test-count-gate",
}

# One `datum <cmd> [sub]` invocation and the rest of its line.
_CMD_RE = re.compile(
    r"datum ("
    r"lane-state (?:write|read|rehash)|worktrees (?:setup|merge|cleanup)|dev [a-z0-9-]+"
    r"|gate|skeleton|contract-preflight|closeout-[a-z-]+|lane-plan-distribute|lane-plan-digest|lane-plan|lane-cleanup"
    r"|pipeline-state-save|config-fingerprint|gitignore-check|plan-issues|issue-stage|ticket-from-issue"
    r"|housekeep-epic"
    r")\b([^\n`'\"]*)"
)
_FLAG_RE = re.compile(r"(--[a-z][a-z0-9-]*)")


def referenced_flags(
    text: str, origin: str = "<text>"
) -> dict[str, dict[str, list[str]]]:
    """{cmd: {flag: [origin:line, ...]}} for every datum invocation in *text*."""
    out: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for lineno, line in enumerate(text.splitlines(), 1):
        for m in _CMD_RE.finditer(line):
            cmd = m.group(1)
            for flag in _FLAG_RE.findall(m.group(2)):
                out[cmd][flag].append(f"{origin}:{lineno}")
    return out


def referenced_flags_in_tree(src: Path) -> dict[str, dict[str, list[str]]]:
    merged: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for f in sorted(list(src.rglob("*.ts")) + list(src.rglob("*.md"))):
        if f.name.endswith(".test.ts"):
            continue
        for cmd, flags in referenced_flags(
            f.read_text(), str(f.relative_to(ROOT))
        ).items():
            for flag, sites in flags.items():
                merged[cmd][flag].extend(sites)
    return merged


def known_flags(cmd: str) -> set[str]:
    """Flags the real parser for `datum <cmd>` accepts."""
    if cmd in SCRIPT_WRAPPERS:
        return set(_FLAG_RE.findall(SCRIPT_WRAPPERS[cmd].read_text()))
    if cmd in MODULE_WRAPPERS:
        res = subprocess.run(
            [sys.executable, "-m", MODULE_WRAPPERS[cmd], "--help"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert (
            res.returncode == 0
        ), f"python -m {MODULE_WRAPPERS[cmd]} --help failed: {res.stderr[-300:]}"
        return set(_FLAG_RE.findall(res.stdout))
    res = CliRunner().invoke(app, [*cmd.split(), "--help"])
    assert res.exit_code == 0, f"datum {cmd} --help failed: {res.output[-300:]}"
    return set(_FLAG_RE.findall(res.output))


def test_checker_detects_a_flag_the_target_does_not_accept():
    used = referenced_flags('run: datum skeleton --batch --bogus-flag "x"', "fake.ts")
    assert used["skeleton"]["--bogus-flag"] == ["fake.ts:1"]
    assert "--bogus-flag" not in known_flags("skeleton")
    assert "--batch" in known_flags("skeleton")


def test_wrapper_flags_come_from_the_forwarded_module_not_the_typer_stub():
    # The typer stub for a pass-through command knows only --help; the module knows the real flags.
    stub = CliRunner().invoke(app, ["skeleton", "--help"])
    assert "--batch" not in stub.output
    assert "--batch" in known_flags("skeleton")


def test_every_flag_the_workflow_scripts_pass_exists_on_its_target():
    used = referenced_flags_in_tree(SKILLS_SRC)
    assert (
        used
    ), "no datum invocations found under skills/src — the extractor regex is broken"
    problems: list[str] = []
    for cmd in sorted(used):
        known = known_flags(cmd)
        for flag, sites in sorted(used[cmd].items()):
            if flag not in known:
                problems.append(f"datum {cmd} {flag}  <- {', '.join(sites[:3])}")
    assert (
        not problems
    ), "flags passed by skills/src that the CLI target does not accept:\n" + "\n".join(
        problems
    )
