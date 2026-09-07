"""#460 — CURRENT_STATE.md's Review Decisions section must never read as
final when REVIEW-RESPONSE.md is absent, and must track decisions recorded
after the closeout pipeline wrote the file.

datum.closeout.review_decisions is the single deterministic renderer for
that section, used both by the initial synthesis and by `datum
review-accept`, which re-patches CURRENT_STATE.md whenever a decision is
recorded.
"""

from __future__ import annotations

from datum.closeout.review_decisions import (
    ABSENT_SENTENCE,
    SECTION_END,
    SECTION_START,
    render_review_decisions_body,
    render_review_decisions_section,
    upsert_review_decisions_section,
)


class TestRenderBody:
    def test_absent_review_response_is_provisional_not_final(self, tmp_path):
        body = render_review_decisions_body(tmp_path / "REVIEW-RESPONSE.md")
        assert body == ABSENT_SENTENCE
        assert "no REVIEW-RESPONSE.md" not in body.lower()
        assert "review-accept" in body

    def test_empty_review_response_file_is_still_provisional(self, tmp_path):
        response = tmp_path / "REVIEW-RESPONSE.md"
        response.write_text("# Review Response\n\n")
        assert render_review_decisions_body(response) == ABSENT_SENTENCE

    def test_recorded_decisions_are_quoted_verbatim(self, tmp_path):
        response = tmp_path / "REVIEW-RESPONSE.md"
        response.write_text(
            "# Review Response\n\n"
            "- ACCEPT PERF-001: 40 pieces, microseconds\n"
            "- DEFER CORR-002 -> datum/other: UI epic\n"
        )
        body = render_review_decisions_body(response)
        assert body == (
            "- ACCEPT PERF-001: 40 pieces, microseconds\n"
            "- DEFER CORR-002 -> datum/other: UI epic"
        )


class TestRenderSection:
    def test_section_is_wrapped_in_markers(self, tmp_path):
        section = render_review_decisions_section(tmp_path / "REVIEW-RESPONSE.md")
        assert section.startswith(SECTION_START)
        assert section.endswith(SECTION_END)
        assert ABSENT_SENTENCE in section


class TestUpsert:
    def test_does_nothing_when_current_state_does_not_exist(self, tmp_path):
        current_state = tmp_path / "CURRENT_STATE.md"
        response = tmp_path / "REVIEW-RESPONSE.md"
        assert upsert_review_decisions_section(current_state, response) is False
        assert not current_state.exists()

    def test_appends_section_the_first_time(self, tmp_path):
        current_state = tmp_path / "CURRENT_STATE.md"
        current_state.write_text("# Project State\n\nSome prose.\n")
        response = tmp_path / "REVIEW-RESPONSE.md"
        assert upsert_review_decisions_section(current_state, response) is True
        text = current_state.read_text()
        assert "Some prose." in text
        assert ABSENT_SENTENCE in text
        assert text.count(SECTION_START) == 1

    def test_review_accept_makes_a_stale_absent_sentence_true_again(self, tmp_path):
        """The core #460 regression: CURRENT_STATE.md was written before any
        review-accept ran, so it carries the absent-sentence section — then
        a decision is recorded, and re-running the upsert must replace that
        sentence with the recorded decision, not leave it stale forever."""
        current_state = tmp_path / "CURRENT_STATE.md"
        response = tmp_path / "REVIEW-RESPONSE.md"
        current_state.write_text(
            "# Project State\n\n" + render_review_decisions_section(response) + "\n"
        )
        assert ABSENT_SENTENCE in current_state.read_text()

        response.write_text("# Review Response\n\n- ACCEPT PERF-001: reason here\n")
        assert upsert_review_decisions_section(current_state, response) is True
        text = current_state.read_text()
        assert ABSENT_SENTENCE not in text
        assert "- ACCEPT PERF-001: reason here" in text
        assert text.count(SECTION_START) == 1
        assert text.count(SECTION_END) == 1

    def test_second_upsert_with_no_change_reports_false_and_leaves_file_untouched(
        self, tmp_path
    ):
        current_state = tmp_path / "CURRENT_STATE.md"
        current_state.write_text("# Project State\n")
        response = tmp_path / "REVIEW-RESPONSE.md"
        assert upsert_review_decisions_section(current_state, response) is True
        assert upsert_review_decisions_section(current_state, response) is False
