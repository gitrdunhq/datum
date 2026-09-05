"""Characterization tests for datum.schemas._truncate.

_truncate(v: str, limit: int) -> str is a simple string truncator used by
25+ Pydantic field validators across TriageDecision, ClassificationOverride,
GateVerdict, FailureClassification, ReviewFinding, EscalationSignal, and others.

This characterization suite pins CURRENT behavior for all branches:
- normal input (string shorter than limit)
- boundary lengths (exactly at limit, limit±1)
- empty string
- None (non-string input)
- unicode and multi-byte characters
- all actual limit values used in schemas (20, 200, 300)
"""

from __future__ import annotations

import pytest

from datum.schemas import _truncate


class TestTruncateNormalBehavior:
    """String shorter than or at limit should return unchanged."""

    def test_short_string_returned_unchanged(self) -> None:
        """String well under limit should be returned as-is."""
        result = _truncate("hello", 100)
        assert result == "hello"

    def test_string_exactly_at_limit_returned_unchanged(self) -> None:
        """String exactly at limit should be returned as-is."""
        s = "hello"
        result = _truncate(s, 5)
        assert result == "hello"
        assert len(result) == 5

    def test_empty_string_returned_unchanged(self) -> None:
        """Empty string should return empty string."""
        result = _truncate("", 100)
        assert result == ""


class TestTruncateBoundaryConditions:
    """Test truncation at boundary: limit-1, limit, limit+1."""

    def test_truncate_at_exact_limit(self) -> None:
        """String of length limit+1 should truncate to limit chars."""
        s = "abcdef"  # length 6
        result = _truncate(s, 5)
        assert result == "abcde"
        assert len(result) == 5

    def test_truncate_limit_minus_one(self) -> None:
        """String of length limit should not be truncated (at limit, not over)."""
        s = "abcde"  # length 5
        result = _truncate(s, 5)
        assert result == "abcde"
        assert len(result) == 5

    def test_truncate_limit_plus_one(self) -> None:
        """String of length limit+1 should truncate to limit."""
        s = "abcdef"  # length 6
        result = _truncate(s, 5)
        assert result == "abcde"
        assert len(result) == 5

    def test_truncate_limit_plus_ten(self) -> None:
        """String well over limit should truncate to exactly limit chars."""
        s = "0123456789abcdefghij"  # length 20
        result = _truncate(s, 10)
        assert result == "0123456789"
        assert len(result) == 10


class TestTruncateSchemaLimits:
    """Test with actual limit values used in datum.schemas field validators."""

    def test_truncate_to_20_chars(self) -> None:
        """ReviewFinding.id limit is 20 chars."""
        s = "a" * 25
        result = _truncate(s, 20)
        assert result == "a" * 20
        assert len(result) == 20

    def test_truncate_to_200_chars(self) -> None:
        """TriageDecision.reason, etc. limit is 200 chars."""
        s = "x" * 250
        result = _truncate(s, 200)
        assert result == "x" * 200
        assert len(result) == 200

    def test_truncate_to_300_chars(self) -> None:
        """GateVerdict.message and ReviewFinding fields limit to 300 chars."""
        s = "y" * 350
        result = _truncate(s, 300)
        assert result == "y" * 300
        assert len(result) == 300


class TestTruncateUnicode:
    """Test Unicode and multi-byte character handling."""

    def test_unicode_chars_counted_by_character_not_byte(self) -> None:
        """Limit should count by character, not byte. '你好世界' = 4 chars."""
        s = "你好世界" + "a" * 10  # 4 Chinese chars + 10 ASCII = 14 chars total
        result = _truncate(s, 6)
        assert result == "你好世界" + "aa"  # First 6 chars
        assert len(result) == 6

    def test_emoji_single_character_limit(self) -> None:
        """Emoji should count as a single character."""
        s = "😀" * 10  # 10 emojis
        result = _truncate(s, 5)
        assert result == "😀" * 5
        assert len(result) == 5

    def test_truncate_middle_of_multibyte_sequence(self) -> None:
        """If we truncate in the middle, we should still get valid string."""
        s = "café" * 3  # Each 'é' is a single Unicode char
        result = _truncate(s, 5)
        # "café" is 4 chars, so "café" + "c" = 5 chars
        assert len(result) == 5
        assert result == "caféc"


class TestTruncateNonStringInput:
    """Test behavior with non-string inputs (potential bugs)."""

    def test_none_input_returned_as_is(self) -> None:
        """None input: function returns None unchanged (isinstance check)."""
        result = _truncate(None, 100)  # type: ignore
        assert result is None

    def test_integer_input_returned_as_is(self) -> None:
        """Integer input: function returns integer unchanged (not a string)."""
        result = _truncate(12345, 100)  # type: ignore
        assert result == 12345

    def test_list_input_returned_as_is(self) -> None:
        """List input: function returns list unchanged."""
        lst = [1, 2, 3]
        result = _truncate(lst, 100)  # type: ignore
        assert result is lst

    def test_dict_input_returned_as_is(self) -> None:
        """Dict input: function returns dict unchanged."""
        d = {"key": "value"}
        result = _truncate(d, 100)  # type: ignore
        assert result is d

    def test_float_input_returned_as_is(self) -> None:
        """Float input: function returns float unchanged."""
        result = _truncate(3.14, 100)  # type: ignore
        assert result == 3.14


class TestTruncatePreservesFirstNChars:
    """Verify docstring claim: 'Preserves the first N chars exactly'."""

    def test_preserves_first_chars_when_truncating(self) -> None:
        """When truncating, the first N characters should be preserved exactly."""
        original = "The quick brown fox jumps over the lazy dog"
        for limit in [5, 10, 15, 20]:
            result = _truncate(original, limit)
            assert result == original[:limit]

    def test_preserves_order_and_content(self) -> None:
        """Content and order should be identical up to the limit."""
        original = "0123456789" * 10  # Repeating sequence
        result = _truncate(original, 37)
        assert result == original[:37]
        # Verify by checking slicing matches
        for i in range(len(result)):
            assert result[i] == original[i]
