# ACT Phase — Python Overrides

Apply when language is `python`. Supplements `references/04-act.md`.

## Test Framework

**Default:** pytest.

Run tests via: `uv run pytest` (never bare `pytest`).

## RED agent — Python specifics

Stub commit format:
```python
# Stub: introduced by task-001 for downstream RED agents
class RecordingSession:
    def start_recording(self) -> "RecordingHandle":
        raise NotImplementedError
```

Test file (pytest):
```python
import pytest
from recording_session import RecordingSession

# Property: SAFE-001 — no session without permission
class TestRecordingSessionSAFE001:
    def test_raises_permission_denied_when_camera_denied(self):
        """SAFE-001: Never starts without camera permission."""
        session = RecordingSession(permission_granted=False)
        with pytest.raises(PermissionError, match="camera permission"):
            session.start_recording()
```

Property ID: embed in class name (`TestSAFE001`) or in the docstring.

## GREEN agent — Python specifics

Implementation in `src/` (never touch `tests/`).

```python
def start_recording(self) -> "RecordingHandle":
    if not self._permission_granted:
        raise PermissionError("camera permission required to start recording")
    return self._create_handle()
```

Use `structlog` for logging. Use `httpx` for HTTP. Run through `uv run`.

## REFACTOR agent — Python specifics

- Add type hints to all public methods (use `from __future__ import annotations` at top of file)
- Replace print() with `structlog.get_logger().info(...)` 
- Apply `black` formatting, `ruff` linting: `uv run black . && uv run ruff check --fix .`
- Boundary validation with pydantic models at entry points

## Commit convention

```
red(task-001): failing test for SAFE-001 – permission guard
green(task-001): minimum implementation for SAFE-001
refactor(task-001): full AC coverage – RecordingSession
```

## test_signal.py

pytest is a v1 gap. The skill will halt before entering ACT and display:

> test_signal.py does not support pytest (v1 gap). Extend the parser in scripts/test_signal.py to add a pytest parser, or add `conftest.py` with a custom JSON reporter that outputs Vitest-compatible JSON.

**Workaround for v1:** Add `pytest-json-report` to dev deps and configure pytest to output JSON. Then pass `--framework vitest` to test_signal.py (the JSON format is compatible).
