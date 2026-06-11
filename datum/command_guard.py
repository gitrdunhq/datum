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
    }
)

# python3.12, python3.13t, ... — version-suffixed interpreters count as python.
_PYTHON_RE = re.compile(r"^python(\d+(\.\d+)?)?t?$")

# Chaining, redirection, and substitution vectors. Checked per-token as
# substrings, so both standalone (";") and embedded ("a;b") forms reject.
_METACHAR_SUBSTRINGS = (";", "|", "&", "<", ">", "`", "$(", "${", "\n", "\r")


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
    if command not in ALLOWED_COMMANDS and not _PYTHON_RE.match(command):
        allowed = ", ".join(sorted(ALLOWED_COMMANDS))
        return _reject(f"command not allowed: {command!r} (allowed: {allowed})")

    return Verdict(ok=True)
