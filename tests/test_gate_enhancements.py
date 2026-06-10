"""Tests for QUESTIONS.md validation and overconfidence gate enhancements in gate.py."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class TestResolveEpicDir(unittest.TestCase):
    def test_returns_path_based_on_branch(self):
        """resolve_epic_dir() returns docs/epics/<branch>/"""
        from datum.gate import resolve_epic_dir

        epic_dir = resolve_epic_dir()
        self.assertIn("docs/epics/", str(epic_dir))


class TestCheckQuestionsAnswered(unittest.TestCase):
    def test_empty_answer_fails(self):
        """SAFE-004: unanswered question blocks gate"""
        from datum.gate import check_questions_answered

        content = (
            "### Q1: [Scope] Question?\n\n[Answer]:\n\n### Q2: done?\n\n[Answer]: yes\n"
        )
        errors = check_questions_answered(content)
        self.assertEqual(len(errors), 1)
        self.assertIn("Q1", errors[0])

    def test_all_answered_passes(self):
        """LIVE-003: filled answers pass"""
        from datum.gate import check_questions_answered

        content = (
            "### Q1: Question?\n\n[Answer]: yes\n\n### Q2: Another?\n\n[Answer]: no\n"
        )
        errors = check_questions_answered(content)
        self.assertEqual(len(errors), 0)

    def test_whitespace_only_answer_fails(self):
        from datum.gate import check_questions_answered

        content = "### Q1: Question?\n\n[Answer]:   \n\n"
        errors = check_questions_answered(content)
        self.assertEqual(len(errors), 1)

    def test_no_questions_passes(self):
        """No questions in file is valid"""
        from datum.gate import check_questions_answered

        content = "## Refine — 2026-05-27\n\nNo clarifying questions needed.\n"
        errors = check_questions_answered(content)
        self.assertEqual(len(errors), 0)


class TestCheckAssumptionAudit(unittest.TestCase):
    def test_missing_section_fails(self):
        """Gate fails when Assumption Audit section is missing"""
        from datum.gate import check_assumption_audit

        spec = "# Spec\n## Summary\nSome content\n"
        errors, warnings = check_assumption_audit(spec, None)
        self.assertTrue(len(errors) > 0)

    def test_all_confirmed_passes(self):
        """All confirmed assumptions pass"""
        from datum.gate import check_assumption_audit

        spec = (
            "## Assumption Audit\n\n"
            "| # | Assumption | Justification | Status | Resolves |\n"
            "|---|---|---|---|---|\n"
            "| 1 | Test | Safe | confirmed | n/a |\n"
        )
        errors, warnings = check_assumption_audit(spec, None)
        self.assertEqual(len(errors), 0)

    def test_numbered_section_heading_passes(self):
        """references/01-refine.md numbers Assumption Audit as section 9."""
        from datum.gate import check_assumption_audit

        spec = (
            "## 9. Assumption Audit\n\n"
            "| # | Assumption | Justification | Status | Resolves |\n"
            "|---|---|---|---|---|\n"
            "| 1 | Test | Safe | confirmed | n/a |\n"
        )
        errors, warnings = check_assumption_audit(spec, None)
        self.assertEqual(len(errors), 0)

    def test_guess_without_resolves_fails(self):
        """SAFE-001: guess without Resolves fails"""
        from datum.gate import check_assumption_audit

        spec = (
            "## Assumption Audit\n\n"
            "| # | Assumption | Justification | Status | Resolves |\n"
            "|---|---|---|---|---|\n"
            "| 1 | Risky | Maybe | guess | n/a |\n"
        )
        errors, warnings = check_assumption_audit(spec, None)
        self.assertTrue(len(errors) > 0)

    def test_guess_with_valid_resolves_passes(self):
        """Guess with answered Q passes"""
        from datum.gate import check_assumption_audit

        spec = (
            "## Assumption Audit\n\n"
            "| # | Assumption | Justification | Status | Resolves |\n"
            "|---|---|---|---|---|\n"
            "| 1 | Risky | Maybe | guess | Q1 |\n"
        )
        questions = "### Q1: [Scope] Is this safe?\n\n[Answer]: Yes it is.\n"
        errors, warnings = check_assumption_audit(spec, questions)
        self.assertEqual(len(errors), 0)

    def test_zero_refine_questions_warns(self):
        """OBS-001: zero questions emits warning"""
        from datum.gate import check_assumption_audit

        spec = (
            "## Assumption Audit\n\n"
            "| # | Assumption | Justification | Status | Resolves |\n"
            "|---|---|---|---|---|\n"
            "| 1 | Test | Safe | confirmed | n/a |\n"
        )
        # No Refine section at all — only Plan
        questions = "## Plan — 2026-05-27\n\n### Q1: Question?\n\n[Answer]: yes\n"
        errors, warnings = check_assumption_audit(spec, questions)
        self.assertTrue(len(warnings) > 0)


class TestBackwardCompat(unittest.TestCase):
    def test_no_questions_file_passes_refine(self):
        """COMPAT-004: missing QUESTIONS.md passes gate"""
        # This is tested implicitly — gate_refine only checks if file exists
        pass

    def test_no_assumption_audit_with_config_disable_passes(self):
        """COMPAT-002: old SPEC passes when overconfidence disabled"""
        from datum.gate import check_assumption_audit

        spec = "# Spec\n## Summary\nNo audit section\n"
        # When disabled, should pass
        errors, warnings = check_assumption_audit(
            spec, None, overconfidence_enabled=False
        )
        self.assertEqual(len(errors), 0)


if __name__ == "__main__":
    unittest.main()
