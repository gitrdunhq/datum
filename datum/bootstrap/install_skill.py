#!/usr/bin/env python3
"""Install datum skill by symlinking from this repo to agent skill directories."""

from __future__ import annotations

import json
import sys
from pathlib import Path

TOOL_DIRS = {
    "Claude Code": Path.home() / ".claude" / "skills",
    "Codex": Path.home() / ".codex" / "skills",
    "Gemini CLI": Path.home() / ".gemini" / "skills",
    "Kiro": Path.home() / ".kiro" / "skills",
    "opencode": Path.home() / ".opencode" / "skills",
    "Cursor": Path.home() / ".cursor" / "skills",
}


def install_skill_snapshot(dry_run: bool = False) -> list[str]:
    source_root = Path(__file__).resolve().parent.parent.parent
    skill_md = source_root / "SKILL.md"

    if not skill_md.exists():
        raise RuntimeError(
            f"Not a valid DATUM repo — SKILL.md not found at {source_root}"
        )

    actions: list[str] = []

    for tool_name, skills_dir in TOOL_DIRS.items():
        link_path = skills_dir / "datum"

        if dry_run:
            actions.append(f"Would symlink {link_path} → {source_root} ({tool_name})")
            continue

        skills_dir.mkdir(parents=True, exist_ok=True)

        if link_path.is_symlink():
            existing = link_path.resolve()
            if existing == source_root.resolve():
                actions.append(f"{tool_name}: already linked → {link_path}")
                continue
            link_path.unlink()
        elif link_path.is_dir():
            import shutil

            shutil.rmtree(link_path)

        link_path.symlink_to(source_root)
        actions.append(f"{tool_name}: {link_path} → {source_root}")

    return actions


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        actions = install_skill_snapshot(args.dry_run)
        print(
            json.dumps(
                {"ok": True, "dry_run": args.dry_run, "actions": actions}, indent=2
            )
        )
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
