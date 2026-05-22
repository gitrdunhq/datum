#!/usr/bin/env python3
"""Pattern-match diffs to identify solved problems worth documenting."""

import json
import re
import subprocess
from pathlib import Path

SOLUTION_PATTERNS = [
    (r"new\s+(?:protocol|interface|adapter|layer)", "new_abstraction_layer"),
    (r"(?:extracted?|moved?)\s+\w+\s+(?:to|into)\s+\w+", "extraction_refactor"),
    (r"(?:replaced?|migrated?)\s+\w+\s+with\s+\w+", "migration"),
    (
        r"(?:fixed?|resolved?)\s+(?:race\s*condition|deadlock|memory\s*leak)",
        "concurrency_fix",
    ),
    (r"(?:added?|implemented?)\s+(?:caching|cache)", "caching_solution"),
    (r"(?:reduced?|eliminated?)\s+(?:n\+1|duplicate\s+quer)", "query_optimization"),
]


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--merge-sha", required=True)
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.collect-solutions.done")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    result = subprocess.run(
        ["git", "log", "--oneline", f"{args.base_sha}..{args.merge_sha}"],
        capture_output=True,
        text=True,
    )
    commit_messages = result.stdout

    solutions = []
    for pattern, slug in SOLUTION_PATTERNS:
        if re.search(pattern, commit_messages, re.IGNORECASE):
            solutions.append(
                {
                    "slug": slug,
                    "pattern": pattern,
                    "evidence": re.findall(pattern, commit_messages, re.IGNORECASE)[:3],
                }
            )

    out = Path(f".datum/runs/{args.run_id}/closeout-raw/solutions.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(solutions, indent=2))
    marker.write_text("done")
    print(json.dumps({"ok": True, "solutions_found": len(solutions)}))


if __name__ == "__main__":
    main()
