"""Memory surface trace decorator.

Provides ``memory_traced(surface)`` — a decorator that instruments memory-surface
methods with a structured log line and a telemetry ``memory_access`` event on every
invocation, so operators can ``grep '[memory:' ~/.wfc/telemetry/events.jsonl`` (or the
log stream) and see every memory touch in real time.

Gate: set ``WFC_MEMORY_TRACE=0`` to disable instrumentation and make the decorator a
pure pass-through (used in hot loops where per-call overhead matters). Any other value
(including unset) keeps tracing on.

This module owns ONLY the decorator. Apply sites live in the per-surface modules and
are wired up by later tasks in the memory-repair epic; this file must not import any
memory surface to avoid circular imports.
"""

from __future__ import annotations

import functools
import hashlib
import os
import weakref
from typing import Any, Callable, TypeVar

from datum.shared.logging import get_logger

__all__ = ["memory_traced"]

_TRACE_ENV_VAR = "WFC_MEMORY_TRACE"
_TRACE_DISABLED_VALUE = "0"
_DEFAULT_TRACE_SAMPLE_RATE = 1

F = TypeVar("F", bound=Callable[..., Any])


def _trace_enabled() -> bool:
    """Return True unless WFC_MEMORY_TRACE is explicitly set to "0"."""
    return os.environ.get(_TRACE_ENV_VAR) != _TRACE_DISABLED_VALUE


def _hashed_first_arg(value: Any) -> str:
    """Return a short stable correlation digest for a potentially sensitive value."""
    raw = repr(value).encode("utf-8", "backslashreplace")
    return hashlib.blake2b(raw, digest_size=8).hexdigest()


def _render_first_arg(value: Any, *, redact: bool) -> str:
    """Render the logged first-argument representation."""
    if redact:
        return f"<redacted type={type(value).__name__} hash={_hashed_first_arg(value)}>"
    return repr(value)[:120]


def memory_traced(
    surface: str,
    *,
    redact_first_arg: bool = False,
    telemetry_sample_rate: int = _DEFAULT_TRACE_SAMPLE_RATE,
) -> Callable[[F], F]:
    """Instrument a memory-surface method with a log line and a telemetry event.

    When the wrapped method is called:

    1. A sampled log line is emitted via
       ``datum.shared.logging.get_logger("datum.memory.<surface>")`` at INFO level
       in the format ``[memory:<surface>] <method> key=<first_arg_repr>``.
    2. A sampled ``datum.shared.telemetry_auto.log_event("memory_access", {...})``
       call records ``surface``, ``op`` (method name), and ``ts`` (ISO-8601
       timestamp).
    3. The wrapped method's return value is passed through unchanged.

    When ``WFC_MEMORY_TRACE=0`` at call time, the wrapper short-circuits to the
    underlying function immediately — no logger output, no telemetry event. The env
    var is read on every call (not cached at decoration time), so tests and runtime
    toggles both take effect without re-wrapping.

    Args:
        surface: Short identifier for the memory surface (e.g. "hrr", "reflexion",
            "rag"). Becomes the log-channel suffix and the ``surface`` field in the
            telemetry payload.
        redact_first_arg: When ``True``, the logged ``key=`` field is replaced
            with a type tag plus short hash so operators can correlate calls
            without seeing the raw value.
        telemetry_sample_rate: Emit one trace event out of every N calls for
            this wrapped function. ``1`` keeps the historical behavior.

    Returns:
        A decorator that wraps the target method while preserving ``__name__``,
        ``__doc__``, ``__wrapped__``, and signature via ``functools.wraps``.
    """
    if telemetry_sample_rate < 1:
        raise ValueError("telemetry_sample_rate must be >= 1")

    logger = get_logger(f"datum.memory.{surface}")
    global_call_count = 0
    instance_call_counts: weakref.WeakKeyDictionary[object, int] = weakref.WeakKeyDictionary()

    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            nonlocal global_call_count
            if not _trace_enabled():
                return func(*args, **kwargs)

            if telemetry_sample_rate > 1:
                receiver = args[0] if args and hasattr(args[0], "__dict__") else None
                if receiver is None:
                    global_call_count += 1
                    call_count = global_call_count
                else:
                    call_count = instance_call_counts.get(receiver, 0) + 1
                    instance_call_counts[receiver] = call_count
                if ((call_count - 1) % telemetry_sample_rate) != 0:
                    return func(*args, **kwargs)

            # For bound methods, args[0] is `self`; the first real argument is args[1].
            # For free functions, args[0] is the first argument. Treat the first
            # non-self positional as the "key" for log purposes; fall back to "<none>"
            # if there is none.
            first_arg = args[1] if len(args) >= 2 else (args[0] if args else "<none>")
            first_arg_repr = _render_first_arg(first_arg, redact=redact_first_arg)

            logger.info(
                "[memory:%s] %s key=%s",
                surface,
                func.__name__,
                first_arg_repr,
            )
            return func(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return decorator
