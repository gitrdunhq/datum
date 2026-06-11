#!/usr/bin/env python3
"""
Validate DATUM contract payloads using Pydantic Models.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from datum.models.artifact_schema import ArtifactEnvelope
from datum.models.brief_green_continuation_schema import DatumGreenContinuationBrief
from datum.models.brief_green_schema import DatumGreenBrief
from datum.models.brief_red_schema import DatumRedBrief
from datum.models.brief_refactor_schema import DatumRefactorBrief
from datum.models.environment_schema import EnvironmentProfile
from datum.models.lane_plan_schema import DatumLanePlan
from datum.models.packet_schema import ReviewPacket
from datum.models.quality_schema import QualityProfile
from datum.models.result_adversarial_schema import DatumAdversarialResult
from datum.models.result_green_schema import DatumGreenResult
from datum.models.result_red_schema import DatumRedResult
from datum.models.result_refactor_schema import DatumRefactorResult
from datum.path_utils import assets_dir

# Map schema filenames to their Pydantic classes for the CLI
SCHEMA_MAP = {
    "brief-red.schema.json": DatumRedBrief,
    "brief-green.schema.json": DatumGreenBrief,
    "brief-green-continuation.schema.json": DatumGreenContinuationBrief,
    "brief-refactor.schema.json": DatumRefactorBrief,
    "result-red.schema.json": DatumRedResult,
    "result-green.schema.json": DatumGreenResult,
    "result-refactor.schema.json": DatumRefactorResult,
    "result-adversarial.schema.json": DatumAdversarialResult,
    "lane-plan.schema.json": DatumLanePlan,
    "packet.schema.json": ReviewPacket,
    "artifact.schema.json": ArtifactEnvelope,
    "quality.schema.json": QualityProfile,
    "environment.schema.json": EnvironmentProfile,
}

FIXTURE_CASES = [
    ("brief-red.schema.json", "red-brief.valid.json"),
    ("brief-green.schema.json", "green-brief.valid.json"),
    ("brief-green-continuation.schema.json", "green-continuation.valid.json"),
    ("brief-refactor.schema.json", "refactor-brief.valid.json"),
    ("result-red.schema.json", "red-result.valid.json"),
    ("result-green.schema.json", "green-result.valid.json"),
    ("result-refactor.schema.json", "refactor-result.valid.json"),
]


def validate_value(schema_path: Path | str, payload: Any) -> list[str]:
    """Validate a python dictionary against a model."""
    schema_name = Path(schema_path).name
    model = SCHEMA_MAP.get(schema_name)
    if not model:
        return [f"Unknown schema: {schema_name}"]

    try:
        model.model_validate(payload)
        return []
    except ValidationError as exc:
        # Format Pydantic errors nicely
        errors = []
        for err in exc.errors():
            loc = ".".join(str(part) for part in err["loc"])
            errors.append(f"{loc}: {err['msg']}")
        return errors
    except Exception as exc:
        return [str(exc)]


def validate_payload(schema_path: Path | str, payload_path: Path) -> list[str]:
    """Validate a JSON file against a model."""
    try:
        payload = json.loads(payload_path.read_text())
        return validate_value(schema_path, payload)
    except json.JSONDecodeError as exc:
        return [f"Invalid JSON in {payload_path}: {exc}"]


def self_test() -> int:
    """Run validation against bundled positive and negative fixtures."""
    fixture_dir = assets_dir() / "fixtures/contracts"
    failures = []
    for schema_name, fixture_name in FIXTURE_CASES:
        fixture_path = fixture_dir / fixture_name
        errors = validate_payload(schema_name, fixture_path)
        if errors:
            failures.append(
                {
                    "schema": schema_name,
                    "fixture": str(fixture_path),
                    "errors": errors,
                }
            )

    if failures:
        print(json.dumps({"ok": False, "failures": failures}, indent=2))
        return 1

    print(json.dumps({"ok": True, "validated": len(FIXTURE_CASES)}))
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate DATUM contract JSON")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_p = subparsers.add_parser("validate")
    validate_p.add_argument("--schema", required=True)
    validate_p.add_argument("--input", required=True)
    validate_p.add_argument(
        "--enveloped", action="store_true", help="Require Artifact envelope"
    )

    subparsers.add_parser("self-test")

    args = parser.parse_args()
    if args.command == "self-test":
        sys.exit(self_test())

    input_path = Path(args.input)
    schema_name = Path(args.schema).name

    if hasattr(args, "enveloped") and args.enveloped:
        try:
            from artifact import ArtifactEnvelope as OldArtifactEnvelope

            env = OldArtifactEnvelope.from_json(input_path.read_text())
            errors = validate_value(schema_name, env.payload)
        except Exception as e:
            errors = [str(e)]
    else:
        errors = validate_payload(schema_name, input_path)

    if errors:
        print(json.dumps({"ok": False, "errors": errors}, indent=2))
        sys.exit(1)

    print(json.dumps({"ok": True, "schema": args.schema, "input": args.input}))


if __name__ == "__main__":
    main()
