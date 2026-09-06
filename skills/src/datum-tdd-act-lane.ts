import { model, type ModelName } from './shared/models'
import { runCommandPrompt } from './shared/boot'
import { resilientAgent, runBatch, verifyCommitIndependently, parseCommitVerification } from './shared/agents'
import { updateStage, getIssueId } from './shared/tracker'
import { stageOpts, configureAgentTypes, deterministicChecks } from './shared/agent-types'
import { batchCommandPrompt, setBatchCacheKey, setBatchRoot, parseBatchResult, stepStdout, stepResult, describeFailure } from './shared/batch'
import {
  laneIntakeSteps,
  postRedSteps,
  scopeContractSteps,
  isMissing,
  newTestCountFromSteps,
  scopeContentsFromSteps,
  scopeReadTruncations,
  scopeReadCap,
  scopeGapsFromSteps,
  postGreenSteps,
  redCommittedFilesFromSteps,
  ownershipCheckSteps,
  depMergeSteps,
  depMergeFromSteps,
  ownershipFromStdout,
  testExitCode,
  verifyVerdict,
  testEnvMissing,
  laneSpecFromSteps,
  laneSpecContextFile,
  digestSpecHash,
  strayCleanSteps,
  codeTellSteps,
  parseTellScan,
  strayFilesFromSteps,
} from './shared/lane-steps'
import { worktreeResetSteps, worktreeResetToSteps, worktreeResetToFromSteps, commitFilesSteps, commitFilesFromSteps, preserveHeadRefSteps } from './shared/commit-steps'
import { assertReadWitness, verifyReadWitness, type ContextFile } from './shared/context-relay'
import { writeFileSteps, writeFileBlobSha, writeFileFromSteps } from './shared/write-steps'
// datum-tdd-act-lane.ts — Act phase: RED->GREEN->REFACTOR per lane with DAG scheduling.
// Consolidated agents: each TDD stage writes code, verifies, and commits in one agent call.

import type {
  LaneArgs,
  LaneOutcome,
  LanePlanDigest,
  Lane,
  PipelineConfig,
  StageResult,
  ReflectResult,
  SkepticResult,
  RefactorCheck,
  TaskPacket,
  ContractPreflight,
} from './shared/types'
import {
  STAGE_RESULT_SCHEMA,
  REFLECT_SCHEMA,
  SKEPTIC_SCHEMA,
  REFACTOR_CHECK_SCHEMA,
} from './shared/schemas'
import {
  classifyFiles,
  preflightTestPaths,
  laneCtxCmd,
  skepticMinorityFindings,
  minorityFollowUps,
  crossValidateBugs,
  buildPacket,
  parseAgentJson,
  verifyFileOwnership as verifyFileOwnershipMatch,
  extractRequiredScopeFiles,
  findScopeGaps,
  detectExistingLaneCommits,
  laneCommitCommand,
  parseContractPreflight,
  decideGreenBlock,
  autoWidenTargets,
  testRunCommand,
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

// Args + per-bundle module state first, before any function below can run:
// #368 this bundle has its own copy of the agent-types state — configure it
// from the switches the parent read out of .datum/config.json; #354 the
// resume cache key is stamped into every batch prompt.
const a = args as LaneArgs
const { batchLaneIds, lanePlan, worktreePaths, cfg, priorFailures, priorCompleted, batchTag } = a
configureAgentTypes(cfg.agentTypes || {})
setBatchCacheKey(cfg.configFingerprint || '')
setBatchRoot(cfg.repoRoot || '')

// ── File ownership verification ─────────────────────────────────────────────

interface OwnershipCheckResult {
  ok: boolean
  violations: string[]
  /** True when the check itself failed to run/parse (fail-closed), as
   *  opposed to a real file_ownership_violation. Callers must report these
   *  distinctly so triage can tell tooling failure from a real violation. */
  checkFailed?: boolean
}

async function verifyFileOwnership(
  taskId: string,
  wt: string,
  stage: string,
  allowedFiles: string[],
  forbiddenFiles: string[],
): Promise<OwnershipCheckResult> {
  // The same one-step batch the deterministic post-RED/post-GREEN reads carry
  // (shared/lane-steps.ts): the diff's stdout comes back inside the batch
  // result and is evaluated here by ownershipFromStdout. The runner used to
  // be told to run the diff and RETURN a JSON list of the changed paths — a
  // typed-back list that could drop a path and hide a real violation.
  const steps = ownershipCheckSteps(wt)
  const result = await runBatch(steps, stageOpts('cli', { label: `ownership-check:${taskId}:${stage}`, phase: 'Act', model: model('fast') }))

  // A missing result is a named tooling failure, never a clean check — the
  // ownership-check agent crashed, was skipped, or returned nothing parseable.
  // Failing OPEN here would let a real ownership violation sail through.
  if (result.missing) {
    return {
      ok: false,
      checkFailed: true,
      violations: [`ownership_check_failed: ownership-check batch returned no result for ${stage} on ${taskId} (${describeFailure(result, 'ownership-check')})`],
    }
  }

  const step = stepResult(result, 'ownership')
  if (!step || step.exit_code !== 0) {
    return {
      ok: false,
      checkFailed: true,
      violations: [`ownership_check_failed: git diff exited ${step ? step.exit_code : 'without running'} for ${stage} on ${taskId}: ${((step && (step.stderr || step.stdout)) || '').trim().split('\n').slice(-3).join(' | ')}`],
    }
  }

  const verdict = ownershipFromStdout(stepStdout(result, 'ownership'), allowedFiles, forbiddenFiles)
  return verdict.ok ? verdict : { ...verdict, checkFailed: verdict.violations.some((v) => v.startsWith('ownership_check_failed')) }
}

// ── Per-lane TDD saga ───────────────────────────────────────────────────────

/**
 * resilientAgent + read witness: a RED/GREEN/reflect result that does not
 * carry the lane-spec file's blob-sha prefix in read_witness THROWS
 * context_read_unverified (caught by the lane's outer handler, which fails
 * the lane by that name). No stage may act on criteria it never read.
 */
async function witnessedAgent<T>(
  prompt: string,
  opts: Parameters<typeof resilientAgent>[1],
  specFile: ContextFile,
  stage: LaneOutcome['stage'],
): Promise<T | null> {
  const result = await resilientAgent<T>(prompt, opts)
  if (result !== null) assertStageWitness(specFile, result, stage)
  return result
}

/** assertReadWitness that names the stage, so the outer handler records it instead of CRASH. */
function assertStageWitness(specFile: ContextFile, parsed: unknown, stage: LaneOutcome['stage']): void {
  try {
    const verdict = assertReadWitness([specFile], parsed)
    // caliper eedom wf_751ea0e4-653 task-002: ten correct hex chars then a
    // dropped digit failed a valid committed RED. The proof is the leading
    // run; the slip after it is named, not fatal.
    if (verdict.nearMiss.length > 0) log(`read_witness_near_miss: ${stage} cited a witness whose leading hex matches ${verdict.nearMiss.join(', ')} but diverges after the proof — accepted (transcription slip after a genuine read)`)
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    ;(err as Error & { stage?: LaneOutcome['stage'] }).stage = stage
    throw err
  }
}


async function runLane(
  taskId: string,
  lanePlan: LanePlanDigest,
  worktreePaths: Record<string, string>,
  cfg: PipelineConfig,
): Promise<LaneOutcome> {
  // The digest lane: files/deps/kind/test_command/spec_hash, NO acceptance
  // criteria. The full spec is fetched at intake (laneSpecFromSteps) and
  // replaces this once byte-checked and hash-matched.
  const lane: Lane = lanePlan.lanes[taskId]
  const wt: string = worktreePaths[taskId]
  // A lane without an absolute worktree path must never run — agents would fall
  // back to the main checkout and commit RED/partial work onto the epic branch.
  if (!wt || typeof wt !== 'string' || !wt.startsWith('/')) {
    return {
      task_id: taskId,
      status: 'failed',
      stage: 'CRASH',
      error: `no worktree path for ${taskId} (setup returned ${JSON.stringify(wt)}) — refusing to run outside an isolated worktree`,
    }
  }
  const issueId: string = getIssueId(lanePlan, taskId)
  const runId: string = cfg.runId
  // `kind`, never `stage`: stage is the lifecycle status every producer writes
  // ("queued"...), so comparing it to 'structural' made this path dead (#369).
  const isStructural: boolean = lane.kind === 'structural'
  const { testFiles, implFiles } = classifyFiles(lane.files)
   const laneTestCmd: string = cfg.testCommand
   const laneCfg: PipelineConfig = { ...cfg, testCommand: laneTestCmd }

   // Per-lane language, inferred from this lane's own file extensions. A
   // single repo-wide cfg.language is wrong for mixed-language repos (this
   // one is Python CLI + TypeScript workflow scripts) and silently falls
   // through to the Python test-pattern branch when cfg.language is unset
   // (e.g. .datum/config.json missing, config lives in config.toml instead)
   // — confirmed root cause of the test-count-gate false-negative that
   // looked like a recurrence of #288/#289 but wasn't a quoting bug at all.
   const laneFiles = [...testFiles, ...implFiles]
   const laneLanguage: string = laneFiles.some((f) => /\.(ts|tsx)$/.test(f))
     ? 'typescript'
     : laneFiles.some((f) => /\.(js|jsx|mjs)$/.test(f))
     ? 'javascript'
     : laneFiles.some((f) => /\.go$/.test(f))
     ? 'go'
     : laneFiles.some((f) => /\.swift$/.test(f))
     ? 'swift'
     : laneFiles.some((f) => /\.py$/.test(f))
     ? 'python'
     : cfg.language

   // ── Swift target-scoped test command (prevents cross-target contamination, #228, #229) ──
   const swiftTargetFilter: string | null = laneLanguage === 'swift'
     ? (() => {
         // Derive target name from impl files: use the first non-"Tests" path segment
         const swft = implFiles[0]
         if (swft) {
           const parts = swft.split('/')
           const sourcesIdx = parts.indexOf('Sources')
           if (sourcesIdx >= 0 && parts[sourcesIdx + 1]) {
             return `--filter ${parts[sourcesIdx + 1]}`
           }
         }
         return null
       })()
     : null
   // Per-lane test_command override: a lane whose files live in a sub-package
   // (own Package.swift) can't be tested by the repo-wide command — the root
   // package doesn't compile its targets. When the plan sets test_command on a
   // lane, use it verbatim and skip the auto --filter (the override is
   // expected to carry its own scoping, e.g. --package-path X --filter Y).
   const scopedTestCmd = typeof lane.test_command === 'string' && lane.test_command.trim()
     ? lane.test_command.trim()
     : swiftTargetFilter
     ? `${cfg.testCommand} ${swiftTargetFilter}`
     : cfg.testCommand
   const scopedLaneCfg: PipelineConfig = { ...cfg, testCommand: scopedTestCmd }

   // Language-aware grep patterns for test function detection.
  // Bare ERE regex only — no embedded shell quotes or -E flag here. Every call
  // site applies its own single quotes; embedding quotes in the constant led
  // to double-quoting bugs when a caller wrapped it in another pair (#288/#289).
  // Use ERE (-E) for alternation — BRE \| is a GNU extension and fails silently on macOS BSD grep
  // NB: no '^' anchor on '+' — macOS git 2.54.0 with core.pager may emit 2-space indented patch lines
  const testFuncDiffRegex: string = laneLanguage === 'swift'
    ? '[+][[:space:]]*(@Test|func test)'
    : laneLanguage === 'go'
    ? '[+][[:space:]]*func Test'
    : laneLanguage === 'typescript' || laneLanguage === 'javascript'
    ? '[+][[:space:]]*(it\\(|test\\(|describe\\()'
    : '[+][[:space:]]*def test_'
  const testFuncGrepRegex: string = laneLanguage === 'swift'
    ? '@Test|func test'
    : laneLanguage === 'go'
    ? 'func Test'
    : laneLanguage === 'typescript' || laneLanguage === 'javascript'
    ? 'it\\(|test\\(|describe\\('
    : 'def test_|async def test_'
  const testFuncBodyRegex: string = laneLanguage === 'swift'
    ? 'func test'
    : laneLanguage === 'go'
    ? 'func Test'
    : 'def test_'

  // Backslash/paren-heavy ERE patterns (esp. TS/JS) were regularly
  // mis-transcribed by the fast-tier agent composing a Bash tool call from
  // prompt text (#288/#289 recurred even after fixing the quoting above —
  // verified the script+pattern were correct in isolation, so the fast agent
  // was the point of failure). Call sites now write the pattern to a temp
  // file via a quoted heredoc (`<<'PATTERN_EOF'`) — the quoted delimiter
  // disables all shell interpretation of its contents, so the agent copies
  // the pattern verbatim with nothing to escape or misquote.

  // ── Cross-run completion check: skip if a previous run already completed this lane ──
  const completionPath = runId
    ? `.datum/runs/${runId}/lane-state/${taskId}.json`
    : null
  // #368 item D: with agent_types on AND the datum-* PreToolUse hooks
  // installed, the ownership / cross-run completion checks are plain
  // commands inside the batched datum-cli calls, evaluated in this script.
  // Otherwise the standalone LLM checks below stay exactly as they were.
  const deterministic: boolean = deterministicChecks()
  if (completionPath && !deterministic) {
    const completionExist: string | null = await agent(
      `Read the file at "${completionPath}" with the Read tool.
If the file exists, return ONLY its raw contents (valid JSON).
If the file does not exist or is empty, return exactly: MISSING
No markdown fences, no explanation.`,
      stageOpts('reader', { label: `completion-check:${taskId}`, phase: 'Act', model: model('fast') }),
    )
    if (completionExist && completionExist.trim() !== 'MISSING') {
      // Safe: an unparseable result yields {} — task_id won't match taskId,
      // so the lane falls through to running RED/GREEN again rather than
      // being wrongly skipped as already-completed. Conservative direction.
      const compData = parseAgentJson<{ task_id?: string }>(completionExist, {})
      if (compData.task_id === taskId) {
        log(`[${taskId}] lane already completed in a prior run — skipping`)
        return { task_id: taskId, status: 'skipped', stage: 'SKIPPED', error: 'cross-run completion: lane was completed in a previous run' }
      }
    }
  }

  log(`[${taskId}] Starting: ${lane.title} (${isStructural ? 'structural' : 'behavioral'}, ${testFiles.length} test, ${implFiles.length} impl)`)

  // ── Lane intake — ONE datum-cli call (#368) ────────────────────────────────
  // Lane history (#331), pre-RED cleanup and the skeleton read/generate used
  // to be three or four separate command-runner agents, each paying ~30K
  // tokens of context for a 300-char prompt. They have no LLM judgement
  // between them, so they run as one script; the results are evaluated here
  // in the same order as before. For a lane that turns out to already have
  // RED+GREEN commits the cleanup/skeleton steps run needlessly — both are
  // idempotent (untracked stray files, a preflight JSON under .datum/runs).
  //
  // Deletion decisions in the cleanup step are made by datum's own
  // `lane-cleanup` command (plain Python, no LLM in the loop) — not by handing
  // a sub-agent a "find files matching a pattern, then rm each one" prompt.
  const scriptTestPattern = /\.(test|spec)\.(ts|js|tsx|jsx)$|(^|\/)test_.*\.py$/
  const cleanupCmd: string | null = testFiles.some(f => scriptTestPattern.test(f))
    ? `datum lane-cleanup "${wt}" ${testFiles.map(f => `--allowed "${f.replace(/"/g, '\\"')}"`).join(' ')}`
    : null
  const skeletonCmd = `datum skeleton --task-id ${taskId} --language ${laneLanguage} --tasks ${cfg.lanePlanPath} --output .datum/runs/${cfg.runId}/preflight-${taskId}.json`
  const preflightPath = `.datum/runs/${cfg.runId}/preflight-${taskId}.json`
  // Pre-generated skeletons from the Plan phase are preferred over generating one now.
  const planSkeletonPath = cfg.skeletonDir
    ? `${cfg.skeletonDir}/preflight-${taskId}.json`
    : ''

  const intakeSteps = laneIntakeSteps({
    wt, epicBranch: cfg.epicBranch, completionPath: deterministic ? completionPath : null, structural: isStructural, cleanupCmd, planSkeletonPath, skeletonCmd, preflightPath,
    laneSpec: { planPath: `${wt}/.datum/lane-plan.json`, taskId, outPath: `${wt}/.datum/lane-spec.json`, expectHash: digestSpecHash(lanePlan, taskId) },
  })
  const intakeRaw = await runBatch(intakeSteps, stageOpts('cli', { label: `lane-intake:${taskId}`, phase: 'Act', model: model('fast') }))
  const intakeResult = intakeRaw
  const intake = intakeResult
  // A missing intake result is an infrastructure failure, not a fresh lane:
  // treating it as empty history is what re-dispatched RED onto a lane that
  // already had RED+GREEN commits (#331 missed, #392 misfiled).
  if (intake.missing || stepStdout(intake, 'history') === null) {
    const why = describeFailure(intake, 'lane intake')
    log(`[${taskId}] LANE INTAKE FAILED: ${why} — cannot read the lane's history; refusing to dispatch RED`)
    return { task_id: taskId, status: 'failed', stage: 'UNKNOWN', error: `lane_intake_failed: ${why}` }
  }

  // Cross-run completion (deterministic mode): the marker was read by the intake batch.
  if (deterministic && completionPath) {
    const completionExist = stepStdout(intake, 'completion')
    if (!isMissing(completionExist)) {
      // Safe: an unparseable result yields {} — task_id won't match taskId,
      // so the lane falls through to running RED/GREEN again rather than
      // being wrongly skipped as already-completed. Conservative direction.
      const compData = parseAgentJson<{ task_id?: string }>(completionExist || '', {})
      if (compData.task_id === taskId) {
        log(`[${taskId}] lane already completed in a prior run — skipping`)
        return { task_id: taskId, status: 'skipped', stage: 'SKIPPED', error: 'cross-run completion: lane was completed in a previous run' }
      }
    }
  }

  // The full lane spec was written to <wt>/.datum/lane-spec.json by the
  // intake batch (`datum lane-spec-export`, hash-checked against the digest);
  // only its path/bytes/blob sha/ac_count come back. The criteria text never
  // enters the script or any runner turn: each stage agent reads the file
  // and proves it with a read_witness (assertReadWitness → context_read_unverified).
  const spec = laneSpecFromSteps(intakeResult, taskId, `${wt}/.datum/lane-spec.json`)
  if (!spec.ok || !spec.spec) {
    log(`[${taskId}] LANE SPEC EXPORT FAILED: ${spec.error}`)
    return { task_id: taskId, status: 'failed', stage: 'CRASH', error: spec.error }
  }
  const specFile = laneSpecContextFile(spec.spec)

  // ── Pre-dispatch check: lane branch may already have RED/GREEN commits (#331) ──
  // A stale lane-plan snapshot, a retried batch, or a lane re-queued after a
  // partial-run interruption can re-dispatch a lane whose branch already has
  // RED and/or GREEN stage-complete commits from a prior invocation. Dispatching
  // a fresh RED agent in that case only duplicates coverage or regresses a
  // shipped fix. Check the ACTUAL git history of the lane branch (not the
  // in-memory lane-plan status, which is exactly what went stale in #331) —
  // search the full log the same way verifyCommitIndependently does for #274,
  // since later stages may have already landed and the target commit is not
  // necessarily HEAD.
  const laneHistoryRaw: string | null = stepStdout(intake, 'history')
  const existing = detectExistingLaneCommits(laneHistoryRaw || '', taskId)
  let { hasRed: redAlreadyCommitted, hasGreen: greenAlreadyCommitted } = existing
  // A RED committed under a different lane spec (files[]/criteria/deps
  // changed between runs — caliper BUG M) is not this lane's RED: reset the
  // worktree to the epic branch and dispatch RED fresh. Commits made before
  // the Datum-Spec trailer existed (redSpec null) are reused as before.
  if (redAlreadyCommitted && existing.redSpec && existing.redSpec !== spec.spec.spec_hash) {
    const redSha = ((laneHistoryRaw || '').split('\n').find((l) => l.includes(`red(${taskId}): RED complete`)) || '').split(' ')[0]
    log(`[${taskId}] red_spec_stale: ${taskId} — RED commit ${redSha} was made under spec ${existing.redSpec}, the plan now hashes to ${spec.spec.spec_hash}; resetting to ${cfg.epicBranch} and re-running RED`)
    const specResetSteps = worktreeResetToSteps(wt, cfg.epicBranch)
    const specReset = worktreeResetToFromSteps(
      await runBatch(specResetSteps, stageOpts('cli', { label: `red-spec-reset:${taskId}`, phase: 'Act', model: model('fast') })),
      cfg.epicBranch,
    )
    if (!specReset.ok) {
      return { task_id: taskId, status: 'failed', stage: 'UNKNOWN', error: `lane_intake_failed: red_spec_stale but could not reset the worktree to ${cfg.epicBranch} (${specReset.error})` }
    }
    redAlreadyCommitted = false
    greenAlreadyCommitted = false
  }
  // Set only when a stale GREEN forces a reset-to-RED-and-resume below —
  // fed to the first GREEN dispatch as its failure hint so the agent knows a
  // previous GREEN on this lane was independently rejected, not that this is
  // its first attempt.
  let greenStaleHint: string | null = null

  // Cross-run completion markers (.datum/runs/<runId>/lane-state/<task>.json)
  // are written by datum-tdd-act-merge for every completed lane, in the same
  // datum-cli call as the squash merge (#368) — not by a per-lane agent here.

  if (isStructural) {
    // No tell scan on this path: the checker reads the files itself.
    const r = await runRefactor(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg, specFile, [])
    if (!r || !r.verified) return { task_id: taskId, status: 'failed', stage: 'REFACTOR', error: r?.error || 'refactor failed' }
    await updateStage(issueId, 'done')
    return { task_id: taskId, status: 'completed', stage: 'REFACTOR' }
  }

  if (redAlreadyCommitted && greenAlreadyCommitted) {
    // #331's shortcut resumed straight to REFACTOR on the strength of the
    // RED+GREEN commit MESSAGES alone. A GREEN retry that itself failed
    // independent verify (e.g. skeptic panel found 2/3 BROKEN and the retry
    // still didn't pass) still leaves a `green(...): GREEN complete` commit
    // on the branch — the shortcut then resumed at REFACTOR against a suite
    // that was never actually green, and REFACTOR's failure was reported as
    // a generic "refactor failed" (elonchesd wf_93040d99-e3c -> wf_30d8f723-8d3).
    // Verify the suite independently AT THE LANE'S CURRENT HEAD before
    // trusting the shortcut — never assume the commit messages are the truth.
    const intakeVerifySteps = laneIntakeSteps({
      wt, epicBranch: cfg.epicBranch, completionPath: null, structural: true,
      cleanupCmd: null, planSkeletonPath: '', skeletonCmd: '', preflightPath: '',
      verifyTestCmd: scopedTestCmd,
    })
    const intakeVerifyRaw = await runBatch(intakeVerifySteps, stageOpts('cli', { label: `lane-intake-verify:${taskId}`, phase: 'Act', model: model('fast') }))
    const intakeVerify = intakeVerifyRaw
    const intakeVerifyExit = testExitCode(stepStdout(intakeVerify, 'test-verify'))
    const intakeEnvMissing = testEnvMissing(stepStdout(intakeVerify, 'test-verify'))
    if (intakeEnvMissing) {
      // Not a stale GREEN: the worktree has no test environment. Resetting
      // and re-doing GREEN would loop forever (elonchesd wf_eb0f9f9b-7b1).
      log(`[${taskId}] test_env_missing: ${intakeEnvMissing}`)
      return { task_id: taskId, status: 'failed', stage: 'UNKNOWN', error: `test_env_missing: ${intakeEnvMissing} — the lane worktree has no test environment (dependencies not linked/installed); no verdict on the committed GREEN` }
    }

    if (intakeVerifyExit === null) {
      // The verify step did not run (missing batch, tooling crash) — this is
      // a tooling failure, never "assume green": trusting a missing check
      // over an independent re-run is exactly the failure mode this gate
      // exists to close.
      const why = describeFailure(intakeVerify, 'lane intake verify')
      log(`[${taskId}] LANE INTAKE VERIFY FAILED: ${why} — cannot confirm the existing GREEN commit passes the suite; refusing to assume it does`)
      return { task_id: taskId, status: 'failed', stage: 'UNKNOWN', error: `lane_intake_failed: intake-verify step did not run (${why})` }
    }

    if (intakeVerifyExit === 0) {
      log(`[${taskId}] RED and GREEN commits already exist on lane branch — lane already satisfied, resuming from REFACTOR (#331)`)
      // No tell scan on this path: the checker reads the files itself.
      const r = await runRefactor(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg, specFile, [])
      if (!r || !r.verified) return { task_id: taskId, status: 'failed', stage: 'REFACTOR', error: r?.error || 'refactor failed' }
      await updateStage(issueId, 'done')
      return { task_id: taskId, status: 'completed', stage: 'REFACTOR' }
    }

    // The committed GREEN does not independently pass — reset the worktree
    // to the RED commit (never HEAD: HEAD *is* the rejected GREEN) and fall
    // through into the exact same RED-only resume path used below, with a
    // failure hint so the GREEN agent knows a prior attempt on this lane was
    // rejected.
    greenStaleHint = `green_stale: GREEN commit(s) on the lane branch do not pass the suite (independent exit=${intakeVerifyExit}) — resetting to the RED commit and resuming at GREEN`
    log(`[${taskId}] ${greenStaleHint}`)
    const redCommitInfo = parseCommitVerification(laneHistoryRaw, '', `red(${taskId})`, 'RED')
    if (!redCommitInfo.commitSha) {
      return { task_id: taskId, status: 'failed', stage: 'UNKNOWN', error: `lane_intake_failed: could not find the RED commit sha in lane history to reset to (${redCommitInfo.detail})` }
    }
    const resetToRedSteps = worktreeResetToSteps(wt, redCommitInfo.commitSha)
    const resetToRedResult = await runBatch(resetToRedSteps, stageOpts('cli', { label: `reset-to-red:${taskId}`, phase: 'Act', model: model('fast') }))
    // HEAD must BE the RED sha before RED is re-dispatched: a refused reset
    // still parses as a batch (elonchesd wf_2b0230c2-f41 task-016).
    const resetToRed = worktreeResetToFromSteps(resetToRedResult, redCommitInfo.commitSha)
    if (!resetToRed.ok) {
      return { task_id: taskId, status: 'failed', stage: 'UNKNOWN', error: `lane_intake_failed: could not reset worktree to RED commit ${redCommitInfo.commitSha} (${resetToRed.error})` }
    }
    redAlreadyCommitted = true
    greenAlreadyCommitted = false
  }

  // ── Pre-RED cleanup: stray untracked test files from prior skeleton runs ──
  // Stray files from pre-preflight skeleton writes or abandoned tasks pollute
  // test collectors (pytest/vitest); the intake batch removed any test file
  // that is untracked but not listed in the lane plan's files[].
  if (cleanupCmd) {
    log(`[${taskId}] Pre-RED cleanup completed`)
  } else {
    log(`[${taskId}] Pre-RED cleanup skipped (lane has no JS/TS/Py test files)`)
  }

  // ── RED (writes tests + verifies they fail + commits) ──
  log(`[${taskId}] RED: writing failing tests`)

  let targetContext: Record<string, string[]> | undefined
  let preflightRaw: string | null = null

  if (planSkeletonPath) {
    const fromPlan = stepStdout(intake, 'skeleton-plan')
    if (!isMissing(fromPlan)) {
      preflightRaw = fromPlan
      log(`[${taskId}] using pre-generated skeleton from Plan phase`)
    }
  }

  // Fall back to the skeleton the intake batch generated when Plan didn't provide one
  if (!preflightRaw) {
    const generated = stepStdout(intake, 'skeleton-gen')
    preflightRaw = generated && generated.trim() && generated.trim() !== 'SKIPPED_PLAN_SKELETON' ? generated : null
  }

  let preflightFramework: string | undefined
  if (preflightRaw) {
    // Safe: preflight is optional enrichment (pre-generated skeleton hints) —
    // an unparseable result yields {}, so targetContext/preflightFramework
    // stay undefined and no test paths get registered from it. RED still
    // runs against testFiles as already classified from the lane plan below.
    const preflightData = parseAgentJson<{ target_context?: Record<string, string[]>; framework?: string; outputs?: Array<{ path?: string }> }>(preflightRaw, {})
    if (preflightData.target_context) {
      targetContext = preflightData.target_context
      log(`[${taskId}] target_context extracted: ${Object.keys(targetContext).join(', ')}`)
    }
    preflightFramework = preflightData.framework
    if (preflightData.outputs && preflightData.outputs.length > 0) {
      // Only outputs classifyFiles calls tests: registering every output
      // path made docs and deliverable fixtures "the lane's test files" and
      // failed a sound GREEN as green_edited_tests (caliper BUG P).
      const reg = preflightTestPaths(preflightData.outputs, testFiles)
      testFiles.push(...reg.registered)
      if (reg.registered.length > 0) {
        log(`[${taskId}] preflight registered ${reg.registered.length} test file(s): ${reg.registered.join(', ')}`)
      }
      if (reg.skipped.length > 0) {
        log(`[${taskId}] preflight_output_not_test: [${reg.skipped.join(', ')}] not registered as test files`)
      }
      if (testFiles.length === 0) {
        return { task_id: taskId, status: 'failed', stage: 'RED', error: 'no_test_files: classifyFiles produced empty testFiles and preflight has no registered test paths' }
      }
    }
  }

  // Guard: fail early if classifyFiles produced no test files
  if (testFiles.length === 0) {
    log(`[${taskId}] ERROR: classifyFiles produced empty testFiles — lane cannot proceed without a test file to write tests against`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: 'no_test_files: classifyFiles returned empty testFiles for lane' }
  }

  const redExtras: Record<string, unknown> = targetContext ? { target_context: targetContext } : {}
  const redPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'RED', specFile, redExtras)
  const redCtxCmd: string = laneCtxCmd(redPacket, wt)

  const testFuncLabel: string = laneLanguage === 'swift'
    ? '@Test or func test'
    : laneLanguage === 'go'
    ? 'func Test'
    : laneLanguage === 'typescript' || laneLanguage === 'javascript'
    ? 'it( or test( or describe('
    : 'def test_'

  const promptVars = {
    wt,
    skeletonCmd,
    redCtxCmd,
    redPacketStr: JSON.stringify(redPacket),
    testCommand: scopedTestCmd,
    // #358: file-backed run, real exit status — never `cmd | tail`.
    testRunCmd: testRunCommand(scopedTestCmd, wt, 'RED'),
    testFilesList: testFiles.join(' '),
    commitPrefix: redPacket.commit_prefix,
    // One commit convention for every stage (#357): datum author + Datum-* trailers.
    commitCmd: laneCommitCommand({ wt, taskId, stage: 'RED', runId, specHash: spec.spec.spec_hash }),
    taskId,
    testFuncPattern: testFuncLabel,
    laneSpec: specFile,
  }

  let red: StageResult | null = null

  if (redAlreadyCommitted) {
    // RED commit already exists on the lane branch (but GREEN doesn't yet) —
    // resume from GREEN instead of re-dispatching RED (#331). Reconstruct the
    // StageResult from git history using the same independent-verification
    // helper the retry paths below already rely on (#274), rather than
    // re-running the RED agent against tests that already exist.
    log(`[${taskId}] RED commit already exists on lane branch — skipping RED dispatch, resuming from GREEN (#331)`)
    const existingRedCheck = await verifyCommitIndependently(taskId, wt, testFiles, redPacket.commit_prefix, 'RED', cfg.epicBranch)
    red = {
      success: true,
      tests_pass: false,
      committed: true,
      commit_sha: existingRedCheck.commitSha,
      files_written: testFiles,
    }
  } else {
    red = await witnessedAgent(
      redPrompt(promptVars),
      stageOpts('red', { label: `red:${taskId}`, phase: 'Act', model: model('balanced'), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
      specFile, 'RED',
    )

    if (!red) {
      // A null result is NOT "unknown": the agent returned nothing — turn cap
      // (agents/datum-red.md maxTurns), API error, or skipped — and may have
      // left half-applied test edits in the worktree. Name it, reset the
      // worktree to the lane's last commit, and retry before falling into the
      // commit-check / success-retry paths below (mirrors GREEN's BUG F fix).
      const redFirstFailure = 'red_no_result: RED agent returned nothing (likely the maxTurns cap in agents/datum-red.md, an API error, or a skip)'
      const redResetStepList = worktreeResetSteps(wt)
      const redResetResult = await runBatch(redResetStepList, stageOpts('cli', { label: `red-reset:${taskId}`, phase: 'Act', model: model('fast') }))
      const redLeftover = (stepStdout(redResetResult, 'status') || '').trim()
      log(`[${taskId}] RED attempt 1: ${redFirstFailure}; worktree reset to HEAD before retry${redLeftover ? ` (WARNING: still dirty: ${redLeftover.split('\n').length} paths)` : ''}`)
      red = await witnessedAgent(
        redRetryPrompt({ ...promptVars, failureReason: redFirstFailure }),
        stageOpts('red', { label: `red-retry:${taskId}`, phase: 'Act', model: model('balanced'), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
        specFile, 'RED',
      )
      if (!red) {
        return {
          task_id: taskId,
          status: 'failed',
          stage: 'RED',
          error: 'red_no_result: RED agent returned nothing on both attempts (likely the maxTurns cap in agents/datum-red.md — the lane may need a smaller scope, or the cap raised)',
        }
      }
    }

    if (red?.success) {
      log(`[${taskId}] RED wrote: ${(red.files_written || []).join(', ')}`)
    }

    // ── Commit check first — prevents misleading 'found 0' errors from count gate (#245) ──
    // If the first attempt didn't commit, retry via redRetryPrompt (the recovery path that
    // already exists for a failed-but-committed attempt) before hard-failing the lane (#333).
    if (!red || !red.committed) {
      const check = await verifyCommitIndependently(taskId, wt, testFiles, redPacket.commit_prefix, 'RED', cfg.epicBranch)
      if (check.committed) {
        log(`[${taskId}] RED: agent reported committed=false but independent check confirms a commit exists (${check.detail}) — treating as committed (#274)`)
        red = {
          success: true,
          tests_pass: false,
          committed: true,
          commit_sha: check.commitSha,
          files_written: red?.files_written || testFiles,
          failure_reason: red?.failure_reason,
        }
      } else {
        log(`[${taskId}] RED: agent did not commit on first attempt — retrying (independent check: ${check.detail})`)
        red = await witnessedAgent(
          redRetryPrompt({ ...promptVars, failureReason: 'agent did not commit test files' }),
          stageOpts('red', { label: `red-retry:${taskId}`, phase: 'Act', model: model('balanced'), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
          specFile, 'RED',
        )
        // Re-run the same commit-check gate (not around it) so a retry that still didn't
        // commit doesn't fall through to the count gate and produce a misleading '0' error (#245).
        if (!red || !red.committed) {
          const retryCheck = await verifyCommitIndependently(taskId, wt, testFiles, redPacket.commit_prefix, 'RED', cfg.epicBranch)
          if (retryCheck.committed) {
            log(`[${taskId}] RED retry: agent reported committed=false but independent check confirms a commit exists (${retryCheck.detail}) — treating as committed (#274)`)
            red = {
              success: true,
              tests_pass: false,
              committed: true,
              commit_sha: retryCheck.commitSha,
              files_written: red?.files_written || testFiles,
              failure_reason: red?.failure_reason,
            }
          } else {
            log(`[${taskId}] RED: agent did not commit after retry — failing (independent check: ${retryCheck.detail})`)
            return { task_id: taskId, status: 'failed', stage: 'RED', error: `RED agent did not commit after retry (independent check: ${retryCheck.detail})` }
          }
        }
      }
    }

    if (!red || !red.success) {
      log(`[${taskId}] RED attempt 1 failed: ${red?.failure_reason || 'unknown'}, retrying`)
      red = await witnessedAgent(
        redRetryPrompt({ ...promptVars, failureReason: red?.failure_reason || 'unknown' }),
        stageOpts('red', { label: `red-retry:${taskId}`, phase: 'Act', model: model('balanced'), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
        specFile, 'RED',
      )
    }
  }

  if (!red || !red.success) {
    log(`[${taskId}] RED FAILED: ${red?.failure_reason || 'no files written after 2 attempts'}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: red?.failure_reason || 'RED failed' }
  }

  // ── Post-RED checks — ONE datum-cli call (#368) ───────────────────────────
  // The count gate (#253), placeholder scan, scope-repair read (#325/#334/#335)
  // and the before/after test-function count were four separate command
  // runners. All are read-only, so they run as one script and are evaluated
  // below in the original order — a later check that "would not have run"
  // after an earlier failure has no side effects. Patterns still go through
  // quoted heredocs (#288/#289); the deterministic script, not the fast
  // agent, now writes the JSON the checks are parsed from.
  const acCount = spec.spec.ac_count
  // ERE for the grep fallback: the skeleton's literal message (datum/skeleton_creator.py).
  const SKELETON_THROW_RE = 'throw new Error\\(.RED agent: implement this assertion.\\)'
  const sgPatterns: { pattern: string; name: string; grep?: string }[] = laneLanguage === 'swift'
    ? [
        { pattern: 'XCTFail', name: 'XCTFail' },
        { pattern: 'fatalError', name: 'fatalError' },
      ]
    : laneLanguage === 'go'
    ? [
        { pattern: 't.Fatal("not implemented")', name: 't.Fatal placeholder' },
        { pattern: 'panic("not implemented")', name: 'panic placeholder' },
      ]
    : laneLanguage === 'typescript' || laneLanguage === 'javascript'
    ? [
        // The placeholder is the skeleton's own throw with its own message
        // (datum/skeleton_creator.py) — never the bare `throw new Error`
        // token, which also matched a guard clause beside real expect() calls
        // and failed a sound RED (elonchesd wf_a979f3d8-f0c task-013). The
        // earlier whole-body shapes `it($_, () => { throw new Error($_) })`
        // never matched the real skeleton under ast-grep (its `// Assert`
        // comment is a node the exact shape does not allow), which went
        // unnoticed while the grep fallback ran on every file; ast-grep
        // matches the literal statement and skips it inside strings, the
        // grep fallback matches the message.
        { pattern: "throw new Error('RED agent: implement this assertion')", name: 'skeleton placeholder', grep: SKELETON_THROW_RE },
        { pattern: 'expect(true).toBe(false)', name: 'forced failure' },
      ]
    : [
        { pattern: 'assert True', name: 'assert True' },
        { pattern: 'assert 1', name: 'assert 1' },
        { pattern: 'raise NotImplementedError', name: 'raise NotImplementedError' },
      ]
  const postRed = postRedSteps({
    wt, testFiles, acCount, testFuncDiffRegex, sgPatterns, testFuncBodyRegex, testFuncGrepRegex, ownership: deterministic,
    verifyTestCmd: scopedTestCmd,
    baseRef: cfg.epicBranch,
  })
  const postRedRaw = await runBatch(postRed, stageOpts('cli', { label: `post-red:${taskId}`, phase: 'Act', model: model('fast') }))
  const postRedResult = postRedRaw

  // ── New-test-function count gate — deterministic script execution, no LLM mediation (#253) ──
  if (acCount > 0) {
    let newTestCount = 0
    let gatePassed = false
    const countRaw: string | null = postRedResult.missing ? null : stepStdout(postRedResult, 'count-gate')
    // Parse the JSON output from the script
    if (countRaw === null || countRaw === undefined) {
      // The batch returned nothing for the count gate — this is an infrastructure
      // failure of the count-gate script call itself, not "0 tests found". Do NOT
      // silently default to newTestCount=0/gatePassed=false here; that would
      // misreport a tooling failure as a real gate failure and mask the fact the
      // check never ran (#315).
      log(`[${taskId}] RED FAILED: test-count-check returned null (${describeFailure(postRedResult, 'post-red batch')}) — cannot verify ${acCount} new test functions were committed`)
      return {
        task_id: taskId,
        status: 'failed',
        stage: 'RED',
        error: `count_gate_no_output: test-count-check returned null — cannot verify ${acCount} new test functions were committed`,
      }
    } else {
      const text = countRaw.trim()
      const match = text.match(/\{"new_test_count":\s*(\d+)/)
      if (match) {
        newTestCount = parseInt(match[1], 10)
        const passedMatch = text.match(/"passed":\s*(true|false)/)
        gatePassed = passedMatch ? passedMatch[1] === 'true' : newTestCount >= acCount
      } else {
        // The gate ran but did not print its JSON — the script was missing
        // (exit 127), crashed, or is the wrong version. That is a tooling
        // failure, not "0 tests found": report it as its own error so the RED
        // agent isn't blamed for an infrastructure problem.
        const gateStep = stepResult(postRedResult, 'count-gate')
        const detail = `exit ${gateStep?.exit_code ?? '?'}${(gateStep?.stderr || text).trim() ? ` — ${(gateStep?.stderr || text).trim().split('\n').slice(-3).join(' | ')}` : ''}`
        log(`[${taskId}] RED FAILED: count-gate produced no JSON (${detail}) — cannot verify ${acCount} new test functions were committed`)
        return { task_id: taskId, status: 'failed', stage: 'RED', error: `count_gate_failed: test-count-gate produced no JSON (${detail})` }
      }
    }
    if (!gatePassed) {
      log(`[${taskId}] RED FAILED: only ${newTestCount} new test functions found, need >= ${acCount} (one per AC)`)
      return { task_id: taskId, status: 'failed', stage: 'RED', error: `no_new_test_functions_committed: found ${newTestCount}, need >= ${acCount}` }
    }
    log(`[${taskId}] RED: ${newTestCount} new test functions confirmed (>= ${acCount} ACs)`)
  }

  // Structural assertion check — deterministic ast-grep/grep scan; any output means a placeholder was found
  const assertDetail = (stepStdout(postRedResult, 'assert-check') || '').trim()
  if (assertDetail.length > 0) {
    log(`[${taskId}] RED: placeholder assertions found — ${assertDetail}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `placeholder_assertions: ${assertDetail}` }
  }

  // Deterministic green-blindness gate (#audit-1): the RED agent's tests_pass
  // is self-reported from a run IT performed and read the exit status from —
  // a hallucinated or mistaken "tests_pass: false" would sail through
  // undetected. Re-run the exact same test command independently here and
  // trust that result over the agent's self-report whenever the step ran.
  const redVerifyExit = testExitCode(stepStdout(postRedResult, 'test-verify'))
  const redEnvMissing = testEnvMissing(stepStdout(postRedResult, 'test-verify'))
  if (redEnvMissing) {
    log(`[${taskId}] test_env_missing: ${redEnvMissing}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `test_env_missing: ${redEnvMissing} — the lane worktree has no test environment; RED's failure is not evidence` }
  }
  if (redVerifyExit === 0) {
    log(`[${taskId}] RED VERIFY FAILED: independent re-run of the test suite exited 0 (green blindness), regardless of agent self-report (tests_pass=${red.tests_pass})`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: 'green_blindness_violation: independent test-verify step confirms tests passed after RED' }
  }
  if (red.tests_pass) {
    const diag = red.test_output || red.test_errors?.join('; ') || 'no test output captured'
    log(`[${taskId}] RED VERIFY FAILED: tests passed (green blindness). Output: ${diag}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `green_blindness_violation: tests passed after RED. Test output: ${diag}` }
  }
  log(`[${taskId}] RED verified — tests fail as expected (committed: ${red.commit_sha || 'n/a'})`)
  await updateStage(issueId, 'red', red.commit_sha)

  // Ownership (#368 item D): deterministic mode evaluates the diff the
  // post-RED batch already read; otherwise the standalone LLM check runs.
  const redOwnership: OwnershipCheckResult = deterministic
    ? ownershipFromStdout(stepStdout(postRedResult, 'ownership'), testFiles, implFiles)
    : await verifyFileOwnership(taskId, wt, 'RED', testFiles, implFiles)
  if (!redOwnership.ok) {
    const redPrefix = redOwnership.checkFailed ? 'ownership_check_failed' : 'file_ownership_violation'
    log(`[${taskId}] RED ${redPrefix.toUpperCase()}: ${redOwnership.violations.join(', ')}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `${redPrefix}: ${redOwnership.violations.join(', ')}` }
  }

  // ── Scope repair (#325/#334/#335) ──────────────────────────────────────────
  // The committed RED test may import/assert against files the lane plan
  // never granted write access to (allowed_write_files == testFiles+implFiles
  // here). Left unchecked, GREEN deadlocks at scope_exceeded: no change
  // confined to implFiles can satisfy an AC whose target lives elsewhere.
  // Parse the actual RED test content (read by the post-RED batch) for
  // required files and either auto-add unambiguous, existing targets to
  // implFiles, or fail loud now — before GREEN burns an attempt on a lane
  // that structurally cannot pass.
  const scopeTestContents = scopeContentsFromSteps(testFiles, (n) => stepStdout(postRedResult, n))
  for (const t of scopeReadTruncations(testFiles, (n) => stepStdout(postRedResult, n), scopeReadCap(testFiles.length))) {
    log(`[${taskId}] scope_read_truncated: ${t.file} is ${t.bytes} bytes, scope-gap analysis used the first ${t.cap} (imports and early assertions only)`)
  }

  const requiredScopeFiles = new Set<string>()
  for (const tf of testFiles) {
    const tContent = scopeTestContents[tf] || ''
    if (!tContent) continue
    for (const rf of extractRequiredScopeFiles(tContent, tf, laneLanguage)) {
      requiredScopeFiles.add(rf)
    }
  }

  const scopeGaps = findScopeGaps([...requiredScopeFiles], [...testFiles, ...implFiles])

  // ── Contract preflight (#356) ─────────────────────────────────────────────
  // Run the committed RED test once against the current tree (deterministic
  // Python: `python -m datum.contract_preflight`, exposed as `datum
  // contract-preflight`) and fail RED — not GREEN — when a TypeError/
  // AttributeError originates in, or names a contract defined only in, a file
  // GREEN cannot write (GREEN's allowed set is implFiles). Without this the
  // lane burned three identical GREEN attempts before a human noticed the
  // RED test had constructed a dataclass without one of its required fields.
  const isPytestLane: boolean = laneLanguage === 'python' && /pytest/.test(scopedTestCmd)

  // Scope-gap existence checks and the contract preflight share ONE datum-cli
  // call (#368): the script widens the preflight's --allowed list with the
  // gaps that exist, exactly as the two sequential agents used to.
  const scopeContract = scopeContractSteps({
    wt,
    scopeGaps,
    contractPreflight: isPytestLane ? { testFiles, implFiles, scopedTestCmd } : null,
  })
  const scopeContractResult = scopeContract.length > 0
    ? await runBatch(scopeContract, stageOpts('cli', { label: `scope-contract:${taskId}`, phase: 'Act', model: model('fast') }))
    : null

  if (scopeGaps.length > 0) {
    const { existing: existingGaps, missing: missingGaps } = scopeGapsFromSteps(
      scopeGaps,
      (n) => (scopeContractResult ? stepResult(scopeContractResult, n)?.exit_code ?? null : null),
    )

    for (const f of existingGaps) {
      if (!implFiles.includes(f)) {
        implFiles.push(f)
        log(`[${taskId}] scope-repair: auto-adding '${f}' to allowed_write_files — required by RED test import/assertion, was missing from lane.files`)
      }
    }
    if (missingGaps.length > 0) {
      const msg = `lane ${taskId}: RED test requires ${missingGaps.join(', ')} but allowed_write_files does not include it (and the file does not exist in the repo, so it cannot be safely auto-added)`
      log(`[${taskId}] SCOPE GAP (fail-loud): ${msg}`)
      return { task_id: taskId, status: 'failed', stage: 'RED', error: `scope_gap: ${msg}` }
    }
  }

  if (isPytestLane) {
    const redPreflight: ContractPreflight = parseContractPreflight(
      scopeContractResult ? stepStdout(scopeContractResult, 'contract-preflight') : null,
    )
    if (redPreflight.status === 'contract_conflict') {
      log(`[${taskId}] RED FAILED: contract conflict — ${redPreflight.reason}`)
      return { task_id: taskId, status: 'failed', stage: 'RED', error: `contract_conflict: ${redPreflight.reason}`, needs_write: redPreflight.needs_write }
    }
    log(`[${taskId}] contract preflight: ${redPreflight.status}${redPreflight.status === 'skipped' ? ` (${redPreflight.reason})` : ''}`)
  } else {
    log(`[${taskId}] contract preflight skipped (not a pytest lane)`)
  }

  // ── Pre-reflect: verify new tests were actually written — deterministic count ──
  const counts = newTestCountFromSteps(postRedResult)
  if (!counts.ok) {
    // A missing probe is not "zero tests before": fail by name (review sweep).
    log(`[${taskId}] RED FAILED: ${counts.error}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: counts.error }
  }
  const { before: beforeCount, after: afterCount, added: newTestCount } = counts
  if (newTestCount <= 0) {
    log(`[${taskId}] RED FAILED: no new test functions written (before=${beforeCount}, after=${afterCount})`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: 'no_new_tests_written: RED agent did not append any test functions' }
  }
  log(`[${taskId}] RED: ${newTestCount} new test functions verified (${beforeCount} → ${afterCount})`)

  // ── Reflect (independent evaluator — stays separate) ──
  // Through resilientAgent, not agent(): a schema'd agent that answers in
  // prose makes the runtime THROW ("completed without calling
  // StructuredOutput"); resilientAgent turns that into null and retries once
  // with a fresh agent. Left bare, that throw escaped to the lane's outer
  // catch as stage=CRASH and blocked every dependent lane although RED's
  // commit was fine (elonchesd run wf_949ca712-b07, #415).
  const reflectResult: ReflectResult | null = await witnessedAgent(
    reflectPrompt({ wt, testFiles: testFiles.join(', '), laneSpec: specFile }),
    stageOpts('reflect', { label: `reflect:${taskId}`, phase: 'Act', model: model('fast'), schema: REFLECT_SCHEMA, maxRetries: 1 }),
    specFile, 'RED',
  )

  if (!reflectResult) {
    // The evaluator produced nothing — that is NOT a score of 0. Failing the
    // lane on a fabricated number would punish the RED work for the
    // evaluator's turn cap; the deterministic post-RED gates (count gate,
    // placeholder scan, green-blindness) already held, so continue and say so.
    log(`[${taskId}] reflect_no_result: reflect agent returned nothing on both attempts (likely the maxTurns cap in agents/datum-reflect.md) — proceeding to GREEN without a quality score`)
  } else {
    const reflectScore: number = reflectResult.score || 0
    log(`[${taskId}] Test quality: ${reflectScore}/10 — ${reflectResult.reasoning || 'no reasoning'}`)
    if (reflectResult.gaps?.length) {
      log(`[${taskId}]   gaps: ${reflectResult.gaps.join('; ')}`)
    }
    if (reflectScore < 4) {
      log(`[${taskId}] RED FAILED: test quality too low (${reflectScore}/10)`)
      return { task_id: taskId, status: 'failed', stage: 'RED', error: `test quality ${reflectScore}/10` }
    }
  }

  // ── GREEN (writes implementation + verifies tests pass + commits) ──
  const greenModel = (lane.green_model || model('balanced')) as ModelName
  log(`[${taskId}] GREEN: making tests pass (model: ${greenModel})`)

  const greenExtras: Record<string, unknown> = {
    test_signal: { exit_code: red.test_exit_code || 1, errors: red.test_errors || [] },
    ...(targetContext ? { target_context: targetContext } : {}),
  }
  const greenPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, scopedLaneCfg, 'GREEN', specFile, greenExtras)
  const greenCtxCmd: string = laneCtxCmd(greenPacket, wt)

  const greenVars = {
    wt,
    greenCtxCmd,
    greenPacketStr: JSON.stringify(greenPacket),
    testCommand: scopedTestCmd,
    testRunCmd: testRunCommand(scopedTestCmd, wt, 'GREEN'),
    implFilesList: implFiles.join(' '),
    commitPrefix: greenPacket.commit_prefix,
    commitCmd: laneCommitCommand({ wt, taskId, stage: 'GREEN', runId, specHash: spec.spec.spec_hash }),
    laneSpec: specFile,
  }

  let green: StageResult | null = await witnessedAgent(
    greenStaleHint
      ? greenRetryPrompt({
          ...greenVars,
          failureReason: greenStaleHint,
          greenRetryPacketStr: JSON.stringify({ ...greenPacket, retry_hint: 'green_stale' }),
        })
      : greenPrompt(greenVars),
    stageOpts('green', { label: `green:${taskId}`, phase: 'Act', model: greenModel, schema: STAGE_RESULT_SCHEMA, worktree: wt }),
    specFile, 'GREEN',
  )

  if (green?.success) {
    log(`[${taskId}] GREEN wrote: ${(green.files_written || []).join(', ')}`)
  }

  if (!green || !green.success || !green.tests_pass) {
    // ── Blocked vs retry (#356) ────────────────────────────────────────────
    // Before spending the opus retry, decide whether this failure can be
    // fixed inside allowed_write_files at all. A structured blocked result,
    // a scope_exceeded reason, or a contract preflight showing a TypeError/
    // AttributeError rooted in an unwritable file means an identical re-run
    // can never pass — surface it once instead of retrying blind.
    let greenPreflight: ContractPreflight | null = null
    const selfReportedBlock = !!green && (green.status === 'blocked' || /scope_exceeded/i.test(green.failure_reason || ''))
    if (green && isPytestLane && !selfReportedBlock) {
      // Same scope-contract batch the RED side runs (no scope gaps here):
      // the preflight JSON comes from the step's stdout, not from a runner
      // told to "Run:" the command and echo it — a summarised echo parsed
      // as "skipped" and turned a real contract_conflict into a blind retry.
      const checkSteps = scopeContractSteps({ wt, scopeGaps: [], contractPreflight: { testFiles, implFiles, scopedTestCmd } })
      const checkResult = await runBatch(checkSteps, stageOpts('cli', { label: `contract-check:${taskId}`, phase: 'Act', model: model('fast') }))
      greenPreflight = parseContractPreflight(stepStdout(checkResult, 'contract-preflight'))
    }
    const decision = decideGreenBlock(green, greenPreflight)

    // ── #440: blocked on the lane's OWN test — bounded RED repair ──────────
    // elonchesd epic-2 task-006 and player-guidance task-011: GREEN reported
    // blocked with needs_write naming the lane's own test file, because the
    // RED fixture encoded a wrong precondition; GREEN's diagnosis was exact
    // and it was rightly forbidden to edit the test. RED, which may edit
    // tests, runs once more carrying that diagnosis; the post-RED gates
    // re-run; GREEN runs once more. A second block by the same shape fails
    // as green_blocked_needs_write, naming the repair that did not help.
    const ownTestTargets = decision.blocked && decision.needsWrite.length > 0 && decision.needsWrite.every((f) => testFiles.includes(f))
    if (decision.blocked && ownTestTargets) {
      log(`[${taskId}] GREEN blocked on the lane's own test(s) [${decision.needsWrite.join(', ')}] — re-dispatching RED once with GREEN's diagnosis (#440)`)
      const repairReason = `green_blocked_on_own_test: GREEN could not make the suite pass because the lane's own test(s) [${decision.needsWrite.join(', ')}] encode a wrong precondition or fixture. GREEN's diagnosis: ${decision.reason}. Amend ONLY the named test file(s) so each test asserts the criterion the lane spec states, under a precondition that can actually hold; never weaken an assertion the spec requires; keep every other test intact.`
      const repaired: StageResult | null = await witnessedAgent(
        redRetryPrompt({ ...promptVars, failureReason: repairReason }),
        stageOpts('red', { label: `red-repair:${taskId}`, phase: 'Act', model: model('balanced'), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
        specFile, 'RED',
      )
      if (!repaired || !repaired.success || !repaired.committed) {
        return { task_id: taskId, status: 'failed', stage: 'RED', error: `red_repair_failed: ${!repaired ? 'RED repair agent returned nothing' : repaired.failure_reason || 'RED repair did not commit'} — GREEN's diagnosis: ${decision.reason}` }
      }
      const repairPostRed = await runBatch(postRed, stageOpts('cli', { label: `post-red-repair:${taskId}`, phase: 'Act', model: model('fast') }))
      const repairCount = acCount > 0 ? parseAgentJson<{ passed?: boolean }>(stepStdout(repairPostRed, 'count-gate') || '', { passed: false }) : { passed: true }
      const repairAssert = (stepStdout(repairPostRed, 'assert-check') || '').trim()
      const repairTouched = (stepStdout(repairPostRed, 'ownership') || '').split('\n').map((l) => l.trim()).filter(Boolean)
      const repairForeign = repairTouched.filter((f) => !testFiles.includes(f))
      if (!repairCount.passed || repairAssert.length > 0 || repairForeign.length > 0) {
        const why = !repairCount.passed ? 'count gate failed after the repair' : repairAssert.length > 0 ? `placeholder_assertions after the repair: ${repairAssert.split('\n')[0]}` : `repair touched files outside the lane's tests [${repairForeign.join(', ')}]`
        return { task_id: taskId, status: 'failed', stage: 'RED', error: `red_repair_failed: ${why}` }
      }
      log(`[${taskId}] RED repair committed (${repaired.commit_sha || 'n/a'}); post-RED gates passed — re-running GREEN once`)
      green = await witnessedAgent(
        greenRetryPrompt({
          ...greenVars,
          failureReason: `red_repaired: the lane's test(s) [${decision.needsWrite.join(', ')}] were amended per your diagnosis (${decision.reason}); implement against the amended tests`,
          greenRetryPacketStr: JSON.stringify({ ...greenPacket, retry_hint: 'red_repaired' }),
        }),
        stageOpts('green', { label: `green-red-repair:${taskId}`, phase: 'Act', model: model('deep'), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
        specFile, 'GREEN',
      )
      const again = decideGreenBlock(green, null)
      if (again.blocked) {
        const err = `green_blocked_needs_write: [${again.needsWrite.join(', ') || 'unspecified'}] — ${again.reason} (still blocked after one RED repair for [${decision.needsWrite.join(', ')}])`
        log(`[${taskId}] ${err}`)
        return { task_id: taskId, status: 'blocked', stage: 'GREEN', error: err, needs_write: again.needsWrite }
      }
    } else if (decision.blocked) {
      const { widen, rejected } = cfg.yolo
        ? autoWidenTargets(decision.needsWrite)
        : { widen: [] as string[], rejected: decision.needsWrite }
      if (cfg.yolo && widen.length > 0 && rejected.length === 0) {
        for (const f of widen) if (!implFiles.includes(f)) implFiles.push(f)
        log(`[${taskId}] GREEN blocked — yolo auto-widened allowed_write_files with [${widen.join(', ')}] (all inside src/); re-running GREEN once`)
        const widenedPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, scopedLaneCfg, 'GREEN', specFile, greenExtras)
        green = await witnessedAgent(
          greenRetryPrompt({
            ...greenVars,
            greenCtxCmd: laneCtxCmd(widenedPacket, wt),
            implFilesList: implFiles.join(' '),
            failureReason: `blocked: ${decision.reason} — allowed_write_files now also includes ${widen.join(', ')}`,
            greenRetryPacketStr: JSON.stringify({ ...widenedPacket, retry_hint: decision.reason }),
          }),
          stageOpts('green', { label: `green-widened:${taskId}`, phase: 'Act', model: model('deep'), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
          specFile, 'GREEN',
        )
      } else {
        const refusal = cfg.yolo && rejected.length > 0 ? ` (yolo auto-widen refused: [${rejected.join(', ')}] not inside src/)` : ''
        const err = `green_blocked_needs_write: [${decision.needsWrite.join(', ') || 'unspecified'}] — ${decision.reason}${refusal}`
        log(`[${taskId}] ${err}`)
        // Keep the partial implementation (caliper BUG L: three of four
        // criteria were done, cleanup removed the worktree, the work was
        // gone). A `wip(` commit is invisible to the RED/GREEN resume
        // detection, so the next GREEN starts from these edits.
        const partial = (green?.files_written || []).filter((f) => implFiles.includes(f))
        if (partial.length > 0) {
          const wipMsg = `wip(${taskId}): GREEN partial - blocked on ${decision.needsWrite.join(' ') || 'unspecified'}`.replace(/["`$\\]/g, '')
          const wipSteps = commitFilesSteps({ wt, files: partial, message: wipMsg })
          const wip = commitFilesFromSteps(await runBatch(wipSteps, stageOpts('cli', { label: `green-wip-commit:${taskId}`, phase: 'Act', model: model('fast') })))
          if (wip.committed) log(`[${taskId}] green_partial_committed: ${wip.sha} — [${partial.join(', ')}] kept on the lane branch as a wip commit`)
          else log(`[${taskId}] green_partial_not_committed: ${wip.nothingToCommit ? 'nothing to commit' : wip.error} — partial edits in [${partial.join(', ')}] will be lost at cleanup`)
        }
        return { task_id: taskId, status: 'blocked', stage: 'GREEN', error: err, needs_write: decision.needsWrite }
      }
    } else {
      // A null result is NOT "unknown": the agent returned nothing — turn cap
      // (agents/datum-green.md maxTurns), API error, or skipped — and may
      // have left half-applied edits in the worktree (wf_b1c88e09-036 BUG F:
      // 30 calls on a 555-line file, then a retry from the dirty tree). Name
      // it, and reset the worktree to the lane's last commit so the retry
      // starts from RED's state, not from an unknown partial edit.
      let firstFailure: string = green?.failure_reason || 'unknown'
      if (!green) {
        firstFailure = 'green_no_result: GREEN agent returned nothing (likely the maxTurns cap in agents/datum-green.md, an API error, or a skip)'
        const resetStepList = worktreeResetSteps(wt)
        const resetResult = await runBatch(resetStepList, stageOpts('cli', { label: `green-reset:${taskId}`, phase: 'Act', model: model('fast') }))
        const leftover = (stepStdout(resetResult, 'status') || '').trim()
        log(`[${taskId}] GREEN attempt 1: ${firstFailure}; worktree reset to HEAD before retry${leftover ? ` (WARNING: still dirty: ${leftover.split('\n').length} paths)` : ''}`)
      }
      log(`[${taskId}] GREEN attempt 1 failed (${greenModel}): ${firstFailure}, escalating to opus`)
      green = await witnessedAgent(
        greenRetryPrompt({
          ...greenVars,
          failureReason: firstFailure,
          greenRetryPacketStr: JSON.stringify({ ...greenPacket, retry_hint: firstFailure }),
        }),
        stageOpts('green', { label: `green-retry:${taskId}`, phase: 'Act', model: model('deep'), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
        specFile, 'GREEN',
      )
    }
  }

  if (!green) {
    return {
      task_id: taskId,
      status: 'failed',
      stage: 'GREEN',
      error: 'green_no_result: GREEN agent returned nothing on both attempts (likely the maxTurns cap in agents/datum-green.md — the lane may need a smaller scope, or the cap raised)',
    }
  }

  // Deterministic green-blindness gate (#386): the GREEN agent's tests_pass
  // is self-reported from a run IT performed and read the exit status from —
  // a hallucinated or mistaken "tests_pass: true" would merge a lane whose
  // tests never passed. Independently re-run the exact same test command
  // here (whenever GREEN ran at all — this is not gated behind
  // deterministicChecks(), unlike the ownership read below) and trust that
  // result over the agent's self-report, before ever consulting it.
  const postGreenVerify = postGreenSteps({ wt, verifyTestCmd: scopedTestCmd })
  const postGreenVerifyRaw = await runBatch(postGreenVerify, stageOpts('cli', { label: `post-green-verify:${taskId}`, phase: 'Act', model: model('fast') }))
  const postGreenVerifyResult = postGreenVerifyRaw
  const greenStrays = strayFilesFromSteps(postGreenVerifyResult)
  if (greenStrays.strays.length > 0) log(`[${taskId}] stray_untracked_files: ${greenStrays.strays.length} untracked file(s) left by GREEN ${greenStrays.cleaned ? 'removed' : 'NOT removed'} before the verify: ${greenStrays.strays.join(', ')}`)
  const greenVerdict = verifyVerdict(postGreenVerifyResult, 'post-green-verify')
  const greenEnvMissing = testEnvMissing(stepStdout(postGreenVerifyResult, 'test-verify'))
  if (greenEnvMissing) {
    log(`[${taskId}] test_env_missing: ${greenEnvMissing}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: `test_env_missing: ${greenEnvMissing} — the lane worktree has no test environment; GREEN's verify is not evidence` }
  }
  // elonchesd datum/player-guidance wf_dee84cc2-e64 task-001: the verify
  // batch returned nothing, exit=null was reported as green_verify_failed
  // and triage filed "GREEN lied"; the committed GREEN passed 434/434. No
  // parsed exit code is no verdict: named as unavailable, an infrastructure
  // failure, never a claim that the suite was red (verifyVerdict, property-tested).
  if (greenVerdict.kind === 'unavailable') {
    log(`[${taskId}] green_verify_unavailable: ${greenVerdict.why}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: `green_verify_unavailable: ${greenVerdict.why}` }
  }
  if (greenVerdict.kind === 'failed') {
    log(`[${taskId}] GREEN VERIFY FAILED: independent re-run of the test suite exited ${greenVerdict.exit} (expected 0), regardless of agent self-report (tests_pass=${green?.tests_pass})`)
    return {
      task_id: taskId,
      status: 'failed',
      stage: 'GREEN',
      error: `green_verify_failed: independent test-verify step exit=${greenVerdict.exit} (agent self-reported tests_pass=${green?.tests_pass})`,
    }
  }

  if (!green || !green.success || !green.tests_pass) {
    // #278: a bare "GREEN failed" with no diagnostics happens when the agent call itself
    // returns null (crashed, skipped, or exhausted rate-limit retries) — distinguish that
    // from a result that came back but simply didn't populate failure_reason.
    const reason = !green
      ? 'GREEN agent call returned no result after retries (subagent crashed, was skipped, or exhausted rate-limit backoff) — check the subagent transcript for this run to recover the actual failure cause'
      : green.failure_reason
      || `GREEN failed with no failure_reason reported (success=${green.success}, tests_pass=${green.tests_pass}, exit_code=${green.test_exit_code ?? 'n/a'})`
    log(`[${taskId}] GREEN FAILED: ${reason}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: reason }
  }

  if (!green.committed) {
    const check = await verifyCommitIndependently(taskId, wt, implFiles, greenPacket.commit_prefix, 'GREEN', cfg.epicBranch)
    if (check.committed) {
      log(`[${taskId}] GREEN: agent reported committed=false but independent check confirms a commit exists (${check.detail}) — treating as committed (#274)`)
      green = { ...green, committed: true, commit_sha: check.commitSha || green.commit_sha }
    } else if (green.tests_pass && check.clean === true) {
      // #296 follow-on: a lane whose acceptance criteria are already satisfied
      // (dep content merged in, or the epic base already had the change) has a
      // legitimate no-op GREEN — tests pass with a clean worktree and nothing
      // to commit. Its deliverable is the RED test commit; skeptics still run.
      log(`[${taskId}] GREEN: no implementation change needed — tests pass and worktree is clean (${check.detail}); accepting no-op GREEN with RED commit as deliverable`)
      green = { ...green, committed: true, commit_sha: red.commit_sha }
    } else {
      log(`[${taskId}] GREEN: agent did not commit — failing (independent check: ${check.detail})`)
      return { task_id: taskId, status: 'failed', stage: 'GREEN', error: `GREEN agent did not commit (independent check: ${check.detail})` }
    }
  }

  // Post-GREEN ownership (#368 item D): one datum-cli diff evaluated here,
  // or the standalone LLM check when the hooks are not installed.
  // The RED commit's own file list, read alongside the ownership diff: a
  // GREEN that rewrote one of THOSE files edited the tests. A test-classified
  // file RED never wrote (a fixture the ACs name, a doc) is not that.
  let redCommitted: string[] | null = null
  const checkGreenOwnership = async (labelSuffix: string): Promise<OwnershipCheckResult> => {
    if (deterministic) {
      const postGreen = postGreenSteps({ wt, redSha: red.commit_sha || null })
      const postGreenRaw = await runBatch(postGreen, stageOpts('cli', { label: `post-green${labelSuffix}:${taskId}`, phase: 'Act', model: model('fast') }))
      redCommitted = redCommittedFilesFromSteps(postGreenRaw)
      return ownershipFromStdout(stepStdout(postGreenRaw, 'ownership'), implFiles, testFiles)
    }
    return verifyFileOwnership(taskId, wt, 'GREEN', implFiles, testFiles)
  }
  let greenOwnership: OwnershipCheckResult = await checkGreenOwnership('')
  // GREEN that rewrote files the RED commit wrote is a TDD violation of the
  // stage, not a foreign-file violation: name it green_edited_tests, pin the
  // GREEN commit, reset the worktree to the RED commit and re-run GREEN once
  // with that as the hint (elonchesd wf_0593c210-f04 task-011). A retry that
  // violates again fails. Scoped to the RED commit's files (caliper BUG P):
  // when that list is unknown, fall back to the lane's test files.
  const ownTestsOnly = (o: OwnershipCheckResult): boolean => {
    if (o.checkFailed || o.violations.length === 0) return false
    const files = o.violations.map((v) => v.split(' ')[0])
    return files.every((f) => testFiles.includes(f) && (redCommitted === null || redCommitted.includes(f)))
  }
  if (!greenOwnership.ok && ownTestsOnly(greenOwnership) && red.commit_sha) {
    const touched = [...new Set(greenOwnership.violations.map((v) => v.split(' ')[0]))]
    const hint = `green_edited_tests: GREEN modified the lane's test files [${touched.join(', ')}]; write only the implementation files and never amend or rewrite the RED commit`
    const discardedRef = `${cfg.epicBranch}--${taskId}--discarded-green`
    log(`[${taskId}] ${hint} — pinning the GREEN commit to ${discardedRef}, resetting to the RED commit ${red.commit_sha} and re-running GREEN once`)
    const testsResetSteps = [...preserveHeadRefSteps(wt, discardedRef), ...worktreeResetToSteps(wt, red.commit_sha)]
    const testsReset = worktreeResetToFromSteps(
      await runBatch(testsResetSteps, stageOpts('cli', { label: `green-tests-reset:${taskId}`, phase: 'Act', model: model('fast') })),
      red.commit_sha,
    )
    if (!testsReset.ok) {
      return { task_id: taskId, status: 'failed', stage: 'GREEN', error: `${hint} (could not reset for the retry: ${testsReset.error})` }
    }
    log(`[${taskId}] green_discarded_ref: ${discardedRef} keeps the discarded GREEN commit ${green?.commit_sha || '(HEAD before reset)'}`)
    green = await witnessedAgent(
      greenRetryPrompt({
        ...greenVars,
        failureReason: hint,
        greenRetryPacketStr: JSON.stringify({ ...greenPacket, retry_hint: 'green_edited_tests' }),
      }),
      stageOpts('green', { label: `green-tests-retry:${taskId}`, phase: 'Act', model: model('deep'), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
      specFile, 'GREEN',
    )
    const retryVerify = await runBatch(postGreenSteps({ wt, verifyTestCmd: scopedTestCmd }), stageOpts('cli', { label: `post-green-tests-retry-verify:${taskId}`, phase: 'Act', model: model('fast') }))
    const retryVerdict = verifyVerdict(retryVerify, 'post-green-tests-retry-verify')
    if (retryVerdict.kind === 'unavailable' && green && green.success) {
      return { task_id: taskId, status: 'failed', stage: 'GREEN', error: `green_verify_unavailable: ${retryVerdict.why}` }
    }
    if (!green || !green.success || retryVerdict.kind !== 'passed') {
      return { task_id: taskId, status: 'failed', stage: 'GREEN', error: `${hint} — retry ${!green ? 'returned nothing' : !green.success ? `failed: ${green.failure_reason || 'no reason'}` : `did not pass the suite (exit=${retryVerdict.exit})`}` }
    }
    greenOwnership = await checkGreenOwnership('-tests-retry')
    if (!greenOwnership.ok && ownTestsOnly(greenOwnership)) {
      return { task_id: taskId, status: 'failed', stage: 'GREEN', error: `green_edited_tests: GREEN modified test files again on retry [${[...new Set(greenOwnership.violations.map((v) => v.split(' ')[0]))].join(', ')}]` }
    }
  }
  if (!greenOwnership.ok) {
    const greenPrefix = greenOwnership.checkFailed ? 'ownership_check_failed' : 'file_ownership_violation'
    log(`[${taskId}] GREEN ${greenPrefix.toUpperCase()}: ${greenOwnership.violations.join(', ')}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: `${greenPrefix}: ${greenOwnership.violations.join(', ')}` }
  }
  log(`[${taskId}] GREEN verified — all tests pass (committed: ${green.commit_sha || 'n/a'})`)
  await updateStage(issueId, 'green', green.commit_sha)

  // ── Adversarial skeptic panel (independent evaluators — stay separate) ──
  // A BROKEN cross-validated verdict must not be logged and silently ignored:
  // the confirmed bugs are fed into ONE GREEN retry (reusing the existing
  // green-retry path), and the retry is independently re-verified (test-verify
  // + a second skeptic pass) before the lane is allowed into REFACTOR as if
  // GREEN were sound. FRAGILE stays log-only, unchanged.
  let skeptic = await runSkepticPanel(taskId, wt, implFiles, testFiles, scopedTestCmd, specFile)

  if (skeptic.brokenCount >= 2) {
    const confirmedBugs = skeptic.crossValidated.length > 0 ? skeptic.crossValidated : skeptic.allBugs
    const bugSummary = confirmedBugs.map((b) => `- [${b.severity}] ${b.description} (evidence: ${b.evidence})`).join('\n') || 'no bug detail available'
    log(`[${taskId}] SKEPTIC VERDICT: ${skeptic.brokenCount}/3 BROKEN — retrying GREEN once with ${confirmedBugs.length} confirmed bug(s)`)

    const skepticRetryPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, scopedLaneCfg, 'GREEN', specFile, greenExtras)
    green = await witnessedAgent(
      greenRetryPrompt({
        ...greenVars,
        failureReason: `The skeptic panel found confirmed bugs in the GREEN implementation. Fix them without breaking the tests.\nSKEPTIC FINDINGS:\n${bugSummary}`,
        greenRetryPacketStr: JSON.stringify({ ...skepticRetryPacket, retry_hint: 'skeptic_broken', skeptic_bugs: confirmedBugs }),
      }),
      stageOpts('green', { label: `green-skeptic-retry:${taskId}`, phase: 'Act', model: model('deep'), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
      specFile, 'GREEN',
    )

    // Independent re-verification of the retry — never trust the retry
    // agent's own self-report alone (same green-blindness concern as #386).
    const retryVerifySteps = postGreenSteps({ wt, verifyTestCmd: scopedTestCmd })
    const retryVerifyRaw = await runBatch(retryVerifySteps, stageOpts('cli', { label: `post-green-skeptic-retry-verify:${taskId}`, phase: 'Act', model: model('fast') }))
    const retryVerifyVerdict = verifyVerdict(retryVerifyRaw, 'post-green-skeptic-retry-verify')

    if (retryVerifyVerdict.kind === 'unavailable' && green && green.success) {
      return { task_id: taskId, status: 'failed', stage: 'GREEN', error: `green_verify_unavailable: ${retryVerifyVerdict.why}` }
    }
    if (retryVerifyVerdict.kind !== 'passed' || !green || !green.success) {
      const first = confirmedBugs[0]
      const summary = first ? first.description : 'GREEN retry did not produce a passing, committed fix'
      log(`[${taskId}] SKEPTIC RETRY FAILED: independent test-verify exit=${retryVerifyVerdict.exit ?? 'null'}`)
      return {
        task_id: taskId,
        status: 'failed',
        stage: 'GREEN',
        error: `skeptic_broken: ${confirmedBugs.length} confirmed bugs — ${summary}`,
      }
    }

    // A second, independent skeptic pass over the retried implementation.
    skeptic = await runSkepticPanel(taskId, wt, implFiles, testFiles, scopedTestCmd, specFile)
    if (skeptic.brokenCount >= 2) {
      const stillConfirmed = skeptic.crossValidated.length > 0 ? skeptic.crossValidated : skeptic.allBugs
      const first = stillConfirmed[0]
      const summary = first ? first.description : 'implementation still broken after retry'
      log(`[${taskId}] SKEPTIC VERDICT after retry: ${skeptic.brokenCount}/3 still BROKEN`)
      return {
        task_id: taskId,
        status: 'failed',
        stage: 'GREEN',
        error: `skeptic_broken: ${stillConfirmed.length} confirmed bugs — ${summary}`,
      }
    }
    log(`[${taskId}] SKEPTIC VERDICT after retry: PASS (${skeptic.crossValidated.length} cross-validated)`)
  } else {
    log(`[${taskId}] SKEPTIC VERDICT: PASS (${skeptic.crossValidated.length} cross-validated)`)
  }

  // ── Skeptic minority findings (caliper#564) ──
  // A critical/high finding one lens evidenced and the others did not
  // corroborate is not a retry trigger, but it must not vanish into the
  // journal: name it in the log and write it as a FollowUpIssue under the
  // run directory, where `datum closeout-file-followups` files it.
  const minority = skepticMinorityFindings(skeptic.allBugs, skeptic.crossValidated)
  let followUps = 0
  if (minority.length > 0) {
    for (const b of minority) log(`[${taskId}] skeptic_minority_finding: ${taskId} — [${b.severity}] ${b.description.replace(/\s+/g, ' ').slice(0, 160)} (${b.lens}: ${b.evidence.replace(/\s+/g, ' ').slice(0, 120)})`)
    const followUpPath = `.datum/runs/${runId}/follow-ups/${taskId}.json`
    const followUpText = JSON.stringify(minorityFollowUps(taskId, green.commit_sha || '', minority), null, 2)
    const fuSteps = writeFileSteps({ path: followUpPath, content: followUpText })
    const fuWrite = writeFileFromSteps(
      await runBatch(fuSteps, stageOpts('cli', { label: `followups-write:${taskId}`, phase: 'Act', model: model('fast') })),
      { path: followUpPath, expectedSha: writeFileBlobSha(followUpText), prefix: 'followups' },
    )
    if (!fuWrite.ok) log(`[${taskId}] ${fuWrite.error} — ${minority.length} skeptic minority finding(s) stay in this log only`)
    else followUps = minority.length
  }

  // ── Strays before REFACTOR (caliper eedom wf_fa38ac24-890 task-005) ──
  // The skeptic lenses may write repro files while demonstrating a finding;
  // REFACTOR's test run collected four of them and failed on a pristine
  // GREEN commit. Untracked files between stages are strays: removed and
  // named. Fails soft — the batch not running is a named absence.
  // The deterministic tell scan (unslop-code) rides the same batch: one
  // runner call, and its hits decide whether REFACTOR runs at all.
  const preRefactor = await runBatch(
    [...strayCleanSteps(wt), ...codeTellSteps({ wt, files: [...implFiles, ...testFiles], baseRef: scopedLaneCfg.epicBranch })],
    stageOpts('cli', { label: `stray-clean:${taskId}`, phase: 'Act', model: model('fast') }),
  )
  const strayOutcome = strayFilesFromSteps(preRefactor)
  if (strayOutcome.cleaned === null) log(`[${taskId}] stray_clean_unchecked: could not list untracked files in the worktree before REFACTOR`)
  else if (strayOutcome.strays.length > 0) log(`[${taskId}] stray_untracked_files: ${strayOutcome.strays.length} untracked file(s) left by a prior stage ${strayOutcome.cleaned ? 'removed' : 'NOT removed'} before REFACTOR: ${strayOutcome.strays.join(', ')}`)
  const tells = tellLines(stepStdout(preRefactor, 'tell-scan'))

  // ── REFACTOR (writes + verifies + commits in one agent) ──
  const refResult = await runRefactor(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg, specFile, tells)
  // Must check `.verified`, not just truthiness: runRefactor returns a
  // `{ verified: false, error }` OBJECT (truthy) for a real REFACTOR failure,
  // not null — a bare `!refResult` check here would have treated that as
  // success and reported the lane completed.
  if (!refResult || !refResult.verified) {
    return { task_id: taskId, status: 'failed', stage: 'REFACTOR', error: refResult?.error || 'refactor failed' }
  }

  log(`[${taskId}] === LANE COMPLETE ===`)
  await updateStage(issueId, 'done')
  return followUps > 0
    ? { task_id: taskId, status: 'completed', stage: 'REFACTOR', follow_ups: followUps }
    : { task_id: taskId, status: 'completed', stage: 'REFACTOR' }
}

// ── Adversarial skeptic panel ────────────────────────────────────────────────
// Extracted so the BROKEN-verdict retry path in runLane() can run it a second
// time, independently, over the retried implementation.

interface SkepticPanelResult {
  allBugs: ReturnType<typeof crossValidateBugs>['allBugs']
  brokenCount: number
  crossValidated: ReturnType<typeof crossValidateBugs>['crossValidated']
}

async function runSkepticPanel(
  taskId: string,
  wt: string,
  implFiles: string[],
  testFiles: string[],
  scopedTestCmd: string,
  specFile: ContextFile,
): Promise<SkepticPanelResult> {
  const base: string = skepticBasePrompt({
    wt, implFiles: implFiles.join(', '), testFiles: testFiles.join(', '),
    testCommand: scopedTestCmd, laneSpec: specFile,
  })
  const lenses = skepticLenses()
  const skepticResults = await parallel<SkepticResult>(
    lenses.map((lens) => () =>
      agent(base + lens.prompt, stageOpts('skeptic', { label: `skeptic-${lens.key}:${taskId}`, phase: 'Act', model: lens.model as ModelName, schema: SKEPTIC_SCHEMA }))
    ),
  )

  // A lens that did not evidence reading the spec file did not review against
  // the criteria: drop it from the vote by name (caliper BUG K3 — one haiku
  // lens mangled its witness while two verified). Only when NO lens verified
  // is the panel void, and that fails the lane at GREEN.
  let verifiedLenses = 0
  for (let i = 0; i < skepticResults.length; i++) {
    const r = skepticResults[i]
    if (r === null) continue
    const w = verifyReadWitness([specFile], r)
    if (w.ok) { verifiedLenses++; continue }
    log(`[${taskId}] skeptic_lens_unverified: ${taskId} — lens ${lenses[i].key} did not evidence reading ${specFile.path} (${w.tooShort.length ? 'prefix too short' : w.mismatched.length ? 'wrong prefix' : 'no witness'}); its ${r.verdict} verdict and ${(r.bugs_found || []).length} bug(s) are dropped from the vote`)
    skepticResults[i] = null
  }
  if (verifiedLenses === 0) {
    const err = new Error(`context_read_unverified: ${specFile.path} — no skeptic lens evidenced reading the lane spec; the panel is void`)
    ;(err as Error & { stage?: LaneOutcome['stage'] }).stage = 'GREEN'
    throw err
  }
  const { allBugs, brokenCount, crossValidated } = crossValidateBugs(skepticResults, lenses)
  for (let i = 0; i < lenses.length; i++) {
    const s = skepticResults[i]
    if (!s) { log(`[${taskId}] SKEPTIC ${lenses[i].key}: (null)`); continue }
    log(`[${taskId}] SKEPTIC ${lenses[i].key}: ${s.verdict} (${(s.bugs_found || []).length} bugs)`)
    for (const bug of (s.bugs_found || [])) {
      log(`[${taskId}]   - [${bug.severity}] ${bug.description}`)
    }
  }
  return { allBugs, brokenCount, crossValidated }
}

// ── Refactor sub-saga ──────────────────────────────────────────────────────

async function runRefactor(
  taskId: string,
  lane: Lane,
  testFiles: string[],
  implFiles: string[],
  wt: string,
  cfg: PipelineConfig,
  specFile: ContextFile,
  tells: string[],
): Promise<{ verified: boolean; error?: string } | null> {
  log(`[${taskId}] REFACTOR: checking if needed`)

  // `tells` is the deterministic scan (unslop-code) over the lane's added
  // lines. A hit is a real problem, so it decides REFACTOR runs without
  // asking the checker; the checker reads only for what a regex cannot see.
  const laneFiles = [...implFiles, ...testFiles]
  const tellsSlot = tells.length > 0 ? tells.join('\n') : '(none)'
  let reason = tells.length > 0 ? `code_tells: ${tells.length} on added lines (${tells.slice(0, 3).join('; ')}${tells.length > 3 ? '; …' : ''})` : ''

  if (tells.length === 0) {
    // resilientAgent, not agent(): a prose reply to a schema'd call makes the
    // runtime throw, which used to escape as a lane CRASH (see reflect above).
    const preCheck: RefactorCheck | null = await resilientAgent(
      refactorCheckPrompt({ wt, allFiles: laneFiles.join(', '), tellsSlot }),
      stageOpts('reader', { label: `refactor-check:${taskId}`, phase: 'Act', model: model('fast'), schema: REFACTOR_CHECK_SCHEMA, maxRetries: 1 }),
    )

    if (!preCheck) {
      // Nothing came back — not the same as "nothing to improve". REFACTOR is
      // optional, so skip it, but by its real name.
      log(`[${taskId}] refactor_check_no_result: refactor-check agent returned nothing on both attempts — skipping the optional REFACTOR stage`)
      return { verified: true }
    }
    if (!preCheck.should_refactor) {
      log(`[${taskId}] REFACTOR: skipped (${preCheck.reason || 'nothing to improve'})`)
      return { verified: true }
    }
    reason = preCheck.reason || 'checker asked for it'
  }

  log(`[${taskId}] REFACTOR: proceeding (${reason})`)

  const refactorPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, cfg, 'REFACTOR', specFile, {})
  const refactorCtxCmd: string = laneCtxCmd(refactorPacket, wt)

  const refactor: StageResult | null = await resilientAgent(
    refactorPrompt({
      wt,
      refactorCtxCmd,
      refactorPacketStr: JSON.stringify(refactorPacket),
      testCommand: cfg.testCommand,
      testRunCmd: testRunCommand(cfg.testCommand, wt, 'REFACTOR'),
      allFilesList: [...testFiles, ...implFiles].join(' '),
      commitPrefix: refactorPacket.commit_prefix,
      // Same author/trailer scheme as RED and GREEN (#357) — a REFACTOR commit
      // under the user's identity was being read as a stray concurrent writer.
      commitCmd: laneCommitCommand({ wt, taskId, stage: 'REFACTOR', runId: cfg.runId }),
      tellsSlot,
    }),
    stageOpts('refactor', { label: `refactor:${taskId}`, phase: 'Act', model: model('balanced'), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
  )

  if (!refactor) {
    // A null result is NOT "nothing to change" — the agent returned nothing
    // (turn cap in agents/datum-refactor.md, an API error, or a skip) and may
    // have left half-applied refactor edits in the worktree. REFACTOR is
    // optional, so reset to HEAD (no partial edit survives) and confirm
    // independently the suite is still green from that reset tree before
    // treating it as "no refactor applied" — never blindly return verified:true.
    const failure = 'refactor_no_result: REFACTOR agent returned nothing (likely the maxTurns cap in agents/datum-refactor.md, an API error, or a skip)'
    log(`[${taskId}] REFACTOR: ${failure} — treating as no refactor applied (optional stage)`)
    return verifyWithoutRefactor(taskId, wt, cfg, failure)
  }

  if (!refactor.success) {
    if (refactor.failure_reason?.toLowerCase().includes('nothing to')) {
      log(`[${taskId}] REFACTOR: nothing to change`)
      return { verified: true }
    }
    // caliper eedom wf_fa38ac24-890 task-005: REFACTOR answered
    // {status:"blocked", needs_write:[]} because the mandated test run failed
    // for a reason outside its scope, committed nothing, and the lane was
    // failed as agent behaviour on a pristine GREEN tree, then re-run from
    // scratch. REFACTOR is optional: an honest "could not refactor" with no
    // commit is "no refactor applied" — reset any partial edit, verify the
    // committed tree independently, and complete the lane by that name.
    // A failure WITH a commit stays refactor_failed: something landed.
    if (!refactor.committed) {
      const reason = `refactor_skipped: ${refactor.failure_reason || (refactor.status === 'blocked' ? 'REFACTOR reported blocked' : 'REFACTOR reported no success')}`
      log(`[${taskId}] REFACTOR: ${reason}${refactor.status === 'blocked' && (refactor.needs_write?.length ?? 0) > 0 ? ` (needs_write: ${refactor.needs_write!.join(', ')})` : ''} — treating as no refactor applied (optional stage)`)
      return verifyWithoutRefactor(taskId, wt, cfg, reason)
    }
    log(`[${taskId}] REFACTOR FAILED: ${refactor.failure_reason || 'unknown'}`)
    // A bare `null` here — as opposed to `{ verified: false, error }` — is
    // what let the caller's generic 'refactor failed' fallback swallow the
    // agent's real failure_reason (elonchesd wf_93040d99-e3c -> wf_30d8f723-8d3):
    // `r?.error` on a null `r` is always undefined, so triage never saw why.
    return { verified: false, error: `refactor_failed: ${refactor.failure_reason || 'unknown'}` }
  }

  // Independent verification — never the agent's self-reported tests_pass
  // (same rule as RED/GREEN/Validate). One batch: re-run the suite; if it is
  // red and the agent committed, revert that commit deterministically and
  // re-run once more. A tree that is still red after the revert is a real
  // failure of the lane, not something to return verified:true over.
  const verifySteps = [
    { name: 'test-verify', command: testRunCommand(cfg.testCommand, wt, 'refactor-verify'), tolerant: true },
    // Rescan in the same batch when there were hits: what survived is named.
    ...(tells.length > 0 ? codeTellSteps({ wt, files: laneFiles, baseRef: cfg.epicBranch }) : []),
  ]
  const verifyRaw = await runBatch(verifySteps, stageOpts('cli', { label: `post-refactor-verify:${taskId}`, phase: 'Act', model: model('fast') }))
  let refactorVerifyExit = testExitCode(stepStdout(verifyRaw, 'test-verify'))
  if (refactorVerifyExit !== 0) {
    log(`[${taskId}] REFACTOR VERIFY FAILED: independent run exit=${refactorVerifyExit ?? 'n/a'} (agent self-reported tests_pass=${!!refactor.tests_pass}) — ${refactor.committed ? 'reverting the refactor commit' : 'agent reported no commit'}`)
    if (refactor.committed) {
      const revertSteps = [
        { name: 'revert', command: `git -C "${wt}" revert --no-edit HEAD`, tolerant: true },
        { name: 'test-verify', command: testRunCommand(cfg.testCommand, wt, 'refactor-reverify'), tolerant: true },
      ]
      const revertRaw = await runBatch(revertSteps, stageOpts('cli', { label: `revert-refactor:${taskId}`, phase: 'Act', model: model('fast') }))
      const revertResult = revertRaw
      refactorVerifyExit = testExitCode(stepStdout(revertResult, 'test-verify'))
      log(`[${taskId}] REFACTOR reverted (revert exit=${stepResult(revertResult, 'revert')?.exit_code ?? 'n/a'}); suite after revert exit=${refactorVerifyExit ?? 'n/a'}`)
    }
    if (refactorVerifyExit !== 0) {
      return { verified: false, error: `refactor_verify_failed: suite red after REFACTOR (independent exit=${refactorVerifyExit ?? 'no result'})${refactor.committed ? ' even after reverting the refactor commit' : ''}` }
    }
    return { verified: true }
  }

  log(`[${taskId}] REFACTOR: clean (committed: ${refactor.commit_sha || 'n/a'}; independent verify exit=0)`)
  if (tells.length > 0) {
    // Advisory: what the scan still sees after REFACTOR is named, never a halt.
    const left = tellLines(stepStdout(verifyRaw, 'tell-scan'))
    if (left.length > 0) log(`[${taskId}] code_tells_remaining: ${left.length} of ${tells.length} tell(s) survived REFACTOR — ${left.slice(0, 5).join('; ')}`)
  }
  return { verified: true }
}

/** One line per scanner finding, for logs and prompt slots. */
function tellLines(stdout: string | null | undefined): string[] {
  return parseTellScan(stdout).map((t) => `${t.file}:${t.line} ${t.tag}: ${t.text.trim()}`)
}

/**
 * "No refactor applied": reset the worktree to HEAD (no partial edit
 * survives), then confirm independently that the committed tree is green.
 * `why` names the reason (refactor_no_result, refactor_skipped: ...). A red
 * suite after the reset is the lane's failure, never verified:true.
 */
async function verifyWithoutRefactor(taskId: string, wt: string, cfg: PipelineConfig, why: string): Promise<{ verified: boolean; error?: string }> {
  const resetResult = await runBatch(worktreeResetSteps(wt), stageOpts('cli', { label: `refactor-reset:${taskId}`, phase: 'Act', model: model('fast') }))
  const leftover = (stepStdout(resetResult, 'status') || '').trim()
  log(`[${taskId}] REFACTOR: worktree reset to HEAD${leftover ? ` (WARNING: still dirty: ${leftover.split('\n').length} paths)` : ''}`)

  const verifySteps = [
    { name: 'test-verify', command: testRunCommand(cfg.testCommand, wt, 'refactor-verify'), tolerant: true },
  ]
  const verifyResult = await runBatch(verifySteps, stageOpts('cli', { label: `post-refactor-verify:${taskId}`, phase: 'Act', model: model('fast') }))
  if (verifyResult.missing) {
    return { verified: false, error: `refactor_verify_failed: ${why} (verify batch could not run: ${describeFailure(verifyResult, 'post-refactor-verify')})` }
  }
  const exit = testExitCode(stepStdout(verifyResult, 'test-verify'))
  if (exit !== 0) {
    return { verified: false, error: `refactor_verify_failed: suite red on the committed tree after ${why} (independent exit=${exit ?? 'no result'})` }
  }
  return { verified: true }
}

// ── DAG scheduler ───────────────────────────────────────────────────────────

phase('Act')

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
    const crossBatchDeps: string[] = allDeps.filter((d) => !batchLaneIds.includes(d))
    const crossBatchFailed: string[] = crossBatchDeps.filter((d) => priorFailures.includes(d))
    // Deps that were never executed: not in current batch, not completed, not failed
    const crossBatchMissing: string[] = crossBatchDeps.filter(
      (d) => !priorFailures.includes(d) && !(priorCompleted || []).includes(d),
    )

    if (crossBatchFailed.length > 0 || crossBatchMissing.length > 0) {
      const failedPart = crossBatchFailed.length > 0 ? `failed [${crossBatchFailed.join(', ')}]` : ''
      const missingPart = crossBatchMissing.length > 0 ? `never executed [${crossBatchMissing.join(', ')}]` : ''
      const err = `blocked: cross-batch dep(s) ${[failedPart, missingPart].filter(Boolean).join(', ')}`
      log(`[${taskId}] ${err}`)
      const skipResult: LaneOutcome = { task_id: taskId, status: 'blocked', stage: 'SKIPPED', error: err }
      depResolvers[taskId](skipResult)
      return skipResult
    }

    const inBatchDeps: string[] = allDeps.filter((d) => batchLaneIds.includes(d))
    if (inBatchDeps.length > 0) {
      log(`[${taskId}] waiting on deps: [${inBatchDeps.join(', ')}]`)
      const depResults: LaneOutcome[] = await Promise.all(inBatchDeps.map((d) => depPromises[d]))
      const failedDeps: LaneOutcome[] = depResults.filter((r) => r.status !== 'completed')
      if (failedDeps.length > 0) {
        const err = `blocked: dep(s) failed [${failedDeps.map((r) => r.task_id).join(', ')}]`
        log(`[${taskId}] ${err}`)
        const skipResult: LaneOutcome = { task_id: taskId, status: 'blocked', stage: 'SKIPPED', error: err }
        depResolvers[taskId](skipResult)
        return skipResult
      }

      // #296: dep lane work exists only on the dep's lane branch until the
      // end-of-batch squash merge — merge it into this lane's worktree so
      // RED/GREEN compile against types the dep introduced. Squash merges
      // apply in topo order at batch end, so the dep content dedupes cleanly.
      const wt = worktreePaths[taskId]
      if (typeof wt === 'string' && wt.startsWith('/')) {
        const depBranches: string[] = inBatchDeps.map((d) => `${cfg.epicBranch}--${d}`)
        // Batch with exit codes (shared/lane-steps.ts): a failed merge is
        // aborted in its own step, and the verdict is the step's exit code —
        // not a regex over a runner's echo, which could say "done" after a
        // conflict and leave the worktree mid-merge for RED to run on.
        const depMergeStepList = depMergeSteps(wt, depBranches)
        const depMerge = depMergeFromSteps(parseBatchResult(
          await resilientAgent(batchCommandPrompt(depMergeStepList), stageOpts('cli', { label: `dep-merge:${taskId}`, model: 'haiku' })),
          depMergeStepList,
        ), depBranches)
        if (!depMerge.ok) {
          log(`[${taskId}] ${depMerge.error}`)
          const failResult: LaneOutcome = { task_id: taskId, status: 'failed', stage: 'CRASH', error: depMerge.error }
          depResolvers[taskId](failResult)
          return failResult
        }
        log(`[${taskId}] merged in-batch dep branches: [${depBranches.join(', ')}]`)
      }
    }

    log(`[${taskId}] deps satisfied — launching`)
    let result: LaneOutcome
    try {
      const r = await runLane(taskId, lanePlan, worktreePaths, cfg)
      result = r || { task_id: taskId, status: 'failed', stage: 'UNKNOWN', error: 'null result' }
    } catch (e) {
      const staged = (e as { stage?: LaneOutcome['stage'] }).stage
      result = { task_id: taskId, status: 'failed', stage: staged || 'CRASH', error: e instanceof Error ? e.message : String(e) }
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
