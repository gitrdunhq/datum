"""Tests for the refine gate's banned-terms scan (spec-write integration).

Ported from the spec-write skill's scan_terms.py methodology: a criterion
using an unmeasurable subjective/open-ended/superlative/loophole term is
unreviewable regardless of wording ('appropriate' has no reading a reviewer
could check against a diff). Conditional terms ('fast', 'secure') are fine
once a measure is attached to the same line.
"""

from datum.gate import check_banned_terms


def test_requirements_with_no_vague_terms_pass():
    spec = (
        "## Requirements\n\n"
        "1. The importer rejects a row with a malformed date and logs the "
        "row number.\n"
        "2. The API responds within 200ms at 50 concurrent requests.\n\n"
        "## Failure Modes\n\n"
    )
    assert check_banned_terms(spec) == []


def test_blocking_term_in_requirements_fails():
    spec = (
        "## Requirements\n\n"
        "1. The system handles errors in an appropriate way.\n\n"
        "## Failure Modes\n\n"
    )
    errors = check_banned_terms(spec)
    assert len(errors) == 1
    assert "appropriate" in errors[0]


def test_conditional_term_without_measure_fails():
    spec = (
        "## Requirements\n\n" "1. The search must be fast.\n\n" "## Failure Modes\n\n"
    )
    errors = check_banned_terms(spec)
    assert len(errors) == 1
    assert "fast" in errors[0]


def test_conditional_term_with_measure_passes():
    spec = (
        "## Requirements\n\n"
        "1. The search responds within 200ms.\n\n"
        "## Failure Modes\n\n"
    )
    assert check_banned_terms(spec) == []


def test_scan_is_scoped_to_requirements_section_only():
    """A vague term outside Requirements (e.g. in Context prose) must not fail the gate."""
    spec = (
        "## Context\n\nThis is an appropriate change given the codebase.\n\n"
        "## Requirements\n\n1. The importer logs a row number on failure.\n\n"
        "## Failure Modes\n\n"
    )
    assert check_banned_terms(spec) == []


def test_no_requirements_section_returns_no_errors():
    spec = "## Summary\n\nSomething.\n"
    assert check_banned_terms(spec) == []
