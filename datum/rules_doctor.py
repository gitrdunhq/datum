#!/usr/bin/env python3
"""
rules-doctor.py — Deterministic preflight for agents.

Answers:
  What rules apply to this task, path, role, host, and phase?
  What is enforced already?
  What is missing or conflicting?

Usage:
  python3 scripts/rules-doctor.py preflight [--phase <phase>] [--role <role>]
"""

import argparse
import json
import sys
from pathlib import Path

# Built-in rules from newDrug architecture
RULES = [
    {
        "id": "R-DOCS-ONLY",
        "summary": "Documentation-only phases (like Discover, Refine, Research) cannot create runtime artifacts",
        "blocking": True
    },
    {
        "id": "R-NO-SPACES",
        "summary": "New paths must not contain spaces",
        "blocking": True
    },
    {
        "id": "R-RESEARCH-NO-CODE",
        "summary": "Research outputs cannot implement runtime code",
        "blocking": True
    },
    {
        "id": "R-DESIGN-NO-RUNTIME",
        "summary": "Design outputs (Plan) cannot implement runtime files",
        "blocking": True
    },
    {
        "id": "R-TDD-RED-FIRST",
        "summary": "RED proof must exist before GREEN starts",
        "blocking": True
    },
    {
        "id": "R-TDD-SCOPE",
        "summary": "RED test-only, GREEN source-only",
        "blocking": True
    },
    {
        "id": "R-DUCKDB-SINGLE-WRITER",
        "summary": "DuckDB/Ledger is not a multi-writer agent bus",
        "blocking": False
    },
    {
        "id": "R-MANAGER-EVENT",
        "summary": "Manager intervention creates auditable event in practice ledger",
        "blocking": False
    }
]

def check_phase_conflicts(phase: str, role: str) -> list[dict]:
    conflicts = []
    
    # R-DOCS-ONLY checks
    docs_only_phases = ["discover", "refine", "research", "architect"]
    if phase in docs_only_phases and role in ["green", "red", "refactor"]:
        conflicts.append({
            "higher_rule": "R-DOCS-ONLY",
            "lower_rule": f"Task requested {role} role in docs-only phase.",
            "resolution": "Block and ask for explicit phase promotion."
        })
        
    if phase == "research" and role != "researcher":
        conflicts.append({
            "higher_rule": "R-RESEARCH-NO-CODE",
            "lower_rule": f"Task attempted implementation in {phase} phase.",
            "resolution": "Block implementation. Write ADR or findings and promote to Plan."
        })
        
    return conflicts

def do_preflight(phase: str, role: str) -> None:
    print(f"Running rules-doctor preflight [Phase: {phase}, Role: {role}]...\n")
    
    conflicts = check_phase_conflicts(phase, role)
    
    result = {
        "status": "blocked" if conflicts else "pass",
        "applicable_rules": [r for r in RULES if r["blocking"]],
        "conflicts": conflicts
    }
    
    print(json.dumps(result, indent=2))
    
    if conflicts:
        print("\n[ERROR] Conflicts detected. Action BLOCKED.", file=sys.stderr)
        sys.exit(1)
    else:
        print("\n[OK] Preflight passed.", file=sys.stderr)
        sys.exit(0)

def main():
    parser = argparse.ArgumentParser(description="Rules Doctor - Deterministic rule evaluator")
    parser.add_argument("mode", choices=["preflight", "explain"], help="Doctor mode")
    parser.add_argument("--phase", default="act", help="Current DATUM phase")
    parser.add_argument("--role", default="general", help="Current agent role")
    args = parser.parse_args()

    if args.mode == "preflight":
        do_preflight(args.phase, args.role)
    elif args.mode == "explain":
        print(json.dumps(RULES, indent=2))

if __name__ == "__main__":
    main()
