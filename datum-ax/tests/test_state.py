from datum_ax.core.orchestration.state import OrchestratorState


def test_orchestrator_state_defaults():
    ticket = {"title": "fake-ticket"}
    state = OrchestratorState(ticket=ticket, workspace_dir="/fake/dir")
    assert state.get("ticket") == ticket
    assert state.get("workspace_dir") == "/fake/dir"
    assert state.get("dag") is None
    assert state.get("current_wave", 0) == 0
