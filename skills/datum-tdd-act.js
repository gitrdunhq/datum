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
    { title: 'Docs', detail: 'sync project documentation with code changes' },
    { title: 'Cleanup', detail: 'remove worktrees, prune stale refs' },
    { title: 'Triage', detail: 'analyze failures, auto-file issues on the board' },
  ],
}

// ── Schemas ──────────────────────────────────────────────────────────────────

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

const REFLECT_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    reasoning: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['score', 'reasoning'],
}

const SKEPTIC_SCHEMA = {
  type: 'object',
  properties: {
    bugs_found: { type: 'array', items: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        evidence: { type: 'string' },
        severity: { type: 'string' },
      },
      required: ['description'],
    }},
    confidence: { type: 'number' },
    verdict: { type: 'string', enum: ['PASS', 'FRAGILE', 'BROKEN'] },
  },
  required: ['verdict'],
}

const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        category: { type: 'string', enum: ['workflow-bug', 'lane-plan', 'agent-behavior', 'infrastructure', 'test-quality'] },
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        body: { type: 'string' },
        lane: { type: 'string' },
        stage: { type: 'string' },
      },
      required: ['title', 'category', 'body'],
    }},
  },
  required: ['issues'],
}

const REFACTOR_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    should_refactor: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['should_refactor'],
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

// ── Text-to-JSON parser for datum-cli agents ───────────────────────────────

function parseAgentJson(text, fallback) {
  if (!text || typeof text !== 'string') return fallback || null
  const cleaned = text.replace(/```[a-z]*\n?/g, '').trim()
  const start = cleaned.search(/[{[]/)
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
  if (start === -1 || end === -1) return fallback || null
  try { return JSON.parse(cleaned.slice(start, end + 1)) }
  catch { return fallback || null }
}

// ── Lane context shell command builder ─────────────────────────────────────

function laneCtxCmd(packet, wt) {
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

// ── JSON packet builder ─────────────────────────────────────────────────────

function buildPacket(taskId, testFiles, implFiles, lane, wt, cfg, stage, extras) {
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

  // #5: compute once per lane
  const { testFiles, implFiles } = classifyFiles(lane.files)
  const acStr = (lane.acceptance_criteria || []).join('\n')

  // Per-lane test command: only run THIS lane's test files, not the global set
  const laneTestCmd = testFiles.length > 0
    ? `uv run pytest ${testFiles.join(' ')} -x -q`
    : cfg.testCommand
  const laneCfg = { ...cfg, testCommand: laneTestCmd }

  log(`[${taskId}] Starting: ${lane.title} (${isStructural ? 'structural' : 'behavioral'})`)

  if (isStructural) {
    const r = await runRefactor(taskId, lane, testFiles, implFiles, wt, laneCfg)
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

  const redPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'RED', {})
  const redPacketStr = JSON.stringify(redPacket)
  const redCtxCmd = laneCtxCmd(redPacket, wt)

  let red = await agent(
    `You are a RED TDD agent. Write FAILING tests for the acceptance criteria.\n` +
    `SETUP (run first): ${redCtxCmd}\n` +
    `TASK PACKET: ${redPacketStr}\n\n` +
    `CRITICAL RULES:\n` +
    `- cd into working_directory before any operation\n` +
    `- APPEND new test functions — NEVER delete existing tests\n` +
    `- NEVER use raise NotImplementedError — conftest will xfail it and tests pass (green blindness)\n` +
    `- Instead, CALL the actual methods that don't exist yet (e.g., result.to_dict()) — AttributeError is the correct RED failure\n` +
    `- Run test_command — your new tests MUST FAIL with AttributeError or AssertionError\n` +
    `- Commit with message: "${redPacket.commit_prefix}: <description>"`,
    { label: `red:${taskId}`, phase: 'Act', model: 'sonnet', schema: STAGE_RESULT_SCHEMA }
  )

  if (!red || !red.committed) {
    log(`[${taskId}] RED attempt 1 failed, retrying with hint`)
    red = await agent(
      `SETUP (run first): ${redCtxCmd}\n` +
      `TASK PACKET: ${redPacketStr}\n\n` +
      `RETRY HINT: Previous attempt failed (${(red && red.failure_reason) || 'no commit'}). ` +
      `Focus on writing simple, concrete assertions that test the acceptance criteria directly. ` +
      `Do not overthink — one test per AC, assert specific values.`,
      { label: `red-retry:${taskId}`, phase: 'Act', model: 'sonnet', schema: STAGE_RESULT_SCHEMA }
    )
  }

  if (!red || !red.committed) {
    const err = (red && red.failure_reason) || 'RED agent did not commit after 2 attempts'
    log(`[${taskId}] RED FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: err }
  }

  // ── Verify RED ────────────────────────────────────────────────────────
  const redCheckText = await agent(
    `cd "${wt}" && datum verify-stage red --repo "${wt}" --test-command "${laneCfg.testCommand}"\nReturn ONLY the JSON output, nothing else.`,
    { label: `verify-red:${taskId}`, phase: 'Act', model: 'haiku', agentType: 'datum-cli' }
  )
  const redCheck = parseAgentJson(redCheckText, { verified: false })

  if (!redCheck || !redCheck.verified) {
    const err = (redCheck && redCheck.error) || 'green_blindness_violation: tests passed after RED'
    log(`[${taskId}] RED FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: err }
  }
  log(`[${taskId}] RED verified`)

  // ── Reflect on test quality ───────────────────────────────────────────
  const reflect = await agent(
    `Read these test files in "${wt}": ${testFiles.join(', ')}\n` +
    `Score the tests written for these acceptance criteria:\n${acStr}\n` +
    `Return your score (0-10), reasoning, and gaps found.`,
    { label: `reflect:${taskId}`, phase: 'Act', model: 'haiku', schema: REFLECT_SCHEMA }
  )

  const reflectScore = (reflect && reflect.score) || 0
  log(`[${taskId}] Test quality score: ${reflectScore}/10`)
  if (reflectScore < 4) {
    log(`[${taskId}] RED FAILED: test quality too low (${reflectScore}/10): ${reflect && reflect.reasoning}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `test quality ${reflectScore}/10` }
  }

  // ── Test signal for GREEN ─────────────────────────────────────────────
  const signalText = await agent(
    `cd "${wt}" && ${laneCfg.testCommand} 2>${cfg.testCommand} 2>&11 || true\n` +
    `Extract ONLY: exit_code (integer), error messages (array of strings), assertion failure messages (array of strings). No test source code. Output as JSON.`,
    { label: `signal:${taskId}`, phase: 'Act', model: 'haiku', agentType: 'datum-cli' }
  )
  const signal = parseAgentJson(signalText, { exit_code: 1, errors: [], assertion_messages: [] })

  // ── GREEN ─────────────────────────────────────────────────────────────
  log(`[${taskId}] GREEN: making tests pass`)

  const greenPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'GREEN', { test_signal: signal })
  const greenPacketStr = JSON.stringify(greenPacket)
  const greenCtxCmd = laneCtxCmd(greenPacket, wt)

  let green = await agent(
    `SETUP (run first): ${greenCtxCmd}\n` +
    `TASK PACKET: ${greenPacketStr}`,
    { label: `green:${taskId}`, phase: 'Act', model: 'opus', schema: STAGE_RESULT_SCHEMA }
  )

  if (!green || !green.committed) {
    log(`[${taskId}] GREEN attempt 1 failed, retrying with error context`)
    const retrySignalText = await agent(
      `cd "${wt}" && ${laneCfg.testCommand} 2>&1 || true\n` +
      `Extract ONLY: exit_code, error messages, assertion failure messages. Output as JSON.`,
      { label: `signal-retry:${taskId}`, phase: 'Act', model: 'haiku', agentType: 'datum-cli' }
    )
    const retrySignal = parseAgentJson(retrySignalText, { exit_code: 1, errors: [], assertion_messages: [] })
    const retryPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'GREEN', {
      test_signal: retrySignal,
      retry_hint: `Previous attempt failed: ${(green && green.failure_reason) || 'no commit'}. Fix the implementation.`,
    })
    green = await agent(
      `SETUP (run first): ${greenCtxCmd}\n` +
      `TASK PACKET: ${JSON.stringify(retryPacket)}`,
      { label: `green-retry:${taskId}`, phase: 'Act', model: 'opus', schema: STAGE_RESULT_SCHEMA }
    )
  }

  if (!green || !green.committed) {
    const err = (green && green.failure_reason) || 'GREEN agent did not commit after 2 attempts'
    log(`[${taskId}] GREEN FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: err }
  }

  // ── Verify GREEN ──────────────────────────────────────────────────────
  const greenCheckText = await agent(
    `cd "${wt}" && datum verify-stage green --repo "${wt}" --test-command "${laneCfg.testCommand}"\nReturn ONLY the JSON output, nothing else.`,
    { label: `verify-green:${taskId}`, phase: 'Act', model: 'haiku', agentType: 'datum-cli' }
  )
  const greenCheck = parseAgentJson(greenCheckText, { verified: false })

  if (!greenCheck || !greenCheck.verified) {
    const err = (greenCheck && greenCheck.error) || 'tests still failing after GREEN'
    log(`[${taskId}] GREEN FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: err }
  }
  log(`[${taskId}] GREEN verified`)

  // ── Adversarial skeptic panel (3 lenses, parallel, consensus) ───────
  const skepticBase =
    `Working directory: "${wt}"\n` +
    `Implementation files: ${implFiles.join(', ')}\n` +
    `Test files: ${testFiles.join(', ')}\n` +
    `Test command: ${cfg.testCommand}\n` +
    `Acceptance criteria:\n${acStr}\n\n`

  const SKEPTIC_LENSES = [
    { key: 'edge', prompt: 'LENS: Edge cases. Focus on empty inputs, boundary values, off-by-one errors, None/null paths, single-element collections, max-size inputs.' },
    { key: 'error', prompt: 'LENS: Error paths. Focus on exception handling, invalid state transitions, missing validation, what happens when preconditions are violated.' },
    { key: 'contract', prompt: 'LENS: Behavioral contracts. Does the implementation ACTUALLY satisfy the acceptance criteria, or does it just make the specific tests pass? Look for cases where the ACs are met literally but not in spirit.' },
  ]

  const skepticResults = await parallel(
    SKEPTIC_LENSES.map(lens => () =>
      agent(
        skepticBase + lens.prompt,
        { label: `skeptic-${lens.key}:${taskId}`, phase: 'Act', model: 'sonnet', schema: SKEPTIC_SCHEMA }
      )
    )
  )

  const allBugs = []
  let brokenCount = 0
  for (let i = 0; i < SKEPTIC_LENSES.length; i++) {
    const s = skepticResults[i]
    if (!s) continue
    if (s.verdict === 'BROKEN') brokenCount++
    for (const bug of (s.bugs_found || [])) {
      allBugs.push({ ...bug, lens: SKEPTIC_LENSES[i].key })
    }
  }

  const bugDescs = allBugs.map(b => b.description.toLowerCase().slice(0, 60))
  const crossValidated = allBugs.filter((bug, idx) => {
    const myDesc = bugDescs[idx]
    return bugDescs.filter((d, j) => j !== idx && d === myDesc).length > 0
  })

  if (brokenCount >= 2) {
    const bugList = crossValidated.map(b => `[${b.lens}] ${b.description}`).join('; ')
    log(`[${taskId}] SKEPTIC PANEL: ${brokenCount}/3 BROKEN — ${crossValidated.length} cross-validated bugs: ${bugList || 'none'}`)
  } else if (brokenCount === 1) {
    log(`[${taskId}] SKEPTIC PANEL: 1/3 BROKEN (no consensus) — proceeding`)
  } else {
    log(`[${taskId}] SKEPTIC PANEL: PASS (${allBugs.length} total findings, ${crossValidated.length} cross-validated)`)
  }

  // ── File ownership check ──────────────────────────────────────────────
  const allAllowed = new Set([...testFiles, ...implFiles])
  const writtenFiles = [...(red.files_written || []), ...(green.files_written || [])]
  const violations = writtenFiles.filter(f => !allAllowed.has(f))
  if (violations.length > 0) {
    log(`[${taskId}] FILE OWNERSHIP VIOLATION: ${violations.join(', ')}`)
  }

  // ── REFACTOR (conditional — haiku pre-check) ──────────────────────────
  const refResult = await runRefactor(taskId, lane, testFiles, implFiles, wt, laneCfg)
  if (!refResult) {
    return { task_id: taskId, status: 'failed', stage: 'REFACTOR', error: 'refactor failed' }
  }

  log(`[${taskId}] Lane complete`)
  return { task_id: taskId, status: 'completed' }
}

// #4: conditional refactor — haiku pre-check before sonnet call
async function runRefactor(taskId, lane, testFiles, implFiles, wt, cfg) {
  log(`[${taskId}] REFACTOR: checking if needed`)

  const preCheck = await agent(
    `Read these files in "${wt}": ${[...implFiles, ...testFiles].join(', ')}\n` +
    `Is there anything worth refactoring? Check for: duplicate code, unclear naming, ` +
    `unnecessary complexity, dead code introduced in this task.\n` +
    `Return should_refactor (boolean) and reason (string). Be conservative — ` +
    `if the code is clean and simple, say false.`,
    { label: `refactor-check:${taskId}`, phase: 'Act', model: 'haiku', schema: REFACTOR_CHECK_SCHEMA }
  )

  if (!preCheck || !preCheck.should_refactor) {
    log(`[${taskId}] REFACTOR: skipped (${(preCheck && preCheck.reason) || 'nothing to improve'})`)
    return { verified: true }
  }

  log(`[${taskId}] REFACTOR: proceeding (${preCheck.reason})`)

  const refactorPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, cfg, 'REFACTOR', {})
  const refactorCtxCmd = laneCtxCmd(refactorPacket, wt)

  const refactor = await agent(
    `SETUP (run first): ${refactorCtxCmd}\n` +
    `TASK PACKET: ${JSON.stringify(refactorPacket)}`,
    { label: `refactor:${taskId}`, phase: 'Act', model: 'sonnet', schema: STAGE_RESULT_SCHEMA }
  )

  if (!refactor) {
    log(`[${taskId}] REFACTOR FAILED: agent returned null`)
    return null
  }
  if (!refactor.committed && refactor.failure_reason && !refactor.failure_reason.toLowerCase().includes('nothing to')) {
    log(`[${taskId}] REFACTOR FAILED: ${refactor.failure_reason}`)
    return null
  }
  if (!refactor.committed) {
    log(`[${taskId}] REFACTOR: nothing changed after all`)
    return { verified: true }
  }

  const checkText = await agent(
    `cd "${wt}" && datum verify-stage green --repo "${wt}" --test-command "${laneCfg.testCommand}"\nReturn ONLY the JSON output, nothing else.`,
    { label: `verify-refactor:${taskId}`, phase: 'Act', model: 'haiku', agentType: 'datum-cli' }
  )
  const check = parseAgentJson(checkText, { verified: false })

  if (!check || !check.verified) {
    log(`[${taskId}] REFACTOR verification FAILED: ${check && check.error}`)
    return null
  }
  return check
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

const lanePlanText = await agent(
  `Read ${lanePlanPath} and return its contents as raw JSON text. This is the SOLE source of truth — do NOT read tasks.json or any other file. Output ONLY the JSON, no markdown fences, no explanation.`,
  { label: 'read-plan', phase: 'Topology', model: 'haiku', agentType: 'datum-reader' }
)
const lanePlan = typeof lanePlanText === 'string' ? JSON.parse(lanePlanText.replace(/```[a-z]*\n?/g, '').trim()) : lanePlanText

const waves = buildWaves(lanePlan)
log(`Topology: ${lanePlan.total_lanes} lanes in ${waves.length} waves`)
for (let i = 0; i < waves.length; i++) {
  log(`  Wave ${i}: [${waves[i].join(', ')}]`)
}

// ── Phase: Setup (root worktree + lane worktrees) ───────────────────────

phase('Setup')

// Create a root worktree for this workflow run — isolates from parallel workflows
const rootWtText = await agent(
  `git worktree add .datum/worktrees/${runId}-root ${epicBranch} 2>&1 && ` +
  `echo '{"root": "'$(cd .datum/worktrees/${runId}-root && pwd)'"}'`,
  { label: 'root-worktree', phase: 'Setup', model: 'haiku', agentType: 'datum-cli' }
)
const rootWtInfo = parseAgentJson(rootWtText, {})
const rootWt = rootWtInfo.root
if (!rootWt) throw new Error('Failed to create root worktree')
log(`Root worktree: ${rootWt}`)

// Create lane worktrees FROM the root worktree (nested isolation)
const laneIds = Object.keys(lanePlan.lanes)
const setupText = await agent(
  `cd "${rootWt}" && datum worktrees setup --run-id ${runId} --epic-branch ${epicBranch} --lane-ids ${laneIds.join(',')}\nReturn ONLY the JSON output, no explanation.`,
  { label: 'setup-worktrees', phase: 'Setup', model: 'haiku', agentType: 'datum-cli' }
)
const worktreePaths = typeof setupText === 'string' ? JSON.parse(setupText.replace(/```[a-z]*\n?/g, '').trim()) : setupText

const validPaths = Object.values(worktreePaths || {}).filter(Boolean)
if (validPaths.length === 0) throw new Error('Setup failed: no worktree paths returned')

log(`Setup: ${laneIds.length} lane worktrees under root`)

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

// ── Phase: Docs (#2: single agent, both modes) ──────────────────────────

phase('Docs')

if (completedLanes.length > 0) {
  const changedFiles = [...new Set(completedLanes.flatMap(id => lanePlan.lanes[id].files || []))]

  const docsPacket = JSON.stringify({
    schema_version: '1.0',
    changed_files: changedFiles,
    new_symbols: completedLanes.map(id => ({
      task_id: id,
      title: lanePlan.lanes[id].title,
      files: lanePlan.lanes[id].files,
    })),
    working_directory: '.',
    commit_prefix: `docs(${runId})`,
  })

  const docs = await agent(
    `You are a documentation sync agent. Do BOTH of these:\n` +
    `1. UPDATE: fix any existing docs that reference changed code incorrectly\n` +
    `2. NEW: if new public APIs were added that have zero documentation, add a section in the appropriate existing doc file\n\n` +
    `TASK PACKET: ${docsPacket}\n\n` +
    `RULES: CLI refs say "datum <cmd>" not "uv run". Do NOT create new doc files. Do NOT touch CHANGELOG. Keep it concise.`,
    { label: 'docs-sync', phase: 'Docs', model: 'sonnet', schema: STAGE_RESULT_SCHEMA }
  )

  if (docs && docs.committed) {
    log(`Docs synced: ${(docs.files_written || []).join(', ')}`)
  } else {
    log(`Docs: ${(docs && docs.failure_reason) || 'nothing to update'}`)
  }
} else {
  log('No completed lanes — skipping docs')
}

// ── Phase: Cleanup ───────────────────────────────────────────────────────

phase('Cleanup')

await agent(
  `datum worktrees cleanup --run-id ${runId} --epic-branch ${epicBranch} && ` +
  `git worktree remove .datum/worktrees/${runId}-root --force 2>/dev/null; ` +
  `git worktree prune`,
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

// ── Phase: Triage (auto-file issues for failures) ───────────────────────

phase('Triage')

if (failures.length > 0) {
  const failureDetails = failures.map(fid => {
    const r = results[fid]
    const lane = lanePlan.lanes[fid]
    return `Lane ${fid} ("${lane.title}"): failed at ${r.stage} — ${r.error}`
  }).join('\n')

  const triage = await agent(
    `Analyze these TDD workflow failures and categorize each one.\n\n` +
    `Run ID: ${runId}\n` +
    `Epic branch: ${epicBranch}\n` +
    `Failed lanes:\n${failureDetails}\n\n` +
    `For each failure, determine:\n` +
    `- Is this a WORKFLOW BUG (datum-tdd-act.js logic error)?\n` +
    `- Is this a LANE PLAN issue (bad ACs, wrong files, missing deps)?\n` +
    `- Is this an AGENT BEHAVIOR issue (agent didn't follow instructions)?\n` +
    `- Is this INFRASTRUCTURE (git, uv, pytest, CWD issues)?\n` +
    `- Is this TEST QUALITY (tests too weak, wrong assertions)?\n\n` +
    `For each issue, write a GitHub issue title starting with [datum-bug] and a body with:\n` +
    `- What happened (the error)\n` +
    `- Why it happened (root cause analysis)\n` +
    `- Suggested fix\n` +
    `- The lane, stage, and run ID for traceability`,
    { label: 'triage', phase: 'Triage', model: 'sonnet', schema: TRIAGE_SCHEMA }
  )

  if (triage && triage.issues && triage.issues.length > 0) {
    for (const issue of triage.issues) {
      if (issue.severity === 'low') {
        log(`[triage] Skipping low-severity: ${issue.title}`)
        continue
      }
      const labels = `datum-bug,${issue.category}`
      await agent(
        `unset GITHUB_TOKEN && gh issue list --repo gitrdunhq/datum --state open --search "${issue.title.slice(0, 50)}" --json number,title --limit 3 | head -5\n` +
        `If no duplicate exists, create the issue:\n` +
        `unset GITHUB_TOKEN && gh issue create --repo gitrdunhq/datum ` +
        `--title "${issue.title.replace(/"/g, '\\"')}" ` +
        `--label "${labels}" ` +
        `--body '${issue.body.replace(/'/g, "'\\''")}'\n` +
        `If a duplicate exists, skip and say "duplicate found".`,
        { label: `file-issue:${issue.lane || 'global'}`, phase: 'Triage', model: 'haiku', agentType: 'datum-cli' }
      )
      log(`[triage] Filed: ${issue.title} [${issue.category}/${issue.severity}]`)
    }
  } else {
    log('[triage] No actionable issues identified')
  }
} else {
  log('[triage] All lanes succeeded — no issues to file')
}

return {
  runId,
  total: lanePlan.total_lanes,
  completed: completedLanes.length,
  failed: failures.length,
  failedLanes: failures,
  completedLanes,
}
