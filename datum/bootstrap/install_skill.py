#!/usr/bin/env python3
"""Install a stable snapshot of the DATUM skill globally."""

import json
import shutil
import sys
from pathlib import Path

def install_skill_snapshot(dry_run: bool = False) -> list[str]:
    actions = []
    
    # We are running from the source repo (e.g. repo/datum/bootstrap/install_skill.py)
    source_root = Path(__file__).resolve().parent.parent.parent
    skill_md = source_root / "SKILL.md"
    datum_pkg = source_root / "datum"
    
    if not skill_md.exists() or not datum_pkg.exists():
        raise RuntimeError(f"Must run install from a valid DATUM repository. Missing files in {source_root}")
        
    agents_skills_dir = Path.home() / ".agents" / "skills"
    target_datum_dir = agents_skills_dir / "datum"
    
    if not dry_run:
        agents_skills_dir.mkdir(parents=True, exist_ok=True)
        if target_datum_dir.exists():
            shutil.rmtree(target_datum_dir)
        target_datum_dir.mkdir()
        
        # Copy SKILL.md
        shutil.copy2(skill_md, target_datum_dir / "SKILL.md")
        
        # Copy the python package, ignoring compiled pycache
        shutil.copytree(
            datum_pkg, 
            target_datum_dir / "datum", 
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            dirs_exist_ok=True
        )
        
    actions.append(f"Copied stable snapshot of DATUM to {target_datum_dir}")
    
    # Now create symlinks for other agents
    other_agents = [
        Path.home() / ".claude" / "skills",
        Path.home() / ".gemini" / "skills",
        Path.home() / ".cursor" / "skills",
    ]
    
    for agent_dir in other_agents:
        if not dry_run:
            agent_dir.mkdir(parents=True, exist_ok=True)
            link_path = agent_dir / "datum"
            if link_path.is_symlink() or link_path.exists():
                if link_path.is_dir() and not link_path.is_symlink():
                    shutil.rmtree(link_path)
                else:
                    link_path.unlink()
            link_path.symlink_to(target_datum_dir)
        actions.append(f"Symlinked {target_datum_dir} -> {agent_dir}/datum")
        
    return actions

def main() -> None:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        actions = install_skill_snapshot(args.dry_run)
        print(json.dumps({"ok": True, "dry_run": args.dry_run, "actions": actions}, indent=2))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    main()
