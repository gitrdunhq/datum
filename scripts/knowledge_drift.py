#!/usr/bin/env python3
"""
knowledge_drift.py — Auto-prune stale KNOWLEDGE.md entries.
Prevents token runaway by dropping knowledge blocks not accessed in >90 days.
"""

import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

KNOWLEDGE_PATH = Path(".datum/KNOWLEDGE.md")
MAX_AGE_DAYS = 90

def prune_knowledge(content: str) -> str:
    # Split content by markdown headers (assume sections are divided by '## ')
    lines = content.splitlines()
    new_lines = []
    
    current_section = []
    keep_section = True
    
    cutoff_date = datetime.now() - timedelta(days=MAX_AGE_DAYS)
    
    for line in lines:
        if line.startswith("## "):
            # We reached a new section. Flush the old one.
            if keep_section:
                new_lines.extend(current_section)
            
            # Reset for new section
            current_section = [line]
            keep_section = True
        else:
            current_section.append(line)
            
        # Check for access metadata
        m = re.search(r'<!-- last_accessed:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*-->', line)
        if m:
            try:
                accessed = datetime.strptime(m.group(1), "%Y-%m-%d")
                if accessed < cutoff_date:
                    keep_section = False
            except ValueError:
                pass
                
    # Flush the last section
    if keep_section:
        new_lines.extend(current_section)
        
    return "\n".join(new_lines) + "\n"

def main():
    if not KNOWLEDGE_PATH.exists():
        sys.exit(0)
        
    content = KNOWLEDGE_PATH.read_text()
    pruned = prune_knowledge(content)
    
    if len(pruned) < len(content):
        KNOWLEDGE_PATH.write_text(pruned)
        print("Pruned stale entries from KNOWLEDGE.md")
        
if __name__ == "__main__":
    main()
