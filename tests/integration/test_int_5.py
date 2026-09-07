"""Integration invariants covering task-003 (integration-lanes-2 epic).

This is a `kind: "integration"` lane (task-INT-5): its acceptance criteria
describe behaviour that task-003 already merged into
skills/src/shared/triage-classify.ts, skills/src/datum-tdd-act-triage.ts and
skills/src/datum-tdd-act-lane.ts. Per contract_summary in this lane's spec,
these tests are expected to PASS against the already-merged code — a failing
test here is a finding about task-003, not a placeholder to be filled in
during GREEN.

INT-06: Covered task ids are embedded as a substring of
`TriageClassification.reason` (extracted via regex), not carried on a new
structured `taskIds: string[]` field, sufficient for the issue-filer
(datum-tdd-act-triage.ts) and the halt message (datum-tdd-act-lane.ts) that
both read `reason` in this slice.

Because `classifyLaneError`/`TriageClassification` are TypeScript (there is
no Python port), the behavioural assertions below extract and evaluate the
exact `covered ([^;]+)` regex the implementation uses against the same
byte-shape error strings task-002/task-003 actually produce, and the
structural assertions pin the absence of a `taskIds` field and the presence
of `.reason`-only reads in the two consumers named by the AC.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TRIAGE_CLASSIFY_TS = REPO_ROOT / "skills/src/shared/triage-classify.ts"
ACT_TRIAGE_TS = REPO_ROOT / "skills/src/datum-tdd-act-triage.ts"
ACT_LANE_TS = REPO_ROOT / "skills/src/datum-tdd-act-lane.ts"

SPEC_AC_ERROR = (
    "integration_failed: covered task-002, task-003; invariants INV-01, "
    "INV-03 (independent verify exit=1)"
)


def _extract_covered_regex_reason(error_text: str) -> str:
    """Mirrors classifyLaneError's `covered ([^;]+)` extraction and reason
    template in skills/src/shared/triage-classify.ts (lines ~269-277), so the
    behavioural assertions below exercise the same regex against the exact
    strings the implementation is expected to handle."""
    covered_match = re.search(r"covered ([^;]+)", error_text)
    covered_ids = covered_match.group(1).strip() if covered_match else "unknown lane(s)"
    return (
        f"integration_failed: covered {covered_ids} — the independent "
        "post-merge verify found the merged epic's suite red even though "
        "every covered lane's own tests passed in isolation, a genuine "
        "cross-lane code defect."
    )


class TestInt06CoveredTaskIdsEmbeddedInReasonSubstring:
    """INT-06 positive path: covered task ids are embedded as a substring of
    `reason`, extracted via the `covered ([^;]+)` regex — not a separate
    structured field."""

    def test_two_covered_task_ids_are_both_present_as_substrings_of_reason(
        self,
    ) -> None:
        reason = _extract_covered_regex_reason(SPEC_AC_ERROR)
        assert "task-002" in reason
        assert "task-003" in reason

    def test_single_covered_task_id_is_present_as_a_substring_of_reason(self) -> None:
        reason = _extract_covered_regex_reason(
            "integration_failed: covered task-007; invariants INV-02 "
            "(independent verify exit=1)"
        )
        assert "task-007" in reason

    def test_missing_covered_segment_falls_back_without_raising(self) -> None:
        # Negative/error path: an integration_failed error with no `covered `
        # segment must not raise, and must not silently invent a task id.
        reason = _extract_covered_regex_reason("integration_failed: exit=1")
        assert "unknown lane(s)" in reason
        assert "task-002" not in reason
        assert "task-003" not in reason

    def test_extraction_matches_the_source_regex_used_by_classify_lane_error(
        self,
    ) -> None:
        src = TRIAGE_CLASSIFY_TS.read_text()
        assert "text.match(/covered ([^;]+)/)" in src
        assert "coveredMatch ? coveredMatch[1].trim() : 'unknown lane(s)'" in src


class TestInt06NoStructuredTaskIdsField:
    """INT-06 negative path: `TriageClassification` carries category,
    confidence and reason only — no new structured `taskIds: string[]`
    field was added to hold covered task ids."""

    def test_triage_classification_interface_has_exactly_three_fields(self) -> None:
        src = TRIAGE_CLASSIFY_TS.read_text()
        iface_match = re.search(
            r"export interface TriageClassification \{(.*?)\n\}\n", src, re.DOTALL
        )
        assert iface_match is not None, "TriageClassification interface not found"
        body = iface_match.group(1)
        field_names = set(re.findall(r"^\s*(\w+)\s*:", body, re.MULTILINE))
        assert field_names == {"category", "confidence", "reason"}
        assert "taskIds" not in body

    def test_no_task_ids_array_field_anywhere_in_triage_classify_module(self) -> None:
        src = TRIAGE_CLASSIFY_TS.read_text()
        assert "taskIds" not in src
        assert "task_ids" not in src


class TestInt06IssueFilerReadsReasonOnly:
    """INT-06 consumer #1: the issue-filer (datum-tdd-act-triage.ts) reads
    `cls.reason`, not a structured task-id list, when a category is already
    deterministically known."""

    def test_issue_filer_reads_cls_reason_in_the_category_already_determined_note(
        self,
    ) -> None:
        src = ACT_TRIAGE_TS.read_text()
        assert "CATEGORY ALREADY DETERMINED: ${cls.category} (${cls.reason})" in src
        assert "cls.taskIds" not in src


class TestInt06HaltMessageReadsReasonOnly:
    """INT-06 consumer #2: the RED-stage halt/error message for a failed
    integration lane (datum-tdd-act-lane.ts) builds `error` from the covered
    task ids directly, and that `error` string is what flows into
    `classifyLaneError(...).reason` — no separate `taskIds` field is
    threaded through the LaneOutcome."""

    def test_halt_message_builds_covered_and_invariant_ids_into_the_error_string(
        self,
    ) -> None:
        src = ACT_LANE_TS.read_text()
        assert (
            "const error = `integration_failed: covered ${covered}; "
            "invariants ${invariantIds} (independent verify exit=${redVerifyVerdict.exit})`"
            in src
        )

    def test_lane_outcome_error_field_has_no_sibling_task_ids_field_nearby(
        self,
    ) -> None:
        src = ACT_LANE_TS.read_text()
        halt_match = re.search(
            r"const error = `integration_failed:.*?\n.*?return \{ task_id: taskId, status: 'failed', stage: 'RED', error \}\n",
            src,
            re.DOTALL,
        )
        assert halt_match is not None, "integration_failed halt return not found"
        assert "taskIds" not in halt_match.group(0)
