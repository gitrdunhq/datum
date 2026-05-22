#!/usr/bin/env python3
"""
test_ratchet.py — Deterministic pre-commit test-strengthening enforcement.

Rejects commits that delete, weaken, or skip-rename tests.
Run as a pre-commit hook via assets/hooks/pre-commit-test-ratchet.sh.

Usage:
  python3 scripts/test_ratchet.py --framework xctest
  python3 scripts/test_ratchet.py --framework vitest

Exit codes:
  0 — no violations
  2 — violation detected (commit blocked)
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def get_staged_diff() -> str:
    result = subprocess.run(
        ["git", "diff", "--cached", "--unified=0"],
        capture_output=True,
        text=True,
    )
    return result.stdout


def load_patterns(framework: str) -> dict:
    pattern_path = Path(f"scripts/test_ratchet/{framework}.toml")
    if not pattern_path.exists():
        return {
            "test_declarations": [],
            "assertion_patterns": [],
            "skip_patterns": [],
            "strict_to_loose": [],
        }

    try:
        import tomllib
    except ImportError:
        try:
            import tomli as tomllib  # type: ignore[import]
        except ImportError:
            return {
                "test_declarations": [],
                "assertion_patterns": [],
                "skip_patterns": [],
                "strict_to_loose": [],
            }

    with pattern_path.open("rb") as f:
        return tomllib.load(f)


def parse_diff_hunks(diff: str) -> list[dict]:
    """Split diff into per-file hunks with added/removed lines."""
    hunks = []
    current_file: dict | None = None

    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            path = line[6:]
            current_file = {"path": path, "added": [], "removed": []}
            hunks.append(current_file)
        elif current_file is not None:
            if line.startswith("-") and not line.startswith("---"):
                current_file["removed"].append(line[1:])
            elif line.startswith("+") and not line.startswith("+++"):
                current_file["added"].append(line[1:])

    return hunks


def is_test_file(path: str) -> bool:
    test_indicators = ["Test", "test", "Spec", "spec", "_test.", "_spec."]
    return any(ind in path for ind in test_indicators)


def check_removed_tests(hunk: dict, patterns: dict) -> list[str]:
    """Check for removed test declarations."""
    violations = []
    decl_patterns = patterns.get("test_declarations", [])
    if not decl_patterns:
        return violations

    removed_tests = set()
    added_tests = set()

    for line in hunk["removed"]:
        for pat in decl_patterns:
            m = re.search(pat, line)
            if m:
                removed_tests.add(m.group(0))

    for line in hunk["added"]:
        for pat in decl_patterns:
            m = re.search(pat, line)
            if m:
                added_tests.add(m.group(0))

    # Tests removed but not added back elsewhere in this file
    truly_removed = removed_tests - added_tests
    for test in truly_removed:
        violations.append(f"Removed test: '{test}' in {hunk['path']}")

    return violations


def check_deleted_assertions(hunk: dict, patterns: dict) -> list[str]:
    """Check for deleted assertion lines."""
    violations = []
    assertion_patterns = patterns.get("assertion_patterns", [])
    if not assertion_patterns:
        return violations

    removed_assertions = 0
    added_assertions = 0

    for line in hunk["removed"]:
        if any(re.search(pat, line) for pat in assertion_patterns):
            removed_assertions += 1

    for line in hunk["added"]:
        if any(re.search(pat, line) for pat in assertion_patterns):
            added_assertions += 1

    net_deleted = removed_assertions - added_assertions
    if net_deleted > 0:
        violations.append(
            f"Deleted {net_deleted} assertion(s) in {hunk['path']} "
            f"(removed {removed_assertions}, added {added_assertions})"
        )

    return violations


def check_weakened_assertions(hunk: dict, patterns: dict) -> list[str]:
    """Check for assertion weakening (strict → loose substitutions)."""
    violations = []
    strict_to_loose = patterns.get("strict_to_loose", [])
    if not strict_to_loose:
        return violations

    removed_text = "\n".join(hunk["removed"])
    added_text = "\n".join(hunk["added"])

    for pair in strict_to_loose:
        strict_pat = pair.get("strict", "")
        loose_pat = pair.get("loose", "")
        if not strict_pat or not loose_pat:
            continue

        had_strict = bool(re.search(strict_pat, removed_text))
        has_loose = bool(re.search(loose_pat, added_text))
        lost_strict = not bool(re.search(strict_pat, added_text))

        if had_strict and has_loose and lost_strict:
            violations.append(
                f"Weakened assertion in {hunk['path']}: "
                f"replaced '{strict_pat}' with '{loose_pat}'"
            )

    return violations


def check_skip_rename(hunk: dict, patterns: dict) -> list[str]:
    """Check for tests renamed to disabled/skip patterns without a follow-up issue."""
    violations = []
    skip_patterns = patterns.get("skip_patterns", [])
    if not skip_patterns:
        return violations

    for line in hunk["added"]:
        for pat in skip_patterns:
            if re.search(pat, line):
                # Allow if commit message references a follow-up issue
                # (We can't check commit message here, so we flag it and let the hook
                #  check the commit message separately)
                violations.append(
                    f"Test skip/disable in {hunk['path']}: '{line.strip()}' "
                    f"— add a follow-up issue reference in the commit message to allow"
                )

    return violations


def main() -> None:
    try:
        parser = argparse.ArgumentParser(description="Test ratchet — pre-commit hook")
        parser.add_argument("--framework", default="auto")
        parser.add_argument("--diff", help="Path to diff file (default: git staged diff)")
        args = parser.parse_args()

        if args.diff:
            diff = Path(args.diff).read_text()
        else:
            diff = get_staged_diff()

        if not diff.strip():
            sys.exit(0)

        hunks = parse_diff_hunks(diff)
        test_hunks = [h for h in hunks if is_test_file(h["path"])]

        if not test_hunks:
            sys.exit(0)

        framework = args.framework
        if framework == "auto":
            # Detect from file extensions
            paths = [h["path"] for h in test_hunks]
            if any(".swift" in p for p in paths):
                framework = "xctest"
            elif any((".ts" in p or ".js" in p) for p in paths):
                framework = "vitest"
            else:
                framework = "xctest"  # default

        patterns = load_patterns(framework)

        all_violations = []
        for hunk in test_hunks:
            all_violations.extend(check_removed_tests(hunk, patterns))
            all_violations.extend(check_deleted_assertions(hunk, patterns))
            all_violations.extend(check_weakened_assertions(hunk, patterns))
            all_violations.extend(check_skip_rename(hunk, patterns))

        if all_violations:
            print(
                json.dumps(
                    {
                        "passed": False,
                        "violations": all_violations,
                        "message": "Test ratchet: commit blocked. Tests may not be weakened or removed.",
                    }
                )
            )
            sys.exit(2)

        print(json.dumps({"passed": True, "message": "Test ratchet: no violations"}))
        sys.exit(0)
    except SystemExit:
        raise
    except Exception as e:
        print(f"WARNING: test_ratchet.py crashed ({e}). Failing open.", file=sys.stderr)
        sys.exit(0)


if __name__ == "__main__":
    main()
