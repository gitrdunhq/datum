#!/usr/bin/env python3
"""Contract preflight for a TDD lane (#356).

A RED test can contradict a contract that already exists in a file the lane's
GREEN agent is not allowed to write — e.g. it constructs a dataclass without
one of its required fields. GREEN then cannot pass no matter what it writes
inside ``allowed_write_files``: the failing line is in the test body (forbidden
for GREEN) and the dataclass lives outside the lane. Before this module the
lane retried the identical file list three times and then escalated to a
human by hand.

This module runs the lane's test files once with pytest, parses the short
tracebacks, and reports every ``TypeError``/``AttributeError`` that

* was **raised inside** a file GREEN cannot write (``raised_in_unwritable_file``),
  or
* is a call-signature ``TypeError`` against a symbol whose every definition
  lives in a file GREEN cannot write (``signature_mismatch``).

A plain ``AttributeError: module 'x' has no attribute 'new_fn'`` at the test
line is the ordinary RED signal and is never reported.

The result is a typed JSON document the workflow scripts consume:

    {"status": "ok" | "contract_conflict" | "skipped",
     "conflicts": [...], "needs_write": [...], "reason": "...",
     "pytest_exit_code": N}

Usage (the lane runner calls this once after RED is verified, and again
after a failed GREEN attempt to decide "blocked" vs "retry"):

    python -m datum.contract_preflight --repo <wt> --test-file tests/test_x.py \
        --allowed pkg/a.py --allowed pkg/b.py --test-command "uv run pytest -x -q"
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

CONTRACT_ERROR_TYPES = ("TypeError", "AttributeError")
PYTEST_TIMEOUT_S = 600
_SKIP_DIRS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    ".temp",
    "__pycache__",
    "build",
    "dist",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
}

_SECTION_RE = re.compile(r"^_{3,}\s+(?P<test>.+?)\s+_{3,}$")
_FRAME_RE = re.compile(r"^(?P<path>[^\s:]+?\.py):(?P<line>\d+): in (?P<func>\S+)$")
_ERROR_RE = re.compile(
    r"^E\s+(?P<type>[A-Za-z_][\w.]*(?:Error|Exception|Warning)):\s?(?P<msg>.*)$"
)
_TYPE_ERROR_SYMBOL_RE = re.compile(
    r"^(?:(?P<cls>\w+)\.)?(?P<fn>\w+)\(\)\s+(?:missing|takes|got an unexpected|got multiple|got some)"
)


@dataclass
class PytestFailure:
    test: str
    error_type: str | None = None
    message: str = ""
    frames: list[tuple[str, int, str]] = field(default_factory=list)

    @property
    def origin_file(self) -> str | None:
        return self.frames[-1][0] if self.frames else None


def parse_pytest_output(output: str) -> list[PytestFailure]:
    """Parse ``pytest --tb=short`` output into one failure per section.

    Frames are listed outermost-first, so the last frame is where the
    exception was raised. The error type/message is the first ``E   Type:``
    line in the section; plain assertion failures have no error type.
    """
    failures: list[PytestFailure] = []
    current: PytestFailure | None = None
    for raw in output.splitlines():
        line = raw.rstrip("\n")
        section = _SECTION_RE.match(line)
        if section:
            current = PytestFailure(test=section.group("test").split("[")[0].strip())
            failures.append(current)
            continue
        if current is None:
            continue
        frame = _FRAME_RE.match(line)
        if frame and current.error_type is None:
            current.frames.append(
                (frame.group("path"), int(frame.group("line")), frame.group("func"))
            )
            continue
        err = _ERROR_RE.match(line)
        if err and current.error_type is None:
            current.error_type = err.group("type").split(".")[-1]
            current.message = err.group("msg").strip()
    return failures


def symbol_from_type_error(message: str) -> str | None:
    """Name the callable a call-signature TypeError is about.

    ``X.__init__() missing ...`` -> ``X`` (the class is the contract);
    ``f() got an unexpected keyword argument`` -> ``f``. Messages that are not
    about a call signature (``'NoneType' object is not callable``) yield None.
    """
    m = _TYPE_ERROR_SYMBOL_RE.match(message.strip())
    if not m:
        return None
    cls, fn = m.group("cls"), m.group("fn")
    if cls and fn == "__init__":
        return cls
    return cls or fn


def pytest_runner_from_test_command(test_command: str) -> list[str] | None:
    """Return the argv prefix up to and including the ``pytest`` token.

    ``uv run pytest -x -q`` -> ``["uv", "run", "pytest"]`` so the preflight
    runs pytest through the same environment the lane uses, with its own
    flags. A command with no ``pytest`` token (vitest, swift test, ...) is not
    supported: return None so the caller reports ``skipped``.
    """
    try:
        argv = shlex.split(test_command)
    except ValueError:
        return None
    for i, tok in enumerate(argv):
        if tok == "pytest" or tok.endswith("/pytest"):
            return argv[: i + 1]
    return None


def _norm(path: str, repo: Path) -> str:
    p = Path(path)
    if p.is_absolute():
        try:
            return p.resolve().relative_to(repo.resolve()).as_posix()
        except ValueError:
            return p.as_posix()
    return p.as_posix()


def _is_writable(path: str, allowed_files: list[str]) -> bool:
    """Path-boundary match mirroring shared/utils.ts pathBoundaryMatch."""
    for a in allowed_files:
        a = a.rstrip("/")
        if path == a or path.startswith(a + "/"):
            return True
    return False


def find_symbol_definitions(repo: Path, symbol: str) -> list[str]:
    """Repo-relative paths of every ``class``/``def`` named ``symbol``."""
    pattern = re.compile(rf"^\s*(?:class|def|async def)\s+{re.escape(symbol)}\b")
    found: list[str] = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = sorted(d for d in dirs if d not in _SKIP_DIRS)
        for name in sorted(files):
            if not name.endswith(".py"):
                continue
            fp = Path(root) / name
            try:
                text = fp.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if any(pattern.match(line) for line in text.splitlines()):
                found.append(fp.relative_to(repo).as_posix())
    return found


def classify_conflicts(
    failures: list[PytestFailure],
    repo: Path,
    test_files: list[str],
    allowed_files: list[str],
) -> list[dict]:
    """Which failures prove the RED test contradicts an unwritable contract."""
    repo = Path(repo)
    tests = {_norm(t, repo) for t in test_files}
    conflicts: list[dict] = []
    for f in failures:
        if f.error_type not in CONTRACT_ERROR_TYPES:
            continue
        origin = _norm(f.origin_file, repo) if f.origin_file else None
        base = {
            "test": f.test,
            "error_type": f.error_type,
            "message": f.message,
            "origin_file": origin,
            "symbol": None,
        }
        if origin and origin not in tests and not _is_writable(origin, allowed_files):
            conflicts.append(
                {**base, "kind": "raised_in_unwritable_file", "defined_in": [origin]}
            )
            continue
        if f.error_type != "TypeError":
            continue
        symbol = symbol_from_type_error(f.message)
        if not symbol:
            continue
        defs = find_symbol_definitions(repo, symbol)
        if not defs:
            continue  # brand-new symbol: GREEN creates it
        if any(_is_writable(d, allowed_files) for d in defs):
            continue  # GREEN can change the contract itself
        conflicts.append(
            {
                **base,
                "symbol": symbol,
                "kind": "signature_mismatch",
                "defined_in": defs,
            }
        )
    return conflicts


def run_contract_preflight(
    repo: Path | str,
    test_files: list[str],
    allowed_files: list[str],
    test_command: str,
    timeout_s: int = PYTEST_TIMEOUT_S,
) -> dict:
    """Run the lane's test files once and classify contract conflicts."""
    repo = Path(repo)
    runner = pytest_runner_from_test_command(test_command)
    if runner is None:
        return {
            "status": "skipped",
            "conflicts": [],
            "needs_write": [],
            "reason": f"contract preflight only supports pytest lanes; test_command has no pytest token: {test_command!r}",
            "pytest_exit_code": None,
        }
    argv = [*runner, "--tb=short", "-q", "-p", "no:cacheprovider", *test_files]
    try:
        proc = subprocess.run(
            argv,
            cwd=repo,
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired:
        return {
            "status": "skipped",
            "conflicts": [],
            "needs_write": [],
            "reason": f"pytest timed out after {timeout_s}s",
            "pytest_exit_code": None,
        }
    except OSError as exc:
        return {
            "status": "skipped",
            "conflicts": [],
            "needs_write": [],
            "reason": f"could not run {argv[0]}: {exc}",
            "pytest_exit_code": None,
        }
    failures = parse_pytest_output(proc.stdout + "\n" + proc.stderr)
    conflicts = classify_conflicts(failures, repo, test_files, allowed_files)
    needs_write = sorted({p for c in conflicts for p in c["defined_in"]})
    if conflicts:
        summary = "; ".join(
            f"{c['test']}: {c['error_type']}: {c['message']} "
            f"({c['kind']}, defined in {', '.join(c['defined_in'])})"
            for c in conflicts
        )
        reason = (
            "RED test contradicts an existing contract GREEN cannot write — " + summary
        )
        status = "contract_conflict"
    else:
        reason = ""
        status = "ok"
    return {
        "status": status,
        "conflicts": conflicts,
        "needs_write": needs_write,
        "reason": reason,
        "pytest_exit_code": proc.returncode,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--repo", required=True, help="Lane worktree path")
    parser.add_argument(
        "--test-file", action="append", default=[], help="RED test file (repeatable)"
    )
    parser.add_argument(
        "--allowed",
        action="append",
        default=[],
        help="File GREEN may write (repeatable; allowed_write_files)",
    )
    parser.add_argument("--test-command", required=True, help="The lane's test command")
    parser.add_argument("--output", help="Also write the JSON result here")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    result = run_contract_preflight(
        Path(args.repo), args.test_file, args.allowed, args.test_command
    )
    text = json.dumps(result, indent=2)
    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text)
    print(text)
    sys.exit(1 if result["status"] == "contract_conflict" else 0)


if __name__ == "__main__":
    main()
