#!/usr/bin/env python3
"""
Parse all PROPERTIES.md files across epics, extract predicates,
deduplicate by semantic similarity, and surface invariants that
appear in 2+ epics as candidates for INVARIANTS.md.

Usage:
  python3 -m datum.analyze_properties [--threshold 2] [--output docs/architecture/INVARIANTS.md]

Adapted from the-record-suite/scripts/analyze_properties.py.
"""

from __future__ import annotations

import argparse
import os
import re
from collections import defaultdict
from pathlib import Path


def extract_predicates(content: str) -> list[str]:
    predicates: list[str] = []

    lines = content.split("\n")
    for line in lines:
        if "|" not in line or not re.search(r"[A-Z]{3,5}-\d+", line):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 4:
            continue
        if not re.match(r"[A-Z]{3,5}-\d+", parts[1]):
            continue
        categories = {
            "SAFETY",
            "LIVENESS",
            "INVARIANT",
            "BOUNDARY",
            "IDEMPOTENT",
            "ORDERING",
            "ISOLATION",
            "PERFORMANCE",
            "SECURITY",
            "OBSERVABILITY",
            "COMPATIBILITY",
        }
        if parts[2].upper() in categories:
            predicates.append(parts[3])
        else:
            predicates.append(parts[2])

    code_matches = re.findall(
        r"[A-Z]+\([A-Z]+-\d+\):\s*(.*?)(?:\n\s*\n|\n\s*Status:|\n\s*```|\n\s*Verified_by:)",
        content,
        re.DOTALL,
    )
    predicates.extend(m.strip() for m in code_matches)

    cleaned = []
    for p in predicates:
        p = p.strip().strip("`").strip(".")
        if not p:
            continue
        if p.lower() in {"predicate", "category", "id", "short", "predicate (short)"}:
            continue
        if re.match(r"task-\d+", p.lower()):
            continue
        cleaned.append(p)
    return cleaned


def get_epic_name(path: str) -> str:
    parts = path.split(os.sep)
    if "epics" in parts:
        idx = parts.index("epics")
        remaining = parts[idx + 1 :]
        return "/".join(remaining[:-1])  # drop the filename
    return "root"


def normalize(p: str) -> str:
    p = p.lower()
    p = re.sub(r"[^a-z0-9]", " ", p)
    return re.sub(r"\s+", " ", p).strip()


DATUM_GROUPINGS: list[tuple[list[str], str]] = [
    (
        ["backward compat", "identical output", "plain list", "existing.*still work"],
        "Backward compatibility — new features must not break existing input formats",
    ),
    (
        ["gate.*json", "valid json", "output.*json"],
        "Gate output is always valid JSON — every gate function returns parseable JSON to stdout",
    ),
    (
        ["never route", "classifier never", "never.*express"],
        "Classifier safety — System-tier never misrouted to lightweight pipeline",
    ),
    (
        ["cache hit", "cache.*skip", "idempotent.*scan"],
        "Cache idempotency — repeated operations with unchanged input produce identical output",
    ),
    (
        ["cyclic", "acyclic", "dependency.*graph"],
        "DAG integrity — all dependency graphs validated as acyclic before use",
    ),
]


def group_predicates(
    epic_predicates: dict[str, set[str]],
) -> dict[str, set[str]]:
    grouped: dict[str, set[str]] = defaultdict(set)

    for predicate, epics in epic_predicates.items():
        norm = normalize(predicate)
        matched = False
        for patterns, label in DATUM_GROUPINGS:
            if any(re.search(pat, norm) for pat in patterns):
                grouped[label].update(epics)
                matched = True
                break
        if not matched:
            grouped[predicate].update(epics)

    return grouped


def render_invariants(grouped: dict[str, set[str]], threshold: int) -> str:
    invariants = [
        (pred, len(epics)) for pred, epics in grouped.items() if len(epics) >= threshold
    ]
    invariants.sort(key=lambda x: x[1], reverse=True)

    lines = [
        "# Codebase-Wide Invariants",
        "",
        "These invariants appear across multiple epics and are candidates for",
        "promotion to permanent, non-negotiable rules. Promoted invariants should",
        "reference the corresponding ADR.",
        "",
    ]

    if not invariants:
        lines.append(
            f"*No invariants found at threshold {threshold}. "
            f"Run again after more epics complete.*"
        )
        return "\n".join(lines)

    for i, (pred, count) in enumerate(invariants, 1):
        lines.append(f"## {i}. {pred}")
        lines.append(f"*Appears in {count} epic(s)*")
        lines.append("")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract cross-epic invariants from PROPERTIES.md files"
    )
    parser.add_argument(
        "--threshold",
        type=int,
        default=2,
        help="Minimum epic count to promote (default: 2)",
    )
    parser.add_argument(
        "--output",
        default="docs/architecture/INVARIANTS.md",
        help="Output path (default: docs/architecture/INVARIANTS.md)",
    )
    args = parser.parse_args()

    epic_predicates: dict[str, set[str]] = defaultdict(set)

    for root, _dirs, files in os.walk("."):
        for f in files:
            if f != "PROPERTIES.md":
                continue
            path = os.path.join(root, f)
            content = Path(path).read_text()
            epic = get_epic_name(path)
            for pred in extract_predicates(content):
                epic_predicates[pred].add(epic)

    grouped = group_predicates(epic_predicates)
    markdown = render_invariants(grouped, args.threshold)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(markdown)

    print(
        f"Wrote {args.output} ({len(grouped)} predicates, threshold={args.threshold})"
    )


if __name__ == "__main__":
    main()
