import { renderPrompt, parseAgentJson } from './shared/utils'
import validateCheckTemplate from './prompts/validate-check.md'
import readContextTemplate from './prompts/util-read-context.md'
import runGateTemplate from './prompts/util-run-gate.md'

export const meta = {
  name: 'datum-validate',
  description: 'Post-Act validation — full test suite, lint, AC completeness check',
  phases: [
    { title: 'Read', detail: 'detect branch, test command, epic dir' },
    { title: 'Validate', detail: 'run tests, lint, check AC coverage' },
    { title: 'Gate', detail: 'run datum gate validate' },
  ],
}

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = (typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})
const yolo: boolean = !!a.yolo
const testCommand: string = a.testCommand || 'uv run pytest -x -q'

// ── Read ──

phase('Read')

const context = await agent(
  renderPrompt(readContextTemplate, { extraFields: '' }),
  { label: 'read-context', model: 'haiku' },
)

const ctx = typeof context === 'string'
  ? parseAgentJson(context as string, {} as Record<string, unknown>)
  : context

const epicDir: string = ctx.epic_dir || 'docs/epics/unknown'
log(`Branch: ${ctx.branch}`)

// ── Validate ──

phase('Validate')

const checkResult = await agent(
  renderPrompt(validateCheckTemplate, {
    wt: '.',
    specPath: `${epicDir}/SPEC.md`,
    tasksPath: 'TASKS.md',
    testCommand,
  }),
  { label: 'validate-check', model: 'sonnet' },
)

const check = typeof checkResult === 'string'
  ? parseAgentJson(checkResult as string, { tests_pass: false, test_count: 0, lint_clean: false, lint_fixes: [], ac_gaps: [] })
  : checkResult

log(`Tests: ${check?.tests_pass ? 'PASS' : 'FAIL'} (${check?.test_count || '?'} tests)`)
log(`Lint: ${check?.lint_clean ? 'clean' : `${(check?.lint_fixes || []).length} files fixed`}`)
if (check?.ac_gaps?.length > 0) {
  log(`AC gaps: ${check.ac_gaps.join('; ')}`)
}

let gatePassed = false

if (!check?.tests_pass) {
  log('VALIDATION FAILED — tests are red. Cannot proceed.')
} else {
  // ── Gate ──

  phase('Gate')

  const gateResult = await agent(
    renderPrompt(runGateTemplate, {
      phase: 'validate',
      flags: yolo ? ' --approve' : '',
    }),
    { label: 'gate-validate', model: 'haiku' },
  )

  const gate = typeof gateResult === 'string'
    ? parseAgentJson(gateResult as string, { passed: false, message: 'parse failure' })
    : gateResult

  gatePassed = !!gate?.passed
  if (gate?.passed) log('Validate gate PASSED')
  else log(`Validate gate: ${gate?.message || 'needs review'}`)
}

export const __workflowResult = {
  branch: ctx.branch,
  testsPassed: !!check?.tests_pass,
  lintClean: !!check?.lint_clean,
  acGaps: check?.ac_gaps || [],
  gatePassed,
}
