"""datum-ax CONTRACTS — Protocols (ports) at every tier handoff (boundary layer; no tier).

May import only ``datum_ax.schemas`` and ``datum_ax._base``. ``core`` depends on these Protocols;
``data`` implements them; ``presentation`` wires them (ADR-0026).
"""

from __future__ import annotations

from datum_ax.contracts.context import (
    AstMap,
    CodeContext,
    DocContext,
    NlCompressor,
    NlDoc,
    SymbolSlice,
)
from datum_ax.contracts.execution import (
    ApplyResult,
    ArtifactBundle,
    ArtifactRef,
    ExecutionHost,
    ExecutionTarget,
    LintResult,
    Outcome,
    TestResult,
    UnifiedDiff,
)
from datum_ax.contracts.inference import (
    AssembledPrompt,
    Completion,
    InferenceClient,
    ModelRole,
    TokenBudget,
)
from datum_ax.contracts.review import (
    DecisionVerdict,
    Finding,
    FindingCategory,
    PolicyEvaluation,
    ReviewDecision,
    Severity,
)

__all__ = [
    "ApplyResult",
    "AssembledPrompt",
    "AstMap",
    "ArtifactBundle",
    "ArtifactRef",
    "CodeContext",
    "Completion",
    "DecisionVerdict",
    "DocContext",
    "ExecutionHost",
    "ExecutionTarget",
    "Finding",
    "FindingCategory",
    "InferenceClient",
    "LintResult",
    "ModelRole",
    "NlCompressor",
    "NlDoc",
    "Outcome",
    "PolicyEvaluation",
    "ReviewDecision",
    "Severity",
    "SymbolSlice",
    "TestResult",
    "TokenBudget",
    "UnifiedDiff",
]
