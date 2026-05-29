# Spec: gate.py hardening — multi-line answers + _contracts() readability

**Run ID:** <!-- filled by datum -->
**Phase:** Refine
**Status:** Draft

---

## 1. Summary

Two fixes to `datum/gate.py`: (1) `check_questions_answered` peeks ahead to
the next non-empty line when `[Answer]:` has no inline text, preventing
false-positive "unanswered" errors on multi-line answers; (2) every `_contracts()`
call site unpacks to named variables `validate_payload, validate_value` instead
of opaque index access.

## 2. Context

**#24:** `check_questions_answered` parses `[Answer]: text` and errors if `text`
is empty. Valid multi-line answers like:
```
[Answer]:
The model is deployed via Fargate with autoscaling on CPU utilisation.
```
are reported as unanswered because the inline text is empty. The fix peeks
ahead to the next non-empty, non-header line.

**#22:** `_contracts()` returns a 2-tuple `(validate_payload, validate_value)`.
Call sites use `_contracts()[0]` and `_contracts()[1]` — the reader has no idea
which is which without reading the function definition. Named unpacking fixes this.

## 3. Requirements

### R1: check_questions_answered peek-ahead

**Acceptance criteria:**
- `[Answer]:\nActual answer on next line` is NOT flagged as unanswered
- `[Answer]:` with no text on same line AND no non-empty next line IS flagged
- `[Answer]: inline answer` still works as before
- Blank lines between `[Answer]:` and the answer text are skipped

### R2: _contracts() named unpacking

**Acceptance criteria:**
- Every `_contracts()[0]` replaced with `validate_payload, _ = _contracts()` (or equivalent named unpack)
- Every `_contracts()[1]` replaced with `_, validate_value = _contracts()`
- Or: unpack both at once — `validate_payload, validate_value = _contracts()`
- No functional change — same calls, just readable names

### R3: Tests

**Acceptance criteria:**
- `test_multiline_answer_not_flagged`: `[Answer]:\nreal answer` → no errors
- `test_inline_answer_not_flagged`: `[Answer]: inline` → no errors
- `test_empty_answer_flagged`: `[Answer]:` with only blank lines after → error
- All existing gate tests still pass

## 4. Failure Modes and Handling

| Failure | Handling |
|---|---|
| Peek-ahead reads past end of lines list | Bounds-check with `i + 1 < len(lines)` |
| Next line is another question header | Treat as unanswered (question changed before answer given) |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| No new dependencies | Pure Python |
| No change to gate exit codes or JSON output schema | Behavioral changes only |

## 6. Out of Scope

- Changing the QUESTIONS.md template format
- Fixing other functions in gate.py

## 7. Open Questions

*(none)*

## Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | _contracts() always returns exactly 2 items | Confirmed: `return validate_payload, validate_value` | confirmed | n/a |
| 2 | Lines after [Answer]: that start with `###` are question headers, not answer text | Consistent with QUESTIONS.md format | confirmed | n/a |

## 9. Classification Metadata

```yaml
estimated_files: 2
estimated_loc: 40
clusters_touched: 1
new_public_api: false
dependency_additions: []
```
