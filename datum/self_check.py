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
    "scripts/contracts.py",
    "scripts/path_utils.py",
    "scripts/migrate.py",
    "scripts/gate.py",
    "scripts/render.py",
    "scripts/commit_queue.py",
    "assets/schemas/brief-red.schema.json",
    "assets/schemas/brief-green.schema.json",
    "assets/schemas/brief-green-continuation.schema.json",
    "assets/schemas/brief-refactor.schema.json",
    "assets/schemas/result-red.schema.json",
    "assets/schemas/result-green.schema.json",
    "assets/schemas/result-refactor.schema.json",
    "assets/schemas/result-adversarial.schema.json",
    "assets/schemas/lane-plan.schema.json",
]
REQUIRED_CLOSEOUT_COLLECTORS = [
    "scripts/closeout/collect_git.py",
    "scripts/closeout/collect_tasks.py",
    "scripts/closeout/collect_platform.py",
    "scripts/closeout/collect_lane_tools.py",
    "scripts/closeout/collect_brief_defects.py",
    "scripts/closeout/collect_token_metrics.py",
    "scripts/closeout/collect_gitnexus_diff.py",
    "scripts/closeout/detect_solutions.py",
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
        refs.update(re.findall(r"`(scripts/[A-Za-z0-9_./-]+\.py)(?:\s|`)", content))
        refs.update(re.findall(r"(scripts/[A-Za-z0-9_./-]+\.py)", content))
    return refs


def run_contract_self_test() -> tuple[bool, str]:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/contracts.py"), "self-test"],
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
