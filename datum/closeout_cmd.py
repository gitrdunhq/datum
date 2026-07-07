"""datum closeout — Stage 1 collection + Stage 3 archive orchestration.

Runs all closeout collectors, collates into closeout-data.json, updates
CURRENT_STATE.md and CHANGELOG.md, then archives the run. No LLM required
for the deterministic stages; synthesis (RETRO) is optional via --synthesize.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

# Sentinel used when no numeric epic identifier can be parsed from the branch
# name at all. Deliberately not a valid epic number (real epic numbers are
# always >= 1 — see datum/models/closeout_data_schema.py) so it can never be
# mistaken for a real epic while still satisfying the int-typed contract that
# downstream consumers (run_collate/collate.py/tag_epic.py) rely on (#301).
UNKNOWN_EPIC_NUMBER = -1

# Branch-slug patterns recognized for epic-number auto-detection, checked in
# order. Covers both `datum/epic-23`-style epic branches and the
# `bug-squash-NNN`-style branches already used in docs/epics/datum/ (#301).
_EPIC_NUMBER_PATTERNS = (
    re.compile(r"epic-(\d+)"),
    re.compile(r"bug-squash-(\d+)"),
)


def _git(*args: str) -> str:
    """Run a git command and return stripped stdout. Raises on failure."""
    result = subprocess.run(["git", *args], capture_output=True, text=True, timeout=10)
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def _detect_epic_number(branch: str) -> int | None:
    """Extract an epic number from a branch slug, or None if unrecognized."""
    for pattern in _EPIC_NUMBER_PATTERNS:
        m = pattern.search(branch)
        if m:
            return int(m.group(1))
    return None


def detect_context(
    run_id: str | None = None,
    base_sha: str | None = None,
    merge_sha: str | None = None,
    epic_number: int | None = None,
) -> dict:
    """Auto-detect closeout context from the current git repo."""
    branch = _git("rev-parse", "--abbrev-ref", "HEAD")
    detected_merge_sha = merge_sha or _git("rev-parse", "HEAD")

    # Parse epic number from branch name (datum/epic-23 → 23,
    # bug-squash-306 → 306). Explicit epic_number always wins.
    detected_epic = epic_number
    if detected_epic is None:
        detected_epic = _detect_epic_number(branch)
        if detected_epic is None:
            logger.warning(
                "Could not parse an epic number from branch %r (recognized "
                "patterns: epic-N, bug-squash-N) — epic_number will be set "
                "to the sentinel %d instead of silently defaulting to 0. "
                "Pass --epic-number explicitly to avoid this warning.",
                branch,
                UNKNOWN_EPIC_NUMBER,
            )
            detected_epic = UNKNOWN_EPIC_NUMBER

    # Base SHA: the merge-base with main, or HEAD~N if on main
    detected_base = base_sha
    if detected_base is None:
        try:
            detected_base = _git("merge-base", "main", "HEAD")
        except RuntimeError:
            detected_base = _git("rev-parse", "HEAD~1")

    detected_run_id = run_id or datetime.now().strftime("%Y%m%d-%H%M%S")

    return {
        "run_id": detected_run_id,
        "base_sha": detected_base,
        "merge_sha": detected_merge_sha,
        "epic_number": detected_epic,
        "branch": branch,
    }


def run_stage1(
    run_id: str,
    base_sha: str,
    merge_sha: str,
    runs_dir: Path | None = None,
) -> dict:
    """Run all Stage 1 collectors and collate into closeout-data.json."""
    if runs_dir is None:
        runs_dir = Path(".datum/runs")
    runs_dir.mkdir(parents=True, exist_ok=True)
    run_dir = runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    base_args = [sys.executable, "-m"]
    results: dict[str, dict] = {}

    # Collectors that only need --run-id
    simple_collectors = [
        "datum.closeout.collect_tasks",
        "datum.closeout.collect_platform",
        "datum.closeout.collect_lane_tools",
        "datum.closeout.collect_brief_defects",
        "datum.closeout.collect_token_metrics",
    ]
    for mod in simple_collectors:
        name = mod.split(".")[-1]
        proc = subprocess.run(
            [*base_args, mod, "--run-id", run_id],
            capture_output=True,
            text=True,
        )
        try:
            results[name] = json.loads(proc.stdout) if proc.stdout.strip() else {}
        except json.JSONDecodeError:
            results[name] = {"ok": False, "stderr": proc.stderr[:200]}

    # SHA-dependent collectors
    sha_collectors = [
        (
            "datum.closeout.collect_git",
            ["--base-sha", base_sha, "--merge-sha", merge_sha],
        ),
        (
            "datum.closeout.collect_gitnexus_diff",
            ["--base-sha", base_sha, "--merge-sha", merge_sha],
        ),
        (
            "datum.closeout.detect_solutions",
            ["--base-sha", base_sha, "--merge-sha", merge_sha],
        ),
    ]
    for mod, extra_args in sha_collectors:
        name = mod.split(".")[-1]
        proc = subprocess.run(
            [*base_args, mod, "--run-id", run_id, *extra_args],
            capture_output=True,
            text=True,
        )
        try:
            results[name] = json.loads(proc.stdout) if proc.stdout.strip() else {}
        except json.JSONDecodeError:
            results[name] = {"ok": False, "stderr": proc.stderr[:200]}

    return results


def run_collate(run_id: str, merge_sha: str, epic_number: int) -> Path:
    """Collate collector outputs into closeout-data.json."""
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "datum.closeout.collate",
            "--run-id",
            run_id,
            "--merge-sha",
            merge_sha,
            "--epic-number",
            str(epic_number),
        ],
        capture_output=True,
        text=True,
    )
    result = json.loads(proc.stdout) if proc.stdout.strip() else {}
    if not result.get("ok"):
        raise RuntimeError(f"collate failed: {proc.stderr[:300]}")
    return Path(result["output"])


def run_archive(run_id: str) -> None:
    """Archive run state."""
    subprocess.run(
        [sys.executable, "-m", "datum.closeout.archive", "--run-id", run_id],
        capture_output=True,
        text=True,
    )


def sweep_project_memories(memory_dir: Path, epic_branch: str) -> int:
    """Sweep project-state memories and stamp them with the closing epic and today's date."""
    if not memory_dir.is_dir():
        return 0

    count = 0
    today = datetime.now().strftime("%Y-%m-%d")

    for md_file in memory_dir.glob("*.md"):
        if md_file.name in {"MEMORY.md", "INDEX.md"}:
            continue

        content = md_file.read_text(encoding="utf-8")
        if not content.startswith("---"):
            continue

        end_idx = content.find("---", 3)
        if end_idx == -1:
            continue

        frontmatter = content[3:end_idx]
        if (
            "type: project" not in frontmatter
            and "type: 'project'" not in frontmatter
            and 'type: "project"' not in frontmatter
        ):
            continue

        # Add or update `epic:`
        if re.search(r"^epic:.*$", frontmatter, flags=re.MULTILINE):
            frontmatter = re.sub(
                r"^epic:.*$", f"epic: {epic_branch}", frontmatter, flags=re.MULTILINE
            )
        else:
            frontmatter = frontmatter.rstrip() + f"\nepic: {epic_branch}\n"

        # Add or update `updated:`
        if re.search(r"^updated:.*$", frontmatter, flags=re.MULTILINE):
            frontmatter = re.sub(
                r"^updated:.*$", f"updated: {today}", frontmatter, flags=re.MULTILINE
            )
        else:
            frontmatter = frontmatter.rstrip() + f"\nupdated: {today}\n"

        new_content = f"---{frontmatter}---{content[end_idx+3:]}"
        md_file.write_text(new_content, encoding="utf-8")
        count += 1

    return count
