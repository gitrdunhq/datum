#!/usr/bin/env python3
"""
Validate DATUM contract payloads against local JSON schemas.

The validator uses jsonschema when available. When it is not installed, it
falls back to the small JSON Schema subset used by this skill's bundled
schemas so contract checks still fail closed in clean target repos.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# Fix relative imports
sys.path.insert(0, str(Path(__file__).parent))
from datum.path_utils import assets_dir

SCHEMA_DIR = assets_dir() / "schemas"
FIXTURE_CASES = [
    ("brief-red.schema.json", "red-brief.valid.json"),
    ("brief-green.schema.json", "green-brief.valid.json"),
    ("brief-green-continuation.schema.json", "green-continuation.valid.json"),
    ("brief-refactor.schema.json", "refactor-brief.valid.json"),
    ("result-red.schema.json", "red-result.valid.json"),
    ("result-green.schema.json", "green-result.valid.json"),
    ("result-refactor.schema.json", "refactor-result.valid.json"),
]


def _schema_type_matches(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def _check_type(value: Any, expected: Any, path: str, errors: list[str]) -> None:
    expected_types = expected if isinstance(expected, list) else [expected]
    if not any(_schema_type_matches(value, t) for t in expected_types):
        errors.append(f"{path}: expected type {expected_types}, got {type(value).__name__}")


def _validate_subset(value: Any, schema: dict[str, Any], path: str, errors: list[str]) -> None:
    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: expected constant {schema['const']!r}, got {value!r}")

    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: expected one of {schema['enum']!r}, got {value!r}")

    if "type" in schema:
        _check_type(value, schema["type"], path, errors)
        if errors and errors[-1].startswith(f"{path}: expected type"):
            return

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: string shorter than minLength {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{path}: value {value!r} does not match {schema['pattern']!r}")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: value {value!r} is below minimum {schema['minimum']!r}")

    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{path}: array shorter than minItems {schema['minItems']}")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for i, item in enumerate(value):
                _validate_subset(item, item_schema, f"{path}[{i}]", errors)

    if isinstance(value, dict):
        required = schema.get("required", [])
        for key in required:
            if key not in value:
                errors.append(f"{path}: missing required key {key!r}")

        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            extra = sorted(set(value) - set(properties))
            if extra:
                errors.append(f"{path}: unexpected keys {extra!r}")

        for key, prop_schema in properties.items():
            if key in value:
                _validate_subset(value[key], prop_schema, f"{path}.{key}", errors)

        additional = schema.get("additionalProperties")
        if isinstance(additional, dict):
            for key, item in value.items():
                if key not in properties:
                    _validate_subset(item, additional, f"{path}.{key}", errors)


def validate_value(schema_path: Path, payload: Any) -> list[str]:
    schema = json.loads(schema_path.read_text())

    try:
        import jsonschema  # type: ignore[import-not-found]

        jsonschema.validate(instance=payload, schema=schema)
        return []
    except ImportError:
        errors: list[str] = []
        _validate_subset(payload, schema, "$", errors)
        return errors
    except Exception as exc:
        return [str(exc)]


def validate_payload(schema_path: Path, payload_path: Path) -> list[str]:
    payload = json.loads(payload_path.read_text())
    return validate_value(schema_path, payload)


def self_test() -> int:
    """Run validation against bundled positive and negative fixtures."""
    fixture_dir = assets_dir() / "fixtures/contracts"
    failures = []
    for schema_name, fixture_name in FIXTURE_CASES:
        schema_path = SCHEMA_DIR / schema_name
        fixture_path = fixture_dir / fixture_name
        errors = validate_payload(schema_path, fixture_path)
        if errors:
            failures.append(
                {
                    "schema": str(schema_path),
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
    validate_p.add_argument("--enveloped", action="store_true", help="Require Artifact envelope")

    subparsers.add_parser("self-test")

    args = parser.parse_args()
    if args.command == "self-test":
        sys.exit(self_test())

    input_path = Path(args.input)
    if hasattr(args, "enveloped") and args.enveloped:
        try:
            from artifact import ArtifactEnvelope
            env = ArtifactEnvelope.from_json(input_path.read_text())
            errors = validate_value(Path(args.schema), env.payload)
        except Exception as e:
            errors = [str(e)]
    else:
        errors = validate_payload(Path(args.schema), input_path)

    if errors:
        print(json.dumps({"ok": False, "errors": errors}, indent=2))
        sys.exit(1)

    print(json.dumps({"ok": True, "schema": args.schema, "input": args.input}))


if __name__ == "__main__":
    main()
