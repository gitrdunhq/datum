"""Minimal calculator module for fixture testing."""

from __future__ import annotations


def add(a: int | float, b: int | float) -> int | float:
    """Return the sum of a and b."""
    return a + b


# NOTE: the product operation is intentionally absent — it is the target the
# M1 driver must fill via a RED-GREEN cycle (failing test first, then the
# implementation). Do not add it to this template.
