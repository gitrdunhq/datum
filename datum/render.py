#!/usr/bin/env python3
"""
render.py — Deterministic report renderer. Converts JSON packets to markdown.

This is a script, not an LLM. All rendering is deterministic.

Usage:
  python3 scripts/render.py --packets .datum/runs/<RUN_ID>/review-packets/ --output REVIEW-REPORT.md
  python3 scripts/render.py --closeout-data .datum/runs/<RUN_ID>/closeout-data.json --output RETRO.md
"""

import argparse
import json
import re
import sys
from pathlib import Path

SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2, "info": 3}
SEVERITY_LABEL = {
    "high": "[HIGH]",
    "medium": "[MEDIUM]",
    "low": "[LOW]",
    "info": "[INFO]",
}

# Lane-commit conventions written by skills/src/shared/agents.ts's
# commitStage() — e.g. "red(some-task): RED complete". Used as a git-derived
# fallback for the RETRO.md Delivery section when live lane-state wasn't
# collected (#302).
_GREEN_COMMIT_RE = re.compile(r"\bgreen\(([^)]+)\)")
_RED_COMMIT_RE = re.compile(r"\bred\(([^)]+)\)")


def _git_derived_delivery(git: dict) -> dict | None:
    """Derive a Delivery-section proxy from the git collector's commit log.

    Reuses the same `git.commits` list (already collected via `git log
    base_sha..merge_sha --oneline` by datum/closeout/collect_git.py — the
    same collector that feeds the Change Size section) instead of running a
    second git-log query. A task is counted "completed" if it has a
    `green(<task>)` lane commit; "total" is every task id seen in a
    `red(<task>)` or `green(<task>)` commit (red-only tasks are proxy
    failures/incomplete work).
    """
    commits = git.get("commits") or []
    if not commits:
        return None

    green_tasks: set[str] = set()
    red_tasks: set[str] = set()
    for line in commits:
        m = _GREEN_COMMIT_RE.search(line)
        if m:
            green_tasks.add(m.group(1))
        m = _RED_COMMIT_RE.search(line)
        if m:
            red_tasks.add(m.group(1))

    all_tasks = red_tasks | green_tasks
    if not all_tasks:
        return None

    completed = len(green_tasks)
    total = len(all_tasks)
    return {
        "completed": completed,
        "total": total,
        "failed_terminal": total - completed,
        "say_do_ratio": round(completed / total, 3) if total else 0,
    }


def render_review_report(packets_dir: Path, output_path: Path) -> None:
    packets_dir_obj = Path(packets_dir)
    if not packets_dir_obj.exists():
        print(json.dumps({"error": f"{packets_dir} not found"}))
        sys.exit(1)

    all_findings: list[dict] = []
    domains: list[str] = []

    for packet_path in sorted(packets_dir_obj.glob("*.json")):
        with packet_path.open() as f:
            packet = json.load(f)
        domain = packet.get("domain", packet_path.stem)
        domains.append(domain)
        for finding in packet.get("findings", []):
            finding["domain"] = domain
            all_findings.append(finding)

    # Sort by severity
    all_findings.sort(
        key=lambda f: (
            SEVERITY_ORDER.get(f.get("severity", "info"), 99),
            f.get("file", ""),
        )
    )

    high = [f for f in all_findings if f.get("severity") == "high"]
    medium = [f for f in all_findings if f.get("severity") == "medium"]
    low_info = [f for f in all_findings if f.get("severity") in ("low", "info")]

    lines = [
        "# Review Report",
        "",
        f"**Domains reviewed:** {', '.join(domains)}",
        f"**Total findings:** {len(all_findings)} "
        f"({len(high)} high, {len(medium)} medium, {len(low_info)} low/info)",
        "",
    ]

    if not all_findings:
        lines.append("No findings. All domains passed review.")
    else:
        for severity, group in [
            ("High", high),
            ("Medium", medium),
            ("Low / Info", low_info),
        ]:
            if not group:
                continue
            lines.append(f"## {severity} Severity")
            lines.append("")
            for f in group:
                label = SEVERITY_LABEL.get(f.get("severity", "info"), "")
                fid = f.get("id", "?")
                domain = f.get("domain", "?")
                file_ref = f.get("file", "")
                line_ref = f.get("line", "")
                loc = (
                    f"{file_ref}:{line_ref}"
                    if file_ref and line_ref
                    else file_ref or ""
                )
                desc = f.get("description", "")
                suggestion = f.get("suggestion", "")

                lines.append(f"### {label} {fid} [{domain}]")
                if loc:
                    lines.append(f"**Location:** `{loc}`")
                lines.append(f"**Description:** {desc}")
                if suggestion:
                    lines.append(f"**Suggestion:** {suggestion}")
                lines.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines))
    print(
        json.dumps(
            {"ok": True, "output": str(output_path), "findings": len(all_findings)}
        )
    )


def render_closeout_retro(closeout_data: Path, output_path: Path) -> None:
    if not closeout_data.exists():
        print(json.dumps({"error": f"{closeout_data} not found"}))
        sys.exit(1)

    data = json.loads(closeout_data.read_text())
    tasks = data.get("tasks") or {}
    git = data.get("git") or {}
    token_metrics = data.get("token_metrics") or {}
    brief_defects = data.get("brief_defects") or []
    lane_tools = data.get("lane_tools") or {}
    solutions = data.get("solutions") or []

    # Live lane-state (via collect_tasks.py) is the authoritative source for
    # Delivery numbers. When it wasn't collected (e.g. closeout run against a
    # branch whose work was done by hand, or a run-id with no state.json),
    # `tasks.total` is 0 even though real work landed — fall back to a
    # git-derived proxy instead of silently reporting 0/0 (#302).
    delivery_source = "lane-state"
    if not tasks.get("total"):
        git_delivery = _git_derived_delivery(git)
        if git_delivery is not None:
            tasks = git_delivery
            delivery_source = "git-derived"

    lines = [
        "# DATUM Retro",
        "",
        f"**Run:** {data.get('run_id', 'unknown')}",
        f"**Merge SHA:** {data.get('merge_sha', 'unknown')}",
        "",
        "## Delivery",
        "",
    ]
    if delivery_source == "git-derived":
        lines.append(
            "_Derived from git history (lane-state unavailable) — "
            "commit-based proxy, not live pipeline data._"
        )
        lines.append("")
    lines += [
        f"- Tasks completed: {tasks.get('completed', 0)} / {tasks.get('total', 0)}",
        f"- Failed terminal lanes: {tasks.get('failed_terminal', 0)}",
        f"- Say:do ratio: {tasks.get('say_do_ratio', 0)}",
        "",
        "## Change Size",
        "",
        f"- Commits: {git.get('commit_count', 0)}",
        f"- Files touched: {len(git.get('files_touched', []))}",
        f"- LOC net: {git.get('loc_net', 0)}",
        "",
        "## Reliability Signals",
        "",
        f"- Brief defects: {len(brief_defects)}",
        f"- Lane tools added: {len(lane_tools.get('lane_tools_added', [])) if isinstance(lane_tools, dict) else 0}",
        f"- Tokens total: {token_metrics.get('total', 0)}",
        "",
        "## Solutions Detected",
        "",
    ]

    if solutions:
        for solution in solutions:
            if isinstance(solution, dict):
                lines.append(f"- {solution.get('slug', 'solution')}")
    else:
        lines.append("- None detected")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n")
    print(json.dumps({"ok": True, "output": str(output_path)}))


def main() -> None:
    parser = argparse.ArgumentParser(description="Deterministic report renderer")
    parser.add_argument("--packets", help="Directory of review packet JSON files")
    parser.add_argument("--closeout-data", help="Path to closeout-data.json")
    parser.add_argument("--output", required=True, help="Output markdown file")
    args = parser.parse_args()

    output = Path(args.output)

    if args.packets:
        render_review_report(Path(args.packets), output)
    elif args.closeout_data:
        render_closeout_retro(Path(args.closeout_data), output)
    else:
        print(json.dumps({"error": "Specify --packets or --closeout-data"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
