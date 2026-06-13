#!/usr/bin/env python3
"""Copy state.json to run archive and clear live state."""

import json
import shutil
from pathlib import Path


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.archive.done")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    state_src = Path(".datum/state.json")
    run_dir = Path(f".datum/runs/{args.run_id}")
    run_dir.mkdir(parents=True, exist_ok=True)

    if state_src.exists():
        shutil.copy2(state_src, run_dir / "state.json")
        state_src.unlink()

    state_db = Path(".datum/state.db")
    if state_db.exists():
        shutil.copy2(state_db, run_dir / "state.db")
        state_db.unlink()

    marker.write_text("done")
    print(json.dumps({"ok": True, "archived_to": str(run_dir / "state.json")}))


if __name__ == "__main__":
    main()
