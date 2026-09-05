#!/usr/bin/env python3
"""Tests for dedupe module's silent fallback handling."""

import pytest

from datum.dedupe import deduplicate_findings, fuzzy_match


class TestFuzzyMatchLineNumberDefaults:
    """Test that fuzzy_match correctly handles findings with missing line numbers.

    When both findings lack a "line" field, the function uses default values
    (-1 and -2). Previously this would return True (match) when it should be
    more cautious about comparing findings without explicit line numbers.
    """

    def test_both_findings_missing_line_should_not_falsely_match(self):
        """Two findings from same file with no line numbers should not be marked as duplicates.

        This is a regression test for the bug where fuzzy_match would use
        -1 and -2 as defaults, calculate abs(-1 - (-2)) = 1, and incorrectly
        report a match.
        """
        f1 = {"file": "src/foo.py", "domain": "performance", "severity": "high"}
        f2 = {"file": "src/foo.py", "domain": "correctness", "severity": "medium"}

        # With missing line numbers, we should NOT consider these as duplicates
        # (we can't compare without line info)
        result = fuzzy_match(f1, f2)
        assert result is False, (
            "fuzzy_match should return False for findings without line numbers, "
            "not use -1/-2 defaults which would create false positives"
        )

    def test_deduplication_preserves_both_findings_when_line_numbers_missing(self):
        """Deduplication should preserve findings when line numbers are unavailable.

        This is the user-visible consequence: if fuzzy_match incorrectly reports
        a match for findings with missing line numbers, the second finding gets
        silently dropped, losing data.
        """
        findings = [
            {
                "file": "src/bug.py",
                "domain": "security",
                "severity": "critical",
                "message": "SQL injection vulnerability",
                # No line number
            },
            {
                "file": "src/bug.py",
                "domain": "correctness",
                "severity": "high",
                "message": "Type mismatch",
                # No line number
            },
        ]

        result = deduplicate_findings(findings)

        # Both findings should be preserved
        assert len(result) == 2, (
            f"Expected 2 findings to be preserved, got {len(result)}. "
            "The function silently dropped one finding when both lacked line numbers."
        )
        assert result[0]["message"] == "SQL injection vulnerability"
        assert result[1]["message"] == "Type mismatch"
