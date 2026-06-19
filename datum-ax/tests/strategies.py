"""Hypothesis strategies for every boundary model (E1).

JSON-safe printable text, bounded numerics, and composites that respect cross-field invariants so
the generic property tests only ever see *valid* instances (invalids are tested explicitly).
"""

from __future__ import annotations

from datetime import datetime

from hypothesis import strategies as st

from datum_ax.contracts.context import AstMap, NlDoc, SymbolSlice
from datum_ax.contracts.execution import (
    ApplyResult,
    ArtifactBundle,
    ArtifactRef,
    ExecutionTarget,
    LintResult,
    Outcome,
    TestResult,
    UnifiedDiff,
)
from datum_ax.contracts.inference import AssembledPrompt, Completion, ModelRole, TokenBudget
from datum_ax.contracts.review import (
    DecisionVerdict,
    Finding,
    FindingCategory,
    PolicyEvaluation,
    ReviewDecision,
    Severity,
)
from datum_ax.contracts.status import (
    BudgetStatus,
    GateState,
    GateStatus,
    InferenceStatus,
    LaneStage,
    LaneStatus,
    LiveStatus,
    Phase,
    WindowStatus,
)
from datum_ax.data.inference.roles import ModelRoleRegistry, RoleConfig
from datum_ax.data.inference.wire import ChatMessage, ChatRequest, ChatResponse, Usage
from datum_ax.schemas.properties import Property, PropertyDomain, PropertyType
from datum_ax.schemas.rules import RuleKind, RuleRegistryEntry, RuleTier
from datum_ax.schemas.ticket import (
    AcceptanceCriterion,
    Ambiguity,
    Classification,
    Complexity,
    Epic,
    Initiative,
    OpenQuestion,
    Route,
    Scope,
    Ticket,
    WorkScale,
)

# --- primitives -----------------------------------------------------------------------------------
_ASCII = st.characters(min_codepoint=33, max_codepoint=126)
text1 = st.text(_ASCII, min_size=1, max_size=40)  # non-empty, JSON-safe
text0 = st.text(_ASCII, max_size=40)  # possibly empty
opt_text = st.none() | text1
tup_text = st.lists(text1, max_size=3).map(tuple)
nonneg_int = st.integers(min_value=0, max_value=10**6)
nonneg_float = st.floats(min_value=0, max_value=1e6, allow_nan=False, allow_infinity=False).map(
    lambda x: round(x, 6)
)
dt = st.datetimes(min_value=datetime(1970, 1, 1), max_value=datetime(2100, 1, 1))


def _enum(e: type) -> st.SearchStrategy:
    return st.sampled_from(list(e))


# --- schemas --------------------------------------------------------------------------------------
property_st = st.builds(
    Property,
    id=text1,
    domain=_enum(PropertyDomain),
    type=_enum(PropertyType),
    statement=text1,
    lane_ids=tup_text,
    evidence_shape=opt_text,
)

acceptance_st = st.builds(AcceptanceCriterion, id=text1, statement=text1, met=st.booleans())
open_question_st = st.builds(OpenQuestion, question=text1, blocking=st.booleans())
classification_st = st.builds(
    Classification,
    complexity=_enum(Complexity),
    scope=_enum(Scope),
    ambiguity=_enum(Ambiguity),
    suggested_route=_enum(Route),
)
ticket_st = st.builds(
    Ticket,
    title=text1,
    intent=text1,
    scale=st.sampled_from([WorkScale.TASK, WorkScale.EPIC]),
    classification=classification_st,
    context=opt_text,
    requirements=tup_text,
    non_goals=tup_text,
    acceptance_criteria=st.lists(acceptance_st, max_size=3).map(tuple),
    constraints=tup_text,
    assumptions=tup_text,
    open_questions=st.lists(open_question_st, max_size=3).map(tuple),
)
epic_st = st.builds(
    Epic, id=text1, title=text1, intent=text1, scope=text1, depends_on=tup_text,
    shippable=st.booleans(),
)
initiative_st = st.builds(
    Initiative,
    intent=text1,
    epics=st.lists(epic_st, min_size=2, max_size=4, unique_by=lambda e: e.id).map(tuple),
    sequencing=opt_text,
    non_goals=tup_text,
    assumptions=tup_text,
    open_questions=st.lists(open_question_st, max_size=3).map(tuple),
)
rule_st = st.builds(
    RuleRegistryEntry,
    id=text1,
    kind=_enum(RuleKind),
    tier=_enum(RuleTier),
    statement=text1,
    scope_tags=tup_text,
    evidence_refs=st.lists(text1, min_size=1, max_size=3).map(tuple),
    version=st.integers(min_value=1, max_value=100),
    fire_count=st.integers(min_value=0, max_value=10**4),
)

# --- review contract ------------------------------------------------------------------------------
finding_st = st.builds(
    Finding,
    severity=_enum(Severity),
    category=_enum(FindingCategory),
    description=text1,
    source_tool=text1,
    advisory_id=opt_text,
    package_name=opt_text,
    version=opt_text,
    file=opt_text,
    line=st.none() | st.integers(min_value=1, max_value=10**5),
)
policy_eval_st = st.builds(
    PolicyEvaluation,
    decision=_enum(DecisionVerdict),
    triggered_rules=tup_text,
    constraints=tup_text,
    policy_bundle_version=text1,
)
review_decision_st = st.builds(
    ReviewDecision,
    decision_id=text1,
    decision=_enum(DecisionVerdict),
    policy_evaluation=policy_eval_st,
    should_comment=st.booleans(),
    should_mark_unstable=st.booleans(),
    findings=st.lists(finding_st, max_size=3).map(tuple),
    memo_text=text0,
    created_at=dt,
)

# --- execution contract ---------------------------------------------------------------------------
unified_diff_st = st.builds(UnifiedDiff, text=text0, target=_enum(ExecutionTarget))
apply_result_st = st.one_of(
    st.builds(ApplyResult, applied=st.just(True), conflicts=st.just(())),
    st.builds(ApplyResult, applied=st.just(False), conflicts=tup_text),
)


@st.composite
def _test_result(draw: st.DrawFn) -> TestResult:
    run = draw(st.none() | st.integers(min_value=0, max_value=500))
    passed = None if run is None else draw(st.none() | st.integers(min_value=0, max_value=run))
    return TestResult(
        outcome=draw(_enum(Outcome)),
        exit_code=draw(st.integers(min_value=-1, max_value=255)),
        duration_s=draw(nonneg_float),
        stdout=draw(text0),
        stderr=draw(text0),
        tests_run=run,
        tests_passed=passed,
    )


test_result_st = _test_result()
lint_result_st = st.builds(
    LintResult, outcome=_enum(Outcome), findings=tup_text, duration_s=nonneg_float
)
artifact_ref_st = st.builds(ArtifactRef, path=text1, size_bytes=nonneg_int)
artifact_bundle_st = st.builds(
    ArtifactBundle, artifacts=st.lists(artifact_ref_st, max_size=3).map(tuple)
)

# --- inference contract ---------------------------------------------------------------------------
@st.composite
def _token_budget(draw: st.DrawFn) -> TokenBudget:
    window = draw(st.integers(min_value=1, max_value=200_000))
    return TokenBudget(
        window_target=window,
        max_input=draw(st.integers(min_value=1, max_value=window)),
        max_output=draw(st.integers(min_value=1, max_value=64_000)),
    )


token_budget_st = _token_budget()
assembled_prompt_st = st.builds(
    AssembledPrompt, system=text0, global_ast=text0, diff=text0, suffix=tup_text
)
completion_st = st.builds(
    Completion,
    text=text0,
    model_id=text1,
    role=_enum(ModelRole),
    input_tokens=nonneg_int,
    output_tokens=nonneg_int,
    finish_reason=opt_text,
)

# --- context contract -----------------------------------------------------------------------------
symbol_slice_st = st.builds(
    SymbolSlice, name=text1, path=text1, content=text0, language=opt_text
)
ast_map_st = st.builds(AstMap, symbols=st.lists(symbol_slice_st, max_size=3).map(tuple))
nl_doc_st = st.builds(NlDoc, source=text1, text=text0, token_estimate=nonneg_int)


# --- live status contract -------------------------------------------------------------------------
lane_status_st = st.builds(
    LaneStatus,
    lane_id=text1,
    stage=_enum(LaneStage),
    wave=st.integers(min_value=0, max_value=20),
    attempt=st.integers(min_value=0, max_value=3),
    target=_enum(ExecutionTarget),
)


@st.composite
def _inference_status(draw: st.DrawFn) -> InferenceStatus:
    max_conn = draw(st.integers(min_value=1, max_value=8))
    return InferenceStatus(
        max_connections=max_conn,
        active_calls=draw(st.integers(min_value=0, max_value=max_conn)),
        active_roles=draw(st.lists(_enum(ModelRole), max_size=3).map(tuple)),
    )


inference_status_st = _inference_status()


@st.composite
def _window_status(draw: st.DrawFn) -> WindowStatus:
    window = draw(st.integers(min_value=1, max_value=200_000))
    return WindowStatus(
        window_target=window, tokens_in_window=draw(st.integers(min_value=0, max_value=window))
    )


window_status_st = _window_status()
budget_status_st = st.builds(
    BudgetStatus,
    tokens_spent=nonneg_int,
    token_ceiling=st.integers(min_value=1, max_value=10**7),
    wall_clock_s=nonneg_float,
    wall_clock_ceiling_s=st.floats(
        min_value=1, max_value=1e6, allow_nan=False, allow_infinity=False
    ).map(lambda x: round(x, 6)),
)
gate_status_st = st.builds(GateStatus, name=text1, state=_enum(GateState))
live_status_st = st.builds(
    LiveStatus,
    captured_at=dt,
    phase=_enum(Phase),
    inference=inference_status_st,
    window=window_status_st,
    budget=budget_status_st,
    run_id=opt_text,
    route=st.none() | _enum(Route),
    scale=st.none() | _enum(WorkScale),
    epic=opt_text,
    current_wave=st.none() | st.integers(min_value=0, max_value=20),
    waves_total=st.integers(min_value=0, max_value=20),
    lanes=st.lists(lane_status_st, max_size=4).map(tuple),
    gates=st.lists(gate_status_st, max_size=4).map(tuple),
    pending_interrupts=st.integers(min_value=0, max_value=10),
)

# --- E2 inference wire + roles --------------------------------------------------------------------
_temp = st.floats(min_value=0, max_value=2, allow_nan=False, allow_infinity=False).map(
    lambda x: round(x, 6)
)
chat_message_st = st.builds(
    ChatMessage, role=st.sampled_from(["system", "user", "assistant"]), content=text0
)
usage_st = st.builds(Usage, input_tokens=nonneg_int, output_tokens=nonneg_int)
chat_request_st = st.builds(
    ChatRequest,
    model=text1,
    messages=st.lists(chat_message_st, min_size=1, max_size=3).map(tuple),
    temperature=_temp,
    max_tokens=st.integers(min_value=1, max_value=64_000),
)
chat_response_st = st.builds(ChatResponse, text=text0, usage=usage_st, finish_reason=opt_text)
role_config_st = st.builds(RoleConfig, role=_enum(ModelRole), model_id=text1, temperature=_temp)


@st.composite
def _registry(draw: st.DrawFn) -> ModelRoleRegistry:
    roles = draw(st.lists(_enum(ModelRole), min_size=1, max_size=3, unique=True))
    return ModelRoleRegistry(
        configs=tuple(
            RoleConfig(role=r, model_id=f"m-{r.value}", temperature=0.0) for r in roles
        )
    )


registry_st = _registry()

# Every pure boundary model + a valid strategy (drives the generic property tests).
MODEL_STRATEGIES = {
    Property: property_st,
    AcceptanceCriterion: acceptance_st,
    OpenQuestion: open_question_st,
    Classification: classification_st,
    Ticket: ticket_st,
    Epic: epic_st,
    Initiative: initiative_st,
    RuleRegistryEntry: rule_st,
    Finding: finding_st,
    PolicyEvaluation: policy_eval_st,
    ReviewDecision: review_decision_st,
    UnifiedDiff: unified_diff_st,
    ApplyResult: apply_result_st,
    TestResult: test_result_st,
    LintResult: lint_result_st,
    ArtifactRef: artifact_ref_st,
    ArtifactBundle: artifact_bundle_st,
    TokenBudget: token_budget_st,
    AssembledPrompt: assembled_prompt_st,
    Completion: completion_st,
    SymbolSlice: symbol_slice_st,
    AstMap: ast_map_st,
    NlDoc: nl_doc_st,
    LaneStatus: lane_status_st,
    InferenceStatus: inference_status_st,
    WindowStatus: window_status_st,
    BudgetStatus: budget_status_st,
    GateStatus: gate_status_st,
    LiveStatus: live_status_st,
    ChatMessage: chat_message_st,
    Usage: usage_st,
    ChatRequest: chat_request_st,
    ChatResponse: chat_response_st,
    RoleConfig: role_config_st,
    ModelRoleRegistry: registry_st,
}
