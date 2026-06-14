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
    { title: 'Topology', detail: 'parse lane-plan.json, BFS wave grouping, auto-partition into ≤5 task batches' },
    { title: 'Setup', detail: 'create root + per-lane git worktrees (per batch)' },
    { title: 'Act', detail: 'RED->verify->GREEN->verify->REFACTOR per lane, wave-parallel (per batch)' },
    { title: 'Merge', detail: 'squash-merge lanes in topological order (per batch)' },
    { title: 'Cleanup', detail: 'remove worktrees (per batch)' },
    { title: 'Docs', detail: 'haiku pre-check + conditional sonnet sync (once after all batches)' },
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
    for (const dep of deps) {
      if (!lanes[dep]) throw new Error(`Task '${id}' depends on '${dep}', which does not exist in the lane plan`)
    }
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

  const placed = new Set(waves.flat())
  const cyclic = ids.filter(id => !placed.has(id))
  if (cyclic.length > 0) throw new Error(`Cyclic dependency detected among tasks: ${cyclic.sort().join(', ')}`)

  return waves
}

// ── File classification ──────────────────────────────────────────────────────

function classifyFiles(files) {
  const isTest = f => {
    const base = f.split('/').pop()
    return base.startsWith('test_') || base.endsWith('_test.py') ||
      base.endsWith('.test.ts') || base.endsWith('.test.js') ||
      base.endsWith('.spec.ts') || base.endsWith('.spec.js') ||
      base.endsWith('_test.go') || base.endsWith('Tests.swift') ||
      f.includes('/tests/') || f.includes('/Tests/') ||
      base === 'conftest.py'
  }
  const testFiles = (files || []).filter(isTest)
  const implFiles = (files || []).filter(f => !isTest(f))
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

  log(`[${taskId}] Starting: ${lane.title} (${isStructural ? 'structural' : 'behavioral'}, ${testFiles.length} test files, ${implFiles.length} impl files)`)
  log(`[${taskId}]   tests: ${testFiles.join(', ') || '(none)'}`)
  log(`[${taskId}]   impl:  ${implFiles.join(', ') || '(none)'}`)
  log(`[${taskId}]   test cmd: ${laneTestCmd}`)

  if (isStructural) {
    const r = await runRefactor(taskId, lane, testFiles, implFiles, wt, laneCfg)
    if (!r) return { task_id: taskId, status: 'failed', stage: 'REFACTOR', error: 'refactor failed' }
    log(`[${taskId}] STRUCTURAL lane complete`)
    return { task_id: taskId, status: 'completed' }
  }

  // ── Skeleton preflight (E2: capture output directly, no separate read agent) ──
  const skeletonText = await agent(
    `cd "${wt}" && datum skeleton --task-id ${taskId} --language ${cfg.language} ` +
    `--tasks ${cfg.lanePlanPath} --output .datum/runs/${cfg.runId}/preflight-${taskId}.json 2>&1`,
    { label: `skeleton:${taskId}`, phase: 'Act', model: 'haiku' }
  )
  const preflight = parseAgentJson(skeletonText, {})

  // Commit skeleton scaffolds so resets have a clean baseline to restore to
  await agent(
    `cd "${wt}" && git add -A && git diff --cached --quiet || git commit -m "skeleton(${taskId}): preflight scaffolds"`,
    { label: `skeleton-commit:${taskId}`, phase: 'Act', model: 'haiku' }
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

  if (red && red.committed) {
    log(`[${taskId}] RED committed: ${red.commit_sha || '(no sha)'}`)
    log(`[${taskId}]   files: ${(red.files_written || []).join(', ') || '(none reported)'}`)
  }

  if (!red || !red.committed) {
    log(`[${taskId}] RED attempt 1 failed: ${(red && red.failure_reason) || 'no commit'}, retrying with hint`)
    await agent(
      `cd "${wt}" && git checkout -- . && git clean -fd --exclude=.datum/`,
      { label: `reset-red:${taskId}`, phase: 'Act', model: 'haiku' }
    )
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
    log(`[${taskId}] RED FAILED after 2 attempts: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: err }
  }

  if (red.committed) {
    log(`[${taskId}] RED retry committed: ${red.commit_sha || '(no sha)'}`)
    log(`[${taskId}]   files: ${(red.files_written || []).join(', ') || '(none reported)'}`)
  }

  // ── Verify RED ────────────────────────────────────────────────────────
  const redCheckText = await agent(
    `cd "${wt}" && datum verify-stage red --repo "${wt}" --test-command "${laneCfg.testCommand}"\nReturn ONLY the JSON output, nothing else.`,
    { label: `verify-red:${taskId}`, phase: 'Act', model: 'haiku' }
  )
  const redCheck = parseAgentJson(redCheckText, { verified: false })

  if (!redCheck || !redCheck.verified) {
    const err = (redCheck && redCheck.error) || 'green_blindness_violation: tests passed after RED'
    log(`[${taskId}] RED VERIFY FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: err }
  }
  log(`[${taskId}] RED verified — tests fail as expected`)

  // ── Reflect on test quality ───────────────────────────────────────────
  const reflect = await agent(
    `Read these test files in "${wt}": ${testFiles.join(', ')}\n` +
    `Score the tests written for these acceptance criteria:\n${acStr}\n` +
    `Return your score (0-10), reasoning, and gaps found.`,
    { label: `reflect:${taskId}`, phase: 'Act', model: 'haiku', schema: REFLECT_SCHEMA }
  )

  const reflectScore = (reflect && reflect.score) || 0
  log(`[${taskId}] Test quality: ${reflectScore}/10 — ${(reflect && reflect.reasoning) || 'no reasoning'}`)
  if (reflect && reflect.gaps && reflect.gaps.length > 0) {
    log(`[${taskId}]   gaps: ${reflect.gaps.join('; ')}`)
  }
  if (reflectScore < 4) {
    log(`[${taskId}] RED FAILED: test quality too low (${reflectScore}/10)`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `test quality ${reflectScore}/10` }
  }

  // ── Context for GREEN (E2+E8+E10+E11: signal from verify-red, preflight from skeleton, no extra agents) ──
  const signal = (redCheck && redCheck.test_signal) || { exit_code: 1, errors: [], assertion_messages: [] }

  // E8: extract contract_summary from ACs deterministically
  const BUILTIN_SKIP = new Set(['print','len','str','int','dict','list','set','isinstance','type','exit','round','sorted','filter','map','any','all','range','enumerate','zip','open','input','format','repr','hash','id','dir','vars','super','property','staticmethod','classmethod'])
  const contractSummary = (lane.acceptance_criteria || []).map(ac => {
    const funcMatch = ac.match(/(?<!['"-])(\w+)\(([^)]*)\)/)
    const retMatch = ac.match(/returns?\s+(?:a\s+)?(\w+)/i)
    const raiseMatch = ac.match(/[Rr]aises?\s+(\w+Error|\w+Exception)/)
    if (!funcMatch || BUILTIN_SKIP.has(funcMatch[1])) return null
    return {
      function: funcMatch[1],
      args: funcMatch[2] ? funcMatch[2].split(',').map(a => a.trim()).filter(Boolean) : [],
      returns: retMatch ? retMatch[1] : null,
      raises: raiseMatch ? raiseMatch[1] : null,
      ac: ac.slice(0, 120),
    }
  }).filter(Boolean)

  // ── GREEN (sonnet first, opus on retry) ───────────────────────────────
  const greenModel = lane.green_model || 'sonnet'
  log(`[${taskId}] GREEN: making tests pass (model: ${greenModel}, contracts: ${contractSummary.length})`)

  const greenPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'GREEN', {
    test_signal: signal,
    preflight: preflight,
    contract_summary: contractSummary,
    impl_stubs: preflight.impl_stubs || [],
    existing_api: preflight.existing_api || {},
  })
  const greenPacketStr = JSON.stringify(greenPacket)
  const greenCtxCmd = laneCtxCmd(greenPacket, wt)

  let green = await agent(
    `SETUP (run first): ${greenCtxCmd}\n` +
    `TASK PACKET: ${greenPacketStr}\n\n` +
    `CONTEXT:\n` +
    `- contract_summary: structured function signatures extracted from ACs — implement these\n` +
    `- impl_stubs: stub files already created with function signatures and ... bodies — fill them in\n` +
    `- existing_api: skeleton of existing module code — understand the API shape before extending\n` +
    `- red_note: what behaviors the tests check for\n` +
    `- test_signal: error messages from failing tests\n` +
    `Write MINIMUM code to make tests pass — nothing more.`,
    { label: `green:${taskId}`, phase: 'Act', model: greenModel, schema: STAGE_RESULT_SCHEMA }
  )

  if (green && green.committed) {
    log(`[${taskId}] GREEN committed: ${green.commit_sha || '(no sha)'}`)
    log(`[${taskId}]   files: ${(green.files_written || []).join(', ') || '(none reported)'}`)
  }

  if (!green || !green.committed) {
    const escalatedModel = 'opus'
    log(`[${taskId}] GREEN attempt 1 failed (${greenModel}): ${(green && green.failure_reason) || 'no commit'}, escalating to ${escalatedModel}`)

    // Reset worktree to clean RED state — partial impl from failed attempt contaminates signal
    await agent(
      `cd "${wt}" && git checkout -- . && git clean -fd --exclude=.datum/`,
      { label: `reset-green:${taskId}`, phase: 'Act', model: 'haiku' }
    )

    const retryCheckText = await agent(
      `cd "${wt}" && datum verify-stage red --repo "${wt}" --test-command "${laneCfg.testCommand}"\nReturn ONLY the JSON output, nothing else.`,
      { label: `signal-retry:${taskId}`, phase: 'Act', model: 'haiku' }
    )
    const retryCheck = parseAgentJson(retryCheckText, {})
    const retrySignal = (retryCheck && retryCheck.test_signal) || signal
    const retryPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'GREEN', {
      test_signal: retrySignal,
      preflight: preflight,
      contract_summary: contractSummary,
      impl_stubs: preflight.impl_stubs || [],
      existing_api: preflight.existing_api || {},
      retry_hint: `Previous attempt failed: ${(green && green.failure_reason) || 'no commit'}. Read the FULL error output carefully. Fix the implementation.`,
    })
    green = await agent(
      `SETUP (run first): ${greenCtxCmd}\n` +
      `TASK PACKET: ${JSON.stringify(retryPacket)}\n\n` +
      `CONTEXT: RETRY — previous attempt failed. Read existing implementation files.\n` +
      `- contract_summary: function signatures to implement\n` +
      `- impl_stubs/existing_api: fill in bodies, don't start from scratch\n` +
      `- test_signal: current errors to fix`,
      { label: `green-retry:${taskId}`, phase: 'Act', model: escalatedModel, schema: STAGE_RESULT_SCHEMA }
    )
  }

  if (!green || !green.committed) {
    const err = (green && green.failure_reason) || 'GREEN agent did not commit after 2 attempts'
    log(`[${taskId}] GREEN FAILED after 2 attempts: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: err }
  }

  if (green.committed) {
    log(`[${taskId}] GREEN retry committed: ${green.commit_sha || '(no sha)'}`)
    log(`[${taskId}]   files: ${(green.files_written || []).join(', ') || '(none reported)'}`)
  }

  // ── Verify GREEN ──────────────────────────────────────────────────────
  const greenCheckText = await agent(
    `cd "${wt}" && datum verify-stage green --repo "${wt}" --test-command "${laneCfg.testCommand}"\nReturn ONLY the JSON output, nothing else.`,
    { label: `verify-green:${taskId}`, phase: 'Act', model: 'haiku' }
  )
  const greenCheck = parseAgentJson(greenCheckText, { verified: false })

  if (!greenCheck || !greenCheck.verified) {
    const err = (greenCheck && greenCheck.error) || 'tests still failing after GREEN'
    log(`[${taskId}] GREEN VERIFY FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: err }
  }
  log(`[${taskId}] GREEN verified — all tests pass`)

  // ── Adversarial skeptic panel (3 lenses, parallel, consensus) ───────
  const skepticBase =
    `Working directory: "${wt}"\n` +
    `Implementation files: ${implFiles.join(', ')}\n` +
    `Test files: ${testFiles.join(', ')}\n` +
    `Test command: ${laneCfg.testCommand}\n` +
    `Acceptance criteria:\n${acStr}\n\n`

  const SKEPTIC_LENSES = [
    { key: 'edge', model: 'haiku', prompt: 'LENS: Edge cases. Focus on empty inputs, boundary values, off-by-one errors, None/null paths, single-element collections, max-size inputs.' },
    { key: 'error', model: 'haiku', prompt: 'LENS: Error paths. Focus on exception handling, invalid state transitions, missing validation, what happens when preconditions are violated.' },
    { key: 'contract', model: 'sonnet', prompt: 'LENS: Behavioral contracts. Does the implementation ACTUALLY satisfy the acceptance criteria, or does it just make the specific tests pass? Look for cases where the ACs are met literally but not in spirit.' },
  ]

  const skepticResults = await parallel(
    SKEPTIC_LENSES.map(lens => () =>
      agent(
        skepticBase + lens.prompt,
        { label: `skeptic-${lens.key}:${taskId}`, phase: 'Act', model: lens.model, schema: SKEPTIC_SCHEMA }
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

  for (let i = 0; i < SKEPTIC_LENSES.length; i++) {
    const s = skepticResults[i]
    if (!s) { log(`[${taskId}] SKEPTIC ${SKEPTIC_LENSES[i].key}: (null — agent failed)`); continue }
    const bugCount = (s.bugs_found || []).length
    log(`[${taskId}] SKEPTIC ${SKEPTIC_LENSES[i].key}: ${s.verdict} (${bugCount} bugs, confidence: ${s.confidence || 'N/A'})`)
    for (const bug of (s.bugs_found || [])) {
      log(`[${taskId}]   - [${bug.severity || '?'}] ${bug.description}`)
    }
  }

  if (brokenCount >= 2) {
    const bugList = crossValidated.map(b => `[${b.lens}] ${b.description}`).join('; ')
    log(`[${taskId}] SKEPTIC VERDICT: ${brokenCount}/3 BROKEN — ${crossValidated.length} cross-validated: ${bugList || 'none'}`)
  } else if (brokenCount === 1) {
    log(`[${taskId}] SKEPTIC VERDICT: 1/3 BROKEN (no consensus) — proceeding`)
  } else {
    log(`[${taskId}] SKEPTIC VERDICT: PASS (${allBugs.length} total findings, ${crossValidated.length} cross-validated)`)
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

  log(`[${taskId}] === LANE COMPLETE ===`)
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
  if (refactor.committed) {
    log(`[${taskId}] REFACTOR committed: ${refactor.commit_sha || '(no sha)'}`)
    log(`[${taskId}]   files: ${(refactor.files_written || []).join(', ') || '(none reported)'}`)
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
    { label: `verify-refactor:${taskId}`, phase: 'Act', model: 'haiku' }
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
const testCommand = a.testCommand || 'uv run pytest -x -q'
const language = a.language || 'python'
const cfg = { lanePlanPath, epicBranch, runId, testCommand, language }

if (!epicBranch) throw new Error('args.epicBranch is required. If resuming, pass the original args: Workflow({scriptPath, resumeFromRunId, args: {epicBranch, runId, ...}})')
if (!runId) throw new Error('args.runId is required. If resuming, pass the original args alongside resumeFromRunId')

// ── Phase: Topology ──────────────────────────────────────────────────────

phase('Topology')

const lanePlanText = await agent(
  `Read ${lanePlanPath} and return its contents as raw JSON text. This is the SOLE source of truth — do NOT read tasks.json or any other file. Output ONLY the JSON, no markdown fences, no explanation.`,
  { label: 'read-plan', phase: 'Topology', model: 'haiku' }
)
const lanePlan = typeof lanePlanText === 'string' ? JSON.parse(lanePlanText.replace(/```[a-z]*\n?/g, '').trim()) : lanePlanText

const waves = buildWaves(lanePlan)
if (waves.length === 0 || Object.keys(lanePlan.lanes || {}).length === 0) {
  throw new Error('Lane plan has 0 tasks — nothing to execute')
}
log(`Topology: ${lanePlan.total_lanes} lanes in ${waves.length} waves`)
for (let i = 0; i < waves.length; i++) {
  log(`  Wave ${i}: [${waves[i].join(', ')}]`)
}

// ── Auto-partition: group waves into batches of ≤5 tasks ────────────────

const MAX_BATCH = 5

// Split oversized waves — intra-wave tasks are independent, so splitting is safe
const splitWaves = []
for (const wave of waves) {
  if (wave.length <= MAX_BATCH) {
    splitWaves.push(wave)
  } else {
    for (let i = 0; i < wave.length; i += MAX_BATCH) {
      splitWaves.push(wave.slice(i, i + MAX_BATCH))
    }
  }
}

const batches = []
let curBatch = []
let curCount = 0
for (const wave of splitWaves) {
  if (curCount + wave.length > MAX_BATCH && curBatch.length > 0) {
    batches.push(curBatch)
    curBatch = []
    curCount = 0
  }
  curBatch.push(wave)
  curCount += wave.length
}
if (curBatch.length > 0) batches.push(curBatch)

if (batches.length > 1) {
  log(`Auto-partitioned ${lanePlan.total_lanes} tasks into ${batches.length} batches (max ${MAX_BATCH}/batch)`)
  for (let b = 0; b < batches.length; b++) {
    log(`  Batch ${b}: [${batches[b].flat().join(', ')}]`)
  }
}

// ── Batch loop: each batch gets its own worktree lifecycle ──────────────

const results = {}
const failures = []
const completedLanes = []

for (let bi = 0; bi < batches.length; bi++) {
  const batchWaves = batches[bi]
  const batchLaneIds = batchWaves.flat()
  const batchTag = batches.length > 1 ? ` [batch ${bi + 1}/${batches.length}]` : ''
  const batchRunId = batches.length > 1 ? `${runId}-b${bi}` : runId

  if (batches.length > 1) log(`\n${'='.repeat(60)}\n=== Batch ${bi + 1}/${batches.length}: [${batchLaneIds.join(', ')}] ===\n${'='.repeat(60)}`)

  // ── Setup ──────────────────────────────────────────────────────────
  phase('Setup')

  const rootWtText = await agent(
    `git worktree add --detach .datum/worktrees/${batchRunId}-root ${epicBranch} 2>&1 && ` +
    `echo '{"root": "'$(cd .datum/worktrees/${batchRunId}-root && pwd)'"}'`,
    { label: `root-wt${batchTag}`, phase: 'Setup', model: 'haiku' }
  )
  const rootWtInfo = parseAgentJson(rootWtText, {})
  const rootWt = rootWtInfo.root
  if (!rootWt) throw new Error(`Failed to create root worktree for batch ${bi}`)
  log(`Root worktree${batchTag}: ${rootWt}`)

  const setupText = await agent(
    `cd "${rootWt}" && datum worktrees setup --run-id ${batchRunId} --epic-branch ${epicBranch} --lane-ids ${batchLaneIds.join(',')}\nReturn ONLY the JSON output, no explanation.`,
    { label: `setup-wt${batchTag}`, phase: 'Setup', model: 'haiku' }
  )
  const worktreePaths = typeof setupText === 'string' ? JSON.parse(setupText.replace(/```[a-z]*\n?/g, '').trim()) : setupText

  const validPaths = Object.values(worktreePaths || {}).filter(Boolean)
  if (validPaths.length === 0) throw new Error(`Setup failed: no worktree paths for batch ${bi}`)
  for (const [lid, wtp] of Object.entries(worktreePaths || {})) {
    log(`  worktree ${lid}: ${wtp}`)
  }

  // Copy lane plan into each worktree (.datum/ is gitignored, so not present from git)
  // Write once to root, then cp to lanes (avoids N× JSON inline in shell command)
  const planJson = JSON.stringify(lanePlan).replace(/'/g, "'\\''")
  await agent(
    `mkdir -p "${rootWt}/.datum" && printf '%s' '${planJson}' > "${rootWt}/.datum/lane-plan.json"`,
    { label: `write-plan${batchTag}`, phase: 'Setup', model: 'haiku' }
  )
  const cpCmd = validPaths
    .map(p => `mkdir -p "${p}/.datum" && cp "${rootWt}/.datum/lane-plan.json" "${p}/.datum/lane-plan.json"`)
    .join(' && ')
  if (cpCmd) {
    await agent(cpCmd, { label: `copy-plans${batchTag}`, phase: 'Setup', model: 'haiku' })
  }

  log(`Setup${batchTag}: ${batchLaneIds.length} lane worktrees`)

  // ── Act ────────────────────────────────────────────────────────────
  phase('Act')

  for (let waveIdx = 0; waveIdx < batchWaves.length; waveIdx++) {
    const wave = batchWaves[waveIdx]
    log(`=== Wave ${waveIdx}${batchTag}: [${wave.join(', ')}] ===`)

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
      else completedLanes.push(wave[i])
    }

    const waveFailed = wave.filter(id => failures.includes(id))
    const ok = wave.length - waveFailed.length
    log(`=== Wave ${waveIdx}${batchTag} done: ${ok}/${wave.length} ===`)
    if (waveFailed.length > 0) {
      for (const fid of waveFailed) {
        const r = results[fid]
        log(`  FAILED ${fid}: ${r ? `${r.stage} — ${r.error}` : 'null result'}`)
      }
    }
  }

  // ── Merge ──────────────────────────────────────────────────────────
  phase('Merge')

  const batchCompleted = batchLaneIds.filter(id => completedLanes.includes(id))

  if (batchCompleted.length === 0) {
    log(`No lanes completed${batchTag} — skipping merge`)
  } else {
    const mergeOrder = lanePlan.topological_order.filter(id => batchCompleted.includes(id))

    await agent(
      `datum worktrees merge --epic-branch ${epicBranch} --lane-order ${mergeOrder.join(',')} ` +
      `--commit-message "act(${batchRunId}): merge ${batchCompleted.length} lanes"`,
      { label: `merge${batchTag}`, phase: 'Merge', model: 'haiku' }
    )

    log(`Merged${batchTag} in order: [${mergeOrder.join(' → ')}]`)
  }

  // ── Cleanup ────────────────────────────────────────────────────────
  phase('Cleanup')

  await agent(
    `datum worktrees cleanup --run-id ${batchRunId} --epic-branch ${epicBranch} && ` +
    `git worktree remove .datum/worktrees/${batchRunId}-root --force 2>/dev/null; ` +
    `git worktree prune`,
    { label: `cleanup${batchTag}`, phase: 'Cleanup', model: 'haiku' }
  )
}

// ── Phase: Docs (E9: haiku pre-check + conditional sonnet, once after all batches) ──

phase('Docs')

if (completedLanes.length > 0) {
  const changedFiles = [...new Set(completedLanes.flatMap(id => lanePlan.lanes[id].files || []))]

  const docsCheckText = await agent(
    `Grep for references to these symbols/files in doc files (*.md, not CHANGELOG): ${changedFiles.join(', ')}\n` +
    `Also check if any new public functions/classes were added that have zero docs.\n` +
    `Return needs_update (boolean) and reason (string).`,
    { label: 'docs-check', phase: 'Docs', model: 'haiku', schema: REFACTOR_CHECK_SCHEMA }
  )

  if (docsCheckText && docsCheckText.should_refactor) {
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
    log(`Docs: no stale references found, skipping`)
  }
} else {
  log('No completed lanes — skipping docs')
}

log(`\n${'═'.repeat(60)}`)
log(`ACT COMPLETE: ${completedLanes.length}/${lanePlan.total_lanes} succeeded, ${failures.length} failed`)
if (completedLanes.length > 0) log(`  completed: [${completedLanes.join(', ')}]`)
if (failures.length > 0) {
  log(`  failed:    [${failures.join(', ')}]`)
  for (const fid of failures) {
    const r = results[fid]
    if (r) log(`    ${fid}: ${r.stage} — ${r.error}`)
  }
}
log(`${'═'.repeat(60)}`)

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
    { label: 'triage', phase: 'Triage', model: 'haiku', schema: TRIAGE_SCHEMA }
  )

  if (triage && triage.issues && triage.issues.length > 0) {
    for (const issue of triage.issues) {
      if (issue.severity === 'low') {
        log(`[triage] Skipping low-severity: ${issue.title}`)
        continue
      }
      const labels = `datum-bug,${issue.category}`
      const safeTitle = issue.title.slice(0, 80).replace(/'/g, "'\\''")
      const safeSearch = issue.title.slice(0, 50).replace(/'/g, "'\\''")
      const safeBody = issue.body.replace(/'/g, "'\\''")
      await agent(
        `unset GITHUB_TOKEN && gh issue list --repo gitrdunhq/datum --state open --search '${safeSearch}' --json number,title --limit 3 | head -5\n` +
        `If no duplicate exists, create the issue:\n` +
        `unset GITHUB_TOKEN && gh issue create --repo gitrdunhq/datum ` +
        `--title '${safeTitle}' ` +
        `--label '${labels}' ` +
        `--body '${safeBody}'\n` +
        `If a duplicate exists, skip and say "duplicate found".`,
        { label: `file-issue:${issue.lane || 'global'}`, phase: 'Triage', model: 'haiku' }
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
