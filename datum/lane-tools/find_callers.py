#!/usr/bin/env python3
"""Find likely call/reference sites for a symbol without loading whole files."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

EXCLUDED_DIRS = {
    ".git",
    ".datum",
    ".venv",
    "venv",
    "node_modules",
    ".build",
    "build",
    "dist",
    "__pycache__",
}
SOURCE_SUFFIXES = {".swift", ".ts", ".tsx", ".js", ".jsx", ".go", ".py", ".rs", ".java", ".kt"}


def iter_source_files(root: Path):
    for path in root.rglob("*"):
        if any(part in EXCLUDED_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix in SOURCE_SUFFIXES:
            yield path


def main() -> None:
    parser = argparse.ArgumentParser(description="Find likely symbol callers")
    parser.add_argument("symbol")
    parser.add_argument("--root", default=".")
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()

    pattern = re.compile(rf"\b{re.escape(args.symbol)}\b")
    results = []
    for path in iter_source_files(Path(args.root)):
        try:
            lines = path.read_text(errors="replace").splitlines()
        except OSError:
            continue
        for lineno, line in enumerate(lines, start=1):
            if pattern.search(line):
                results.append(
                    {
                        "file": str(path),
                        "line": lineno,
                        "preview": line.strip()[:160],
                    }
                )
                if len(results) >= args.limit:
                    print(json.dumps({"symbol": args.symbol, "matches": results}, indent=2))
                    return

    print(json.dumps({"symbol": args.symbol, "matches": results}, indent=2))


if __name__ == "__main__":
    main()
