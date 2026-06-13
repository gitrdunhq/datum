"""tdd_args — build structured workflow args from project state.

Produces a dict of typed arguments consumed by the TDD driver loop.
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path


def _sanitize_branch_slug(feature_name: str) -> str:
    """Return a valid git branch slug from a feature name.

    Rules applied in order:
    1. Replace spaces with dashes.
    2. Strip any character that is not alphanumeric, a dash, or an underscore.
    3. Collapse multiple consecutive dashes into one.
    4. Strip leading/trailing dashes.
    """
    slug = feature_name.lower().replace(" ", "-")
    slug = re.sub(r"[^a-z0-9\-_]", "", slug)
    slug = re.sub(r"-{2,}", "-", slug)
    slug = slug.strip("-")
    return slug


def _detect_test_command(repo_root: str) -> str:
    """Return the test command for the project rooted at repo_root.

    Detection order:
    1. If pyproject.toml exists and contains [tool.pytest.ini_options], return
       'uv run pytest -x -q'.
    2. Otherwise return the default 'uv run pytest -x -q'.

    The command is the same in both cases for this project; the detection step
    exists so future callers can extend it (e.g. detect tox, unittest, etc.).
    """
    default = "uv run pytest -x -q"
    pyproject_path = Path(repo_root) / "pyproject.toml"
    if not pyproject_path.exists():
        return default
    try:
        content = pyproject_path.read_text(encoding="utf-8")
        if "[tool.pytest" in content:
            return default
    except OSError:
        pass
    return default


def build_tdd_args(
    feature_name: str,
    lane_plan_path: str,
    repo_root: str,
) -> dict[str, str]:
    """Build a structured args dict for the TDD driver loop.

    Parameters
    ----------
    feature_name:
        Human-readable feature name (e.g. "BETA / GA").
    lane_plan_path:
        Absolute or relative path to the lane-plan JSON file.  Must exist.
    repo_root:
        Root directory of the repository.  Used for pyproject.toml detection
        and relative-path resolution.

    Returns
    -------
    dict with keys:
        epicBranch  — sanitized git branch name prefixed with 'feat/'
        runId       — timestamp string in YYYYMMDD-HHMMSS format
        lanePlanPath — the lane_plan_path argument as-is
        testCommand — detected or default pytest invocation
        language    — detected project language (always 'python' for now)

    Raises
    ------
    ValueError
        If lane_plan_path does not point to an existing file.
    """
    if not Path(lane_plan_path).exists():
        raise ValueError(
            f"lane_plan_path does not exist: {lane_plan_path!r}. "
            "Ensure the lane plan has been generated before calling build_tdd_args."
        )

    slug = _sanitize_branch_slug(feature_name)
    epic_branch = f"feat/{slug}"

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")

    test_command = _detect_test_command(repo_root)

    language = "python"

    return {
        "epicBranch": epic_branch,
        "runId": run_id,
        "lanePlanPath": lane_plan_path,
        "testCommand": test_command,
        "language": language,
    }
