// lane-steps.ts — the step lists behind every batched datum-cli call in the
// Act pipeline (#368 item C). Pure builders: the lane/setup/merge/go scripts
// hand these to batchCommandPrompt() and evaluate the results themselves.
// Keeping the lists here (not inline in the sandbox scripts) is what lets
// vitest assert their order, tolerance and contents directly.
// tested-by: skills/src/shared/lane-steps.test.ts

import type { BatchStep } from './batch'
import { verifyFileOwnership } from './utils'

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
  steps.push({ name: 'history', command: `git -C ${q(o.wt)} log --format="%H %s"`, tolerant: true })
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
}

export function postRedSteps(o: PostRedOpts): BatchStep[] {
  const steps: BatchStep[] = []
  if (o.acCount > 0) {
    steps.push({
      name: 'count-gate',
      command:
        `PATFILE=$(mktemp)\ncat > "$PATFILE" <<'PATTERN_EOF'\n${o.testFuncDiffRegex}\nPATTERN_EOF\n` +
        `bash scripts/test-count-gate --repo ${q(o.wt)} --files ${o.testFiles.map(q).join(' ')} --pattern-file "$PATFILE" --required ${o.acCount}`,
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
  steps.push({
    name: 'test-count-before',
    command: o.testFiles.map((f) =>
      `git -C ${q(o.wt)} rev-parse HEAD~1 >/dev/null 2>&1 && git -C ${q(o.wt)} show HEAD~1:${q(f)} 2>/dev/null | grep -c -E -f "$GREPPATFILE" || echo 0`,
    ).join('\n'),
    tolerant: true,
  })
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
  if (raw === null || raw === undefined) return { ok: true, violations: [] }
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

// ── Post-GREEN: ownership read (deterministic-checks mode) ──

export function postGreenSteps(o: { wt: string }): BatchStep[] {
  return [{ name: 'ownership', command: ownershipCommand(o.wt), tolerant: true }]
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
  steps.push({ name: 'lane-state-read', command: o.laneStateReadScript.trim(), tolerant: true })
  return steps
}

/**
 * Prompt for a dedicated read-only agent call that fetches the lane plan's
 * exact JSON content (#524 dogfooding).
 *
 * Previously actStartSteps() folded a `cat "$__plan"` step into the same
 * batched datum-cli call as bootstrap/branch/resolve/lane-state-read, so
 * the whole batch's combined stdout grew with the lane plan's size (one
 * entry per lane — tens of KB on a plan with several lanes). That pushed
 * the batch's own Bash-tool output past the harness's inline-output
 * truncation threshold, and the truncated agent had no way to relay
 * content it never received in its own context, exhausting its remaining
 * turns trying to recover instead of returning an answer.
 *
 * A single-file Read (this prompt, run through the `reader` agent type) is
 * not subject to the same combined-multi-step-output growth and gives the
 * read its own dedicated turn budget, independent of everything else in
 * the bootstrap batch. A large enough lane plan can still exceed the Read
 * tool's own line-count window though (code review, #524 follow-up) — the
 * prompt tells the agent explicitly to page through with `offset` rather
 * than silently fabricating a plausible-looking summary when it can't
 * reproduce the whole file in one read.
 */
export function readLanePlanPrompt(lanePlanPath: string): string {
  return `Read the file at "${lanePlanPath}" and return its exact JSON contents — unmodified, unsummarised, not merged or interpreted. If the file is too large to read in one call, use the Read tool's offset parameter to read the rest and concatenate the full content before answering — never answer with a partial or reconstructed/fabricated version of the file. Output raw JSON only, no markdown fences, no explanation.`
}
