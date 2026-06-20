from typing import Any

from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph
from langchain_core.runnables import RunnableConfig

from datum_ax.core.orchestration.state import OrchestratorState
from datum_ax.core.planner.dag import DAGBuilder
from datum_ax.core.planner.lane_plan import plan_lanes
from datum_ax.core.planner.triage import triage_ticket
from datum_ax.core.verifier.synthesis import synthesize_impl, synthesize_test
from datum_ax.core.compound.closeout import run_closeout_harvest
from datum_ax.contracts.inference import InferenceClient
from datum_ax.contracts.execution import ExecutionHost, UnifiedDiff, ExecutionTarget
from datum_ax.observability import get_logger

logger = get_logger(__name__)


def get_inference_client(config: RunnableConfig) -> InferenceClient:
    """Return the injected InferenceClient (ADR-0026 dependency inversion).

    The concrete adapter is wired by the composition root (cli / presentation) and passed via
    ``config['configurable']`` — core never constructs ``data`` adapters itself.
    """
    client = (config.get("configurable") or {}).get("inference_client")
    if client is None:
        raise RuntimeError(
            "inference_client not provided. Wire it via config['configurable']['inference_client'] "
            "(see datum_ax.presentation.composition)."
        )
    return client


def get_execution_host(config: RunnableConfig) -> ExecutionHost:
    """Return the injected ExecutionHost (ADR-0026 dependency inversion)."""
    host = (config.get("configurable") or {}).get("execution_host")
    if host is None:
        raise RuntimeError(
            "execution_host not provided. Wire it via config['configurable']['execution_host'] "
            "(see datum_ax.presentation.composition)."
        )
    return host


def get_context_crane(config: RunnableConfig) -> Any:
    """Return the injected ContextCrane — the single assembler (ADR-0030).

    Optional: when absent, the planner/verifier fall back to building a bare prompt (test-only). The
    composition root always injects one, so the production loop routes all assembly through the crane.
    """
    return (config.get("configurable") or {}).get("context_crane")


def route_node(state: OrchestratorState) -> OrchestratorState:
    visited = state.get("visited_nodes", []) + ["ROUTE"]
    return {**state, "visited_nodes": visited}


def phase_a_node(state: OrchestratorState, config: RunnableConfig) -> OrchestratorState:
    visited = state.get("visited_nodes", []) + ["PhaseA"]
    ticket = state.get("ticket", {})
    client = get_inference_client(config)
    crane = get_context_crane(config)

    triage_result = triage_ticket(ticket, inference_client=client, crane=crane)
    lanes = plan_lanes(ticket, inference_client=client, crane=crane)

    waves = DAGBuilder().build_waves(lanes)

    results = state.get("results", {}).copy()
    results["triage"] = triage_result
    results["lanes"] = lanes

    return {
        **state,
        "visited_nodes": visited,
        "results": results,
        "dag": {"waves": waves},
        "current_wave": 0,
    }


def phase_b_node(state: OrchestratorState, config: RunnableConfig) -> OrchestratorState:
    visited = state.get("visited_nodes", []) + ["PhaseB"]
    client = get_inference_client(config)
    host = get_execution_host(config)
    crane = get_context_crane(config)

    dag = state.get("dag", {}) or {}
    waves = dag.get("waves", [])

    results = state.get("results", {}).copy()
    lane_results: list[dict[str, Any]] = []

    for wave_idx, wave in enumerate(waves):
        for lane in wave:
            logger.info(
                "lane_executing", lane_id=lane.get("id"), description=lane.get("description")
            )

            # 1. Test Synthesis
            test_result = synthesize_test(lane, inference_client=client, crane=crane)
            diff_text = test_result.get("diff", "")
            if diff_text:
                diff_obj = UnifiedDiff(text=diff_text, target=ExecutionTarget.MACOS)
                apply_result = host.apply_diff(diff_obj)
                test_result["applied"] = apply_result.applied
                test_result["conflicts"] = apply_result.conflicts

            # 2. Impl Synthesis
            impl_result = synthesize_impl(lane, inference_client=client, crane=crane)
            diff_text_impl = impl_result.get("diff", "")
            if diff_text_impl:
                diff_obj = UnifiedDiff(text=diff_text_impl, target=ExecutionTarget.MACOS)
                apply_result = host.apply_diff(diff_obj)
                impl_result["applied"] = apply_result.applied
                impl_result["conflicts"] = apply_result.conflicts

            lane_results.append({"lane": lane, "test": test_result, "impl": impl_result})

    results["lane_execution"] = lane_results

    return {**state, "visited_nodes": visited, "results": results}


def closeout_node(state: OrchestratorState, config: RunnableConfig) -> OrchestratorState:
    visited = state.get("visited_nodes", []) + ["CLOSEOUT"]
    results = state.get("results", {}).copy()
    # Compound engineering (ADR-0020): harvest the run's ledger into durable rules. Only when both the
    # ledger and a writable rule binder are injected (the composition root provides them).
    cfg = config.get("configurable") or {}
    ledger, binder = cfg.get("run_ledger"), cfg.get("rule_binder")
    if ledger is not None and binder is not None:
        harvested = run_closeout_harvest(ledger, binder, run_id=state.get("run_id", "run"))
        results["closeout"] = {
            "auto_bound": [r.id for r in harvested.auto_bound],
            "proposed": [r.id for r in harvested.proposed],
        }
        logger.info(
            "closeout_harvest",
            auto_bound=len(harvested.auto_bound),
            proposed=len(harvested.proposed),
        )
    return {**state, "visited_nodes": visited, "results": results}


def build_graph() -> CompiledStateGraph[Any, Any]:
    """Constructs the real langgraph state machine."""
    workflow = StateGraph(OrchestratorState)

    workflow.add_node("ROUTE", route_node)
    workflow.add_node("PhaseA", phase_a_node)
    workflow.add_node("PhaseB", phase_b_node)
    workflow.add_node("CLOSEOUT", closeout_node)

    workflow.add_edge(START, "ROUTE")
    workflow.add_edge("ROUTE", "PhaseA")
    workflow.add_edge("PhaseA", "PhaseB")
    workflow.add_edge("PhaseB", "CLOSEOUT")
    workflow.add_edge("CLOSEOUT", END)

    return workflow.compile()


# Module-level exported graph for LangGraph Studio
orchestrator_graph = build_graph()
