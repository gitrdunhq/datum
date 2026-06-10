"""Minimal calculator module for fixture testing."""

from __future__ import annotations


def add(a: int | float, b: int | float) -> int | float:
    """Return the sum of a and b."""
    return a + b


# NOTE: multiply is intentionally absent — it is the target function for the
# M1 driver's RED-GREEN cycle.  The driver writes a failing test for it (RED),
# then implements it here (GREEN).  Do not add multiply to this template.
