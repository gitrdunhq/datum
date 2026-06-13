// datum-tdd-act.js — Deterministic TDD Act phase orchestration.
//
// Pattern: Fan-Out/Fan-In with Saga Compensation
// Contract: JSON packets in, structured JSON out, no prose briefs.
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

const STAGE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    commit_sha: { type: 'string' },
    files_written: { type: 'array', items: { type: 'string' } },
    failure_reason: { type: 'string' },
  },
  required: ['committed'],
}

const SIGNAL_SCHEMA = {
  type: 'object',
  properties: {
    exit_code: { type: 'number' },
    errors: { type: 'array', items: { type: 'string' } },
    assertion_messages: { type: 'array', items: { type: 'string' } },
  },
  required: ['exit_code'],
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

// ── File classification ──────────────────────────────────────────────────────

function classifyFiles(files) {
  const testFiles = (files || []).filter(f =>
    f.includes('test') || f.includes('Test') || f.includes('spec')
  )
  const implFiles = (files || []).filter(f =>
    !f.includes('test') && !f.includes('Test') && !f.includes('spec')
  )
  return { testFiles, implFiles }
}

// ── JSON packet builder ─────────────────────────────────────────────────────
// Machines receive JSON packets. Prompts contain instructions only — not data.

function buildPacket(taskId, lane, wt, cfg, stage, extras) {
  const { testFiles, implFiles } = classifyFiles(lane.files)
  return {
    schema_version: '1.0',
    task_id: taskId,
    stage,
    title: lane.title,
    working_directory: wt,
    test_command: cfg.testCommand,
    acceptance_criteria: lane.acceptance_criteria || [],
    red_note: lane.red_note || '',
    allowed_write_files: stage === 'RED' ? testFiles
      : stage === 'GREEN' ? implFiles
      : [...testFiles, ...implFiles],
    forbidden_write_files: stage === 'RED' ? implFiles
      : stage === 'GREEN' ? testFiles
      : [],
    commit_prefix: stage === 'RED' ? `red(${taskId})`
      : stage === 'GREEN' ? `green(${taskId})`
      : `refactor(${taskId})`,
    ...extras,
  }
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
    `cd "${wt}" && datum skeleton --task-id ${taskId} --language ${cfg.language} ` +
    `--tasks ${cfg.lanePlanPath} --output .datum/runs/${cfg.runId}/preflight-${taskId}.json 2>&1 || true`,
    { label: `skeleton:${taskId}`, phase: 'Act', model: 'haiku', agentType: 'datum-cli' }
  )

  // ── RED ───────────────────────────────────────────────────────────────
  log(`[${taskId}] RED: writing failing tests`)

  const redPacket = buildPacket(taskId, lane, wt, cfg, 'RED', {})

  await agent(
    `${writeLaneContextCmd(redPacket, wt)}`,
    { label: `ctx-red:${taskId}`, phase: 'Act', model: 'haiku', agentType: 'datum-cli' }
  )

  const red = await agent(
    `TASK PACKET: ${JSON.stringify(redPacket)}`,
    { label: `red:${taskId}`, phase: 'Act', model: 'sonnet', schema: STAGE_RESULT_SCHEMA, agentType: 'datum-red' }
  )

  if (!red || !red.committed) {
    const err = (red && red.failure_reason) || 'RED agent did not commit'
    log(`[${taskId}] RED FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: err }
  }

  // ── Verify RED ────────────────────────────────────────────────────────
  const redCheck = await agent(
    `cd "${wt}" && datum verify-stage red --test-command "${cfg.testCommand}"\nReturn the JSON output.`,
    { label: `verify-red:${taskId}`, phase: 'Act', model: 'haiku', schema: VERIFY_SCHEMA, agentType: 'datum-cli' }
  )

  if (!redCheck || !redCheck.verified) {
    const err = (redCheck && redCheck.error) || 'green_blindness_violation: tests passed after RED'
    log(`[${taskId}] RED FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: err }
  }
  log(`[${taskId}] RED verified`)

  // ── Test signal for GREEN ─────────────────────────────────────────────
  const signal = await agent(
    `cd "${wt}" && ${cfg.testCommand} 2>&1 || true\n` +
    `Extract: exit_code, error messages, assertion failure messages. No test source code.`,
    { label: `signal:${taskId}`, phase: 'Act', model: 'haiku', schema: SIGNAL_SCHEMA, agentType: 'datum-cli' }
  )

  // ── GREEN ─────────────────────────────────────────────────────────────
  log(`[${taskId}] GREEN: making tests pass`)

  const greenPacket = buildPacket(taskId, lane, wt, cfg, 'GREEN', {
    test_signal: signal,
  })

  await agent(
    `${writeLaneContextCmd(greenPacket, wt)}`,
    { label: `ctx-green:${taskId}`, phase: 'Act', model: 'haiku', agentType: 'datum-cli' }
  )

  const green = await agent(
    `TASK PACKET: ${JSON.stringify(greenPacket)}`,
    { label: `green:${taskId}`, phase: 'Act', model: 'sonnet', schema: STAGE_RESULT_SCHEMA, agentType: 'datum-green' }
  )

  if (!green || !green.committed) {
    const err = (green && green.failure_reason) || 'GREEN agent did not commit'
    log(`[${taskId}] GREEN FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: err }
  }

  // ── Verify GREEN ──────────────────────────────────────────────────────
  const greenCheck = await agent(
    `cd "${wt}" && datum verify-stage green --test-command "${cfg.testCommand}"\nReturn the JSON output.`,
    { label: `verify-green:${taskId}`, phase: 'Act', model: 'haiku', schema: VERIFY_SCHEMA, agentType: 'datum-cli' }
  )

  if (!greenCheck || !greenCheck.verified) {
    const err = (greenCheck && greenCheck.error) || 'tests still failing after GREEN'
    log(`[${taskId}] GREEN FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: err }
  }
  log(`[${taskId}] GREEN verified`)

  // ── File ownership check ──────────────────────────────────────────────
  const { testFiles, implFiles } = classifyFiles(lane.files)
  const allAllowed = new Set([...testFiles, ...implFiles])
  const writtenFiles = [...(red.files_written || []), ...(green.files_written || [])]
  const violations = writtenFiles.filter(f => !allAllowed.has(f))
  if (violations.length > 0) {
    log(`[${taskId}] FILE OWNERSHIP VIOLATION: ${violations.join(', ')}`)
  }

  // ── REFACTOR ──────────────────────────────────────────────────────────
  const refResult = await runRefactor(taskId, lane, wt, cfg)
  if (!refResult) {
    return { task_id: taskId, status: 'failed', stage: 'REFACTOR', error: 'refactor failed' }
  }

  log(`[${taskId}] Lane complete`)
  return { task_id: taskId, status: 'completed' }
}

async function runRefactor(taskId, lane, wt, cfg) {
  log(`[${taskId}] REFACTOR`)

  const refactorPacket = buildPacket(taskId, lane, wt, cfg, 'REFACTOR', {})

  await agent(
    `${writeLaneContextCmd(refactorPacket, wt)}`,
    { label: `ctx-refactor:${taskId}`, phase: 'Act', model: 'haiku', agentType: 'datum-cli' }
  )

  const refactor = await agent(
    `TASK PACKET: ${JSON.stringify(refactorPacket)}`,
    { label: `refactor:${taskId}`, phase: 'Act', model: 'sonnet', schema: STAGE_RESULT_SCHEMA, agentType: 'datum-refactor' }
  )

  if (!refactor || !refactor.committed) {
    log(`[${taskId}] REFACTOR FAILED: ${refactor && refactor.failure_reason}`)
    return null
  }

  const check = await agent(
    `cd "${wt}" && datum verify-stage green --test-command "${cfg.testCommand}"\nReturn the JSON output.`,
    { label: `verify-refactor:${taskId}`, phase: 'Act', model: 'haiku', schema: VERIFY_SCHEMA, agentType: 'datum-cli' }
  )

  if (!check || !check.verified) {
    log(`[${taskId}] REFACTOR verification FAILED: ${check && check.error}`)
    return null
  }
  return check
}

// ── Lane context writer ─────────────────────────────────────────────────────
// Writes .datum/lane-context.json before each agent dispatch so hooks can
// mechanically enforce file ownership, commit format, and test ratchet.

function writeLaneContextCmd(packet, wt) {
  const ctx = JSON.stringify({
    task_id: packet.task_id,
    stage: packet.stage,
    allowed_write_files: packet.allowed_write_files,
    forbidden_write_files: packet.forbidden_write_files,
    commit_prefix: packet.commit_prefix,
    test_count_floor: 0,
  })
  return `mkdir -p "${wt}/.datum" && printf '%s' '${ctx.replace(/'/g, "'\\''")}' > "${wt}/.datum/lane-context.json"`
}

// ── Main workflow ────────────────────────────────────────────────────────────

const a = (typeof args === 'string') ? JSON.parse(args) : (args || {})
const lanePlanPath = a.lanePlanPath || '.datum/lane-plan.json'
const epicBranch = a.epicBranch
const runId = a.runId
const testCommand = a.testCommand || 'pytest -q'
const language = a.language || 'python'
const cfg = { lanePlanPath, epicBranch, runId, testCommand, language }

if (!epicBranch) throw new Error('args.epicBranch is required')
if (!runId) throw new Error('args.runId is required')

// ── Phase: Topology ──────────────────────────────────────────────────────

phase('Topology')

const lanePlan = await agent(
  `Read ${lanePlanPath} and return its contents as JSON. This is the SOLE source of truth — do NOT read tasks.json or any other file.`,
  { label: 'read-plan', phase: 'Topology', model: 'haiku', schema: LANE_PLAN_SCHEMA, agentType: 'datum-reader' }
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
  `datum worktrees setup --run-id ${runId} --epic-branch ${epicBranch} --lane-ids ${laneIds.join(',')}\nReturn the JSON output.`,
  { label: 'setup-worktrees', phase: 'Setup', model: 'haiku', schema: WORKTREE_MAP_SCHEMA, agentType: 'datum-cli' }
)

const validPaths = Object.values(worktreePaths || {}).filter(Boolean)
if (validPaths.length === 0) throw new Error('Setup failed: no worktree paths returned')

log(`Setup: ${laneIds.length} worktrees created`)

// ── Phase: Act ───────────────────────────────────────────────────────────

phase('Act')

const results = {}
const failures = []

for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
  const wave = waves[waveIdx]
  log(`=== Wave ${waveIdx}: [${wave.join(', ')}] ===`)

  const waveResults = await parallel(
    wave.map(taskId => () =>
      runLane(taskId, lanePlan, worktreePaths, cfg)
        .then(r => r || { task_id: taskId, status: 'failed', stage: 'UNKNOWN', error: 'null result' })
    )
  )

  for (let i = 0; i < wave.length; i++) {
    const r = waveResults[i]
    results[wave[i]] = r
    if (!r || r.status !== 'completed') failures.push(wave[i])
  }

  const ok = wave.length - failures.filter(f => wave.includes(f)).length
  log(`=== Wave ${waveIdx} done: ${ok}/${wave.length} ===`)
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
    `datum worktrees merge --epic-branch ${epicBranch} --lane-order ${mergeOrder.join(',')} ` +
    `--commit-message "act(${runId}): merge ${completedLanes.length} lanes"`,
    { label: 'merge-lanes', phase: 'Merge', model: 'haiku', agentType: 'datum-cli' }
  )

  log(`Merged ${completedLanes.length} lanes: [${mergeOrder.join(', ')}]`)
}

// ── Phase: Cleanup ───────────────────────────────────────────────────────

phase('Cleanup')

await agent(
  `datum worktrees cleanup --run-id ${runId} --epic-branch ${epicBranch}`,
  { label: 'cleanup', phase: 'Cleanup', model: 'haiku', agentType: 'datum-cli' }
)

if (failures.length > 0) {
  log(`Failed lanes: [${failures.join(', ')}]`)
  for (const fid of failures) {
    const r = results[fid]
    if (r) log(`  ${fid}: ${r.stage} — ${r.error}`)
  }
}

log(`Act complete: ${completedLanes.length}/${lanePlan.total_lanes} succeeded, ${failures.length} failed`)

return {
  runId,
  total: lanePlan.total_lanes,
  completed: completedLanes.length,
  failed: failures.length,
  failedLanes: failures,
  completedLanes,
}
