"""RED (task-006): datum/path_utils.py must drop its dead state helpers
(state_file, load_state, current_run_id, and the STATE_FILE __getattr__
branch) now that datum/state.py is the single source of truth for live
state. run_dir(), datum_dir() and skill_root() must remain untouched since
16 modules still import from this file, and run_dir(run_id) / "state.json"
(the archival export path) must keep working.

See docs/epics/datum/state-single-source-of-truth/lane-plan.json, task-006.
"""

from __future__ import annotations

import subprocess
import sys

import pytest

import datum.path_utils as pu


def test_load_state_function_removed():
    assert not hasattr(pu, "load_state")


def test_state_file_function_removed():
    assert not hasattr(pu, "state_file")


def test_current_run_id_function_removed():
    assert not hasattr(pu, "current_run_id")


def test_state_file_attr_raises_attribute_error_via_getattr():
    with pytest.raises(AttributeError):
        pu.STATE_FILE


def test_module_importable_with_no_error():
    result = subprocess.run(
        [sys.executable, "-c", "import datum.path_utils"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert result.stderr == ""


def test_datum_dir_skill_root_and_run_dir_remain_importable_and_callable():
    assert callable(pu.datum_dir)
    assert callable(pu.skill_root)
    assert callable(pu.run_dir)
    # skill_root resolves to the datum package root, two levels up from this file
    assert pu.skill_root().name != ""
    assert pu.run_dir("abc123").name == "abc123"


def test_run_dir_archival_state_json_path_expression_retained():
    archived_state_path = pu.run_dir("run-xyz") / "state.json"
    assert archived_state_path.name == "state.json"
    assert archived_state_path.parent == pu.run_dir("run-xyz")


def test_module_docstring_no_longer_claims_ssot_for_state_and_points_to_state_py():
    doc = pu.__doc__ or ""
    assert "SSOT for all path resolution" not in doc
    assert "datum/state.py" in doc or "datum.state" in doc
