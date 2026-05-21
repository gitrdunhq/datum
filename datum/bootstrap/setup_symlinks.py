#!/usr/bin/env python3
"""Setup symlinks needed for DATUM runtime."""

import json
import sys
from pathlib import Path

# Fix relative imports from bootstrap/ to scripts/
sys.path.insert(0, str(Path(__file__).parent.parent))
from datum.path_utils import assets_dir

def setup_symlinks(dry_run: bool) -> list[str]:
    actions = []
    
    skill_assets = assets_dir()
    project_assets = Path.cwd() / "assets"
    
    if not project_assets.exists():
        if not dry_run:
            project_assets.symlink_to(skill_assets)
        actions.append(f"Created assets -> {skill_assets}")
    else:
        actions.append("assets symlink already exists")
        
    gitignore = Path.cwd() / ".gitignore"
    if gitignore.exists():
        content = gitignore.read_text()
        if "\n/assets" not in content and "^/assets" not in content and "assets" not in content.splitlines():
            if not dry_run:
                with gitignore.open("a") as f:
                    f.write("\n# DATUM assets symlink\n/assets\n")
            actions.append("Added /assets to .gitignore")
    else:
        if not dry_run:
            gitignore.write_text("# DATUM assets symlink\n/assets\n")
        actions.append("Created .gitignore and added /assets")
        
    return actions

def main() -> None:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    actions = setup_symlinks(args.dry_run)
    print(json.dumps({"ok": True, "dry_run": args.dry_run, "actions": actions}))

if __name__ == "__main__":
    main()
