// datum-tdd-act.js — Deterministic TDD Act phase orchestration.
//
// Replaces manual RED→GREEN→REFACTOR dispatch with a mechanical
// Workflow script that enforces stage gates, file ownership, and
// dependency ordering via wave-based parallelism.
//
// Pattern: Fan-Out/Fan-In with Saga Compensation
//   - Tasks within a dependency wave run concurrently (parallel)
//   - Each lane is a saga: RED → GREEN → REFACTOR
//   - On failure: log + skip lane (no rollback needed — worktree isolation)
//
// Invocation:
//   Workflow({ name: "datum-tdd-act", args: {
//     lanePlanPath: ".datum/lane-plan.json",
//     epicBranch: "datum/feature-x",
//     runId: "20260613-140000",
//     testCommand: "pytest -q",
//     language: "python",
//   }})

export const meta = {
  name: 'datum-tdd-act',
  description: 'Deterministic TDD Act: RED->GREEN->REFACTOR per lane with gate enforcement',
  phases: [
    { title: 'Topology', detail: 'parse lane-plan.json, BFS wave grouping' },
    { title: 'Setup', detail: 'create per-lane git worktrees' },
    { title: 'Act', detail: 'RED->verify->GREEN->verify->REFACTOR per lane, wave-parallel' },
    { title: 'Merge', detail: 'squash-merge lanes in topological order' },
    { title: 'Cleanup', detail: 'remove worktrees, prune stale refs' },
  ],
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const LANE_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    schema_version: { type: 'string' },
    total_lanes: { type: 'number' },
    topological_order: { type: 'array', items: { type: 'string' } },
    file_ownership: { type: 'object' },
    lanes: { type: 'object' },
  },
  required: ['total_lanes', 'topological_order', 'lanes'],
}

const WORKTREE_MAP_SCHEMA = {
  type: 'object',
  additionalProperties: { type: 'string' },
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verified: { type: 'boolean' },
    stage: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['verified'],
}

const LANE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    status: { type: 'string' },
    stage: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['task_id', 'status'],
}

// ── Wave builder (Kahn's algorithm) ──────────────────────────────────────────

function buildWaves(lanePlan) {
  const lanes = lanePlan.lanes
  const ids = Object.keys(lanes)
  const inDeg = {}
  const adj = {}

  for (const id of ids) {
    const deps = lanes[id].depends_on || []
    inDeg[id] = deps.length
    for (const dep of deps) {
      ;(adj[dep] = adj[dep] || []).push(id)
    }
  }

  const waves = []
  let queue = ids.filter(id => inDeg[id] === 0).sort()

  while (queue.length > 0) {
    waves.push([...queue])
    const next = []
    for (const id of queue) {
      for (const child of adj[id] || []) {
        inDeg[child]--
        if (inDeg[child] === 0) next.push(child)
      }
    }
    queue = next.sort()
  }

  return waves
}

// ── Per-lane TDD saga ────────────────────────────────────────────────────────

async function runLane(taskId, lanePlan, worktreePaths, cfg) {
  const lane = lanePlan.lanes[taskId]
  const wt = worktreePaths[taskId]
  const isStructural = lane.stage === 'structural'

  log(`[${taskId}] Starting: ${lane.title} (${isStructural ? 'structural' : 'behavioral'})`)

  if (isStructural) {
    const r = await runRefactor(taskId, lane, wt, cfg)
    if (!r) return { task_id: taskId, status: 'failed', stage: 'REFACTOR', error: 'refactor failed' }
    return { task_id: taskId, status: 'completed' }
  }

  // ── Skeleton preflight ────────────────────────────────────────────────
  await agent(
    `Run this command in ${wt}:\n` +
    `cd "${wt}" && datum skeleton --task-id ${taskId} --language ${cfg.language} ` +
    `--tasks ${cfg.lanePlanPath} --output .datum/runs/${cfg.runId}/preflight-${taskId}.json\n` +
    `Report the exit code. If it fails, that is okay — skeleton is optional.`,
    { label: `skeleton:${taskId}`, phase: 'Act', model: 'haiku' }
  )

  // ── RED ───────────────────────────────────────────────────────────────
  log(`[${taskId}] RED: writing failing tests`)

  const testFiles = (lane.files || []).filter(f =>
    f.includes('test') || f.includes('Test') || f.includes('spec')
  )
  const implFiles = (lane.files || []).filter(f =>
    !f.includes('test') && !f.includes('Test') && !f.includes('spec')
  )

  await agent(
    `## Role: RED Agent — Write Failing Tests\n\n` +
    `## Working Directory\n${wt}\nALL file operations and commands MUST run from this directory.\n\n` +
    `## Task: ${taskId} — ${lane.title}\n\n` +
    `### Acceptance Criteria\n${(lane.acceptance_criteria || []).map((ac, i) => `${i + 1}. ${ac}`).join('\n')}\n\n` +
    `### RED Note\n${lane.red_note || 'Write a failing test that proves the acceptance criteria are not yet met.'}\n\n` +
    `### Files You May Write To\n${testFiles.map(f => `- ${f}`).join('\n') || '- Any test file for this task'}\n\n` +
    `### Done Condition\nRun: cd "${wt}" && ${cfg.testCommand}\n` +
    `Tests MUST FAIL. If tests pass, rewrite with a genuinely failing assertion.\n` +
    `Commit: git add . && git commit -m "red(${taskId}): <description>"`,
    { label: `red:${taskId}`, phase: 'Act', model: 'sonnet' }
  )

  // ── Verify RED ────────────────────────────────────────────────────────
  const redCheck = await agent(
    `Run this exact command and report the JSON result:\n` +
    `cd "${wt}" && datum verify-stage red --test-command "${cfg.testCommand}"\n` +
    `Return the JSON output verbatim.`,
    { label: `verify-red:${taskId}`, phase: 'Act', model: 'haiku', schema: VERIFY_SCHEMA }
  )

  if (!redCheck || !redCheck.verified) {
    const err = (redCheck && redCheck.error) || 'green_blindness_violation: tests passed after RED'
    log(`[${taskId}] RED FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: err }
  }
  log(`[${taskId}] RED verified — tests correctly failing`)

  // ── Test signal for GREEN brief ───────────────────────────────────────
  const testSignal = await agent(
    `Run the test command in the worktree and capture the output:\n` +
    `cd "${wt}" && ${cfg.testCommand} 2>&1 || true\n` +
    `Return ONLY the test output (compiler errors, assertion messages). ` +
    `Do NOT include test source code or test function names.`,
    { label: `signal:${taskId}`, phase: 'Act', model: 'haiku' }
  )

  // ── GREEN ─────────────────────────────────────────────────────────────
  log(`[${taskId}] GREEN: making tests pass`)

  await agent(
    `## Role: GREEN Agent — Make Tests Pass with Minimum Code\n\n` +
    `## Working Directory\n${wt}\nALL file operations and commands MUST run from this directory.\n\n` +
    `## Task: ${taskId} — ${lane.title}\n\n` +
    `### Acceptance Criteria\n${(lane.acceptance_criteria || []).map((ac, i) => `${i + 1}. ${ac}`).join('\n')}\n\n` +
    `### Files You May Write To (implementation files ONLY — NO test files)\n` +
    `${implFiles.map(f => `- ${f}`).join('\n') || '- Any implementation file for this task'}\n\n` +
    `### What the Test Expects (redacted signal — you do NOT have access to test source)\n` +
    `${testSignal || 'No signal available — implement based on acceptance criteria.'}\n\n` +
    `### Done Condition\nRun: cd "${wt}" && ${cfg.testCommand}\n` +
    `ALL tests MUST PASS. Do not add new tests. Do not edit test files.\n` +
    `Commit: git add . && git commit -m "green(${taskId}): <description>"`,
    { label: `green:${taskId}`, phase: 'Act', model: 'sonnet' }
  )

  // ── Verify GREEN ──────────────────────────────────────────────────────
  const greenCheck = await agent(
    `Run this exact command and report the JSON result:\n` +
    `cd "${wt}" && datum verify-stage green --test-command "${cfg.testCommand}"\n` +
    `Return the JSON output verbatim.`,
    { label: `verify-green:${taskId}`, phase: 'Act', model: 'haiku', schema: VERIFY_SCHEMA }
  )

  if (!greenCheck || !greenCheck.verified) {
    const err = (greenCheck && greenCheck.error) || 'tests still failing after GREEN'
    log(`[${taskId}] GREEN FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: err }
  }
  log(`[${taskId}] GREEN verified — tests passing`)

  // ── REFACTOR ──────────────────────────────────────────────────────────
  const refResult = await runRefactor(taskId, lane, wt, cfg)
  if (!refResult) {
    return { task_id: taskId, status: 'failed', stage: 'REFACTOR', error: 'refactor failed' }
  }

  log(`[${taskId}] Lane complete`)
  return { task_id: taskId, status: 'completed' }
}

async function runRefactor(taskId, lane, wt, cfg) {
  log(`[${taskId}] REFACTOR: cleanup + full AC coverage`)

  await agent(
    `## Role: REFACTOR Agent — Full Correctness + Clean Architecture\n\n` +
    `## Working Directory\n${wt}\nALL file operations and commands MUST run from this directory.\n\n` +
    `## Task: ${taskId} — ${lane.title}\n\n` +
    `### AC Checklist (verify each before marking done)\n` +
    `${(lane.acceptance_criteria || []).map((ac, i) => `- [ ] ${ac}`).join('\n')}\n\n` +
    `### What You May NOT Do\n` +
    `- Remove, rename, or disable a test\n` +
    `- Delete or weaken an assertion\n` +
    `- Add new tests (if missing AC found: log it and STOP)\n\n` +
    `### Done Condition\nALL tests pass. Linter clean. Every AC checked off.\n` +
    `Commit: git add . && git commit -m "refactor(${taskId}): <description>"`,
    { label: `refactor:${taskId}`, phase: 'Act', model: 'sonnet' }
  )

  const check = await agent(
    `Run this exact command and report the JSON result:\n` +
    `cd "${wt}" && datum verify-stage green --test-command "${cfg.testCommand}"\n` +
    `Return the JSON output verbatim.`,
    { label: `verify-refactor:${taskId}`, phase: 'Act', model: 'haiku', schema: VERIFY_SCHEMA }
  )

  if (!check || !check.verified) {
    log(`[${taskId}] REFACTOR verification FAILED: ${check && check.error}`)
    return null
  }
  return check
}

// ── Main workflow ────────────────────────────────────────────────────────────

const lanePlanPath = args.lanePlanPath || '.datum/lane-plan.json'
const epicBranch = args.epicBranch
const runId = args.runId
const testCommand = args.testCommand || 'pytest -q'
const language = args.language || 'python'
const cfg = { lanePlanPath, epicBranch, runId, testCommand, language }

// ── Phase: Topology ──────────────────────────────────────────────────────

phase('Topology')

const lanePlan = await agent(
  `Read the file at ${lanePlanPath} and return its contents as a JSON object. ` +
  `The file is a datum lane-plan with fields: schema_version, total_lanes, ` +
  `topological_order (array of task IDs), file_ownership, lanes (object keyed by task ID). ` +
  `Also read tasks.json in the same directory and merge each task's depends_on array ` +
  `into the corresponding lane entry if not already present. ` +
  `Return the merged result.`,
  { label: 'read-plan', phase: 'Topology', model: 'haiku', schema: LANE_PLAN_SCHEMA }
)

const waves = buildWaves(lanePlan)
log(`Topology: ${lanePlan.total_lanes} lanes in ${waves.length} waves`)
for (let i = 0; i < waves.length; i++) {
  log(`  Wave ${i}: [${waves[i].join(', ')}]`)
}

// ── Phase: Setup ─────────────────────────────────────────────────────────

phase('Setup')

const laneIds = Object.keys(lanePlan.lanes)
const worktreePaths = await agent(
  `Run this command and return the JSON output:\n` +
  `datum worktrees setup --run-id ${runId} --epic-branch ${epicBranch} ` +
  `--lane-ids ${laneIds.join(',')}\n` +
  `The output is a JSON mapping of lane_id to worktree path. Return it verbatim.`,
  { label: 'setup-worktrees', phase: 'Setup', model: 'haiku', schema: WORKTREE_MAP_SCHEMA }
)

log(`Setup: ${laneIds.length} worktrees created`)

// ── Phase: Act ───────────────────────────────────────────────────────────

phase('Act')

const results = {}
const failures = []

for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
  const wave = waves[waveIdx]
  log(`=== Wave ${waveIdx} starting: [${wave.join(', ')}] ===`)

  const waveResults = await parallel(
    wave.map(taskId => () =>
      runLane(taskId, lanePlan, worktreePaths, cfg)
        .then(r => r || { task_id: taskId, status: 'failed', stage: 'UNKNOWN', error: 'null result' })
    )
  )

  for (let i = 0; i < wave.length; i++) {
    const r = waveResults[i]
    results[wave[i]] = r
    if (!r || r.status !== 'completed') {
      failures.push(wave[i])
    }
  }

  const waveSuccesses = wave.length - failures.filter(f => wave.includes(f)).length
  log(`=== Wave ${waveIdx} complete: ${waveSuccesses}/${wave.length} succeeded ===`)
}

// ── Phase: Merge ─────────────────────────────────────────────────────────

phase('Merge')

const completedLanes = Object.entries(results)
  .filter(([_, r]) => r && r.status === 'completed')
  .map(([id]) => id)

if (completedLanes.length === 0) {
  log('No lanes completed — skipping merge')
} else {
  const mergeOrder = lanePlan.topological_order.filter(id => completedLanes.includes(id))

  await agent(
    `Run this command:\n` +
    `datum worktrees merge --epic-branch ${epicBranch} ` +
    `--lane-order ${mergeOrder.join(',')} ` +
    `--commit-message "act(${runId}): merge ${completedLanes.length} lanes"`,
    { label: 'merge-lanes', phase: 'Merge', model: 'haiku' }
  )

  log(`Merged ${completedLanes.length} lanes: [${mergeOrder.join(', ')}]`)
}

// ── Phase: Cleanup ───────────────────────────────────────────────────────

phase('Cleanup')

await agent(
  `Run this command:\n` +
  `datum worktrees cleanup --run-id ${runId} --epic-branch ${epicBranch}`,
  { label: 'cleanup', phase: 'Cleanup', model: 'haiku' }
)

if (failures.length > 0) {
  log(`\nFailed lanes: [${failures.join(', ')}]`)
  for (const fid of failures) {
    const r = results[fid]
    if (r) log(`  ${fid}: ${r.stage} — ${r.error}`)
  }
}

log(`\nAct phase complete: ${completedLanes.length}/${lanePlan.total_lanes} succeeded, ${failures.length} failed`)

return {
  runId,
  total: lanePlan.total_lanes,
  completed: completedLanes.length,
  failed: failures.length,
  failedLanes: failures,
  completedLanes,
}
