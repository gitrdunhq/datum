"""Unified episode Budget (#75).

Consolidates the episode limits scattered across agent_loop.py / local_llm.py
(max_steps, timeout_s, MAX_* constants, max_retries_per_turn) into one
dataclass. Consumable pools (turns, tool calls, tokens, wall clock) are
tracked via spend_*()/start() and checked via remaining_*/exhausted();
per-call caps (result chars, retries per call) are plain configuration.

``None`` = unlimited; ``0`` = immediately exhausted. Exhaustion triggers
exactly at the boundary (used >= max). Wall clock is injectable (``now=``)
for determinism, defaulting to ``time.monotonic()``. Pure module: no I/O,
stdlib only; ``to_dict``/``from_dict`` give a JSON-safe packet round-trip
(running wall time folds into ``wall_s_used`` for resume).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field, fields

# Exhaustion-check precedence (deterministic): counted pools first, wall last.
_DIMENSIONS = ("turns", "tool_calls", "tokens", "wall_clock")

_LIMIT_FIELDS = (
    "max_turns",
    "max_tool_calls",
    "max_tokens",
    "max_wall_s",
    "max_result_chars",
    "max_retries_per_call",
)


@dataclass
class Budget:
    """Episode limits with consumption tracking.

    Defaults mirror agent_loop.py today: max_steps=10, timeout_s=600,
    MAX_RECENT_OBSERVATION_CHARS=3000, max_retries_per_turn=2.
    """

    # ── limits (None = unlimited, 0 = immediately exhausted) ────────────
    max_turns: int | None = 10
    max_tool_calls: int | None = None
    max_tokens: int | None = None
    max_wall_s: float | None = 600.0
    # ── per-call caps (configuration, not consumable pools) ─────────────
    max_result_chars: int | None = 3000
    max_retries_per_call: int | None = 2
    # ── consumption ──────────────────────────────────────────────────────
    turns_used: int = 0
    tool_calls_used: int = 0
    tokens_used: int = 0
    wall_s_used: float = 0.0  # carried over from prior segments (resume)
    # Monotonic timestamp of start() for the current segment. Excluded from
    # equality/serialization: it is meaningless across processes.
    _started: float | None = field(default=None, repr=False, compare=False)

    def __post_init__(self) -> None:
        for name in _LIMIT_FIELDS:
            value = getattr(self, name)
            if value is not None and value < 0:
                raise ValueError(f"{name} must be >= 0 or None, got {value!r}")

    # ── wall clock ────────────────────────────────────────────────────────
    def start(self, now: float | None = None) -> None:
        """Arm the wall clock for this segment (idempotent re-arm on resume)."""
        self._started = time.monotonic() if now is None else now

    def elapsed_s(self, now: float | None = None) -> float:
        """Total wall seconds consumed: prior segments + the running one."""
        if self._started is None:
            return self.wall_s_used
        current = time.monotonic() if now is None else now
        return self.wall_s_used + (current - self._started)

    def remaining_wall_s(self, now: float | None = None) -> float | None:
        if self.max_wall_s is None:
            return None
        return max(0.0, self.max_wall_s - self.elapsed_s(now))

    # ── spending ──────────────────────────────────────────────────────────
    def spend_turn(self, n: int = 1) -> None:
        self.turns_used += _non_negative(n)

    def spend_tool_call(self, n: int = 1) -> None:
        self.tool_calls_used += _non_negative(n)

    def spend_tokens(self, n: int = 1) -> None:
        self.tokens_used += _non_negative(n)

    # ── remaining ─────────────────────────────────────────────────────────
    @property
    def remaining_turns(self) -> int | None:
        return _remaining(self.max_turns, self.turns_used)

    @property
    def remaining_tool_calls(self) -> int | None:
        return _remaining(self.max_tool_calls, self.tool_calls_used)

    @property
    def remaining_tokens(self) -> int | None:
        return _remaining(self.max_tokens, self.tokens_used)

    # ── exhaustion ────────────────────────────────────────────────────────
    def exhausted(self, now: float | None = None) -> str | None:
        """Name of the first exhausted dimension, or None if budget remains.

        Checked in _DIMENSIONS order so multi-exhaustion is deterministic.
        """
        for dim in _DIMENSIONS:
            if dim == "wall_clock":
                remaining = self.remaining_wall_s(now)
                if remaining is not None and remaining <= 0.0:
                    return dim
            else:
                remaining = getattr(self, f"remaining_{dim}")
                if remaining is not None and remaining <= 0:
                    return dim
        return None

    # ── serialization (orchestrator packets) ─────────────────────────────
    def to_dict(self, now: float | None = None) -> dict:
        """JSON-safe snapshot; running wall time folds into wall_s_used."""
        out = {
            f.name: getattr(self, f.name)
            for f in fields(self)
            if not f.name.startswith("_")
        }
        out["wall_s_used"] = self.elapsed_s(now)
        return out

    @classmethod
    def from_dict(cls, data: dict) -> Budget:
        """Build from a packet dict; unknown (envelope) keys are ignored."""
        known = {f.name for f in fields(cls) if not f.name.startswith("_")}
        return cls(**{k: v for k, v in data.items() if k in known})


def _remaining(limit: int | None, used: int) -> int | None:
    return None if limit is None else max(0, limit - used)


def _non_negative(n: int) -> int:
    if n < 0:
        raise ValueError(f"spend amount must be >= 0, got {n}")
    return n
