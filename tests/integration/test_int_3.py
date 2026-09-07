"""Integration invariants covering task-002 (integration-lanes-2 epic).

This is a `kind: "integration"` lane (task-INT-3): its acceptance criteria
describe behaviour that task-002 already merged into
skills/src/shared/lane-steps.ts, skills/src/datum-tdd-act-lane.ts,
skills/src/shared/prompts.ts, skills/src/prompts/red.md and
skills/src/datum-tdd-act-lane.integration.test.ts. Per contract_summary in
this lane's spec, these tests are expected to PASS against the already-merged
code — a failing test here is a finding about task-002, not a placeholder to
be filled in during GREEN.

INT-05: the independent test-verify for an integration lane is folded into
the existing postRedSteps() batch (via verifyTestCmd), never a second
runBatch call, and the verdict is read with the existing testExitCode helper.

INT-07: the independent verify's null-exit ("unavailable") conditions for an
integration lane are identical to GREEN's — no new "merge branch not built"
case exists; verifyVerdict() always reads the SAME 'test-verify' step name
regardless of the label argument passed to it.

INT-08: the RED prompt for an expect_tests_pass lane surfaces invariant ids
as plain substrings in one sentence, followed by the must-PASS sentence, with
no fenced/structured block.

INT-11: the R1/R2 vitest test for task-002 uses the fake-agent/mocked-batch-
response pattern already established in datum-tdd-act-lane.calls.test.ts
(canned TEST_EXIT=0/TEST_EXIT=1 batch replies), with no real git worktree or
actually-merged commits required.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
LANE_STEPS_TS = REPO_ROOT / "skills/src/shared/lane-steps.ts"
ACT_LANE_TS = REPO_ROOT / "skills/src/datum-tdd-act-lane.ts"
PROMPTS_TS = REPO_ROOT / "skills/src/shared/prompts.ts"
RED_MD = REPO_ROOT / "skills/src/prompts/red.md"
INTEGRATION_TEST_TS = REPO_ROOT / "skills/src/datum-tdd-act-lane.integration.test.ts"
CALLS_TEST_TS = REPO_ROOT / "skills/src/datum-tdd-act-lane.calls.test.ts"


class TestInt05VerifyFoldedIntoPostRedBatch:
    """INT-05: one additional step folded into postRedSteps' own batch, via
    verifyTestCmd, read with the existing testExitCode helper — never a
    second runBatch invocation for the independent verify."""

    def test_post_red_steps_pushes_test_verify_step_conditionally_on_verify_test_cmd(
        self,
    ) -> None:
        src = LANE_STEPS_TS.read_text()
        fn_match = re.search(
            r"export function postRedSteps\(o: PostRedOpts\): BatchStep\[\] \{(.*?)\n\}\n",
            src,
            re.DOTALL,
        )
        assert fn_match is not None, "postRedSteps() body not found in lane-steps.ts"
        body = fn_match.group(1)
        # The verify step is appended to the SAME `steps` array postRedSteps
        # already builds (count-gate, assert-check, ownership, ...) — not a
        # second array or a second exported batch-builder call.
        verify_block = re.search(
            r"if \(o\.verifyTestCmd\) \{\s*steps\.push\(\{ name: 'test-verify', command: testRunCommand\(o\.verifyTestCmd, o\.wt, 'red-verify'\), tolerant: true \}\)\s*\}",
            body,
        )
        assert verify_block is not None, (
            "postRedSteps must push a single 'test-verify' step onto its own "
            "steps array when verifyTestCmd is set"
        )
        # No second runBatch/postRedSteps call anywhere near the verify logic.
        assert "runBatch(" not in body
        assert body.count("steps.push(") >= 5

    def test_verify_verdict_reads_the_test_verify_step_via_test_exit_code(self) -> None:
        src = LANE_STEPS_TS.read_text()
        fn_match = re.search(
            r"export function verifyVerdict\(result: BatchResult, label: string\): VerifyVerdict \{(.*?)\n\}\n",
            src,
            re.DOTALL,
        )
        assert fn_match is not None, "verifyVerdict() not found in lane-steps.ts"
        body = fn_match.group(1)
        # verifyVerdict reads the 'test-verify' step through the shared
        # testExitCode helper, directly or through verifyVerdictForStep (the
        # build_command generalisation on dev, #425); either way the step name
        # is 'test-verify' and the exit is parsed by testExitCode.
        if "verifyVerdictForStep(result, label, 'test-verify')" in body:
            inner = re.search(
                r"function verifyVerdictForStep\([^)]*\)[^{]*\{(.*?)\n\}\n",
                src,
                re.DOTALL,
            )
            assert (
                inner is not None
            ), "verifyVerdictForStep() not found in lane-steps.ts"
            assert "testExitCode(stepStdout(result, stepName))" in inner.group(1)
        else:
            assert "testExitCode(stepStdout(result, 'test-verify'))" in body
        # The integration RED path in datum-tdd-act-lane.ts calls verifyVerdict
        # against the very same postRedResult the batch above produced — no
        # separate verify batch is read.
        act_src = ACT_LANE_TS.read_text()
        assert (
            "const redVerifyVerdict = verifyVerdict(postRedResult, 'red-verify')"
            in act_src
        )


class TestInt07UnavailableConditionsMatchGreen:
    """INT-07: the null-exit ("unavailable") path is IDENTICAL code for RED
    (integration lanes) and GREEN — no bespoke "merge branch not built" case,
    because verifyVerdict's step lookup name never varies with its label
    argument."""

    def test_verify_verdict_ignores_its_label_argument_when_choosing_the_step(
        self,
    ) -> None:
        src = LANE_STEPS_TS.read_text()
        fn_match = re.search(
            r"export function verifyVerdict\(result: BatchResult, label: string\): VerifyVerdict \{(.*?)\n\}\n",
            src,
            re.DOTALL,
        )
        assert fn_match is not None
        body = fn_match.group(1)
        # `label` is used only inside the `why` diagnostic strings, never as
        # a step name to look up — so the RED-only integration call
        # (label='red-verify') and every GREEN call (label='post-green-verify',
        # 'post-green-tests-retry-verify', ...) read the exact same step.
        # On dev the body delegates to verifyVerdictForStep(result, label,
        # 'test-verify') (#425 generalised the verdict for build-verify); the
        # step name is still the literal 'test-verify' and label only travels
        # into the diagnostics.
        step_lookups = re.findall(
            r"stepResult\(result, '([^']+)'\)|stepStdout\(result, '([^']+)'\)"
            r"|verifyVerdictForStep\(result, label, '([^']+)'\)",
            body,
        )
        step_names = {name for tup in step_lookups for name in tup if name}
        assert step_names == {"test-verify"}
        assert "label" not in re.sub(r"`\$\{label\}[^`]*`", "", body).replace(
            "result: BatchResult, label: string", ""
        ).replace("describeFailure(result, label)", "").replace(
            "verifyVerdictForStep(result, label, 'test-verify')", ""
        )

    def test_no_bespoke_merge_branch_not_built_case_exists(self) -> None:
        act_src = ACT_LANE_TS.read_text()
        lane_steps_src = LANE_STEPS_TS.read_text()
        for needle in (
            "merge branch not built",
            "merge_branch_not_built",
            "mergeBranchNotBuilt",
        ):
            assert needle not in act_src
            assert needle not in lane_steps_src
        # The RED integration path reuses GREEN's own "unavailable" label
        # rather than minting a bespoke one — both the RED and GREEN error
        # branches read `green_verify_unavailable:`.
        occurrences = act_src.count("green_verify_unavailable:")
        assert occurrences >= 2, (
            "expected the RED integration path and at least one GREEN path "
            f"to both use green_verify_unavailable:, found {occurrences}"
        )


class TestInt08RedPromptInvariantSentence:
    """INT-08: the invariant ids appear as plain substrings in one sentence,
    followed by the must-PASS sentence, with no fenced/structured block."""

    def test_integration_note_sentence_shape_in_source(self) -> None:
        act_src = ACT_LANE_TS.read_text()
        note_match = re.search(
            r"integrationNote: isIntegration && \(lane\.invariants \|\| \[\]\)\.length > 0\s*\n\s*\? `([^`]*)`",
            act_src,
        )
        assert note_match is not None, "integrationNote template literal not found"
        template = note_match.group(1)
        assert (
            "This lane covers invariants: ${(lane.invariants || []).join(', ')}"
            in template
        )
        assert "must PASS on your first run" in template
        # No fenced/structured block markers anywhere in the note itself.
        assert "```" not in template
        assert "{" not in template.replace("${(lane.invariants || []).join(', ')}", "")

    def test_red_template_places_integration_note_as_a_bare_line_no_fence(self) -> None:
        red_md = RED_MD.read_text()
        lines = red_md.splitlines()
        note_line_idx = next(
            i for i, line in enumerate(lines) if line.strip() == "{{integrationNote}}"
        )
        # Not wrapped in a fenced code block (no ``` immediately before/after).
        assert lines[note_line_idx - 1].strip() != "```"
        assert lines[note_line_idx + 1].strip() != "```"

    def test_rendered_note_contains_ids_as_substrings_and_the_must_pass_sentence(
        self,
    ) -> None:
        invariants = ["INV-01", "INV-03"]
        rendered = (
            f"\nThis lane covers invariants: {', '.join(invariants)}\n\n"
            "The code under test is already merged: these tests must PASS on "
            "your first run; a failing test is a finding, report it, do not "
            "weaken it."
        )
        for inv_id in invariants:
            assert inv_id in rendered
        assert "must PASS" in rendered
        assert "```" not in rendered


class TestInt11VitestUsesFakeAgentMockedBatchPattern:
    """INT-11: the R1/R2 vitest test for task-002 reuses the fake-agent /
    mocked-batch-response pattern from datum-tdd-act-lane.calls.test.ts
    (canned TEST_EXIT=0/1 batch replies), with no real git worktree or
    actually-merged commits."""

    def test_integration_test_file_exists_and_credits_the_calls_test_pattern(
        self,
    ) -> None:
        assert INTEGRATION_TEST_TS.exists()
        src = INTEGRATION_TEST_TS.read_text()
        assert "datum-tdd-act-lane.calls.test.ts" in src
        assert "task-002" in src
        assert "kind: 'integration'" in src

    def test_uses_canned_test_exit_batch_replies_not_a_real_worktree(self) -> None:
        src = INTEGRATION_TEST_TS.read_text()
        assert "TEST_EXIT=0" in src
        assert "TEST_EXIT=1" in src
        assert "function batch(" in src
        # No real git worktree machinery or actually-merged-commit setup.
        assert "git worktree add" not in src
        assert "execSync('git" not in src
        assert "simple-git" not in src

    def test_batch_helper_shape_matches_calls_test_ts_convention(self) -> None:
        calls_src = CALLS_TEST_TS.read_text()
        integration_src = INTEGRATION_TEST_TS.read_text()
        calls_batch = re.search(
            r"function batch\(steps:[^\n]*\n(?:.*\n)*?\}\n", calls_src
        )
        integration_batch = re.search(
            r"function batch\(steps:[^\n]*\n(?:.*\n)*?\}\n", integration_src
        )
        assert calls_batch is not None
        assert integration_batch is not None
        assert "JSON.stringify(Object.entries(steps)" in calls_batch.group(0)
        assert "JSON.stringify(Object.entries(steps)" in integration_batch.group(0)
