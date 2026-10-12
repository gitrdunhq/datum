"""A REVIEW-REPORT row whose free text carries a bare pipe keeps its key.

Run 20261012-150046: ARCH-001's description quoted the TypeScript type
'ok' | 'error' outside a code span. The row split into 12 cells for a
7-column header, review_report_rows read the Key column by position, got
prose, and `datum review-accept ARCH-001` recorded the accept under the id
instead of the key b9179c85. Columns after the free-text ones are read from
the end of the row; extra cells belong to the free text.
"""

from __future__ import annotations

from datum.gate import review_report_rows

REPORT = """# Review

| ID | Severity | File | Line | Description | Suggestion | Key |
|---|---|---|---|---|---|---|
| ARCH-001 | **medium** | skills/src/runtime/metrics.ts | 9 | The type is 'ok' | 'error' but the contract is 'ok' | 'invalid' | 'error'. | Widen it to 'ok' | 'invalid' | 'error'. | b9179c85 |
| SEC-001 | **medium** | skills/src/runtime/metrics.ts | 63 | plain row | fix it | 895f2c4d |
"""


def test_the_key_of_a_row_with_bare_pipes_is_its_last_cell():
    rows = {r["id"]: r for r in review_report_rows(REPORT)}
    assert rows["ARCH-001"]["key"] == "b9179c85"
    assert rows["ARCH-001"]["file"] == "skills/src/runtime/metrics.ts"
    assert rows["ARCH-001"]["line"] == "9"
    assert rows["ARCH-001"]["description"].startswith("The type is 'ok' | 'error'")


def test_a_plain_row_is_unchanged():
    rows = {r["id"]: r for r in review_report_rows(REPORT)}
    assert rows["SEC-001"] == {
        "id": "SEC-001",
        "severity": "medium",
        "file": "skills/src/runtime/metrics.ts",
        "line": "63",
        "description": "plain row",
        "key": "895f2c4d",
    }
