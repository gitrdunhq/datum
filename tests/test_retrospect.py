"""TDD tests for datum.retrospect — post-run analysis and pattern extraction.

RED phase: tests must fail (ImportError) before datum/retrospect.py exists.

Issue #89: Read last N .datum/transcripts/*.jsonl, group failures by
FailureLayer, emit summary with suggested harness patch locations.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

# ── Fixtures ──────────────────────────────────────────────────────────────────


def _make_event(
    event_type: str = "step",
    phase: str = "act",
    status: str = "completed",
    failure_layer: str | None = None,
    reason: str | None = None,
    run_id: str = "run-001",
    duration_s: float | None = None,
    tool: str | None = None,
) -> dict:
    """Build a minimal realistic event dict matching events.py schema."""
    ev: dict = {
        "event_id": "evt-abc",
        "timestamp": 1_700_000_000.0,
        "run_id": run_id,
        "task_id": "task-1",
        "agent_id": "agent-act",
        "role": "implementer",
        "phase": phase,
        "event_type": event_type,
        "status": status,
        "severity": "error" if failure_layer else "info",
        "message": "step completed" if not failure_layer else f"failed: {reason}",
        "payload": {},
    }
    if failure_layer:
        ev["payload"]["failure_layer"] = failure_layer
    if reason:
        ev["payload"]["reason"] = reason
    if duration_s is not None:
        ev["payload"]["duration_s"] = duration_s
    if tool:
        ev["payload"]["tool"] = tool
    return ev


def _write_jsonl(path: Path, events: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        for ev in events:
            f.write(json.dumps(ev) + "\n")


def _make_failure_report(
    run_id: str = "run-001",
    failures: list[dict] | None = None,
) -> dict:
    """Build a realistic failure report matching .datum/runs/<run_id>/ artifacts."""
    return {
        "run_id": run_id,
        "failures": failures
        or [
            {
                "failure_layer": "verification",
                "reason": "test_failure",
                "phase": "act",
                "count": 3,
            }
        ],
    }


# ── Public API surface ────────────────────────────────────────────────────────


class TestRetrospectPublicApi:
    """The module must export the right names at import time."""

    def test_module_imports(self):
        from datum.retrospect import RetrospectConfig, RetrospectResult, run_retrospect

        assert RetrospectConfig is not None
        assert RetrospectResult is not None
        assert run_retrospect is not None

    def test_run_retrospect_accepts_config(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        assert result is not None

    def test_run_retrospect_returns_retrospect_result(self, tmp_path):
        from datum.retrospect import RetrospectConfig, RetrospectResult, run_retrospect

        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        assert isinstance(result, RetrospectResult)


# ── RetrospectConfig ──────────────────────────────────────────────────────────


class TestRetrospectConfig:
    def test_defaults(self, tmp_path):
        from datum.retrospect import RetrospectConfig

        cfg = RetrospectConfig(datum_dir=tmp_path)
        assert cfg.last_n_runs == 10
        assert cfg.datum_dir == tmp_path
        assert cfg.run_id is None

    def test_custom_last_n(self, tmp_path):
        from datum.retrospect import RetrospectConfig

        cfg = RetrospectConfig(datum_dir=tmp_path, last_n_runs=3)
        assert cfg.last_n_runs == 3

    def test_run_id_filter(self, tmp_path):
        from datum.retrospect import RetrospectConfig

        cfg = RetrospectConfig(datum_dir=tmp_path, run_id="epic-42-20260601")
        assert cfg.run_id == "epic-42-20260601"


# ── RetrospectResult ──────────────────────────────────────────────────────────


class TestRetrospectResult:
    def test_result_is_dataclass_or_namedtuple(self, tmp_path):
        """Result must be structured, not a plain dict."""
        from datum.retrospect import RetrospectConfig, RetrospectResult, run_retrospect

        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        # Must have expected fields
        assert hasattr(result, "runs_analysed")
        assert hasattr(result, "total_failures")
        assert hasattr(result, "failures_by_layer")
        assert hasattr(result, "slow_phases")
        assert hasattr(result, "tool_usage")
        assert hasattr(result, "suggestions")
        assert hasattr(result, "recurring_patterns")

    def test_empty_datum_dir_produces_zero_runs(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        assert result.runs_analysed == 0
        assert result.total_failures == 0


# ── Failure layer classification ──────────────────────────────────────────────


class TestFailureLayerClassification:
    """Failures must be grouped by FailureLayer using the shared enum."""

    def test_classifies_single_failure_event(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="verification",
                    reason="test_failure",
                )
            ],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        assert result.failures_by_layer.get("verification", 0) >= 1

    def test_classifies_multiple_layers(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="verification",
                    reason="test_failure",
                ),
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="planning",
                    reason="loop_detected",
                ),
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="planning",
                    reason="no_progress",
                ),
            ],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        assert result.failures_by_layer["planning"] == 2
        assert result.failures_by_layer["verification"] == 1

    def test_uses_failure_layer_enum_keys(self, tmp_path):
        """Keys in failures_by_layer must be valid FailureLayer values."""
        from datum.retrospect import RetrospectConfig, run_retrospect

        from datum.failure_layer import FailureLayer

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="infrastructure",
                    reason="timeout_exceeded",
                )
            ],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        valid_values = {layer.value for layer in FailureLayer}
        for key in result.failures_by_layer:
            assert key in valid_values, f"Unknown layer key: {key}"

    def test_derives_layer_from_reason_when_no_explicit_layer(self, tmp_path):
        """When payload has reason but no failure_layer, derive it via FailureLayer.from_reason."""
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        ev = _make_event(
            event_type="escalation",
            status="failed",
            reason="gate_failed",
        )
        # Explicitly no failure_layer in payload
        ev["payload"].pop("failure_layer", None)
        _write_jsonl(events_file, [ev])

        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        # gate_failed → VERIFICATION
        assert result.failures_by_layer.get("verification", 0) >= 1

    def test_total_failures_is_sum_of_all_layers(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="verification",
                    reason="test_failure",
                ),
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="planning",
                    reason="loop_detected",
                ),
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="model",
                    reason="token_budget_exceeded",
                ),
            ],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        assert result.total_failures == 3


# ── Slow phase detection ──────────────────────────────────────────────────────


class TestSlowPhaseDetection:
    """Phases with high cumulative duration should be flagged."""

    def test_slow_phase_detected(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [
                _make_event(phase="act", duration_s=120.0),
                _make_event(phase="act", duration_s=130.0),
                _make_event(phase="plan", duration_s=10.0),
            ],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        # "act" phase has 250s total — must appear in slow_phases
        phase_names = [sp["phase"] for sp in result.slow_phases]
        assert "act" in phase_names

    def test_fast_phase_not_in_slow(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [
                _make_event(phase="plan", duration_s=5.0),
                _make_event(phase="plan", duration_s=3.0),
                _make_event(phase="act", duration_s=200.0),
            ],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        phase_names = [sp["phase"] for sp in result.slow_phases]
        # plan total = 8s — must NOT be in slow list while act is
        assert "plan" not in phase_names

    def test_slow_phase_entry_has_required_keys(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [_make_event(phase="act", duration_s=200.0)],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        if result.slow_phases:
            entry = result.slow_phases[0]
            assert "phase" in entry
            assert "total_s" in entry
            assert "event_count" in entry


# ── Tool usage stats ──────────────────────────────────────────────────────────


class TestToolUsageStats:
    def test_tool_usage_counts_tools(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [
                _make_event(event_type="tool_call", tool="Bash"),
                _make_event(event_type="tool_call", tool="Bash"),
                _make_event(event_type="tool_call", tool="Read"),
            ],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        assert result.tool_usage.get("Bash", 0) == 2
        assert result.tool_usage.get("Read", 0) == 1

    def test_empty_tool_usage_when_no_tool_calls(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [_make_event(event_type="step", tool=None)],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        assert isinstance(result.tool_usage, dict)


# ── Recurring patterns ────────────────────────────────────────────────────────


class TestRecurringPatterns:
    """recurring_patterns groups failures that appear in multiple runs."""

    def test_single_run_no_recurring_patterns(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="verification",
                    reason="test_failure",
                    run_id="run-001",
                )
            ],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        # Only one run — no recurring pattern across runs
        assert isinstance(result.recurring_patterns, list)

    def test_same_failure_across_two_runs_is_recurring(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        for run_id in ("run-001", "run-002"):
            events_file = tmp_path / "runs" / run_id / "events.jsonl"
            _write_jsonl(
                events_file,
                [
                    _make_event(
                        event_type="escalation",
                        status="failed",
                        failure_layer="planning",
                        reason="loop_detected",
                        run_id=run_id,
                    )
                ],
            )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        # "loop_detected" in planning should appear as recurring across 2 runs
        reasons = [p["reason"] for p in result.recurring_patterns]
        assert "loop_detected" in reasons

    def test_recurring_pattern_entry_has_required_keys(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        for run_id in ("run-001", "run-002"):
            events_file = tmp_path / "runs" / run_id / "events.jsonl"
            _write_jsonl(
                events_file,
                [
                    _make_event(
                        event_type="escalation",
                        status="failed",
                        failure_layer="verification",
                        reason="gate_failed",
                        run_id=run_id,
                    )
                ],
            )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        for pattern in result.recurring_patterns:
            assert "reason" in pattern
            assert "layer" in pattern
            assert "run_count" in pattern
            assert "total_occurrences" in pattern


# ── Suggestions ───────────────────────────────────────────────────────────────


class TestSuggestions:
    """suggestions must be non-empty strings pointing at harness patch locations."""

    def test_suggestions_is_list(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        assert isinstance(result.suggestions, list)

    def test_verification_failures_suggest_gate_or_tdd(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="verification",
                    reason="test_failure",
                ),
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="verification",
                    reason="gate_failed",
                ),
            ],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        assert len(result.suggestions) > 0
        # At least one suggestion should mention gate or tdd
        text = " ".join(result.suggestions).lower()
        assert "gate" in text or "tdd" in text or "test" in text

    def test_planning_failures_suggest_loop_or_step_cap(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="planning",
                    reason="loop_detected",
                ),
            ],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        text = " ".join(result.suggestions).lower()
        assert "loop" in text or "step" in text or "plan" in text

    def test_infrastructure_failures_suggest_env_fix(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="infrastructure",
                    reason="timeout_exceeded",
                ),
            ],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        text = " ".join(result.suggestions).lower()
        assert "timeout" in text or "infrastructure" in text or "env" in text

    def test_each_suggestion_is_non_empty_string(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="model",
                    reason="token_budget_exceeded",
                )
            ],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        for s in result.suggestions:
            assert isinstance(s, str) and len(s) > 0


# ── Runs analysed ─────────────────────────────────────────────────────────────


class TestRunsAnalysed:
    def test_counts_run_directories(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        for run_id in ("run-001", "run-002", "run-003"):
            events_file = tmp_path / "runs" / run_id / "events.jsonl"
            _write_jsonl(events_file, [_make_event(run_id=run_id)])

        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        assert result.runs_analysed == 3

    def test_last_n_runs_limits_scope(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        for i in range(5):
            run_id = f"run-00{i}"
            events_file = tmp_path / "runs" / run_id / "events.jsonl"
            _write_jsonl(events_file, [_make_event(run_id=run_id)])

        cfg = RetrospectConfig(datum_dir=tmp_path, last_n_runs=3)
        result = run_retrospect(cfg)
        assert result.runs_analysed == 3

    def test_run_id_filter_restricts_to_one(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        for run_id in ("run-001", "run-002"):
            events_file = tmp_path / "runs" / run_id / "events.jsonl"
            _write_jsonl(events_file, [_make_event(run_id=run_id)])

        cfg = RetrospectConfig(datum_dir=tmp_path, run_id="run-001")
        result = run_retrospect(cfg)
        assert result.runs_analysed == 1


# ── JSON serialisation ────────────────────────────────────────────────────────


class TestJsonSerialisation:
    def test_result_serialises_to_json(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        events_file = tmp_path / "runs" / "run-001" / "events.jsonl"
        _write_jsonl(
            events_file,
            [
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="verification",
                    reason="test_failure",
                )
            ],
        )
        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        # Must not raise
        raw = json.dumps(result.to_dict())
        loaded = json.loads(raw)
        assert loaded["runs_analysed"] >= 0
        assert "failures_by_layer" in loaded

    def test_to_dict_includes_all_fields(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)
        d = result.to_dict()
        assert "runs_analysed" in d
        assert "total_failures" in d
        assert "failures_by_layer" in d
        assert "slow_phases" in d
        assert "tool_usage" in d
        assert "suggestions" in d
        assert "recurring_patterns" in d


# ── Integration: multi-run realistic fixture ──────────────────────────────────


class TestMultiRunIntegration:
    """End-to-end with a realistic multi-run fixture."""

    def test_realistic_three_run_analysis(self, tmp_path):
        from datum.retrospect import RetrospectConfig, run_retrospect

        runs = {
            "epic-23-20260501": [
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="verification",
                    reason="test_failure",
                    run_id="epic-23-20260501",
                    duration_s=45.0,
                    phase="act",
                ),
                _make_event(
                    event_type="tool_call",
                    tool="Bash",
                    run_id="epic-23-20260501",
                    phase="act",
                ),
                _make_event(
                    event_type="tool_call",
                    tool="Read",
                    run_id="epic-23-20260501",
                    phase="plan",
                    duration_s=5.0,
                ),
            ],
            "epic-24-20260510": [
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="planning",
                    reason="loop_detected",
                    run_id="epic-24-20260510",
                    duration_s=120.0,
                    phase="act",
                ),
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="verification",
                    reason="gate_failed",
                    run_id="epic-24-20260510",
                    duration_s=60.0,
                    phase="validate",
                ),
                _make_event(
                    event_type="tool_call",
                    tool="Bash",
                    run_id="epic-24-20260510",
                    phase="act",
                    duration_s=200.0,
                ),
            ],
            "epic-25-20260605": [
                _make_event(
                    event_type="escalation",
                    status="failed",
                    failure_layer="verification",
                    reason="test_failure",
                    run_id="epic-25-20260605",
                    duration_s=30.0,
                    phase="act",
                ),
                _make_event(
                    event_type="tool_call",
                    tool="Read",
                    run_id="epic-25-20260605",
                    phase="act",
                    duration_s=2.0,
                ),
            ],
        }

        for run_id, events in runs.items():
            events_file = tmp_path / "runs" / run_id / "events.jsonl"
            _write_jsonl(events_file, events)

        cfg = RetrospectConfig(datum_dir=tmp_path)
        result = run_retrospect(cfg)

        assert result.runs_analysed == 3
        # verification appears in all 3 runs
        assert result.failures_by_layer.get("verification", 0) == 3
        # planning appears in 1 run
        assert result.failures_by_layer.get("planning", 0) == 1
        assert result.total_failures == 4
        # test_failure appeared in 2 runs — recurring
        reasons = [p["reason"] for p in result.recurring_patterns]
        assert "test_failure" in reasons
        # Bash used in 2 runs
        assert result.tool_usage.get("Bash", 0) == 2
        assert len(result.suggestions) > 0
