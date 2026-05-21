#!/usr/bin/env python3
"""Install DATUM-required linter rules into the target repo."""

import json
from pathlib import Path

RUFF_RULES = {
    "select": ["E", "F", "I", "N", "UP"],
    "ignore": [],
    "line-length": 100,
}


def install_ruff(dry_run: bool) -> str | None:
    pyproject = Path("pyproject.toml")
    if pyproject.exists():
        content = pyproject.read_text()
        if "[tool.ruff]" in content:
            return "ruff config already present in pyproject.toml — skipped"
        if not dry_run:
            with pyproject.open("a") as f:
                f.write('\n[tool.ruff]\nselect = ["E","F","I"]\nline-length = 100\n')
        return "appended ruff config to pyproject.toml"
    return None


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    results = []
    msg = install_ruff(args.dry_run)
    if msg:
        results.append(msg)

    print(json.dumps({"ok": True, "actions": results}))


if __name__ == "__main__":
    main()
