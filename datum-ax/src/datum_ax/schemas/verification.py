"""Verifier value objects (ADR-0007/0010). Typed shapes for the deterministic gates."""

from __future__ import annotations

from datum_ax._base import Contract


class LaneVerification(Contract):
    """Evidence the loop gathered for a lane attempt — the input to the deterministic gates."""

    test_present: bool = False
    red_observed: bool = False  # a failing test existed and ran (RED) before any implementation
    impl_present: bool = False


class GateResult(Contract):
    """The verdict of a deterministic (zero-token) gate."""

    passed: bool
    violations: tuple[str, ...] = ()
