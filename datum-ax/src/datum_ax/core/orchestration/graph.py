from typing import Any
from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph
from langchain_core.runnables import RunnableConfig

from datum_ax.core.orchestration.state import OrchestratorState
from datum_ax.core.planner.triage import triage_ticket
from datum_ax.core.verifier.synthesis import synthesize_test

def get_inference_client(config: RunnableConfig) -> Any:
    client = config.get("configurable", {}).get("inference_client")
    if client is not None:
        return client
    
    # LangGraph Studio fallback lazy initialization
    import os
    base_url = os.environ.get("OMLX_BASE_URL") or os.environ.get("OPENAI_API_BASE", "http://localhost:12201/v1")
    api_key = os.environ.get("OMLX_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    model_id = os.environ.get("OMLX_MODEL") or os.environ.get("OPENAI_MODEL") or os.environ.get("DATUM_MODEL", "gpt-4")
    
    from datum_ax.data.inference.httpx_transport import HttpxOmlxTransport
    from datum_ax.data.inference.client import OmlxInferenceClient
    from datum_ax.data.inference.roles import ModelRoleRegistry, RoleConfig
    from datum_ax.contracts.inference import ModelRole
    
    use_native_mlx = os.environ.get("DATUM_NATIVE_MLX") == "1"
    if use_native_mlx:
        from datum_ax.data.inference.transport_mlx import NativeMlxTransport
        transport = NativeMlxTransport()
    else:
        from datum_ax.data.inference.httpx_transport import HttpxOmlxTransport
        transport = HttpxOmlxTransport(base_url=base_url, api_key=api_key)
    registry = ModelRoleRegistry(configs=(
        RoleConfig(role=ModelRole.TRIAGE, model_id=model_id, temperature=0.0, response_format={"type": "json_object"}),
        RoleConfig(role=ModelRole.PLANNER, model_id=model_id, temperature=0.1, response_format={"type": "json_object"}),
        RoleConfig(role=ModelRole.EXECUTOR, model_id=model_id, temperature=0.2, response_format={"type": "json_object"}),
        RoleConfig(role=ModelRole.ADVERSARIAL, model_id=model_id, temperature=0.5)
    ))
    return OmlxInferenceClient(transport=transport, registry=registry)


def route_node(state: OrchestratorState) -> OrchestratorState:
    visited = state.get("visited_nodes", []) + ["ROUTE"]
    return {**state, "visited_nodes": visited}

def phase_a_node(state: OrchestratorState, config: RunnableConfig) -> OrchestratorState:
    visited = state.get("visited_nodes", []) + ["PhaseA"]
    ticket = state.get("ticket", {})
    client = get_inference_client(config)
    
    from datum_ax.core.planner.lane_plan import plan_lanes
    from datum_ax.core.planner.dag import DAGBuilder

    triage_result = triage_ticket(ticket, inference_client=client)
    lanes = plan_lanes(ticket, inference_client=client)
    
    waves = DAGBuilder().build_waves(lanes)
    
    results = state.get("results", {}).copy()
    results["triage"] = triage_result
    results["lanes"] = lanes
    
    return {
        **state, 
        "visited_nodes": visited, 
        "results": results,
        "dag": {"waves": waves},
        "current_wave": 0
    }

def phase_b_node(state: OrchestratorState, config: RunnableConfig) -> OrchestratorState:
    visited = state.get("visited_nodes", []) + ["PhaseB"]
    client = get_inference_client(config)
    workspace_dir = state.get("workspace_dir", ".")
    
    from datum_ax.data.execution.local import LocalHost
    from datum_ax.contracts.execution import UnifiedDiff, ExecutionTarget
    host = LocalHost(workspace_dir=workspace_dir)
    
    from datum_ax.core.verifier.synthesis import synthesize_impl
    
    dag = state.get("dag", {}) or {}
    waves = dag.get("waves", [])
    
    results = state.get("results", {}).copy()
    lane_results: list[dict[str, Any]] = []
    
    import logging
    
    for wave_idx, wave in enumerate(waves):
        for lane in wave:
            logging.info(f"Executing Lane: {lane.get('id')} - {lane.get('description')}")
            
            # 1. Test Synthesis
            test_result = synthesize_test(lane, inference_client=client)
            diff_text = test_result.get("diff", "")
            if diff_text:
                diff_obj = UnifiedDiff(text=diff_text, target=ExecutionTarget.MACOS)
                apply_result = host.apply_diff(diff_obj)
                test_result["applied"] = apply_result.applied
                test_result["conflicts"] = apply_result.conflicts
                
            # 2. Impl Synthesis
            impl_result = synthesize_impl(lane, inference_client=client)
            diff_text_impl = impl_result.get("diff", "")
            if diff_text_impl:
                diff_obj = UnifiedDiff(text=diff_text_impl, target=ExecutionTarget.MACOS)
                apply_result = host.apply_diff(diff_obj)
                impl_result["applied"] = apply_result.applied
                impl_result["conflicts"] = apply_result.conflicts
                
            lane_results.append({
                "lane": lane,
                "test": test_result,
                "impl": impl_result
            })
            
    results["lane_execution"] = lane_results
    
    return {**state, "visited_nodes": visited, "results": results}

def closeout_node(state: OrchestratorState) -> OrchestratorState:
    visited = state.get("visited_nodes", []) + ["CLOSEOUT"]
    return {**state, "visited_nodes": visited}

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
