import pytest
from datum_ax.data.state.valkey import ValkeyCheckpointer

def test_valkey_checkpoint():
    checkpointer = ValkeyCheckpointer()
    checkpointer.save("run-123", {"stage": "plan"})
    state = checkpointer.get("run-123")
    assert state == {"stage": "plan"}
