import { renderPrompt, parseAgentJson } from './shared/utils'
import { model, READ_CONFIG_PROMPT, DEFAULT_CONFIG } from './shared/models'
import validateCheckTemplate from './prompts/validate-check.md'
import readContextTemplate from './prompts/util-read-context.md'
import runGateTemplate from './prompts/util-run-gate.md'

export const meta = {
  name: 'datum-validate',
  description: 'Post-Act validation — full test suite, lint, AC completeness check',
  phases: [
    { title: 'Validate', detail: 'run tests, lint, AC coverage, gate' },
  ],
}

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = (typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})
const yolo: boolean = !!a.yolo

const cfgText = !a.testCommand
  ? await agent(READ_CONFIG_PROMPT, { label: 'read-config', model: model('fast') })
  : null
const repoCfg = cfgText ? parseAgentJson(cfgText, { ...DEFAULT_CONFIG }) as Record<string, string> : {}
const testCommand: string = a.testCommand || repoCfg.test_command || DEFAULT_CONFIG.test_command

// ── Dependency-cruiser validation: compare planned graph vs actual imports ──
phase('Validate')

// Read dependencies.json if it exists
const epicBranch = await agent(
  `Run: git rev-parse --abbrev-ref HEAD
Return ONLY the branch name. No other text.`,
  { label: 'validate-branch', model: model('fast') },
)
const branchName = String(epicBranch).trim()
const epicDir = `docs/epics/${branchName}`
const depsPath = `${epicDir}/dependencies.json`

let plannedDeps: Record<string, string[]> = {}
let depValidation: { graph_matches: boolean; new_circular: string[]; unexpected_imports: string[]; planned_edges: number; actual_edges: number } | null = null

try {
  const depsContent = await agent(
    `Read the file: cat "${depsPath}" 2>/dev/null || echo ""
If the file does not exist or is empty, return exactly: MISSING
No markdown fences, no explanation.`,
    { label: 'validate-deps-read', model: model('fast') },
  )

  if (depsContent && depsContent.trim() !== 'MISSING') {
    const depsParsed = parseAgentJson(depsContent as string, { schema_version: '1.0', dependencies: {} })
    plannedDeps = depsParsed.dependencies || {}

    // Run dependency-cruiser to extract actual imports
    const depCruiseResult = await agent(
      `Run: npx depcruise "${wt}/src" --output-within --output-to json 2>/dev/null || echo '{"dependencies":[]}'
Then read the output and match each dependency against the planned edges.
Return JSON: {"graph_matches": true/false, "new_circular": [], "unexpected_imports": [], "planned_edges": N, "actual_edges": N}

If depcruise is not available, return: {"graph_matches": true, "new_circular": [], "unexpected_imports": [], "planned_edges": 0, "actual_edges": 0, "note": "depcruise not available"}

Planned edges:
${Object.entries(plannedDeps).map(([file, deps]) => `  ${file} -> ${deps.join(', ')}`).join('\n') || '  (none)'}

Current actual dependencies from depcruise output:
{{DEPCRUNSE_OUTPUT}}`,
      { label: 'validate-depcruise', model: model('fast') },
    )

    depValidation = parseAgentJson(depCruiseResult as string, {
      graph_matches: true,
      new_circular: [],
      unexpected_imports: [],
      planned_edges: 0,
      actual_edges: 0,
    })

    if (!depValidation?.graph_matches) {
      log(`DEPENDENCY GRAPH MISMATCH: ${depValidation.unexpected_imports.length} unexpected imports, ${depValidation.new_circular.length} new circular deps`)
    } else {
      log(`Dependency graph: matches plan (${depValidation.actual_edges} edges)`)
    }
  }
} catch (e) {
  log(`Dependency validation skipped: ${String(e)}`)
}

// Validate agent reads context itself (collapsed read-context)
const checkResult = await agent(
  `First: determine the branch with \`git rev-parse --abbrev-ref HEAD\` and set epic_dir to docs/epics/<branch>.

Then perform validation:
${renderPrompt(validateCheckTemplate, {
    wt: '.',
    specPath: 'docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md',
    tasksPath: 'TASKS.md',
    testCommand,
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

if (!check?.tests_pass) {
  log('VALIDATION FAILED — tests are red. Cannot proceed.')
} else {
  const gateResult = await agent(
    renderPrompt(runGateTemplate, { phase: 'validate', flags: yolo ? ' --approve' : '' }),
    { label: 'gate', model: model('fast') },
  )
  const gate = typeof gateResult === 'string' ? parseAgentJson(gateResult as string, { passed: false }) : gateResult
  gatePassed = !!gate?.passed
  if (gate?.passed) log('Validate gate PASSED')
  else log(`Validate gate: ${gate?.message || 'needs review'}`)
}

export const __workflowResult = {
  testsPassed: !!check?.tests_pass, lintClean: !!check?.lint_clean,
  acGaps: check?.ac_gaps || [], gatePassed,
  dependencyGraphValid: depValidation?.graph_matches ?? true,
  depValidation,
}
