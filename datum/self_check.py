#!/usr/bin/env python3
"""Verify that documented DATUM contracts, scripts, schemas, and hooks exist."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

# Fix relative imports
sys.path.insert(0, str(Path(__file__).parent))
from datum.path_utils import skill_root

ROOT = skill_root()
DOC_GLOBS = ["SKILL.md", "references/*.md"]
REQUIRED_FILES = [
    "datum/contracts.py",
    "datum/path_utils.py",
    "datum/migrate.py",
    "datum/gate.py",
    "datum/render.py",
    "datum/commit_queue.py",
]
REQUIRED_CLOSEOUT_COLLECTORS = [
    "datum/closeout/collect_git.py",
    "datum/closeout/collect_tasks.py",
    "datum/closeout/collect_platform.py",
    "datum/closeout/collect_lane_tools.py",
    "datum/closeout/collect_brief_defects.py",
    "datum/closeout/collect_token_metrics.py",
    "datum/closeout/collect_gitnexus_diff.py",
    "datum/closeout/detect_solutions.py",
]
REQUIRED_HOOKS = [
    "assets/hooks/pre-commit-test-ratchet.sh",
    "assets/hooks/pre-commit-lane-tools-manifest.sh",
    "assets/hooks/pre-commit-layer-boundary.sh",
    "assets/hooks/pre-commit-file-size.sh",
    "assets/hooks/pre-commit-tdd-guard.sh",
    "assets/hooks/pre-commit-banned-patterns.sh",
    "assets/hooks/pre-tool-use-install-interceptor.sh",
]


def doc_files() -> list[Path]:
    files: list[Path] = []
    for pattern in DOC_GLOBS:
        files.extend(sorted(ROOT.glob(pattern)))
    return files


def documented_script_refs() -> set[str]:
    refs: set[str] = set()
    for path in doc_files():
        content = path.read_text()
        for raw in re.findall(r"(scripts/[A-Za-z0-9_./-]+\.py)", content):
            if raw == "scripts/datum.py":
                refs.add(raw)
                continue
            migrated = raw.replace("scripts/", "datum/", 1)
            if (ROOT / migrated).exists():
                refs.add(migrated)
            else:
                refs.add(raw)
        for m in re.findall(r"datum\.([A-Za-z0-9_.]+)", content):
            parts = m.split(".")
            found = False
            for i in range(len(parts), 0, -1):
                py_path = "datum/" + "/".join(parts[:i]) + ".py"
                pkg_path = "datum/" + "/".join(parts[:i]) + "/__init__.py"
                if (ROOT / py_path).exists() or (ROOT / pkg_path).exists():
                    refs.add(py_path if (ROOT / py_path).exists() else pkg_path)
                    found = True
                    break
            if not found:
                refs.add("datum/" + "/".join(parts) + ".py")
    return refs


def run_contract_self_test() -> tuple[bool, str]:
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/datum.py"),
            "datum.contracts",
            "self-test",
        ],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0, (result.stdout or result.stderr).strip()


def main() -> None:
    missing = []
    for path in REQUIRED_FILES + REQUIRED_CLOSEOUT_COLLECTORS + REQUIRED_HOOKS:
        if not (ROOT / path).exists():
            missing.append(path)

    for ref in sorted(documented_script_refs()):
        if not (ROOT / ref).exists():
            missing.append(ref)

    contract_ok, contract_output = run_contract_self_test()

    failures = []
    if missing:
        failures.append({"check": "missing_paths", "paths": sorted(set(missing))})
    if not contract_ok:
        failures.append({"check": "contract_fixtures", "output": contract_output})

    if failures:
        print(json.dumps({"ok": False, "failures": failures}, indent=2))
        sys.exit(1)

    print(
        json.dumps(
            {
                "ok": True,
                "documented_script_refs": len(documented_script_refs()),
                "required_paths": len(REQUIRED_FILES)
                + len(REQUIRED_CLOSEOUT_COLLECTORS)
                + len(REQUIRED_HOOKS),
                "contract_fixtures": contract_output,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
