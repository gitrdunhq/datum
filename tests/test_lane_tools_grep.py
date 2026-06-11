"""Tests for scripts/lane-tools/grep_search.py — issue #101.

When the model passes an `include` filter (e.g. "*.py"), the search must
remain recursive. The original code fell back to a non-recursive
`Path.glob(include)`, silently skipping subdirectories and reporting
"No matches" for code that exists — a false negative that makes the
agent loop conclude code doesn't exist.

The script is not importable as a module (lane-tools is not a package),
so these tests invoke it as a subprocess — same pattern as
tests/test_lane_run_command.py.
"""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "lane-tools" / "grep_search.py"


def _run(args: dict | str, timeout: int = 30) -> subprocess.CompletedProcess:
    payload = args if isinstance(args, str) else json.dumps(args)
    return subprocess.run(
        [sys.executable, str(SCRIPT), payload],
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=str(REPO_ROOT),
    )


def test_include_filter_searches_subdirectories(tmp_path):
    """#101 regression: include="*.py" must match files in subdirectories."""
    sub = tmp_path / "datum"
    sub.mkdir()
    (sub / "slug.py").write_text("def slugify(text):\n    return text\n")

    proc = _run({"pattern": "slugify", "path": str(tmp_path), "include": "*.py"})

    assert proc.returncode == 0
    assert "No matches" not in proc.stdout
    assert "datum/slug.py:1" in proc.stdout


def test_include_filter_still_matches_root_level_files(tmp_path):
    (tmp_path / "top.py").write_text("NEEDLE = 1\n")

    proc = _run({"pattern": "NEEDLE", "path": str(tmp_path), "include": "*.py"})

    assert proc.returncode == 0
    assert "top.py:1" in proc.stdout


def test_include_filter_excludes_non_matching_files(tmp_path):
    sub = tmp_path / "pkg"
    sub.mkdir()
    (sub / "code.py").write_text("NEEDLE\n")
    (sub / "notes.txt").write_text("NEEDLE\n")

    proc = _run({"pattern": "NEEDLE", "path": str(tmp_path), "include": "*.py"})

    assert proc.returncode == 0
    assert "code.py" in proc.stdout
    assert "notes.txt" not in proc.stdout


def test_invalid_regex_exits_nonzero(tmp_path):
    """TDD-004 negative path: a broken regex is an explicit error, not a crash."""
    proc = _run({"pattern": "[unclosed", "path": str(tmp_path)})

    assert proc.returncode == 1
    combined = proc.stdout + proc.stderr
    assert "Invalid regex" in combined
    assert "Traceback" not in combined
