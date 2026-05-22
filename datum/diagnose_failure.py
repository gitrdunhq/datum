#!/usr/bin/env python3
"""
diagnose_failure.py — Classify agent failures before retry escalation.

Returns ENVIRONMENTAL (fix in place, no retry budget consumed),
REASONING (enter retry ladder), or UNKNOWN (conservative retry + log).

Patterns are loaded from references/pattern-library.md at runtime, so the
library grows with each epic without requiring code changes here.

Usage:
  python3 scripts/diagnose_failure.py <log_file>
  python3 scripts/diagnose_failure.py --stdin
"""

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PATTERN_LIBRARY = REPO_ROOT / "references" / "pattern-library.md"

# ── Built-in fallback patterns ────────────────────────────────────────────────
# Used when pattern-library.md is absent. Tuples are (regex, cause) for
# hard/reasoning, (regex, cause, fix_hint) for environmental.

_BUILTIN_HARD_STOP = [
    (r"hook blocked|pre-commit hook.*failed.*layer.boundary", "hook_blocked_write"),
    (r"banned pattern detected", "hook_blocked_write"),
    (r"test_ratchet.*violation|ratchet.*commit blocked", "test_ratchet_violation"),
    (
        r"sandbox.violation|ulimit.*exceeded|network.*blocked.*sandbox",
        "lane_tool_sandbox_violation",
    ),
    (
        r"pip install|npm install|brew install|apt-get install",
        "external_dependency_install",
    ),
]

_BUILTIN_ENVIRONMENTAL = [
    (
        r"error: no such file or directory",
        "stale_path",
        "Re-resolve file path via GitNexus context",
    ),
    (r"cannot find .* in scope", "stub_not_committed", "Wait for upstream stub commit"),
    (
        r"use of unresolved identifier",
        "stub_not_committed",
        "Wait for upstream stub commit",
    ),
    (r"warning:.*auto-correctable", "lint_fixable", "Run: datum lint --fix; re-verify"),
    (
        r"exit code 124",
        "subagent_timeout",
        "Re-dispatch the single agent with same brief",
    ),
    (
        r"nothing to commit",
        "duplicate_commit",
        "Patch already applied; fetch HEAD and continue",
    ),
    (
        r"error: Your local changes would be overwritten",
        "dirty_working_tree",
        "Run: git stash; re-dispatch",
    ),
    (
        r"CONFLICT \(content\): Merge conflict",
        "merge_conflict_in_apply",
        "Fetch HEAD; rebase agent context",
    ),
    (
        r"error: patch failed|error: patch does not apply",
        "patch_apply_failed",
        "Fetch HEAD; rebase agent context",
    ),
    (
        r"format.*check.*failed|reformatted \d+ files",
        "format_mismatch",
        "Run: datum format; re-verify",
    ),
]

_BUILTIN_REASONING = [
    (r"Assertion failed.*expected.*got", "wrong_implementation"),
    (r"XCTAssertEqual.*failed", "wrong_implementation"),
    (r"expect\(.*\).*toBe.*received", "wrong_implementation"),
    (r"AC \d+ not satisfied|acceptance criteria.*not met", "ac_gap"),
    (r"lane.tool.*available.*not used", "tool_discovery_failure"),
    (r"test passes but.*not satisfied", "wrong_interpretation"),
]


def _load_library_patterns() -> tuple[list, list, list]:
    """Load patterns from pattern-library.md TOML blocks. Returns (hard, env, reasoning)."""
    if not PATTERN_LIBRARY.exists():
        return [], [], []

    try:
        import tomllib  # type: ignore[import]
    except ImportError:
        try:
            import tomli as tomllib  # type: ignore[import]
        except ImportError:
            return [], [], []

    content = PATTERN_LIBRARY.read_text()
    blocks = re.findall(r"```toml\n(.*?)```", content, re.DOTALL)

    hard: list = []
    env: list = []
    reasoning: list = []

    for block in blocks:
        try:
            data = tomllib.loads(block)
        except Exception:
            continue
        for p in data.get("patterns", []):
            regex = p.get("regex", "")
            cause = p.get("cause", "unknown")
            fix = p.get("fix_hint", "Investigate and fix environment before retrying")
            cls = p.get("classification", "UNKNOWN")
            if cls == "HARD_STOP":
                hard.append((regex, cause))
            elif cls == "ENVIRONMENTAL":
                env.append((regex, cause, fix))
            elif cls == "REASONING":
                reasoning.append((regex, cause))

    return hard, env, reasoning


def _get_patterns() -> tuple[list, list, list]:
    """Return (hard, env, reasoning) — library patterns first, builtins as fallback."""
    lib_hard, lib_env, lib_reasoning = _load_library_patterns()
    hard = lib_hard or _BUILTIN_HARD_STOP
    env = lib_env or _BUILTIN_ENVIRONMENTAL
    reasoning = lib_reasoning or _BUILTIN_REASONING
    return hard, env, reasoning


def classify(log_text: str) -> dict:
    hard_patterns, env_patterns, reasoning_patterns = _get_patterns()

    # Hard stops — never retried
    for pattern, cause in hard_patterns:
        if re.search(pattern, log_text, re.IGNORECASE | re.MULTILINE):
            return {
                "classification": "HARD_STOP",
                "cause": cause,
                "message": f"Hard stop detected: {cause}. No retry. Surface to user.",
            }

    # Environmental — fix in place, retry counter NOT incremented
    for entry in env_patterns:
        pattern, cause = entry[0], entry[1]
        fix_hint = (
            entry[2] if len(entry) > 2 else "Investigate environment before retrying"
        )
        if re.search(pattern, log_text, re.IGNORECASE | re.MULTILINE):
            return {
                "classification": "ENVIRONMENTAL",
                "cause": cause,
                "fix_hint": fix_hint,
                "message": f"Environmental failure ({cause}). Fix in place; retry counter NOT incremented.",
            }

    # Reasoning — enter retry ladder
    for pattern, cause in reasoning_patterns:
        if re.search(pattern, log_text, re.IGNORECASE | re.MULTILINE):
            return {
                "classification": "REASONING",
                "cause": cause,
                "message": f"Reasoning failure ({cause}). Enter retry ladder; increment counter.",
            }

    # Unknown — conservative retry + log for future classification
    return {
        "classification": "UNKNOWN",
        "cause": "unrecognized_pattern",
        "message": "Unknown failure. Enter retry ladder conservatively. Log to unknown-failures.json.",
    }


def log_unknown(log_text: str, run_id: str | None) -> None:
    """Append to unknown-failures.json for later review by learn_patterns.py."""
    if not run_id:
        return
    out = Path(f".datum/runs/{run_id}/unknown-failures.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    entries = json.loads(out.read_text()) if out.exists() else []
    entries.append(
        {
            "log_excerpt": log_text[:500],
            "timestamp": __import__("datetime")
            .datetime.now(__import__("datetime").timezone.utc)
            .isoformat(),
        }
    )
    out.write_text(json.dumps(entries, indent=2))


def append_errors_md(result: dict, log_text: str, run_id: str | None) -> None:
    """Persist REASONING and UNKNOWN failures to .datum/ERRORS.md for cross-epic memory.

    Plan phase step 0 reads this file alongside brief-defect history so future epics
    don't repeat approaches that already failed on the same files.
    """
    if result["classification"] not in ("REASONING", "UNKNOWN"):
        return

    import datetime

    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y-%m-%d %H:%M UTC"
    )
    errors_path = Path(".datum/ERRORS.md")
    errors_path.parent.mkdir(parents=True, exist_ok=True)

    header = (
        "# DATUM Error Log\n\nCross-epic failure memory. Read by Plan phase step 0.\n\n"
    )
    existing = errors_path.read_text() if errors_path.exists() else header

    entry_lines = [
        f"## [{timestamp}] {result['classification']} — {result['cause']}",
        f"**Run:** {run_id or 'unknown'}",
        f"**Cause:** {result['cause']}",
        f"**Message:** {result['message']}",
    ]
    if result.get("fix_hint"):
        entry_lines.append(f"**Fix hint:** {result['fix_hint']}")
    entry_lines.append(f"**Log excerpt:**\n```\n{log_text[:400].strip()}\n```")
    entry_lines.append("")

    errors_path.write_text(existing + "\n".join(entry_lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Classify agent failure for retry strategy"
    )
    parser.add_argument("log_file", nargs="?", help="Path to failure log")
    parser.add_argument("--stdin", action="store_true")
    parser.add_argument("--run-id", help="RUN_ID for logging unknown failures")
    args = parser.parse_args()

    if args.stdin or not args.log_file:
        log_text = sys.stdin.read()
    else:
        path = Path(args.log_file)
        if not path.exists():
            print(json.dumps({"error": f"Log file not found: {args.log_file}"}))
            sys.exit(1)
        log_text = path.read_text()

    result = classify(log_text)
    print(json.dumps(result, indent=2))

    if result["classification"] == "UNKNOWN" and args.run_id:
        log_unknown(log_text, args.run_id)

    append_errors_md(result, log_text, args.run_id)

    exit_codes = {"ENVIRONMENTAL": 0, "REASONING": 1, "HARD_STOP": 2, "UNKNOWN": 3}
    sys.exit(exit_codes.get(result["classification"], 3))


if __name__ == "__main__":
    main()
