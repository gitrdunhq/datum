import { model, type ModelName } from './shared/models'
import { resilientAgent, verifyCommitIndependently } from './shared/agents'
import { updateStage, getIssueId } from './shared/tracker'
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
  verifyFileOwnership as verifyFileOwnershipMatch,
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
  return verifyFileOwnershipMatch(changed, allowedFiles, forbiddenFiles)
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
  const issueId: string = getIssueId(lanePlan as any, taskId)
  const runId: string = (cfg as any).runId
  const isStructural: boolean = lane.stage === 'structural'
  const { testFiles, implFiles } = classifyFiles(lane.files)
  const acStr: string = (lane.acceptance_criteria || []).join('\n')
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
  if (completionPath) {
    const completionExist: string | null = await agent(
      `Read the file: cat "${completionPath}" 2>/dev/null || echo ""
If the file exists, return ONLY its raw contents (valid JSON).
If the file does not exist or is empty, return exactly: MISSING
No markdown fences, no explanation.`,
      { label: `completion-check:${taskId}`, phase: 'Act', model: model('fast') },
    )
    if (completionExist && completionExist.trim() !== 'MISSING') {
      const compData = parseAgentJson<{ task_id?: string }>(completionExist, {})
      if (compData.task_id === taskId) {
        log(`[${taskId}] lane already completed in a prior run — skipping`)
        return { task_id: taskId, status: 'skipped', stage: 'SKIPPED', error: 'cross-run completion: lane was completed in a previous run' }
      }
    }
  }

  log(`[${taskId}] Starting: ${lane.title} (${isStructural ? 'structural' : 'behavioral'}, ${testFiles.length} test, ${implFiles.length} impl)`)

  // ── File-based completion write helper ──
  async function writeCompletion(): Promise<void> {
    if (!runId) return
    const cp = `.datum/runs/${runId}/lane-state/${taskId}.json`
    const dir = cp.split('/').slice(0, -1).join('/')
    await agent(
      `Run: mkdir -p ./${dir}
Write to file: ./${cp}
Write: {"task_id": "${taskId}", "status": "completed"}
List the files changed.`,
      { label: `completion-write:${taskId}`, phase: 'Act', model: model('fast') },
    )
  }

  if (isStructural) {
    const r = await runRefactor(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg)
    if (!r) return { task_id: taskId, status: 'failed', stage: 'REFACTOR', error: 'refactor failed' }
    await updateStage(issueId, 'done')
    await writeCompletion()
    return { task_id: taskId, status: 'completed', stage: 'REFACTOR' }
  }

  // ── Pre-RED cleanup: remove stray untracked test files from prior skeleton runs ──
  // Stray files from pre-preflight skeleton writes or abandoned tasks pollute
  // test collectors (pytest/vitest).  Remove any test file that is untracked
  // but not listed in the lane plan's files[].
  //
  // Deletion decisions are made by datum's own `lane-cleanup` command (plain
  // Python, no LLM in the loop) — not by handing a sub-agent a "find files
  // matching a pattern, then rm each one" prompt. The latter is indistinguishable
  // from an arbitrary shell deletion to any permission classifier watching the
  // sub-agent's tool calls, because it is one.
  const scriptTestPattern = /\.(test|spec)\.(ts|js|tsx|jsx)$|(^|\/)test_.*\.py$/
  if (testFiles.some(f => scriptTestPattern.test(f))) {
    const allowedArgs = testFiles.map(f => `--allowed "${f.replace(/"/g, '\\"')}"`).join(' ')
    const cleanupCmd = `datum lane-cleanup "${wt}" ${allowedArgs}`
    await agent(`Run: ${cleanupCmd}`, {
      label: `pre-red-cleanup:${taskId}`,
      phase: 'Act',
      model: model('fast'),
    })
    log(`[${taskId}] Pre-RED cleanup completed`)
  } else {
    log(`[${taskId}] Pre-RED cleanup skipped (lane has no JS/TS/Py test files)`)
  }

  // ── RED (writes tests + verifies they fail + commits) ──
  log(`[${taskId}] RED: writing failing tests`)
  const skeletonCmd = `datum skeleton --task-id ${taskId} --language ${laneLanguage} --tasks ${cfg.lanePlanPath} --output .datum/runs/${cfg.runId}/preflight-${taskId}.json`
  const preflightPath = `.datum/runs/${cfg.runId}/preflight-${taskId}.json`

  // Check for pre-generated skeletons from Plan phase first
  const planSkeletonPath = cfg.skeletonDir
    ? `${cfg.skeletonDir}/preflight-${taskId}.json`
    : ''

  let targetContext: Record<string, string[]> | undefined
  let preflightRaw: string | null = null

  if (planSkeletonPath) {
    preflightRaw = await agent(
      `Read the file: cat "${planSkeletonPath}" 2>/dev/null || echo ""
If the file exists, return ONLY its raw JSON contents.
If the file does not exist or is empty, return exactly: MISSING
No markdown fences, no explanation.`,
      { label: `skeleton-read:${taskId}`, phase: 'Act', model: model('fast') },
    )
    if (preflightRaw && preflightRaw.trim() !== 'MISSING') {
      log(`[${taskId}] using pre-generated skeleton from Plan phase`)
    } else {
      preflightRaw = null
    }
  }

  // Fall back to generating skeleton if Plan didn't provide one
  if (!preflightRaw) {
    preflightRaw = await agent(
      `Run: ${skeletonCmd}
Then read the output file: cat "${wt}/${preflightPath}" 2>/dev/null || echo "{}"
Return ONLY the raw JSON contents of the file. No markdown fences, no explanation.`,
      { label: `preflight:${taskId}`, phase: 'Act', model: model('fast') },
    )
  }

  let preflightFramework: string | undefined
  let preflightTestPaths: string[] = []
  if (preflightRaw) {
    const preflightData = parseAgentJson<{ target_context?: Record<string, string[]>; framework?: string; outputs?: Array<{ path?: string }> }>(preflightRaw, {})
    if (preflightData.target_context) {
      targetContext = preflightData.target_context
      log(`[${taskId}] target_context extracted: ${Object.keys(targetContext).join(', ')}`)
    }
    preflightFramework = preflightData.framework
    if (preflightData.outputs && preflightData.outputs.length > 0) {
      for (const output of preflightData.outputs) {
        if (output.path && !testFiles.includes(output.path)) {
          testFiles.push(output.path)
          preflightTestPaths.push(output.path)
        }
      }
      if (preflightTestPaths.length > 0) {
        log(`[${taskId}] preflight registered ${preflightTestPaths.length} test file(s): ${preflightTestPaths.join(', ')}`)
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
  const redPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, 'RED', redExtras)
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
    testFilesList: testFiles.join(' '),
    commitPrefix: redPacket.commit_prefix,
    taskId,
    testFuncPattern: testFuncLabel,
  }

  let red: StageResult | null = await resilientAgent(
    redPrompt(promptVars),
    { label: `red:${taskId}`, phase: 'Act', model: model('balanced'), schema: STAGE_RESULT_SCHEMA, worktree: wt },
  )

  if (red?.success) {
    log(`[${taskId}] RED wrote: ${(red.files_written || []).join(', ')}`)
  }

  // ── Commit check first — prevents misleading 'found 0' errors from count gate (#245) ──
  if (!red || !red.committed) {
    const check = await verifyCommitIndependently(taskId, wt, testFiles, redPacket.commit_prefix, 'RED')
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
      log(`[${taskId}] RED: agent did not commit — failing (independent check: ${check.detail})`)
      return { task_id: taskId, status: 'failed', stage: 'RED', error: `RED agent did not commit (independent check: ${check.detail})` }
    }
  }

  if (!red || !red.success) {
    log(`[${taskId}] RED attempt 1 failed: ${red?.failure_reason || 'unknown'}, retrying`)
    red = await resilientAgent(
      redRetryPrompt({ ...promptVars, failureReason: red?.failure_reason || 'unknown' }),
      { label: `red-retry:${taskId}`, phase: 'Act', model: model('balanced'), schema: STAGE_RESULT_SCHEMA, worktree: wt },
    )
  }

  if (!red || !red.success) {
    log(`[${taskId}] RED FAILED: ${red?.failure_reason || 'no files written after 2 attempts'}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: red?.failure_reason || 'RED failed' }
  }

  // ── New-test-function count gate — deterministic script execution, no LLM mediation (#253) ──
  // NOTE: We tried replacing this with direct child_process.execSync(), but the build
  // script strips require() calls and TypeScript has no @types/node. The architecture
  // fundamentally routes all shell through the agent() API. The fix attempted here was to
  // harden the error path (fail loudly on script error rather than silently defaulting to 0)
  // while keeping the agent call. See git commit for details.
  const acCount = (lane.acceptance_criteria || []).length
  if (acCount > 0) {
    let newTestCount = 0
    let gatePassed = false
    const countRaw: string | null = await agent(
      `Run this EXACT sequence of two commands verbatim:
1. Write the pattern to a temp file (the quoted heredoc delimiter means the shell does no interpretation of its contents — copy the line between the markers exactly as-is):
PATFILE=$(mktemp)
cat > "$PATFILE" <<'PATTERN_EOF'
${testFuncDiffRegex}
PATTERN_EOF
2. Run the gate script against that file:
bash scripts/test-count-gate --repo "${wt}" --files ${testFiles.map(f => `"${f}"`).join(' ')} --pattern-file "$PATFILE" --required ${acCount}
Return ONLY the raw stdout of the second command. Do not reformat, summarize, or add any text. No markdown fences, no explanation.`,
      {
        label: `test-count-check:${taskId}`, phase: 'Act', model: model('fast'),
      },
    )
    // Parse the JSON output from the script
    if (countRaw && typeof countRaw === 'object') {
      const obj = countRaw as { new_test_count?: number; passed?: boolean }
      newTestCount = obj.new_test_count || 0
      gatePassed = obj.passed !== undefined ? Boolean(obj.passed) : newTestCount >= acCount
    } else {
      const text = (countRaw as string).trim()
      const match = text.match(/\{"new_test_count":\s*(\d+)/)
      if (match) {
        newTestCount = parseInt(match[1], 10)
        const passedMatch = text.match(/"passed":\s*(true|false)/)
        gatePassed = passedMatch ? passedMatch[1] === 'true' : newTestCount >= acCount
      } else {
        // Hard fallback — try to extract any number of grep matches from the text
        const digits = text.replace(/[^0-9]/g, '')
        newTestCount = digits ? parseInt(digits, 10) : 0
        gatePassed = newTestCount >= acCount
      }
    }
    if (!gatePassed) {
      log(`[${taskId}] RED FAILED: only ${newTestCount} new test functions found, need >= ${acCount} (one per AC)`)
      return { task_id: taskId, status: 'failed', stage: 'RED', error: `no_new_test_functions_committed: found ${newTestCount}, need >= ${acCount}` }
    }
    log(`[${taskId}] RED: ${newTestCount} new test functions confirmed (>= ${acCount} ACs)`)
  }

  // Structural assertion check — deterministic ast-grep scan, no LLM needed
  const sgPatterns: { pattern: string; name: string }[] = laneLanguage === 'swift'
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
        { pattern: 'throw new Error', name: 'throw placeholder' },
        { pattern: 'expect(true).toBe(false)', name: 'forced failure' },
      ]
    : [
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

Also check for pass-only test bodies. First write the pattern to a temp file (quoted heredoc delimiter means the shell does no interpretation — copy the line between the markers exactly as-is):
BODYPATFILE=$(mktemp)
cat > "$BODYPATFILE" <<'PATTERN_EOF'
${testFuncBodyRegex}
PATTERN_EOF
Then run:
${testFiles.map((f) =>
    `grep -A1 -f "$BODYPATFILE" "${wt}/${f}" 2>/dev/null | grep -B1 '^\\s*pass$' 2>/dev/null`
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
  await updateStage(issueId, 'red', red.commit_sha)

  const redOwnership = await verifyFileOwnership(taskId, wt, 'RED', testFiles, implFiles)
  if (!redOwnership.ok) {
    log(`[${taskId}] RED FILE OWNERSHIP VIOLATION: ${redOwnership.violations.join(', ')}`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: `file_ownership_violation: ${redOwnership.violations.join(', ')}` }
  }

  // ── Pre-reflect: verify new tests were actually written — deterministic count ──
  const rawCounts = await agent(
    `Count test functions in these files. First write the pattern to a temp file (quoted heredoc delimiter means the shell does no interpretation — copy the line between the markers exactly as-is):
GREPPATFILE=$(mktemp)
cat > "$GREPPATFILE" <<'PATTERN_EOF'
${testFuncGrepRegex}
PATTERN_EOF
Then run:
After-counts (current worktree):
${testFiles.map(f => `grep -c -E -f "$GREPPATFILE" "${wt}/${f}" 2>/dev/null || echo 0`).join('\n')}
Before-counts (parent commit — 0 for first commit):
${testFiles.map(f => `git -C "${wt}" rev-parse HEAD~1 >/dev/null 2>&1 && git -C "${wt}" show HEAD~1:"${f}" 2>/dev/null | grep -c -E -f "$GREPPATFILE" || echo 0`).join('\n')}
Output ONLY raw numbers, one per line: after-counts first, then before-counts. No other text.`,
    {
      label: `test-count:${taskId}`, phase: 'Act', model: model('fast'),
    },
  )

  let afterCount = 0
  let beforeCount = 0
  const numbers = String(rawCounts).replace(/[^0-9\n]/g, '').trim().split('\n').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
  if (numbers.length >= 2) {
    afterCount = numbers.slice(0, numbers.length / 2).reduce((a, b) => a + b, 0)
    beforeCount = numbers.slice(numbers.length / 2).reduce((a, b) => a + b, 0)
  }
  const newTestCount = afterCount - beforeCount
  if (newTestCount <= 0) {
    log(`[${taskId}] RED FAILED: no new test functions written (before=${beforeCount}, after=${afterCount})`)
    return { task_id: taskId, status: 'failed', stage: 'RED', error: 'no_new_tests_written: RED agent did not append any test functions' }
  }
  log(`[${taskId}] RED: ${newTestCount} new test functions verified (${beforeCount} → ${afterCount})`)

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
  const greenPacket: TaskPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, scopedLaneCfg, 'GREEN', greenExtras)
  const greenCtxCmd: string = laneCtxCmd(greenPacket, wt)

  const greenVars = {
    wt,
    greenCtxCmd,
    greenPacketStr: JSON.stringify(greenPacket),
    testCommand: scopedTestCmd,
    implFilesList: implFiles.join(' '),
    commitPrefix: greenPacket.commit_prefix,
  }

  let green: StageResult | null = await resilientAgent(
    greenPrompt(greenVars),
    { label: `green:${taskId}`, phase: 'Act', model: greenModel, schema: STAGE_RESULT_SCHEMA, worktree: wt },
  )

  if (green?.success) {
    log(`[${taskId}] GREEN wrote: ${(green.files_written || []).join(', ')}`)
  }

  if (!green || !green.success || !green.tests_pass) {
    log(`[${taskId}] GREEN attempt 1 failed (${greenModel}): ${green?.failure_reason || 'unknown'}, escalating to opus`)
    green = await resilientAgent(
      greenRetryPrompt({
        ...greenVars,
        failureReason: green?.failure_reason || 'unknown',
        greenRetryPacketStr: JSON.stringify({ ...greenPacket, retry_hint: green?.failure_reason }),
      }),
      { label: `green-retry:${taskId}`, phase: 'Act', model: model('deep'), schema: STAGE_RESULT_SCHEMA, worktree: wt },
    )
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
    const check = await verifyCommitIndependently(taskId, wt, implFiles, greenPacket.commit_prefix, 'GREEN')
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

  const greenOwnership = await verifyFileOwnership(taskId, wt, 'GREEN', implFiles, testFiles)
  if (!greenOwnership.ok) {
    log(`[${taskId}] GREEN FILE OWNERSHIP VIOLATION: ${greenOwnership.violations.join(', ')}`)
    return { task_id: taskId, status: 'failed', stage: 'GREEN', error: `file_ownership_violation: ${greenOwnership.violations.join(', ')}` }
  }
  log(`[${taskId}] GREEN verified — all tests pass (committed: ${green.commit_sha || 'n/a'})`)
  await updateStage(issueId, 'green', green.commit_sha)

  // ── Adversarial skeptic panel (independent evaluators — stay separate) ──
  const base: string = skepticBasePrompt({
    wt, implFiles: implFiles.join(', '), testFiles: testFiles.join(', '),
    testCommand: scopedTestCmd, acStr,
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
  const refResult = await runRefactor(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg)
  if (!refResult) {
    return { task_id: taskId, status: 'failed', stage: 'REFACTOR', error: 'refactor failed' }
  }

  log(`[${taskId}] === LANE COMPLETE ===`)
  await updateStage(issueId, 'done')
  await writeCompletion()
  return { task_id: taskId, status: 'completed', stage: 'REFACTOR' }
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

  const refactor: StageResult | null = await resilientAgent(
    refactorPrompt({
      wt,
      refactorCtxCmd,
      refactorPacketStr: JSON.stringify(refactorPacket),
      testCommand: cfg.testCommand,
      allFilesList: [...testFiles, ...implFiles].join(' '),
      commitPrefix: refactorPacket.commit_prefix,
    }),
    { label: `refactor:${taskId}`, phase: 'Act', model: model('balanced'), schema: STAGE_RESULT_SCHEMA, worktree: wt },
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

const { batchLaneIds, lanePlan, worktreePaths, cfg, priorFailures, priorCompleted, batchTag } = a
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
        const mergeOut = await resilientAgent(
          `Run these commands in order in "${wt}". If any command fails, stop and return its full output including stderr. Otherwise return ONLY the raw combined output, no explanation, no markdown fences.\n` +
            depBranches.map((b) => `git -C "${wt}" merge --no-edit "${b}"`).join('\n'),
          { label: `dep-merge:${taskId}`, model: 'haiku' },
        )
        if (mergeOut === null || /CONFLICT|Automatic merge failed|error:|fatal:/i.test(String(mergeOut))) {
          const err = `dep_merge_failed: could not merge [${depBranches.join(', ')}] into ${taskId} worktree — ${String(mergeOut).slice(0, 300)}`
          log(`[${taskId}] ${err}`)
          const failResult: LaneOutcome = { task_id: taskId, status: 'failed', stage: 'CRASH', error: err }
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
