#!/usr/bin/env python3
"""Setup symlinks needed for DATUM runtime."""

import json


def setup_symlinks(dry_run: bool) -> list[str]:
    return ["Symlinks are no longer required. Assets are centrally packaged."]


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    actions = setup_symlinks(args.dry_run)
    print(json.dumps({"ok": True, "dry_run": args.dry_run, "actions": actions}))


if __name__ == "__main__":
    main()
