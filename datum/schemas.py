"""Pydantic schemas for grammar-constrained local LLM generation.

These schemas guarantee structurally valid output from Gemma via outlines.
Used by datum.local_llm.structured() to constrain generation.

Constraint posture:
  CORRECTNESS constraints (Literal enums, required fields, types) → reject.
  SOFT/DISPLAY constraints (max_length on strings) → repair (truncate).
  xgrammar does NOT enforce maxLength, so over-long strings are reachable
  from normal model behavior and must not crash the episode.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


def _truncate(v: str, limit: int) -> str:
    """Truncate a string to *limit* chars.  Preserves the first N chars exactly."""
    if isinstance(v, str) and len(v) > limit:
        return v[:limit]
    return v


class TriageDecision(BaseModel):
    decision: Literal["deepen", "properties"]
    reason: str = Field(max_length=200)

    @field_validator("reason", mode="before")
    @classmethod
    def _trunc_reason(cls, v: str) -> str:
        return _truncate(v, 200)


class ClassificationOverride(BaseModel):
    tier: Literal["patch", "feature", "system"]
    reason: str = Field(max_length=200)

    @field_validator("reason", mode="before")
    @classmethod
    def _trunc_reason(cls, v: str) -> str:
        return _truncate(v, 200)


class GateVerdict(BaseModel):
    passed: bool
    message: str = Field(max_length=300)

    @field_validator("message", mode="before")
    @classmethod
    def _trunc_message(cls, v: str) -> str:
        return _truncate(v, 300)


class FailureClassification(BaseModel):
    category: Literal["ENVIRONMENTAL", "REASONING", "UNKNOWN"]
    reason: str = Field(max_length=200)
    retry: bool

    @field_validator("reason", mode="before")
    @classmethod
    def _trunc_reason(cls, v: str) -> str:
        return _truncate(v, 200)


class ReviewFinding(BaseModel):
    id: str = Field(max_length=20)
    severity: Literal["critical", "high", "medium", "low", "info"]
    file: str
    line: int
    description: str = Field(max_length=300)
    suggestion: str = Field(max_length=300)

    @field_validator("id", mode="before")
    @classmethod
    def _trunc_id(cls, v: str) -> str:
        return _truncate(v, 20)

    @field_validator("description", mode="before")
    @classmethod
    def _trunc_description(cls, v: str) -> str:
        return _truncate(v, 300)

    @field_validator("suggestion", mode="before")
    @classmethod
    def _trunc_suggestion(cls, v: str) -> str:
        return _truncate(v, 300)


class EscalationSignal(BaseModel):
    escalate: bool
    reason: str = Field(max_length=200)

    @field_validator("reason", mode="before")
    @classmethod
    def _trunc_reason(cls, v: str) -> str:
        return _truncate(v, 200)


# ── Prior Art schemas ─────────────────────────────────────────────────────────


class PriorArtFinding(BaseModel):
    source_type: Literal["github", "pypi", "internal", "web"]
    url: str = Field(max_length=500)
    name: str = Field(max_length=100)
    relevance: Literal["high", "medium", "low"]
    license: str = Field(max_length=50)
    verdict: Literal["use", "wrap", "vendor", "reference", "skip"]
    rationale: str = Field(max_length=300)
    reduces_loc: int = Field(ge=0)

    @field_validator("url", mode="before")
    @classmethod
    def _trunc_url(cls, v: str) -> str:
        return _truncate(v, 500)

    @field_validator("name", mode="before")
    @classmethod
    def _trunc_name(cls, v: str) -> str:
        return _truncate(v, 100)

    @field_validator("license", mode="before")
    @classmethod
    def _trunc_license(cls, v: str) -> str:
        return _truncate(v, 50)

    @field_validator("rationale", mode="before")
    @classmethod
    def _trunc_rationale(cls, v: str) -> str:
        return _truncate(v, 300)


class PriorArtTaskResult(BaseModel):
    task_id: str = Field(max_length=20)
    findings: list[PriorArtFinding]
    recommendation: Literal["build", "wrap", "vendor", "skip"]
    recommendation_rationale: str = Field(max_length=300)

    @field_validator("task_id", mode="before")
    @classmethod
    def _trunc_task_id(cls, v: str) -> str:
        return _truncate(v, 20)

    @field_validator("recommendation_rationale", mode="before")
    @classmethod
    def _trunc_rationale(cls, v: str) -> str:
        return _truncate(v, 300)


class SecurityCheckResult(BaseModel):
    status: Literal["clear", "flag", "fail", "n/a"]
    details: str = Field(max_length=300)

    @field_validator("details", mode="before")
    @classmethod
    def _trunc_details(cls, v: str) -> str:
        return _truncate(v, 300)


class SecurityAuditResult(BaseModel):
    package: str = Field(max_length=100)
    version: str = Field(max_length=30)
    verdict: Literal["pass", "accept_risk", "reject"]
    checks: dict[str, SecurityCheckResult]
    risk_summary: str = Field(max_length=300)
    conditions: list[str] = Field(default_factory=list)

    @field_validator("package", mode="before")
    @classmethod
    def _trunc_package(cls, v: str) -> str:
        return _truncate(v, 100)

    @field_validator("version", mode="before")
    @classmethod
    def _trunc_version(cls, v: str) -> str:
        return _truncate(v, 30)

    @field_validator("risk_summary", mode="before")
    @classmethod
    def _trunc_risk_summary(cls, v: str) -> str:
        return _truncate(v, 300)


# ── Multi-turn orchestration schemas ────────────────────────────────────────


class StepAction(BaseModel):
    action: Literal[
        "analyze", "decompose", "execute", "verify", "synthesize", "tool_execution"
    ]
    description: str = Field(max_length=80)

    @field_validator("description", mode="before")
    @classmethod
    def _trunc_description(cls, v: str) -> str:
        return _truncate(v, 80)


class StepPlan(BaseModel):
    steps: list[StepAction] = Field(min_length=1, max_length=4)
    rationale: str = Field(max_length=80)

    @field_validator("rationale", mode="before")
    @classmethod
    def _trunc_rationale(cls, v: str) -> str:
        return _truncate(v, 80)


class ToolCall(BaseModel):
    tool_name: str = Field(max_length=50)
    tool_args: dict

    @field_validator("tool_name", mode="before")
    @classmethod
    def _trunc_tool_name(cls, v: str) -> str:
        return _truncate(v, 50)


class AgentDecision(BaseModel):
    """One ReAct step: call exactly one tool, or declare the task done.

    Filled by the fast-tier model from the reasoning model's thought text.
    For write tools the file content is NOT carried here — it is extracted
    deterministically from the thought's fenced code block (Python boundary).
    """

    action: Literal["tool", "done"]
    tool_name: str = Field(default="", max_length=50)
    tool_args: dict = Field(default_factory=dict)
    summary: str = Field(default="", max_length=300)

    @field_validator("tool_name", mode="before")
    @classmethod
    def _trunc_tool_name(cls, v: str) -> str:
        return _truncate(v, 50)

    @field_validator("summary", mode="before")
    @classmethod
    def _trunc_summary(cls, v: str) -> str:
        return _truncate(v, 300)


class StepResult(BaseModel):
    step_index: int
    action: Literal[
        "analyze", "decompose", "execute", "verify", "synthesize", "tool_execution"
    ]
    finding: str = Field(max_length=80)
    evidence: str = Field(max_length=80)
    recommendation: Literal[
        "deepen",
        "properties",
        "escalate",
        "proceed",
        "block",
        "retest",
        "skip",
        "retry_with_context",
    ]
    confidence: float = Field(ge=0.0, le=1.0)
    needs_more_turns: bool
    escalate: bool = False
    tool_call: ToolCall | None = None

    @field_validator("finding", mode="before")
    @classmethod
    def _trunc_finding(cls, v: str) -> str:
        return _truncate(v, 80)

    @field_validator("evidence", mode="before")
    @classmethod
    def _trunc_evidence(cls, v: str) -> str:
        return _truncate(v, 80)
