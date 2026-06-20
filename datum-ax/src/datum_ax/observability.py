"""Centralized structured logging (ADR-0013) — the single source of truth.

Every module acquires its logger via ``get_logger(__name__)`` and emits *structured events*
(``logger.info("lane_started", lane_id=..., attempt=...)``). Configuration happens exactly once,
at an entry point (the CLI / composition root) via ``configure_logging``. structlog renders the
same event stream either as human-readable console lines or as one JSON object per line for
machines (Markdown for humans, JSON for machines — ADR-0027).

This is the *only* module that imports stdlib ``logging`` or installs handlers; everything else
goes through ``get_logger``. The ``test_logging_is_centralized`` guard enforces that.
"""

from __future__ import annotations

import logging
import sys
from typing import Any, TextIO, cast

import structlog

# Applied to every event (structlog-native and stdlib-foreign) before the final renderer.
_SHARED_PROCESSORS: list[Any] = [
    structlog.contextvars.merge_contextvars,
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    structlog.processors.TimeStamper(fmt="iso"),
    structlog.processors.StackInfoRenderer(),
    structlog.processors.format_exc_info,
]


def _level_to_int(level: str | int) -> int:
    if isinstance(level, int):
        return level
    return getattr(logging, level.upper(), logging.INFO)


def _make_formatter(json_logs: bool) -> logging.Formatter:
    renderer = (
        structlog.processors.JSONRenderer()
        if json_logs
        else structlog.dev.ConsoleRenderer(colors=False)
    )
    return structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=_SHARED_PROCESSORS,
        processors=[structlog.stdlib.ProcessorFormatter.remove_processors_meta, renderer],
    )


def configure_logging(
    *,
    level: str | int = "INFO",
    json_logs: bool = False,
    logfile: str | None = None,
    console: bool = True,
    stream: TextIO | None = None,
) -> None:
    """Install the process-wide logging configuration. Idempotent: re-calling replaces handlers
    rather than stacking them, so it is safe to call from tests and multiple entry points.

    Args:
        level: minimum level (name or int).
        json_logs: render one JSON object per line (machines) instead of console lines (humans).
        logfile: if set, append events to this file.
        console: if True, also emit to ``stream``.
        stream: console destination (defaults to ``sys.stderr``).
    """
    structlog.configure(
        processors=[
            *_SHARED_PROCESSORS,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=False,
    )

    root = logging.getLogger()
    for handler in list(root.handlers):  # idempotent reset
        root.removeHandler(handler)
    root.setLevel(_level_to_int(level))

    if logfile:
        file_handler = logging.FileHandler(logfile, mode="a", encoding="utf-8")
        file_handler.setFormatter(_make_formatter(json_logs=json_logs))
        root.addHandler(file_handler)
    if console:
        console_handler = logging.StreamHandler(stream or sys.stderr)
        console_handler.setFormatter(_make_formatter(json_logs=json_logs))
        root.addHandler(console_handler)


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Return the bound structlog logger for *name* (use ``__name__``). Safe to call at import
    time — it binds lazily on first use, picking up whatever ``configure_logging`` installed."""
    return cast(structlog.stdlib.BoundLogger, structlog.get_logger(name))
