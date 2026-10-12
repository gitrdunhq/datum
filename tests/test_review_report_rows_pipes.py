"""A pipe inside a code span (or escaped as \\|) is cell content, not a column break.

Review iteration 3 wrote a description quoting a regex in backticks,
`not_run|did not run|needs? to approve`. review_report_rows split on every
pipe, so the Key column shifted, the row's key read as '', `datum
review-accept <key>` reported the key "not in REVIEW-REPORT.md", and the
gate counted the finding as blocking forever (escalation after 3
iterations).
"""

from __future__ import annotations

from datum.gate import review_report_rows

HEAD = "| ID | Severity | File | Line | Description | Fix | Key |\n|---|---|---|---|---|---|---|\n"


def test_pipes_inside_a_code_span_do_not_split_the_row():
    # Catches: the key column shifting when a description quotes a regex.
    row = "| CORR-001 | **high** | skills/src/shared/batch.ts | 190 | REFUSAL_RE gains `not_run|did not run|needs? to approve` | Revert or amend. | 8ed9e6a1 |\n"
    (r,) = review_report_rows(HEAD + row)
    assert r["id"] == "CORR-001"
    assert r["severity"] == "high"
    assert r["key"] == "8ed9e6a1"
    assert r["description"] == "REFUSAL_RE gains `not_run|did not run|needs? to approve`"


def test_an_escaped_pipe_is_cell_content():
    # Catches: GitHub-style escaped pipes (\\|) also breaking the columns.
    row = "| PERF-002 | **medium** | a.ts | 3 | either a \\| b | Pick one. | 0123abcd |\n"
    (r,) = review_report_rows(HEAD + row)
    assert r["key"] == "0123abcd"
    assert r["description"] == "either a | b"


def test_plain_rows_parse_as_before():
    # Catches: the code-span handling changing ordinary rows.
    row = "| ARCH-001 | **high** | runner.ts | 56 | plain text | fix it | deadbeef |\n"
    (r,) = review_report_rows(HEAD + row)
    assert (r["id"], r["severity"], r["file"], r["line"], r["key"]) == ("ARCH-001", "high", "runner.ts", "56", "deadbeef")
