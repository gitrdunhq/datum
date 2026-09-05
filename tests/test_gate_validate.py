"""`datum gate validate` consumes .datum/last-test-signal.json.

Before: the gate read the file if present and silently PASSED when it was
absent — and nothing in the pipeline ever wrote it (consumer without a
producer, docs/FLOW.md gap 3). Now datum-validate.ts writes the signal from
its independent test run, and the gate requires it.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from datum import gate


def _run(monkeypatch, tmp_path: Path, *, yolo: bool = True) -> tuple[int, dict]:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(gate, "gate_policy", lambda config, key: "skipped")
    out: list[str] = []
    monkeypatch.setattr(
        "builtins.print", lambda *a, **k: out.append(" ".join(str(x) for x in a))
    )
    with pytest.raises(SystemExit) as exc:
        gate.gate_validate(yolo, {})
    return int(exc.value.code or 0), json.loads(out[-1])


def test_missing_signal_fails_instead_of_passing(monkeypatch, tmp_path):
    code, payload = _run(monkeypatch, tmp_path)
    assert code != 0
    assert payload["passed"] is False
    assert "last-test-signal" in payload["message"]


def test_pass_signal_passes(monkeypatch, tmp_path):
    (tmp_path / ".datum").mkdir()
    (tmp_path / ".datum" / "last-test-signal.json").write_text(
        json.dumps({"status": "pass", "exit_code": 0, "command": "pytest -q"})
    )
    code, payload = _run(monkeypatch, tmp_path)
    assert code == 0
    assert payload["passed"] is True


def test_fail_signal_fails_with_exit_code_in_message(monkeypatch, tmp_path):
    (tmp_path / ".datum").mkdir()
    (tmp_path / ".datum" / "last-test-signal.json").write_text(
        json.dumps({"status": "fail", "exit_code": 2, "command": "pytest -q"})
    )
    code, payload = _run(monkeypatch, tmp_path)
    assert code != 0
    assert payload["passed"] is False
    assert "exit 2" in payload["message"] or "exit_code=2" in payload["message"]


def test_corrupt_signal_fails_loudly(monkeypatch, tmp_path):
    (tmp_path / ".datum").mkdir()
    (tmp_path / ".datum" / "last-test-signal.json").write_text("{not json")
    code, payload = _run(monkeypatch, tmp_path)
    assert code != 0
    assert payload["passed"] is False
