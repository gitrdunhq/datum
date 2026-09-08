#!/usr/bin/env python3
"""Snapshot live state (datum.state.load_state()) to the run archive and
clear live state."""

import json
import shutil
from pathlib import Path

from datum.state import load_state


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.archive.done")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    run_dir = Path(f".datum/runs/{args.run_id}").resolve()
    run_dir.mkdir(parents=True, exist_ok=True)

    state = load_state()
    state_src = Path(".datum/state.json")
    wrote_state = False

    if state:
        (run_dir / "state.json").write_text(json.dumps(state, indent=2))
        wrote_state = True
    elif state_src.exists():
        # Legacy repos with a hand-written/pre-existing write-through cache
        # but no canonical state.db entry yet.
        shutil.copy2(state_src, run_dir / "state.json")
        wrote_state = True

    if state_src.exists():
        state_src.unlink()

    state_db = Path(".datum/state.db")
    if state_db.exists():
        shutil.copy2(state_db, run_dir / "state.db")
        state_db.unlink()

    marker.write_text("done")

    if wrote_state:
        print(json.dumps({"ok": True, "archived_to": str(run_dir / "state.json")}))
    else:
        print(json.dumps({"ok": True, "archived_to": str(run_dir)}))


if __name__ == "__main__":
    main()
