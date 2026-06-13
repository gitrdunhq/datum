#!/usr/bin/env python3
"""Trigger GitNexus reindex after closeout. Non-blocking."""

import json
import os
import subprocess
from pathlib import Path


def load_config() -> dict:
    project_dir = os.environ.get("DATUM_PROJECT_DIR", ".")
    project_config = Path(project_dir) / ".datum/config.toml"
    local_config = Path(".datum/config.toml")
    # assets is a sibling of closeout, but we'll try to find it via __file__
    default_path = Path(__file__).resolve().parent.parent / "assets/config.toml.default"

    for path in (project_config, local_config, default_path):
        if path.exists():
            try:
                import tomllib  # type: ignore[import]
            except ImportError:
                try:
                    import tomli as tomllib  # type: ignore[import]
                except ImportError:
                    continue
            try:
                with open(path, "rb") as f:
                    return tomllib.load(f)
            except Exception:
                pass
    return {}


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    config = load_config()
    timeout = config.get("closeout", {}).get("gitnexus_reindex_timeout_s", 600)

    log_path = Path(f".datum/runs/{args.run_id}/gitnexus-reindex.log")
    log_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        result = subprocess.run(
            ["gitnexus", "analyze"],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        log_path.write_text(result.stdout + result.stderr)

        if result.returncode != 0:
            print(
                json.dumps({"ok": False, "error": "reindex failed", "log": str(log_path)})
            )
        else:
            print(json.dumps({"ok": True, "log": str(log_path)}))
    except subprocess.TimeoutExpired as e:
        # Emit a non-fatal warning instead of a traceback
        err_msg = f"GitNexus reindex timed out after {timeout} seconds. Resume manually if needed."
        if e.stdout or e.stderr:
            log_content = (e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")) + \
                          (e.stderr.decode() if isinstance(e.stderr, bytes) else (e.stderr or ""))
            log_path.write_text(log_content + "\n" + err_msg)
        else:
            log_path.write_text(err_msg)
        print(
            json.dumps({"ok": False, "error": "timeout", "warning": err_msg, "log": str(log_path)})
        )


if __name__ == "__main__":
    main()
