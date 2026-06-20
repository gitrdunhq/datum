"""StatusSource port + factory (ADR-0029/0032)."""

from __future__ import annotations

from datum_ax.contracts.status import LiveStatus, StatusSource
from datum_ax.data.state.status import StatusProvider
from datum_ax.presentation.composition import build_status_source


def test_provider_satisfies_port():
    assert isinstance(StatusProvider(), StatusSource)


def test_build_status_source_returns_live_status():
    src = build_status_source()
    assert isinstance(src, StatusSource)
    assert isinstance(src.get_status(), LiveStatus)
