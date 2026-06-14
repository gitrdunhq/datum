// datum-tdd-act-lane.js — Act phase: RED->GREEN->REFACTOR per lane with DAG scheduling.

export const meta = {
  name: 'datum-tdd-act-lane',
  description: 'DAG-scheduled TDD execution: RED->verify->GREEN->verify->REFACTOR per lane',
  phases: [{ title: 'Act' }],
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const WRITE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    files_written: { type: 'array', items: { type: 'string' } },
    success: { type: 'boolean' },
    failure_reason: { type: 'string' },
  },
  required: ['success'],
}

const COMMIT_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    commit_sha: { type: 'string' },
    files_staged: { type: 'array', items: { type: 'string' } },
    violations: { type: 'array', items: { type: 'string' } },
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

const REFACTOR_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    should_refactor: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['should_refactor'],
}

// ── Pure functions ──────────────────────────────────────────────────────────

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

function parseAgentJson(text, fallback) {
  if (!text || typeof text !== 'string') return fallback || null
  const cleaned = text.replace(/```[a-z]*\n?/g, '').trim()
  const start = cleaned.search(/[{[]/)
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
  if (start === -1 || end === -1) return fallback || null
  try { return JSON.parse(cleaned.slice(start, end + 1)) }
  catch { return fallback || null }
}

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

const BUILTIN_SKIP = new Set(['print','len','str','int','dict','list','set','isinstance','type','exit','round','sorted','filter','map','any','all','range','enumerate','zip','open','input','format','repr','hash','id','dir','vars','super','property','staticmethod','classmethod'])

function extractContractSummary(acceptanceCriteria) {
  return (acceptanceCriteria || []).map(ac => {
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
}

function crossValidateBugs(skepticResults, lenses) {
  const allBugs = []
  let brokenCount = 0
  for (let i = 0; i < lenses.length; i++) {
    const s = skepticResults[i]
    if (!s) continue
    if (s.verdict === 'BROKEN') brokenCount++
    for (const bug of (s.bugs_found || [])) {
      allBugs.push({ ...bug, lens: lenses[i].key })
    }
  }
  const bugDescs = allBugs.map(b => b.description.toLowerCase().slice(0, 60))
  const crossValidated = allBugs.filter((bug, idx) => {
    const myDesc = bugDescs[idx]
    return bugDescs.filter((d, j) => j !== idx && d === myDesc).length > 0
  })
  return { allBugs, brokenCount, crossValidated }
}

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

// ── Git agents (single writer pattern) ──────────────────────────────────────

async function commitStage(taskId, wt, commitPrefix, allowedFiles, stage) {
  const allowedList = allowedFiles.join(', ')
  const basePrompt =
    `You are a GIT COMMIT agent. You ONLY handle git operations — never edit source files.\n` +
    `Working directory: "${wt}" — cd into it FIRST.\n\n` +
    `TASK:\n` +
    `1. Run: git -C "${wt}" status --porcelain\n` +
    `2. Verify ONLY these files were modified: ${allowedList}\n` +
    `3. If files outside that list were changed, report them as violations and do NOT commit\n` +
    `4. Stage the allowed files: git -C "${wt}" add <files>\n` +
    `5. Commit: git -C "${wt}" commit -m "${commitPrefix}: ${stage} complete"\n` +
    `6. Return the commit SHA from: git -C "${wt}" rev-parse --short HEAD\n\n` +
    `RULES:\n` +
    `- NEVER edit, create, or delete source files — only git operations\n` +
    `- If there are no changes to commit, return committed=false\n` +
    `- Use git -C "${wt}" for ALL git commands to enforce directory`

  let result = await agent(basePrompt,
    { label: `git-${stage.toLowerCase()}:${taskId}`, phase: 'Act', model: 'haiku', schema: COMMIT_RESULT_SCHEMA }
  )

  if (result && result.violations && result.violations.length > 0) {
    log(`[${taskId}] GIT ${stage}: file ownership violations: ${result.violations.join(', ')}`)
  }

  if (!result || (!result.committed && result.failure_reason)) {
    log(`[${taskId}] GIT ${stage}: haiku failed (${(result && result.failure_reason) || 'null'}), escalating to sonnet`)
    result = await agent(
      basePrompt + `\n\nRETRY CONTEXT: Previous commit attempt failed: ${(result && result.failure_reason) || 'null result'}.\n` +
      `Diagnose the git state: run git -C "${wt}" status, git -C "${wt}" diff --stat, git -C "${wt}" log --oneline -3.\n` +
      `Fix any issues (merge conflicts, dirty index, detached HEAD) then commit.\n` +
      `If the worktree is in a broken state, report failure_reason with details.`,
      { label: `git-${stage.toLowerCase()}-fix:${taskId}`, phase: 'Act', model: 'sonnet', schema: COMMIT_RESULT_SCHEMA }
    )
  }

  if (result && result.committed) {
    log(`[${taskId}] GIT ${stage} committed: ${result.commit_sha || '(no sha)'}`)
    log(`[${taskId}]   staged: ${(result.files_staged || []).join(', ') || '(none reported)'}`)
  } else {
    log(`[${taskId}] GIT ${stage} FAILED: ${(result && result.failure_reason) || 'no commit after escalation'}`)
  }

  return result
}

async function resetWorktree(taskId, wt, stage) {
  await agent(
    `You are a GIT RESET agent. Reset the worktree to the last commit.\n` +
    `Run: git -C "${wt}" checkout -- . && git -C "${wt}" clean -fd --exclude=.datum/\n` +
    `Do NOT edit, create, or delete source files — only git operations.`,
    { label: `reset-${stage.toLowerCase()}:${taskId}`, phase: 'Act', model: 'haiku' }
  )
  log(`[${taskId}] GIT RESET ${stage}: worktree cleaned`)
}

async function revertLastCommit(taskId, wt, stage) {
  await agent(
    `You are a GIT REVERT agent. Revert the most recent commit.\n` +
    `Run: git -C "${wt}" revert --no-edit HEAD\n` +
    `Do NOT edit, create, or delete source files — only git operations.`,
    { label: `revert-${stage.toLowerCase()}:${taskId}`, phase: 'Act', model: 'haiku' }
  )
  log(`[${taskId}] GIT REVERT ${stage}: last commit reverted`)
}

// ── Verification agent (read-only, deterministic) ───────────────────────────

async function verifyStage(taskId, wt, stage, testCommand) {
  const checkText = await agent(
    `cd "${wt}" && datum verify-stage ${stage} --repo "${wt}" --test-command "${testCommand}"\nReturn ONLY the JSON output, nothing else.`,
    { label: `verify-${stage}:${taskId}`, phase: 'Act', model: 'haiku' }
  )
  return parseAgentJson(checkText, { verified: false })
}

// ── Skeleton runner ─────────────────────────────────────────────────────────

async function runSkeleton(taskId, wt, cfg) {
  const text = await agent(
    `cd "${wt}" && datum skeleton --task-id ${taskId} --language ${cfg.language} ` +
    `--tasks ${cfg.lanePlanPath} --output .datum/runs/${cfg.runId}/preflight-${taskId}.json 2>&1`,
    { label: `skeleton:${taskId}`, phase: 'Act', model: 'haiku' }
  )
  return parseAgentJson(text, {})
}

// ── Per-lane TDD saga ───────────────────────────────────────────────────────

async function runLane(taskId, lanePlan, worktreePaths, cfg) {
  const lane = lanePlan.lanes[taskId]
  const wt = worktreePaths[taskId]
  const isStructural = lane.stage === 'structural'
  const { testFiles, implFiles } = classifyFiles(lane.files)
  const acStr = (lane.acceptance_criteria || []).join('\n')
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

  // ── Skeleton ──
  const preflight = await runSkeleton(taskId, wt, cfg)
  await commitStage(taskId, wt, `skeleton(${taskId})`, [...testFiles, ...implFiles], 'SKELETON')

  // ── RED ──
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
    `- Do NOT run any git commands (no git add, no git commit) — a separate agent handles commits`,
    { label: `red:${taskId}`, phase: 'Act', model: 'sonnet', schema: WRITE_RESULT_SCHEMA }
  )

  if (red && red.success) {
    log(`[${taskId}] RED wrote: ${(red.files_written || []).join(', ') || '(none reported)'}`)
  }

  if (!red || !red.success) {
    log(`[${taskId}] RED attempt 1 failed: ${(red && red.failure_reason) || 'no files written'}, retrying with hint`)
    await resetWorktree(taskId, wt, 'RED')
    red = await agent(
      `SETUP (run first): ${redCtxCmd}\n` +
      `TASK PACKET: ${redPacketStr}\n\n` +
      `RETRY HINT: Previous attempt failed (${(red && red.failure_reason) || 'unknown'}). ` +
      `Focus on writing simple, concrete assertions that test the acceptance criteria directly. ` +
      `Do not overthink — one test per AC, assert specific values.\n` +
      `Do NOT run any git commands — a separate agent handles commits.`,
      { label: `red-retry:${taskId}`, phase: 'Act', model: 'sonnet', schema: WRITE_RESULT_SCHEMA }
    )
  }

  if (!red || !red.success) {
    const err = (red && red.failure_reason) || 'RED agent did not write files after 2 attempts'
    log(`[${taskId}] RED FAILED after 2 attempts: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: err }
  }

  const redCommit = await commitStage(taskId, wt, redPacket.commit_prefix, testFiles, 'RED')
  if (!redCommit || !redCommit.committed) {
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `git commit failed: ${(redCommit && redCommit.failure_reason) || 'unknown'}` }
  }

  // ── Verify RED + Reflect (parallel) ──
  const [redCheck, reflect] = await parallel([
    () => verifyStage(taskId, wt, 'red', laneCfg.testCommand),
    () => agent(
      `You are a TEST QUALITY evaluator. Read files and score — do NOT write or modify anything.\n` +
      `Read these test files in "${wt}": ${testFiles.join(', ')}\n` +
      `Score the tests written for these acceptance criteria:\n${acStr}\n` +
      `Return your score (0-10), reasoning, and gaps found.`,
      { label: `reflect:${taskId}`, phase: 'Act', model: 'haiku', schema: REFLECT_SCHEMA }
    ),
  ])

  if (!redCheck || !redCheck.verified) {
    const err = (redCheck && redCheck.error) || 'green_blindness_violation: tests passed after RED'
    log(`[${taskId}] RED VERIFY FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: err }
  }
  log(`[${taskId}] RED verified — tests fail as expected`)

  const reflectScore = (reflect && reflect.score) || 0
  log(`[${taskId}] Test quality: ${reflectScore}/10 — ${(reflect && reflect.reasoning) || 'no reasoning'}`)
  if (reflect && reflect.gaps && reflect.gaps.length > 0) {
    log(`[${taskId}]   gaps: ${reflect.gaps.join('; ')}`)
  }
  if (reflectScore < 4) {
    log(`[${taskId}] RED FAILED: test quality too low (${reflectScore}/10)`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `test quality ${reflectScore}/10` }
  }

  // ── GREEN context ──
  const signal = (redCheck && redCheck.test_signal) || { exit_code: 1, errors: [], assertion_messages: [] }
  const contractSummary = extractContractSummary(lane.acceptance_criteria)

  // ── GREEN (sonnet first, opus on retry) ──
  const greenModel = lane.green_model || 'sonnet'
  log(`[${taskId}] GREEN: making tests pass (model: ${greenModel}, contracts: ${contractSummary.length})`)

  const greenPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'GREEN', {
    test_signal: signal,
    preflight: preflight,
    contract_summary: contractSummary,
    impl_stubs: preflight.impl_stubs || [],
    existing_api: preflight.existing_api || {},
  })
  const greenCtxCmd = laneCtxCmd(greenPacket, wt)

  let green = await agent(
    `SETUP (run first): ${greenCtxCmd}\n` +
    `TASK PACKET: ${JSON.stringify(greenPacket)}\n\n` +
    `CONTEXT:\n` +
    `- contract_summary: structured function signatures extracted from ACs — implement these\n` +
    `- impl_stubs: stub files already created with function signatures and ... bodies — fill them in\n` +
    `- existing_api: skeleton of existing module code — understand the API shape before extending\n` +
    `- red_note: what behaviors the tests check for\n` +
    `- test_signal: error messages from failing tests\n` +
    `Write MINIMUM code to make tests pass — nothing more.\n` +
    `Do NOT run any git commands — a separate agent handles commits.`,
    { label: `green:${taskId}`, phase: 'Act', model: greenModel, schema: WRITE_RESULT_SCHEMA }
  )

  if (green && green.success) {
    log(`[${taskId}] GREEN wrote: ${(green.files_written || []).join(', ') || '(none reported)'}`)
  }

  if (!green || !green.success) {
    const escalatedModel = 'opus'
    log(`[${taskId}] GREEN attempt 1 failed (${greenModel}): ${(green && green.failure_reason) || 'no files written'}, escalating to ${escalatedModel}`)

    await resetWorktree(taskId, wt, 'GREEN')

    const retryCheck = await verifyStage(taskId, wt, 'red', laneCfg.testCommand)
    const retrySignal = (retryCheck && retryCheck.test_signal) || signal
    const retryPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'GREEN', {
      test_signal: retrySignal,
      preflight: preflight,
      contract_summary: contractSummary,
      impl_stubs: preflight.impl_stubs || [],
      existing_api: preflight.existing_api || {},
      retry_hint: `Previous attempt failed: ${(green && green.failure_reason) || 'unknown'}. Read the FULL error output carefully. Fix the implementation.`,
    })
    green = await agent(
      `SETUP (run first): ${greenCtxCmd}\n` +
      `TASK PACKET: ${JSON.stringify(retryPacket)}\n\n` +
      `CONTEXT: RETRY — previous attempt failed. Read existing implementation files.\n` +
      `- contract_summary: function signatures to implement\n` +
      `- impl_stubs/existing_api: fill in bodies, don't start from scratch\n` +
      `- test_signal: current errors to fix\n` +
      `Do NOT run any git commands — a separate agent handles commits.`,
      { label: `green-retry:${taskId}`, phase: 'Act', model: escalatedModel, schema: WRITE_RESULT_SCHEMA }
    )
  }

  if (!green || !green.success) {
    const err = (green && green.failure_reason) || 'GREEN agent did not write files after 2 attempts'
    log(`[${taskId}] GREEN FAILED after 2 attempts: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: err }
  }

  const greenCommit = await commitStage(taskId, wt, greenPacket.commit_prefix, implFiles, 'GREEN')
  if (!greenCommit || !greenCommit.committed) {
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: `git commit failed: ${(greenCommit && greenCommit.failure_reason) || 'unknown'}` }
  }

  // ── Verify GREEN ──
  const greenCheck = await verifyStage(taskId, wt, 'green', laneCfg.testCommand)

  if (!greenCheck || !greenCheck.verified) {
    const err = (greenCheck && greenCheck.error) || 'tests still failing after GREEN'
    log(`[${taskId}] GREEN VERIFY FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: err }
  }
  log(`[${taskId}] GREEN verified — all tests pass`)

  // ── Adversarial skeptic panel (3 lenses, parallel, consensus) ──
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

  const { allBugs, brokenCount, crossValidated } = crossValidateBugs(skepticResults, SKEPTIC_LENSES)

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

  // ── File ownership check ──
  const allAllowed = new Set([...testFiles, ...implFiles])
  const writtenFiles = [...(red.files_written || []), ...(green.files_written || [])]
  const violations = writtenFiles.filter(f => !allAllowed.has(f))
  if (violations.length > 0) {
    log(`[${taskId}] FILE OWNERSHIP VIOLATION: ${violations.join(', ')}`)
  }

  // ── REFACTOR ──
  const refResult = await runRefactor(taskId, lane, testFiles, implFiles, wt, laneCfg)
  if (!refResult) {
    return { task_id: taskId, status: 'failed', stage: 'REFACTOR', error: 'refactor failed' }
  }

  log(`[${taskId}] === LANE COMPLETE ===`)
  return { task_id: taskId, status: 'completed' }
}

async function runRefactor(taskId, lane, testFiles, implFiles, wt, cfg) {
  log(`[${taskId}] REFACTOR: checking if needed`)

  const preCheck = await agent(
    `You are a CODE QUALITY evaluator. Read files and assess — do NOT write or modify anything.\n` +
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
    `TASK PACKET: ${JSON.stringify(refactorPacket)}\n` +
    `Do NOT run any git commands — a separate agent handles commits.`,
    { label: `refactor:${taskId}`, phase: 'Act', model: 'sonnet', schema: WRITE_RESULT_SCHEMA }
  )

  if (!refactor) {
    log(`[${taskId}] REFACTOR FAILED: agent returned null`)
    return null
  }
  if (!refactor.success && refactor.failure_reason && !refactor.failure_reason.toLowerCase().includes('nothing to')) {
    log(`[${taskId}] REFACTOR FAILED: ${refactor.failure_reason}`)
    return null
  }
  if (!refactor.success) {
    log(`[${taskId}] REFACTOR: nothing to change`)
    return { verified: true }
  }

  log(`[${taskId}] REFACTOR wrote: ${(refactor.files_written || []).join(', ') || '(none reported)'}`)

  const refCommit = await commitStage(taskId, wt, refactorPacket.commit_prefix, [...testFiles, ...implFiles], 'REFACTOR')
  if (!refCommit || !refCommit.committed) {
    log(`[${taskId}] REFACTOR commit failed — reverting`)
    await resetWorktree(taskId, wt, 'REFACTOR')
    return { verified: true }
  }

  const check = await verifyStage(taskId, wt, 'green', cfg.testCommand)

  if (!check || !check.verified) {
    log(`[${taskId}] REFACTOR verification FAILED: ${(check && check.error) || 'tests broke'} — reverting`)
    await revertLastCommit(taskId, wt, 'REFACTOR')
    return { verified: true }
  }
  return check
}

// ── DAG scheduler ───────────────────────────────────────────────────────────

const a = args
phase('Act')

const { batchLaneIds, lanePlan, worktreePaths, cfg, priorFailures, batchTag } = a
const lanes = lanePlan.lanes
const depResolvers = {}
const depPromises = {}
for (const id of batchLaneIds) {
  depPromises[id] = new Promise(resolve => { depResolvers[id] = resolve })
}

log(`DAG scheduler${batchTag}: ${batchLaneIds.length} tasks, starting as deps resolve`)

const dagResults = await parallel(
  batchLaneIds.map(taskId => async () => {
    const allDeps = lanes[taskId].depends_on || []
    const crossBatchFailed = allDeps.filter(d => !batchLaneIds.includes(d) && priorFailures.includes(d))
    if (crossBatchFailed.length > 0) {
      const err = `skipped: cross-batch dep(s) failed [${crossBatchFailed.join(', ')}]`
      log(`[${taskId}] ${err}`)
      const skipResult = { task_id: taskId, status: 'failed', stage: 'SKIPPED', error: err }
      depResolvers[taskId](skipResult)
      return skipResult
    }

    const inBatchDeps = allDeps.filter(d => batchLaneIds.includes(d))
    if (inBatchDeps.length > 0) {
      log(`[${taskId}] waiting on deps: [${inBatchDeps.join(', ')}]`)
      const depResults = await Promise.all(inBatchDeps.map(d => depPromises[d]))
      const failedDeps = depResults.filter(r => r.status !== 'completed')
      if (failedDeps.length > 0) {
        const err = `skipped: dep(s) failed [${failedDeps.map(r => r.task_id).join(', ')}]`
        log(`[${taskId}] ${err}`)
        const skipResult = { task_id: taskId, status: 'failed', stage: 'SKIPPED', error: err }
        depResolvers[taskId](skipResult)
        return skipResult
      }
    }

    log(`[${taskId}] deps satisfied — launching`)
    const result = await runLane(taskId, lanePlan, worktreePaths, cfg)
      .then(r => r || { task_id: taskId, status: 'failed', stage: 'UNKNOWN', error: 'null result' })
      .catch(e => ({ task_id: taskId, status: 'failed', stage: 'CRASH', error: String(e) }))
    depResolvers[taskId](result)
    return result
  })
)

const results = {}
for (let i = 0; i < batchLaneIds.length; i++) {
  results[batchLaneIds[i]] = dagResults[i]
}

return { results }
