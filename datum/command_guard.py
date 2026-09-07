"""Command-token allowlist for the run_command lane tool (issue #82, SEC-001).

Second layer on top of #97 (shlex.split + shell=False): the command token
must be on an explicit allowlist, and no token may carry shell
chaining/substitution metacharacters — standalone or embedded. With
shell=False those characters would be inert anyway; rejecting them
outright turns a silent no-op into a loud, auditable refusal and closes
the gap where an allowed binary itself interprets them.

``validate_command`` is a pure function: argv in, Verdict out. No
subprocess, no filesystem, no LLM. It is imported by
scripts/lane-tools/run_command.py and is independently testable.

Residual risk (pairs with tool risk classes, #77): wrapper commands on
the allowlist (``uv``, ``npx``, ``npm``) can launch other executables.
The allowlist bounds the entry point, not the transitive call tree.
"""

from __future__ import annotations

import posixpath
import re
from dataclasses import dataclass

# Toolchain entry points the act lanes legitimately need
# (references/04-act-{python,go,typescript,swift}.md), plus datum's own
# CLI and echo. Deliberately absent: shells, network fetchers, file
# mutators (rm/mv/chmod), git (commits go through the commit queue).
ALLOWED_COMMANDS = frozenset(
    {
        # datum's own CLI ("datum test" is the canonical test entry point)
        "datum",
        # python lane
        "pytest",
        "python",
        "python3",
        "uv",
        "ruff",
        # go lane
        "go",
        # swift lane
        "swift",
        # typescript lane
        "node",
        "npm",
        "npx",
        "tsc",
        "vitest",
        "jest",
        # harmless diagnostics
        "echo",
        # narrow, read-only git inspection (#348) — see _validate_git
        "git",
    }
)

# python3.12, python3.13t, ... — version-suffixed interpreters count as python.
_PYTHON_RE = re.compile(r"^python(\d+(\.\d+)?)?t?$")

# Chaining, redirection, and substitution vectors. Checked per-token as
# substrings, so both standalone (";") and embedded ("a;b") forms reject.
_METACHAR_SUBSTRINGS = (";", "|", "&", "<", ">", "`", "$(", "${", "\n", "\r")

# #348: git is on the allowlist but only for read-only inspection — the same
# boundary assets/hooks/pre-tool-use-read-only-bash.sh draws for read-only
# review agents. Anything that moves HEAD, writes objects/refs, or touches
# the index (checkout, commit, push, reset, ...) stays rejected; commits go
# through the commit queue, not ad hoc git calls from a lane tool.
_GIT_READONLY_SUBCOMMANDS = frozenset(
    {
        "status",
        "log",
        "diff",
        "show",
        "rev-parse",
        "merge-base",
        "ls-files",
        "branch",
        "hash-object",
    }
)

# `git branch` without a mutator flag just lists branches (read-only);
# these flags delete, rename, copy, or force-move a branch/ref.
_GIT_BRANCH_MUTATOR_FLAGS = frozenset(
    {
        "-d",
        "-D",
        "-m",
        "-M",
        "-f",
        "-c",
        "-C",
        "--delete",
        "--move",
        "--copy",
        "--force",
    }
)

# `git hash-object` without -w just prints the object id (read-only); -w
# writes the object into the object database.
_GIT_HASH_OBJECT_MUTATOR_FLAGS = frozenset({"-w", "--write"})


def _validate_git(argv: list[str]) -> Verdict:
    """Narrow read-only allowlist for the ``git`` command token (#348)."""
    if len(argv) < 2:
        return _reject("git subcommand not allowed: none given")

    sub = argv[1]
    if sub not in _GIT_READONLY_SUBCOMMANDS:
        allowed = ", ".join(sorted(_GIT_READONLY_SUBCOMMANDS))
        return _reject(f"git subcommand not allowed: {sub!r} (allowed: {allowed})")

    rest = argv[2:]
    if sub == "branch":
        for tok in rest:
            if tok in _GIT_BRANCH_MUTATOR_FLAGS:
                return _reject(
                    f"git branch mutator flag not allowed: {tok!r} "
                    f"(git branch is read-only listing here; deletion/rename/"
                    f"force-move go through the commit queue)"
                )
    if sub == "hash-object":
        for tok in rest:
            if tok in _GIT_HASH_OBJECT_MUTATOR_FLAGS:
                return _reject(
                    f"git hash-object flag not allowed: {tok!r} "
                    f"(-w writes into the object database; only the "
                    f"read-only id computation is allowed here)"
                )

    return Verdict(ok=True)


def _python_script_argument(argv: list[str]) -> str | None:
    """Return the bare script-file argument of a python invocation, if any.

    Skips flags and the arguments consumed by -c (inline code) and -m
    (module name) — neither is a filesystem path. The first remaining
    non-flag token, if any, is the script file the interpreter would run.
    """
    i = 1
    while i < len(argv):
        tok = argv[i]
        if tok in ("-c", "-m"):
            i += 2
            continue
        if tok.startswith("-"):
            i += 1
            continue
        return tok
    return None


# #348: the runtime's own test and script runs are allowed to invoke a
# script file directly; anything else must go through -m/-c or the
# allowlisted tools above.
_PYTHON_SCRIPT_ALLOWED_PREFIXES = ("tests/", "scripts/")


@dataclass(frozen=True)
class Verdict:
    """Outcome of validating one argv. ok=True means run it."""

    ok: bool
    reason: str = ""


def _reject(reason: str) -> Verdict:
    return Verdict(ok=False, reason=reason)


def validate_command(argv: list[str]) -> Verdict:
    """Validate a shlex-split argv against the allowlist and metachar rules.

    Pure function. Rejection classes:
    - empty argv
    - non-string token (malformed input)
    - shell metacharacter in any token (standalone or embedded)
    - command token (basename of argv[0]) not on the allowlist
    """
    if not argv:
        return _reject("empty command")

    for token in argv:
        if not isinstance(token, str):
            return _reject(f"invalid argv: non-string token {token!r}")
        for meta in _METACHAR_SUBSTRINGS:
            if meta in token:
                return _reject(
                    f"shell metacharacter in argument: {token!r} "
                    f"(chaining/substitution is never interpreted; "
                    f"run one plain command)"
                )

    command = posixpath.basename(argv[0])
    is_python = _PYTHON_RE.match(command) is not None
    if command not in ALLOWED_COMMANDS and not is_python:
        allowed = ", ".join(sorted(ALLOWED_COMMANDS))
        return _reject(f"command not allowed: {command!r} (allowed: {allowed})")

    if command == "git":
        return _validate_git(argv)

    if is_python:
        script = _python_script_argument(argv)
        if script is not None and not script.startswith(
            _PYTHON_SCRIPT_ALLOWED_PREFIXES
        ):
            return _reject(
                f"command_guard_script_file: python script argument {script!r} "
                f"is not allowed (only tests/ and scripts/ script files may be "
                f"run directly; use -m for a module or -c for inline code)"
            )

    return Verdict(ok=True)
