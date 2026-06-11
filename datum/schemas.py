"""Pydantic schemas for grammar-constrained local LLM generation.

These schemas guarantee structurally valid output from Gemma via outlines.
Used by datum.local_llm.structured() to constrain generation.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TriageDecision(BaseModel):
    decision: Literal["deepen", "properties"]
    reason: str = Field(max_length=200)


class ClassificationOverride(BaseModel):
    tier: Literal["patch", "feature", "system"]
    reason: str = Field(max_length=200)


class GateVerdict(BaseModel):
    passed: bool
    message: str = Field(max_length=300)


class FailureClassification(BaseModel):
    category: Literal["ENVIRONMENTAL", "REASONING", "UNKNOWN"]
    reason: str = Field(max_length=200)
    retry: bool


class ReviewFinding(BaseModel):
    id: str = Field(max_length=20)
    severity: Literal["critical", "high", "medium", "low", "info"]
    file: str
    line: int
    description: str = Field(max_length=300)
    suggestion: str = Field(max_length=300)


class EscalationSignal(BaseModel):
    escalate: bool
    reason: str = Field(max_length=200)


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


class PriorArtTaskResult(BaseModel):
    task_id: str = Field(max_length=20)
    findings: list[PriorArtFinding]
    recommendation: Literal["build", "wrap", "vendor", "skip"]
    recommendation_rationale: str = Field(max_length=300)


class SecurityCheckResult(BaseModel):
    status: Literal["clear", "flag", "fail", "n/a"]
    details: str = Field(max_length=300)


class SecurityAuditResult(BaseModel):
    package: str = Field(max_length=100)
    version: str = Field(max_length=30)
    verdict: Literal["pass", "accept_risk", "reject"]
    checks: dict[str, SecurityCheckResult]
    risk_summary: str = Field(max_length=300)
    conditions: list[str] = Field(default_factory=list)


# ── Multi-turn orchestration schemas ────────────────────────────────────────


class StepAction(BaseModel):
    action: Literal[
        "analyze", "decompose", "execute", "verify", "synthesize", "tool_execution"
    ]
    description: str = Field(max_length=80)


class StepPlan(BaseModel):
    steps: list[StepAction] = Field(min_length=1, max_length=4)
    rationale: str = Field(max_length=80)


class ToolCall(BaseModel):
    tool_name: str = Field(max_length=50)
    tool_args: dict


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
