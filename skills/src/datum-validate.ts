import { renderPrompt, parseAgentJson, parseValidateArgs, mainSyncPrompt, evaluateMainSync, testRunCommand } from './shared/utils'
import type { MainSyncResult } from './shared/utils'
import { model, READ_CONFIG_PROMPT, DEFAULT_CONFIG } from './shared/models'
import { stageOpts, configureAgentTypes, readAgentTypeConfig } from './shared/agent-types'
import validateCheckTemplate from './prompts/validate-check.md'
import readContextTemplate from './prompts/util-read-context.md'
import runGateTemplate from './prompts/util-run-gate.md'

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

const cfgText = !a.testCommand
  ? await agent(READ_CONFIG_PROMPT, stageOpts('reader', { label: 'read-config', model: model('fast') }))
  : null
const repoCfg = cfgText ? parseAgentJson(cfgText, { ...DEFAULT_CONFIG }) as unknown as Record<string, string> : {}
// #368: args (from datum-go) win, else the repo config, else the defaults.
configureAgentTypes(a.agentTypes && typeof a.agentTypes === 'object' ? a.agentTypes as Record<string, boolean> : readAgentTypeConfig(repoCfg))
const testCommand: string = a.testCommand || repoCfg.test_command || DEFAULT_CONFIG.test_command

// ── Validate (collapsed: read-context fields embedded, one substantive agent + gate) ──

phase('Validate')

// ── Main sync (#358) ─────────────────────────────────────────────────────
// A full-suite failure was labelled "pre-existing" because the baseline was
// the epic branch itself — a bug introduced on the epic and already fixed on
// main was never seen. Fetch main and merge it in (default), or fail loudly
// when --no-merge-main is set and the epic is behind.
const syncRaw = await agent(mainSyncPrompt(noMergeMain), stageOpts('cli', { label: 'main-sync', model: model('fast') }))
const syncResult = typeof syncRaw === 'string'
  ? parseAgentJson<MainSyncResult | null>(syncRaw as string, null)
  : (syncRaw as MainSyncResult | null)
const mainSync = evaluateMainSync(syncResult, noMergeMain)
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

const check = typeof checkResult === 'string'
  ? parseAgentJson(checkResult as string, { tests_pass: false, test_count: 0, lint_clean: false, lint_fixes: [], ac_gaps: [] })
  : checkResult

log(`Tests: ${check?.tests_pass ? 'PASS' : 'FAIL'} (${check?.test_count || '?'} tests)`)
log(`Lint: ${check?.lint_clean ? 'clean' : `${(check?.lint_fixes || []).length} files fixed`}`)
if (check?.ac_gaps?.length > 0) log(`AC gaps: ${check.ac_gaps.join('; ')}`)

let gatePassed = false

if (!mainSync.ok) {
  log('Validate gate skipped — epic branch is not in sync with main.')
} else if (!check?.tests_pass) {
  log('VALIDATION FAILED — tests are red. Cannot proceed.')
} else {
  const gateResult = await agent(
    renderPrompt(runGateTemplate, { phase: 'validate', flags: yolo ? ' --approve' : '' }),
    stageOpts('cli', { label: 'gate', model: model('fast') }),
  )
  const gate = typeof gateResult === 'string' ? parseAgentJson(gateResult as string, { passed: false }) : gateResult
  gatePassed = !!gate?.passed
  if (gate?.passed) log('Validate gate PASSED')
  else log(`Validate gate: ${gate?.message || 'needs review'}`)
}

export const __workflowResult = {
  testsPassed: !!check?.tests_pass, lintClean: !!check?.lint_clean,
  acGaps: check?.ac_gaps || [], gatePassed,
  mainSync: { ok: mainSync.ok, behind: syncResult?.behind ?? null, merged: !!syncResult?.merged, message: mainSync.message },
}
