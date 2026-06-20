import pytest
from datum_ax.core.orchestration.graph import build_graph
from langgraph.graph.state import CompiledStateGraph

from unittest.mock import MagicMock

def test_graph_end_to_end():
    graph = build_graph()
    
    assert isinstance(graph, CompiledStateGraph)
    
    mock_client = MagicMock()
    mock_client.complete.return_value.text = '{"route": "feature", "target": "ui", "diff": "--- a\\n+++ b\\n+foo"}'
    
    # Run the graph with a starting state
    final_state = graph.invoke({
        "ticket": {"text": "fake", "scale": "task"},
        "inference_client": mock_client,
        "results": {}
    })
    
    # Verify the sequence of nodes was executed
    assert "visited_nodes" in final_state
    assert final_state["visited_nodes"] == ["ROUTE", "PhaseA", "PhaseB", "CLOSEOUT"]
    
    # Verify integration with actual modules
    assert "triage" in final_state["results"]
    assert "synthesis_test" in final_state["results"]
