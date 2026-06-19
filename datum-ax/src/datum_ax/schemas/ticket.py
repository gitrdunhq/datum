"""TICKET / INITIATIVE schema — the intake artifact (ADR-0024/0025).

The JSON form is the machine artifact (validated at every handoff); ``TICKET.md`` is the human
view (ADR-0027). Work-scale hierarchy: task/epic -> Ticket, initiative -> Initiative.
"""

from __future__ import annotations

from enum import Enum

from pydantic import Field, model_validator

from datum_ax._base import Contract


class Complexity(str, Enum):
    PATCH = "patch"
    FEATURE = "feature"
    SYSTEM = "system"


class Scope(str, Enum):
    NARROW = "narrow"
    MODERATE = "moderate"
    BROAD = "broad"


class Ambiguity(str, Enum):
    TRIVIAL = "trivial"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Route(str, Enum):
    FEATURE = "feature"
    HOTFIX = "hotfix"
    SPIKE = "spike"
    AUDIT = "audit"
    RESUME = "resume"
    REFINE_ONLY = "refine_only"


class WorkScale(str, Enum):
    TASK = "task"
    EPIC = "epic"
    INITIATIVE = "initiative"


class AcceptanceCriterion(Contract):
    id: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    met: bool = False


class OpenQuestion(Contract):
    question: str = Field(min_length=1)
    blocking: bool


class Classification(Contract):
    complexity: Complexity
    scope: Scope
    ambiguity: Ambiguity
    suggested_route: Route


class Ticket(Contract):
    """A single task/epic of work (the unit REFINE/PLAN consume)."""

    title: str = Field(min_length=1)
    intent: str = Field(min_length=1)
    scale: WorkScale
    classification: Classification
    context: str | None = None
    requirements: tuple[str, ...] = ()
    non_goals: tuple[str, ...] = ()
    acceptance_criteria: tuple[AcceptanceCriterion, ...] = ()
    constraints: tuple[str, ...] = ()
    assumptions: tuple[str, ...] = ()
    open_questions: tuple[OpenQuestion, ...] = ()

    @model_validator(mode="after")
    def _initiatives_are_not_tickets(self) -> "Ticket":
        if self.scale is WorkScale.INITIATIVE:
            raise ValueError("INITIATIVE scale must use Initiative, not Ticket (ADR-0025)")
        return self


class Epic(Contract):
    """One epic within an initiative; later expanded to its own Ticket."""

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    intent: str = Field(min_length=1)
    scope: str = Field(min_length=1)
    depends_on: tuple[str, ...] = ()
    shippable: bool = True


class Initiative(Contract):
    """A product/program spanning multiple epics (ADR-0025). Never one ticket."""

    intent: str = Field(min_length=1)
    epics: tuple[Epic, ...] = Field(min_length=2)
    sequencing: str | None = None
    non_goals: tuple[str, ...] = ()
    assumptions: tuple[str, ...] = ()
    open_questions: tuple[OpenQuestion, ...] = ()

    @model_validator(mode="after")
    def _epic_ids_unique(self) -> "Initiative":
        ids = [e.id for e in self.epics]
        if len(ids) != len(set(ids)):
            raise ValueError("epic ids must be unique")
        return self
