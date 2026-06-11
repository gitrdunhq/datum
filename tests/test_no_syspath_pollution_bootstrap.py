"""Regression tests for issue #106: import-time sys.path pollution (bootstrap/closeout).

Same bug class as #102 (core modules): the bootstrap and closeout collector
modules used to run ``sys.path.insert(0, <datum package dir>)`` at import time.
``seed_state_docs`` is imported in-process by ``datum init`` (datum/cli.py), so
the CLI polluted its own sys.path, making every internal module importable as a
top-level name and shadowing downstream consumers' packages.

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
    "datum.bootstrap.seed_state_docs",
    "datum.bootstrap.install_hooks",
    "datum.bootstrap.setup_symlinks",
    "datum.closeout.collect_brief_defects",
    "datum.closeout.collect_platform",
    "datum.closeout.collect_gitnexus_diff",
    "datum.closeout.collect_lane_tools",
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


def test_importing_bootstrap_closeout_does_not_prepend_package_dir_to_sys_path():
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


def test_datum_init_import_path_does_not_pollute_sys_path():
    """The exact import `datum init` performs must leave the package dir off sys.path."""
    code = (
        "from datum.bootstrap import seed_state_docs\n"
        "import sys\n"
        "from pathlib import Path\n"
        f"pkg = Path({str(PKG_DIR)!r}).resolve()\n"
        "entries = [Path(p).resolve() for p in sys.path if p]\n"
        "assert pkg not in entries, f'datum init import polluted sys.path: {sys.path!r}'\n"
    )
    result = _run(code)
    assert result.returncode == 0, result.stderr


def test_internal_modules_do_not_shadow_top_level_names():
    """After importing, internal names must not resolve as top-level modules."""
    code = (
        f"{IMPORT_ALL}\n"
        "import sys\n"
        "assert 'path_utils' not in sys.modules, 'import leaked top-level path_utils'\n"
        "for name in ('path_utils', 'bootstrap', 'closeout'):\n"
        "    try:\n"
        "        __import__(name)\n"
        "    except ModuleNotFoundError:\n"
        "        pass\n"
        "    else:\n"
        "        raise AssertionError(f'internal module {name!r} importable as top-level')\n"
    )
    result = _run(code)
    assert result.returncode == 0, result.stderr


def test_no_syspath_insert_in_bootstrap_closeout_modules():
    """No runtime sys.path.insert may remain in the seven modules."""
    offenders = []
    for module in MODULES:
        path = PKG_DIR.joinpath(*module.split(".")[1:]).with_suffix(".py")
        if "sys.path.insert" in path.read_text():
            offenders.append(str(path))
    assert not offenders, f"sys.path.insert found in: {offenders}"
