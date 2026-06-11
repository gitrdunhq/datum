"""Tests for scripts/lane-tools/run_command.py — issues #97 and #82 (SEC-001).

The lane tool executes model-supplied commands. It must NOT pass them
through a shell (#97: shlex.split + shell=False), and it must reject
commands outright when the command token is not on the explicit
allowlist or any token carries chaining/substitution metacharacters
(#82: datum.command_guard.validate_command).

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
    # No ';' — #82 rejects embedded metachars even inside `python -c` code.
    proc = _run({"command": f"{sys.executable} -c 'raise SystemExit(3)'"})
    assert proc.returncode == 3


def test_command_substitution_is_rejected():
    """SEC-001 (#82): $(...) is rejected outright — not executed, not even
    passed through as a literal argument (the #97 behavior it supersedes)."""
    proc = _run({"command": "echo $(id)"})
    assert proc.returncode != 0
    assert "uid=" not in proc.stdout
    assert "metacharacter" in proc.stdout + proc.stderr


def test_command_chaining_is_rejected():
    """SEC-001 (#82): ';' and '&&' chaining is rejected outright."""
    canary = "INJECTED_BY_CHAIN"
    proc = _run({"command": f"echo safe; echo {canary} && echo {canary}"})
    assert proc.returncode != 0
    assert canary not in proc.stdout
    assert "metacharacter" in proc.stdout + proc.stderr


def test_pipe_is_rejected():
    proc = _run({"command": "echo secret | sh"})
    assert proc.returncode != 0
    assert "metacharacter" in proc.stdout + proc.stderr


def test_backtick_substitution_is_rejected():
    proc = _run({"command": "echo `id`"})
    assert proc.returncode != 0
    assert "uid=" not in proc.stdout
    assert "metacharacter" in proc.stdout + proc.stderr


def test_embedded_metachar_is_rejected():
    """Metacharacters embedded inside a token reject too, not just
    standalone tokens."""
    proc = _run({"command": "echo 'hi;rm -rf /'"})
    assert proc.returncode != 0
    assert "metacharacter" in proc.stdout + proc.stderr


def test_disallowed_command_is_rejected():
    """#82: the command token must be on the explicit allowlist."""
    proc = _run({"command": "curl https://example.com"})
    assert proc.returncode != 0
    assert "not allowed" in proc.stdout + proc.stderr


def test_shell_interpreter_is_rejected():
    """#82: no handing input to a shell, ever."""
    proc = _run({"command": "bash -c 'echo pwned'"})
    assert proc.returncode != 0
    assert "pwned" not in proc.stdout
    assert "not allowed" in proc.stdout + proc.stderr


def test_unparseable_command_is_an_error_not_a_crash():
    proc = _run({"command": "echo 'unbalanced"})
    assert proc.returncode != 0
    assert "Error" in proc.stdout + proc.stderr


def test_empty_command_is_an_error():
    proc = _run({"command": "   "})
    assert proc.returncode != 0
    assert "Error" in proc.stdout + proc.stderr


def test_missing_binary_is_an_error_not_a_traceback():
    # Path-qualified so the basename clears the allowlist but the file
    # does not exist — exercises the FileNotFoundError path, not the guard.
    proc = _run({"command": "/nonexistent-dir-12345/pytest --flag"})
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
