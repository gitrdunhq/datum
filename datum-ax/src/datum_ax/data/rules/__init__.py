"""datum-ax rule-registry adapters (ADR-0020/0032).

`RULE_REGISTRIES` is the plugin registry; adapter modules here auto-register on import. The file
registry (markdown + frontmatter) is the default.
"""

from __future__ import annotations

import importlib
import pkgutil

from datum_ax.contracts.rules import RuleRegistry
from datum_ax.registry import Registry

RULE_REGISTRIES: Registry[RuleRegistry] = Registry("rule-registry")

for _module in pkgutil.iter_modules(__path__):
    if not _module.name.startswith("_"):
        importlib.import_module(f"{__name__}.{_module.name}")

__all__ = ["RULE_REGISTRIES"]
