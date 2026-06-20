"""datum-ax persona-registry adapters (ADR-0033/0032).

`PERSONA_REGISTRIES` is the plugin registry; adapter modules in this package auto-register on import.
Drop a new `*.py` here that calls `@PERSONA_REGISTRIES.register("<name>")` and it becomes available —
no central edit (open/closed). `FilePersonaRegistry` (markdown + frontmatter on disk) is the default.
"""

from __future__ import annotations

import importlib
import pkgutil

from datum_ax.contracts.persona import PersonaRegistry
from datum_ax.registry import Registry

PERSONA_REGISTRIES: Registry[PersonaRegistry] = Registry("persona-registry")

# Auto-discover adapter modules so they self-register (plugin drop-in).
for _module in pkgutil.iter_modules(__path__):
    if not _module.name.startswith("_"):
        importlib.import_module(f"{__name__}.{_module.name}")

__all__ = ["PERSONA_REGISTRIES"]
