"""``datum workflow run <name>``: spawn the host-side workflow runner.

Resolves the workflow bundle, validates the args file and the ``runtime``
block of the config, then runs ``node runner.js`` with the documented argv
contract (--bundle/--args/--config/--repo-root/--skills-dir). The runner's
stdout is passed through on success; its stderr on failure.

Exit codes: 0 ok, 1 runner failed, 2 usage error (nothing was spawned).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

# Module-level seam: tests point this at a stub runner.
RUNNER_PATH: Path = Path(__file__).resolve().parent.parent / "skills" / "runtime" / "runner.js"
RUNNER_TIMEOUT_SECONDS = 3600
RUNTIME_KINDS = ("fake", "pi")
UNAVAILABLE_KINDS = ("pi",)  # Q5 default: declared but not implemented yet


class UsageError(Exception):
    """A usage problem detected before the runner is spawned (exit 2)."""


def _load_json(path: Path, what: str) -> object:
    try:
        text = path.read_text()
    except OSError as e:
        raise UsageError(f"{what} not readable: {path} ({e.strerror or e})") from e
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise UsageError(f"{what} is not valid JSON: {path} ({e})") from e


def _check_runtime(config: object) -> None:
    block = config.get("runtime") if isinstance(config, dict) else None
    if not isinstance(block, dict):
        raise UsageError("config has no runtime block")
    kind = block.get("kind")
    if kind not in RUNTIME_KINDS:
        raise UsageError(f"runtime_kind_unknown: {kind}")
    if kind in UNAVAILABLE_KINDS:
        raise UsageError(f"runtime_kind_unavailable: {kind}")


def _find_bundle(name: str, dirs: list[Path]) -> Path:
    for d in dirs:
        candidate = d / f"{name}.js"
        if candidate.is_file():
            return candidate
    searched = ", ".join(str(d) for d in dirs)
    raise UsageError(f"workflow bundle not found: {name}.js (searched {searched})")


def build_argv(name: str, args_file: Path, config_file: Path) -> list[str]:
    """Validate inputs and return the runner argv; raise UsageError on bad input."""
    repo_root = Path.cwd().resolve()
    config = _load_json(config_file, "config file")
    _check_runtime(config)
    if not args_file.is_file():
        raise UsageError(f"args file not found: {args_file}")
    _load_json(args_file, "args file")
    dirs = [repo_root / ".datum" / "skills"]
    skills_dir = config.get("skills_dir")
    if isinstance(skills_dir, str) and skills_dir:
        dirs.append(Path(skills_dir))
    bundle = _find_bundle(name, dirs)
    argv = [
        "node", str(RUNNER_PATH),
        "--bundle", str(bundle.resolve()),
        "--args", str(args_file.resolve()),
        "--config", str(config_file.resolve()),
        "--repo-root", str(repo_root),
    ]
    for d in dirs:
        argv += ["--skills-dir", str(d)]
    return argv


def run_workflow(name: str, args_file: Path, config_file: Path) -> int:
    """Run the workflow and return the process exit code."""
    try:
        argv = build_argv(name, args_file, config_file)
    except UsageError as e:
        print(str(e), file=sys.stderr)
        return 2
    try:
        res = subprocess.run(
            argv, capture_output=True, text=True, timeout=RUNNER_TIMEOUT_SECONDS
        )
    except subprocess.TimeoutExpired:
        print(f"workflow runner timed out after {RUNNER_TIMEOUT_SECONDS}s", file=sys.stderr)
        return 1
    except OSError as e:
        print(f"workflow runner could not start: {e}", file=sys.stderr)
        return 1
    if res.returncode != 0:
        sys.stderr.write(res.stderr)
        return 1
    sys.stdout.write(res.stdout)
    return 0
