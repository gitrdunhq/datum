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


# ── Multi-turn orchestration schemas ────────────────────────────────────────


class StepAction(BaseModel):
    action: Literal["analyze", "decompose", "execute", "verify", "synthesize", "tool_execution"]
    description: str = Field(max_length=80)


class StepPlan(BaseModel):
    steps: list[StepAction] = Field(min_length=1, max_length=4)
    rationale: str = Field(max_length=80)


class ToolCall(BaseModel):
    tool_name: str = Field(max_length=50)
    tool_args: dict

class StepResult(BaseModel):
    step_index: int
    action: Literal["analyze", "decompose", "execute", "verify", "synthesize", "tool_execution"]
    finding: str = Field(max_length=80)
    evidence: str = Field(max_length=80)
    recommendation: Literal[
        "deepen", "properties", "escalate", "proceed", "block", "retest", "skip", "retry_with_context"
    ]
    confidence: float = Field(ge=0.0, le=1.0)
    needs_more_turns: bool
    escalate: bool = False
    tool_call: ToolCall | None = None
