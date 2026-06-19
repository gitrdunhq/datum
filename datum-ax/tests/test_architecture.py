"""HARD boundary enforcement (ADR-0026): the import graph must flow downward only.

Parses every source module and fails the build on any upward or skip-tier import. This is the
boundary as code, not a docstring.
"""

from __future__ import annotations

import ast
import pathlib

SRC = pathlib.Path(__file__).resolve().parents[1] / "src" / "datum_ax"
TIERS = {"contracts", "schemas", "core", "data", "presentation"}

# importer tier -> tiers it is allowed to import
ALLOWED: dict[str, set[str]] = {
    "presentation": {"presentation", "core", "data", "contracts", "schemas", "base", "root"},
    "core": {"core", "contracts", "schemas", "base", "root"},
    "data": {"data", "contracts", "schemas", "base", "root"},
    "contracts": {"contracts", "schemas", "base", "root"},
    "schemas": {"schemas", "base", "root"},
    "base": {"base", "root"},
    "root": {"root", "base", "contracts", "schemas", "core", "data", "presentation"},
}


def _tier_of_file(path: pathlib.Path) -> str:
    rel = path.relative_to(SRC).parts
    if rel[0] == "_base.py":
        return "base"
    if rel[0] in TIERS:
        return rel[0]
    return "root"  # datum_ax/__init__.py


def _tier_of_module(module: str) -> str | None:
    if module != "datum_ax" and not module.startswith("datum_ax."):
        return None  # external import — out of scope for boundary checks
    parts = module.split(".")[1:]
    if not parts:
        return "root"
    if parts[0] == "_base":
        return "base"
    if parts[0] in TIERS:
        return parts[0]
    return "root"


def _imported_modules(path: pathlib.Path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            yield node.module


def test_import_boundaries_enforced():
    violations: list[str] = []
    for path in sorted(SRC.rglob("*.py")):
        importer = _tier_of_file(path)
        for module in _imported_modules(path):
            importee = _tier_of_module(module)
            if importee is None:
                continue
            if importee not in ALLOWED[importer]:
                rel = path.relative_to(SRC)
                violations.append(f"{rel} [{importer}] -> {module} [{importee}]")
    assert not violations, "tier boundary violations (ADR-0026):\n" + "\n".join(violations)
