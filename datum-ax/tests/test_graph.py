from unittest.mock import MagicMock

from langgraph.graph.state import CompiledStateGraph

from datum_ax.core.orchestration.graph import build_graph
from fakes import FakeExecutionHost


def test_graph_end_to_end():
    graph = build_graph()
    assert isinstance(graph, CompiledStateGraph)

    # Hermetic: inject a mock inference client + a fake host via config (ADR-0026 DI). No network.
    mock_client = MagicMock()
    mock_client.complete.return_value.text = (
        '{"route": "feature", "target": "ui", "diff": "--- a\\n+++ b\\n+foo"}'
    )
    config = {
        "configurable": {
            "inference_client": mock_client,
            "execution_host": FakeExecutionHost(),
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
