from datetime import datetime

from datum_ax.contracts.status import Phase, LiveStatus
from datum_ax.data.state.status import StatusProvider


def test_status_provider_returns_live_status():
    provider = StatusProvider()

    # Provider should emit a valid LiveStatus object
    status = provider.get_status()

    assert isinstance(status, LiveStatus)
    assert status.phase == Phase.IDLE
    assert status.inference.active_calls == 0
    assert status.window.tokens_in_window == 0
    assert status.budget.tokens_spent == 0
    assert isinstance(status.captured_at, datetime)
