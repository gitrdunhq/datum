"""eedom deterministic-review contract (ADR-0006). The data tier (eedom adapter) produces a
``ReviewDecision``; core branches on it. Mirrors eedom's ReviewDecision surface. Zero LLM.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import Field

from datum_ax._base import Contract


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class DecisionVerdict(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"
    NEEDS_REVIEW = "needs_review"
    APPROVE_WITH_CONSTRAINTS = "approve_with_constraints"


class FindingCategory(str, Enum):
    VULNERABILITY = "vulnerability"
    LICENSE = "license"
    MALICIOUS = "malicious"
    AGE = "age"
    TRANSITIVE_COUNT = "transitive_count"
    CODE = "code"
    SECRET = "secret"


class Finding(Contract):
    severity: Severity
    category: FindingCategory
    description: str = Field(min_length=1)
    source_tool: str = Field(min_length=1)
    advisory_id: str | None = None
    package_name: str | None = None
    version: str | None = None
    file: str | None = None
    line: int | None = Field(default=None, ge=1)


class PolicyEvaluation(Contract):
    decision: DecisionVerdict
    triggered_rules: tuple[str, ...] = ()
    constraints: tuple[str, ...] = ()
    policy_bundle_version: str = Field(min_length=1)


class ReviewDecision(Contract):
    """The verdict datum-ax gates on. ``is_blocking`` is a pure function of ``decision``."""

    decision_id: str = Field(min_length=1)
    decision: DecisionVerdict
    policy_evaluation: PolicyEvaluation
    should_comment: bool
    should_mark_unstable: bool
    findings: tuple[Finding, ...] = ()
    memo_text: str = ""
    created_at: datetime

    @property
    def is_blocking(self) -> bool:
        """True iff the verdict prevents terminal success (ADR-0006)."""
        return self.decision in (DecisionVerdict.REJECT, DecisionVerdict.NEEDS_REVIEW)
