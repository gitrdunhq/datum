from datum_ax.data.state.checkpoint import InMemoryCheckpointer


def test_checkpoint_save_get():
    cp = InMemoryCheckpointer()
    cp.save("run-123", {"stage": "plan"})
    assert cp.get("run-123") == {"stage": "plan"}
