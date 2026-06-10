#!/usr/bin/env python3
"""Staleness enforcement for project/reference memory files.

Reads all memory files in a directory, flags project/reference memories
that exceed their expires_after_days without a recent last_verified date.

Output: JSON list of {file, name, type, age_days, expires_after_days, action}
  action: "verify" (expired but not ancient) | "archive" (2x expired)
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

EXPIRES_DEFAULTS: dict[str, int] = {"project": 28, "reference": 90}
ARCHIVE_MULTIPLIER = 2


def _parse_frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---"):
        return {}
    end = text.find("---", 3)
    if end == -1:
        return {}
    block = text[3:end]
    result: dict[str, str] = {}
    for line in block.splitlines():
        m = re.match(r"^\s{0,2}(\w+):\s*(.+)$", line)
        if m:
            result[m.group(1)] = m.group(2).strip()
    return result


def _parse_date(value: str) -> date | None:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def audit_directory(memory_dir: Path) -> list[dict]:
    today = date.today()
    results: list[dict] = []

    for md_file in sorted(memory_dir.glob("*.md")):
        if md_file.name in {"MEMORY.md", "INDEX.md"}:
            continue
        text = md_file.read_text(encoding="utf-8")
        fm = _parse_frontmatter(text)

        mem_type = fm.get("type", "")
        if mem_type not in EXPIRES_DEFAULTS:
            continue

        default_expires = EXPIRES_DEFAULTS[mem_type]
        expires_after = int(fm.get("expires_after_days", default_expires))
        last_verified = _parse_date(fm.get("last_verified", ""))
        updated = _parse_date(fm.get("updated", ""))
        created = _parse_date(fm.get("created", ""))

        base_date = last_verified or updated or created
        if base_date:
            age_days = (today - base_date).days
        else:
            mtime = date.fromtimestamp(md_file.stat().st_mtime)
            age_days = (today - mtime).days

        if age_days <= expires_after:
            continue

        action = (
            "archive" if age_days > expires_after * ARCHIVE_MULTIPLIER else "verify"
        )
        results.append(
            {
                "file": str(md_file),
                "name": fm.get("name", md_file.stem),
                "type": mem_type,
                "age_days": age_days,
                "expires_after_days": expires_after,
                "action": action,
            }
        )

    return results


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: memory_audit.py <memory_dir>", file=sys.stderr)
        sys.exit(1)

    memory_dir = Path(sys.argv[1]).expanduser()
    if not memory_dir.is_dir():
        print(f"Not a directory: {memory_dir}", file=sys.stderr)
        sys.exit(1)

    results = audit_directory(memory_dir)
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
