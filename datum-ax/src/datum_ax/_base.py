"""Shared base for every typed contract and schema (boundary layer; no tier).

`Contract` is the hard-boundary value object: strict (no silent coercion), frozen (immutable),
and closed (`extra="forbid"`). Everything that crosses a tier handoff is a `Contract` or a
`runtime_checkable` Protocol — never a raw dict (ADR-0026).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class Contract(BaseModel):
    """Strict, immutable, closed value object."""

    model_config = ConfigDict(strict=True, frozen=True, extra="forbid")
