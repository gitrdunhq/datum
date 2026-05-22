#!/usr/bin/env python3
"""
DATUM Deduplication & Minority Protection.

Consolidates review findings that might overlap across multi-pass reviews
(e.g., a performance issue that is also an architecture issue).
Enforces Minority Protection Rules: critical domains (security, properties)
are protected and never collapsed into generic domains.
"""

import argparse
import json
import sys
from pathlib import Path

# Domains that receive minority protection and should not be discarded
PROTECTED_DOMAINS = {"security", "properties"}

def fuzzy_match(f1: dict, f2: dict) -> bool:
    """Determine if two findings are effectively the same issue."""
    if f1.get("file") != f2.get("file"):
        return False
    # If lines are within 3 lines of each other, consider them overlapping
    try:
        l1 = int(f1.get("line", -1))
        l2 = int(f2.get("line", -2))
        if abs(l1 - l2) <= 3:
            return True
    except ValueError:
        pass
        
    return False

def consolidate_severity(s1: str, s2: str) -> str:
    levels = {"high": 4, "medium": 3, "low": 2, "info": 1}
    return s1 if levels.get(s1, 0) >= levels.get(s2, 0) else s2

def deduplicate_findings(findings: list[dict]) -> list[dict]:
    deduped = []
    
    for finding in findings:
        is_duplicate = False
        for existing in deduped:
            if fuzzy_match(finding, existing):
                is_duplicate = True
                
                # Check Minority Protection Rule
                # If the new finding is from a protected domain, and the existing is not, replace existing
                new_protected = finding.get("domain") in PROTECTED_DOMAINS
                exist_protected = existing.get("domain") in PROTECTED_DOMAINS
                
                if new_protected and not exist_protected:
                    # New finding trumps existing due to minority protection
                    existing.update(finding)
                else:
                    # Consolidate severity to the highest
                    existing["severity"] = consolidate_severity(existing.get("severity", "info"), finding.get("severity", "info"))
                    
                break
                
        if not is_duplicate:
            deduped.append(finding)
            
    return deduped

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to unified.json packet")
    args = parser.parse_args()
    
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: {input_path} not found")
        sys.exit(1)
        
    try:
        packet = json.loads(input_path.read_text())
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        sys.exit(1)
        
    if "findings" not in packet:
        print("No findings array in packet")
        sys.exit(0)
        
    original_count = len(packet["findings"])
    packet["findings"] = deduplicate_findings(packet["findings"])
    new_count = len(packet["findings"])
    
    input_path.write_text(json.dumps(packet, indent=2))
    print(f"Deduplication complete. Reduced {original_count} findings to {new_count}.")

if __name__ == "__main__":
    main()
