#!/usr/bin/env python3
"""Collect lane-tool additions and manifest metadata."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from path_utils import collector_marker, closeout_raw_dir, state_for_run  # noqa: E402


def load_manifest() -> dict:
    manifest = Path("scripts/lane-tools/manifest.toml")
    if not manifest.exists():
        return {}
    try:
        import tomllib
    except ImportError:  # pragma: no cover - py3.10 fallback
        import tomli as tomllib  # type: ignore[import-not-found]
    with manifest.open("rb") as f:
        return tomllib.load(f)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    marker = collector_marker(args.run_id, "lane-tools")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    state_path = state_for_run(args.run_id)
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    data = {
        "lane_tools_added": state.get("lane_tools_added", []),
        "manifest": load_manifest(),
    }

    out = closeout_raw_dir(args.run_id) / "lane_tools.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2))
    marker.write_text("done")
    print(json.dumps({"ok": True, "count": len(data["lane_tools_added"])}))


if __name__ == "__main__":
    main()
