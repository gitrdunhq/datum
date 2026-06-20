from unittest.mock import MagicMock

from langgraph.graph.state import CompiledStateGraph

from datum_ax.contracts.inference import TokenBudget
from datum_ax.core.orchestration.crane import ContextCrane
from datum_ax.core.orchestration.graph import build_graph
from datum_ax.data.context.adapters import (
    Context7DocContext,
    HeadroomNlCompressor,
    SerenaTokenSaveContext,
)
from datum_ax.data.context.dcp import DynamicContextPruner
from datum_ax.presentation.composition import build_persona_registry
from fakes import FakeExecutionHost


def _crane() -> ContextCrane:
    return ContextCrane(
        code_context=SerenaTokenSaveContext(),
        doc_context=Context7DocContext(),
        nl_compressor=HeadroomNlCompressor(),
        pruner=DynamicContextPruner(),
        budget=TokenBudget(max_input=8000, max_output=2000, window_target=10000),
        persona=build_persona_registry(),
    )


def test_graph_end_to_end():
    graph = build_graph()
    assert isinstance(graph, CompiledStateGraph)

    # Hermetic: inject a mock inference client + fake host + real crane via config (DI). No network.
    mock_client = MagicMock()
    mock_client.complete.return_value.text = (
        '{"route": "feature", "target": "ui", "diff": "--- a\\n+++ b\\n+foo"}'
    )
    config = {
        "configurable": {
            "inference_client": mock_client,
            "execution_host": FakeExecutionHost(),
            "context_crane": _crane(),
        }
    }

    final_state = graph.invoke(
        {"ticket": {"text": "fake", "scale": "task"}, "workspace_dir": ".", "results": {}},
        config=config,
    )

    # The full node sequence ran end-to-end.
    assert final_state["visited_nodes"] == ["ROUTE", "PhaseA", "PhaseB", "CLOSEOUT"]
    # Real modules integrated and populated the results.
    assert "triage" in final_state["results"]
    assert "lanes" in final_state["results"]
    assert "lane_execution" in final_state["results"]
