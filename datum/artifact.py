#!/usr/bin/env python3
"""
DATUM Artifact Envelope.

Enforces a typed, versioned wrapper around all pipeline payloads.
All JSON passing between the orchestrator, agents, and storage must be wrapped in this envelope.
"""

import json
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

# Fix relative imports
sys.path.insert(0, str(Path(__file__).parent))
from datum.path_utils import assets_dir
from datum.contracts import validate_value

ARTIFACT_SCHEMA = "artifact.schema.json"
ARTIFACT_SCHEMA_PATH = assets_dir() / "schemas" / ARTIFACT_SCHEMA


@dataclass
class ArtifactEnvelope:
    type: str
    owner: str
    status: str
    payload: dict[str, Any]
    datum_version: str = "1.0"

    def __post_init__(self) -> None:
        # DPS-1: Boundary Validation
        if not isinstance(self.datum_version, str):
            raise TypeError(
                f"datum_version must be str, got {type(self.datum_version)}"
            )
        if not isinstance(self.type, str):
            raise TypeError(f"type must be str, got {type(self.type)}")
        if not isinstance(self.owner, str):
            raise TypeError(f"owner must be str, got {type(self.owner)}")
        if not isinstance(self.status, str):
            raise TypeError(f"status must be str, got {type(self.status)}")
        if self.status not in ("ok", "partial", "blocked", "error"):
            raise ValueError(f"invalid status: {self.status}")
        if not isinstance(self.payload, dict):
            raise TypeError(f"payload must be dict, got {type(self.payload)}")

    @classmethod
    def from_json(cls, raw: str) -> "ArtifactEnvelope":
        """Parse and validate JSON string against the schema and types."""
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON: {exc}")

        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ArtifactEnvelope":
        if not ARTIFACT_SCHEMA_PATH.exists():
            raise FileNotFoundError(f"Missing schema: {ARTIFACT_SCHEMA_PATH}")

        errors = validate_value(ARTIFACT_SCHEMA_PATH, data)
        if errors:
            raise ValueError(f"Artifact schema validation failed: {errors}")

        return cls(
            datum_version=data.get("datum_version", "1.0"),
            type=data["type"],
            owner=data["owner"],
            status=data["status"],
            payload=data["payload"],
        )

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2)


def self_test() -> int:
    """Run self-tests to ensure boundary validation and schema enforcement work."""
    # Test 1: Valid artifact
    valid_json = json.dumps(
        {
            "datum_version": "1.0",
            "type": "lane_plan",
            "owner": "datum-orchestrator",
            "status": "ok",
            "payload": {"tasks": []},
        }
    )

    try:
        artifact = ArtifactEnvelope.from_json(valid_json)
        assert artifact.type == "lane_plan"
        assert artifact.status == "ok"
    except Exception as e:
        print(f"Failed valid artifact test: {e}")
        return 1

    # Test 2: Invalid status
    invalid_status = json.dumps(
        {
            "datum_version": "1.0",
            "type": "lane_plan",
            "owner": "datum-orchestrator",
            "status": "unknown",
            "payload": {},
        }
    )
    try:
        ArtifactEnvelope.from_json(invalid_status)
        print("Failed to reject invalid status")
        return 1
    except ValueError as e:
        assert "schema validation failed" in str(e)

    # Test 3: Missing required field
    missing_field = json.dumps({"type": "lane_plan", "status": "ok", "payload": {}})
    try:
        ArtifactEnvelope.from_json(missing_field)
        print("Failed to reject missing field")
        return 1
    except ValueError as e:
        assert "schema validation failed" in str(e)

    print(json.dumps({"ok": True, "validated": 3}))
    return 0


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Artifact Envelope Module")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        sys.exit(self_test())
