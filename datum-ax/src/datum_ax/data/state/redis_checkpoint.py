"""RedisCheckpointer — centralized `CheckpointStore` adapter (ADR-0002/0005/0032).

The swap point for `InMemoryCheckpointer`: cross-process / multi-worker resume backed by Redis or
Valkey. Selected by URL (`redis://` / `rediss://` / `valkey://` / `valkeys://`) in the composition
root; `core` depends on the `CheckpointStore` Protocol, never this class (ADR-0026).

Uses the `redis-py` client, which is wire-compatible with Valkey (a Redis fork) — chosen because it
lets the conformance suite run fully offline against `fakeredis`. The client is built lazily on first
use (or injected for tests), so importing this module never requires the optional `[database]` extra.
State is stored as JSON, giving the same copy-in / copy-out semantics as the in-memory reference.
"""

from __future__ import annotations

import json
from typing import Any

# Valkey URLs are accepted by mapping their scheme onto the redis-py equivalents.
_SCHEME_MAP = {"valkey://": "redis://", "valkeys://": "rediss://"}


class RedisCheckpointer:
    """Implements the `CheckpointStore` port on Redis/Valkey."""

    def __init__(self, url: str, *, client: Any = None, namespace: str = "datum:ckpt") -> None:
        self._namespace = namespace
        self._client: Any = client
        # Normalize eagerly (pure string work, no connection) so the client can be built lazily later.
        self._url = self._normalize(url)

    @staticmethod
    def _normalize(url: str) -> str:
        for valkey_scheme, redis_scheme in _SCHEME_MAP.items():
            if url.startswith(valkey_scheme):
                return redis_scheme + url[len(valkey_scheme) :]
        return url

    def _redis(self) -> Any:
        if self._client is None:
            import redis

            self._client = redis.from_url(self._url)
        return self._client

    def _key(self, run_id: str) -> str:
        return f"{self._namespace}:{run_id}"

    def save(self, run_id: str, state: dict[str, Any]) -> None:
        self._redis().set(self._key(run_id), json.dumps(state))

    def get(self, run_id: str) -> dict[str, Any] | None:
        raw = self._redis().get(self._key(run_id))
        if raw is None:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        result: dict[str, Any] = json.loads(raw)
        return result

    def delete(self, run_id: str) -> None:
        self._redis().delete(self._key(run_id))
