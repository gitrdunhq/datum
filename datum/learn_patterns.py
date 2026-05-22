#!/usr/bin/env python3
"""
learn_patterns.py — Grows the failure pattern library from unknown failures.

Reads .datum/runs/*/unknown-failures.json across all prior epics, clusters
similar entries by regex similarity, and proposes new TOML entries for
references/pattern-library.md.

Usage:
  python3 scripts/learn_patterns.py --review        # print proposed patterns
  python3 scripts/learn_patterns.py --stats         # show unknown failure counts
  python3 scripts/learn_patterns.py --brief-defects # summarize brief defects for Plan
"""

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

RUNS_DIR = Path(".datum/runs")
REPO_ROOT = Path(__file__).resolve().parent.parent
PATTERN_LIBRARY = REPO_ROOT / "skills" / "datum-workflow" / "references" / "pattern-library.md"


def load_unknown_failures() -> list[dict]:
    failures = []
    if not RUNS_DIR.exists():
        return failures
    for run_dir in RUNS_DIR.iterdir():
        uf_path = run_dir / "unknown-failures.json"
        if uf_path.exists():
            try:
                entries = json.loads(uf_path.read_text())
                for entry in (entries if isinstance(entries, list) else []):
                    entry["run_id"] = run_dir.name
                    failures.append(entry)
            except (json.JSONDecodeError, OSError):
                pass
    return failures


def load_brief_defects() -> list[dict]:
    defects = []
    if not RUNS_DIR.exists():
        return defects
    for run_dir in RUNS_DIR.iterdir():
        cd_path = run_dir / "closeout-data.json"
        if cd_path.exists():
            try:
                data = json.loads(cd_path.read_text())
                for defect in data.get("brief_defects", []):
                    defect["run_id"] = run_dir.name
                    defects.append(defect)
            except (json.JSONDecodeError, OSError):
                pass
    return defects


def normalize_log(log_text: str) -> str:
    """Strip file paths, line numbers, and hex addresses for clustering."""
    text = re.sub(r"/[^\s:]+:\d+", "<path>", log_text)
    text = re.sub(r"0x[0-9a-fA-F]+", "<addr>", text)
    text = re.sub(r"\b\d{4,}\b", "<num>", text)
    return text.lower().strip()[:200]


def cluster_by_first_line(failures: list[dict]) -> dict[str, list[dict]]:
    clusters: dict[str, list[dict]] = defaultdict(list)
    for f in failures:
        log = f.get("log_excerpt", f.get("error", ""))
        key = normalize_log(log.splitlines()[0] if log else "")
        clusters[key].append(f)
    return dict(clusters)


def propose_patterns(clusters: dict[str, list[dict]]) -> list[str]:
    proposals = []
    for key, entries in sorted(clusters.items(), key=lambda x: -len(x[1])):
        if len(entries) < 2:
            continue  # single occurrence — not worth promoting yet
        sample = entries[0].get("log_excerpt", entries[0].get("error", key))
        # Escape for regex
        escaped = re.escape(key[:60]).replace(r"\ ", r"\s+")
        toml = f"""# Seen {len(entries)} time(s) across {len({e["run_id"] for e in entries})} epic(s)
# Sample: {sample[:120]!r}
[[patterns]]
regex = "{escaped}"
classification = "ENVIRONMENTAL"  # or REASONING — review before committing
cause = "unknown_{abs(hash(key)) % 10000}"
fix_hint = "TODO: describe the fix"
"""
        proposals.append(toml)
    return proposals


def summarize_brief_defects(defects: list[dict]) -> str:
    if not defects:
        return "No brief defects found in prior epics."

    by_ac: Counter = Counter()
    by_stage: Counter = Counter()
    for d in defects:
        ac = d.get("missing_ac", "unknown")
        by_ac[ac[:80]] += 1
        by_stage[d.get("surfaced_by_stage", "unknown")] += 1

    lines = [
        f"Brief defects across {len({d['run_id'] for d in defects})} prior epic(s): {len(defects)} total",
        "",
        "Most common missing ACs (plan more explicitly for these):",
    ]
    for ac, count in by_ac.most_common(10):
        lines.append(f"  {count}x  {ac}")

    lines += ["", "Surfaced by stage:"]
    for stage, count in by_stage.most_common():
        lines.append(f"  {stage}: {count}")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Grow the failure pattern library")
    parser.add_argument("--review", action="store_true", help="Print proposed patterns")
    parser.add_argument(
        "--stats", action="store_true", help="Show unknown failure counts"
    )
    parser.add_argument(
        "--brief-defects", action="store_true", help="Summarize brief defects"
    )
    args = parser.parse_args()

    if args.brief_defects:
        defects = load_brief_defects()
        print(summarize_brief_defects(defects))
        return

    failures = load_unknown_failures()

    if args.stats:
        by_run: Counter = Counter(f["run_id"] for f in failures)
        print(
            json.dumps(
                {
                    "total_unknown_failures": len(failures),
                    "by_run": dict(by_run.most_common()),
                },
                indent=2,
            )
        )
        return

    if args.review:
        if not failures:
            print("No unknown failures found. Nothing to learn.")
            return
        clusters = cluster_by_first_line(failures)
        proposals = propose_patterns(clusters)
        if not proposals:
            print(
                f"Found {len(failures)} unknown failure(s) but none appear more than once. Check back after more epics."
            )
            return
        print(f"# Proposed patterns from {len(failures)} unknown failure(s)\n")
        print(
            "# Review each entry. Change classification and fix_hint before adding to references/pattern-library.md\n"
        )
        for p in proposals:
            print(p)
        return

    parser.print_help()


if __name__ == "__main__":
    main()
