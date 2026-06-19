"""datum-ax — asymmetric agentic language pipeline.

E1 ships the boundary layer only: `contracts` (Protocols / ports) and `schemas` (domain value
objects). The `presentation`, `core`, and `data` tiers exist with the import boundary enforced
(ADR-0026) and are filled by later epics (see docs/BUILD-INITIATIVE.md).
"""

from __future__ import annotations

__version__ = "0.0.1"
