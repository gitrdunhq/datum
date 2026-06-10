#!/usr/bin/env python3
"""M1 driver: bare RED-GREEN cycle via multi_turn_phase with tool execution.

Proves a local model can drive a write-test-commit loop headlessly on the
fixture repo with zero remote/cloud API calls.

Usage:
    python scripts/m1_driver.py --fixture-dir fixtures/toy-project --config .datum/config.toml

Exit codes:
    0  RED-GREEN succeeded, commit created
    1  Structured failure (see .datum/m1-failure.json)
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Failure record
# ---------------------------------------------------------------------------


def write_failure_record(
    datum_dir: Path,
    phase: str,
    attempts: int,
    reason: str,
    model: str,
) -> Path:
    """Write a structured JSON failure record and return its path."""
    datum_dir.mkdir(parents=True, exist_ok=True)
    record_path = datum_dir / "m1-failure.json"
    record = {
        "phase": phase,
        "attempts": attempts,
        "reason": reason,
        "model": model,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    record_path.write_text(json.dumps(record, indent=2) + "\n")
    return record_path


# ---------------------------------------------------------------------------
# Pytest runner
# ---------------------------------------------------------------------------


def run_pytest(fixture_dir: Path) -> subprocess.CompletedProcess:
    """Run pytest in the fixture directory and return the CompletedProcess."""
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "--tb=short", "--no-header"],
        cwd=str(fixture_dir),
        capture_output=True,
        text=True,
        timeout=120,
    )


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

RED_PROMPT = """\
You have access to these tools: read_file, write_to_file, run_command, list_dir, grep_search, \
read_file_range, find_callers, filter_gitnexus_output, replace_file_content, multi_replace_file_content.

Your task: add a FAILING test for a multiply function to the calculator project.

IMPORTANT: Follow these steps exactly in order.

Step 1: Use read_file to read "calculator.py" so you understand the current code.
Step 2: Use read_file to read "test_calculator.py" so you understand the existing tests.
Step 3: Use write_to_file to OVERWRITE "test_calculator.py" with the full file contents.
The new file must keep all existing tests AND add a new test function called test_multiply.
The test_multiply function must:
  - Import multiply from calculator (at the top with the existing imports)
  - Call multiply(2, 3) and assert the result equals 6
  - Call multiply(-1, 4) and assert the result equals -4

The test MUST fail because multiply does not exist in calculator.py yet.
The failure will be an ImportError because multiply is not defined.

Do NOT modify calculator.py in this step. Only modify test_calculator.py.
Do NOT create any new files. Only modify test_calculator.py.
"""

GREEN_PROMPT = """\
You have access to these tools: read_file, write_to_file, run_command, list_dir, grep_search, \
read_file_range, find_callers, filter_gitnexus_output, replace_file_content, multi_replace_file_content.

Your task: implement the multiply function in calculator.py to make all tests pass.

IMPORTANT: Follow these steps exactly in order.

Step 1: Use read_file to read "test_calculator.py" to see what the test expects.
Step 2: Use read_file to read "calculator.py" to see the current code.
Step 3: Use write_to_file to OVERWRITE "calculator.py" with the full file contents.
The new file must keep all existing functions (like add) AND add a new function:

def multiply(a: int | float, b: int | float) -> int | float:
    \"\"\"Return the product of a and b.\"\"\"
    return a * b

Do NOT modify test_calculator.py. Only modify calculator.py.
Do NOT remove or change the add function.
"""


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------


def load_driver_config(config_path: Path) -> dict:
    """Load config.toml and return the merged config dict."""
    try:
        import tomllib
    except ImportError:
        import tomli as tomllib  # type: ignore[no-redef]

    with config_path.open("rb") as f:
        raw = tomllib.load(f)

    local_llm = raw.get("local_llm", {})
    multi_turn = raw.get("multi_turn", {})
    return {
        "model": local_llm.get("model", "mlx-community/Qwen3-30B-A3B-8bit"),
        "max_turns": multi_turn.get("max_tool_turns", 10),
        "timeout_s": multi_turn.get("timeout_s", 300),
        "allowed_tools": multi_turn.get(
            "allowed_tools",
            [
                "find_callers",
                "filter_gitnexus_output",
                "read_file",
                "read_file_range",
                "list_dir",
                "grep_search",
                "run_command",
                "write_to_file",
                "replace_file_content",
                "multi_replace_file_content",
            ],
        ),
    }


# ---------------------------------------------------------------------------
# Multi-turn phase wrapper
# ---------------------------------------------------------------------------


def call_multi_turn(
    phase: str,
    prompt: str,
    fixture_dir: Path,
    config: dict,
) -> dict:
    """Call multi_turn_phase with write-tool overrides.

    Sets DATUM_PROJECT_DIR so metrics land in <fixture_dir>/.datum/.
    """
    from datum.local_llm import multi_turn_phase

    # Ensure metrics land in the fixture dir
    os.environ["DATUM_PROJECT_DIR"] = str(fixture_dir.resolve())

    overrides = {
        "enabled": True,
        "enable_tool_execution": True,
        "enable_write_tools": True,
        "allowed_tools": config["allowed_tools"],
        "allowed_write_dirs": [str(fixture_dir.resolve())],
        "phases": [phase],
        "max_turns": config["max_turns"],
        "max_tool_turns": config["max_turns"],
        "timeout_s": config["timeout_s"],
    }

    # Change cwd to fixture dir so sandbox paths resolve correctly
    original_cwd = os.getcwd()
    try:
        os.chdir(fixture_dir)
        result = multi_turn_phase(
            phase=phase,
            prompt=prompt,
            schema=None,
            mt_overrides=overrides,
        )
    finally:
        os.chdir(original_cwd)

    return result


# ---------------------------------------------------------------------------
# Git commit (direct, no commit_queue -- server not running for fixture)
# ---------------------------------------------------------------------------


def git_commit(fixture_dir: Path, message: str) -> bool:
    """Stage all changes and commit in the fixture repo. Returns True on success."""
    env = os.environ.copy()
    git_base = [
        "git",
        "-c",
        "user.email=datum@local",
        "-c",
        "user.name=datum",
    ]

    add_result = subprocess.run(
        [*git_base, "add", "-A"],
        cwd=str(fixture_dir),
        capture_output=True,
        text=True,
        env=env,
    )
    if add_result.returncode != 0:
        return False

    commit_result = subprocess.run(
        [*git_base, "commit", "-m", message],
        cwd=str(fixture_dir),
        capture_output=True,
        text=True,
        env=env,
    )
    return commit_result.returncode == 0


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="M1 driver: RED-GREEN cycle via local multi_turn_phase",
    )
    parser.add_argument(
        "--fixture-dir",
        type=Path,
        required=True,
        help="Path to the materialized fixture repo",
    )
    parser.add_argument(
        "--config",
        type=Path,
        required=True,
        help="Path to config.toml",
    )
    args = parser.parse_args()

    fixture_dir = args.fixture_dir.resolve()
    config_path = args.config.resolve()

    if not fixture_dir.is_dir():
        print(f"ERROR: fixture dir not found: {fixture_dir}", file=sys.stderr)
        return 1
    if not config_path.is_file():
        print(f"ERROR: config not found: {config_path}", file=sys.stderr)
        return 1

    datum_dir = fixture_dir / ".datum"
    datum_dir.mkdir(parents=True, exist_ok=True)

    config = load_driver_config(config_path)
    model_name = config["model"]

    print(f"[m1] fixture: {fixture_dir}")
    print(f"[m1] config:  {config_path}")
    print(f"[m1] model:   {model_name}")

    # ── Phase 1: RED ──────────────────────────────────────────────────────
    print("\n[m1] === RED PHASE ===")
    print("[m1] Calling multi_turn_phase('act_red', ...) to write a failing test")

    red_result = call_multi_turn("act_red", RED_PROMPT, fixture_dir, config)

    if red_result.get("escalated"):
        reason = red_result.get("reason", "escalated during RED phase")
        print(f"[m1] RED escalated: {reason}", file=sys.stderr)
        write_failure_record(datum_dir, "red", 1, reason, model_name)
        return 1

    # Verify RED: pytest must FAIL (test written for non-existent multiply)
    print("[m1] Verifying RED: running pytest (expecting failure)...")
    red_pytest = run_pytest(fixture_dir)
    print(f"[m1] pytest stdout:\n{red_pytest.stdout}")
    if red_pytest.stderr:
        print(f"[m1] pytest stderr:\n{red_pytest.stderr}")

    if red_pytest.returncode == 0:
        reason = (
            "RED verification failed: pytest passed but should have failed. "
            "The model did not write a failing test for multiply."
        )
        print(f"[m1] {reason}", file=sys.stderr)
        write_failure_record(datum_dir, "red", 1, reason, model_name)
        return 1

    print("[m1] RED verified: pytest failed as expected (multiply not implemented)")

    # ── Phase 2: GREEN ────────────────────────────────────────────────────
    print("\n[m1] === GREEN PHASE ===")
    print("[m1] Calling multi_turn_phase('act_green', ...) to implement multiply")

    green_result = call_multi_turn("act_green", GREEN_PROMPT, fixture_dir, config)

    if green_result.get("escalated"):
        reason = green_result.get("reason", "escalated during GREEN phase")
        print(f"[m1] GREEN escalated: {reason}", file=sys.stderr)
        write_failure_record(datum_dir, "green", 1, reason, model_name)
        return 1

    # Verify GREEN: pytest must PASS
    print("[m1] Verifying GREEN: running pytest (expecting pass)...")
    green_pytest = run_pytest(fixture_dir)
    print(f"[m1] pytest stdout:\n{green_pytest.stdout}")
    if green_pytest.stderr:
        print(f"[m1] pytest stderr:\n{green_pytest.stderr}")

    if green_pytest.returncode != 0:
        reason = (
            "GREEN verification failed: pytest still failing after implementation. "
            f"stdout: {green_pytest.stdout[:500]}"
        )
        print(f"[m1] {reason}", file=sys.stderr)
        write_failure_record(datum_dir, "green", 1, reason, model_name)
        return 1

    print("[m1] GREEN verified: pytest passes")

    # ── Commit ────────────────────────────────────────────────────────────
    print("\n[m1] === COMMIT ===")
    # Direct git -- commit_queue requires a running server (Research Findings)
    commit_msg = "feat(m1): add multiply function and test via RED-GREEN cycle"
    if git_commit(fixture_dir, commit_msg):
        print(f"[m1] Committed: {commit_msg}")
    else:
        print(
            "[m1] WARNING: git commit failed (may already be committed)",
            file=sys.stderr,
        )

    print("\n[m1] M1 driver completed successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
