import pytest
from datum_ax.core.orchestration.state import OrchestratorState

def test_orchestrator_state_defaults():
    state = OrchestratorState(ticket="fake-ticket", workspace_dir="/fake/dir")
    assert state["ticket"] == "fake-ticket"
    assert state["workspace_dir"] == "/fake/dir"
    assert "dag" not in state or state["dag"] is None
    assert "current_wave" not in state or state["current_wave"] == 0
