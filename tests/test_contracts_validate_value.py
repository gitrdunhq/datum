"""Characterization tests for datum.contracts.validate_value.

validate_value(schema_path: Path | str, payload: Any) -> list[str]
Validates a Python dictionary against a Pydantic model or raw JSON-Schema file.

This characterization suite pins CURRENT behavior for all branches:
- Valid payload for registered schemas (returns empty list)
- Invalid payload (returns list of error strings with location.message format)
- Unknown schema name (returns error or fallback to raw file)
- Payload that is None (not a dict)
- Payload that is not a dict-like object
- Error message format (location dots, exact phrasing)
- Callers use result with: if errors: for validation gate
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from datum.contracts import validate_value


class TestValidateValueWithValidPayloads:
    """Valid payloads should return empty error list."""

    def test_valid_artifact_payload_with_all_required_fields(self) -> None:
        """A valid artifact.schema.json payload with all required fields should validate."""
        payload = {
            "datum_version": "1.0",
            "type": "result",
            "owner": "agent",
            "status": "ok",
            "payload": {"data": "value"},
        }
        errors = validate_value("artifact.schema.json", payload)
        assert errors == []

    def test_valid_artifact_payload_status_partial(self) -> None:
        """Status can be 'partial' and should validate."""
        payload = {
            "datum_version": "1.0",
            "type": "result",
            "owner": "agent",
            "status": "partial",
            "payload": {},
        }
        errors = validate_value("artifact.schema.json", payload)
        assert errors == []

    def test_valid_artifact_payload_status_blocked(self) -> None:
        """Status can be 'blocked' and should validate."""
        payload = {
            "datum_version": "1.0",
            "type": "result",
            "owner": "agent",
            "status": "blocked",
            "payload": {},
        }
        errors = validate_value("artifact.schema.json", payload)
        assert errors == []


class TestValidateValueWithInvalidPayloads:
    """Invalid payloads should return list of error messages."""

    def test_missing_required_field_datum_version(self) -> None:
        """Payload missing datum_version should report error."""
        payload = {
            "type": "result",
            "owner": "agent",
            "status": "ok",
            "payload": {},
        }
        errors = validate_value("artifact.schema.json", payload)
        assert len(errors) > 0
        # Should mention datum_version field
        assert any("datum_version" in e for e in errors)

    def test_missing_required_field_type(self) -> None:
        """Payload missing type should report error."""
        payload = {
            "datum_version": "1.0",
            "owner": "agent",
            "status": "ok",
            "payload": {},
        }
        errors = validate_value("artifact.schema.json", payload)
        assert len(errors) > 0
        assert any("type" in e for e in errors)

    def test_wrong_type_for_status_field(self) -> None:
        """Status field with wrong type should report error."""
        payload = {
            "datum_version": "1.0",
            "type": "result",
            "owner": "agent",
            "status": 123,  # Should be one of: ok, partial, blocked, error
            "payload": {},
        }
        errors = validate_value("artifact.schema.json", payload)
        assert len(errors) > 0
        assert any("status" in e for e in errors)

    def test_invalid_status_value(self) -> None:
        """Invalid status value (not in enum) should report error."""
        payload = {
            "datum_version": "1.0",
            "type": "result",
            "owner": "agent",
            "status": "invalid_status",  # Must be: ok, partial, blocked, or error
            "payload": {},
        }
        errors = validate_value("artifact.schema.json", payload)
        assert len(errors) > 0

    def test_wrong_type_for_payload_field(self) -> None:
        """Payload field with wrong type (not dict) should report error."""
        payload = {
            "datum_version": "1.0",
            "type": "result",
            "owner": "agent",
            "status": "ok",
            "payload": "should be dict not string",
        }
        errors = validate_value("artifact.schema.json", payload)
        assert len(errors) > 0
        assert any("payload" in e for e in errors)

    def test_extra_fields_forbidden_in_artifact(self) -> None:
        """Artifact schema forbids extra fields (extra='forbid')."""
        payload = {
            "datum_version": "1.0",
            "type": "result",
            "owner": "agent",
            "status": "ok",
            "payload": {},
            "extra_field": "should fail",
        }
        errors = validate_value("artifact.schema.json", payload)
        # This model uses extra='forbid', so extra fields should error
        assert len(errors) > 0


class TestValidateValueErrorFormat:
    """Error messages should have consistent format: location: message."""

    def test_error_messages_are_strings(self) -> None:
        """All error messages should be strings, not objects."""
        payload = {}
        errors = validate_value("artifact.schema.json", payload)
        assert all(isinstance(e, str) for e in errors)

    def test_error_format_includes_field_and_reason(self) -> None:
        """Error should follow 'field: reason' format."""
        payload = {
            "datum_version": "1.0",
            "type": "result",
            "owner": "agent",
            "status": 123,  # Wrong type
            "payload": {},
        }
        errors = validate_value("artifact.schema.json", payload)
        # Errors should have format like "field: error message"
        for error in errors:
            # Should contain a colon separating field from message
            assert ":" in error or "Field" in error or "field" in error.lower()

    def test_error_messages_are_human_readable(self) -> None:
        """Error messages should be human-readable, not raw tracebacks."""
        payload = None
        errors = validate_value("artifact.schema.json", payload)
        assert len(errors) > 0
        # Should not contain exception tracebacks
        for error in errors:
            assert "Traceback" not in error
            assert "at line" not in error.lower()


class TestValidateValueWithNonePayload:
    """None payload (not a dict) should return error."""

    def test_none_payload_returns_error_list(self) -> None:
        """Passing None as payload should return error list, not None or exception."""
        errors = validate_value("artifact.schema.json", None)
        assert isinstance(errors, list)
        assert len(errors) > 0

    def test_none_payload_errors_informative(self) -> None:
        """Error for None should be informative."""
        errors = validate_value("artifact.schema.json", None)
        assert all(isinstance(e, str) for e in errors)
        # Should indicate a type or input issue
        assert len(errors[0]) > 0


class TestValidateValueWithNonDictPayload:
    """Non-dict payloads (list, string, int) should return error."""

    def test_list_payload_returns_error(self) -> None:
        """Passing a list instead of dict should return error."""
        errors = validate_value("artifact.schema.json", [1, 2, 3])
        assert isinstance(errors, list)
        assert len(errors) > 0

    def test_string_payload_returns_error(self) -> None:
        """Passing a string instead of dict should return error."""
        errors = validate_value("artifact.schema.json", "not a dict")
        assert len(errors) > 0

    def test_integer_payload_returns_error(self) -> None:
        """Passing an integer instead of dict should return error."""
        errors = validate_value("artifact.schema.json", 42)
        assert len(errors) > 0

    def test_float_payload_returns_error(self) -> None:
        """Passing a float instead of dict should return error."""
        errors = validate_value("artifact.schema.json", 3.14)
        assert len(errors) > 0

    def test_boolean_payload_returns_error(self) -> None:
        """Passing a boolean instead of dict should return error."""
        errors = validate_value("artifact.schema.json", True)
        assert len(errors) > 0


class TestValidateValueWithUnknownSchema:
    """Unknown schema names should fall back to JSON-Schema file validation."""

    def test_unknown_schema_returns_unknown_schema_error(self) -> None:
        """Unknown schema should return 'Unknown schema' error."""
        errors = validate_value("nonexistent.schema.json", {"data": "value"})
        assert len(errors) > 0
        # Should indicate unknown schema
        assert "Unknown schema" in errors[0]

    def test_unified_schema_exists_and_validates(self) -> None:
        """unified.schema.json should exist and validate conforming payloads."""
        payload = {
            "findings": [
                {
                    "id": "TEST-001",
                    "file": "test.py",
                    "severity": "high",
                    "description": "test finding",
                }
            ]
        }
        errors = validate_value("unified.schema.json", payload)
        # Should validate successfully with raw JSON-Schema file
        assert errors == []


class TestValidateValueReturnsListAlways:
    """validate_value should always return list[str], never None or exception."""

    def test_returns_list_not_none_on_valid(self) -> None:
        """Valid payload should return empty list, not None."""
        payload = {
            "datum_version": "1.0",
            "type": "result",
            "owner": "agent",
            "status": "ok",
            "payload": {},
        }
        result = validate_value("artifact.schema.json", payload)
        assert result is not None
        assert isinstance(result, list)
        assert len(result) == 0

    def test_returns_list_not_none_on_invalid(self) -> None:
        """Invalid payload should return error list, never raise or return None."""
        result = validate_value("artifact.schema.json", None)
        assert result is not None
        assert isinstance(result, list)
        assert len(result) > 0

    def test_returns_list_of_strings_always(self) -> None:
        """Each error should be a string, even in unusual cases."""
        errors = validate_value("artifact.schema.json", None)
        assert all(isinstance(e, str) for e in errors)


class TestValidateValueCallerPattern:
    """Test the pattern used by callers: if errors: fail_gate()."""

    def test_truthiness_of_empty_errors(self) -> None:
        """Empty error list should be falsy (caller pattern: if errors:)."""
        payload = {
            "datum_version": "1.0",
            "type": "result",
            "owner": "agent",
            "status": "ok",
            "payload": {},
        }
        errors = validate_value("artifact.schema.json", payload)
        assert not errors  # Empty list is falsy

    def test_truthiness_of_nonempty_errors(self) -> None:
        """Non-empty error list should be truthy (caller pattern: if errors:)."""
        errors = validate_value("artifact.schema.json", {})
        assert errors  # Non-empty list is truthy

    def test_caller_can_iterate_errors(self) -> None:
        """Caller should be able to iterate and extend error list."""
        errors = validate_value("artifact.schema.json", {})
        extended = []
        for err in errors:
            extended.append(f"artifact: {err}")
        assert len(extended) > 0
        # Each should be formatted like the callers do
        assert all(e.startswith("artifact:") for e in extended)


class TestValidateValuePathArgument:
    """Test that both Path and str arguments work for schema_path."""

    def test_string_schema_path(self) -> None:
        """schema_path can be a string."""
        payload = {
            "datum_version": "1.0",
            "type": "result",
            "owner": "agent",
            "status": "ok",
            "payload": {},
        }
        errors = validate_value("artifact.schema.json", payload)
        assert isinstance(errors, list)

    def test_path_object_schema_path(self) -> None:
        """schema_path can be a Path object."""
        payload = {
            "datum_version": "1.0",
            "type": "result",
            "owner": "agent",
            "status": "ok",
            "payload": {},
        }
        errors = validate_value(Path("artifact.schema.json"), payload)
        assert isinstance(errors, list)

    def test_full_path_schema_path(self) -> None:
        """schema_path can be a full path, only filename is used for lookup."""
        from datum.path_utils import assets_dir

        full_path = assets_dir() / "schemas" / "artifact.schema.json"
        payload = {
            "datum_version": "1.0",
            "type": "result",
            "owner": "agent",
            "status": "ok",
            "payload": {},
        }
        errors = validate_value(full_path, payload)
        assert isinstance(errors, list)
