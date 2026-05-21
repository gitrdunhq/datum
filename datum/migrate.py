#!/usr/bin/env python3
"""Migrate .datum/state.json to the bundled skill schema version."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

try:
    import tomllib
except ImportError:  # pragma: no cover - py3.10 fallback
    import tomli as tomllib  # type: ignore[import-not-found]

# Fix relative imports
sys.path.insert(0, str(Path(__file__).parent))
from datum.path_utils import assets_dir

STATE_FILE = Path(".datum/state.json")
CONFIG_FILE = assets_dir() / "config.toml.default"
STATE_SCHEMA = assets_dir() / "schemas/state.schema.json"


def current_skill_version() -> str:
    if not CONFIG_FILE.exists():
        return "1.0.0"
    config = tomllib.loads(CONFIG_FILE.read_text())
    return str(config.get("skill", {}).get("version", "1.0.0"))


def migrate_wfc_directory(dry_run: bool) -> list[str]:
    changes: list[str] = []
    wfc_dir = Path(".wfc")
    datum_dir = Path(".datum")

    if wfc_dir.exists() and wfc_dir.is_dir():
        worktrees = wfc_dir / "worktrees"
        if worktrees.exists():
            if not dry_run:
                shutil.rmtree(worktrees, ignore_errors=True)
            changes.append("deleted legacy .wfc/worktrees directory")
        
        if not dry_run:
            wfc_dir.rename(datum_dir)
        changes.append("renamed .wfc directory to .datum")
    return changes


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    return json.loads(STATE_FILE.read_text())


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(STATE_FILE)


def migrate_state(state: dict, target_version: str) -> tuple[dict, list[str]]:
    changes: list[str] = []

    if not state:
        return state, changes

    if state.get("schema_version") is None:
        state["schema_version"] = "1.0.0"
        changes.append("set schema_version=1.0.0")

    if state.get("skill_version") != target_version:
        old = state.get("skill_version", "unknown")
        state["skill_version"] = target_version
        changes.append(f"updated skill_version {old} -> {target_version}")

    state.setdefault("brief_defects", [])
    state.setdefault("lane_tools_added", [])
    state.setdefault("gitnexus_degraded", False)
    state.setdefault("gitnexus_degraded_log", None)

    return state, changes


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate DATUM state schema")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    dir_changes = migrate_wfc_directory(args.dry_run)

    state = load_state()
    if not state and not dir_changes:
        print(json.dumps({"ok": True, "skipped": True, "reason": "no state.json and no .wfc directory"}))
        return

    migrated, changes = migrate_state(state, current_skill_version())
    all_changes = dir_changes + changes
    
    if not args.dry_run and state:
        save_state(migrated)

    try:
        from datum.contracts import validate_value

        errors = validate_value(STATE_SCHEMA, migrated) if migrated else []
    except Exception as exc:  # pragma: no cover - defensive command surface
        errors = [str(exc)]

    if errors:
        print(json.dumps({"ok": False, "changes": all_changes, "errors": errors}, indent=2))
        sys.exit(1)

    print(json.dumps({"ok": True, "dry_run": args.dry_run, "changes": all_changes}, indent=2))


if __name__ == "__main__":
    main()
