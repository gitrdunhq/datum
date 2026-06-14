// datum-tdd-act-lane.ts — Act phase: RED->GREEN->REFACTOR per lane with DAG scheduling.

import type {
  LaneArgs,
  LaneOutcome,
  LanePlan,
  Lane,
  PipelineConfig,
  WriteResult,
  ReflectResult,
  SkepticResult,
  RefactorCheck,
  VerifyResult,
  CommitResult,
  TestSignal,
  TaskPacket,
} from './shared/types'
import {
  WRITE_RESULT_SCHEMA,
  REFLECT_SCHEMA,
  SKEPTIC_SCHEMA,
  REFACTOR_CHECK_SCHEMA,
} from './shared/schemas'
import {
  classifyFiles,
  parseAgentJson,
  laneCtxCmd,
  extractContractSummary,
  crossValidateBugs,
  buildPacket,
} from './shared/utils'
import {
  commitStage,
  resetWorktree,
  revertLastCommit,
  verifyStage,
  runSkeleton,
} from './shared/agents'
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
  description: 'DAG-scheduled TDD execution: RED->verify->GREEN->verify->REFACTOR per lane',
  phases: [{ title: 'Act' }],
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
  const redPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'RED', {})
  const redPacketStr: string = JSON.stringify(redPacket)
  const redCtxCmd: string = laneCtxCmd(redPacket, wt)

  let red: WriteResult | null = await agent(
    redPrompt({ redCtxCmd, redPacketStr }),
    { label: `red:${taskId}`, phase: 'Act', model: 'sonnet', schema: WRITE_RESULT_SCHEMA },
  )

  if (red && red.success) {
    log(`[${taskId}] RED wrote: ${(red.files_written || []).join(', ') || '(none reported)'}`)
  }

  if (!red || !red.success) {
    log(`[${taskId}] RED attempt 1 failed: ${(red && red.failure_reason) || 'no files written'}, retrying with hint`)
    await resetWorktree(taskId, wt, 'RED')
    red = await agent(
      redRetryPrompt({
        failureReason: (red && red.failure_reason) || 'unknown',
        redCtxCmd,
        redPacketStr,
      }),
      { label: `red-retry:${taskId}`, phase: 'Act', model: 'sonnet', schema: WRITE_RESULT_SCHEMA },
    )
  }

  if (!red || !red.success) {
    const err: string = (red && red.failure_reason) || 'RED agent did not write files after 2 attempts'
    log(`[${taskId}] RED FAILED after 2 attempts: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: err }
  }

  const redCommit: CommitResult | null = await commitStage(taskId, wt, redPacket.commit_prefix, testFiles, 'RED')
  if (!redCommit || !redCommit.committed) {
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `git commit failed: ${(redCommit && redCommit.failure_reason) || 'unknown'}` }
  }

  // ── Verify RED + Reflect (parallel) ──
  const [redCheck, reflect] = await parallel<VerifyResult | ReflectResult>([
    () => verifyStage(taskId, wt, 'red', laneCfg.testCommand),
    () => agent(
      reflectPrompt({ wt, testFiles: testFiles.join(', '), acStr }),
      { label: `reflect:${taskId}`, phase: 'Act', model: 'haiku', schema: REFLECT_SCHEMA },
    ),
  ])

  const redVerify = redCheck as VerifyResult | null
  const reflectResult = reflect as ReflectResult | null

  if (!redVerify || !redVerify.verified) {
    const err: string = (redVerify && redVerify.error) || 'green_blindness_violation: tests passed after RED'
    log(`[${taskId}] RED VERIFY FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: err }
  }
  log(`[${taskId}] RED verified — tests fail as expected`)

  const reflectScore: number = (reflectResult && reflectResult.score) || 0
  log(`[${taskId}] Test quality: ${reflectScore}/10 — ${(reflectResult && reflectResult.reasoning) || 'no reasoning'}`)
  if (reflectResult && reflectResult.gaps && reflectResult.gaps.length > 0) {
    log(`[${taskId}]   gaps: ${reflectResult.gaps.join('; ')}`)
  }
  if (reflectScore < 4) {
    log(`[${taskId}] RED FAILED: test quality too low (${reflectScore}/10)`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `test quality ${reflectScore}/10` }
  }

  // ── GREEN context ──
  const signal: TestSignal = (redVerify && redVerify.test_signal) || { exit_code: 1, errors: [], assertion_messages: [] }
  const contractSummary = extractContractSummary(lane.acceptance_criteria || [])

  // ── GREEN (sonnet first, opus on retry) ──
  const greenModel = (lane.green_model || 'sonnet') as 'haiku' | 'sonnet' | 'opus'
  log(`[${taskId}] GREEN: making tests pass (model: ${greenModel}, contracts: ${contractSummary.length})`)

  const greenPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'GREEN', {
    test_signal: signal,
    preflight,
    contract_summary: contractSummary,
    impl_stubs: preflight.impl_stubs || [],
    existing_api: preflight.existing_api || {},
  })
  const greenCtxCmd: string = laneCtxCmd(greenPacket, wt)

  let green: WriteResult | null = await agent(
    greenPrompt({ greenCtxCmd, greenPacketStr: JSON.stringify(greenPacket) }),
    { label: `green:${taskId}`, phase: 'Act', model: greenModel, schema: WRITE_RESULT_SCHEMA },
  )

  if (green && green.success) {
    log(`[${taskId}] GREEN wrote: ${(green.files_written || []).join(', ') || '(none reported)'}`)
  }

  if (!green || !green.success) {
    const escalatedModel: 'opus' = 'opus'
    log(`[${taskId}] GREEN attempt 1 failed (${greenModel}): ${(green && green.failure_reason) || 'no files written'}, escalating to ${escalatedModel}`)

    await resetWorktree(taskId, wt, 'GREEN')

    const retryCheck: VerifyResult = await verifyStage(taskId, wt, 'red', laneCfg.testCommand)
    const retrySignal: TestSignal = (retryCheck && retryCheck.test_signal) || signal
    const retryPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'GREEN', {
      test_signal: retrySignal,
      preflight,
      contract_summary: contractSummary,
      impl_stubs: preflight.impl_stubs || [],
      existing_api: preflight.existing_api || {},
      retry_hint: `Previous attempt failed: ${(green && green.failure_reason) || 'unknown'}. Read the FULL error output carefully. Fix the implementation.`,
    })

    green = await agent(
      greenRetryPrompt({
        failureReason: (green && green.failure_reason) || 'unknown',
        greenCtxCmd,
        greenRetryPacketStr: JSON.stringify(retryPacket),
      }),
      { label: `green-retry:${taskId}`, phase: 'Act', model: escalatedModel, schema: WRITE_RESULT_SCHEMA },
    )
  }

  if (!green || !green.success) {
    const err: string = (green && green.failure_reason) || 'GREEN agent did not write files after 2 attempts'
    log(`[${taskId}] GREEN FAILED after 2 attempts: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: err }
  }

  const greenCommit: CommitResult | null = await commitStage(taskId, wt, greenPacket.commit_prefix, implFiles, 'GREEN')
  if (!greenCommit || !greenCommit.committed) {
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: `git commit failed: ${(greenCommit && greenCommit.failure_reason) || 'unknown'}` }
  }

  // ── Verify GREEN ──
  const greenCheck: VerifyResult = await verifyStage(taskId, wt, 'green', laneCfg.testCommand)

  if (!greenCheck || !greenCheck.verified) {
    const err: string = (greenCheck && greenCheck.error) || 'tests still failing after GREEN'
    log(`[${taskId}] GREEN VERIFY FAILED: ${err}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: err }
  }
  log(`[${taskId}] GREEN verified — all tests pass`)

  // ── Adversarial skeptic panel (3 lenses, parallel, consensus) ──
  const base: string = skepticBasePrompt({
    wt,
    implFiles: implFiles.join(', '),
    testFiles: testFiles.join(', '),
    testCommand: laneCfg.testCommand,
    acStr,
  })

  const lenses = skepticLenses()
  const skepticResults = await parallel<SkepticResult>(
    lenses.map((lens) => () =>
      agent(
        base + lens.prompt,
        { label: `skeptic-${lens.key}:${taskId}`, phase: 'Act', model: lens.model, schema: SKEPTIC_SCHEMA },
      ),
    ),
  )

  const { allBugs, brokenCount, crossValidated } = crossValidateBugs(skepticResults, lenses)

  for (let i = 0; i < lenses.length; i++) {
    const s = skepticResults[i]
    if (!s) { log(`[${taskId}] SKEPTIC ${lenses[i].key}: (null — agent failed)`); continue }
    const bugCount = (s.bugs_found || []).length
    log(`[${taskId}] SKEPTIC ${lenses[i].key}: ${s.verdict} (${bugCount} bugs, confidence: ${s.confidence || 'N/A'})`)
    for (const bug of (s.bugs_found || [])) {
      log(`[${taskId}]   - [${bug.severity || '?'}] ${bug.description}`)
    }
  }

  if (brokenCount >= 2) {
    const bugList = crossValidated.map((b) => `[${b.lens}] ${b.description}`).join('; ')
    log(`[${taskId}] SKEPTIC VERDICT: ${brokenCount}/3 BROKEN — ${crossValidated.length} cross-validated: ${bugList || 'none'}`)
  } else if (brokenCount === 1) {
    log(`[${taskId}] SKEPTIC VERDICT: 1/3 BROKEN (no consensus) — proceeding`)
  } else {
    log(`[${taskId}] SKEPTIC VERDICT: PASS (${allBugs.length} total findings, ${crossValidated.length} cross-validated)`)
  }

  // ── File ownership check ──
  const allAllowed = new Set([...testFiles, ...implFiles])
  const writtenFiles: string[] = [...(red.files_written || []), ...(green.files_written || [])]
  const violations: string[] = writtenFiles.filter((f) => !allAllowed.has(f))
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

  if (!preCheck || !preCheck.should_refactor) {
    log(`[${taskId}] REFACTOR: skipped (${(preCheck && preCheck.reason) || 'nothing to improve'})`)
    return { verified: true }
  }

  log(`[${taskId}] REFACTOR: proceeding (${preCheck.reason})`)

  const refactorPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, cfg, 'REFACTOR', {})
  const refactorCtxCmd: string = laneCtxCmd(refactorPacket, wt)

  const refactor: WriteResult | null = await agent(
    refactorPrompt({ refactorCtxCmd, refactorPacketStr: JSON.stringify(refactorPacket) }),
    { label: `refactor:${taskId}`, phase: 'Act', model: 'sonnet', schema: WRITE_RESULT_SCHEMA },
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

  const refCommit: CommitResult | null = await commitStage(taskId, wt, refactorPacket.commit_prefix, [...testFiles, ...implFiles], 'REFACTOR')
  if (!refCommit || !refCommit.committed) {
    log(`[${taskId}] REFACTOR commit failed — reverting`)
    await resetWorktree(taskId, wt, 'REFACTOR')
    return { verified: true }
  }

  const check: VerifyResult = await verifyStage(taskId, wt, 'green', cfg.testCommand)

  if (!check || !check.verified) {
    log(`[${taskId}] REFACTOR verification FAILED: ${(check && check.error) || 'tests broke'} — reverting`)
    await revertLastCommit(taskId, wt, 'REFACTOR')
    return { verified: true }
  }
  return check
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

log(`DAG scheduler${batchTag}: ${batchLaneIds.length} tasks, starting as deps resolve`)

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
