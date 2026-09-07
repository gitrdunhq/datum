// #368 item C — the batched step lists behind the lane/setup/merge/act-start
// datum-cli calls: order, tolerance (fail-fast only where a failure must stop
// the batch), and the deterministic evaluation helpers.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, appendFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  laneIntakeSteps,
  postRedSteps,
  codeTellSteps,
  parseTellScan,
  scopeContractSteps,
  postGreenSteps,
  strayCleanSteps,
  strayFilesFromSteps,
  ownershipCheckSteps,
  depMergeSteps,
  depMergeFromSteps,
  housekeepSteps,
  housekeepFromSteps,
  setupSteps,
  laneWorktreePathsFromSteps,
  cleanupSteps,
  redCommittedFilesFromSteps,
  mergeSteps,
  actStartSteps,
  ownershipCommand,
  sumCounts,
  newTestCountFromSteps,
  scopeReadCap,
  scopeReadTruncations,
  testEnvMissing,
  SCOPE_READ_BUDGET_BYTES,
  scopeContentsFromSteps,
  scopeGapsFromSteps,
  completionMarkerCommand,
  isMissing,
  fencedScript,
  ownershipFromStdout,
  testExitCode,
  closeoutCollectSteps,
  closeoutArchiveSteps,
  lanePlanDigestFromSteps,
  digestSpecHash,
  laneSpecFromSteps,
  laneSpecContextFile,
  laneSpecExportCommand,
  LANE_PLAN_DIGEST_BUDGET_BYTES,
  buildVerifyVerdict,
  propertiesFromSteps,
  integrationVerifyCmd,
  structuralDeliverableSteps,
  structuralDeliverablesFromSteps,
} from './lane-steps'
import { utf8ByteLength, utf8Encode } from './utf8'
import { gitBlobSha } from './sha1'
import type { LanePlanDigest } from './types'
import { batchScript, parseBatchResult, stepStdout, stepResult } from './batch'
import { renderPrompt } from './utils'
import { readFileSync } from 'node:fs'

// prompts.ts imports the .md templates through the esbuild text loader, which
// vitest cannot resolve — render the two lane-state templates here instead.
const promptsDir = join(__dirname, '..', 'prompts')
function laneStateReadScript(vars: Record<string, string>): string {
  return fencedScript(renderPrompt(readFileSync(join(promptsDir, 'lane-state-read.md'), 'utf8'), vars))
}
function laneStateWriteScript(vars: Record<string, string>): string {
  return fencedScript(renderPrompt(readFileSync(join(promptsDir, 'lane-state-write.md'), 'utf8'), vars))
}

const repoRoot = join(__dirname, '..', '..', '..')

function names(steps: { name: string }[]): string[] {
  return steps.map((s) => s.name)
}

describe('laneIntakeSteps', () => {
  const base = {
    wt: '/wt/T1',
    epicBranch: 'datum/e',
    completionPath: '.datum/runs/r1/lane-state/T1.json',
    structural: false,
    cleanupCmd: 'datum lane-cleanup "/wt/T1" --allowed "tests/test_a.py"',
    planSkeletonPath: 'docs/epics/e/skeletons/preflight-T1.json',
    skeletonCmd: 'datum skeleton --task-id T1',
    preflightPath: '.datum/runs/r1/preflight-T1.json',
  }

  it('runs completion, history, cleanup, plan skeleton then generated skeleton, all tolerant', () => {
    const steps = laneIntakeSteps(base)
    expect(names(steps)).toEqual(['completion', 'history', 'cleanup', 'skeleton-plan', 'skeleton-gen'])
    expect(steps.every((s) => s.tolerant)).toBe(true)
    expect(steps[0].command).toContain('|| echo MISSING')
    // Bounded to the lane's own commits: an unbounded log was 90 KB in a real
    // consumer repo, the relay agent truncated it to nothing, and the runner
    // missed the lane's existing RED/GREEN commits (#331) and re-ran RED.
    expect(steps[1].command).toBe('git -C "/wt/T1" log --format="%H %s%x09%(trailers:key=Datum-Spec,valueonly,separator=%x2C)" "datum/e"..HEAD')
    expect(steps[4].command).toContain('if [ -s "docs/epics/e/skeletons/preflight-T1.json" ]')
    expect(steps[4].command).toContain('datum skeleton --task-id T1')
    expect(steps[4].command).toContain('cat "/wt/T1/.datum/runs/r1/preflight-T1.json" 2>/dev/null || cat ".datum/runs/r1/preflight-T1.json" 2>/dev/null || echo "{}"')
  })

  it('omits the completion read when not in deterministic-checks mode', () => {
    expect(names(laneIntakeSteps({ ...base, completionPath: null }))).toEqual(['history', 'cleanup', 'skeleton-plan', 'skeleton-gen'])
  })

  it('structural lanes only read completion + history', () => {
    expect(names(laneIntakeSteps({ ...base, structural: true }))).toEqual(['completion', 'history'])
  })

  it('skips cleanup / plan skeleton when the lane has none', () => {
    const steps = laneIntakeSteps({ ...base, cleanupCmd: null, planSkeletonPath: '' })
    expect(names(steps)).toEqual(['completion', 'history', 'skeleton-gen'])
    expect(steps[2].command).not.toContain('if [ -s')
  })

  it('isMissing treats empty, whitespace and MISSING as missing', () => {
    expect(isMissing(null)).toBe(true)
    expect(isMissing('  \n')).toBe(true)
    expect(isMissing('MISSING\n')).toBe(true)
    expect(isMissing('{"task_id":"T1"}')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// laneIntakeSteps — verifyTestCmd (#331 follow-up): the "resume at REFACTOR"
// shortcut must not trust RED+GREEN commit MESSAGES alone — a GREEN retry
// that itself failed independent verify still leaves a `green(...): GREEN
// complete` commit on the branch. This step lets the runner independently
// re-run the suite at the lane's current HEAD before trusting the shortcut.
// ---------------------------------------------------------------------------

describe('laneIntakeSteps — verifyTestCmd (#331 intake-verify gate)', () => {
  const base = {
    wt: '/wt/T1',
    epicBranch: 'datum/e',
    completionPath: '.datum/runs/r1/lane-state/T1.json',
    structural: false,
    cleanupCmd: 'datum lane-cleanup "/wt/T1" --allowed "tests/test_a.py"',
    planSkeletonPath: 'docs/epics/e/skeletons/preflight-T1.json',
    skeletonCmd: 'datum skeleton --task-id T1',
    preflightPath: '.datum/runs/r1/preflight-T1.json',
  }

  it('appends a test-verify step after the existing (non-structural) steps when verifyTestCmd is given', () => {
    const steps = laneIntakeSteps({ ...base, verifyTestCmd: 'pytest -q' })
    expect(names(steps)).toEqual(['completion', 'history', 'cleanup', 'skeleton-plan', 'skeleton-gen', 'test-verify'])
    const step = steps[steps.length - 1]
    expect(step.name).toBe('test-verify')
    expect(step.tolerant).toBe(true)
    expect(step.command).toContain('pytest -q')
    expect(step.command).toContain('TEST_EXIT=$?')
    expect(step.command).toContain('/wt/T1')
  })

  it('appends a test-verify step after history for a structural (history-only) call when verifyTestCmd is given', () => {
    const steps = laneIntakeSteps({ ...base, structural: true, verifyTestCmd: 'pytest -q' })
    expect(names(steps)).toEqual(['completion', 'history', 'test-verify'])
  })

  it('omits the test-verify step when verifyTestCmd is not given (unchanged behavior)', () => {
    expect(names(laneIntakeSteps(base))).toEqual(['completion', 'history', 'cleanup', 'skeleton-plan', 'skeleton-gen'])
    expect(names(laneIntakeSteps({ ...base, structural: true }))).toEqual(['completion', 'history'])
  })

  it('omits the test-verify step when verifyTestCmd is null', () => {
    expect(names(laneIntakeSteps({ ...base, verifyTestCmd: null }))).not.toContain('test-verify')
  })
})

describe('laneIntakeSteps — test-verify executed against a real git worktree', () => {
  function initRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'datum-intake-verify-'))
    const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    git('init', '-q')
    git('config', 'core.hooksPath', '/dev/null')
    git('config', 'user.email', 't@t')
    git('config', 'user.name', 't')
    writeFileSync(join(dir, 'f.txt'), 'x\n')
    git('add', '-A'); git('commit', '-q', '-m', 'base')
    return dir
  }

  const intakeBase = {
    epicBranch: 'HEAD',
    completionPath: null,
    structural: true,
    cleanupCmd: null,
    planSkeletonPath: '',
    skeletonCmd: '',
    preflightPath: '',
  }

  it('prints TEST_EXIT=0 for a passing command', () => {
    const dir = initRepo()
    try {
      const steps = laneIntakeSteps({ ...intakeBase, wt: dir, verifyTestCmd: 'true' })
      const out = execFileSync('bash', ['-c', batchScript(steps)], { cwd: repoRoot, encoding: 'utf8' })
      const r = parseBatchResult(out, steps)
      expect(stepStdout(r, 'test-verify')).toContain('TEST_EXIT=0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prints a non-zero TEST_EXIT for a failing command', () => {
    const dir = initRepo()
    try {
      const steps = laneIntakeSteps({ ...intakeBase, wt: dir, verifyTestCmd: 'false' })
      const out = execFileSync('bash', ['-c', batchScript(steps)], { cwd: repoRoot, encoding: 'utf8' })
      const r = parseBatchResult(out, steps)
      expect(stepStdout(r, 'test-verify')).toMatch(/TEST_EXIT=[1-9]\d*/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('postRedSteps', () => {
  const opts = {
    wt: '/wt/T1',
    testFiles: ['tests/test_a.py', 'tests/test_b.py'],
    acCount: 2,
    testFuncDiffRegex: '[+][[:space:]]*def test_',
    sgPatterns: [{ pattern: 'assert True', name: 'assert True' }],
    testFuncBodyRegex: 'def test_',
    testFuncGrepRegex: 'def test_|async def test_',
    ownership: true,
    verifyTestCmd: null,
    baseRef: 'datum/e',
  }

  // caliper wf_181691ac-fbf task-006 (BUG I): the grep fallback of the
  // placeholder scan matched `assert True` INSIDE a quoted fixture string in
  // a test that exercises test-detection, and failed a sound RED as
  // placeholder_assertions. The fallback is anchored to a statement start.
  it('assert-check grep fallback is anchored to the statement start and escapes regex metacharacters', () => {
    const steps = postRedSteps({ ...opts, sgPatterns: [{ pattern: 'assert True', name: 'assert True' }, { pattern: 'expect(true).toBe(false)', name: 'forced failure' }] })
    const cmd = steps.find((s) => s.name === 'assert-check')!.command
    // The scan runs on the filtered copy ($__t: added lines only, multi-line
    // strings blanked), never on the file itself.
    expect(cmd).toContain(`grep -nE '^[[:space:]]*assert True' "$__t"`)
    expect(cmd).toContain(`grep -nE '^[[:space:]]*expect\\(true\\)\\.toBe\\(false\\)' "$__t"`)
    expect(cmd).not.toContain(`grep -nE '^[[:space:]]*assert True' "/wt/T1/tests/test_a.py"`)
    expect(cmd).not.toMatch(/grep -n 'assert True'/)
  })

  it('under real bash: a placeholder inside a string literal is not reported, a real one is', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-assert-'))
    try {
      mkdirSync(join(dir, 'tests'))
      writeFileSync(join(dir, 'tests', 'test_a.py'), [
        'def test_detects():',
        '    text = "def test_x():\\n    assert True\\n"',
        '    assert looks_like_test(text) is True',
        '',
        'def test_placeholder():',
        '    assert True',
        '',
      ].join('\n'))
      const steps = postRedSteps({ ...opts, wt: dir, testFiles: ['tests/test_a.py'], ownership: false, sgPatterns: [{ pattern: 'assert True', name: 'assert True' }] })
      const cmd = steps.find((s) => s.name === 'assert-check')!.command
      // The real batch runs this step tolerant; a no-match grep exits 1, so end with true.
      const out = execFileSync('bash', ['-c', `PATH=/usr/bin:/bin\n${cmd}\ntrue`], { cwd: dir, encoding: 'utf8' })
      expect(out).toContain('6:    assert True')
      expect(out).not.toContain('text = ')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('count gate diffs from the merge-base with the epic branch, not HEAD~1, so a resumed lane still counts its RED tests', () => {
    const steps = postRedSteps(opts)
    expect(steps[0].command).toContain('--base "datum/e"')
  })

  it('orders count gate, placeholder scan, ownership, per-file scope reads, then test counts — all tolerant', () => {
    const steps = postRedSteps(opts)
    expect(names(steps)).toEqual([
      'count-gate', 'assert-check', 'artifact-check', 'ownership', 'scope-size-0', 'scope-read-0', 'scope-size-1', 'scope-read-1',
      'test-count-pattern', 'test-count-after', 'test-count-before',
    ])
    expect(steps.every((s) => s.tolerant)).toBe(true)
  })

  // caliper wf_a082eead-829 (BUG N): the scope reads cat every lane test file
  // into the same batch stdout as the count gate; a 300-line test file put
  // the batch over the harness spill threshold, the runner burned its turns
  // on the spilled stub and the lane failed count_gate_no_output although
  // the gate had run. Reads are capped so the batch stays under budget, and
  // the size step tells the script when a read was truncated.
  it('scope reads are capped per file (budget split across files, 2 KB floor) and report the real size', () => {
    const steps = postRedSteps(opts)
    const cap = scopeReadCap(2)
    expect(cap).toBe(Math.floor(SCOPE_READ_BUDGET_BYTES / 2))
    expect(scopeReadCap(100)).toBe(2048)
    expect(steps.find((s) => s.name === 'scope-read-0')!.command).toBe(`head -c ${cap} "/wt/T1/tests/test_a.py" 2>/dev/null`)
    expect(steps.find((s) => s.name === 'scope-size-0')!.command).toBe(`wc -c < "/wt/T1/tests/test_a.py" 2>/dev/null | tr -d ' '`)
  })

  it('scopeReadTruncations names every file whose size exceeds the cap', () => {
    const out = scopeReadTruncations(['a.py', 'b.py'], (n) => (n === 'scope-size-0' ? '40000\n' : n === 'scope-size-1' ? '100\n' : null), 8192)
    expect(out).toEqual([{ file: 'a.py', bytes: 40000, cap: 8192 }])
  })

  it('writes grep patterns through quoted heredocs (never inline-quoted)', () => {
    const steps = postRedSteps(opts)
    expect(steps[0].command).toContain("<<'PATTERN_EOF'\n[+][[:space:]]*def test_\nPATTERN_EOF")
    // Must go through the installed `datum dev` wrapper, never a repo-relative
    // `bash scripts/...` path — consumer repos don't have datum's scripts/ dir
    // and `datum init --refresh` does not materialise it (exit 127 in the field).
    expect(steps[0].command).toContain('datum dev test-count-gate --repo "/wt/T1" --files "tests/test_a.py" "tests/test_b.py" --pattern-file "$PATFILE" --required 2')
    expect(steps[0].command).not.toContain('bash scripts/test-count-gate')
    expect(steps.find((s) => s.name === 'test-count-pattern')!.command).toContain("<<'PATTERN_EOF'\ndef test_|async def test_\nPATTERN_EOF")
  })

  // #371: a property-based (hypothesis @given) or golden-file
  // (@pytest.mark.parametrize) suite can satisfy several ACs from a handful
  // of decorated functions. The Python testFuncDiffRegex now credits those
  // decorator lines alongside def test_/async def test_ so scripts/
  // test-count-gate (run under real bash, real git, against the pattern the
  // lane runner actually sends) does not read that as zero new tests.
  it('under real bash: scripts/test-count-gate credits @given and @pytest.mark.parametrize decorator lines, not just def test_', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-count-gate-'))
    const pyTestFuncDiffRegex = '[+][[:space:]]*(def test_|async def test_|@pytest\\.mark\\.parametrize\\(|@given\\()'
    try {
      execFileSync('git', ['init', '-q', dir])
      execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t'])
      execFileSync('git', ['-C', dir, 'config', 'user.name', 't'])
      writeFileSync(join(dir, 'test_a.py'), 'def test_existing():\n    assert 1 == 1\n')
      execFileSync('git', ['-C', dir, 'add', '.'])
      execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'base'])
      // One @given-decorated property test plus one @pytest.mark.parametrize
      // runner: two bare `def test_` lines, still short of the three ACs
      // under the OLD pattern (def test_ only) — the two decorator lines are
      // what pushes the count to 3+.
      writeFileSync(join(dir, 'test_a.py'), [
        'def test_existing():',
        '    assert 1 == 1',
        '',
        '@given(st.integers())',
        'def test_roundtrip(n):',
        '    assert decode(encode(n)) == n',
        '',
        '@pytest.mark.parametrize("n,expected", [(1, 1), (2, 4)])',
        'def test_square(n, expected):',
        '    assert square(n) == expected',
        '',
      ].join('\n'))
      execFileSync('git', ['-C', dir, 'add', '.'])
      execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'red'])

      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'test-count-gate')

      const runGate = (pattern: string): string => {
        try {
          return execFileSync('bash', [scriptPath, '--repo', dir, '--files', 'test_a.py', '--pattern', pattern, '--required', '3'], { encoding: 'utf8' })
        } catch (err) {
          return (err as { stdout: Buffer }).stdout.toString()
        }
      }

      // OLD pattern (def test_ only): 2 new def lines, short of 3 ACs — the
      // bug this closure fixes.
      expect(JSON.parse(runGate('[+][[:space:]]*def test_'))).toEqual({ new_test_count: 2, required: 3, passed: false })

      // NEW pattern: the two decorator lines are credited too, clearing the gate.
      expect(JSON.parse(runGate(pyTestFuncDiffRegex))).toEqual({ new_test_count: 4, required: 3, passed: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('drops the count gate when the lane has no acceptance criteria and the ownership read when not deterministic', () => {
    const steps = postRedSteps({ ...opts, acCount: 0, ownership: false })
    expect(names(steps)).not.toContain('count-gate')
    expect(names(steps)).not.toContain('ownership')
  })

  it('ownershipCommand is the stage-commit diff', () => {
    expect(ownershipCommand('/wt/T1')).toBe('git -C "/wt/T1" diff --name-only HEAD~1 HEAD')
  })

  // A dropped `test-count-before` entry used to read as before=0, so the
  // "new tests written" gate PASSED on a baseline that never ran.
  it('newTestCountFromSteps requires both count steps and names the absent one', () => {
    const mk = (names: string[]) => parseBatchResult(JSON.stringify(names.map((name) => ({ name, exit_code: 0, stdout: name === 'test-count-after' ? '3\n' : '1\n', stderr: '' }))),
      [{ name: 'test-count-before', command: '' }, { name: 'test-count-after', command: '' }])
    expect(newTestCountFromSteps(mk(['test-count-before', 'test-count-after']))).toEqual({ ok: true, before: 1, after: 3, added: 2, error: '' })
    const noBefore = newTestCountFromSteps(mk(['test-count-after']))
    expect(noBefore.ok).toBe(false)
    // A short array is batch_incomplete at the parser (#341 task-008); the
    // gate still names the count step that is absent.
    expect(noBefore.error).toMatch(/^test_count_missing: .*batch_incomplete: .*test-count-before/)
    expect(newTestCountFromSteps(mk(['test-count-before'])).error).toMatch(/^test_count_missing: .*test-count-after/)
    expect(newTestCountFromSteps(parseBatchResult(null, [])).error).toMatch(/^test_count_missing:/)
  })

  it('sumCounts tolerates the grep -c + `|| echo 0` double-zero and junk lines', () => {
    expect(sumCounts('3\n0\n0\n2\n')).toBe(5)
    expect(sumCounts('fatal: bad revision\n1\n')).toBe(1)
    expect(sumCounts(null)).toBe(0)
  })

  it('scopeContentsFromSteps keys contents by test path and skips empty reads', () => {
    const contents = scopeContentsFromSteps(['a.py', 'b.py'], (n) => (n === 'scope-read-0' ? 'import x' : ''))
    expect(contents).toEqual({ 'a.py': 'import x' })
  })
})

// ---------------------------------------------------------------------------
// Deterministic RED-stage test-run verification: the RED agent self-reports
// tests_pass/test_exit_code from a command IT runs and IT reads the exit
// status from — a hallucinated or mistaken "tests_pass: false" self-report
// currently sails through undetected (green blindness silently defeated).
// The script must independently re-run the same test command itself and
// read the real TEST_EXIT line, never trusting the agent's self-report alone.
// ---------------------------------------------------------------------------

describe('postRedSteps — deterministic test-verify step', () => {
  const opts = {
    wt: '/wt/T1',
    testFiles: ['tests/test_a.py'],
    acCount: 1,
    testFuncDiffRegex: '[+][[:space:]]*def test_',
    sgPatterns: [{ pattern: 'assert True', name: 'assert True' }],
    testFuncBodyRegex: 'def test_',
    testFuncGrepRegex: 'def test_|async def test_',
    ownership: true,
    baseRef: null,
  }

  it('appends a test-verify step, independently re-running the test command, when verifyTestCmd is given', () => {
    const steps = postRedSteps({ ...opts, verifyTestCmd: 'pytest -q' })
    expect(names(steps)).toContain('test-verify')
    const step = steps.find((s) => s.name === 'test-verify')!
    expect(step.tolerant).toBe(true)
    expect(step.command).toContain('pytest -q')
    expect(step.command).toContain('TEST_EXIT=$?')
    expect(step.command).toContain('/wt/T1')
  })

  it('omits the test-verify step when verifyTestCmd is not given', () => {
    const steps = postRedSteps({ ...opts, verifyTestCmd: null })
    expect(names(steps)).not.toContain('test-verify')
  })
})

// elonchesd wf_eb0f9f9b-7b1: "sh: vitest: command not found ... TEST_EXIT=1"
// read as a red suite, so every GREEN was green_stale at the next intake.
describe('testEnvMissing', () => {
  it('names a missing test environment from the verify output', () => {
    expect(testEnvMissing('> vitest run\n\nsh: vitest: command not found\n ELIFECYCLE Test failed.\nTEST_EXIT=1\n')).toBe('sh: vitest: command not found')
    expect(testEnvMissing('WARN Local package.json exists, but node_modules missing, did you mean to install?\nTEST_EXIT=1')).toMatch(/node_modules missing/)
    expect(testEnvMissing("ModuleNotFoundError: No module named 'pytest'\nTEST_EXIT=1")).toMatch(/No module named 'pytest'/)
    expect(testEnvMissing('uv: command not found\nTEST_EXIT=127')).toMatch(/uv: command not found/)
  })
  it('is null for an ordinary red or green suite', () => {
    expect(testEnvMissing('FAILED tests/test_a.py::test_x - assert 1 == 2\nTEST_EXIT=1')).toBeNull()
    expect(testEnvMissing('3 passed\nTEST_EXIT=0')).toBeNull()
    expect(testEnvMissing(null)).toBeNull()
  })
})

describe('testExitCode', () => {
  it('parses the TEST_EXIT line printed by testRunCommand-style output', () => {
    expect(testExitCode('some output\nmore output\nTEST_EXIT=1\n')).toBe(1)
    expect(testExitCode('TEST_EXIT=0')).toBe(0)
  })

  it('returns null when no TEST_EXIT line is present (step did not run)', () => {
    expect(testExitCode('no exit line here')).toBeNull()
    expect(testExitCode(null)).toBeNull()
  })

  it('reads the LAST TEST_EXIT line when output contains more than one', () => {
    expect(testExitCode('TEST_EXIT=1\nsome retry noise\nTEST_EXIT=0')).toBe(0)
  })
})

describe('scripts/test-count-gate --base — resumed lane whose RED commit is not HEAD~1', () => {
  it('counts the RED tests when GREEN has since landed on top, given the epic branch as base', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-countgate-base-'))
    try {
      const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      git('init', '-q', '-b', 'epic')
      git('config', 'core.hooksPath', '/dev/null') // hermetic: neutralise machine-global hooks
      git('config', 'user.email', 't@t')
      git('config', 'user.name', 't')
      mkdirSync(join(dir, 'tests'))
      writeFileSync(join(dir, 'tests', 'test_a.py'), 'def test_old():\n    assert 1 == 1\n')
      writeFileSync(join(dir, 'src.py'), 'x = 0\n')
      git('add', '-A'); git('commit', '-q', '-m', 'base')
      git('checkout', '-q', '-b', 'epic--T1')
      writeFileSync(join(dir, 'tests', 'test_a.py'), 'def test_old():\n    assert 1 == 1\n\ndef test_new1():\n    assert x\n\ndef test_new2():\n    assert x\n')
      git('add', '-A'); git('commit', '-q', '-m', 'red(T1): RED complete')
      writeFileSync(join(dir, 'src.py'), 'x = 1\n')
      git('add', '-A'); git('commit', '-q', '-m', 'green(T1): GREEN complete')

      // HEAD~1..HEAD is GREEN's diff (no tests) — the old baseline reports 0.
      // With --base epic the diff spans the whole lane and finds both tests.
      const out = execFileSync('bash', [
        'scripts/test-count-gate', '--repo', dir, '--files', 'tests/test_a.py',
        '--pattern', '[+][[:space:]]*def test_', '--required', '2', '--base', 'epic',
      ], { cwd: repoRoot, encoding: 'utf8' })
      expect(JSON.parse(out.trim())).toEqual({ new_test_count: 2, required: 2, passed: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('postRedSteps — executed against a real git worktree', () => {
  it('counts the new test functions and lists the files the RED commit touched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-postred-'))
    try {
      const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      git('init', '-q')
      git('config', 'core.hooksPath', '/dev/null') // hermetic: neutralise machine-global hooks
      git('config', 'user.email', 't@t')
      git('config', 'user.name', 't')
      mkdirSync(join(dir, 'tests'))
      writeFileSync(join(dir, 'tests', 'test_a.py'), 'def test_old():\n    assert 1 == 1\n')
      git('add', '-A'); git('commit', '-q', '-m', 'base')
      writeFileSync(join(dir, 'tests', 'test_a.py'), 'def test_old():\n    assert 1 == 1\n\ndef test_new():\n    pass\n')
      writeFileSync(join(dir, 'src.py'), 'x = 1\n')
      git('add', '-A'); git('commit', '-q', '-m', 'red(T1): RED complete')

      const steps = postRedSteps({
        wt: dir, testFiles: ['tests/test_a.py'], acCount: 1,
        testFuncDiffRegex: '[+][[:space:]]*def test_',
        sgPatterns: [{ pattern: 'assert True', name: 'assert True' }],
        testFuncBodyRegex: 'def test_', testFuncGrepRegex: 'def test_|async def test_', ownership: true,
        verifyTestCmd: null, baseRef: null,
      })
      const out = execFileSync('bash', ['-c', batchScript(steps)], { cwd: repoRoot, encoding: 'utf8' })
      const r = parseBatchResult(out, steps)
      expect(r.missing).toBe(false)
      expect(r.failed).toBeNull()
      expect(stepStdout(r, 'count-gate')).toMatch(/"new_test_count":\s*1/)
      expect(stepStdout(r, 'ownership')!.trim().split('\n').sort()).toEqual(['src.py', 'tests/test_a.py'])
      // the pass-only body scan finds `def test_new(): pass`
      expect(stepStdout(r, 'assert-check')).toMatch(/pass/)
      expect(sumCounts(stepStdout(r, 'test-count-after'))).toBe(2)
      expect(sumCounts(stepStdout(r, 'test-count-before'))).toBe(1)
      expect(stepStdout(r, 'scope-read-0')).toContain('def test_new')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // elonchesd run wf_1763c81d-94c: the RED agent made TWO commits on the lane
  // (a skeleton, then the real tests). test-count-before read `HEAD~1`, so
  // before == after, newTestCount = 0, and the lane failed
  // no_new_tests_written — a false negative that blocked 17 lanes and had
  // triage file a wrong-root-cause issue — while count-gate (diffing from
  // the epic merge-base) had already passed. "Before" must be the lane's
  // base, not the previous commit.
  it('reads the before-count from the epic merge-base when baseRef is given, so a two-commit RED still counts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-postred2-'))
    try {
      const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      git('init', '-q', '-b', 'epic')
      git('config', 'core.hooksPath', '/dev/null')
      git('config', 'user.email', 't@t')
      git('config', 'user.name', 't')
      mkdirSync(join(dir, 'tests'))
      writeFileSync(join(dir, 'tests', 'test_a.py'), 'def test_old():\n    assert 1 == 1\n')
      git('add', '-A'); git('commit', '-q', '-m', 'base')
      git('checkout', '-q', '-b', 'epic--T1')
      writeFileSync(join(dir, 'tests', 'test_a.py'), 'def test_old():\n    assert 1 == 1\n\ndef test_new():\n    assert 2 == 2\n')
      git('add', '-A'); git('commit', '-q', '-m', 'red(T1): RED complete')
      writeFileSync(join(dir, 'tests', 'test_a.py'), 'def test_old():\n    assert 1 == 1\n\ndef test_new():\n    assert 2 == 2\n\ndef test_newer():\n    assert 3 == 3\n')
      git('add', '-A'); git('commit', '-q', '-m', 'red(T1): more tests')

      const steps = postRedSteps({
        wt: dir, testFiles: ['tests/test_a.py'], acCount: 2,
        testFuncDiffRegex: '[+][[:space:]]*def test_',
        sgPatterns: [{ pattern: 'assert True', name: 'assert True' }],
        testFuncBodyRegex: 'def test_', testFuncGrepRegex: 'def test_|async def test_', ownership: true,
        verifyTestCmd: null, baseRef: 'epic',
      })
      expect(steps.find((s) => s.name === 'test-count-before')!.command).toContain('merge-base HEAD "epic"')
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: repoRoot, encoding: 'utf8' }), steps)
      expect(sumCounts(stepStdout(r, 'test-count-after'))).toBe(3)
      expect(sumCounts(stepStdout(r, 'test-count-before'))).toBe(1)
      expect(stepStdout(r, 'count-gate')).toMatch(/"new_test_count":\s*2/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('scopeContractSteps', () => {
  it('emits one existence check per gap and a preflight that widens --allowed from the gaps that exist', () => {
    const steps = scopeContractSteps({
      wt: '/wt/T1',
      scopeGaps: ['src/a.py', 'src/b.py'],
      contractPreflight: { testFiles: ['tests/test_a.py'], implFiles: ['src/impl.py'], scopedTestCmd: 'uv run pytest -q' },
    })
    expect(names(steps)).toEqual(['scope-exists-0', 'scope-exists-1', 'contract-preflight'])
    expect(steps[0].command).toBe('test -f "/wt/T1/src/a.py"')
    expect(steps[2].command).toContain('for __f in "src/a.py" "src/b.py"; do [ -f "/wt/T1"/"$__f" ] && __extra+=(--allowed "$__f"); done')
    expect(steps[2].command).toContain('datum contract-preflight --repo "/wt/T1" --test-command "uv run pytest -q" --test-file "tests/test_a.py" --allowed "src/impl.py" "${__extra[@]}"')
    expect(steps.every((s) => s.tolerant)).toBe(true)
  })

  it('is empty when there is nothing to check (no call is made)', () => {
    expect(scopeContractSteps({ wt: '/wt', scopeGaps: [], contractPreflight: null })).toEqual([])
  })

  it('scopeGapsFromSteps splits by exit code, treating a missing step as missing', () => {
    const r = scopeGapsFromSteps(['a', 'b', 'c'], (n) => (n === 'scope-exists-0' ? 0 : n === 'scope-exists-1' ? 1 : null))
    expect(r).toEqual({ existing: ['a'], missing: ['b', 'c'] })
  })
})

describe('ownershipFromStdout (#368 item D — script-evaluated ownership)', () => {
  it('fails CLOSED when the diff step did not run — a missing check is not a clean one', () => {
    const r = ownershipFromStdout(null, ['tests/test_a.py'], ['src/a.py'])
    expect(r.ok).toBe(false)
    expect(r.violations[0]).toMatch(/^ownership_check_failed/)
  })
  it('accepts a commit that only touched allowed files', () => {
    expect(ownershipFromStdout('tests/test_a.py\n', ['tests/test_a.py'], ['src/a.py']).ok).toBe(true)
  })
  it('flags forbidden and unlisted files from the diff output', () => {
    const r = ownershipFromStdout('tests/test_a.py\nsrc/a.py\nREADME.md\n', ['tests/test_a.py'], ['src/a.py'])
    expect(r.ok).toBe(false)
    expect(r.violations.join(' ')).toMatch(/src\/a\.py/)
    expect(r.violations.join(' ')).toMatch(/README\.md/)
  })
  it('ignores blank lines and surrounding whitespace', () => {
    expect(ownershipFromStdout('\n  tests/test_a.py  \n\n', ['tests/test_a.py'], []).ok).toBe(true)
  })
})

describe('ownershipCheckSteps (legacy-mode ownership, hooks not installed)', () => {
  it('is the same single tolerant ownership diff step the deterministic batches carry', () => {
    const steps = ownershipCheckSteps('/wt/T1')
    expect(names(steps)).toEqual(['ownership'])
    expect(steps[0].command).toBe(ownershipCommand('/wt/T1'))
    expect(steps[0].tolerant).toBe(true)
  })
})

describe('postGreenSteps', () => {
  it('is the single ownership read when verifyTestCmd is not given', () => {
    const steps = postGreenSteps({ wt: '/wt/T1' })
    expect(names(steps)).toEqual(['ownership'])
    expect(steps[0].command).toBe(ownershipCommand('/wt/T1'))
  })

  it('omits the test-verify step when verifyTestCmd is null', () => {
    const steps = postGreenSteps({ wt: '/wt/T1', verifyTestCmd: null })
    expect(names(steps)).not.toContain('test-verify')
  })

  // caliper BUG P: green_edited_tests must mean "GREEN modified a file the
  // RED commit wrote", so the batch also lists the RED commit's files.
  it('adds a red-files step listing the RED commit when redSha is given, and redCommittedFilesFromSteps reads it', () => {
    const steps = postGreenSteps({ wt: '/wt/T1', redSha: 'abc123' })
    expect(names(steps)).toEqual(['ownership', 'red-files'])
    const step = steps.find((s) => s.name === 'red-files')!
    expect(step.tolerant).toBe(true)
    expect(step.command).toBe('git -C "/wt/T1" diff-tree --no-commit-id --name-only -r "abc123"')
    expect(names(postGreenSteps({ wt: '/wt/T1' }))).not.toContain('red-files')

    const listed = redCommittedFilesFromSteps(parseBatchResult(JSON.stringify([
      { name: 'ownership', exit_code: 0, stdout: '', stderr: '' },
      { name: 'red-files', exit_code: 0, stdout: 'tests/test_a.py\ntests/test_b.py\n', stderr: '' },
    ]), steps))
    expect(listed).toEqual(['tests/test_a.py', 'tests/test_b.py'])
    // A step that did not run is unknown, never "RED committed nothing".
    expect(redCommittedFilesFromSteps(parseBatchResult(JSON.stringify([
      { name: 'ownership', exit_code: 0, stdout: '', stderr: '' },
    ]), steps))).toBeNull()
  })

  it('appends a test-verify step, independently re-running the test command, when verifyTestCmd is given', () => {
    const steps = postGreenSteps({ wt: '/wt/T1', verifyTestCmd: 'pytest -q' })
    expect(names(steps)).toContain('test-verify')
    const step = steps.find((s) => s.name === 'test-verify')!
    expect(step.tolerant).toBe(true)
    expect(step.command).toContain('pytest -q')
    expect(step.command).toContain('TEST_EXIT=$?')
    expect(step.command).toContain('/wt/T1')
  })

  // #425/#424: build_command is optional — present only when configured.
  it('omits the build-verify step when buildCommand is not given', () => {
    const steps = postGreenSteps({ wt: '/wt/T1', verifyTestCmd: 'pytest -q' })
    expect(names(steps)).not.toContain('build-verify')
  })

  it('appends a build-verify step, independently re-running build_command, when buildCommand is given', () => {
    const steps = postGreenSteps({ wt: '/wt/T1', verifyTestCmd: 'pytest -q', buildCommand: 'pnpm typecheck' })
    expect(names(steps)).toContain('build-verify')
    const step = steps.find((s) => s.name === 'build-verify')!
    expect(step.tolerant).toBe(true)
    expect(step.command).toContain('pnpm typecheck')
    expect(step.command).toContain('TEST_EXIT=$?')
    expect(step.command).toContain('/wt/T1')
    // build-verify comes after test-verify, same shape as the test check.
    expect(names(steps).indexOf('build-verify')).toBeGreaterThan(names(steps).indexOf('test-verify'))
  })

  it('runs the stray clean and build-verify even when verifyTestCmd is not given but buildCommand is', () => {
    const steps = postGreenSteps({ wt: '/wt/T1', buildCommand: 'go build ./...' })
    expect(names(steps)).toContain('build-verify')
    expect(names(steps)).not.toContain('test-verify')
    expect(names(steps)).toContain('stray-list')
  })
})

describe('buildVerifyVerdict', () => {
  it('is unavailable when the build-verify step did not run', () => {
    const steps = postGreenSteps({ wt: '/wt/T1' })
    const result = parseBatchResult(JSON.stringify([{ name: 'ownership', exit_code: 0, stdout: '', stderr: '' }]), steps)
    const v = buildVerifyVerdict(result, 'post-green-build-verify')
    expect(v.kind).toBe('unavailable')
    expect(v.exit).toBeNull()
  })

  it('is passed on TEST_EXIT=0 and failed WITH the exit code otherwise', () => {
    const steps = postGreenSteps({ wt: '/wt/T1', buildCommand: 'pnpm typecheck' })
    const passResult = parseBatchResult(JSON.stringify([
      { name: 'ownership', exit_code: 0, stdout: '', stderr: '' },
      { name: 'stray-list', exit_code: 0, stdout: '', stderr: '' },
      { name: 'stray-clean', exit_code: 0, stdout: '', stderr: '' },
      { name: 'stray-confirm', exit_code: 0, stdout: '', stderr: '' },
      { name: 'build-verify', exit_code: 0, stdout: 'TEST_EXIT=0\n', stderr: '' },
    ]), steps)
    expect(buildVerifyVerdict(passResult, 'label')).toEqual({ kind: 'passed', exit: 0, why: '' })

    const failResult = parseBatchResult(JSON.stringify([
      { name: 'ownership', exit_code: 0, stdout: '', stderr: '' },
      { name: 'stray-list', exit_code: 0, stdout: '', stderr: '' },
      { name: 'stray-clean', exit_code: 0, stdout: '', stderr: '' },
      { name: 'stray-confirm', exit_code: 0, stdout: '', stderr: '' },
      { name: 'build-verify', exit_code: 0, stdout: 'TEST_EXIT=2\n', stderr: '' },
    ]), steps)
    const failVerdict = buildVerifyVerdict(failResult, 'label')
    expect(failVerdict.kind).toBe('failed')
    expect(failVerdict.exit).toBe(2)
  })
})

describe('setupSteps', () => {
  it('creates the root worktree, sets up lanes from it, then distributes the plan — fail-fast on each', () => {
    const steps = setupSteps({ batchRunId: 'r1-b0', epicBranch: 'datum/e', laneIds: ['T1', 'T2'], lanePlanPath: 'docs/epics/datum/e/lane-plan.json' })
    expect(names(steps)).toEqual(['root-wt', 'setup-wt', 'distribute'])
    expect(steps.every((s) => !s.tolerant)).toBe(true)
    // Idempotent: a root worktree left by a prior partial setup of the same
    // batch is removed first (phase review wf_9a69f891-462).
    expect(steps[0].command).toContain('if [ -e ".datum/worktrees/r1-b0-root" ]; then git worktree remove --force ".datum/worktrees/r1-b0-root" 2>&1 || rm -rf ".datum/worktrees/r1-b0-root"; fi && git worktree prune && ')
    expect(steps[0].command).toContain('git worktree add --detach ".datum/worktrees/r1-b0-root" "datum/e"')
    expect(steps[0].command).toContain('printf \'{"root": "%s"}\' "$__root"')
    expect(steps[1].command).toContain('cd "$__root" && datum worktrees setup --run-id "r1-b0" --epic-branch "datum/e" --lane-ids T1,T2')
    expect(steps[2].command).toContain('select(type=="string" and startswith("/"))')
    expect(steps[2].command).toContain('datum lane-plan-distribute "$__root/docs/epics/datum/e/lane-plan.json" "${__targets[@]}"')
  })

  // caliper BUG O (wf_7686c0cf-f7e): `__setup=$(datum worktrees setup ...) &&
  // printf` dropped the CLI's JSON error whenever it exited 1 — the printf
  // never ran, the step record had empty stdout AND stderr, and the workflow
  // died with "CLI output was not JSON — " (nothing) instead of the real
  // "lane branch ... is locked to stale worktree ..." message.
  it('the setup-wt step prints the CLI output even when the CLI exits 1, and still fails the step', () => {
    const steps = setupSteps({ batchRunId: 'r1-b0', epicBranch: 'datum/e', laneIds: ['T1'], lanePlanPath: 'x' })
    expect(steps[1].command).toContain('__setup=$(cd "$__root" && datum worktrees setup --run-id "r1-b0" --epic-branch "datum/e" --lane-ids T1); __setup_rc=$?')
    expect(steps[1].command).toContain(`printf '%s' "$__setup"; [ "$__setup_rc" -eq 0 ]`)
    expect(steps[1].command).not.toContain(') && printf')
  })

  it('under real bash, a failing `datum worktrees setup` leaves its JSON error in the setup-wt step record', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-setupwt-'))
    try {
      const bin = join(dir, 'bin')
      mkdirSync(bin)
      writeFileSync(join(bin, 'datum'), '#!/bin/bash\nprintf \'{"error": "lane branch datum/e--T1 is locked to stale worktree /x"}\'\nexit 1\n', { mode: 0o755 })
      const steps = setupSteps({ batchRunId: 'r1-b0', epicBranch: 'datum/e', laneIds: ['T1'], lanePlanPath: 'x' })
      const script = `export __root=${JSON.stringify(dir)}\n` + batchScript([steps[1]])
      const out = execFileSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
      const parsed = parseBatchResult(out, [steps[1]])
      expect(parsed.failed?.name).toBe('setup-wt')
      expect(stepResult(parsed, 'setup-wt')?.exit_code).toBe(1)
      expect(stepStdout(parsed, 'setup-wt')).toContain('"error": "lane branch datum/e--T1 is locked to stale worktree /x"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('laneWorktreePathsFromSteps surfaces the CLI JSON error verbatim as setup_worktrees_failed, else the absolute paths', () => {
    const steps = setupSteps({ batchRunId: 'r1-b0', epicBranch: 'datum/e', laneIds: ['T1', 'T2'], lanePlanPath: 'x' })
    const failed = laneWorktreePathsFromSteps(parseBatchResult(JSON.stringify([
      { name: 'root-wt', exit_code: 0, stdout: '{"root": "/r"}', stderr: '' },
      { name: 'setup-wt', exit_code: 1, stdout: '{"error": "lane branch datum/e--T1 is locked to stale worktree /x, which has uncommitted changes"}', stderr: '' },
    ]), steps))
    expect(failed.paths).toEqual({})
    expect(failed.error).toBe('setup_worktrees_failed: lane branch datum/e--T1 is locked to stale worktree /x, which has uncommitted changes')

    const empty = laneWorktreePathsFromSteps(parseBatchResult(JSON.stringify([
      { name: 'root-wt', exit_code: 0, stdout: '{"root": "/r"}', stderr: '' },
      { name: 'setup-wt', exit_code: 1, stdout: '', stderr: 'Traceback: boom' },
    ]), steps))
    expect(empty.error).toMatch(/^setup_worktrees_failed: CLI output was not JSON — setup: step "setup-wt" exited 1.*boom/)

    const ok = laneWorktreePathsFromSteps(parseBatchResult(JSON.stringify([
      { name: 'root-wt', exit_code: 0, stdout: '{"root": "/r"}', stderr: '' },
      { name: 'setup-wt', exit_code: 0, stdout: '{"T1": "/r/.datum/worktrees/r1-b0/T1", "T2": "relative/garbage"}', stderr: '' },
      { name: 'distribute', exit_code: 0, stdout: '', stderr: '' },
    ]), steps))
    expect(ok.error).toBeNull()
    expect(ok.paths).toEqual({ T1: '/r/.datum/worktrees/r1-b0/T1' })
    expect(ok.dropped).toEqual([{ laneId: 'T2', value: 'relative/garbage' }])
  })

  it('under real bash, the root-wt step succeeds twice in a row for the same batch id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-rootwt-'))
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: dir })
      execFileSync('git', ['branch', 'datum/e'], { cwd: dir })
      const cmd = setupSteps({ batchRunId: 'r1-b0', epicBranch: 'datum/e', laneIds: ['T1'], lanePlanPath: 'x' })[0].command
      const first = execFileSync('bash', ['-c', cmd], { cwd: dir, encoding: 'utf8' })
      const second = execFileSync('bash', ['-c', cmd], { cwd: dir, encoding: 'utf8' })
      expect(first).toContain('"root": "')
      expect(second).toContain('"root": "')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// In-batch dependency merge (#296): a lane whose dep ran in the same batch
// merges the dep's lane branch into its own worktree before RED. This was a
// runner told to run `git merge` per branch and echo the output, judged by a
// regex for CONFLICT — a runner that answered "done" after a conflict left
// the worktree mid-merge and RED ran on it. Now: non-tolerant steps, exit
// code is the verdict, a failed merge is aborted in the same step.
describe('depMergeSteps', () => {
  it('is one non-tolerant merge step per dep branch, in order, each aborting its own failed merge', () => {
    const steps = depMergeSteps('/wt/T2', ['epic--T1', 'epic--T0'])
    expect(names(steps)).toEqual(['merge-0', 'merge-1'])
    expect(steps[0].tolerant).toBeFalsy()
    expect(steps[0].command).toBe('git -C "/wt/T2" merge --no-edit "epic--T1" || { git -C "/wt/T2" merge --abort >/dev/null 2>&1; false; }')
    expect(steps[1].command).toContain('"epic--T0"')
  })
})

describe('depMergeFromSteps', () => {
  const steps = depMergeSteps('/wt/T2', ['epic--T1', 'epic--T0'])

  it('is ok when every merge step exited 0', () => {
    const r = depMergeFromSteps(parseBatchResult(JSON.stringify([
      { name: 'merge-0', exit_code: 0, stdout: 'Merge made by the ort strategy.', stderr: '' },
      { name: 'merge-1', exit_code: 0, stdout: 'Already up to date.', stderr: '' },
    ]), steps), ['epic--T1', 'epic--T0'])
    expect(r).toEqual({ ok: true, error: '' })
  })

  it('names the failed branch and the git tail on a non-zero merge, as dep_merge_failed', () => {
    const r = depMergeFromSteps(parseBatchResult(JSON.stringify([
      { name: 'merge-0', exit_code: 1, stdout: 'CONFLICT (content): Merge conflict in src/a.ts\nAutomatic merge failed', stderr: '' },
    ]), steps), ['epic--T1', 'epic--T0'])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^dep_merge_failed: could not merge epic--T1 .*CONFLICT/)
  })

  it('a batch that returned nothing parseable is dep_merge_failed too — the worktree state is unknown', () => {
    const r = depMergeFromSteps(parseBatchResult(null, steps), ['epic--T1'])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^dep_merge_failed: .*no parseable result/)
  })

  it('a batch missing a later merge step (stopped early without a failed marker) is not ok', () => {
    const r = depMergeFromSteps(parseBatchResult(JSON.stringify([
      { name: 'merge-0', exit_code: 0, stdout: '', stderr: '' },
    ]), steps), ['epic--T1', 'epic--T0'])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/epic--T0/)
  })
})

describe('housekeepSteps / housekeepFromSteps (closeout)', () => {
  it('is one tolerant `datum housekeep-epic <branch>` step', () => {
    const steps = housekeepSteps('datum/epic-7')
    expect(names(steps)).toEqual(['housekeep'])
    expect(steps[0].command).toBe('datum housekeep-epic "datum/epic-7"')
    expect(steps[0].tolerant).toBe(true)
  })

  it('is ok on exit 0 and surfaces the printed JSON summary', () => {
    const r = housekeepFromSteps(parseBatchResult(JSON.stringify([
      { name: 'housekeep', exit_code: 0, stdout: '{"deleted_branches": ["datum/epic-7--T1"], "pipeline_state_removed": true}', stderr: '' },
    ]), housekeepSteps('datum/epic-7')))
    expect(r.ok).toBe(true)
    expect(r.error).toBe('')
    expect(r.summary).toContain('datum/epic-7--T1')
  })

  it('a non-zero exit or a missing batch is housekeep_failed with the tail', () => {
    const failed = housekeepFromSteps(parseBatchResult(JSON.stringify([
      { name: 'housekeep', exit_code: 1, stdout: '', stderr: 'error: branch not fully merged' },
    ]), housekeepSteps('datum/epic-7')))
    expect(failed.ok).toBe(false)
    expect(failed.error).toMatch(/^housekeep_failed: datum housekeep-epic exited 1.*not fully merged/)
    expect(housekeepFromSteps(parseBatchResult(null, housekeepSteps('x'))).error).toMatch(/^housekeep_failed: /)
  })
})

describe('cleanupSteps', () => {
  it('is the single tolerant cleanup step the merge batch ends with, usable alone after a crash', () => {
    const steps = cleanupSteps('r1-b0', 'datum/e')
    expect(names(steps)).toEqual(['cleanup'])
    expect(steps[0].tolerant).toBe(true)
    expect(steps[0].command).toBe('datum worktrees cleanup --run-id "r1-b0" --epic-branch "datum/e"')
    const merge = mergeSteps({ batchRunId: 'r1-b0', epicBranch: 'datum/e', completedIds: [], mergeOrder: [], laneStateWriteScript: null })
    expect(merge).toEqual(steps)
  })
})

describe('mergeSteps', () => {
  const write = laneStateWriteScript({ epicBranch: 'datum/e', epicSlug: 'datum-e', runId: 'r1', entriesJson: '[{"task_id":"T1","spec_hash":"h"}]' })

  // Phase review wf_9a69f891-462: the per-run completion markers were written
  // BEFORE the merge, unconditionally — a lane whose squash failed still got
  // a marker and the next run skipped it at intake as "completed".
  it('merges first, then writes completion markers only for lanes the merge JSON says landed, records lane-state, then cleans up', () => {
    const steps = mergeSteps({ batchRunId: 'r1', epicBranch: 'datum/e', completedIds: ['T1', 'T2'], mergeOrder: ['T1', 'T2'], laneStateWriteScript: write })
    expect(names(steps)).toEqual(['merge', 'completion-markers', 'lane-state-write', 'cleanup'])
    expect(steps.every((s) => s.tolerant)).toBe(true)
    expect(steps[1].command).toMatch(/^__landed_ids=" \$\(printf '%s' "\$\{__merge_out:-\}" \| jq -r '\(\.merged\[\]\?, \.already_merged\[\]\?\)' 2>\/dev\/null \| tr '\\n' ' '\)"\n/)
    expect(steps[1].command).toContain(`case "$__landed_ids" in *" T1 "*) ${completionMarkerCommand('r1', 'T1')};; *) echo "SKIPPED_NOT_MERGED T1";; esac`)
    expect(steps[1].command).toContain(`case "$__landed_ids" in *" T2 "*) ${completionMarkerCommand('r1', 'T2')};; *) echo "SKIPPED_NOT_MERGED T2";; esac`)
    // --run-id: a conflict report lands in .datum/runs/<run>/ (elonchesd task-015).
    expect(steps[0].command).toContain('__merge_out=$(datum worktrees merge --epic-branch "datum/e" --lane-order T1,T2 --commit-message "act(r1): merge 2 lanes" --run-id "r1")')
    expect(steps[0].command).toContain('__merge_rc=$?')
    expect(steps[0].command).toContain(`printf '%s\\n' "$__merge_out"`)
    // The merge JSON's `merged` list — not the exit code — decides which
    // lanes get an epic-scoped marker: a partial merge (later lane conflicted,
    // earlier lanes committed) still records the lanes that landed.
    expect(steps[2].command).toMatch(/^__merged_ids=" \$\(printf '%s' "\$\{__merge_out:-\}" \| jq -r '\.merged\[\]\?' 2>\/dev\/null \| tr '\\n' ' '\)"\n/)
    expect(steps[2].command).toContain('if [ "$__merged_ids" = " " ]; then echo SKIPPED_MERGE_FAILED; else')
    expect(steps[2].command).toContain('datum lane-state write')
    expect(steps[3].command).toBe('datum worktrees cleanup --run-id "r1" --epic-branch "datum/e"')
  })

  it('under real bash, a completion marker is written only for lanes the merge JSON lists as merged or already_merged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-markers-'))
    try {
      execFileSync('git', ['init', '-q', '-b', 'e'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: dir })
      const bin = join(dir, 'bin')
      mkdirSync(bin)
      // Fake datum: the merge lands T1 and reports T3 already merged, T2 failed (exit 1).
      writeFileSync(join(bin, 'datum'), `#!/usr/bin/env bash\ncase "$1 $2" in\n  "worktrees merge") printf '%s' '{"sha":"abc","merged":["T1"],"already_merged":["T3"],"failed_lane":"T2","error":"conflict"}'; exit 1;;\n  *) exit 0;;\nesac\n`, { mode: 0o755 })
      const steps = mergeSteps({ batchRunId: 'r1', epicBranch: 'e', completedIds: ['T1', 'T2', 'T3'], mergeOrder: ['T1', 'T2', 'T3'], laneStateWriteScript: null })
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` }
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, env, encoding: 'utf8' }), steps)
      expect(existsSync(join(dir, '.datum/runs/r1/lane-state/T1.json'))).toBe(true)
      expect(existsSync(join(dir, '.datum/runs/r1/lane-state/T3.json'))).toBe(true)
      expect(existsSync(join(dir, '.datum/runs/r1/lane-state/T2.json'))).toBe(false)
      expect(stepStdout(r, 'completion-markers')).toContain('SKIPPED_NOT_MERGED T2')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the lane-state write script skips entries the merge did not list as merged', () => {
    // The rendered script filters on $__merged_ids when the merge step set it;
    // without it (unset) every entry is written.
    expect(write).toMatch(/case "\$\{__merged_ids:- \$TID \}" in \*" \$TID "\*\) ;; \*\) continue;; esac/)
  })

  it('under real bash, only the lanes in $__merged_ids reach `datum lane-state write`; unset means all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-merged-ids-'))
    try {
      execFileSync('git', ['init', '-q', '-b', 'e'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: dir })
      const bin = join(dir, 'bin')
      mkdirSync(bin)
      const logPath = join(dir, 'calls.log')
      writeFileSync(join(bin, 'datum'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${logPath}"\n`, { mode: 0o755 })
      const script = laneStateWriteScript({
        epicBranch: 'e', epicSlug: 'e', runId: 'r1',
        entriesJson: '[{"task_id":"T1","spec_hash":"h1"},{"task_id":"T2","spec_hash":"h2"}]',
      })
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` }

      const partial = execFileSync('bash', ['-c', `__merged_ids=" T1 "\n${script}`], { cwd: dir, env, encoding: 'utf8' })
      expect(partial.trim()).toBe('DONE')
      const calls = readFileSync(logPath, 'utf8').trim().split('\n')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toContain('--task T1')
      expect(calls[0]).toContain('--spec-hash h1')

      writeFileSync(logPath, '')
      execFileSync('bash', ['-c', script], { cwd: dir, env, encoding: 'utf8' })
      const all = readFileSync(logPath, 'utf8').trim().split('\n')
      expect(all).toHaveLength(2)
      expect(all.map((c) => (c.match(/--task (\S+)/) || [])[1])).toEqual(['T1', 'T2'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips the merge and lane-state when nothing is GREEN, but still cleans up', () => {
    const steps = mergeSteps({ batchRunId: 'r1', epicBranch: 'datum/e', completedIds: [], mergeOrder: [], laneStateWriteScript: null })
    expect(names(steps)).toEqual(['cleanup'])
  })

  it('completionMarkerCommand refuses a task id that is not a plain identifier (review: single-quote breakout)', () => {
    expect(() => completionMarkerCommand('r1', "lane1'; touch /tmp/PWNED; echo '")).toThrow(/task id/)
    expect(() => completionMarkerCommand("r1'; echo x; '", 'T1')).toThrow(/run id/)
    expect(completionMarkerCommand('20260905-101010', 'task-001')).toContain('"task_id": "task-001"')
  })

  it('completionMarkerCommand writes the same file the lane completion-check reads', () => {
    const cmd = completionMarkerCommand('r1', 'T1')
    expect(cmd).toContain('mkdir -p ".datum/runs/r1/lane-state"')
    expect(cmd).toContain('\'{"task_id": "T1", "status": "completed"}\' > ".datum/runs/r1/lane-state/T1.json"')
  })
})

describe('actStartSteps', () => {
  const read = laneStateReadScript({ epicBranch: '$__eb', epicSlug: 'x', taskIdsSpace: '$(jq -r \'.topological_order[]\' "$__plan")' })

  // #524 dogfooding: `cat "$__plan"` embedded the full lane-plan.json
  // (potentially tens of KB, one entry per lane) inside the SAME combined
  // JSON blob as every other batched step. On a large plan (9 lanes,
  // ~30KB) this pushed the batch's own Bash-tool output past the harness's
  // inline-output truncation threshold — the agent then had no way to
  // relay content it never received in its own context, and burned its
  // remaining maxTurns trying to recover, producing no final answer at
  // all. The lane-plan is now read by a separate, dedicated Read-based
  // agent call (readLanePlanPrompt) instead of being folded into this
  // batch, so this batch's own output stays small regardless of plan size.
  it('datum-go: init, branch, timestamp, resolve, digest, digest-bytes, digest-sha, digest-cat, lane-state-read — the plan itself is never printed', () => {
    const steps = actStartSteps({ branch: 'init', lanePlanPath: null, laneStateReadScript: read })
    expect(names(steps)).toEqual(['bootstrap', 'branch', 'timestamp', 'resolve', 'digest', 'digest-bytes', 'digest-sha', 'digest-cat', 'lane-state-read'])
    expect(steps[0].command).toContain('datum init --json')
    expect(steps[0].tolerant).toBeFalsy()
    expect(steps[3].command).toContain('lane-plan-final.json')
    expect(steps[3].command).toContain('echo none')
    // digest: written to a temp file by the CLI; its stdout (the digest on
    // success, a JSON error on failure) is printed by this step ONLY on
    // failure — a `>/dev/null` here hid every CLI error behind a blank tail.
    expect(steps[4].command).toContain('__digest=$(mktemp)')
    expect(steps[4].command).toContain('__dout=$(datum lane-plan-digest --plan "$__plan" --out "$__digest")')
    expect(steps[4].command).toContain('if [ "$__drc" -ne 0 ]; then printf \'%s\' "$__dout"; fi')
    expect(steps[4].command).not.toContain('>/dev/null')
    expect(steps[5].command).toContain('wc -c < "$__digest"')
    expect(steps[6].command).toContain('git hash-object "$__digest"')
    expect(steps[7].command).toContain(`-le ${LANE_PLAN_DIGEST_BUDGET_BYTES}`)
    expect(steps[7].command).toContain('cat "$__digest"')
    expect(steps[7].command).toContain('echo DIGEST_TOO_LARGE')
    for (const s of steps) expect(s.command).not.toContain('cat "$__plan"')
    expect(steps[8].command).toContain('datum lane-state read --epic "$__eb"')
    expect(steps[8].command).toContain('.topological_order[]')
  })

  it('datum-tdd-act yolo: detects the branch instead of running init; explicit branch/plan skip both', () => {
    const detect = actStartSteps({ branch: 'detect', lanePlanPath: null, laneStateReadScript: read })
    expect(names(detect)).toEqual(['branch', 'timestamp', 'resolve', 'digest', 'digest-bytes', 'digest-sha', 'digest-cat', 'lane-state-read'])
    expect(detect[0].command).toContain('git rev-parse --abbrev-ref HEAD')
    const given = actStartSteps({ branch: 'datum/e', lanePlanPath: 'docs/epics/datum/e/lane-plan.json', laneStateReadScript: read })
    expect(given[0].command).toContain('__eb="datum/e"')
    expect(given[2].command).toContain('__plan="docs/epics/datum/e/lane-plan.json" && echo given')
  })

  it('the lane-state scripts are the fenced block only (no prose)', () => {
    expect(read.startsWith('OUT=')).toBe(true)
    expect(read).not.toContain('```')
    expect(read).not.toContain('Report which lanes')
    const write = laneStateWriteScript({ epicBranch: 'e', epicSlug: 's', runId: 'r', entriesJson: '[]' })
    expect(write.startsWith('MC=$(git rev-parse')).toBe(true)
    expect(write).not.toContain('```')
  })

  it('runs under bash for an explicit branch + plan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-actstart-'))
    try {
      writeFileSync(join(dir, 'plan.json'), '{"lanes":{},"topological_order":[]}')
      const steps = actStartSteps({ branch: 'datum/e', lanePlanPath: join(dir, 'plan.json'), laneStateReadScript: 'echo "{}"' })
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { encoding: 'utf8' }), steps)
      expect(r.failed).toBeNull()
      expect(stepStdout(r, 'branch')).toBe('datum/e')
      expect(stepStdout(r, 'timestamp')).toMatch(/^\d{8}-\d{6}\n$/)
      expect(stepResult(r, 'lane-state-read')?.stdout).toBe('{}\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// The lane plan is never relayed through an LLM turn in any form (a reader
// echo normalised "§4" → "§ 4", wf_6bfbd9f2-510; the base64 chunk relay was
// GENERATED past ~2.7 KB, wf_5791e11f-693). The scheduler runs on the compact
// digest `datum lane-plan-digest` writes; the batch relays that file's bytes
// and the script checks them against wc -c and git hash-object.
describe('lanePlanDigestFromSteps', () => {
  const digestObj = {
    schema_version: 1, lane_plan_sha: 'abc', total_lanes: 1, topological_order: ['T1'],
    lanes: { T1: { title: 'one — §4', files: ['src/a.py'], reads: [], depends_on: [], spec_hash: 'fnv1a64:0000000000000001' } },
  }
  const digestText = JSON.stringify(digestObj) + '\n'
  const bytes = utf8ByteLength(digestText)
  const sha = gitBlobSha(utf8Encode(digestText))
  type StepOut = string | { stdout?: string; exit_code?: number }
  const res = (over: Record<string, StepOut>) => {
    const merged: Record<string, StepOut> = { branch: 'e', timestamp: 't', resolve: 'default', digest: '', 'digest-bytes': `${bytes}\n`, 'digest-sha': `${sha}\n`, 'digest-cat': digestText, 'lane-state-read': '{}', ...over }
    return parseBatchResult(JSON.stringify(
      Object.entries(merged).map(([name, v]) => (typeof v === 'string' ? { name, exit_code: 0, stdout: v, stderr: '' } : { name, exit_code: v.exit_code ?? 0, stdout: v.stdout ?? '', stderr: '' })),
    ), actStartSteps({ branch: 'detect', lanePlanPath: null, laneStateReadScript: 'echo "{}"' }))
  }

  it('returns the parsed digest when bytes and blob sha match what the CLI wrote', () => {
    const r = lanePlanDigestFromSteps(res({}), 'docs/epics/e/lane-plan.json')
    expect(r.ok).toBe(true)
    expect(r.digest?.lanes.T1.spec_hash).toBe('fnv1a64:0000000000000001')
    expect(r.digest?.topological_order).toEqual(['T1'])
  })

  it('a normalised or truncated echo is lane_plan_digest_mismatch (bytes and sha both named)', () => {
    const r = lanePlanDigestFromSteps(res({ 'digest-cat': digestText.replace('§4', '§ 4') }), 'p')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^lane_plan_digest_mismatch: p .*expected \d+ bytes/)
  })

  it('a digest over the relay budget is lane_plan_digest_too_large, never chunked', () => {
    const r = lanePlanDigestFromSteps(res({ 'digest-bytes': `${LANE_PLAN_DIGEST_BUDGET_BYTES + 1}\n`, 'digest-cat': 'DIGEST_TOO_LARGE\n' }), 'p')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^lane_plan_digest_too_large: p is \d+ bytes/)
  })

  it('a failed digest step surfaces the CLI error (missing plan) as lane_plan_digest_failed', () => {
    const r = lanePlanDigestFromSteps(res({ digest: { exit_code: 1, stdout: '{"error": "lane plan not found: p"}' }, 'digest-bytes': '', 'digest-sha': '', 'digest-cat': '' }), 'p')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^lane_plan_digest_failed: .*lane plan not found/)
  })

  it('under real bash, a missing plan surfaces the CLI JSON error in lane_plan_digest_failed (needs datum on PATH)', () => {
    let hasDatum = true
    try { execFileSync('bash', ['-c', 'command -v datum'], { stdio: 'ignore' }) } catch { hasDatum = false }
    if (!hasDatum) return
    const steps = actStartSteps({ branch: 'datum/e', lanePlanPath: '/nonexistent/lane-plan.json', laneStateReadScript: 'echo "{}"' })
    const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { encoding: 'utf8' }), steps)
    const verdict = lanePlanDigestFromSteps(r, '/nonexistent/lane-plan.json')
    expect(verdict.ok).toBe(false)
    expect(verdict.error).toMatch(/lane_plan_digest_failed: .*lane plan not found: \/nonexistent\/lane-plan\.json/)
  })

  it('a missing batch is lane_plan_digest_failed', () => {
    const r = lanePlanDigestFromSteps(parseBatchResult(null, actStartSteps({ branch: 'detect', lanePlanPath: null, laneStateReadScript: 'x' })), 'p')
    expect(r.error).toMatch(/^lane_plan_digest_failed: /)
  })

  it('digestSpecHash returns the digest hash and throws when a lane has none', () => {
    expect(digestSpecHash(digestObj as unknown as LanePlanDigest, 'T1')).toBe('fnv1a64:0000000000000001')
    expect(() => digestSpecHash({ ...digestObj, lanes: { T1: { title: 'x', files: [] } } } as unknown as LanePlanDigest, 'T1')).toThrow(/spec_hash/)
    expect(() => digestSpecHash(digestObj as unknown as LanePlanDigest, 'T9')).toThrow(/T9/)
  })
})

// Each lane's full spec becomes a FILE in its worktree: one intake step runs
// `datum lane-spec-export`, which writes <wt>/.datum/lane-spec.json, checks
// the lane against the digest's spec_hash, and prints only short fields. No
// LLM turn relays the criteria (the runner rewrote backticks as \` — elonchesd
// run wf_47c507cf-1e5); the stage agents read the file and witness the read.
describe('laneIntakeSteps lane-spec export + laneSpecFromSteps', () => {
  const laneSpec = { planPath: '/wt/T1/.datum/lane-plan.json', taskId: 'T1', outPath: '/wt/T1/.datum/lane-spec.json', expectHash: 'fnv1a64:0000000000000001' }
  const summary = { task_id: 'T1', path: '/wt/T1/.datum/lane-spec.json', bytes: 412, sha: 'a'.repeat(40), spec_hash: 'fnv1a64:0000000000000001', ac_count: 2 }

  it('prepends one tolerant lane-spec step that runs datum lane-spec-export with the digest hash', () => {
    const steps = laneIntakeSteps({
      wt: '/wt/T1', epicBranch: 'e', completionPath: null, structural: true, cleanupCmd: null,
      planSkeletonPath: '', skeletonCmd: '', preflightPath: '', laneSpec,
    })
    expect(names(steps).slice(0, 3)).toEqual(['lane-spec', 'lane-spec-bytes', 'lane-spec-sha'])
    expect(steps[0].command).toBe('datum lane-spec-export --plan "/wt/T1/.datum/lane-plan.json" --task "T1" --out "/wt/T1/.datum/lane-spec.json" --expect-hash "fnv1a64:0000000000000001"')
    // The written file is re-measured in bash so the echoed summary cannot lie about it.
    expect(steps[1].command).toBe(`wc -c < "/wt/T1/.datum/lane-spec.json" | tr -d ' '`)
    expect(steps[2].command).toBe('git hash-object "/wt/T1/.datum/lane-spec.json"')
    for (const st of steps.slice(0, 3)) expect(st.tolerant).toBe(true)
    expect(steps.map((s) => s.command).join('\n')).not.toMatch(/jq/)
  })

  it('refuses a task id or hash that is not a plain identifier (shell interpolation guard)', () => {
    expect(() => laneSpecExportCommand({ ...laneSpec, taskId: 'T1; rm -rf /' })).toThrow(/plain identifier/)
    expect(() => laneSpecExportCommand({ ...laneSpec, expectHash: '$(x)' })).toThrow(/plain/)
  })

  const OUT = '/wt/T1/.datum/lane-spec.json'
  const res = (stdout: string, exit = 0, disk: { bytes?: string; sha?: string } = {}) => parseBatchResult(JSON.stringify([
    { name: 'lane-spec', exit_code: exit, stdout, stderr: '' },
    { name: 'lane-spec-bytes', exit_code: 0, stdout: disk.bytes ?? '412\n', stderr: '' },
    { name: 'lane-spec-sha', exit_code: 0, stdout: disk.sha ?? 'a'.repeat(40) + '\n', stderr: '' },
    { name: 'history', exit_code: 0, stdout: '', stderr: '' },
  ]), [{ name: 'lane-spec', command: '' }, { name: 'lane-spec-bytes', command: '' }, { name: 'lane-spec-sha', command: '' }, { name: 'history', command: '' }])

  it('returns the short summary (path, bytes, blob sha, ac_count) — never the criteria', () => {
    const r = laneSpecFromSteps(res(JSON.stringify(summary) + '\n'), 'T1', OUT)
    expect(r.ok).toBe(true)
    expect(r.spec).toEqual(summary)
    expect(r.error).toBe('')
  })

  it('laneSpecContextFile is the deferred ContextFile the witness helpers consume', () => {
    expect(laneSpecContextFile(summary)).toEqual({ path: summary.path, exists: true, inlined: false, bytes: 412, sha: 'a'.repeat(40), content: null })
  })

  it("the CLI's named errors (hash mismatch, missing lane) surface verbatim as lane_spec_export_failed", () => {
    const r = laneSpecFromSteps(res('{"error":"lane_spec_hash_mismatch: T1 hashes to fnv1a64:2 but the digest says fnv1a64:1; the plan changed between digest and intake","spec_hash":"fnv1a64:2","expected":"fnv1a64:1"}\n', 1), 'T1', OUT)
    expect(r.ok).toBe(false)
    expect(r.spec).toBeNull()
    expect(r.error).toMatch(/^lane_spec_export_failed: T1 — lane_spec_hash_mismatch: T1 hashes to fnv1a64:2/)
    expect(laneSpecFromSteps(res('{"error":"lane_spec_missing: T9 is not in the lane plan"}\n', 1), 'T9', OUT).error).toMatch(/^lane_spec_export_failed: T9 — lane_spec_missing: T9/)
  })

  it('a missing batch or a step that never ran is lane_spec_export_failed', () => {
    expect(laneSpecFromSteps(parseBatchResult(null, [{ name: 'lane-spec', command: '' }]), 'T1', OUT).error).toMatch(/^lane_spec_export_failed: T1/)
    const noStep = parseBatchResult(JSON.stringify([{ name: 'history', exit_code: 0, stdout: '', stderr: '' }]), [{ name: 'lane-spec', command: '' }, { name: 'history', command: '' }])
    expect(laneSpecFromSteps(noStep, 'T1', OUT).error).toMatch(/^lane_spec_export_failed: T1/)
  })

  it('a summary the runner rewrote (wrong task, bad sha, non-numeric bytes) is lane_spec_export_unparseable', () => {
    for (const bad of [
      { ...summary, task_id: 'T2' },
      { ...summary, sha: 'abc' },
      { ...summary, bytes: 'many' },
      { ...summary, ac_count: -1 },
      { ...summary, path: '' },
    ]) {
      const r = laneSpecFromSteps(res(JSON.stringify(bad) + '\n'), 'T1', OUT)
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/^lane_spec_export_unparseable: T1/)
    }
    expect(laneSpecFromSteps(res(JSON.stringify({ ...summary, path: '/elsewhere/lane-spec.json' }) + '\n'), 'T1', OUT).error).toMatch(/^lane_spec_export_unparseable: T1 — path is/)
    expect(laneSpecFromSteps(res('not json'), 'T1', OUT).error).toMatch(/^lane_spec_export_unparseable: T1/)
  })

  it('a summary whose bytes or sha disagree with what bash measured on disk is lane_spec_relay_mismatch', () => {
    const text = JSON.stringify(summary) + '\n'
    expect(laneSpecFromSteps(res(text, 0, { bytes: '413\n' }), 'T1', OUT).error).toMatch(/^lane_spec_relay_mismatch: T1 — the summary says 412 bytes/)
    expect(laneSpecFromSteps(res(text, 0, { sha: 'b'.repeat(40) + '\n' }), 'T1', OUT).error).toMatch(/^lane_spec_relay_mismatch: T1/)
    expect(laneSpecFromSteps(res(text, 0, { bytes: '' }), 'T1', OUT).ok).toBe(false)
  })
})

describe('laneIntakeSteps properties probe + propertiesFromSteps (#493 — the skeptic panel needs PROPERTIES.md)', () => {
  const opts = {
    wt: '/wt/T1', epicBranch: 'datum/e', completionPath: null, structural: true, cleanupCmd: null,
    planSkeletonPath: '', skeletonCmd: '', preflightPath: '',
  }

  it('adds three tolerant properties- steps when properties is given, none when omitted', () => {
    const withProps = laneIntakeSteps({ ...opts, properties: { epicBranch: 'datum/e' } })
    expect(names(withProps)).toEqual(['properties-bytes', 'properties-sha', 'properties-cat', 'history'])
    for (const s of withProps.slice(0, 3)) expect(s.tolerant).toBe(true)
    expect(names(laneIntakeSteps(opts))).toEqual(['history'])
  })

  it('does not add a second batch — one laneIntakeSteps call carries both lane-spec and properties steps', () => {
    const laneSpec = { planPath: '/wt/T1/.datum/lane-plan.json', taskId: 'T1', outPath: '/wt/T1/.datum/lane-spec.json', expectHash: 'fnv1a64:0000000000000001' }
    const steps = laneIntakeSteps({ ...opts, laneSpec, properties: { epicBranch: 'datum/e' } })
    expect(names(steps)).toEqual(['lane-spec', 'lane-spec-bytes', 'lane-spec-sha', 'properties-bytes', 'properties-sha', 'properties-cat', 'history'])
  })

  // Worktree-relative, like laneSpecContextFile's absolute /wt/T1/... path —
  // NOT repo-root-relative. The batch's cwd is the ROOT checkout
  // (setBatchRoot(cfg.repoRoot)), not guaranteed to be on the epic branch
  // while a lane runs; wt IS that lane's checkout of the epic branch.
  const propPath = '/wt/T1/docs/epics/datum/e/PROPERTIES.md'
  const stepsRes = (bytesOut: string, shaOut: string, catOut: string) => parseBatchResult(JSON.stringify([
    { name: 'properties-bytes', exit_code: 0, stdout: bytesOut, stderr: '' },
    { name: 'properties-sha', exit_code: 0, stdout: shaOut, stderr: '' },
    { name: 'properties-cat', exit_code: 0, stdout: catOut, stderr: '' },
  ]), [{ name: 'properties-bytes', command: '' }, { name: 'properties-sha', command: '' }, { name: 'properties-cat', command: '' }])

  it('returns null (absent) when PROPERTIES.md does not exist', () => {
    expect(propertiesFromSteps(stepsRes('-1', '', '__DATUM_PROPERTIES_DEFERRED__'), 'datum/e', '/wt/T1')).toBeNull()
  })

  it('returns an inlined ContextFile when the cat content byte- and sha-verifies', () => {
    const content = '## Correctness\nsome invariant text\n'
    const sha = gitBlobSha(utf8Encode(content))
    const r = propertiesFromSteps(stepsRes(String(utf8ByteLength(content)), sha, content), 'datum/e', '/wt/T1')
    expect(r).toEqual({ path: propPath, exists: true, inlined: true, bytes: utf8ByteLength(content), sha, content })
  })

  it('returns a deferred ContextFile (content null) when the cat step reports the over-budget marker', () => {
    const bigBytes = 20000
    const r = propertiesFromSteps(stepsRes(String(bigBytes), 'deadbeef', '__DATUM_PROPERTIES_DEFERRED__'), 'datum/e', '/wt/T1')
    expect(r).toEqual({ path: propPath, exists: true, inlined: false, bytes: bigBytes, sha: 'deadbeef', content: null })
  })

  it('defers instead of trusting content whose relayed bytes disagree with the probe (in-transit corruption)', () => {
    const r = propertiesFromSteps(stepsRes('9999', 'deadbeef', 'short'), 'datum/e', '/wt/T1')
    expect(r).toEqual({ path: propPath, exists: true, inlined: false, bytes: 9999, sha: 'deadbeef', content: null })
  })
})

describe('closeoutCollectSteps (#368 follow-up — deterministic closeout collect)', () => {
  it('produces one step per collector, in order, all tolerant, no || true / 2>/dev/null swallowing', () => {
    const steps = closeoutCollectSteps({ runId: 'r1' })
    expect(names(steps)).toEqual([
      'branch', 'timestamp', 'base-sha', 'merge-sha', 'config',
      'mkdir', 'changelog-owner', 'preserve-current-state',
      'collect-git', 'collect-tasks', 'collect-token-metrics', 'collate', 'data-exists',
    ])
    // caliper BUG U: a CHANGELOG.md owned by release-please must not get a
    // hand-authored section; the script reads the owner from this step.
    const owner = steps.find((s) => s.name === 'changelog-owner')!
    expect(owner.command).toContain('release-please-config.json')
    expect(owner.command).toContain('managed by release-please')
    expect(owner.command).toMatch(/echo release-please/)
    expect(owner.command).toMatch(/echo datum/)
    // An UNTRACKED root CURRENT_STATE.md (a previous closeout's artifact git
    // never had) was overwritten and lost: moved aside first, never clobbered.
    const keep = steps.find((s) => s.name === 'preserve-current-state')!
    expect(keep.command).toContain('git ls-files CURRENT_STATE.md')
    expect(keep.command).toContain('mv CURRENT_STATE.md "CURRENT_STATE.$__rid.prev.md"')
    for (const s of steps) expect(s.tolerant).toBe(true)
    for (const s of steps) {
      expect(s.command).not.toMatch(/\|\|\s*true\b/)
      expect(s.command).not.toContain('2>/dev/null')
    }
  })

  // Same class as the main-sync hard-code (be0cd7fc): a repo with no origin
  // or a master default has no origin/main, so collect-git had no base.
  it('resolves the base branch (origin/HEAD, origin/main|master, local main|master) instead of hard-coding origin/main', () => {
    const base = closeoutCollectSteps({ runId: 'r1' }).find((s) => s.name === 'base-sha')!
    expect(base.command).not.toContain('merge-base HEAD origin/main')
    // The epic's recorded parent first (`datum epic-base`, elonchesd: a chained
    // epic diffed against master re-reviewed its whole parent epic), then the
    // shell chain when the CLI is unavailable.
    expect(base.command).toContain('datum epic-base --json')
    expect(base.command).toContain('.source // empty')
    expect(base.command).toContain('git symbolic-ref --short refs/remotes/origin/HEAD')
    expect(base.command).toContain('refs/remotes/origin/$b')
    expect(base.command).toContain('refs/heads/$b')
    expect(base.command).toContain('__base=$(git merge-base HEAD "$BASE")')
  })

  it('under real git with no remote and a master default, base-sha resolves to the merge-base with master', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-closeout-base-'))
    try {
      execFileSync('git', ['init', '-q', '-b', 'master'], { cwd: dir })
      execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: dir })
      const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
      execFileSync('git', ['checkout', '-q', '-b', 'datum/e'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'work'], { cwd: dir })
      const step = closeoutCollectSteps({ runId: 'r1' }).find((s) => s.name === 'base-sha')!
      const out = execFileSync('bash', ['-c', batchScript([step])], { cwd: dir, encoding: 'utf8' })
      expect(stepStdout(parseBatchResult(out, [step]), 'base-sha')?.trim()).toBe(baseSha)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // #482 — an epic branched from `dev` (far ahead of main) had no recorded
  // epic-base, so base-sha fell straight to merge-base with origin/main and
  // closeout reported 513 commits / +51K LOC for an ~80-commit epic. The
  // ticket commit — the first commit that added docs/epics/<eb>/TICKET.md —
  // is a deterministic middle rung: its parent is the epic's real start.
  it('falls back to the ticket commit\'s parent (not merge-base) when datum epic-base is unset', () => {
    const base = closeoutCollectSteps({ runId: 'r1' }).find((s) => s.name === 'base-sha')!
    expect(base.command).toContain('docs/epics/')
    expect(base.command).toContain('TICKET.md')
    expect(base.command).toContain('--diff-filter=A')
    expect(base.command).toMatch(/\^/) // parent-of-ticket-commit syntax
  })

  it('under real git, the ticket-commit fallback resolves to the parent of the commit that added TICKET.md, not merge-base with main', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-closeout-ticket-'))
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
      execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'root'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'more main work'], { cwd: dir })
      // dev, far ahead of main
      execFileSync('git', ['checkout', '-q', '-b', 'dev'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'dev drift 1'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'dev drift 2'], { cwd: dir })
      const wantedBase = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
      execFileSync('git', ['checkout', '-q', '-b', 'datum/e'], { cwd: dir })
      mkdirSync(join(dir, 'docs', 'epics', 'datum', 'e'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'epics', 'datum', 'e', 'TICKET.md'), '# ticket\n')
      execFileSync('git', ['add', '.'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'ticket(datum/e): add ticket'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'epic work'], { cwd: dir })
      const step = closeoutCollectSteps({ runId: 'r1' }).find((s) => s.name === 'base-sha')!
      const out = execFileSync('bash', ['-c', batchScript([step])], { cwd: dir, encoding: 'utf8' })
      expect(stepStdout(parseBatchResult(out, [step]), 'base-sha')?.trim()).toBe(wantedBase)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a ticket commit older than the merge-base floor and falls back (with a warning) instead of undershooting it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-closeout-old-ticket-'))
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
      execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'root'], { cwd: dir })
      // TICKET.md already existed on main, from an earlier (e.g. abandoned)
      // attempt — the commit that added it is an ancestor of the eventual
      // fork point, so its parent is older than any sound base.
      mkdirSync(join(dir, 'docs', 'epics', 'datum', 'e'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'epics', 'datum', 'e', 'TICKET.md'), '# ticket\n')
      execFileSync('git', ['add', '.'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'ticket(datum/e): add ticket'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'more main work after the ticket commit'], { cwd: dir })
      const forkPoint = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
      execFileSync('git', ['checkout', '-q', '-b', 'datum/e'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'epic work'], { cwd: dir })
      const step = closeoutCollectSteps({ runId: 'r1' }).find((s) => s.name === 'base-sha')!
      const out = execFileSync('bash', ['-c', batchScript([step])], { cwd: dir, encoding: 'utf8' })
      const got = stepStdout(parseBatchResult(out, [step]), 'base-sha')?.trim()
      // The ticket commit's parent (root) predates the merge-base with main
      // (forkPoint) — rejected. Fallback rung wins: merge-base(HEAD, main) == forkPoint.
      expect(got).toBe(forkPoint)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the base-sha script guards the ticket rung with a merge-base ancestor check before trusting it', () => {
    const base = closeoutCollectSteps({ runId: 'r1' }).find((s) => s.name === 'base-sha')!
    expect(base.command).toContain('git merge-base --is-ancestor "$__mb" "$__tparent"')
  })

  it('sets a base_sha_fallback warning only when the merge-base fallback (not the recorded or ticket base) is used', () => {
    const base = closeoutCollectSteps({ runId: 'r1' }).find((s) => s.name === 'base-sha')!
    expect(base.command).toContain('base_sha_fallback: merge-base with')
    const collectGit = closeoutCollectSteps({ runId: 'r1' }).find((s) => s.name === 'collect-git')!
    expect(collectGit.command).toContain('--warning "${__base_warning:-}"')
  })

  it('uses the given runId verbatim instead of generating a fresh timestamp', () => {
    const steps = closeoutCollectSteps({ runId: 'r1' })
    const ts = steps.find((s) => s.name === 'timestamp')!
    expect(ts.command).toContain('r1')
    expect(ts.command).not.toContain('date +%Y%m%d')
  })

  it('generates a run id via date(1) only when none is given', () => {
    const steps = closeoutCollectSteps({ runId: '' })
    const ts = steps.find((s) => s.name === 'timestamp')!
    expect(ts.command).toContain('date +%Y%m%d-%H%M%S')
  })

  it('honours branchHint instead of shelling out to git rev-parse', () => {
    const withHint = closeoutCollectSteps({ runId: 'r1', branchHint: 'datum/e' })
    expect(withHint[0].command).toContain('datum/e')
    expect(withHint[0].command).not.toContain('git rev-parse --abbrev-ref')
    const withoutHint = closeoutCollectSteps({ runId: 'r1' })
    expect(withoutHint[0].command).toContain('git rev-parse --abbrev-ref HEAD')
  })

  it('each collector references the run id and prior shas through shell state, not literals baked at call time', () => {
    const steps = closeoutCollectSteps({ runId: 'r1' })
    const byName = (n: string) => steps.find((s) => s.name === n)!.command
    expect(byName('mkdir')).toContain('$__rid')
    expect(byName('collect-git')).toContain('closeout-collect-git')
    expect(byName('collect-git')).toContain('$__rid')
    expect(byName('collect-git')).toContain('$__base')
    expect(byName('collect-git')).toContain('$__merge')
    expect(byName('collect-tasks')).toContain('closeout-collect-tasks')
    expect(byName('collect-tasks')).toContain('$__rid')
    expect(byName('collect-token-metrics')).toContain('closeout-collect-token-metrics')
    expect(byName('collate')).toContain('closeout-collate')
    expect(byName('collate')).toContain('$__merge')
    expect(byName('data-exists')).toContain('closeout-data.json')
    expect(byName('data-exists')).toContain('$__rid')
  })

  it('runs under bash and reports data-exists=no when collate never wrote the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-closeout-'))
    try {
      const steps = closeoutCollectSteps({ runId: 'r1' })
      // Replace the real `datum` collector calls with no-ops so this runs
      // without the CLI installed — this test is about the shell plumbing
      // (var threading, mkdir, data-exists check), not the collectors.
      // Patched BEFORE batchScript: the wrapper hashes the script it emits,
      // so editing the emitted text would read as a runner transcription error.
      const patched = steps.map((s) => ({ ...s, command: s.command.replace(/datum closeout-collect[a-z-]*[^\n]*/g, 'true') }))
      const script = batchScript(patched)
      const r = parseBatchResult(
        execFileSync('bash', ['-c', `cd ${JSON.stringify(dir)} && git init -q && git commit --allow-empty -q -m x && ${script}`], { encoding: 'utf8' }),
        steps,
      )
      expect(r.failed).toBeNull()
      expect(stepStdout(r, 'timestamp')).toBe('r1')
      expect(stepStdout(r, 'data-exists')).toBe('no\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Closeout archive: the old flow appended a shell block to the SYNTHESIZE
// agent's own prompt — `2>/dev/null || true` on tag/archive swallowed
// failures invisibly, and `git add -A && git commit` in the ROOT checkout
// risked committing the operator's unrelated WIP (policy: root-checkout
// commits stage only their own paths, see shared/agents.ts commitStage
// `scope: 'allowed-only'` and commit 3bb2211). Archiving is now its own
// deterministic batch: tag, archive, one `git mv` per pipeline artifact,
// then a commit gated on `git diff --cached --quiet` (never `add -A`).
// ---------------------------------------------------------------------------

describe('closeoutArchiveSteps', () => {
  const opts = { runId: 'r1', branch: 'datum/e', epicDir: 'docs/epics/datum/e' }

  it('tags, archives, moves every pipeline artifact via git mv, then commits and reads the sha — all tolerant', () => {
    const steps = closeoutArchiveSteps(opts)
    expect(names(steps)).toEqual([
      'file-followups', 'tag', 'archive',
      'move-spec-md', 'move-tasks-md', 'move-questions-md', 'move-properties-md', 'move-ticket-md',
      'move-tasks-json', 'move-lane-plan-json',
      'commit', 'commit-sha',
    ])
    expect(steps.every((s) => s.tolerant)).toBe(true)
  })

  it('tags HEAD with epic/<branch>/<runId>, no || true and no 2>/dev/null anywhere', () => {
    const steps = closeoutArchiveSteps(opts)
    expect(steps[0].command).toBe('datum closeout-file-followups --run-id "r1"')
    expect(steps[1].command).toBe('git tag "epic/datum/e/r1" HEAD')
    for (const s of steps) {
      expect(s.command).not.toMatch(/\|\|\s*true\b/)
      expect(s.command).not.toContain('2>/dev/null')
    }
  })

  it('runs datum closeout-archive with the run id', () => {
    const steps = closeoutArchiveSteps(opts)
    expect(steps[2].command).toBe('datum closeout-archive --run-id "r1"')
  })

  it('moves each root artifact into the epic dir via git mv when present, ABSENT otherwise', () => {
    const steps = closeoutArchiveSteps(opts)
    const spec = steps.find((s) => s.name === 'move-spec-md')!
    expect(spec.command).toBe(
      // caliper BUG V: a stale root artifact from an OLDER epic must not be
      // moved over this epic's file (git mv: "destination exists", exit 128).
      'if [ -f "SPEC.md" ]; then if [ -e "docs/epics/datum/e/SPEC.md" ]; then echo "KEPT_ROOT: docs/epics/datum/e/SPEC.md exists, root SPEC.md is not this epic\'s, left in place"; else mkdir -p "docs/epics/datum/e" && git mv "SPEC.md" "docs/epics/datum/e/SPEC.md"; fi; else echo ABSENT; fi',
    )
    const tasksJson = steps.find((s) => s.name === 'move-tasks-json')!
    expect(tasksJson.command).toContain('git mv "tasks.json" "docs/epics/datum/e/tasks.json"')
  })

  it('under real git, a root TASKS.md whose epic-scoped destination already exists is kept in place and reported, not a git fatal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-archive-keep-'))
    try {
      execFileSync('git', ['init', '-q', '-b', 'datum/e'], { cwd: dir })
      execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: dir })
      mkdirSync(join(dir, 'docs/epics/datum/e'), { recursive: true })
      writeFileSync(join(dir, 'TASKS.md'), '# stale, from an older epic\n')
      writeFileSync(join(dir, 'docs/epics/datum/e/TASKS.md'), '# this epic\n')
      writeFileSync(join(dir, 'SPEC.md'), '# spec\n')
      execFileSync('git', ['add', '.'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base'], { cwd: dir })
      const steps = closeoutArchiveSteps({ runId: 'r1', branch: 'datum/e', epicDir: 'docs/epics/datum/e' }).filter((s) => s.name.startsWith('move-'))
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps)
      expect(stepResult(r, 'move-tasks-md')?.exit_code).toBe(0)
      expect(stepStdout(r, 'move-tasks-md')).toMatch(/^KEPT_ROOT: docs\/epics\/datum\/e\/TASKS\.md exists/)
      expect(stepResult(r, 'move-spec-md')?.exit_code).toBe(0)
      expect(existsSync(join(dir, 'docs/epics/datum/e/SPEC.md'))).toBe(true)
      expect(existsSync(join(dir, 'TASKS.md'))).toBe(true)
      expect(readFileSync(join(dir, 'docs/epics/datum/e/TASKS.md'), 'utf8')).toBe('# this epic\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads lane-plan.json from .datum, not the repo root', () => {
    const steps = closeoutArchiveSteps(opts)
    const lp = steps.find((s) => s.name === 'move-lane-plan-json')!
    expect(lp.command).toContain('if [ -f ".datum/lane-plan.json" ]')
    expect(lp.command).toContain('git mv ".datum/lane-plan.json" "docs/epics/datum/e/lane-plan.json"')
  })

  it('commits ONLY what was staged by the moves above — never git add -A', () => {
    const steps = closeoutArchiveSteps(opts)
    const commit = steps.find((s) => s.name === 'commit')!
    expect(commit.command).not.toContain('add -A')
    expect(commit.command).not.toContain('git add')
    expect(commit.command).toBe(
      'git diff --cached --quiet || git commit -m "closeout(r1): archive pipeline artifacts to docs/epics/datum/e"',
    )
    const sha = steps.find((s) => s.name === 'commit-sha')!
    expect(sha.command).toBe('git rev-parse --short HEAD')
  })
})

// ---------------------------------------------------------------------------
// The lane plan is now relayed byte-faithfully via the CHUNKED context relay
// (shared/context-relay.ts), never by an LLM `reader` agent echo — see the
// elonchesd wf_6bfbd9f2-510 write-up on actStartSteps' plan-bytes/plan-sha
// steps above. These two steps carry the byte count and git blob hash the
// chunked relay needs, using the batch's own $__plan (no second probe).
// ---------------------------------------------------------------------------

describe('ownershipFromStdout fails closed when the diff step did not run', () => {
  it('a null/undefined step result is ownership_check_failed, never ok', () => {
    for (const raw of [null, undefined]) {
      const r = ownershipFromStdout(raw, ['src/a.py'], ['tests/test_a.py'])
      expect(r.ok).toBe(false)
      expect(r.violations.join(' ')).toMatch(/ownership_check_failed/)
    }
  })

  it('an empty diff (step ran, nothing changed) is still a clean pass', () => {
    const r = ownershipFromStdout('', ['src/a.py'], ['tests/test_a.py'])
    expect(r.ok).toBe(true)
  })
})


// elonchesd wf_a979f3d8-f0c task-013: the TS/JS placeholder pattern was the
// bare token `throw new Error`, so a guard clause inside a real test
// (`if (!app) throw new Error('test setup failed')`) next to expect() calls
// failed RED as placeholder_assertions. The placeholder is the skeleton's
// literal throw, not any throw.
describe('postRedSteps assert-check matches the skeleton placeholder, not any throw', () => {
  const grep = 'throw new Error\\(.RED agent: implement this assertion.\\)'
  // The same patterns datum-tdd-act-lane.ts uses; run with the real ast-grep
  // when present (its verdict is trusted now) and without it.
  const sgPatterns = [
    { pattern: "throw new Error('RED agent: implement this assertion')", name: 'skeleton placeholder', grep },
    { pattern: 'expect(true).toBe(false)', name: 'forced failure' },
  ]
  function run(dir: string, content: string): string {
    writeFileSync(join(dir, 'router.test.ts'), content)
    const steps = postRedSteps({ wt: dir, testFiles: ['router.test.ts'], acCount: 0, testFuncDiffRegex: 'x', sgPatterns, testFuncBodyRegex: 'x', testFuncGrepRegex: 'x', ownership: false, verifyTestCmd: null, baseRef: '' })
    const step = steps.find((s) => s.name === 'assert-check')!
    const out = execFileSync('bash', ['-c', batchScript([step])], { cwd: dir, encoding: 'utf8' })
    return (stepStdout(parseBatchResult(out, [step]), 'assert-check') || '').trim()
  }
  it('a guard throw beside real expect() calls is not a placeholder; the untouched skeleton throw is', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-placeholder-'))
    try {
      expect(run(dir, "it('mounts', () => {\n  const app = document.querySelector('#app')\n  if (!app) throw new Error('test setup failed: #app not found')\n  expect(app.children.length).toBe(1)\n})\n")).toBe('')
      expect(run(dir, "it('x', async () => {\n    // Assert\n    throw new Error('RED agent: implement this assertion');\n});\n")).toMatch(/RED agent: implement this assertion/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// caliper eedom wf_0837ad8b-e5f task-005: assert-check reported
// `raise NotImplementedError` at a line the RED commit never touched — inside
// a textwrap.dedent("""...""") string of Python source a pre-existing test
// feeds to the indexer. The scan must cover only the lines the lane ADDED
// since its base, and never the inside of a multi-line string.
describe('postRedSteps assert-check scans only the lane\'s added lines, outside multi-line strings', () => {
  function initRepo(): { dir: string; git: (...a: string[]) => string } {
    const dir = mkdtempSync(join(tmpdir(), 'datum-assert-added-'))
    const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    git('init', '-q', '-b', 'main')
    git('config', 'core.hooksPath', '/dev/null')
    git('config', 'user.email', 't@t')
    git('config', 'user.name', 't')
    mkdirSync(join(dir, 'tests'))
    writeFileSync(join(dir, 'tests', 'test_a.py'), [
      'import textwrap',
      '',
      'def test_kind():',
      '    src = textwrap.dedent("""',
      '        def f():',
      '            raise NotImplementedError',
      '    """)',
      '    assert kind(src) == "stub"',
      '',
      'def test_old_stub():',
      '    raise NotImplementedError',
      '',
    ].join('\n'))
    git('add', '-A'); git('commit', '-q', '-m', 'base')
    git('checkout', '-q', '-b', 'lane')
    return { dir, git }
  }
  const sgPatterns = [{ pattern: 'raise NotImplementedError', name: 'raise NotImplementedError' }]
  // Both with ast-grep on the PATH and without it (the grep fallback is what
  // eedom ran: the halt text was grep -n output).
  function run(dir: string, sg: boolean): string {
    const steps = postRedSteps({ wt: dir, testFiles: ['tests/test_a.py'], acCount: 0, testFuncDiffRegex: 'x', sgPatterns, testFuncBodyRegex: 'x', testFuncGrepRegex: 'x', ownership: false, verifyTestCmd: null, baseRef: 'main' })
    const step = steps.find((s) => s.name === 'assert-check')!
    const out = execFileSync('bash', ['-c', (sg ? '' : 'PATH=/usr/bin:/bin\n') + batchScript([step])], { cwd: dir, encoding: 'utf8' })
    return (stepStdout(parseBatchResult(out, [step]), 'assert-check') || '').trim()
  }
  it('a sound RED that only appends real tests is clean, whatever the file already held', () => {
    const { dir, git } = initRepo()
    try {
      appendFileSync(join(dir, 'tests', 'test_a.py'), 'def test_new():\n    assert compute(2) == 4\n')
      git('add', '-A'); git('commit', '-q', '-m', 'red')
      expect(run(dir, true)).toBe('')
      expect(run(dir, false)).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('a placeholder the lane added is reported at its line in the original file, the pre-existing ones are not', () => {
    const { dir, git } = initRepo()
    try {
      appendFileSync(join(dir, 'tests', 'test_a.py'), 'def test_p():\n    raise NotImplementedError\n')
      git('add', '-A'); git('commit', '-q', '-m', 'red')
      for (const sg of [true, false]) {
        const out = run(dir, sg)
        expect(out, `ast-grep on PATH: ${sg}`).toContain('tests/test_a.py:13:')
        expect(out, `ast-grep on PATH: ${sg}`).not.toMatch(/:6:|:11:/)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('without a base the whole file is scanned, still skipping multi-line strings', () => {
    const { dir } = initRepo()
    try {
      const steps = postRedSteps({ wt: dir, testFiles: ['tests/test_a.py'], acCount: 0, testFuncDiffRegex: 'x', sgPatterns, testFuncBodyRegex: 'x', testFuncGrepRegex: 'x', ownership: false, verifyTestCmd: null, baseRef: null })
      const step = steps.find((s) => s.name === 'assert-check')!
      // grep fallback only: ast-grep parses Python and already ignores a string literal.
      const out = (stepStdout(parseBatchResult(execFileSync('bash', ['-c', 'PATH=/usr/bin:/bin\n' + batchScript([step])], { cwd: dir, encoding: 'utf8' }), [step]), 'assert-check') || '').trim()
      expect(out).toContain('tests/test_a.py:11:')
      expect(out).not.toMatch(/:6:/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// caliper (wf_0837ad8b-e5f follow-up): ast-grep exits 1 for "no match" AND
// for every error, so `ast-grep ... || grep ...` fell back to grep on every
// clean file — ast-grep's parse-aware verdict was never trusted, and the grep
// fallback was the effective checker on every run. The chain now trusts
// ast-grep when it is on the PATH and wrote nothing to stderr; grep runs
// only when it is absent or errored.
describe('postRedSteps assert-check trusts ast-grep\'s "no match"; grep runs only when ast-grep is absent or errored', () => {
  const sgPatterns = [{ pattern: 'raise NotImplementedError', name: 'raise NotImplementedError' }]
  function scan(fakeAstGrep: string | null): string {
    const dir = mkdtempSync(join(tmpdir(), 'datum-sg-trust-'))
    try {
      mkdirSync(join(dir, 'tests'))
      writeFileSync(join(dir, 'tests', 'test_a.py'), 'def test_p():\n    raise NotImplementedError\n')
      let pathPrefix = ''
      if (fakeAstGrep !== null) {
        mkdirSync(join(dir, 'bin'))
        writeFileSync(join(dir, 'bin', 'ast-grep'), `#!/bin/bash\n${fakeAstGrep}\n`, { mode: 0o755 })
        pathPrefix = `PATH=${dir}/bin:/usr/bin:/bin\n`
      } else {
        pathPrefix = 'PATH=/usr/bin:/bin\n'
      }
      const steps = postRedSteps({ wt: dir, testFiles: ['tests/test_a.py'], acCount: 0, testFuncDiffRegex: 'x', sgPatterns, testFuncBodyRegex: 'x', testFuncGrepRegex: 'x', ownership: false, verifyTestCmd: null, baseRef: null })
      const step = steps.find((s) => s.name === 'assert-check')!
      const out = execFileSync('bash', ['-c', pathPrefix + batchScript([step])], { cwd: dir, encoding: 'utf8' })
      return (stepStdout(parseBatchResult(out, [step]), 'assert-check') || '').trim()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  it('ast-grep present, silent, exit 1 (no match): its verdict stands, grep does not run', () => {
    expect(scan('exit 1')).toBe('')
  })
  it('ast-grep present and reporting a match: the hit is reported against the original path', () => {
    expect(scan('printf "%s:2:    raise NotImplementedError\\n" "$3"; exit 0')).toBe('tests/test_a.py:2:    raise NotImplementedError')
  })
  it('ast-grep present but errored (stderr): grep fallback reports the line', () => {
    expect(scan('echo "ERROR: cannot parse" >&2; exit 1')).toBe('tests/test_a.py:2:    raise NotImplementedError')
  })
  it('ast-grep absent: grep fallback reports the line', () => {
    expect(scan(null)).toBe('tests/test_a.py:2:    raise NotImplementedError')
  })
})

// caliper eedom wf_fa38ac24-890 task-005: four untracked scratch test files
// left in the lane worktree by an earlier stage's agent (repro files) were
// collected by the REFACTOR test run; two monkeypatched os.chdir and a later
// test failed deterministically, so REFACTOR reported "blocked" on a pristine
// GREEN commit. Every stage commits its work; anything untracked between
// stages is a stray. It is listed by name, removed, and named in the log.
describe('strayCleanSteps — untracked files between stages are strays: listed, removed, named', () => {
  function initRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'datum-stray-'))
    const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    git('init', '-q')
    git('config', 'core.hooksPath', '/dev/null')
    git('config', 'user.email', 't@t')
    git('config', 'user.name', 't')
    mkdirSync(join(dir, 'tests'))
    writeFileSync(join(dir, 'tests', 'test_a.py'), 'def test_a():\n    assert 1\n')
    git('add', '-A'); git('commit', '-q', '-m', 'green')
    return dir
  }
  it('builds list, clean and confirm steps against the worktree', () => {
    const steps = strayCleanSteps('/wt/T1')
    expect(steps.map((s) => s.name)).toEqual(['stray-list', 'stray-clean', 'stray-confirm'])
    expect(steps[0].command).toContain('git -C "/wt/T1" status --porcelain --untracked-files=all')
    expect(steps[1].command).toContain('git -C "/wt/T1" clean -fdq')
    for (const s of steps) expect(s.tolerant).toBe(true)
  })
  it('under real bash: strays are removed and named; tracked files and committed work are untouched', () => {
    const dir = initRepo()
    try {
      writeFileSync(join(dir, 'tests', 'test_chdir_issue.py'), 'import os\n')
      mkdirSync(join(dir, 'scratch'))
      writeFileSync(join(dir, 'scratch', 'repro.py'), 'x = 1\n')
      const steps = strayCleanSteps(dir)
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps)
      const outcome = strayFilesFromSteps(r)
      expect(outcome.strays).toEqual(['scratch/repro.py', 'tests/test_chdir_issue.py'])
      expect(outcome.cleaned).toBe(true)
      expect(existsSync(join(dir, 'tests', 'test_chdir_issue.py'))).toBe(false)
      expect(existsSync(join(dir, 'scratch', 'repro.py'))).toBe(false)
      expect(existsSync(join(dir, 'tests', 'test_a.py'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('under real bash: a clean worktree reports no strays and cleaned=true', () => {
    const dir = initRepo()
    try {
      const steps = strayCleanSteps(dir)
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps)
      expect(strayFilesFromSteps(r)).toEqual({ strays: [], cleaned: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('a batch that did not run is a named absence, not "clean"', () => {
    expect(strayFilesFromSteps(parseBatchResult('', strayCleanSteps('/wt')))).toEqual({ strays: [], cleaned: null })
  })
  it('postGreenSteps runs the stray clean before the independent test-verify', () => {
    const names = postGreenSteps({ wt: '/wt/T1', verifyTestCmd: 'pytest -q' }).map((s) => s.name)
    expect(names.indexOf('stray-confirm')).toBeGreaterThan(-1)
    expect(names.indexOf('stray-confirm')).toBeLessThan(names.indexOf('test-verify'))
    expect(names.indexOf('ownership')).toBeLessThan(names.indexOf('stray-list'))
  })
})

// caliper: .temp/ and .datum/ are the sanctioned scratch locations (the lane
// spec itself lives at <wt>/.datum/lane-spec.json, untracked wherever .datum
// is not ignored) and no test runner collects them. The sweep leaves them.
describe('strayCleanSteps leaves .datum/ and .temp/ alone', () => {
  it('under real bash: a stray under tests/ goes, .datum/ and .temp/ stay and are not listed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-stray-keep-'))
    // Hermetic: the developer's global excludes may already ignore .datum/
    // and .temp/, which would make this pass for the wrong reason.
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', HOME: dir, XDG_CONFIG_HOME: join(dir, 'xdg') }
    try {
      const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env })
      git('init', '-q'); git('config', 'core.hooksPath', '/dev/null'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
      writeFileSync(join(dir, 'a.py'), 'x = 1\n'); git('add', '-A'); git('commit', '-q', '-m', 'base')
      mkdirSync(join(dir, 'tests')); writeFileSync(join(dir, 'tests', 'test_repro.py'), 'import os\n')
      mkdirSync(join(dir, '.datum')); writeFileSync(join(dir, '.datum', 'lane-spec.json'), '{}\n')
      mkdirSync(join(dir, '.temp')); writeFileSync(join(dir, '.temp', 'scratch.txt'), 'x\n')
      expect(git('status', '--porcelain', '--untracked-files=all')).toContain('.datum/lane-spec.json')
      const steps = strayCleanSteps(dir)
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8', env }), steps)
      expect(strayFilesFromSteps(r)).toEqual({ strays: ['tests/test_repro.py'], cleaned: true })
      expect(existsSync(join(dir, 'tests', 'test_repro.py'))).toBe(false)
      expect(existsSync(join(dir, '.datum', 'lane-spec.json'))).toBe(true)
      expect(existsSync(join(dir, '.temp', 'scratch.txt'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// datum self-hosted wf_96fa4660-133: the developer's global git hooks fired
// inside the batch's root worktree too (a post-checkout graph rebuild). The
// root-wt step turns hooks off for that worktree only, through per-worktree
// config, never the developer's repo config.
describe('setupSteps root-wt disables hooks for the root worktree', () => {
  it('enables extensions.worktreeConfig and sets core.hooksPath /dev/null on the root worktree', () => {
    const steps = setupSteps({ batchRunId: 'r1-b0', epicBranch: 'datum/e', laneIds: ['T1'], lanePlanPath: 'x' })
    const rootWt = steps.find((s) => s.name === 'root-wt')!.command
    expect(rootWt).toContain('git config extensions.worktreeConfig true')
    expect(rootWt).toMatch(/git -C "\$__rootwt" config --worktree core\.hooksPath \/dev\/null|config --worktree core\.hooksPath \/dev\/null/)
  })
})

// unslop-code (randommonicle/claude-skills) for REFACTOR: the mechanical
// surface tells are scanned deterministically over the lane's added lines by
// `datum code-tells`; the result feeds the REFACTOR check and REFACTOR itself.
describe('codeTellSteps / parseTellScan — the deterministic tell scan', () => {
  it('is one tolerant step running datum code-tells over the lane files since the base', () => {
    const steps = codeTellSteps({ wt: '/wt/T1', files: ['src/a.py', 'src/b.ts'], baseRef: 'datum/e' })
    expect(steps).toHaveLength(1)
    expect(steps[0].name).toBe('tell-scan')
    expect(steps[0].tolerant).toBe(true)
    expect(steps[0].command).toBe('datum code-tells --repo "/wt/T1" --base "datum/e" --files "src/a.py" "src/b.ts"')
  })
  it('omits --base when the lane has none', () => {
    expect(codeTellSteps({ wt: '/wt/T1', files: ['src/a.py'], baseRef: null })[0].command).not.toContain('--base')
  })
  it('parses file:line:tag:text rows and ignores anything else', () => {
    const out = 'src/a.py:12:narrating_comment:# Step 1: open\nnoise\nsrc/b.ts:3:emoji:// 🚀 go\n'
    expect(parseTellScan(out)).toEqual([
      { file: 'src/a.py', line: 12, tag: 'narrating_comment', text: '# Step 1: open' },
      { file: 'src/b.ts', line: 3, tag: 'emoji', text: '// 🚀 go' },
    ])
    expect(parseTellScan(null)).toEqual([])
  })
})

// HEAD~1 rotation (research-and-fix sweep, 2026-09-06): every `HEAD~1` in
// the pipeline was listed and judged. The ownership diff was the one that
// still assumed "the stage is exactly one commit": a RED that commits twice
// (#392 shape) hid its first commit from the check, and a GREEN that
// committed nothing was judged on RED's diff — RED's test files — as
// green_edited_tests. The diff now starts at the stage's real start.
describe('ownership diff starts at the stage start, not HEAD~1', () => {
  it('ownershipCommand diffs from a given start commit', () => {
    expect(ownershipCommand('/wt/T1', 'abc123')).toBe('git -C "/wt/T1" diff --name-only abc123 HEAD')
    expect(ownershipCommand('/wt/T1')).toBe('git -C "/wt/T1" diff --name-only HEAD~1 HEAD')
  })
  it('post-GREEN ownership starts at the RED commit when it is known', () => {
    const cmd = postGreenSteps({ wt: '/wt/T1', redSha: 'r1' }).find((s) => s.name === 'ownership')!.command
    expect(cmd).toBe('git -C "/wt/T1" diff --name-only r1 HEAD')
  })
  it('post-RED ownership starts at the merge-base with the epic branch', () => {
    const steps = postRedSteps({ wt: '/wt/T1', testFiles: ['tests/test_a.py'], acCount: 0, testFuncDiffRegex: 'x', sgPatterns: [], testFuncBodyRegex: 'x', testFuncGrepRegex: 'x', ownership: true, verifyTestCmd: null, baseRef: 'datum/e' })
    const cmd = steps.find((s) => s.name === 'ownership')!.command
    expect(cmd).toBe('git -C "/wt/T1" diff --name-only "$(git -C "/wt/T1" merge-base HEAD "datum/e")" HEAD')
  })
})

// integration-lanes-2 wf_c190fac0-56b task-002: the intake batch `cat`ed the
// Plan-phase preflight JSON whole. That file carried a 38 KB `existing_api`
// dump the runner never reads; the batch result spilled past the harness
// cap, the runner replied empty twice, and the lane failed at intake. The
// step now prints only the fields the runner consumes.
describe('laneIntakeSteps — skeleton-plan projects the preflight to what the runner reads', () => {
  it('uses jq to keep framework, target_context and output paths only, and still names a missing file', () => {
    const steps = laneIntakeSteps({ wt: '/wt/T1', epicBranch: 'datum/e', laneSpec: null, completionPath: null, cleanupCmd: null, planSkeletonPath: 'docs/epics/e/skeletons/preflight-task-002.json', skeletonCmd: 'datum skeleton', preflightPath: 'x.json', structural: false, verifyTestCmd: null })
    const cmd = steps.find((s) => s.name === 'skeleton-plan')!.command
    expect(cmd).toContain("jq -c '{framework, target_context, outputs: [(.outputs // [])[] | {path}]}'")
    expect(cmd).toContain('docs/epics/e/skeletons/preflight-task-002.json')
    expect(cmd).not.toMatch(/^cat /)
    expect(cmd).toContain('MISSING')
  })
})

// #495 (elonchesd threejs-board task-019): the count-gate step printed
// nothing, so the lane halted count_gate_no_output with nothing to read.
// The script is `set -e`: a missing --pattern-file, a bad option or an
// unreadable repo exited before the final echo. Every exit now prints one
// JSON envelope; an early one carries `error` and a null count.
describe('scripts/test-count-gate always prints a JSON envelope (#495)', () => {
  const run = (args: string[]): { out: string; code: number } => {
    try {
      return { out: execFileSync('bash', ['scripts/test-count-gate', ...args], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 }
    } catch (e: any) {
      return { out: String(e.stdout || ''), code: e.status }
    }
  }
  it('a missing --pattern-file is an envelope with error and a null count, not silence', () => {
    const r = run(['--repo', repoRoot, '--files', 'tests/test_a.py', '--pattern-file', '/nonexistent/patfile', '--required', '3'])
    expect(r.code).not.toBe(0)
    const parsed = JSON.parse(r.out.trim())
    expect(parsed.new_test_count).toBeNull()
    expect(typeof parsed.required).toBe('number') // whatever was parsed before the crash
    expect(parsed.passed).toBe(false)
    expect(parsed.error).toMatch(/^count_gate_crashed: /)
  })
  it('a usage error is an envelope too', () => {
    const r = run(['--repo', repoRoot, '--bogus'])
    expect(r.code).not.toBe(0)
    expect(JSON.parse(r.out.trim()).error).toMatch(/^count_gate_crashed: /)
  })
})

// #499 (integration-lanes-2 run 20260907-015322): task-INT-1's RED read
// REPO_ROOT/.datum/lane-spec.json, the file the exporter had just written
// into that lane worktree; the test passed there, merged, and failed on the
// epic. A test whose input is pipeline state under the repo's own .datum/
// is environment-dependent by construction. The post-RED batch scans the
// lane's added test lines (the same filtered copies the placeholder scan
// uses) for a repo-root-relative .datum read and names the line.
describe('postRedSteps — artifact-check names a RED line that reads the repo root\'s .datum/ (#499)', () => {
  it('reports file:line for a REPO_ROOT / ".datum" read and stays silent for a tmp_path one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-postred-artifact-'))
    try {
      const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      git('init', '-q', '-b', 'epic')
      git('config', 'core.hooksPath', '/dev/null')
      git('config', 'user.email', 't@t')
      git('config', 'user.name', 't')
      mkdirSync(join(dir, 'tests'))
      writeFileSync(join(dir, 'tests', 'test_a.py'), 'def test_old():\n    assert 1 == 1\n')
      git('add', '-A'); git('commit', '-q', '-m', 'base')
      git('checkout', '-q', '-b', 'epic--T1')
      writeFileSync(join(dir, 'tests', 'test_a.py'), [
        'from pathlib import Path',
        'REPO_ROOT = Path(__file__).resolve().parents[1]',
        'def test_old():',
        '    assert 1 == 1',
        'def test_reads_state(tmp_path):',
        '    ok = (tmp_path / ".datum" / "lane-spec.json")  # a scratch path is fine',
        '    data = (REPO_ROOT / ".datum" / "lane-spec.json").read_text()',
        '    assert data',
        '',
      ].join('\n'))
      git('add', '-A'); git('commit', '-q', '-m', 'red(T1): RED complete')

      const steps = postRedSteps({
        wt: dir, testFiles: ['tests/test_a.py'], acCount: 1,
        testFuncDiffRegex: '[+][[:space:]]*def test_',
        sgPatterns: [{ pattern: 'assert True', name: 'assert True' }],
        testFuncBodyRegex: 'def test_', testFuncGrepRegex: 'def test_|async def test_', ownership: true,
        verifyTestCmd: null, baseRef: 'epic',
      })
      expect(steps.map((s) => s.name)).toContain('artifact-check')
      const out = execFileSync('bash', ['-c', batchScript(steps)], { cwd: repoRoot, encoding: 'utf8' })
      const r = parseBatchResult(out, steps)
      expect(r.missing).toBe(false)
      const hits = (stepStdout(r, 'artifact-check') || '').trim().split('\n').filter(Boolean)
      expect(hits).toHaveLength(1)
      expect(hits[0]).toMatch(/^tests\/test_a\.py:7:/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// integration-lanes-2 run 20260907-015322: task-INT-5's own nine tests passed
// and its verify still failed, because the verify ran the whole suite and a
// pre-existing, machine-dependent test was red; the lane reported
// `integration_failed: covered task-003`, an invariant finding that was not
// one. An integration lane's verify runs its own test files when the command
// is pytest- or vitest-shaped; the whole suite stays Validate's job.
describe('integrationVerifyCmd — an INT lane verifies its own files, not the whole suite', () => {
  it('appends the lane test files to a pytest or vitest command', () => {
    expect(integrationVerifyCmd('uv run pytest -x -q', ['tests/integration/test_int_5.py'])).toBe('uv run pytest -x -q tests/integration/test_int_5.py')
    expect(integrationVerifyCmd('npx vitest run', ['src/int.test.ts'])).toBe('npx vitest run src/int.test.ts')
  })
  it('leaves an opaque command (a script wrapper) and an empty file list alone', () => {
    expect(integrationVerifyCmd('bash scripts/test-run.sh --affected', ['tests/integration/test_int_1.py'])).toBe('bash scripts/test-run.sh --affected')
    expect(integrationVerifyCmd('uv run pytest -x -q', [])).toBe('uv run pytest -x -q')
  })
})

// #341 task-001 (wf_d76785cc-148): a structural lane's only deliverable was
// docs/architecture/state-store.md; the lane "completed" without a commit and
// two integration lanes then failed on the missing file. A structural lane is
// decided by its deliverables: every declared file exists in the worktree and
// at least one commit past the epic branch touches them.
describe('structuralDeliverableSteps — a structural lane is decided by its declared files', () => {
  function initRepo(): { dir: string; git: (...a: string[]) => string } {
    const dir = mkdtempSync(join(tmpdir(), 'datum-structural-'))
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', HOME: dir }
    const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env })
    git('init', '-q', '-b', 'datum/e')
    git('config', 'core.hooksPath', '/dev/null')
    git('config', 'user.email', 't@t')
    git('config', 'user.name', 't')
    writeFileSync(join(dir, 'README.md'), '# x\n')
    git('add', '-A'); git('commit', '-q', '-m', 'base')
    git('checkout', '-q', '-b', 'datum/e--task-001')
    return { dir, git }
  }
  const files = ['docs/architecture/state-store.md', 'docs/architecture/index.md']

  it('builds one tolerant exists-check per file and one commit-range step scoped to the files', () => {
    const steps = structuralDeliverableSteps({ wt: '/wt/T1', epicBranch: 'datum/e', files })
    expect(names(steps)).toEqual(['deliverable-check', 'deliverable-commits'])
    for (const s of steps) expect(s.tolerant).toBe(true)
    expect(steps[0].command).toContain('docs/architecture/state-store.md')
    expect(steps[1].command).toContain('"datum/e"..HEAD')
    expect(steps[1].command).toContain('docs/architecture/index.md')
  })

  it('under real bash: nothing written and nothing committed names every file missing', () => {
    const { dir } = initRepo()
    try {
      const steps = structuralDeliverableSteps({ wt: dir, epicBranch: 'datum/e', files })
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps)
      expect(structuralDeliverablesFromSteps(r, files)).toEqual({ missing: files, committed: false })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('under real bash: one file written but uncommitted is missing:[the other], committed:false', () => {
    const { dir } = initRepo()
    try {
      mkdirSync(join(dir, 'docs', 'architecture'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'architecture', 'state-store.md'), '# decision\n')
      const steps = structuralDeliverableSteps({ wt: dir, epicBranch: 'datum/e', files })
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps)
      expect(structuralDeliverablesFromSteps(r, files)).toEqual({ missing: ['docs/architecture/index.md'], committed: false })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('under real bash: every file present and committed past the epic branch is delivered', () => {
    const { dir, git } = initRepo()
    try {
      mkdirSync(join(dir, 'docs', 'architecture'), { recursive: true })
      for (const f of files) writeFileSync(join(dir, f), '# doc\n')
      git('add', '-A'); git('commit', '-q', '-m', 'refactor(task-001): REFACTOR complete')
      const steps = structuralDeliverableSteps({ wt: dir, epicBranch: 'datum/e', files })
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps)
      expect(structuralDeliverablesFromSteps(r, files)).toEqual({ missing: [], committed: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a batch that did not run is a named absence, never "delivered"', () => {
    expect(structuralDeliverablesFromSteps(parseBatchResult('', structuralDeliverableSteps({ wt: '/wt', epicBranch: 'datum/e', files })), files)).toBeNull()
  })
})
