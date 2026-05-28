#!/usr/bin/env python3
"""Install a stable snapshot of the DATUM skill globally."""

import json
import shutil
import sys
from pathlib import Path


def install_skill_snapshot(dry_run: bool = False) -> list[str]:
    actions = []

    # Get absolute path to the repository root (going up install_skill.py -> bootstrap -> datum -> repo_root)
    source_root = Path(__file__).resolve().parent.parent.parent
    skill_md = source_root / "SKILL.md"
    datum_pkg = source_root / "datum"
    scripts_dir = source_root / "scripts"

    if not skill_md.exists() or not datum_pkg.exists() or not scripts_dir.exists():
        raise RuntimeError(
            f"Must run install from a valid DATUM repository. Missing files in {source_root}"
        )

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
            dirs_exist_ok=True,
        )

        # Copy the scripts directory
        shutil.copytree(
            scripts_dir,
            target_datum_dir / "scripts",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            dirs_exist_ok=True,
        )

    actions.append(f"Copied stable snapshot of DATUM to {target_datum_dir}")

    # Install standalone skills from the skills/ directory
    standalone_skills_dir = source_root / "skills"
    installed_standalone = []
    if standalone_skills_dir.exists() and standalone_skills_dir.is_dir():
        for skill_path in standalone_skills_dir.iterdir():
            if skill_path.is_dir():
                target_skill_dir = agents_skills_dir / skill_path.name
                if not dry_run:
                    if target_skill_dir.exists():
                        shutil.rmtree(target_skill_dir)
                    shutil.copytree(
                        skill_path,
                        target_skill_dir,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
                    )
                actions.append(
                    f"Copied standalone skill {skill_path.name} to {target_skill_dir}"
                )
                installed_standalone.append((skill_path.name, target_skill_dir))

    # Now create symlinks for other agents
    other_agents = [
        Path.home() / ".claude" / "skills",
        Path.home() / ".gemini" / "skills",
        Path.home() / ".cursor" / "skills",
    ]

    for agent_dir in other_agents:
        if not dry_run:
            agent_dir.mkdir(parents=True, exist_ok=True)

            # Symlink main datum skill
            link_path = agent_dir / "datum"
            if link_path.is_symlink() or link_path.exists():
                if link_path.is_dir() and not link_path.is_symlink():
                    shutil.rmtree(link_path)
                else:
                    link_path.unlink()
            link_path.symlink_to(target_datum_dir)

            # Symlink standalone skills
            for skill_name, target_dir in installed_standalone:
                skill_link = agent_dir / skill_name
                if skill_link.is_symlink() or skill_link.exists():
                    if skill_link.is_dir() and not skill_link.is_symlink():
                        shutil.rmtree(skill_link)
                    else:
                        skill_link.unlink()
                skill_link.symlink_to(target_dir)
                actions.append(f"Symlinked {target_dir} -> {agent_dir}/{skill_name}")

        actions.append(f"Symlinked {target_datum_dir} -> {agent_dir}/datum")

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
