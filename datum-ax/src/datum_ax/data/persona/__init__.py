"""datum-ax persona-registry adapters (ADR-0033/0032).

`PERSONA_REGISTRIES` is the plugin registry; adapter modules in this package auto-register on import.
Drop a new `*.py` here that calls `@PERSONA_REGISTRIES.register("<name>")` and it becomes available —
no central edit (open/closed). `FilePersonaRegistry` (markdown + frontmatter on disk) is the default.
"""

from __future__ import annotations

from datum_ax.contracts.persona import PersonaRegistry
from datum_ax.registry import Registry, autodiscover

PERSONA_REGISTRIES: Registry[PersonaRegistry] = Registry("persona-registry")

autodiscover(__name__, __path__)  # adapter modules self-register on import (plugin drop-in)

__all__ = ["PERSONA_REGISTRIES"]
