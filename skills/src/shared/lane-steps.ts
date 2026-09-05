// lane-steps.ts — the step lists behind every batched datum-cli call in the
// Act pipeline (#368 item C). Pure builders: the lane/setup/merge/go scripts
// hand these to batchCommandPrompt() and evaluate the results themselves.
// Keeping the lists here (not inline in the sandbox scripts) is what lets
// vitest assert their order, tolerance and contents directly.
// tested-by: skills/src/shared/lane-steps.test.ts

import type { BatchStep, BatchResult } from './batch'
import { stepStdout } from './batch'
import { verifyFileOwnership, testRunCommand } from './utils'

const q = (s: string): string => `"${s.replace(/"/g, '\\"')}"`

/** The bash inside the first fenced block of a rendered prompt template. */
export function fencedScript(rendered: string): string {
  const m = rendered.match(/```[a-z]*\n([\s\S]*?)\n```/)
  if (!m) throw new Error('template has no fenced script block')
  return m[1]
}

/** `cat "<path>" 2>/dev/null || echo MISSING` — the file-or-MISSING idiom. */
function catOrMissing(path: string): string {
  return `cat ${q(path)} 2>/dev/null || echo MISSING`
}

/** True when a completion/skeleton read came back empty or MISSING. */
export function isMissing(raw: string | null | undefined): boolean {
  return !raw || raw.trim() === '' || raw.trim() === 'MISSING'
}

// ── Lane intake: cross-run completion, lane history, pre-RED cleanup, skeleton ──

export interface LaneIntakeOpts {
  wt: string
  /** Epic branch the lane was cut from — bounds the history read to the
   *  lane's own commits (`<epic>..HEAD`). An unbounded log was 90 KB in a
   *  real consumer repo; the relay agent truncated it to nothing and the
   *  runner missed the lane's existing RED/GREEN commits (#331). */
  epicBranch: string
  /** Include the cross-run completion read (deterministic-checks mode). */
  completionPath: string | null
  /** Structural lanes go straight to REFACTOR: no cleanup, no skeleton. */
  structural: boolean
  /** `datum lane-cleanup ...` or null when the lane has no JS/TS/Py test files. */
  cleanupCmd: string | null
  /** Plan-phase skeleton to prefer, or '' when the Plan phase produced none. */
  planSkeletonPath: string
  skeletonCmd: string
  /** Path (under wt) the skeleton command writes. */
  preflightPath: string
}

export function laneIntakeSteps(o: LaneIntakeOpts): BatchStep[] {
  const steps: BatchStep[] = []
  if (o.completionPath) steps.push({ name: 'completion', command: catOrMissing(o.completionPath), tolerant: true })
  steps.push({ name: 'history', command: `git -C ${q(o.wt)} log --format="%H %s" ${q(o.epicBranch)}..HEAD`, tolerant: true })
  if (o.structural) return steps
  if (o.cleanupCmd) steps.push({ name: 'cleanup', command: o.cleanupCmd, tolerant: true })
  if (o.planSkeletonPath) {
    steps.push({ name: 'skeleton-plan', command: catOrMissing(o.planSkeletonPath), tolerant: true })
  }
  // The skeleton command's --output is relative to the cwd (repo root) while the
  // RED prompt reads it from inside the worktree — try both before giving up.
  const gen = `${o.skeletonCmd}\ncat ${q(`${o.wt}/${o.preflightPath}`)} 2>/dev/null || cat ${q(o.preflightPath)} 2>/dev/null || echo "{}"`
  steps.push({
    name: 'skeleton-gen',
    command: o.planSkeletonPath
      ? `if [ -s ${q(o.planSkeletonPath)} ]; then echo SKIPPED_PLAN_SKELETON; else\n${gen}\nfi`
      : gen,
    tolerant: true,
  })
  return steps
}

// ── Post-RED checks: count gate, placeholder scan, ownership, scope read, test count ──

export interface PostRedOpts {
  wt: string
  testFiles: string[]
  acCount: number
  testFuncDiffRegex: string
  sgPatterns: { pattern: string; name: string }[]
  testFuncBodyRegex: string
  testFuncGrepRegex: string
  /** Include the `git diff --name-only` ownership read (deterministic-checks mode). */
  ownership: boolean
  /**
   * When given, independently re-run this exact test command against `wt`
   * (never trusting the RED agent's self-reported tests_pass/test_exit_code,
   * which comes from a run the agent itself performed and read the exit
   * status from). Null skips the step entirely.
   */
  verifyTestCmd: string | null
  /**
   * Ref the count gate diffs from (via merge-base with HEAD) — the epic
   * branch. Without it the gate diffed `HEAD~1 HEAD`, which on a lane resumed
   * with RED+GREEN already committed is GREEN's own diff: zero tests, bogus
   * `no_new_test_functions_committed` (#392). Null keeps the HEAD~1 diff.
   */
  baseRef: string | null
}

/**
 * Parse the LAST `TEST_EXIT=<n>` line out of a test-verify step's stdout —
 * the same idiom testRunCommand() prints. Returns null when no such line is
 * present (the step did not run, e.g. verifyTestCmd was null).
 */
export function testExitCode(stdout: string | null | undefined): number | null {
  if (!stdout) return null
  const matches = [...stdout.matchAll(/TEST_EXIT=(\d+)/g)]
  if (matches.length === 0) return null
  return Number(matches[matches.length - 1][1])
}

export function postRedSteps(o: PostRedOpts): BatchStep[] {
  const steps: BatchStep[] = []
  if (o.acCount > 0) {
    steps.push({
      name: 'count-gate',
      command:
        `PATFILE=$(mktemp)\ncat > "$PATFILE" <<'PATTERN_EOF'\n${o.testFuncDiffRegex}\nPATTERN_EOF\n` +
        // Through the installed `datum dev` wrapper (cli.py _DEV_BASH_SCRIPTS),
        // never a repo-relative `bash scripts/...`: consumer repos don't carry
        // datum's scripts/ dir, and `datum init --refresh` doesn't materialise it.
        `datum dev test-count-gate --repo ${q(o.wt)} --files ${o.testFiles.map(q).join(' ')} --pattern-file "$PATFILE" --required ${o.acCount}` +
        (o.baseRef ? ` --base ${q(o.baseRef)}` : ''),
      tolerant: true,
    })
  }
  steps.push({
    name: 'assert-check',
    command:
      o.testFiles.map((f) => o.sgPatterns.map((p) =>
        `ast-grep --pattern '${p.pattern}' ${q(`${o.wt}/${f}`)} 2>/dev/null || grep -n '${p.pattern}' ${q(`${o.wt}/${f}`)} 2>/dev/null`,
      ).join('\n')).join('\n') +
      `\nBODYPATFILE=$(mktemp)\ncat > "$BODYPATFILE" <<'PATTERN_EOF'\n${o.testFuncBodyRegex}\nPATTERN_EOF\n` +
      o.testFiles.map((f) =>
        `grep -A1 -f "$BODYPATFILE" ${q(`${o.wt}/${f}`)} 2>/dev/null | grep -B1 '^\\s*pass$' 2>/dev/null`,
      ).join('\n'),
    tolerant: true,
  })
  if (o.ownership) steps.push({ name: 'ownership', command: ownershipCommand(o.wt), tolerant: true })
  o.testFiles.forEach((f, i) => {
    steps.push({ name: `scope-read-${i}`, command: `cat ${q(`${o.wt}/${f}`)} 2>/dev/null`, tolerant: true })
  })
  steps.push({
    name: 'test-count-pattern',
    command: `GREPPATFILE=$(mktemp)\ncat > "$GREPPATFILE" <<'PATTERN_EOF'\n${o.testFuncGrepRegex}\nPATTERN_EOF\ncat "$GREPPATFILE"`,
    tolerant: true,
  })
  steps.push({
    name: 'test-count-after',
    command: o.testFiles.map((f) => `grep -c -E -f "$GREPPATFILE" ${q(`${o.wt}/${f}`)} 2>/dev/null || echo 0`).join('\n'),
    tolerant: true,
  })
  // "Before" is the lane's BASE (merge-base with the epic), not the previous
  // commit: a RED agent that commits twice (skeleton, then tests) made
  // HEAD~1 == HEAD's test count, newTestCount = 0, and the lane failed
  // no_new_tests_written while count-gate — which already diffs from the
  // merge-base — had passed (elonchesd run wf_1763c81d-94c). HEAD~1 stays
  // only for callers that pass no baseRef.
  const beforeRef = o.baseRef
    ? `$(git -C ${q(o.wt)} merge-base HEAD ${q(o.baseRef)})`
    : 'HEAD~1'
  steps.push({
    name: 'test-count-before',
    command: o.testFiles.map((f) =>
      `__before=${beforeRef}; git -C ${q(o.wt)} rev-parse "$__before" >/dev/null 2>&1 && git -C ${q(o.wt)} show "$__before":${q(f)} 2>/dev/null | grep -c -E -f "$GREPPATFILE" || echo 0`,
    ).join('\n'),
    tolerant: true,
  })
  if (o.verifyTestCmd) {
    steps.push({ name: 'test-verify', command: testRunCommand(o.verifyTestCmd, o.wt, 'red-verify'), tolerant: true })
  }
  return steps
}

/** The deterministic ownership read: files touched by the stage commit. */
export function ownershipCommand(wt: string): string {
  return `git -C ${q(wt)} diff --name-only HEAD~1 HEAD`
}

/**
 * Ownership decision from the `git diff --name-only HEAD~1 HEAD` step (#368
 * item D): evaluated here, never by an LLM. A step that did not run fails
 * open, exactly like the legacy agent returning null.
 */
export function ownershipFromStdout(
  raw: string | null | undefined,
  allowedFiles: string[],
  forbiddenFiles: string[],
): { ok: boolean; violations: string[] } {
  // A step that did not run is a failed check, not a clean one (fail closed —
  // the agent-based verifyFileOwnership in the lane runner does the same).
  if (raw === null || raw === undefined) {
    return { ok: false, violations: ['ownership_check_failed: ownership diff step did not run or returned no result'] }
  }
  const changed = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  return verifyFileOwnership(changed, allowedFiles, forbiddenFiles)
}

/** Sum every integer on its own line (grep -c output, `|| echo 0` fallbacks included). */
export function sumCounts(raw: string | null | undefined): number {
  if (!raw) return 0
  return raw.split('\n').map((l) => parseInt(l.trim(), 10)).filter((n) => !isNaN(n)).reduce((a, b) => a + b, 0)
}

/** Per-file test contents from the scope-read-<i> steps, keyed by path. */
export function scopeContentsFromSteps(testFiles: string[], stdoutOf: (name: string) => string | null): Record<string, string> {
  const out: Record<string, string> = {}
  testFiles.forEach((f, i) => {
    const s = stdoutOf(`scope-read-${i}`)
    if (s) out[f] = s
  })
  return out
}

// ── Scope-gap existence + contract preflight (one batch, both conditional) ──

export interface ScopeContractOpts {
  wt: string
  scopeGaps: string[]
  /** null when the lane is not a pytest lane (no contract preflight). */
  contractPreflight: { testFiles: string[]; implFiles: string[]; scopedTestCmd: string } | null
}

export function scopeContractSteps(o: ScopeContractOpts): BatchStep[] {
  const steps: BatchStep[] = []
  o.scopeGaps.forEach((f, i) => {
    steps.push({ name: `scope-exists-${i}`, command: `test -f ${q(`${o.wt}/${f}`)}`, tolerant: true })
  })
  if (o.contractPreflight) {
    const c = o.contractPreflight
    const gapLoop = o.scopeGaps.length > 0
      ? `for __f in ${o.scopeGaps.map(q).join(' ')}; do [ -f ${q(o.wt)}/"$__f" ] && __extra+=(--allowed "$__f"); done\n`
      : ''
    steps.push({
      name: 'contract-preflight',
      command:
        `__extra=()\n${gapLoop}` +
        `datum contract-preflight --repo ${q(o.wt)} --test-command ${JSON.stringify(c.scopedTestCmd)} ` +
        c.testFiles.map((f) => `--test-file ${q(f)}`).join(' ') +
        (c.implFiles.length > 0 ? ' ' + c.implFiles.map((f) => `--allowed ${q(f)}`).join(' ') : '') +
        ' "${__extra[@]}"',
      tolerant: true,
    })
  }
  return steps
}

/** Split scope gaps into existing/missing from the scope-exists-<i> exit codes. */
export function scopeGapsFromSteps(
  scopeGaps: string[],
  exitOf: (name: string) => number | null,
): { existing: string[]; missing: string[] } {
  const existing: string[] = []
  const missing: string[] = []
  scopeGaps.forEach((f, i) => {
    const code = exitOf(`scope-exists-${i}`)
    if (code === 0) existing.push(f)
    else missing.push(f)
  })
  return { existing, missing }
}

// ── Post-GREEN: ownership read (deterministic-checks mode) + optional independent test-verify ──

export interface PostGreenOpts {
  wt: string
  /**
   * When given, independently re-run this exact test command against `wt`
   * (never trusting the GREEN agent's self-reported tests_pass, which comes
   * from a run the agent itself performed and read the exit status from).
   * Null/omitted skips the step entirely. Mirrors PostRedOpts.verifyTestCmd.
   */
  verifyTestCmd?: string | null
}

export function postGreenSteps(o: PostGreenOpts): BatchStep[] {
  const steps: BatchStep[] = [{ name: 'ownership', command: ownershipCommand(o.wt), tolerant: true }]
  if (o.verifyTestCmd) {
    steps.push({ name: 'test-verify', command: testRunCommand(o.verifyTestCmd, o.wt, 'green-verify'), tolerant: true })
  }
  return steps
}

// ── Setup: root worktree + lane worktrees + plan distribution ──

export interface SetupStepsOpts {
  batchRunId: string
  epicBranch: string
  laneIds: string[]
  lanePlanPath: string
}

export function setupSteps(o: SetupStepsOpts): BatchStep[] {
  const rootDir = `.datum/worktrees/${o.batchRunId}-root`
  return [
    {
      name: 'root-wt',
      command:
        `git worktree add --detach ${q(rootDir)} ${q(o.epicBranch)} 2>&1 && ` +
        `__root=$(cd ${q(rootDir)} && pwd) && printf '{"root": "%s"}' "$__root"`,
    },
    {
      name: 'setup-wt',
      command:
        `__setup=$(cd "$__root" && datum worktrees setup --run-id ${q(o.batchRunId)} --epic-branch ${q(o.epicBranch)} --lane-ids ${o.laneIds.join(',')}) && ` +
        `printf '%s' "$__setup"`,
    },
    {
      name: 'distribute',
      command:
        `__targets=(--target "$__root/.datum")\n` +
        `while IFS= read -r __p; do [ -n "$__p" ] && __targets+=(--target "$__p/.datum"); done < <(printf '%s' "$__setup" | jq -r '.[] | select(type=="string" and startswith("/"))')\n` +
        `datum lane-plan-distribute "$__root/${o.lanePlanPath}" "\${__targets[@]}"`,
    },
  ]
}

// ── Merge: completion markers, squash merge, epic-scoped lane-state, cleanup ──

export interface MergeStepsOpts {
  batchRunId: string
  epicBranch: string
  /** Lanes reported completed by the lane workflow (get a completion marker). */
  completedIds: string[]
  /** GREEN/REFACTOR-complete lanes in topological order, or [] to skip the merge. */
  mergeOrder: string[]
  /** Rendered `datum lane-state write` script for the completed lanes, or null. */
  laneStateWriteScript: string | null
}

export function completionMarkerCommand(runId: string, taskId: string): string {
  const dir = `.datum/runs/${runId}/lane-state`
  return `mkdir -p ${q(dir)} && printf '%s\\n' '{"task_id": "${taskId}", "status": "completed"}' > ${q(`${dir}/${taskId}.json`)}`
}

export function mergeSteps(o: MergeStepsOpts): BatchStep[] {
  const steps: BatchStep[] = []
  if (o.completedIds.length > 0) {
    steps.push({
      name: 'completion-markers',
      command: o.completedIds.map((id) => completionMarkerCommand(o.batchRunId, id)).join('\n'),
      tolerant: true,
    })
  }
  if (o.mergeOrder.length > 0) {
    steps.push({
      name: 'merge',
      command:
        `datum worktrees merge --epic-branch ${q(o.epicBranch)} --lane-order ${o.mergeOrder.join(',')} ` +
        `--commit-message "act(${o.batchRunId}): merge ${o.mergeOrder.length} lanes"; __merge_rc=$?; [ "$__merge_rc" -eq 0 ]`,
      tolerant: true,
    })
  }
  if (o.laneStateWriteScript) {
    steps.push({
      name: 'lane-state-write',
      command: `if [ "\${__merge_rc:-0}" -ne 0 ]; then echo SKIPPED_MERGE_FAILED; else\n${o.laneStateWriteScript.trim()}\nfi`,
      tolerant: true,
    })
  }
  steps.push({
    name: 'cleanup',
    command: `datum worktrees cleanup --run-id ${q(o.batchRunId)} --epic-branch ${q(o.epicBranch)}`,
    tolerant: true,
  })
  return steps
}

// ── Act start: bootstrap/detect, timestamp, lane-plan resolve + read, lane-state read ──

export interface ActStartOpts {
  /** 'init' runs `datum init --json` (datum-go); 'detect' reads the current
   *  branch (datum-tdd-act yolo); a string is an epicBranch given in args. */
  branch: 'init' | 'detect' | string
  /** The CLI adopt/bootstrap command for 'init' (datum-go passes `datum init --json`). */
  initCmd?: string
  /** Lane-plan path given in args, or null to resolve final/default/none. */
  lanePlanPath: string | null
  /** Rendered `datum lane-state read` script, using $__eb and $__plan. */
  laneStateReadScript: string
}

export function actStartSteps(o: ActStartOpts): BatchStep[] {
  const steps: BatchStep[] = []
  if (o.branch === 'init') {
    steps.push({ name: 'bootstrap', command: `__boot=$(${o.initCmd || 'datum init --json'}) && printf '%s' "$__boot"` })
    steps.push({ name: 'branch', command: `__eb=$(printf '%s' "$__boot" | jq -r '.epicBranch // empty') && [ -n "$__eb" ] && printf '%s' "$__eb"` })
  } else if (o.branch === 'detect') {
    steps.push({ name: 'branch', command: `__eb=$(git rev-parse --abbrev-ref HEAD) && printf '%s' "$__eb"` })
  } else {
    steps.push({ name: 'branch', command: `__eb=${q(o.branch)} && printf '%s' "$__eb"` })
  }
  steps.push({ name: 'timestamp', command: 'date +%Y%m%d-%H%M%S' })
  if (o.lanePlanPath) {
    steps.push({ name: 'resolve', command: `__plan=${q(o.lanePlanPath)} && echo given` })
  } else {
    steps.push({
      name: 'resolve',
      command:
        `__epic="docs/epics/$__eb"\n` +
        `if [ -f "$__epic/lane-plan-final.json" ]; then __plan="$__epic/lane-plan-final.json"; echo final; ` +
        `elif [ -f "$__epic/lane-plan.json" ]; then __plan="$__epic/lane-plan.json"; echo default; ` +
        `else __plan=""; echo none; fi`,
      tolerant: true,
    })
  }
  // The plan itself is relayed byte-faithfully via the CHUNKED context relay
  // (shared/context-relay.ts contextChunkPlan/contextChunkSteps/contextAssembleChunks) —
  // never by an LLM echo (elonchesd run wf_6bfbd9f2-510: a datum-reader
  // agent silently normalised "§4" to "§ 4" inside 5 of 18 lanes'
  // acceptance_criteria, which changed laneSpecHash() for those lanes and
  // re-scheduled already-completed work; the shape check below passed
  // because the shape was intact — only bytes inside a field had moved).
  // These two steps give the caller the byte count and blob hash needed to
  // drive that chunked relay without a second probe batch, since this batch
  // already has $__plan resolved.
  steps.push({
    name: 'plan-bytes',
    command: `if [ -n "$__plan" ]; then wc -c < "$__plan" | tr -d ' '; else printf -- '-1'; fi`,
    tolerant: true,
  })
  steps.push({
    name: 'plan-sha',
    command: `if [ -n "$__plan" ]; then git hash-object "$__plan"; else printf ''; fi`,
    tolerant: true,
  })
  // A second, tiny, independent witness: sorted lane ids, topo length, total
  // — cheap enough to relay even by an LLM turn, so the script can also
  // sanity-check the chunked plan's shape against a completely separate read
  // path (verifyLanePlanShape stays as an extra guard, not the only one).
  steps.push({
    name: 'plan-shape',
    command: `[ -n "$__plan" ] && jq -c '{lanes: (.lanes|keys|sort), topo: (.topological_order|length), total: .total_lanes}' "$__plan" || echo '{}'`,
    tolerant: true,
  })
  steps.push({ name: 'lane-state-read', command: o.laneStateReadScript.trim(), tolerant: true })
  return steps
}

/**
 * Compare a relayed lane plan against the `plan-shape` step's jq output.
 * A reader agent that summarised, dropped or invented lanes is caught here
 * deterministically — never executed as a shorter plan.
 */
export function verifyLanePlanShape(
  plan: { lanes: Record<string, unknown>; topological_order: string[]; total_lanes: number },
  shapeStdout: string | null | undefined,
): { ok: boolean; reason: string } {
  let shape: { lanes?: string[]; topo?: number; total?: number } | null = null
  try {
    shape = shapeStdout && shapeStdout.trim() ? JSON.parse(shapeStdout.trim()) : null
  } catch {
    shape = null
  }
  if (!shape || !Array.isArray(shape.lanes)) {
    return { ok: false, reason: 'plan-shape step produced no JSON — the relayed lane plan cannot be verified' }
  }
  const got = Object.keys(plan.lanes || {}).sort()
  const want = [...shape.lanes].sort()
  const missing = want.filter((id) => !got.includes(id))
  const extra = got.filter((id) => !want.includes(id))
  if (missing.length || extra.length) {
    return {
      ok: false,
      reason: `relayed lane plan has ${got.length} lanes but the file has ${want.length}` +
        (missing.length ? `; missing: ${missing.join(', ')}` : '') +
        (extra.length ? `; not in file: ${extra.join(', ')}` : ''),
    }
  }
  if (typeof shape.topo === 'number' && (plan.topological_order || []).length !== shape.topo) {
    return { ok: false, reason: `relayed topological_order has ${(plan.topological_order || []).length} entries but the file has ${shape.topo}` }
  }
  if (typeof shape.total === 'number' && plan.total_lanes !== shape.total) {
    return { ok: false, reason: `relayed total_lanes is ${plan.total_lanes} but the file says ${shape.total}` }
  }
  return { ok: true, reason: '' }
}

// ── Closeout collect: branch/shas/config + the four collectors + data-exists ──

export interface CloseoutCollectOpts {
  /** Deterministic run id from datum-go/Act, or '' to generate one via
   *  `date +%Y%m%d-%H%M%S` (standalone `datum-closeout` runs). */
  runId: string
  /** Epic branch already resolved by the caller — skips the `git rev-parse`
   *  call. Omit/empty to derive it from HEAD. */
  branchHint?: string | null
}

/**
 * Batched, deterministic replacement for the LLM-relayed closeout collect
 * prompt (#368 follow-up). The old prompt handed an agent
 * `... 2>/dev/null || true` for every collector — every failure was
 * swallowed, the model decided what to report, and nothing in the run said
 * WHICH collector failed or why (eedom run wf_2a5ede48-358). Each collector
 * here is its own step so its exit code and stderr are individually visible
 * to the caller; none of them silence a non-zero exit.
 */
export function closeoutCollectSteps(o: CloseoutCollectOpts): BatchStep[] {
  return [
    {
      name: 'branch',
      command: o.branchHint ? `printf '%s' ${q(o.branchHint)}` : 'git rev-parse --abbrev-ref HEAD',
      tolerant: true,
    },
    {
      name: 'timestamp',
      command: o.runId
        ? `__rid=${q(o.runId)} && printf '%s' "$__rid"`
        : `__rid=$(date +%Y%m%d-%H%M%S) && printf '%s' "$__rid"`,
      tolerant: true,
    },
    { name: 'base-sha', command: `__base=$(git merge-base HEAD origin/main) && printf '%s' "$__base"`, tolerant: true },
    { name: 'merge-sha', command: `__merge=$(git rev-parse HEAD) && printf '%s' "$__merge"`, tolerant: true },
    { name: 'config', command: `cat .datum/config.json || echo '{}'`, tolerant: true },
    { name: 'mkdir', command: `mkdir -p ".datum/runs/$__rid"`, tolerant: true },
    {
      name: 'collect-git',
      command: `datum closeout-collect-git --run-id "$__rid" --base-sha "$__base" --merge-sha "$__merge"`,
      tolerant: true,
    },
    { name: 'collect-tasks', command: `datum closeout-collect-tasks --run-id "$__rid"`, tolerant: true },
    { name: 'collect-token-metrics', command: `datum closeout-collect-token-metrics --run-id "$__rid"`, tolerant: true },
    { name: 'collate', command: `datum closeout-collate --run-id "$__rid" --merge-sha "$__merge"`, tolerant: true },
    {
      name: 'data-exists',
      command: `test -s ".datum/runs/$__rid/closeout-data.json" && echo yes || echo no`,
      tolerant: true,
    },
  ]
}

// ── Closeout archive: tag, datum closeout-archive, move artifacts, commit ──

export interface CloseoutArchiveOpts {
  runId: string
  branch: string
  /** `docs/epics/<branch>` — where pipeline artifacts land after archiving. */
  epicDir: string
}

/** Root-checkout pipeline artifacts moved into the epic dir on closeout. */
const ARCHIVE_ROOT_FILES = ['SPEC.md', 'TASKS.md', 'QUESTIONS.md', 'PROPERTIES.md', 'TICKET.md', 'tasks.json']

function moveStepName(fileName: string): string {
  return `move-${fileName.toLowerCase().replace(/\./g, '-')}`
}

/** `if [ -f <src> ]; then mkdir -p <epicDir> && git mv <src> <epicDir>/<base>; else echo ABSENT; fi` */
function moveIntoEpicDirCommand(src: string, epicDir: string, base: string): string {
  return `if [ -f ${q(src)} ]; then mkdir -p ${q(epicDir)} && git mv ${q(src)} ${q(`${epicDir}/${base}`)}; else echo ABSENT; fi`
}

/**
 * Batched, deterministic replacement for the shell block the old flow
 * appended to the SYNTHESIZE agent's own prompt (#368 follow-up). That block
 * had two problems: `2>/dev/null || true` on the tag/archive commands
 * swallowed failures invisibly (no repo rule permits silent fallbacks), and
 * A wildcard git-add-everything commit ran in the ROOT checkout — which can carry the
 * operator's unrelated work in progress, so that risked committing it
 * (policy: root-checkout commits stage only their own paths — see
 * shared/agents.ts commitStage `scope: 'allowed-only'`, commit 3bb2211).
 *
 * Every artifact move is staged individually via `git mv` (never a wildcard add),
 * and the final commit is gated on `git diff --cached --quiet` — it commits
 * exactly what the moves above staged, nothing else, and no-ops cleanly when
 * every artifact was already absent.
 */
export function closeoutArchiveSteps(o: CloseoutArchiveOpts): BatchStep[] {
  const steps: BatchStep[] = [
    { name: 'tag', command: `git tag ${q(`epic/${o.branch}/${o.runId}`)} HEAD`, tolerant: true },
    { name: 'archive', command: `datum closeout-archive --run-id ${q(o.runId)}`, tolerant: true },
  ]
  for (const f of ARCHIVE_ROOT_FILES) {
    steps.push({ name: moveStepName(f), command: moveIntoEpicDirCommand(f, o.epicDir, f), tolerant: true })
  }
  steps.push({
    name: 'move-lane-plan-json',
    command: moveIntoEpicDirCommand('.datum/lane-plan.json', o.epicDir, 'lane-plan.json'),
    tolerant: true,
  })
  steps.push({
    name: 'commit',
    command: `git diff --cached --quiet || git commit -m ${q(`closeout(${o.runId}): archive pipeline artifacts to ${o.epicDir}`)}`,
    tolerant: true,
  })
  steps.push({ name: 'commit-sha', command: 'git rev-parse --short HEAD', tolerant: true })
  return steps
}

