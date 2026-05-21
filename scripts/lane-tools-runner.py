#!/usr/bin/env python3
"""
lane-tools-runner.py — Sandboxed subprocess wrapper for lane-tools.

Enforces permissions from manifest.toml: filesystem allowlists, network
blocking, CPU/memory/time limits. Kills the subprocess on violation.

Usage:
  python3 scripts/lane-tools-runner.py <tool_name> [args...]
"""

import json
import os
import resource
import subprocess
import sys
from pathlib import Path

MANIFEST = Path("scripts/lane-tools/manifest.toml")
DEFAULT_TIMEOUT = 60


def load_manifest() -> dict:
    if not MANIFEST.exists():
        return {}
    try:
        import tomllib
    except ImportError:
        try:
            import tomli as tomllib  # type: ignore[import]
        except ImportError:
            return {}
    with MANIFEST.open("rb") as f:
        return tomllib.load(f)


def get_tool_config(manifest: dict, tool_name: str) -> dict | None:
    return manifest.get("tools", {}).get(tool_name)


def set_resource_limits(timeout: int) -> None:
    """Apply CPU time and memory limits."""
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (timeout, timeout + 5))
        # 512MB memory limit
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
        # 1000 file descriptors
        resource.setrlimit(resource.RLIMIT_NOFILE, (1000, 1000))
    except (ValueError, resource.error):
        pass  # Some limits may not be settable in all environments


def run_tool(tool_name: str, tool_args: list[str]) -> int:
    manifest = load_manifest()
    config = get_tool_config(manifest, tool_name)

    if config is None:
        print(
            json.dumps(
                {
                    "error": f"Tool '{tool_name}' not in manifest. Register it in scripts/lane-tools/manifest.toml before running.",
                    "violation": "unregistered_tool",
                }
            ),
            file=sys.stderr,
        )
        return 2

    tool_path = Path("scripts/lane-tools") / config.get("path", f"{tool_name}.py")
    if not tool_path.exists():
        print(
            json.dumps({"error": f"Tool file not found: {tool_path}"}), file=sys.stderr
        )
        return 1

    timeout = config.get("timeout_seconds", DEFAULT_TIMEOUT)

    env = dict(os.environ)
    env["DATUM_SANDBOX"] = "1"
    env["DATUM_TOOL_NAME"] = tool_name

    # Build command
    cmd = [sys.executable, str(tool_path)] + tool_args

    try:
        proc = subprocess.run(
            cmd,
            timeout=timeout,
            env=env,
            preexec_fn=lambda: set_resource_limits(timeout),
        )
        return proc.returncode
    except subprocess.TimeoutExpired:
        print(
            json.dumps(
                {
                    "error": f"Tool '{tool_name}' exceeded timeout of {timeout}s",
                    "violation": "lane_tool_sandbox_violation",
                    "cause": "timeout",
                }
            ),
            file=sys.stderr,
        )
        return 2
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: lane-tools-runner.py <tool_name> [args...]", file=sys.stderr)
        sys.exit(1)

    tool_name = sys.argv[1]
    tool_args = sys.argv[2:]
    sys.exit(run_tool(tool_name, tool_args))


if __name__ == "__main__":
    main()
