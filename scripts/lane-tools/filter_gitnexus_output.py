#!/usr/bin/env python3
"""Reduce GitNexus output to compact file/line/confidence records."""

from __future__ import annotations

import json
import re
import sys
from typing import Any


def walk(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def compact_from_json(raw: str) -> list[dict]:
    data = json.loads(raw)
    records = []
    for item in walk(data):
        file_path = item.get("file") or item.get("path") or item.get("filepath")
        line = item.get("line") or item.get("line_number") or item.get("start_line")
        if file_path:
            records.append(
                {
                    "file": file_path,
                    "line": line,
                    "confidence": item.get("confidence"),
                    "symbol": item.get("symbol") or item.get("name"),
                }
            )
    return records


def compact_from_text(raw: str) -> list[dict]:
    records = []
    for line in raw.splitlines():
        match = re.search(r"(?P<file>[\w./-]+\.\w+):(?P<line>\d+)", line)
        if match:
            records.append(
                {
                    "file": match.group("file"),
                    "line": int(match.group("line")),
                    "confidence": None,
                    "symbol": None,
                }
            )
    return records


def main() -> None:
    raw = sys.stdin.read()
    try:
        records = compact_from_json(raw)
    except json.JSONDecodeError:
        records = compact_from_text(raw)

    print(json.dumps({"results": records[:200], "truncated": len(records) > 200}, indent=2))


if __name__ == "__main__":
    main()
