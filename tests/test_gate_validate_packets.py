"""`datum gate validate-packets` (gate_validate_packets in datum/gate.py).

Before: `for packet_path in packets_dir.glob("*.json")` never ran when the
directory existed but held zero packet files, so `errors` stayed empty and
the gate printed "Packets valid" for a review that produced nothing (#384).
Mirrors the gate_validate fix for the same shape (test_gate_validate.py): a
guarded artifact that was never produced must fail loud, not pass silently.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from datum import gate


def _run(monkeypatch, tmp_path: Path) -> tuple[int, dict]:
    monkeypatch.chdir(tmp_path)
    out: list[str] = []
    monkeypatch.setattr(
        "builtins.print", lambda *a, **k: out.append(" ".join(str(x) for x in a))
    )
    with pytest.raises(SystemExit) as exc:
        gate.gate_validate_packets({})
    return int(exc.value.code or 0), json.loads(out[-1])


def test_missing_dir_fails(monkeypatch, tmp_path):
    code, payload = _run(monkeypatch, tmp_path)
    assert code != 0
    assert payload["passed"] is False
    assert "review-packets/ not found" in payload["message"]


def test_empty_dir_fails_instead_of_passing(monkeypatch, tmp_path):
    """Regression: the packets dir exists (e.g. created by an earlier step)
    but nothing wrote a packet into it. The loop body never runs, so this
    must fail loud with a named error instead of reaching pass_gate."""
    packets_dir = tmp_path / ".datum" / "review-packets"
    packets_dir.mkdir(parents=True)
    code, payload = _run(monkeypatch, tmp_path)
    assert code != 0
    assert payload["passed"] is False
    assert payload["message"].startswith("validate_packets_missing:")
    assert "review-packets" in payload["message"]


def test_dir_with_only_unified_json_still_counts_as_empty(monkeypatch, tmp_path):
    """unified.json is skipped by design (#368: nothing produces it either),
    so a dir holding only that file must be treated the same as empty."""
    packets_dir = tmp_path / ".datum" / "review-packets"
    packets_dir.mkdir(parents=True)
    (packets_dir / "unified.json").write_text("{}")
    code, payload = _run(monkeypatch, tmp_path)
    assert code != 0
    assert payload["message"].startswith("validate_packets_missing:")


def test_real_packets_are_validated_and_pass(monkeypatch, tmp_path):
    packets_dir = tmp_path / ".datum" / "review-packets"
    packets_dir.mkdir(parents=True)
    (packets_dir / "packet_security.json").write_text(json.dumps({"findings": []}))

    monkeypatch.setattr(
        gate,
        "_contracts",
        lambda: (lambda schema, path: [], lambda schema, payload: []),
    )
    code, payload = _run(monkeypatch, tmp_path)
    assert code == 0
    assert payload["passed"] is True
    assert payload["message"] == "Packets valid"


def test_real_packets_with_schema_errors_still_fail(monkeypatch, tmp_path):
    packets_dir = tmp_path / ".datum" / "review-packets"
    packets_dir.mkdir(parents=True)
    (packets_dir / "packet_security.json").write_text("{}")

    monkeypatch.setattr(
        gate,
        "_contracts",
        lambda: (lambda schema, path: ["boom"], lambda schema, payload: []),
    )
    code, payload = _run(monkeypatch, tmp_path)
    assert code != 0
    assert "Packet validation errors" in payload["message"]
