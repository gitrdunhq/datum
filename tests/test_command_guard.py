"""Tests for datum.command_guard — issue #82 (SEC-001 followup to #97).

#97 made shell metacharacters inert (shlex.split + shell=False). #82 goes
further: an explicit command-token allowlist, and outright rejection of
chaining/substitution metacharacters whether they appear as standalone
tokens or embedded inside arguments.

validate_command is a pure function: argv in, Verdict out. No subprocess,
no filesystem, no LLM.
"""

import dataclasses

import pytest

from datum.command_guard import ALLOWED_COMMANDS, Verdict, validate_command

# ── allowed: real toolchain invocations the act lanes use ────────────────

ALLOWED_CASES = [
    ["pytest", "-q"],
    ["pytest", "tests/test_x.py::test_y", "-x"],
    ["python", "-m", "pytest", "-q"],
    ["python3", "-c", "print(1)"],
    ["/usr/bin/python3.12", "--version"],  # path-qualified, version-suffixed
    ["uv", "run", "pytest", "-q"],
    ["datum", "test"],
    ["echo", "hello", "world"],
    ["go", "test", "./...", "-v", "-json"],
    ["swift", "test"],
    ["npm", "test"],
    ["npx", "vitest", "run", "--reporter=json"],
    ["node", "script.js"],
    ["vitest", "run"],
    ["jest"],
    ["tsc", "--noEmit"],
    ["ruff", "check", "."],
    # #348: narrow read-only git allowlist
    ["git", "status"],
    ["git", "status", "--short"],
    ["git", "log", "--oneline", "-5"],
    ["git", "diff", "HEAD~1"],
    ["git", "show", "HEAD"],
    ["git", "rev-parse", "HEAD"],
    ["git", "merge-base", "main", "HEAD"],
    ["git", "ls-files"],
    ["git", "branch"],
    ["git", "branch", "--list"],
    ["git", "hash-object", "foo.txt"],
    # #348: python/python3 running a script under tests/ or scripts/ stays allowed
    ["python", "tests/x.py"],
    ["python3", "scripts/run.py", "--flag"],
]


@pytest.mark.parametrize("argv", ALLOWED_CASES, ids=lambda a: " ".join(a))
def test_allowed_commands_pass(argv):
    verdict = validate_command(argv)
    assert verdict.ok, verdict.reason
    assert verdict.reason == ""


# ── rejected: command token not on the allowlist ─────────────────────────

DISALLOWED_COMMAND_CASES = [
    ["bash", "-c", "echo hi"],
    ["sh", "-c", "id"],
    ["zsh", "-c", "id"],
    ["curl", "https://evil.example"],
    ["wget", "https://evil.example"],
    ["rm", "-rf", "/"],
    ["git", "push", "--force"],
    ["ssh", "host"],
    ["perl", "-e", "exec id"],
    ["definitely-not-a-real-binary-12345", "--flag"],
    ["python-evil"],  # must not match the python-version pattern
    ["pythonX"],
]


@pytest.mark.parametrize("argv", DISALLOWED_COMMAND_CASES, ids=lambda a: " ".join(a))
def test_disallowed_commands_reject(argv):
    verdict = validate_command(argv)
    assert not verdict.ok
    assert "not allowed" in verdict.reason


# ── rejected: chaining/substitution metacharacters as separate tokens ────

METACHAR_TOKEN_CASES = [
    ["echo", "hi", ";", "rm", "-rf", "/"],
    ["pytest", "&&", "curl", "evil"],
    ["echo", "a", "|", "sh"],
    ["echo", "&"],
    ["pytest", ">", "out.txt"],
    ["pytest", "<", "in.txt"],
    ["echo", "$(id)"],
    ["echo", "${HOME}"],
    ["echo", "`id`"],
]


@pytest.mark.parametrize("argv", METACHAR_TOKEN_CASES, ids=lambda a: " ".join(a))
def test_metachar_tokens_reject(argv):
    verdict = validate_command(argv)
    assert not verdict.ok
    assert "metacharacter" in verdict.reason


# ── rejected: metacharacters embedded inside otherwise-normal tokens ─────

METACHAR_EMBEDDED_CASES = [
    ["echo", "hi;rm -rf /"],
    ["pytest", "-q&&curl evil"],
    ["echo", "a|b"],
    ["echo", "x$(id)y"],
    ["echo", "x`id`y"],
    ["echo", "${HOME}/x"],
    ["echo", "line1\nline2"],
    ["echo;id"],  # metachar in the command token itself
]


@pytest.mark.parametrize(
    "argv", METACHAR_EMBEDDED_CASES, ids=lambda a: " ".join(a).replace("\n", "\\n")
)
def test_embedded_metachars_reject(argv):
    verdict = validate_command(argv)
    assert not verdict.ok
    assert "metacharacter" in verdict.reason


# ── negative paths: malformed argv ───────────────────────────────────────


def test_empty_argv_rejects():
    verdict = validate_command([])
    assert not verdict.ok
    assert "empty" in verdict.reason


def test_non_string_token_rejects():
    verdict = validate_command(["echo", 42])  # type: ignore[list-item]
    assert not verdict.ok


# ── invariants ───────────────────────────────────────────────────────────


def test_verdict_is_immutable():
    verdict = Verdict(ok=True)
    with pytest.raises((AttributeError, TypeError, dataclasses.FrozenInstanceError)):
        verdict.ok = False  # type: ignore[misc]


def test_allowlist_has_no_shell_interpreters():
    """The whole point: nothing on the allowlist hands input to a shell."""
    for shell in ("bash", "sh", "zsh", "dash", "fish", "ksh"):
        assert shell not in ALLOWED_COMMANDS


# ── #348: git is a narrow read-only allowlist, not a blanket allow ───────
# A run_git.py wrapper shelled out through the allowlisted python interpreter
# and got full git access via `git push --force` because git wasn't on the
# allowlist at all (any git call was rejected the same way, with no
# distinction for read-only inspection the act lanes actually need). Now git
# is allowed for a fixed set of read-only subcommands (mirroring the mutator
# list in assets/hooks/pre-tool-use-read-only-bash.sh); mutating subcommands
# and branch/hash-object mutator flags stay rejected.

GIT_MUTATING_SUBCOMMAND_CASES = [
    ["git", "checkout", "main"],
    ["git", "commit", "-m", "x"],
    ["git", "push", "--force"],
    ["git", "reset", "--hard"],
    ["git", "clean", "-fd"],
]


@pytest.mark.parametrize(
    "argv", GIT_MUTATING_SUBCOMMAND_CASES, ids=lambda a: " ".join(a)
)
def test_git_mutating_subcommand_rejects(argv):
    verdict = validate_command(argv)
    assert not verdict.ok
    assert "not allowed" in verdict.reason


GIT_BRANCH_MUTATOR_CASES = [
    ["git", "branch", "-D", "old"],
    ["git", "branch", "-d", "old"],
    ["git", "branch", "-M", "renamed"],
    ["git", "branch", "-m", "renamed"],
    ["git", "branch", "-f", "main", "HEAD"],
    ["git", "branch", "--delete", "old"],
]


@pytest.mark.parametrize("argv", GIT_BRANCH_MUTATOR_CASES, ids=lambda a: " ".join(a))
def test_git_branch_mutator_flag_rejects(argv):
    verdict = validate_command(argv)
    assert not verdict.ok
    assert "not allowed" in verdict.reason


def test_git_hash_object_write_rejects():
    verdict = validate_command(["git", "hash-object", "-w", "foo.txt"])
    assert not verdict.ok
    assert "not allowed" in verdict.reason


def test_git_missing_subcommand_rejects():
    verdict = validate_command(["git"])
    assert not verdict.ok
    assert "not allowed" in verdict.reason


# ── #348: python/python3 refuse a bare script-file argument ──────────────
# The stray run_git.py wrapper was invoked as a plain script file
# (`python run_git.py`), not via -m or -c. Refuse that unless the script
# lives under tests/ or scripts/ — the runtime's own test and script runs.

PYTHON_SCRIPT_FILE_REJECT_CASES = [
    ["python", "stray.py"],
    ["python3", "run_git.py"],
    ["python", "/tmp/evil.py"],
]


@pytest.mark.parametrize(
    "argv", PYTHON_SCRIPT_FILE_REJECT_CASES, ids=lambda a: " ".join(a)
)
def test_python_script_file_outside_allowlist_rejects(argv):
    verdict = validate_command(argv)
    assert not verdict.ok
    assert "command_guard_script_file" in verdict.reason


PYTHON_SCRIPT_FILE_ALLOW_CASES = [
    ["python", "-m", "pytest", "-q"],
    ["python3", "-c", "print(1)"],
    ["python", "tests/x.py"],
    ["python3", "scripts/run.py", "--flag"],
]


@pytest.mark.parametrize(
    "argv", PYTHON_SCRIPT_FILE_ALLOW_CASES, ids=lambda a: " ".join(a)
)
def test_python_script_file_under_allowlisted_dir_allows(argv):
    verdict = validate_command(argv)
    assert verdict.ok, verdict.reason
