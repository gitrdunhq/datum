"""Centralized logging (ADR-0013) — single source of truth for structured logs.

DPS-12 domains:
- Idempotency (INVARIANT): re-configuring never duplicates handlers.
- Determinism (INVARIANT): same config + same event → same rendered keys.
- Availability (LIVENESS): after configure, every log call succeeds.
- Single source of truth: only `observability.py` touches stdlib logging directly.
"""

from __future__ import annotations

import io
import json
import logging
import pathlib

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from datum_ax.observability import configure_logging, get_logger

_SUPPRESS_TMP = [HealthCheck.function_scoped_fixture]


def _reset_root() -> None:
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)


def test_get_logger_is_bound_and_chainable():
    log = get_logger("datum_ax.test")
    for method in ("debug", "info", "warning", "error"):
        assert callable(getattr(log, method))
    # structured binding returns a logger, doesn't raise
    bound = log.bind(run_id="r1")
    assert callable(bound.info)


def test_json_logfile_emits_one_json_object_per_event(tmp_path: pathlib.Path):
    logfile = tmp_path / "run.log"
    configure_logging(level="INFO", json_logs=True, logfile=str(logfile), console=False)
    get_logger("datum_ax.t").info("lane_started", lane_id="lane_1", attempt=2)

    line = logfile.read_text(encoding="utf-8").strip().splitlines()[-1]
    record = json.loads(line)
    assert record["event"] == "lane_started"
    assert record["lane_id"] == "lane_1"
    assert record["attempt"] == 2
    assert record["level"] == "info"
    assert "timestamp" in record


def test_console_stream_is_human_readable():
    stream = io.StringIO()
    configure_logging(level="INFO", json_logs=False, console=True, stream=stream)
    get_logger("datum_ax.t").warning("lane_too_large", lane_id="lane_9")
    out = stream.getvalue()
    assert "lane_too_large" in out
    assert "lane_9" in out


def test_below_level_is_filtered(tmp_path: pathlib.Path):
    logfile = tmp_path / "run.log"
    configure_logging(level="WARNING", json_logs=True, logfile=str(logfile), console=False)
    log = get_logger("datum_ax.t")
    log.info("should_not_appear")
    log.error("should_appear")
    body = logfile.read_text(encoding="utf-8")
    assert "should_appear" in body
    assert "should_not_appear" not in body


class TestProperties:
    @settings(max_examples=25, deadline=None, suppress_health_check=_SUPPRESS_TMP)
    @given(n=st.integers(min_value=1, max_value=6))
    def test_configure_is_idempotent_in_handler_count(self, n: int, tmp_path):
        """Idempotency INVARIANT: N reconfigurations leave a bounded, stable handler set."""
        logfile = tmp_path / "run.log"
        for _ in range(n):
            configure_logging(level="INFO", json_logs=True, logfile=str(logfile), console=False)
        # console=False + one logfile → exactly one handler, regardless of N
        assert len(logging.getLogger().handlers) == 1

    @settings(max_examples=25, deadline=None, suppress_health_check=_SUPPRESS_TMP)
    @given(
        level=st.sampled_from(["DEBUG", "INFO", "WARNING", "ERROR"]),
        event=st.text(st.characters(min_codepoint=97, max_codepoint=122), min_size=1, max_size=12),
    )
    def test_event_roundtrips_deterministically(self, level: str, event: str, tmp_path):
        """Determinism INVARIANT: a logged event renders with stable, parseable keys."""
        logfile = tmp_path / "run.log"
        configure_logging(level="DEBUG", json_logs=True, logfile=str(logfile), console=False)
        get_logger("datum_ax.t").info(event, k="v")
        record = json.loads(logfile.read_text(encoding="utf-8").strip().splitlines()[-1])
        assert record["event"] == event
        assert record["k"] == "v"


def test_logging_is_centralized():
    """Single source of truth: only observability.py imports/configures stdlib logging.

    Every other module must acquire loggers via `datum_ax.observability.get_logger` — no
    ad-hoc `logging.getLogger(...)`, no bare root-logger calls.
    """
    src = pathlib.Path(__file__).resolve().parents[1] / "src" / "datum_ax"
    offenders: list[str] = []
    for path in src.rglob("*.py"):
        if path.name == "observability.py":
            continue
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(src)
        if "import logging" in text:
            offenders.append(f"{rel}: imports stdlib logging directly")
        if "getLogger" in text:
            offenders.append(f"{rel}: calls getLogger directly")
    assert not offenders, "logging not centralized (ADR-0013):\n" + "\n".join(offenders)


@pytest.fixture(autouse=True)
def _clean_logging():
    _reset_root()
    yield
    _reset_root()
