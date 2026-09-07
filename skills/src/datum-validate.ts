import { renderPrompt, parseAgentJson, parseValidateArgs, evaluateMainSync, testRunCommand } from './shared/utils'
import type { MainSyncResult } from './shared/utils'
import { model, DEFAULT_CONFIG } from './shared/models'
import { stageOpts, bootstrapOpts, configureAgentTypes, readAgentTypeConfig } from './shared/agent-types'
import { batchCommandPrompt, setBatchCacheKey, setBatchRoot, parseBatchResult, stepStdout, describeFailure } from './shared/batch'
import { testExitCode } from './shared/lane-steps'
import { validateVerifySteps } from './shared/validate-steps'
import { mainSyncSteps, mainSyncFromSteps } from './shared/main-sync-steps'
import { runBatch } from './shared/agents'
import { configReadSteps, configFromSteps } from './shared/config-steps'
import validateCheckTemplate from './prompts/validate-check.md'
import { gateSteps, parseGateResult } from './shared/gate'

export const meta = {
  name: 'datum-validate',
  description: 'Post-Act validation — full test suite, lint, AC completeness check',
  phases: [
    { title: 'Validate', detail: 'sync with main, run tests, lint, AC coverage, gate' },
  ],
}

// Args: "yolo", "--no-merge-main", "yolo --no-merge-main", or JSON
// {yolo, noMergeMain, testCommand}. By default origin/main is merged into the
// epic branch before the suite runs (#358); --no-merge-main turns that into a
// loud failure when the epic is behind main instead.
const a = parseValidateArgs(args)
const yolo: boolean = a.yolo
const noMergeMain: boolean = a.noMergeMain
// #368: the parent's switches are honoured BEFORE the first agent() call.
if (a.agentTypes && typeof a.agentTypes === 'object') configureAgentTypes(a.agentTypes as Record<string, boolean>)
// Resume cache key (#354): the final gate re-runs after a human edit.
setBatchCacheKey(typeof a.configFingerprint === 'string' ? a.configFingerprint : '')
setBatchRoot(typeof a.repoRoot === 'string' ? a.repoRoot : '')

let repoCfg: Record<string, string> = {}
if (!a.testCommand) {
  const configReadStepList = configReadSteps()
  const configBatch = await runBatch(configReadStepList, bootstrapOpts('cli', { label: 'read-config', model: model('fast') }))
  repoCfg = configFromSteps(configBatch) as unknown as Record<string, string>
}
// Standalone run (no parent args): the repo config, else the defaults.
if (!(a.agentTypes && typeof a.agentTypes === 'object')) configureAgentTypes(readAgentTypeConfig(repoCfg))
const testCommand: string = a.testCommand || repoCfg.test_command || DEFAULT_CONFIG.test_command

// ── Validate (collapsed: read-context fields embedded, one substantive agent + gate) ──

phase('Validate')

// ── Main sync (#358) ─────────────────────────────────────────────────────
// A full-suite failure was labelled "pre-existing" because the baseline was
// the epic branch itself — a bug introduced on the epic and already fixed on
// main was never seen. Fetch main and merge it in (default), or fail loudly
// when --no-merge-main is set and the epic is behind.
// Data-driven: no origin remote is a named skip, the base branch comes from
// origin/HEAD (or main_branch in .datum/config.json), and a runner refusal
// is retried once and named (elonchesd wf_c17266bb-33a).
const syncSteps = mainSyncSteps(noMergeMain, repoCfg.main_branch)
const syncBatch = await runBatch(syncSteps, stageOpts('cli', { label: 'main-sync', model: model('fast') }))
let syncResult: MainSyncResult | null = null
let mainSync: { ok: boolean; message: string }
try {
  syncResult = mainSyncFromSteps(syncBatch, noMergeMain)
  mainSync = evaluateMainSync(syncResult, noMergeMain)
} catch (exc) {
  // A missing batch or a failed fetch is a named failure — never "treat as
  // in sync" (mainSyncFromSteps throws main_sync_failed: ...).
  mainSync = { ok: false, message: (exc as Error).message }
}
if (!mainSync.ok) {
  log(`VALIDATION FAILED — ${mainSync.message}`)
} else {
  log(`Main sync: ${mainSync.message}`)
}

// Validate agent reads context itself (collapsed read-context)
const checkResult = !mainSync.ok ? null : await agent(
  `First: determine the branch with \`git rev-parse --abbrev-ref HEAD\` and set epic_dir to docs/epics/$(git rev-parse --abbrev-ref HEAD).

Then perform validation:
${renderPrompt(validateCheckTemplate, {
    wt: '.',
    specPath: 'docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md',
    tasksPath: 'docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md',
    testCommand,
    testRunCmd: testRunCommand(testCommand, '.', 'validate'),
  })}`,
  { label: 'validate-check', model: model('balanced') },
)

// Safe: gatePassed/testsPassed below never read `check.tests_pass` — they
// come from the independent `testExit` re-run — so an unparseable
// validate-check result only degrades the lint/AC-gap telemetry logged and
// returned in __workflowResult, never the pass/fail verdict itself.
const check = typeof checkResult === 'string'
  ? parseAgentJson(checkResult as string, { tests_pass: false, test_count: 0, lint_clean: false, lint_fixes: [], ac_gaps: [] })
  : checkResult

// ── Deterministic test-verify (green-blindness gate, mirrors RED's post-red
// batch) ───────────────────────────────────────────────────────────────────
// The validate-check agent above self-reports tests_pass from a run IT
// performed and read the exit status from — a hallucinated or mistaken
// "tests_pass: true" would sail through undetected, and this is the FINAL
// gate of the whole pipeline. Re-run the exact same test command
// independently as one deterministic datum-cli batch step and trust ONLY
// that exit code, never the agent's self-report.
// The batch also PRODUCES .datum/last-test-signal.json from the same shell
// (`datum gate validate` consumes it — it had no producer before).
const verifySteps = validateVerifySteps(testCommand, '.')
const verifyRaw = !mainSync.ok ? null : await agent(
  batchCommandPrompt(verifySteps),
  stageOpts('cli', { label: 'validate-verify', phase: 'Validate', model: model('fast') }),
)
const verifyResult = parseBatchResult(verifyRaw, verifySteps)
const testExit = mainSync.ok ? testExitCode(stepStdout(verifyResult, 'test-verify')) : null
const testsPassed = testExit === 0

log(`Tests: ${testsPassed ? 'PASS' : 'FAIL'} (independent run exit=${testExit === null ? 'n/a' : testExit}; agent self-report tests_pass=${!!check?.tests_pass}, ${check?.test_count || '?'} tests)`)
log(`Lint: ${check?.lint_clean ? 'clean' : `${(check?.lint_fixes || []).length} files fixed`}`)
if (check?.ac_gaps?.length > 0) log(`AC gaps: ${check.ac_gaps.join('; ')}`)

let gatePassed = false
// datum-go reads these on every validate halt path (phase review wf_9a69f891-462).
let gateMessage = ''
let gateNeedsHuman = false
let hardStop = false

if (!mainSync.ok) {
  gateMessage = `main_sync: ${mainSync.message || 'epic branch is not in sync with main'}`
  log('Validate gate skipped — epic branch is not in sync with main.')
} else if (testExit === null) {
  gateMessage = `validate_run_failed: independent test run did not execute (${describeFailure(verifyResult, 'test-verify')})`
  log(`VALIDATION FAILED — ${gateMessage}. Cannot proceed.`)
} else if (testExit !== 0) {
  gateMessage = `tests red: independent run exited ${testExit}${check?.tests_pass ? ', despite agent self-report of tests_pass=true' : ''}`
  log(`VALIDATION FAILED — ${gateMessage}. Cannot proceed.`)
} else {
  // Deterministic: the verdict is `datum gate`'s exit code read from a batch
  // step (shared/gate.ts), not an LLM's echo of its JSON.
  const gateStepList = gateSteps('validate', yolo ? ' --approve' : '')
  const gate = parseGateResult(await runBatch(gateStepList, stageOpts('cli', { label: 'gate', model: model('fast') })))
  gatePassed = gate.passed
  gateMessage = gate.message || ''
  gateNeedsHuman = !!gate.needsHuman
  hardStop = !!gate.hardStop
  if (gate.passed) log('Validate gate PASSED')
  else log(`Validate gate: ${gate.message || 'needs review'}${gate.needsHuman ? ' (needs human approval)' : ''}${gate.hardStop ? ' (hard stop)' : ''}`)
}

export const __workflowResult = {
  testsPassed, testExitCode: testExit, lintClean: !!check?.lint_clean,
  acGaps: check?.ac_gaps || [], gatePassed,
  gateMessage: gateMessage,
  gateNeedsHuman: gateNeedsHuman,
  hardStop: hardStop,
  mainSync: { ok: mainSync.ok, behind: syncResult?.behind ?? null, merged: !!syncResult?.merged, message: mainSync.message },
}
