// datum-tdd-act-lane.ts — Act phase: RED->GREEN->REFACTOR per lane with DAG scheduling.
// Consolidated agents: each TDD stage writes code, verifies, and commits in one agent call.

import type {
  LaneArgs,
  LaneOutcome,
  LanePlan,
  Lane,
  PipelineConfig,
  StageResult,
  ReflectResult,
  SkepticResult,
  RefactorCheck,
  TaskPacket,
} from './shared/types'
import {
  STAGE_RESULT_SCHEMA,
  REFLECT_SCHEMA,
  SKEPTIC_SCHEMA,
  REFACTOR_CHECK_SCHEMA,
} from './shared/schemas'
import {
  classifyFiles,
  laneCtxCmd,
  extractContractSummary,
  crossValidateBugs,
  buildPacket,
  parseAgentJson,
} from './shared/utils'
import {
  redPrompt,
  redRetryPrompt,
  greenPrompt,
  greenRetryPrompt,
  refactorPrompt,
  reflectPrompt,
  skepticBasePrompt,
  skepticLenses,
  refactorCheckPrompt,
} from './shared/prompts'

export const meta = {
  name: 'datum-tdd-act-lane',
  description: 'DAG-scheduled TDD execution: RED->GREEN->REFACTOR per lane',
  phases: [{ title: 'Act' }],
}

// ── File ownership verification ─────────────────────────────────────────────

async function verifyFileOwnership(
  taskId: string,
  wt: string,
  stage: string,
  allowedFiles: string[],
  forbiddenFiles: string[],
): Promise<{ ok: boolean; violations: string[] }> {
  const result: string | null = await agent(
    `Run: git -C "${wt}" diff --name-only HEAD~1 HEAD
Return ONLY a JSON object: {"files_changed": ["path1", "path2"]}
No markdown fences, no explanation.`,
    { label: `ownership-check:${taskId}:${stage}`, phase: 'Act', model: 'haiku' },
  )

  if (!result) return { ok: true, violations: [] }

  const parsed = typeof result === 'string'
    ? parseAgentJson<{ files_changed?: string[] }>(result, {})
    : result as { files_changed?: string[] }

  const changed = parsed.files_changed || []
  const violations: string[] = []

  for (const f of changed) {
    if (forbiddenFiles.some((fb) => f.endsWith(fb) || fb.endsWith(f))) {
      violations.push(`${f} is owned by another lane`)
    }
    if (allowedFiles.length > 0 && !allowedFiles.some((a) => f.endsWith(a) || a.endsWith(f))) {
      violations.push(`${f} is not in allowed files list`)
    }
  }

  return { ok: violations.length === 0, violations }
}

// ── Per-lane TDD saga ───────────────────────────────────────────────────────

async function runLane(
  taskId: string,
  lanePlan: LanePlan,
  worktreePaths: Record<string, string>,
  cfg: PipelineConfig,
): Promise<LaneOutcome> {
  const lane: Lane = lanePlan.lanes[taskId]
  const wt: string = worktreePaths[taskId]
  const isStructural: boolean = lane.stage === 'structural'
  const { testFiles, implFiles } = classifyFiles(lane.files)
  const acStr: string = (lane.acceptance_criteria || []).join('\n')
  const laneTestCmd: string = testFiles.length > 0
    ? `uv run pytest ${testFiles.join(' ')} -x -q`
    : cfg.testCommand
  const laneCfg: PipelineConfig = { ...cfg, testCommand: laneTestCmd }

  log(`[${taskId}] Starting: ${lane.title} (${isStructural ? 'structural' : 'behavioral'}, ${testFiles.length} test, ${implFiles.length} impl)`)

  if (isStructural) {
    const r = await runRefactor(taskId, lane, testFiles, implFiles, wt, laneCfg)
    if (!r) return { task_id: taskId, status: 'failed', stage: 'REFACTOR', error: 'refactor failed' }
    return { task_id: taskId, status: 'completed' }
  }

  // ── RED (writes tests + verifies they fail + commits) ──
  log(`[${taskId}] RED: writing failing tests`)
  const redPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'RED', {})
  const redCtxCmd: string = laneCtxCmd(redPacket, wt)
  const skeletonCmd = `datum skeleton --task-id ${taskId} --language ${cfg.language} --tasks ${cfg.lanePlanPath} --output .datum/runs/${cfg.runId}/preflight-${taskId}.json`

  const promptVars = {
    wt,
    skeletonCmd,
    redCtxCmd,
    redPacketStr: JSON.stringify(redPacket),
    testCommand: laneTestCmd,
    testFilesList: testFiles.join(' '),
    commitPrefix: redPacket.commit_prefix,
  }

  let red: StageResult | null = await agent(
    redPrompt(promptVars),
    { label: `red:${taskId}`, phase: 'Act', model: 'sonnet', schema: STAGE_RESULT_SCHEMA },
  )

  if (red?.success) {
    log(`[${taskId}] RED wrote: ${(red.files_written || []).join(', ')}`)
  }

  if (!red || !red.success) {
    log(`[${taskId}] RED attempt 1 failed: ${red?.failure_reason || 'unknown'}, retrying`)
    red = await agent(
      redRetryPrompt({ ...promptVars, failureReason: red?.failure_reason || 'unknown' }),
      { label: `red-retry:${taskId}`, phase: 'Act', model: 'sonnet', schema: STAGE_RESULT_SCHEMA },
    )
  }

  if (!red || !red.success) {
    log(`[${taskId}] RED FAILED: ${red?.failure_reason || 'no files written after 2 attempts'}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: red?.failure_reason || 'RED failed' }
  }

  // Structural assertion check — catch placeholder tests before relying on the boolean
  const assertionCheck: { has_placeholders: boolean; detail: string } | null = await agent(
    `Scan the test files in "${wt}" for placeholder assertions that would never fail.
Read these files: ${testFiles.join(', ')}

Search for these patterns in NEW test functions (ignore pre-existing tests):
- \`assert True\` or \`assert 1\`
- \`pass\` as the only statement in a test function body
- Empty test functions (just \`def test_...(...):\` with no body or only docstring)
- \`assert x is not None\` as the ONLY assertion (smoke test, not a real check)
- \`raise NotImplementedError\` in test bodies

Return JSON: {"has_placeholders": true/false, "detail": "which functions and what pattern"}
Output raw JSON only. No markdown fences.`,
    { label: `assert-check:${taskId}`, phase: 'Act', model: 'haiku' },
  )

  let placeholderWarning = ''
  if (assertionCheck) {
    const parsed = typeof assertionCheck === 'string'
      ? parseAgentJson<{ has_placeholders?: boolean; detail?: string }>(assertionCheck, {})
      : assertionCheck as { has_placeholders?: boolean; detail?: string }
    if (parsed.has_placeholders) {
      placeholderWarning = parsed.detail || 'placeholder assertions detected'
      log(`[${taskId}] RED: placeholder assertions found — ${placeholderWarning}`)
      return { task_id: taskId, status: 'failed', stage: 'RED', error: `placeholder_assertions: ${placeholderWarning}` }
    }
  }

  if (red.tests_pass) {
    const diag = red.test_output || red.test_errors?.join('; ') || 'no test output captured'
    log(`[${taskId}] RED VERIFY FAILED: tests passed (green blindness). Output: ${diag}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `green_blindness_violation: tests passed after RED. Test output: ${diag}` }
  }
  log(`[${taskId}] RED verified — tests fail as expected (committed: ${red.commit_sha || 'n/a'})`)

  if (!red.committed) {
    log(`[${taskId}] RED: agent did not commit — failing`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: 'RED agent did not commit' }
  }

  const redOwnership = await verifyFileOwnership(taskId, wt, 'RED', testFiles, implFiles)
  if (!redOwnership.ok) {
    log(`[${taskId}] RED FILE OWNERSHIP VIOLATION: ${redOwnership.violations.join(', ')}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `file_ownership_violation: ${redOwnership.violations.join(', ')}` }
  }

  // ── Reflect (independent evaluator — stays separate) ──
  const reflectResult: ReflectResult | null = await agent(
    reflectPrompt({ wt, testFiles: testFiles.join(', '), acStr }),
    { label: `reflect:${taskId}`, phase: 'Act', model: 'haiku', schema: REFLECT_SCHEMA },
  )

  const reflectScore: number = reflectResult?.score || 0
  log(`[${taskId}] Test quality: ${reflectScore}/10 — ${reflectResult?.reasoning || 'no reasoning'}`)
  if (reflectResult?.gaps?.length) {
    log(`[${taskId}]   gaps: ${reflectResult.gaps.join('; ')}`)
  }
  if (reflectScore < 4) {
    log(`[${taskId}] RED FAILED: test quality too low (${reflectScore}/10)`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `test quality ${reflectScore}/10` }
  }

  // ── GREEN (writes implementation + verifies tests pass + commits) ──
  const greenModel = (lane.green_model || 'sonnet') as 'haiku' | 'sonnet' | 'opus'
  const contractSummary = extractContractSummary(lane.acceptance_criteria || [])
  log(`[${taskId}] GREEN: making tests pass (model: ${greenModel})`)

  const greenPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'GREEN', {
    test_signal: { exit_code: red.test_exit_code || 1, errors: red.test_errors || [] },
    contract_summary: contractSummary,
  })
  const greenCtxCmd: string = laneCtxCmd(greenPacket, wt)

  const greenVars = {
    wt,
    greenCtxCmd,
    greenPacketStr: JSON.stringify(greenPacket),
    testCommand: laneTestCmd,
    implFilesList: implFiles.join(' '),
    commitPrefix: greenPacket.commit_prefix,
  }

  let green: StageResult | null = await agent(
    greenPrompt(greenVars),
    { label: `green:${taskId}`, phase: 'Act', model: greenModel, schema: STAGE_RESULT_SCHEMA },
  )

  if (green?.success) {
    log(`[${taskId}] GREEN wrote: ${(green.files_written || []).join(', ')}`)
  }

  if (!green || !green.success || !green.tests_pass) {
    log(`[${taskId}] GREEN attempt 1 failed (${greenModel}): ${green?.failure_reason || 'unknown'}, escalating to opus`)
    green = await agent(
      greenRetryPrompt({
        ...greenVars,
        failureReason: green?.failure_reason || 'unknown',
        greenRetryPacketStr: JSON.stringify({ ...greenPacket, retry_hint: green?.failure_reason }),
      }),
      { label: `green-retry:${taskId}`, phase: 'Act', model: 'opus', schema: STAGE_RESULT_SCHEMA },
    )
  }

  if (!green || !green.success || !green.tests_pass) {
    log(`[${taskId}] GREEN FAILED: ${green?.failure_reason || 'tests still failing after 2 attempts'}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: green?.failure_reason || 'GREEN failed' }
  }

  if (!green.committed) {
    log(`[${taskId}] GREEN: agent did not commit — failing`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: 'GREEN agent did not commit' }
  }

  const greenOwnership = await verifyFileOwnership(taskId, wt, 'GREEN', implFiles, testFiles)
  if (!greenOwnership.ok) {
    log(`[${taskId}] GREEN FILE OWNERSHIP VIOLATION: ${greenOwnership.violations.join(', ')}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: `file_ownership_violation: ${greenOwnership.violations.join(', ')}` }
  }
  log(`[${taskId}] GREEN verified — all tests pass (committed: ${green.commit_sha || 'n/a'})`)

  // ── Adversarial skeptic panel (independent evaluators — stay separate) ──
  const base: string = skepticBasePrompt({
    wt, implFiles: implFiles.join(', '), testFiles: testFiles.join(', '),
    testCommand: laneTestCmd, acStr,
  })
  const lenses = skepticLenses()
  const skepticResults = await parallel<SkepticResult>(
    lenses.map((lens) => () =>
      agent(base + lens.prompt, { label: `skeptic-${lens.key}:${taskId}`, phase: 'Act', model: lens.model, schema: SKEPTIC_SCHEMA })
    ),
  )

  const { allBugs, brokenCount, crossValidated } = crossValidateBugs(skepticResults, lenses)
  for (let i = 0; i < lenses.length; i++) {
    const s = skepticResults[i]
    if (!s) { log(`[${taskId}] SKEPTIC ${lenses[i].key}: (null)`); continue }
    log(`[${taskId}] SKEPTIC ${lenses[i].key}: ${s.verdict} (${(s.bugs_found || []).length} bugs)`)
    for (const bug of (s.bugs_found || [])) {
      log(`[${taskId}]   - [${bug.severity}] ${bug.description}`)
    }
  }
  if (brokenCount >= 2) {
    log(`[${taskId}] SKEPTIC VERDICT: ${brokenCount}/3 BROKEN`)
  } else {
    log(`[${taskId}] SKEPTIC VERDICT: PASS (${crossValidated.length} cross-validated)`)
  }

  // ── REFACTOR (writes + verifies + commits in one agent) ──
  const refResult = await runRefactor(taskId, lane, testFiles, implFiles, wt, laneCfg)
  if (!refResult) {
    return { task_id: taskId, status: 'failed', stage: 'REFACTOR', error: 'refactor failed' }
  }

  log(`[${taskId}] === LANE COMPLETE ===`)
  return { task_id: taskId, status: 'completed' }
}

// ── Refactor sub-saga ──────────────────────────────────────────────────────

async function runRefactor(
  taskId: string,
  lane: Lane,
  testFiles: string[],
  implFiles: string[],
  wt: string,
  cfg: PipelineConfig,
): Promise<{ verified: boolean } | null> {
  log(`[${taskId}] REFACTOR: checking if needed`)

  const preCheck: RefactorCheck | null = await agent(
    refactorCheckPrompt({ wt, allFiles: [...implFiles, ...testFiles].join(', ') }),
    { label: `refactor-check:${taskId}`, phase: 'Act', model: 'haiku', schema: REFACTOR_CHECK_SCHEMA },
  )

  if (!preCheck?.should_refactor) {
    log(`[${taskId}] REFACTOR: skipped (${preCheck?.reason || 'nothing to improve'})`)
    return { verified: true }
  }

  log(`[${taskId}] REFACTOR: proceeding (${preCheck.reason})`)

  const refactorPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, cfg, 'REFACTOR', {})
  const refactorCtxCmd: string = laneCtxCmd(refactorPacket, wt)

  const refactor: StageResult | null = await agent(
    refactorPrompt({
      wt,
      refactorCtxCmd,
      refactorPacketStr: JSON.stringify(refactorPacket),
      testCommand: cfg.testCommand,
      allFilesList: [...testFiles, ...implFiles].join(' '),
      commitPrefix: refactorPacket.commit_prefix,
    }),
    { label: `refactor:${taskId}`, phase: 'Act', model: 'sonnet', schema: STAGE_RESULT_SCHEMA },
  )

  if (!refactor?.success) {
    if (refactor?.failure_reason?.toLowerCase().includes('nothing to')) {
      log(`[${taskId}] REFACTOR: nothing to change`)
      return { verified: true }
    }
    log(`[${taskId}] REFACTOR FAILED: ${refactor?.failure_reason || 'null'}`)
    return null
  }

  if (!refactor.tests_pass) {
    log(`[${taskId}] REFACTOR broke tests — agent should not have committed`)
    if (refactor.committed) {
      await agent(
        `git -C "${wt}" revert --no-edit HEAD`,
        { label: `revert-refactor:${taskId}`, phase: 'Act', model: 'haiku' },
      )
    }
    return { verified: true }
  }

  log(`[${taskId}] REFACTOR: clean (committed: ${refactor.commit_sha || 'n/a'})`)
  return { verified: true }
}

// ── DAG scheduler ───────────────────────────────────────────────────────────

const a = args as LaneArgs
phase('Act')

const { batchLaneIds, lanePlan, worktreePaths, cfg, priorFailures, batchTag } = a
const lanes = lanePlan.lanes
const depResolvers: Record<string, (value: LaneOutcome) => void> = {}
const depPromises: Record<string, Promise<LaneOutcome>> = {}

for (const id of batchLaneIds) {
  depPromises[id] = new Promise<LaneOutcome>((resolve) => { depResolvers[id] = resolve })
}

log(`DAG scheduler${batchTag}: ${batchLaneIds.length} tasks`)

const dagResults: (LaneOutcome | null)[] = await parallel<LaneOutcome>(
  batchLaneIds.map((taskId: string) => async (): Promise<LaneOutcome> => {
    const allDeps: string[] = lanes[taskId].depends_on || []
    const crossBatchFailed: string[] = allDeps.filter((d) => !batchLaneIds.includes(d) && priorFailures.includes(d))

    if (crossBatchFailed.length > 0) {
      const err = `skipped: cross-batch dep(s) failed [${crossBatchFailed.join(', ')}]`
      log(`[${taskId}] ${err}`)
      const skipResult: LaneOutcome = { task_id: taskId, status: 'failed', stage: 'SKIPPED', error: err }
      depResolvers[taskId](skipResult)
      return skipResult
    }

    const inBatchDeps: string[] = allDeps.filter((d) => batchLaneIds.includes(d))
    if (inBatchDeps.length > 0) {
      log(`[${taskId}] waiting on deps: [${inBatchDeps.join(', ')}]`)
      const depResults: LaneOutcome[] = await Promise.all(inBatchDeps.map((d) => depPromises[d]))
      const failedDeps: LaneOutcome[] = depResults.filter((r) => r.status !== 'completed')
      if (failedDeps.length > 0) {
        const err = `skipped: dep(s) failed [${failedDeps.map((r) => r.task_id).join(', ')}]`
        log(`[${taskId}] ${err}`)
        const skipResult: LaneOutcome = { task_id: taskId, status: 'failed', stage: 'SKIPPED', error: err }
        depResolvers[taskId](skipResult)
        return skipResult
      }
    }

    log(`[${taskId}] deps satisfied — launching`)
    let result: LaneOutcome
    try {
      const r = await runLane(taskId, lanePlan, worktreePaths, cfg)
      result = r || { task_id: taskId, status: 'failed', stage: 'UNKNOWN', error: 'null result' }
    } catch (e) {
      result = { task_id: taskId, status: 'failed', stage: 'CRASH', error: String(e) }
    }
    depResolvers[taskId](result)
    return result
  }),
)

const results: Record<string, LaneOutcome> = {}
for (let i = 0; i < batchLaneIds.length; i++) {
  results[batchLaneIds[i]] = dagResults[i]!
}

export const __workflowResult = { results }
