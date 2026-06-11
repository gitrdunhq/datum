"""Regression tests for issue #102: import-time sys.path pollution.

Six datum modules used to run ``sys.path.insert(0, <package dir>)`` at import
time, making every internal module importable as a top-level name and
shadowing downstream consumers' packages (e.g. datum-local's ``floor`` package
resolved to datum's internal ``floor.py``).

These tests run hermetic subprocesses (fresh interpreters) so the host test
session's own sys.path/sys.modules state cannot mask the pollution.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG_DIR = ROOT / "datum"

MODULES = [
    "datum.artifact",
    "datum.contracts",
    "datum.gate",
    "datum.lane_plan",
    "datum.migrate",
    "datum.self_check",
]

IMPORT_ALL = "; ".join(f"import {m}" for m in MODULES)


def _run(code: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_importing_datum_does_not_prepend_package_dir_to_sys_path():
    """The datum package dir must never land on sys.path of the host process."""
    code = (
        f"{IMPORT_ALL}\n"
        "import sys\n"
        "from pathlib import Path\n"
        f"pkg = Path({str(PKG_DIR)!r}).resolve()\n"
        "entries = [Path(p).resolve() for p in sys.path if p]\n"
        "assert pkg not in entries, f'datum package dir polluted sys.path: {sys.path!r}'\n"
    )
    result = _run(code)
    assert result.returncode == 0, result.stderr


def test_internal_modules_do_not_shadow_top_level_names():
    """After importing datum, internal names must not resolve as top-level modules."""
    code = (
        f"{IMPORT_ALL}\n"
        "import sys\n"
        "assert 'floor' not in sys.modules, 'datum import leaked top-level floor'\n"
        "assert 'path_utils' not in sys.modules, 'datum import leaked top-level path_utils'\n"
        "for name in ('contracts', 'floor', 'gate', 'path_utils'):\n"
        "    try:\n"
        "        __import__(name)\n"
        "    except ModuleNotFoundError:\n"
        "        pass\n"
        "    else:\n"
        "        raise AssertionError(f'internal module {name!r} importable as top-level')\n"
    )
    result = _run(code)
    assert result.returncode == 0, result.stderr


def test_no_syspath_insert_in_package_modules():
    """No runtime sys.path.insert may remain in the six modules (incl. inside functions)."""
    offenders = []
    for module in MODULES:
        path = PKG_DIR / (module.split(".")[1] + ".py")
        if "sys.path.insert" in path.read_text():
            offenders.append(str(path))
    assert not offenders, f"sys.path.insert found in: {offenders}"
