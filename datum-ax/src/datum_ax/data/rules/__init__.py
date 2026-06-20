"""datum-ax rule-registry adapters (ADR-0020/0032).

`RULE_REGISTRIES` is the plugin registry; adapter modules here auto-register on import. The file
registry (markdown + frontmatter) is the default.
"""

from __future__ import annotations

from datum_ax.contracts.rules import RuleRegistry
from datum_ax.registry import Registry, autodiscover

RULE_REGISTRIES: Registry[RuleRegistry] = Registry("rule-registry")

autodiscover(__name__, __path__)

__all__ = ["RULE_REGISTRIES"]
