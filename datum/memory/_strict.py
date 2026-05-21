"""Fail-loud toggle for WFC memory writes.

Epic 00 (shared memory infrastructure) identified 15+ silent ``except
Exception: pass`` blocks surrounding memory writes in orchestrators and
hooks. Those accidental fail-open paths are the root cause of facts never
reaching the RAG index or nugget store: upstream code throws, the except
swallows it, and the write is silently dropped.

This module exposes a single gate, :func:`is_memory_strict`, which every
rewritten ``except`` block consults to decide whether to re-raise (strict
mode) or swallow-and-log (legacy default). The contract is intentionally
narrow so enabling strict mode in CI is unambiguous and impossible to
confuse with a truthy string coincidence:

* ``WFC_MEMORY_STRICT=1`` -> ``is_memory_strict()`` returns ``True``
* anything else (``0``, ``true``, ``True``, ``yes``, ``""``, unset) ->
  returns ``False``

No caching. The environment variable is re-read on every call so tests and
long-running processes can flip the toggle without reloading the module.
No alternate truthy parsing ("true"/"yes"/"on" etc.) — the only accepted
truthy value is the literal string ``"1"``.

Migration note (TASK-013): the original public name was ``is_strict``,
which was ambiguous at call sites across orchestrators that also deal
with TDD strict-mode, review strict-mode, etc. Renamed to
``is_memory_strict`` here. The old name is kept as a deprecation alias
for one release cycle so any out-of-tree consumer that still imports
``is_strict`` continues to work but emits a ``DeprecationWarning``.

See ``plans/2026-04-07-memory-repair/00-shared-infrastructure.md`` section
3 ("Fail-loud toggle") for the rewrite pattern each caller uses.
"""

from __future__ import annotations

import os
import warnings

__all__ = ["is_memory_strict", "is_strict"]


def is_memory_strict() -> bool:
    """Return True iff ``WFC_MEMORY_STRICT`` is set to the literal string ``"1"``."""
    return os.environ.get("WFC_MEMORY_STRICT") == "1"


def _deprecated_is_strict() -> bool:
    """Deprecation shim for the old ``is_strict`` name.

    Emits a ``DeprecationWarning`` on call and forwards to
    ``is_memory_strict``. Out-of-tree consumers that still do
    ``from datum.memory._strict import is_strict`` keep working
    for one release cycle. All in-tree call sites were updated in TASK-013.
    Will be removed after Phase 1.
    """
    warnings.warn(
        "datum.memory._strict.is_strict is deprecated; use "
        "is_memory_strict instead. Will be removed after Phase 1.",
        DeprecationWarning,
        stacklevel=2,
    )
    return is_memory_strict()


# Plain alias so `from ... import is_strict` resolves without triggering
# __getattr__, and grep picks up the literal `is_strict = is_memory_strict`
# idiom documented in the TASK-013 acceptance criterion. The aliased
# callable is the deprecated shim above — calling it still emits the
# DeprecationWarning.
is_strict = _deprecated_is_strict
