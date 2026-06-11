"""Tests for datum.budget — unified episode Budget dataclass (#75).

Table-driven coverage: exact-boundary exhaustion, independent dimensions,
None = unlimited, zero = immediately exhausted, deterministic wall clock
via injected `now`, and serialization round-trip for orchestrator packets.
"""

import pytest

from datum.budget import Budget


class TestDefaults:
    def test_defaults_match_agent_loop(self):
        """Defaults mirror agent_loop.py: max_steps=10, timeout_s=600."""
        b = Budget()
        assert b.max_turns == 10
        assert b.max_wall_s == 600.0
        assert b.max_tool_calls is None
        assert b.max_tokens is None
        assert b.max_result_chars == 3000
        assert b.max_retries_per_call == 2
        assert b.exhausted() is None

    @pytest.mark.parametrize(
        "kwargs",
        [
            {"max_turns": -1},
            {"max_tool_calls": -3},
            {"max_tokens": -100},
            {"max_wall_s": -0.5},
            {"max_result_chars": -1},
            {"max_retries_per_call": -2},
        ],
    )
    def test_negative_limits_rejected(self, kwargs):
        with pytest.raises(ValueError):
            Budget(**kwargs)


# (limit_field, spend_method, remaining_attr, dimension_name)
DIMENSIONS = [
    ("max_turns", "spend_turn", "remaining_turns", "turns"),
    ("max_tool_calls", "spend_tool_call", "remaining_tool_calls", "tool_calls"),
    ("max_tokens", "spend_tokens", "remaining_tokens", "tokens"),
]


class TestCountedDimensions:
    @pytest.mark.parametrize("limit_field,spend,remaining,dim", DIMENSIONS)
    def test_exhausts_exactly_at_boundary(self, limit_field, spend, remaining, dim):
        b = Budget(
            max_turns=None, max_tool_calls=None, max_tokens=None, max_wall_s=None
        )
        setattr(b, limit_field, 3)
        for i in range(3):
            assert b.exhausted() is None, f"exhausted early at {i}"
            getattr(b, spend)()
        assert getattr(b, remaining) == 0
        assert b.exhausted() == dim

    @pytest.mark.parametrize("limit_field,spend,remaining,dim", DIMENSIONS)
    def test_remaining_counts_down_and_clamps(self, limit_field, spend, remaining, dim):
        b = Budget(
            max_turns=None, max_tool_calls=None, max_tokens=None, max_wall_s=None
        )
        setattr(b, limit_field, 2)
        assert getattr(b, remaining) == 2
        getattr(b, spend)()
        assert getattr(b, remaining) == 1
        getattr(b, spend)(5)  # overshoot
        assert getattr(b, remaining) == 0  # clamped, never negative

    @pytest.mark.parametrize("limit_field,spend,remaining,dim", DIMENSIONS)
    def test_none_is_unlimited(self, limit_field, spend, remaining, dim):
        b = Budget(
            max_turns=None, max_tool_calls=None, max_tokens=None, max_wall_s=None
        )
        getattr(b, spend)(10_000)
        assert getattr(b, remaining) is None
        assert b.exhausted() is None

    @pytest.mark.parametrize("limit_field,spend,remaining,dim", DIMENSIONS)
    def test_zero_limit_immediately_exhausted(self, limit_field, spend, remaining, dim):
        b = Budget(
            max_turns=None, max_tool_calls=None, max_tokens=None, max_wall_s=None
        )
        setattr(b, limit_field, 0)
        assert b.exhausted() == dim

    @pytest.mark.parametrize("limit_field,spend,remaining,dim", DIMENSIONS)
    def test_negative_spend_rejected(self, limit_field, spend, remaining, dim):
        b = Budget()
        with pytest.raises(ValueError):
            getattr(b, spend)(-1)

    def test_dimensions_exhaust_independently(self):
        b = Budget(max_turns=5, max_tool_calls=2, max_tokens=100, max_wall_s=None)
        b.spend_turn()
        b.spend_tool_call(2)  # only tool_calls hits its cap
        b.spend_tokens(99)
        assert b.exhausted() == "tool_calls"
        assert b.remaining_turns == 4
        assert b.remaining_tokens == 1

    def test_exhausted_precedence_is_deterministic(self):
        b = Budget(max_turns=1, max_tool_calls=1, max_tokens=1, max_wall_s=None)
        b.spend_turn()
        b.spend_tool_call()
        b.spend_tokens(1)
        assert b.exhausted() == "turns"  # turns > tool_calls > tokens > wall


class TestWallClock:
    def test_not_started_consumes_nothing(self):
        b = Budget(max_wall_s=10.0)
        assert b.elapsed_s(now=1e9) == 0.0
        assert b.remaining_wall_s(now=1e9) == 10.0

    def test_remaining_and_exact_boundary(self):
        b = Budget(max_turns=None, max_wall_s=600.0)
        b.start(now=100.0)
        assert b.remaining_wall_s(now=100.0) == 600.0
        assert b.remaining_wall_s(now=699.0) == 1.0
        assert b.exhausted(now=699.0) is None
        assert b.exhausted(now=700.0) == "wall_clock"  # exactly at the wire
        assert b.remaining_wall_s(now=900.0) == 0.0  # clamped

    def test_none_is_unlimited(self):
        b = Budget(max_turns=None, max_wall_s=None)
        b.start(now=0.0)
        assert b.remaining_wall_s(now=1e9) is None
        assert b.exhausted(now=1e9) is None

    def test_zero_immediately_exhausted(self):
        b = Budget(max_turns=None, max_wall_s=0.0)
        b.start(now=5.0)
        assert b.exhausted(now=5.0) == "wall_clock"

    def test_real_clock_default(self):
        b = Budget(max_wall_s=600.0)
        b.start()
        assert 0.0 <= b.elapsed_s() < 5.0


class TestSerialization:
    def test_round_trip_preserves_limits_and_consumption(self):
        b = Budget(max_turns=7, max_tool_calls=20, max_tokens=50_000, max_wall_s=120.0)
        b.spend_turn(3)
        b.spend_tool_call(4)
        b.spend_tokens(1234)
        restored = Budget.from_dict(b.to_dict())
        assert restored == b
        assert restored.remaining_turns == 4
        assert restored.remaining_tokens == 50_000 - 1234

    def test_round_trip_snapshots_wall_clock(self):
        """Elapsed time survives the packet boundary as wall_s_used."""
        b = Budget(max_turns=None, max_wall_s=100.0)
        b.start(now=0.0)
        d = b.to_dict(now=30.0)
        assert d["wall_s_used"] == 30.0
        restored = Budget.from_dict(d)
        restored.start(now=1000.0)  # resumed segment: clock re-armed
        assert restored.elapsed_s(now=1050.0) == 80.0
        assert restored.exhausted(now=1070.0) == "wall_clock"

    def test_round_trip_preserves_unlimited(self):
        b = Budget(max_turns=None, max_tokens=None, max_wall_s=None)
        restored = Budget.from_dict(b.to_dict())
        assert restored.max_turns is None
        assert restored.max_tokens is None
        assert restored.max_wall_s is None

    def test_to_dict_is_json_safe_and_has_no_private_state(self):
        import json

        d = Budget().to_dict()
        assert json.loads(json.dumps(d)) == d
        assert all(not k.startswith("_") for k in d)

    def test_from_dict_ignores_unknown_keys(self):
        """Packets may carry envelope fields (schema_version, output_path)."""
        b = Budget.from_dict({"max_turns": 3, "schema_version": "2.0"})
        assert b.max_turns == 3
