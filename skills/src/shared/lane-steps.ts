// lane-steps.ts — the step lists behind every batched datum-cli call in the
// Act pipeline (#368 item C). Pure builders: the lane/setup/merge/go scripts
// hand these to batchCommandPrompt() and evaluate the results themselves.
// Keeping the lists here (not inline in the sandbox scripts) is what lets
// vitest assert their order, tolerance and contents directly.
// tested-by: skills/src/shared/lane-steps.test.ts

import type { BatchStep, BatchResult } from './batch'
import { stepStdout, stepResult, describeFailure } from './batch'
import { verifyFileOwnership, testRunCommand, parseAgentJson } from './utils'
import type { ContextFile } from './context-relay'
import { utf8ByteLength, utf8Encode } from './utf8'
import { gitBlobSha } from './sha1'
import type { Lane, LanePlanDigest } from './types'

const q = (s: string): string => `"${s.replace(/"/g, '\\"')}"`
/** Escape a literal for grep -E (the pattern strings are literals, not regexes). */
const ereEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
  /**
   * When given, independently re-run this exact test command against `wt` —
   * used ONLY by the "resume at REFACTOR" shortcut (#331): a lane whose
   * branch already carries RED+GREEN stage-complete commits must not be
   * assumed green on the strength of those commit messages alone (a GREEN
   * retry that itself failed independent verify still leaves a
   * `green(...): GREEN complete` commit behind). Appended as the LAST step
   * regardless of `structural`, so callers that only want history + this
   * check can pass `structural: true` and skip cleanup/skeleton entirely.
   * Null/omitted skips the step (unchanged behavior).
   */
  verifyTestCmd?: string | null
  /**
   * Export this lane's full spec (acceptance criteria included) from the
   * worktree copy of the plan to `outPath` as the FIRST step — the scheduler
   * only holds the digest, and no LLM turn relays the criteria. Evaluated by
   * laneSpecFromSteps. Null/omitted skips it.
   */
  laneSpec?: LaneSpecExportOpts | null
}

export interface LaneSpecExportOpts {
  planPath: string
  taskId: string
  outPath: string
  /** The digest's spec_hash; the CLI refuses (exit 1) if the plan lane hashes differently. */
  expectHash: string
}

export function laneIntakeSteps(o: LaneIntakeOpts): BatchStep[] {
  const steps: BatchStep[] = []
  if (o.laneSpec) {
    steps.push({ name: 'lane-spec', command: laneSpecExportCommand(o.laneSpec), tolerant: true })
    // The summary line is still an LLM echo: re-measure the written file in
    // bash so a rewritten bytes/sha cannot pass as the witness reference.
    steps.push({ name: 'lane-spec-bytes', command: `wc -c < ${q(o.laneSpec.outPath)} | tr -d ' '`, tolerant: true })
    steps.push({ name: 'lane-spec-sha', command: `git hash-object ${q(o.laneSpec.outPath)}`, tolerant: true })
  }
  if (o.completionPath) steps.push({ name: 'completion', command: catOrMissing(o.completionPath), tolerant: true })
  // Subject plus the Datum-Spec trailer (tab-separated): the resume check
  // compares the spec a RED was committed under with the current one (BUG M).
  steps.push({ name: 'history', command: `git -C ${q(o.wt)} log --format="%H %s%x09%(trailers:key=Datum-Spec,valueonly,separator=%x2C)" ${q(o.epicBranch)}..HEAD`, tolerant: true })
  if (!o.structural) {
    if (o.cleanupCmd) steps.push({ name: 'cleanup', command: o.cleanupCmd, tolerant: true })
    if (o.planSkeletonPath) {
      // Projected, never the whole file: the runner reads framework,
      // target_context and output paths. A preflight carrying a 38 KB
      // existing_api dump spilled the intake result past the harness cap
      // and the runner replied empty (integration-lanes-2 task-002).
      steps.push({
        name: 'skeleton-plan',
        command: `jq -c '{framework, target_context, outputs: [(.outputs // [])[] | {path}]}' ${q(o.planSkeletonPath)} 2>/dev/null || echo MISSING`,
        tolerant: true,
      })
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
  }
  if (o.verifyTestCmd) {
    steps.push({ name: 'test-verify', command: testRunCommand(o.verifyTestCmd, o.wt, 'intake-verify'), tolerant: true })
  }
  return steps
}

// ── Post-RED checks: count gate, placeholder scan, ownership, scope read, test count ──

export interface PostRedOpts {
  wt: string
  testFiles: string[]
  acCount: number
  testFuncDiffRegex: string
  /**
   * Placeholder shapes. `pattern` is the ast-grep pattern (a statement, e.g.
   * the skeleton's literal `throw new Error('RED agent: implement this assertion')`);
   * `grep` is the ERE the fallback uses when ast-grep is absent, matched from a
   * statement start. Without `grep`, the pattern text itself is escaped and
   * used — right for token-shaped patterns (`assert True`), wrong for shapes.
   */
  sgPatterns: { pattern: string; name: string; grep?: string }[]
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
/**
 * A verify run whose failure is the ENVIRONMENT, not the suite: the runner
 * or interpreter is missing (a lane worktree with no dependencies — elonchesd
 * wf_eb0f9f9b-7b1). Returns the offending line, or null for a real red/green.
 */
export function testEnvMissing(stdout: string | null | undefined): string | null {
  if (!stdout) return null
  const re = /command not found|node_modules missing|did you mean to install|No module named ['"]?pytest|Cannot find module ['"]vitest|vitest: not found|not recognized as an internal or external command/i
  const line = stdout.split('\n').map((l) => l.trim()).find((l) => re.test(l))
  return line ? line.replace(/^\s*ERR_PNPM\S*\s*/, '') : null
}

/**
 * The verdict of an independent test-verify batch, in three NAMED states.
 * `failed` always carries a non-zero exit code; a batch that returned
 * nothing, or whose test-verify step did not run, is `unavailable` with the
 * batch's own reason — never a claim that the suite was red (elonchesd
 * wf_dee84cc2-e64: exit=null reported as green_verify_failed, triaged as
 * "GREEN lied", while the committed GREEN passed 434/434).
 */
export type VerifyVerdict =
  | { kind: 'passed'; exit: 0; why: '' }
  | { kind: 'failed'; exit: number; why: '' }
  | { kind: 'unavailable'; exit: null; why: string }

export function verifyVerdict(result: BatchResult, label: string): VerifyVerdict {
  const exit = testExitCode(stepStdout(result, 'test-verify'))
  if (exit === null) {
    const why = result.missing
      ? describeFailure(result, label)
      : stepResult(result, 'test-verify')
        ? `${label}: test-verify step ran but printed no TEST_EXIT line`
        : `${label}: test-verify step did not run (${result.failed ? `stopped at "${result.failed.name}"` : 'not in the batch result'})`
    return { kind: 'unavailable', exit: null, why }
  }
  if (exit === 0) return { kind: 'passed', exit: 0, why: '' }
  return { kind: 'failed', exit, why: '' }
}

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
  // The scan runs on a FILTERED copy of each owned test file, never the file
  // itself: only the lines the lane added since its base survive (line
  // numbers preserved, everything else blanked), and the inside of a
  // multi-line string (""" / ''' / `) is blanked too. caliper eedom
  // wf_0837ad8b-e5f task-005: `raise NotImplementedError` inside a
  // textwrap.dedent("""...""") of Python source a pre-existing test feeds to
  // the indexer, on a line the RED commit never touched, halted the lane as
  // placeholder_assertions. Without a base (or when merge-base fails) the
  // whole file is scanned, still outside strings.
  const baseLine = o.baseRef
    ? `__base=$(git -C ${q(o.wt)} merge-base HEAD ${q(o.baseRef)} 2>/dev/null)`
    : '__base=""'
  const filterLines = (f: string, i: number): string => [
    `__d${i}=$(mktemp -d); __t="$__d${i}/${f.split('/').pop()}"`,
    `if [ -n "$__base" ]; then __added=$(git -C ${q(o.wt)} diff --unified=0 "$__base" HEAD -- ${q(f)} 2>/dev/null | awk '/^@@/{split($3,p,","); s=substr(p[1],2)+0; n=(p[2]==""?1:p[2]+0); for(i=0;i<n;i++) printf "%d ", s+i}'); else __added=ALL; fi`,
    `awk -v added="$__added" -v sq="'" 'BEGIN{all=(added=="ALL"); n=split(added,a," "); for(i=1;i<=n;i++) keep[a[i]]=1; re="\\"\\"\\"|" sq sq sq "|\`"} { s=$0; c=gsub(re,"",s); if (instr || !(all || keep[NR])) print ""; else print $0; if (c%2==1) instr=!instr }' ${q(`${o.wt}/${f}`)} > "$__t"`,
  ].join('\n')
  steps.push({
    name: 'assert-check',
    command:
      baseLine + '\n' +
      o.testFiles.map((f, i) => filterLines(f, i) + '\n' + o.sgPatterns.map((p) =>
        // The grep fallback (no ast-grep, or ast-grep errored) is anchored to
        // a statement start: an unanchored grep matched `assert True` inside a
        // quoted fixture string of a test-detection test and failed a sound
        // RED as placeholder_assertions (caliper wf_181691ac-fbf, BUG I).
        // Hits are reported against the original path. ast-grep exits 1 for
        // "no match" AND for every error, so `ast-grep || grep` fell back on
        // every clean file and its parse-aware verdict was never trusted
        // (caliper: the eedom halt was grep output with ast-grep installed).
        // Trusted when present and silent on stderr; grep only otherwise.
        `__sg=1; if command -v ast-grep >/dev/null 2>&1; then ast-grep --pattern '${p.pattern}' "$__t" > "$__d${i}/out" 2> "$__d${i}/err"; [ -s "$__d${i}/err" ] || __sg=0; fi\n` +
        `if [ "$__sg" -eq 0 ]; then sed "s#^$__t#${f}#" "$__d${i}/out"; else grep -nE '^[[:space:]]*${p.grep ?? ereEscape(p.pattern)}' "$__t" 2>/dev/null | sed "s#^#${f}:#"; fi`,
      ).join('\n')).join('\n') +
      `\nBODYPATFILE=$(mktemp)\ncat > "$BODYPATFILE" <<'PATTERN_EOF'\n${o.testFuncBodyRegex}\nPATTERN_EOF\n` +
      o.testFiles.map((f, i) =>
        `grep -A1 -f "$BODYPATFILE" "$__d${i}/${f.split('/').pop()}" 2>/dev/null | grep -B1 '^\\s*pass$' 2>/dev/null`,
      ).join('\n'),
    tolerant: true,
  })
  // RED's start is the lane's start: the merge-base with the epic branch.
  const redSince = o.baseRef ? laneStartExpr(o.wt, o.baseRef) : null
  if (o.ownership) steps.push({ name: 'ownership', command: ownershipCommand(o.wt, redSince), tolerant: true })
  // Capped: one batch is one tool result and the harness spills results over
  // ~25 KB to a file the runner cannot echo (caliper BUG N — a 300-line test
  // file made the whole post-RED batch unreadable and the count gate looked
  // like it never ran). The size step lets the script name a truncation.
  const cap = scopeReadCap(o.testFiles.length)
  o.testFiles.forEach((f, i) => {
    steps.push({ name: `scope-size-${i}`, command: `wc -c < ${q(`${o.wt}/${f}`)} 2>/dev/null | tr -d ' '`, tolerant: true })
    steps.push({ name: `scope-read-${i}`, command: `head -c ${cap} ${q(`${o.wt}/${f}`)} 2>/dev/null`, tolerant: true })
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

/** One row of `datum code-tells`: a machine-written tell on a line the lane added. */
export interface TellFinding { file: string; line: number; tag: string; text: string }

/**
 * The deterministic tell scan (unslop-code): `datum code-tells` over the
 * lane's files, added lines since the base only. Advisory, never a halt —
 * hits decide that REFACTOR runs and are handed to it by name.
 */
export function codeTellSteps(o: { wt: string; files: string[]; baseRef: string | null }): BatchStep[] {
  const base = o.baseRef ? ` --base ${q(o.baseRef)}` : ''
  return [{ name: 'tell-scan', command: `datum code-tells --repo ${q(o.wt)}${base} --files ${o.files.map(q).join(' ')}`, tolerant: true }]
}

export function parseTellScan(stdout: string | null | undefined): TellFinding[] {
  const out: TellFinding[] = []
  for (const row of (stdout || '').split('\n')) {
    const m = /^([^:]+):(\d+):([a-z_]+):(.*)$/.exec(row)
    if (m) out.push({ file: m[1], line: Number(m[2]), tag: m[3], text: m[4] })
  }
  return out
}

/**
 * The deterministic ownership read: files the stage touched, from `since`
 * (the stage's real start) to HEAD. HEAD~1 only when no start is known: a
 * stage is not always one commit (a RED that commits twice, a GREEN that
 * commits nothing and was judged on RED's diff).
 */
export function ownershipCommand(wt: string, since?: string | null): string {
  return `git -C ${q(wt)} diff --name-only ${since || 'HEAD~1'} HEAD`
}

/**
 * Legacy-mode ownership check (hooks not installed / agent_types off): the
 * same single tolerant diff step the deterministic post-RED/post-GREEN
 * batches carry, so both modes read the same command and evaluate it with
 * ownershipFromStdout. It used to be a runner told to run the diff and
 * RETURN {"files_changed": [...]} — a typed-back list that could drop a path.
 */
export function ownershipCheckSteps(wt: string, since?: string | null): BatchStep[] {
  return [{ name: 'ownership', command: ownershipCommand(wt, since), tolerant: true }]
}

/** Shell expression for a lane's start: its merge-base with the epic branch. */
export function laneStartExpr(wt: string, epicBranch: string): string {
  return `"$(git -C ${q(wt)} merge-base HEAD ${q(epicBranch)})"`
}

// ── Closeout housekeep: delete merged lane branches + pipeline-state ──
//
// Was a runner told to "Run: datum housekeep-epic <branch>" with its reply
// discarded — a failed or skipped housekeep left stale lane branches and
// pipeline-state behind with nothing in the transcript. Non-fatal, never
// silent.

export function housekeepSteps(epicBranch: string): BatchStep[] {
  return [{ name: 'housekeep', command: `datum housekeep-epic ${q(epicBranch)}`, tolerant: true }]
}

export function housekeepFromSteps(result: BatchResult): { ok: boolean; summary: string; error: string } {
  if (result.missing) return { ok: false, summary: '', error: `housekeep_failed: ${describeFailure(result, 'housekeep')}` }
  const step = stepResult(result, 'housekeep')
  if (!step) return { ok: false, summary: '', error: 'housekeep_failed: housekeep step did not run' }
  if (step.exit_code !== 0) {
    const tail = (step.stderr || step.stdout || '').trim().split('\n').slice(-3).join(' | ')
    return { ok: false, summary: '', error: `housekeep_failed: datum housekeep-epic exited ${step.exit_code} — ${tail}` }
  }
  return { ok: true, summary: (step.stdout || '').trim(), error: '' }
}

// ── In-batch dependency merge (#296) ──
//
// A lane whose dep ran in the same batch merges the dep's lane branch into
// its own worktree before RED. This was a runner told to run `git merge` per
// branch and echo the output, judged by a regex for CONFLICT — a runner that
// answered "done" after a conflict left the worktree mid-merge and RED ran
// on it. Non-tolerant steps: the exit code is the verdict, and a failed merge
// is aborted inside the same step so the worktree is never left mid-merge.

export function depMergeSteps(wt: string, branches: string[]): BatchStep[] {
  return branches.map((b, i) => ({
    name: `merge-${i}`,
    command: `git -C ${q(wt)} merge --no-edit ${q(b)} || { git -C ${q(wt)} merge --abort >/dev/null 2>&1; false; }`,
  }))
}

export function depMergeFromSteps(result: BatchResult, branches: string[]): { ok: boolean; error: string } {
  if (result.missing) {
    return { ok: false, error: `dep_merge_failed: could not merge [${branches.join(', ')}] — ${describeFailure(result, 'merge-0')}` }
  }
  for (let i = 0; i < branches.length; i++) {
    const step = stepResult(result, `merge-${i}`)
    if (!step) {
      return { ok: false, error: `dep_merge_failed: could not merge ${branches[i]} — merge step did not run` }
    }
    if (step.exit_code !== 0) {
      const tail = (step.stderr || step.stdout || '').trim().split('\n').slice(-3).join(' | ')
      return { ok: false, error: `dep_merge_failed: could not merge ${branches[i]} (exit ${step.exit_code}, merge aborted) — ${tail}` }
    }
  }
  return { ok: true, error: '' }
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
/**
 * The post-RED "new tests were written" gate. Both count steps must be
 * present in the batch result: a dropped `test-count-before` used to sum to
 * 0 and the gate passed on a baseline that never ran (review sweep).
 */
export function newTestCountFromSteps(
  result: BatchResult,
): { ok: boolean; before: number; after: number; added: number; error: string } {
  const none = { ok: false, before: 0, after: 0, added: 0 }
  if (result.missing) return { ...none, error: `test_count_missing: ${describeFailure(result, 'post-red batch')}` }
  for (const name of ['test-count-before', 'test-count-after']) {
    if (!stepResult(result, name)) return { ...none, error: `test_count_missing: ${name} step absent from the post-red batch result — cannot tell whether RED wrote any tests` }
  }
  const before = sumCounts(stepStdout(result, 'test-count-before'))
  const after = sumCounts(stepStdout(result, 'test-count-after'))
  return { ok: true, before, after, added: after - before, error: '' }
}

export function sumCounts(raw: string | null | undefined): number {
  if (!raw) return 0
  return raw.split('\n').map((l) => parseInt(l.trim(), 10)).filter((n) => !isNaN(n)).reduce((a, b) => a + b, 0)
}

/** Per-file test contents from the scope-read-<i> steps, keyed by path. */
/** Total bytes the post-RED scope reads may add to the batch stdout. */
export const SCOPE_READ_BUDGET_BYTES = 16 * 1024

/** Per-file read cap: the budget split across the lane's test files, 2 KB floor. */
export function scopeReadCap(fileCount: number): number {
  return Math.max(2048, Math.floor(SCOPE_READ_BUDGET_BYTES / Math.max(1, fileCount)))
}

/** Files whose on-disk size exceeded the read cap (the read was truncated). */
export function scopeReadTruncations(
  testFiles: string[],
  stdoutOf: (name: string) => string | null,
  cap: number,
): { file: string; bytes: number; cap: number }[] {
  const out: { file: string; bytes: number; cap: number }[] = []
  testFiles.forEach((f, i) => {
    const bytes = parseInt((stdoutOf(`scope-size-${i}`) || '').trim(), 10)
    if (Number.isFinite(bytes) && bytes > cap) out.push({ file: f, bytes, cap })
  })
  return out
}

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
  /**
   * The RED commit. When given, the batch also lists the files that commit
   * wrote (`red-files`), so green_edited_tests means "GREEN modified a file
   * RED committed" — not "GREEN touched anything classified as a test"
   * (caliper BUG P: a doc and a deliverable fixture failed a sound GREEN).
   */
  redSha?: string | null
}

export function postGreenSteps(o: PostGreenOpts): BatchStep[] {
  const steps: BatchStep[] = [{ name: 'ownership', command: ownershipCommand(o.wt, o.redSha), tolerant: true }]
  if (o.redSha) {
    steps.push({ name: 'red-files', command: `git -C ${q(o.wt)} diff-tree --no-commit-id --name-only -r ${q(o.redSha)}`, tolerant: true })
  }
  if (o.verifyTestCmd) {
    // Strays first: the verify must run against the committed tree, never
    // against scratch files an agent left behind (see strayCleanSteps).
    steps.push(...strayCleanSteps(o.wt))
    steps.push({ name: 'test-verify', command: testRunCommand(o.verifyTestCmd, o.wt, 'green-verify'), tolerant: true })
  }
  return steps
}

// ── Strays: untracked files between stages ──────────────────────────────────
// Every stage commits its work, so anything untracked in the lane worktree
// between stages is scratch an agent left behind. caliper eedom
// wf_fa38ac24-890 task-005: four repro test files written while a skeptic
// reproduced its findings were collected by REFACTOR's pytest run; two
// monkeypatched os.chdir, a later test failed deterministically, and REFACTOR
// reported "blocked" on a pristine GREEN commit. Strays are listed by name,
// removed, and the removal confirmed, so the caller can name them.

// .datum/ and .temp/ are the sanctioned scratch locations and never
// collected by a test runner; the lane's own spec lives at
// <wt>/.datum/lane-spec.json, untracked wherever .datum is not ignored.
export const STRAY_KEEP_DIRS = ['.datum', '.temp']

export function strayCleanSteps(wt: string): BatchStep[] {
  const keepFilter = STRAY_KEEP_DIRS.map((d) => `-e '^${d.replace('.', '\\.')}/'`).join(' ')
  const keepExcludes = STRAY_KEEP_DIRS.map((d) => `-e ${d}`).join(' ')
  const list = `git -C ${q(wt)} status --porcelain --untracked-files=all 2>/dev/null | sed -n 's/^?? //p' | grep -v ${keepFilter}`
  return [
    { name: 'stray-list', command: list, tolerant: true },
    { name: 'stray-clean', command: `git -C ${q(wt)} clean -fdq ${keepExcludes} 2>&1`, tolerant: true },
    { name: 'stray-confirm', command: list, tolerant: true },
  ]
}

export interface StrayOutcome {
  /** Untracked paths found before the clean, sorted. */
  strays: string[]
  /** true when the confirm step ran and found nothing; false when strays
   *  survived the clean; null when the steps did not run (a named absence). */
  cleaned: boolean | null
}

export function strayFilesFromSteps(result: BatchResult): StrayOutcome {
  const listed = stepStdout(result, 'stray-list')
  const confirm = stepStdout(result, 'stray-confirm')
  if (listed === null || confirm === null) return { strays: [], cleaned: null }
  const strays = listed.split('\n').map((l) => l.trim()).filter(Boolean).sort()
  return { strays, cleaned: confirm.trim() === '' }
}

/** The RED commit's file list from the red-files step, or null when the step did not run. */
export function redCommittedFilesFromSteps(r: BatchResult): string[] | null {
  const rec = stepResult(r, 'red-files')
  if (!rec || rec.exit_code !== 0) return null
  return rec.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
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
        // Idempotent: remove a root worktree left by a prior partial setup of this batch.
        `if [ -e ${q(rootDir)} ]; then git worktree remove --force ${q(rootDir)} 2>&1 || rm -rf ${q(rootDir)}; fi && git worktree prune && ` +
        `git worktree add --detach ${q(rootDir)} ${q(o.epicBranch)} 2>&1 && ` +
        `__root=$(cd ${q(rootDir)} && pwd) && ` +
        // Hooks off for this scratch worktree only (per-worktree config; the
        // developer's global post-checkout hook rebuilt a graph inside it).
        `git config extensions.worktreeConfig true && git -C "$__root" config --worktree core.hooksPath /dev/null && ` +
        `printf '{"root": "%s"}' "$__root"`,
    },
    {
      name: 'setup-wt',
      // Captured unconditionally: `$(...) && printf` lost the CLI's JSON
      // error on exit 1 (the printf never ran) and the workflow died with
      // "CLI output was not JSON — " and nothing after it (caliper BUG O).
      command:
        `__setup=$(cd "$__root" && datum worktrees setup --run-id ${q(o.batchRunId)} --epic-branch ${q(o.epicBranch)} --lane-ids ${o.laneIds.join(',')}); __setup_rc=$?; ` +
        `printf '%s' "$__setup"; [ "$__setup_rc" -eq 0 ]`,
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

export interface SetupWorktreesSummary {
  /** lane id → absolute worktree path, only the well-formed entries. */
  paths: Record<string, string>
  /** Entries the CLI returned that are not absolute paths (logged, never used). */
  dropped: { laneId: string; value: unknown }[]
  /** `setup_worktrees_failed: <CLI error verbatim>` or null when setup ran clean. */
  error: string | null
}

/**
 * The lane worktree map from the setup-wt step. The CLI prints
 * `{"error": "..."}` with exit 1 for every setup failure (a locked stale
 * worktree, a missing epic branch); that message is the diagnosis and is
 * surfaced verbatim — before this, the step's `&&` shape dropped it and the
 * workflow died with "CLI output was not JSON — " (caliper BUG O).
 */
export function laneWorktreePathsFromSteps(r: BatchResult): SetupWorktreesSummary {
  const text = stepStdout(r, 'setup-wt')
  const rec = stepResult(r, 'setup-wt')
  const parsed = text ? parseAgentJson(text, null) as Record<string, unknown> | null : null
  if (!parsed || typeof parsed !== 'object') {
    // `text || ...`, not `??`: an empty stdout is '' and the old `??` kept
    // it, which is why the error read "CLI output was not JSON — " (nothing).
    return { paths: {}, dropped: [], error: `setup_worktrees_failed: CLI output was not JSON — ${String(text || describeFailure(r, 'setup')).slice(0, 300)}` }
  }
  if (typeof parsed.error === 'string') return { paths: {}, dropped: [], error: `setup_worktrees_failed: ${parsed.error}` }
  if (rec && rec.exit_code !== 0) return { paths: {}, dropped: [], error: `setup_worktrees_failed: ${describeFailure(r, 'setup')}` }
  const paths: Record<string, string> = {}
  const dropped: { laneId: string; value: unknown }[] = []
  for (const [laneId, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value.startsWith('/')) paths[laneId] = value
    else dropped.push({ laneId, value })
  }
  return { paths, dropped, error: null }
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

const PLAIN_ID_RE = /^[A-Za-z0-9._-]+$/

export function completionMarkerCommand(runId: string, taskId: string): string {
  // Both ids are interpolated inside a single-quoted printf argument; a
  // quote in either would break out of it (review finding). Task ids are
  // schema-constrained upstream (task-NNN) — refuse anything else here too.
  if (!PLAIN_ID_RE.test(runId)) throw new Error(`completionMarkerCommand: run id must be a plain identifier, got ${JSON.stringify(runId)}`)
  if (!PLAIN_ID_RE.test(taskId)) throw new Error(`completionMarkerCommand: task id must be a plain identifier, got ${JSON.stringify(taskId)}`)
  const dir = `.datum/runs/${runId}/lane-state`
  return `mkdir -p ${q(dir)} && printf '%s\\n' '{"task_id": "${taskId}", "status": "completed"}' > ${q(`${dir}/${taskId}.json`)}`
}

export function mergeSteps(o: MergeStepsOpts): BatchStep[] {
  const steps: BatchStep[] = []
  if (o.mergeOrder.length > 0) {
    // The CLI prints {sha, merged, already_merged[, failed_lane, error]} on
    // both success and a partial failure (exit 1); the JSON is captured so
    // the lane-state step below can record exactly the lanes that landed.
    steps.push({
      name: 'merge',
      command:
        `__merge_out=$(datum worktrees merge --epic-branch ${q(o.epicBranch)} --lane-order ${o.mergeOrder.join(',')} ` +
        `--commit-message "act(${o.batchRunId}): merge ${o.mergeOrder.length} lanes" --run-id ${q(o.batchRunId)}); __merge_rc=$?; printf '%s\\n' "$__merge_out"; [ "$__merge_rc" -eq 0 ]`,
      tolerant: true,
    })
  }
  if (o.completedIds.length > 0) {
    // AFTER the merge, and only for lanes the merge JSON says are on the epic
    // branch: a marker written before/regardless of the merge made the next
    // run skip a lane whose squash had failed (phase review wf_9a69f891-462).
    steps.push({
      name: 'completion-markers',
      command:
        `__landed_ids=" $(printf '%s' "\${__merge_out:-}" | jq -r '(.merged[]?, .already_merged[]?)' 2>/dev/null | tr '\\n' ' ')"\n` +
        o.completedIds.map((id) => `case "$__landed_ids" in *" ${id} "*) ${completionMarkerCommand(o.batchRunId, id)};; *) echo "SKIPPED_NOT_MERGED ${id}";; esac`).join('\n'),
      tolerant: true,
    })
  }
  if (o.laneStateWriteScript) {
    // Markers follow the merge JSON's `merged` list, not the exit code: a
    // partial merge (elonchesd wf_4f1e41dd-ab7 batch 3/5 — lane 1 landed,
    // lane 2 conflicted) still records the lanes that are on the epic branch.
    steps.push({
      name: 'lane-state-write',
      command:
        `__merged_ids=" $(printf '%s' "\${__merge_out:-}" | jq -r '.merged[]?' 2>/dev/null | tr '\\n' ' ')"\n` +
        `if [ "$__merged_ids" = " " ]; then echo SKIPPED_MERGE_FAILED; else\n${o.laneStateWriteScript.trim()}\nfi`,
      tolerant: true,
    })
  }
  steps.push(...cleanupSteps(o.batchRunId, o.epicBranch))
  return steps
}

/**
 * The batch's worktree cleanup on its own. The merge batch ends with it;
 * the orchestrators also run it from their act catch block, because a
 * throw in setup or the lane workflow skipped the merge child and left the
 * root and lane worktrees registered for the next run to trip over
 * (caliper BUG O).
 */
export function cleanupSteps(batchRunId: string, epicBranch: string): BatchStep[] {
  return [{
    name: 'cleanup',
    command: `datum worktrees cleanup --run-id ${q(batchRunId)} --epic-branch ${q(epicBranch)}`,
    tolerant: true,
  }]
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
  // The plan itself NEVER travels through an LLM turn. A datum-reader echo
  // normalised "§4" to "§ 4" inside acceptance criteria (wf_6bfbd9f2-510:
  // spec hashes changed, completed lanes re-ran); the base64 chunk relay
  // that replaced it was GENERATED by the runner past ~2.7 KB rather than
  // copied (wf_5791e11f-693). The scheduler runs on the compact digest
  // `datum lane-plan-digest` writes to a temp file; this batch relays that
  // file's bytes (only when under budget) and the script checks them against
  // wc -c and git hash-object. Each lane fetches its own full spec at intake.
  steps.push({
    name: 'digest',
    // The CLI's stdout is the digest on success (already in the temp file,
    // not repeated here) and a JSON error on failure — printed only then, so
    // lanePlanDigestFromSteps can name the real cause (review finding: a
    // `>/dev/null` hid every CLI error behind a blank tail).
    command: `__digest=$(mktemp) && if [ -n "$__plan" ]; then __dout=$(datum lane-plan-digest --plan "$__plan" --out "$__digest"); __drc=$?; if [ "$__drc" -ne 0 ]; then printf '%s' "$__dout"; fi; [ "$__drc" -eq 0 ]; else printf ''; fi`,
    tolerant: true,
  })
  steps.push({ name: 'digest-bytes', command: `if [ -n "$__plan" ]; then wc -c < "$__digest" | tr -d ' '; else printf -- '-1'; fi`, tolerant: true })
  steps.push({ name: 'digest-sha', command: `if [ -n "$__plan" ]; then git hash-object "$__digest"; else printf ''; fi`, tolerant: true })
  steps.push({
    name: 'digest-cat',
    command: `if [ -n "$__plan" ] && [ "$(wc -c < "$__digest" | tr -d ' ')" -le ${LANE_PLAN_DIGEST_BUDGET_BYTES} ]; then cat "$__digest"; else echo DIGEST_TOO_LARGE; fi`,
    tolerant: true,
  })
  steps.push({ name: 'lane-state-read', command: o.laneStateReadScript.trim(), tolerant: true })
  return steps
}

/** The digest must fit one batch stdout well under the harness spill threshold. */
export const LANE_PLAN_DIGEST_BUDGET_BYTES = 16 * 1024

export function lanePlanDigestFromSteps(
  result: BatchResult,
  planPath: string,
): { ok: boolean; digest: LanePlanDigest | null; error: string } {
  const none = { ok: false, digest: null }
  if (result.missing) return { ...none, error: `lane_plan_digest_failed: ${describeFailure(result, 'digest')}` }
  const digestStep = stepResult(result, 'digest')
  if (!digestStep) return { ...none, error: 'lane_plan_digest_failed: digest step did not run' }
  if (digestStep.exit_code !== 0) {
    const tail = (digestStep.stderr || digestStep.stdout || '').trim().split('\n').slice(-3).join(' | ')
    return { ...none, error: `lane_plan_digest_failed: datum lane-plan-digest exited ${digestStep.exit_code} for ${planPath} — ${tail}` }
  }
  const bytes = parseInt((stepStdout(result, 'digest-bytes') || '').trim(), 10)
  const sha = (stepStdout(result, 'digest-sha') || '').trim()
  if (!Number.isFinite(bytes) || bytes < 0 || !sha) {
    return { ...none, error: `lane_plan_digest_failed: no digest bytes/sha for ${planPath} (${describeFailure(result, 'digest-bytes')})` }
  }
  if (bytes > LANE_PLAN_DIGEST_BUDGET_BYTES) {
    return { ...none, error: `lane_plan_digest_too_large: ${planPath} is ${bytes} bytes as a digest (budget ${LANE_PLAN_DIGEST_BUDGET_BYTES}) — split the epic or run Act on a smaller lane plan; the plan is never chunked through an LLM turn` }
  }
  const text = stepStdout(result, 'digest-cat') || ''
  const gotBytes = utf8ByteLength(text)
  const gotSha = gitBlobSha(utf8Encode(text))
  if (gotBytes !== bytes || gotSha !== sha) {
    return { ...none, error: `lane_plan_digest_mismatch: ${planPath} digest — expected ${bytes} bytes / blob ${sha}, got ${gotBytes} bytes / blob ${gotSha} — the runner did not return the digest verbatim` }
  }
  const digest = parseAgentJson<LanePlanDigest | null>(text, null)
  if (!digest || typeof digest !== 'object' || !digest.lanes || !Array.isArray(digest.topological_order)) {
    return { ...none, error: `lane_plan_digest_unparseable: ${planPath} digest did not parse as {lanes, topological_order}` }
  }
  return { ok: true, digest, error: '' }
}

/** The digest's spec_hash for a lane — the marker comparison key. Never computed from a relayed lane. */
export function digestSpecHash(digest: LanePlanDigest, taskId: string): string {
  const lane = digest.lanes[taskId]
  if (!lane) throw new Error(`lane_plan_digest_unparseable: lane ${taskId} is not in the digest`)
  if (typeof lane.spec_hash !== 'string' || !lane.spec_hash) throw new Error(`lane_plan_digest_unparseable: lane ${taskId} carries no spec_hash`)
  return lane.spec_hash
}

// ── Per-lane spec export (inside laneIntakeSteps): `datum lane-spec-export`
// writes the full lane to a file in the worktree, checks it against the
// digest's spec_hash, and prints ONLY short fields. Echoing the lane through
// the runner was not viable — it rewrote backticks as \` (wf_47c507cf-1e5).
// The stage agents read the file by path and witness the read (blob sha).

export interface LaneSpecSummary {
  task_id: string
  path: string
  bytes: number
  /** git blob sha of the written file — the read_witness the agents must reproduce. */
  sha: string
  spec_hash: string
  ac_count: number
}

export function laneSpecExportCommand(o: LaneSpecExportOpts): string {
  if (!PLAIN_ID_RE.test(o.taskId)) throw new Error(`laneSpecExportCommand: task id must be a plain identifier, got ${JSON.stringify(o.taskId)}`)
  if (!/^[A-Za-z0-9:]+$/.test(o.expectHash)) throw new Error(`laneSpecExportCommand: spec hash must be plain, got ${JSON.stringify(o.expectHash)}`)
  return `datum lane-spec-export --plan ${q(o.planPath)} --task ${q(o.taskId)} --out ${q(o.outPath)} --expect-hash ${q(o.expectHash)}`
}

export function laneSpecFromSteps(
  result: BatchResult,
  taskId: string,
  outPath: string,
): { ok: boolean; spec: LaneSpecSummary | null; error: string } {
  const none = { ok: false, spec: null }
  if (result.missing) return { ...none, error: `lane_spec_export_failed: ${taskId} — ${describeFailure(result, 'lane-spec')}` }
  const step = stepResult(result, 'lane-spec')
  if (!step) return { ...none, error: `lane_spec_export_failed: ${taskId} — the lane-spec step never ran` }
  if (step.exit_code !== 0) {
    // The CLI prints {"error": "<named reason>"} — surface it verbatim.
    const cliErr = parseAgentJson<{ error?: string } | null>(step.stdout || '', null)
    const why = (cliErr && typeof cliErr.error === 'string' && cliErr.error) || (step.stderr || step.stdout || '').trim().slice(0, 300) || `exit ${step.exit_code}`
    return { ...none, error: `lane_spec_export_failed: ${taskId} — ${why}` }
  }
  const parsed = parseAgentJson<Partial<LaneSpecSummary> | null>(step.stdout || '', null)
  const bad = (what: string) => ({ ...none, error: `lane_spec_export_unparseable: ${taskId} — ${what}: ${(step.stdout || '').trim().slice(0, 200)}` })
  if (!parsed || typeof parsed !== 'object') return bad('datum lane-spec-export printed no JSON object')
  if (parsed.task_id !== taskId) return bad(`summary is for ${String(parsed.task_id)}`)
  if (typeof parsed.path !== 'string' || !parsed.path) return bad('no path')
  if (typeof parsed.bytes !== 'number' || !Number.isInteger(parsed.bytes) || parsed.bytes <= 0) return bad('bytes is not a positive integer')
  if (typeof parsed.sha !== 'string' || !/^[0-9a-f]{40}$/.test(parsed.sha)) return bad('sha is not a 40-hex blob id')
  if (typeof parsed.spec_hash !== 'string' || !parsed.spec_hash) return bad('no spec_hash')
  if (typeof parsed.ac_count !== 'number' || !Number.isInteger(parsed.ac_count) || parsed.ac_count < 0) return bad('ac_count is not a non-negative integer')
  if (parsed.path !== outPath) return bad(`path is ${parsed.path}, expected ${outPath}`)
  // Cross-check the echoed numbers against what bash measured on disk.
  const diskBytes = parseInt((stepStdout(result, 'lane-spec-bytes') || '').trim(), 10)
  const diskSha = (stepStdout(result, 'lane-spec-sha') || '').trim()
  if (diskBytes !== parsed.bytes || diskSha !== parsed.sha) {
    return { ...none, error: `lane_spec_relay_mismatch: ${taskId} — the summary says ${parsed.bytes} bytes / blob ${parsed.sha} but ${outPath} measures ${Number.isFinite(diskBytes) ? diskBytes : '?'} bytes / blob ${diskSha || '?'} — the runner did not return the export summary verbatim` }
  }
  return {
    ok: true,
    spec: { task_id: parsed.task_id, path: parsed.path, bytes: parsed.bytes, sha: parsed.sha, spec_hash: parsed.spec_hash, ac_count: parsed.ac_count },
    error: '',
  }
}

/** The exported lane file as a deferred ContextFile: contextSlot() tells the agent to read it, assertReadWitness() proves it did. */
export function laneSpecContextFile(spec: LaneSpecSummary): ContextFile {
  return { path: spec.path, exists: true, inlined: false, bytes: spec.bytes, sha: spec.sha, content: null }
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
    {
      // The base branch is resolved, never hard-coded origin/main (same class
      // as main-sync, be0cd7fc): origin/HEAD, then origin/main|master, then a
      // local main|master — a repo with no remote still gets a merge-base.
      name: 'base-sha',
      command: [
        // The epic's recorded parent first (a chained epic's "what changed"
        // is its own commits, not its parent epic's); the shell chain only
        // when the CLI is unavailable.
        'BASE=$(datum epic-base 2>&1) || BASE=""',
        'if [ -z "$BASE" ]; then BASE=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>&1); case "$BASE" in fatal*) BASE="";; esac; fi',
        'if [ -z "$BASE" ]; then for b in main master; do if git show-ref --verify --quiet "refs/remotes/origin/$b"; then BASE="origin/$b"; break; fi; done; fi',
        'if [ -z "$BASE" ]; then for b in main master; do if git show-ref --verify --quiet "refs/heads/$b"; then BASE="$b"; break; fi; done; fi',
        '[ -n "$BASE" ] || BASE=main',
        `__base=$(git merge-base HEAD "$BASE") && printf '%s' "$__base"`,
      ].join('\n'),
      tolerant: true,
    },
    { name: 'merge-sha', command: `__merge=$(git rev-parse HEAD) && printf '%s' "$__merge"`, tolerant: true },
    { name: 'config', command: `cat .datum/config.json || echo '{}'`, tolerant: true },
    { name: 'mkdir', command: `mkdir -p ".datum/runs/$__rid"`, tolerant: true },
    // caliper BUG U: a CHANGELOG.md owned by release-please must not get a
    // hand-authored section. The script reads the owner from this step.
    {
      name: 'changelog-owner',
      command: `if [ -f release-please-config.json ] || { [ -f CHANGELOG.md ] && grep -qi "managed by release-please" CHANGELOG.md; }; then echo release-please; else echo datum; fi`,
      tolerant: true,
    },
    // An UNTRACKED root CURRENT_STATE.md (a previous closeout's artifact git
    // never had) was overwritten and lost. Moved aside first, never clobbered.
    {
      name: 'preserve-current-state',
      command: `if [ -f CURRENT_STATE.md ] && [ -z "$(git ls-files CURRENT_STATE.md)" ]; then mv CURRENT_STATE.md "CURRENT_STATE.$__rid.prev.md" && echo "moved-aside: CURRENT_STATE.$__rid.prev.md"; else echo ok; fi`,
      tolerant: true,
    },
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
// A root file whose epic-scoped destination already exists is a stale
// leftover from an OLDER epic, not this one's: kept in place and reported
// as KEPT_ROOT rather than `git mv` failing "destination exists" with exit
// 128 (caliper BUG V, root TASKS.md from #146).
function moveIntoEpicDirCommand(src: string, epicDir: string, base: string): string {
  const dest = `${epicDir}/${base}`
  return (
    `if [ -f ${q(src)} ]; then ` +
    `if [ -e ${q(dest)} ]; then echo "KEPT_ROOT: ${dest} exists, root ${src} is not this epic's, left in place"; ` +
    `else mkdir -p ${q(epicDir)} && git mv ${q(src)} ${q(dest)}; fi; ` +
    `else echo ABSENT; fi`
  )
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
    // File the run's follow-ups (synthesis manifest + per-lane skeptic minority findings) before archiving.
    { name: 'file-followups', command: `datum closeout-file-followups --run-id ${q(o.runId)}`, tolerant: true },
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


// ── Integration lanes: the independent verify runs the lane's own files ──
// run 20260907-015322: task-INT-5's nine tests passed and its verify still
// failed, because it ran the whole suite and a pre-existing, machine-
// dependent test was red; the lane reported `integration_failed: covered
// task-003`, an invariant finding that was not one. The whole suite is
// Validate's job. A pytest- or vitest-shaped command takes the lane's test
// files as arguments; an opaque wrapper (a script) is left alone.
export function integrationVerifyCmd(testCommand: string, testFiles: string[]): string {
  const cmd = testCommand.trim()
  if (testFiles.length === 0) return cmd
  if (!/\bpytest\b|\bvitest\s+run\b/.test(cmd)) return cmd
  return `${cmd} ${testFiles.join(' ')}`
}
