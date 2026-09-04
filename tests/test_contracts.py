"""Tests for datum/contracts.py's validate_payload/validate_value.

Correctness bug: SCHEMA_MAP only registers schema names that have a
Pydantic model (13 of them). gate_review() calls
validate_payload("unified.schema.json", unified_json) — but
"unified.schema.json" was never added to SCHEMA_MAP, even though a real
datum/assets/schemas/unified.schema.json JSON-Schema file exists on disk.
Before this fix, validate_payload unconditionally returned
["Unknown schema: unified.schema.json"] for ANY unified.json, valid or
not — meaning gate_review()'s unified.json check could never pass.
"""

from __future__ import annotations

import json
from pathlib import Path

from datum.contracts import validate_payload


def test_unified_schema_validates_a_conforming_payload(tmp_path: Path) -> None:
    """A unified.json that matches unified.schema.json's real shape on disk
    must validate with zero errors, not "Unknown schema"."""
    payload = {
        "findings": [
            {
                "id": "SEC-001",
                "file": "datum/cli.py",
                "severity": "high",
                "description": "example finding",
            }
        ]
    }
    payload_path = tmp_path / "unified.json"
    payload_path.write_text(json.dumps(payload))

    errors = validate_payload("unified.schema.json", payload_path)
    assert errors == []


def test_unified_schema_rejects_a_payload_missing_required_field(
    tmp_path: Path,
) -> None:
    """A unified.json missing the required top-level 'findings' key must
    fail validation with a real schema-violation message."""
    payload_path = tmp_path / "unified.json"
    payload_path.write_text(json.dumps({}))

    errors = validate_payload("unified.schema.json", payload_path)
    assert errors != []
    assert not any("Unknown schema" in e for e in errors)


def test_self_test_validates_all_bundled_fixtures_without_drift() -> None:
    """assets/fixtures/contracts/*.valid.json fixtures must stay in sync
    with their schemas. self_test() checks this but was previously only
    reachable via `python -m datum.contracts self-test` — never wired into
    the automated test suite, so schema/fixture drift would go unnoticed."""
    from datum.contracts import self_test

    assert self_test() == 0
