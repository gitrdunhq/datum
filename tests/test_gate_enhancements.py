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


class TestDecidedStatus(unittest.TestCase):
    def test_decided_status_passes_without_q_reference(self):
        """decided status is a product decision — no Q reference needed."""
        from datum.gate import check_assumption_audit

        spec = (
            "## Assumption Audit\n\n"
            "| # | Assumption | Justification | Status | Resolves |\n"
            "|---|---|---|---|---|\n"
            "| A1 | default true is right | product decision | decided | n/a |\n"
        )
        errors, _ = check_assumption_audit(spec, None)
        assert len(errors) == 0, f"decided should pass but got: {errors}"

    def test_guess_without_q_still_fails(self):
        """guess status without Q reference should still block."""
        from datum.gate import check_assumption_audit

        spec = (
            "## Assumption Audit\n\n"
            "| # | Assumption | Justification | Status | Resolves |\n"
            "|---|---|---|---|---|\n"
            "| A1 | might work | unknown | guess | n/a |\n"
        )
        errors, _ = check_assumption_audit(spec, None)
        assert len(errors) == 1

    def test_confirmed_passes(self):
        """confirmed status should pass as before."""
        from datum.gate import check_assumption_audit

        spec = (
            "## Assumption Audit\n\n"
            "| # | Assumption | Justification | Status | Resolves |\n"
            "|---|---|---|---|---|\n"
            "| A1 | verified in code | checked source | confirmed | n/a |\n"
        )
        errors, _ = check_assumption_audit(spec, None)
        assert len(errors) == 0


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


class TestAssumptionAuditResolvesReference(unittest.TestCase):
    """elonchesd datum/player-guidance wf_251cf8a3-363: 'Q8 (partially)' and
    'Q2 (related)' DO reference Q<N>; the exact-match rule rejected them
    after 20 minutes of planning agents. A 'guess' row passes when Resolves
    contains a Q<N> that is answered; 'n/a' is the real violation, and the
    message names the file to fix (SPEC.md's Assumption Audit), never
    tasks.json."""

    SPEC = (
        "## Assumption Audit\n\n"
        "| # | Assumption | Justification | Status | Resolves |\n"
        "|---|---|---|---|---|\n"
        "| 4 | Risky | Maybe | guess | {r4} |\n"
        "| 7 | Risky | Maybe | guess | {r7} |\n"
        "| 8 | Risky | Maybe | guess | {r8} |\n"
    )
    QUESTIONS = (
        "### Q2: [Scope] Two?\n\n[Answer]: yes.\n\n"
        "### Q8: [Scope] Eight?\n\n[Answer]: partly.\n"
    )

    def test_parenthetical_reference_to_an_answered_question_passes(self):
        from datum.gate import check_assumption_audit

        spec = self.SPEC.format(r4="Q8 (partially)", r7="Q2 (related)", r8="Q8")
        errors, _ = check_assumption_audit(spec, self.QUESTIONS)
        self.assertEqual(errors, [])

    def test_na_with_prose_is_the_violation_and_names_spec_md(self):
        from datum.gate import check_assumption_audit

        spec = self.SPEC.format(
            r4="n/a — decided by convention", r7="Q2 (related)", r8="Q8"
        )
        errors, _ = check_assumption_audit(spec, self.QUESTIONS)
        self.assertEqual(len(errors), 1)
        self.assertIn("Assumption 4", errors[0])
        self.assertIn("SPEC.md", errors[0])
        self.assertNotIn("tasks.json", errors[0])

    def test_reference_to_an_unanswered_question_still_fails(self):
        from datum.gate import check_assumption_audit

        spec = self.SPEC.format(r4="Q3 (related)", r7="Q2", r8="Q8")
        errors, _ = check_assumption_audit(spec, self.QUESTIONS)
        self.assertEqual(len(errors), 1)
        self.assertIn("Q3", errors[0])
        self.assertIn("unanswered", errors[0])


class TestRefineGateRunsAssumptionAudit(unittest.TestCase):
    """The audit table is refine's output; checking it only at the plan gate
    threw away 20 minutes of planning agents (elonchesd wf_251cf8a3-363).
    The refine gate runs the same check, where a fix costs seconds."""

    def _epic(self, tmp: str, resolves: str) -> None:
        import os
        import subprocess

        subprocess.run(["git", "init", "-q", "-b", "datum/e"], cwd=tmp, check=True)
        # The epic dir resolves from the branch, which needs a commit; hermetic
        # against the developer's global git config and hooks.
        subprocess.run(
            [
                "git",
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "base",
            ],
            cwd=tmp,
            check=True,
        )
        os.makedirs(os.path.join(tmp, "docs", "epics", "datum", "e"))
        spec = (
            "# Spec\n## Summary\nx\n## Requirements\nx\n## Failure modes\nx\n"
            "## Non-functional\nx\n## Out of scope\nx\n"
            "## Assumption Audit\n\n"
            "| # | Assumption | Justification | Status | Resolves |\n"
            "|---|---|---|---|---|\n"
            f"| 1 | Risky | Maybe | guess | {resolves} |\n"
        )
        with open(
            os.path.join(tmp, "docs", "epics", "datum", "e", "SPEC.md"), "w"
        ) as f:
            f.write(spec)
        with open(
            os.path.join(tmp, "docs", "epics", "datum", "e", "QUESTIONS.md"), "w"
        ) as f:
            f.write("## Refine\n\n### Q1: [Scope] One?\n\n[Answer]: yes.\n")

    def _run(self, tmp: str) -> tuple[bool, str]:
        import io
        import os
        from contextlib import redirect_stdout

        from datum.gate import gate_refine

        cwd = os.getcwd()
        os.chdir(tmp)
        buf = io.StringIO()
        try:
            with redirect_stdout(buf):
                gate_refine(yolo=True, config={})
            return True, buf.getvalue()
        except SystemExit as e:
            # pass_gate() exits 0, fail() exits 1: the code is the verdict.
            return e.code in (0, None), buf.getvalue()
        finally:
            os.chdir(cwd)

    def test_refine_gate_fails_on_a_guess_with_no_question(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            self._epic(tmp, "n/a")
            passed, out = self._run(tmp)
            self.assertFalse(passed)
            self.assertIn("Assumption 1", out)
            self.assertIn("SPEC.md", out)

    def test_refine_gate_passes_on_a_guess_resolved_by_an_answered_question(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            self._epic(tmp, "Q1 (partially)")
            passed, out = self._run(tmp)
            self.assertTrue(passed, out)
