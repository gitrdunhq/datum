"""RedisCheckpointer — centralized CheckpointStore adapter (ADR-0032).

Fully exercised offline via fakeredis (the redis-py-compatible in-memory fake), so save/get/delete,
run isolation, JSON round-trips, and scheme mapping are all verified without a server.
"""

from __future__ import annotations

import fakeredis

from datum_ax.contracts.checkpoint import CheckpointStore
from datum_ax.data.state.redis_checkpoint import RedisCheckpointer
from datum_ax.presentation.composition import build_checkpointer


def _cp(namespace: str = "datum:ckpt") -> RedisCheckpointer:
    return RedisCheckpointer("redis://x", client=fakeredis.FakeRedis(), namespace=namespace)


def test_satisfies_port() -> None:
    assert isinstance(_cp(), CheckpointStore)


def test_save_get_delete_roundtrip_and_isolation() -> None:
    cp = _cp()
    cp.save("r1", {"stage": "plan", "wave": 0})
    cp.save("r2", {"stage": "act"})
    assert cp.get("r1") == {"stage": "plan", "wave": 0}
    assert cp.get("r2") == {"stage": "act"}  # runs don't collide
    assert cp.get("missing") is None
    cp.delete("r1")
    assert cp.get("r1") is None
    cp.delete("r1")  # delete is idempotent (no error on missing)


def test_nested_state_survives_json_roundtrip() -> None:
    cp = _cp()
    state = {"results": {"lanes": [{"id": "a"}, {"id": "b"}]}, "visited": ["ROUTE", "PhaseA"]}
    cp.save("r", state)
    assert cp.get("r") == state


def test_keys_are_namespaced() -> None:
    client = fakeredis.FakeRedis()
    cp = RedisCheckpointer("redis://x", client=client, namespace="ns")
    cp.save("r1", {"k": 1})
    assert client.exists("ns:r1")
    assert not client.exists("r1")  # raw run_id is never used as the key


def test_valkey_scheme_is_mapped_to_redis() -> None:
    # Construction is lazy (no client built), so we can assert the normalized URL directly.
    assert RedisCheckpointer("valkey://h:6379/0")._url == "redis://h:6379/0"
    assert RedisCheckpointer("valkeys://h:6379/0")._url == "rediss://h:6379/0"
    assert RedisCheckpointer("redis://h:6379/0")._url == "redis://h:6379/0"


def test_build_checkpointer_wires_redis_lazily() -> None:
    for url in ("redis://h:6379", "rediss://h:6379", "valkey://h:6379", "valkeys://h:6379"):
        cp = build_checkpointer(url)
        assert isinstance(cp, RedisCheckpointer)  # built, but no connection opened
