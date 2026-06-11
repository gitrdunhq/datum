"""Tests for the refine gate's open-question heuristic (issue #57).

The '[ ]'/TBD/TODO scan must be scoped to the Open Questions section body,
so checkbox-style acceptance criteria elsewhere in the SPEC don't trip the gate.
"""

from datum.gate import check_open_questions


def test_checkbox_acceptance_criteria_pass():
    """#57 repro: checkbox ACs outside Open Questions must not fail the gate."""
    spec = (
        "## Acceptance Criteria\n\n"
        "- [ ] gate accepts checkbox ACs\n"
        "- [ ] full suite stays green\n\n"
        "## Open Questions\n\n"
        "None.\n"
    )
    assert check_open_questions(spec) == []


def test_unresolved_checkbox_in_open_questions_fails():
    """Negative path: a genuinely unanswered question still blocks the gate."""
    spec = (
        "## Acceptance Criteria\n\n"
        "- [x] done item\n\n"
        "## Open Questions\n\n"
        "- [ ] Do we need retries here?\n"
    )
    errors = check_open_questions(spec)
    assert len(errors) == 1
    assert "Open Questions" in errors[0]


def test_tbd_in_open_questions_fails():
    spec = "## Open Questions\n\nOwner: TBD\n"
    assert len(check_open_questions(spec)) == 1


def test_todo_in_open_questions_fails():
    spec = "## Open Questions\n\nTODO: confirm rollout order\n"
    assert len(check_open_questions(spec)) == 1


def test_todo_outside_open_questions_passes():
    """Markers in other sections are not open questions."""
    spec = (
        "## Requirements\n\nTODO is mentioned as a label name here.\n\n"
        "## Open Questions\n\nNone.\n"
    )
    assert check_open_questions(spec) == []


def test_no_open_questions_section_passes():
    """SPEC without an Open Questions section never trips the heuristic."""
    spec = "## Summary\n\n- [ ] checkbox\nTBD elsewhere\nTODO too\n"
    assert check_open_questions(spec) == []


def test_inline_open_question_phrase_without_section_passes():
    """Prose mentioning 'open question' plus checkboxes elsewhere must pass
    (this exact combination tripped the old heuristic)."""
    spec = (
        "## Summary\n\nThis resolves the open question about caching.\n\n"
        "## Acceptance Criteria\n\n- [ ] cache hit rate measured\n"
    )
    assert check_open_questions(spec) == []


def test_open_questions_as_last_section_with_marker_fails():
    """Section body extends to EOF when no heading follows."""
    spec = "## Summary\n\nFine.\n\n## Open Questions\n\n- [ ] unresolved at EOF\n"
    assert len(check_open_questions(spec)) == 1


def test_numbered_open_questions_heading_detected():
    """references-style numbered headings (## 10. Open Questions) are matched."""
    spec = "## 10. Open Questions\n\n- [ ] still open\n"
    assert len(check_open_questions(spec)) == 1


def test_marker_after_open_questions_section_passes():
    """A marker in the section *after* Open Questions does not fail."""
    spec = "## Open Questions\n\nNone.\n\n" "## Rollout\n\n- [ ] flip the flag\n"
    assert check_open_questions(spec) == []
