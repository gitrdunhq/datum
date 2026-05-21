#!/usr/bin/env python3
"""
remediate.py — Meta Remediation Engine (WFC Port)

Ingests blocked review findings or security scan results and generates a structured
Remediation Package (Decision Table, Compatibility Rules, Wave Backlog) to guide
surgical fixes.

Usage:
  python3 scripts/remediate.py --run-id <RUN_ID> --findings <PATH_TO_JSON>
"""

import argparse
import json
import sys
from pathlib import Path

def generate_remediation_package(run_id: str, findings_path: str) -> None:
    p = Path(findings_path)
    if not p.exists():
        print(json.dumps({"error": f"Findings file not found: {findings_path}"}))
        sys.exit(1)

    try:
        data = json.loads(p.read_text())
    except json.JSONDecodeError:
        print(json.dumps({"error": "Failed to parse findings JSON."}))
        sys.exit(1)

    findings = data.get("findings", [])
    high_critical = [f for f in findings if f.get("severity", "").lower() in ("high", "critical")]

    if not high_critical:
        print(json.dumps({"status": "ok", "message": "No HIGH/CRITICAL findings to remediate."}))
        sys.exit(0)

    # Generate the Markdown artifact
    out_path = Path(f".datum/runs/{run_id}/REMEDIATION-PACKAGE.md")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    lines = [
        f"# Remediation Package (Run: {run_id})",
        "",
        "## Scope",
        f"Generated from {len(high_critical)} blocking HIGH/CRITICAL findings in {findings_path}.",
        "",
        "## Decision Table",
        "| Finding ID | Surface | Severity | Decision | Rationale |",
        "|---|---|---|---|---|"
    ]

    for f in high_critical:
        fid = f.get("id", "UNKNOWN")
        file = f.get("file", "unknown")
        sev = f.get("severity", "high")
        desc = f.get("description", "")
        # Very basic heuristics for Decision
        lines.append(f"| {fid} | `{file}` | **{sev.upper()}** | Must Fix | {desc} |")

    lines.extend([
        "",
        "## Compatibility Rules",
        "| Surface | Action | Class | Shim/Alias |",
        "|---|---|---|---|",
        "| *All listed* | Patch | compatible | N/A |",
        "",
        "## Wave Backlog",
        "| Wave | Description | Included Surfaces |",
        "|---|---|---|",
        "| Wave 1 | Immediate Security/Property Patches | All surfaces in Decision Table |",
        "",
        "## Next Handoff",
        "Execute Wave 1 via `04-act.md` targeted fix loops."
    ])

    out_path.write_text("\n".join(lines))
    print(json.dumps({
        "status": "remediation_packaged",
        "artifact": str(out_path),
        "high_critical_count": len(high_critical)
    }))

def main():
    parser = argparse.ArgumentParser(description="Generate a Remediation Package from findings.")
    parser.add_argument("--run-id", required=True, help="Current run ID.")
    parser.add_argument("--findings", required=True, help="Path to unified.json or sidecar JSON.")
    args = parser.parse_args()

    generate_remediation_package(args.run_id, args.findings)

if __name__ == "__main__":
    main()
