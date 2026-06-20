"""Live status snapshot (ADR-0029) — a single JSON of everything the pipeline is doing *now*.

Produced by core/data, consumed by the presentation API (`GET /status`) and CLI (`status --json`).
Point-in-time only; the durable history is the libSQL ledger (ADR-0013). Dual-artifact: machines
read this JSON, humans get it rendered (ADR-0027).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Protocol, runtime_checkable

from pydantic import Field, model_validator

from datum_ax._base import Contract
from datum_ax.contracts.execution import ExecutionTarget
from datum_ax.contracts.inference import ModelRole
from datum_ax.schemas.ticket import Route, WorkScale


class Phase(str, Enum):
    IDLE = "idle"
    INTAKE = "intake"
    REFINE = "refine"
    PLAN = "plan"
    PROPERTIES = "properties"
    ACT = "act"
    VALIDATE = "validate"
    REVIEW = "review"
    CLOSEOUT = "closeout"


class LaneStage(str, Enum):
    RED = "red"
    REFLECT = "reflect"
    GREEN = "green"
    SKEPTIC = "skeptic"
    DISCIPLINE = "discipline"
    EEDOM = "eedom"
    DONE = "done"
    BLOCKED = "blocked"
    FAILED = "failed"


class GateState(str, Enum):
    PENDING = "pending"
    PASS = "pass"
    FAIL = "fail"
    BLOCKING = "blocking"


class LaneStatus(Contract):
    lane_id: str = Field(min_length=1)
    stage: LaneStage
    wave: int = Field(ge=0)
    attempt: int = Field(ge=0)
    target: ExecutionTarget


class InferenceStatus(Contract):
    """Boundedness: in-flight calls never exceed the semaphore capacity (ADR-0003)."""

    active_calls: int = Field(ge=0)
    max_connections: int = Field(gt=0)
    active_roles: tuple[ModelRole, ...] = ()

    @model_validator(mode="after")
    def _within_capacity(self) -> "InferenceStatus":
        if self.active_calls > self.max_connections:
            raise ValueError("active_calls exceeds max_connections (Boundedness violation)")
        return self


class WindowStatus(Contract):
    tokens_in_window: int = Field(ge=0)
    window_target: int = Field(gt=0)

    @property
    def occupancy_pct(self) -> float:
        return round(100.0 * self.tokens_in_window / self.window_target, 2)


class BudgetStatus(Contract):
    tokens_spent: int = Field(ge=0)
    token_ceiling: int = Field(gt=0)
    wall_clock_s: float = Field(ge=0)
    wall_clock_ceiling_s: float = Field(gt=0)


class GateStatus(Contract):
    name: str = Field(min_length=1)
    state: GateState


class LiveStatus(Contract):
    """The single live-stats artifact: everything the pipeline is doing at ``captured_at``."""

    captured_at: datetime
    phase: Phase
    inference: InferenceStatus
    window: WindowStatus
    budget: BudgetStatus
    run_id: str | None = None
    route: Route | None = None
    scale: WorkScale | None = None
    epic: str | None = None
    current_wave: int | None = Field(default=None, ge=0)
    waves_total: int = Field(default=0, ge=0)
    lanes: tuple[LaneStatus, ...] = ()
    gates: tuple[GateStatus, ...] = ()
    pending_interrupts: int = Field(default=0, ge=0)


@runtime_checkable
class StatusSource(Protocol):
    """Port for the live-status snapshot producer (ADR-0029/0032)."""

    def get_status(self) -> LiveStatus: ...
