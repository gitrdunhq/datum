"""Tests for scripts/lane-tools/run_command.py — issue #97 (SEC-001).

The lane tool executes model-supplied commands. It must NOT pass them
through a shell: shell metacharacters (command substitution, pipes,
chaining) are data, not syntax. shlex.split + shell=False.

The script is not importable as a module (lane-tools is not a package),
so these tests invoke it as a subprocess — same pattern as
tests/test_epic26_write_tool_scripts.py.
"""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "lane-tools" / "run_command.py"


def _run(args: dict | str, timeout: int = 30) -> subprocess.CompletedProcess:
    payload = args if isinstance(args, str) else json.dumps(args)
    return subprocess.run(
        [sys.executable, str(SCRIPT), payload],
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=str(REPO_ROOT),
    )


def test_runs_simple_command_and_returns_output():
    proc = _run({"command": "echo hello"})
    assert proc.returncode == 0
    assert proc.stdout.strip() == "hello"


def test_propagates_nonzero_exit_code():
    proc = _run({"command": f"{sys.executable} -c 'import sys; sys.exit(3)'"})
    assert proc.returncode == 3


def test_shell_metacharacters_are_not_interpreted():
    """SEC-001: $(...) must be passed through as a literal argument, never
    executed by a shell."""
    proc = _run({"command": "echo $(id)"})
    assert proc.returncode == 0
    assert "$(id)" in proc.stdout
    assert "uid=" not in proc.stdout


def test_command_chaining_is_not_interpreted():
    """SEC-001: ';' and '&&' are arguments, not command separators."""
    canary = "INJECTED_BY_CHAIN"
    proc = _run({"command": f"echo safe; echo {canary} && echo {canary}"})
    # Without a shell, echo prints the metacharacters literally on one line.
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    assert len(lines) == 1
    assert ";" in lines[0]


def test_unparseable_command_is_an_error_not_a_crash():
    proc = _run({"command": "echo 'unbalanced"})
    assert proc.returncode != 0
    assert "Error" in proc.stdout + proc.stderr


def test_empty_command_is_an_error():
    proc = _run({"command": "   "})
    assert proc.returncode != 0
    assert "Error" in proc.stdout + proc.stderr


def test_missing_binary_is_an_error_not_a_traceback():
    proc = _run({"command": "definitely-not-a-real-binary-12345 --flag"})
    assert proc.returncode != 0
    combined = proc.stdout + proc.stderr
    assert "Error" in combined
    assert "Traceback" not in combined


def test_missing_command_key_is_an_error():
    proc = _run({"cmd": "echo hi"})
    assert proc.returncode != 0
    assert "required" in proc.stdout + proc.stderr


def test_invalid_json_is_an_error():
    proc = _run("not-json")
    assert proc.returncode != 0
    assert "JSON" in proc.stdout + proc.stderr
