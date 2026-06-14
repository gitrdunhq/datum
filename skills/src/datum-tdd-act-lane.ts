import { model, type ModelName } from './shared/models'
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
    { label: `ownership-check:${taskId}:${stage}`, phase: 'Act', model: model('fast') },
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
      violations.push(`${f} is not in allowed files list [${allowedFiles.join(', ')}]`)
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
  const skeletonCmd = `datum skeleton --task-id ${taskId} --language ${cfg.language} --tasks ${cfg.lanePlanPath} --output .datum/runs/${cfg.runId}/preflight-${taskId}.json`
  const preflightPath = `.datum/runs/${cfg.runId}/preflight-${taskId}.json`

  // Extract target_context from preflight JSON if available
  let targetContext: Record<string, string[]> | undefined
  const preflightRaw: string | null = await agent(
    `Run: ${skeletonCmd}
Then read the output file: cat "${wt}/${preflightPath}" 2>/dev/null || echo "{}"
Return ONLY the raw JSON contents of the file. No markdown fences, no explanation.`,
    { label: `preflight:${taskId}`, phase: 'Act', model: model('fast') },
  )
  if (preflightRaw) {
    const preflightData = parseAgentJson<{ target_context?: Record<string, string[]> }>(preflightRaw, {})
    if (preflightData.target_context) {
      targetContext = preflightData.target_context
      log(`[${taskId}] target_context extracted: ${Object.keys(targetContext).join(', ')}`)
    }
  }

  const redExtras: Record<string, unknown> = targetContext ? { target_context: targetContext } : {}
  const redPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'RED', redExtras)
  const redCtxCmd: string = laneCtxCmd(redPacket, wt)

  const promptVars = {
    wt,
    skeletonCmd,
    redCtxCmd,
    redPacketStr: JSON.stringify(redPacket),
    testCommand: laneTestCmd,
    testFilesList: testFiles.join(' '),
    commitPrefix: redPacket.commit_prefix,
    taskId,
  }

  let red: StageResult | null = await agent(
    redPrompt(promptVars),
    { label: `red:${taskId}`, phase: 'Act', model: model('balanced'), schema: STAGE_RESULT_SCHEMA },
  )

  if (red?.success) {
    log(`[${taskId}] RED wrote: ${(red.files_written || []).join(', ')}`)
  }

  if (!red || !red.success) {
    log(`[${taskId}] RED attempt 1 failed: ${red?.failure_reason || 'unknown'}, retrying`)
    red = await agent(
      redRetryPrompt({ ...promptVars, failureReason: red?.failure_reason || 'unknown' }),
      { label: `red-retry:${taskId}`, phase: 'Act', model: model('balanced'), schema: STAGE_RESULT_SCHEMA },
    )
  }

  if (!red || !red.success) {
    log(`[${taskId}] RED FAILED: ${red?.failure_reason || 'no files written after 2 attempts'}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: red?.failure_reason || 'RED failed' }
  }

  // ── New-test-function count gate (deterministic, no LLM) ──
  const acCount = (lane.acceptance_criteria || []).length
  if (acCount > 0) {
    const countResult: string | null = await agent(
      `Run: git -C "${wt}" diff HEAD~1 HEAD -- ${testFiles.join(' ')} | grep -c '^+def test_' || echo 0
Return ONLY the number. No explanation.`,
      { label: `test-count-check:${taskId}`, phase: 'Act', model: model('fast') },
    )
    const newTestCount = parseInt(String(countResult).trim(), 10) || 0
    if (newTestCount < acCount) {
      log(`[${taskId}] RED FAILED: only ${newTestCount} new test functions found, need >= ${acCount} (one per AC)`)
      return { task_id: taskId, status: 'failed', stage: 'RED', error: `no_new_test_functions_committed: found ${newTestCount}, need >= ${acCount}` }
    }
    log(`[${taskId}] RED: ${newTestCount} new test functions confirmed (>= ${acCount} ACs)`)
  }

  // Structural assertion check — deterministic ast-grep scan, no LLM needed
  const sgPatterns = [
    { pattern: 'assert True', name: 'assert True' },
    { pattern: 'assert 1', name: 'assert 1' },
    { pattern: 'raise NotImplementedError', name: 'raise NotImplementedError' },
  ]
  const sgResult = await agent(
    `Run these ast-grep commands on the test files and report what was found.
For each command, capture the output. If ast-grep is not available, fall back to grep.

${testFiles.map((f) => sgPatterns.map((p) =>
    `ast-grep --pattern '${p.pattern}' "${wt}/${f}" 2>/dev/null || grep -n '${p.pattern}' "${wt}/${f}" 2>/dev/null`
  ).join('\n')).join('\n')}

Also check for pass-only test bodies:
${testFiles.map((f) =>
    `grep -A1 'def test_' "${wt}/${f}" 2>/dev/null | grep -B1 '^\\s*pass$' 2>/dev/null`
  ).join('\n')}

Return JSON: {"has_placeholders": true/false, "detail": "which files:lines and what pattern, or empty if clean"}
Output raw JSON only.`,
    { label: `assert-check:${taskId}`, phase: 'Act', model: model('fast') },
  )

  const assertParsed = parseAgentJson<{ has_placeholders?: boolean; detail?: string }>(sgResult as string, {})
  if (assertParsed.has_placeholders) {
    log(`[${taskId}] RED: placeholder assertions found — ${assertParsed.detail}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `placeholder_assertions: ${assertParsed.detail}` }
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

  // ── Pre-reflect: verify new tests were actually written ──
  const testCountResult = await agent(
    `Count test functions in these files:
${testFiles.map(f => `grep -c "def test_\\\\|async def test_" "${wt}/${f}" 2>/dev/null || echo 0`).join('\n')}
Also check the parent commit:
${testFiles.map(f => `git -C "${wt}" show HEAD~1:"${f}" 2>/dev/null | grep -c "def test_\\\\|async def test_" || echo 0`).join('\n')}
Return JSON: {"before": <total_before>, "after": <total_after>, "new_count": <after - before>}
Output raw JSON only.`,
    { label: `test-count:${taskId}`, phase: 'Act', model: model('fast') },
  )

  const counts = parseAgentJson<{before?: number; after?: number; new_count?: number}>(testCountResult as string, {})
  if ((counts.new_count || 0) === 0) {
    log(`[${taskId}] RED FAILED: no new test functions written (before=${counts.before}, after=${counts.after})`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: 'no_new_tests_written: RED agent did not append any test functions' }
  }
  log(`[${taskId}] RED: ${counts.new_count} new test functions verified (${counts.before} → ${counts.after})`)

  // ── Reflect (independent evaluator — stays separate) ──
  const reflectResult: ReflectResult | null = await agent(
    reflectPrompt({ wt, testFiles: testFiles.join(', '), acStr }),
    { label: `reflect:${taskId}`, phase: 'Act', model: model('fast'), schema: REFLECT_SCHEMA },
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
  const greenModel = (lane.green_model || model('balanced')) as ModelName
  const contractSummary = extractContractSummary(lane.acceptance_criteria || [])
  log(`[${taskId}] GREEN: making tests pass (model: ${greenModel})`)

  const greenExtras: Record<string, unknown> = {
    test_signal: { exit_code: red.test_exit_code || 1, errors: red.test_errors || [] },
    contract_summary: contractSummary,
    ...(targetContext ? { target_context: targetContext } : {}),
  }
  const greenPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'GREEN', greenExtras)
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
      { label: `green-retry:${taskId}`, phase: 'Act', model: model('deep'), schema: STAGE_RESULT_SCHEMA },
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
      agent(base + lens.prompt, { label: `skeptic-${lens.key}:${taskId}`, phase: 'Act', model: lens.model as ModelName, schema: SKEPTIC_SCHEMA })
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
    { label: `refactor-check:${taskId}`, phase: 'Act', model: model('fast'), schema: REFACTOR_CHECK_SCHEMA },
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
    { label: `refactor:${taskId}`, phase: 'Act', model: model('balanced'), schema: STAGE_RESULT_SCHEMA },
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
        { label: `revert-refactor:${taskId}`, phase: 'Act', model: model('fast') },
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
