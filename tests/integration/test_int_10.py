"""task-INT-10: integration invariants covering task-002, task-004,
task-005, task-006, task-011.

INV-2: Each of the 7 migrated modules contains zero local
`STATE_FILE`/`load_state`/`save_state` redefinitions post-migration. Each
of these modules must resolve live state exclusively through the
canonical `datum.state` accessor, never through a local module-level
`STATE_FILE` path constant or a locally defined `load_state`/`save_state`
function that shadows the canonical one.

This is an integration lane: these tests exercise already-merged code
from task-002, task-004, task-005, task-006 and task-011 and are expected
to PASS. A failure here is a real finding about the migration boundary,
not a test to weaken.
"""

from __future__ import annotations

import ast
from pathlib import Path

import datum

_REPO_ROOT = Path(datum.__file__).resolve().parent.parent

# The 7 migrated modules covered by task-002, task-004, task-005,
# task-006 and task-011.
_MIGRATED_MODULES = [
    "datum/status_render.py",
    "datum/rollback.py",
    "datum/no_diff_guard.py",
    "datum/pr_comment_monitor.py",
    "datum/spec_drift_detector.py",
    "datum/path_utils.py",
    "datum/pipeline_scheduler.py",
]


def _local_state_redefinitions(module_path: Path) -> dict[str, list[str]]:
    """Parse module_path and return a dict of finding-category -> names
    found, for module-level `STATE_FILE = ...` assignments and top-level
    `def load_state` / `def save_state` function definitions."""
    tree = ast.parse(module_path.read_text(), filename=str(module_path))
    findings: dict[str, list[str]] = {
        "state_file_assignment": [],
        "load_state_def": [],
        "save_state_def": [],
    }
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "STATE_FILE":
                    findings["state_file_assignment"].append("STATE_FILE")
        if isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name) and node.target.id == "STATE_FILE":
                findings["state_file_assignment"].append("STATE_FILE")
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name == "load_state":
                findings["load_state_def"].append(node.name)
            if node.name == "save_state":
                findings["save_state_def"].append(node.name)
    return findings


def test_all_seven_migrated_modules_exist_at_documented_paths():
    missing = [p for p in _MIGRATED_MODULES if not (_REPO_ROOT / p).is_file()]
    assert (
        missing == []
    ), f"expected all 7 migrated modules to exist, missing: {missing}"
    assert len(_MIGRATED_MODULES) == 7


def test_migrated_modules_have_zero_local_state_file_redefinitions():
    offenders = []
    for rel_path in _MIGRATED_MODULES:
        module_path = _REPO_ROOT / rel_path
        findings = _local_state_redefinitions(module_path)
        if findings["state_file_assignment"]:
            offenders.append((rel_path, "STATE_FILE"))
    assert offenders == [], (
        "found local STATE_FILE redefinitions in migrated modules: " f"{offenders}"
    )


def test_migrated_modules_have_zero_local_load_state_redefinitions():
    offenders = []
    for rel_path in _MIGRATED_MODULES:
        module_path = _REPO_ROOT / rel_path
        findings = _local_state_redefinitions(module_path)
        if findings["load_state_def"]:
            offenders.append((rel_path, "load_state"))
    assert offenders == [], (
        "found local def load_state redefinitions in migrated modules: " f"{offenders}"
    )


def test_migrated_modules_have_zero_local_save_state_redefinitions():
    offenders = []
    for rel_path in _MIGRATED_MODULES:
        module_path = _REPO_ROOT / rel_path
        findings = _local_state_redefinitions(module_path)
        if findings["save_state_def"]:
            offenders.append((rel_path, "save_state"))
    assert offenders == [], (
        "found local def save_state redefinitions in migrated modules: " f"{offenders}"
    )


def test_each_migrated_module_reports_exactly_zero_total_redefinitions():
    per_module_counts = {}
    for rel_path in _MIGRATED_MODULES:
        module_path = _REPO_ROOT / rel_path
        findings = _local_state_redefinitions(module_path)
        total = sum(len(v) for v in findings.values())
        per_module_counts[rel_path] = total
    assert per_module_counts == {p: 0 for p in _MIGRATED_MODULES}
