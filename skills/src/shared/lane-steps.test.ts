// #368 item C — the batched step lists behind the lane/setup/merge/act-start
// datum-cli calls: order, tolerance (fail-fast only where a failure must stop
// the batch), and the deterministic evaluation helpers.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  laneIntakeSteps,
  postRedSteps,
  scopeContractSteps,
  postGreenSteps,
  ownershipCheckSteps,
  depMergeSteps,
  depMergeFromSteps,
  housekeepSteps,
  housekeepFromSteps,
  setupSteps,
  mergeSteps,
  actStartSteps,
  ownershipCommand,
  sumCounts,
  scopeContentsFromSteps,
  scopeGapsFromSteps,
  completionMarkerCommand,
  isMissing,
  fencedScript,
  ownershipFromStdout,
  testExitCode,
  closeoutCollectSteps,
  closeoutArchiveSteps,
  verifyLanePlanShape,
} from './lane-steps'
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
    expect(steps[1].command).toBe('git -C "/wt/T1" log --format="%H %s" "datum/e"..HEAD')
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

  it('count gate diffs from the merge-base with the epic branch, not HEAD~1, so a resumed lane still counts its RED tests', () => {
    const steps = postRedSteps(opts)
    expect(steps[0].command).toContain('--base "datum/e"')
  })

  it('orders count gate, placeholder scan, ownership, per-file scope reads, then test counts — all tolerant', () => {
    const steps = postRedSteps(opts)
    expect(names(steps)).toEqual([
      'count-gate', 'assert-check', 'ownership', 'scope-read-0', 'scope-read-1',
      'test-count-pattern', 'test-count-after', 'test-count-before',
    ])
    expect(steps.every((s) => s.tolerant)).toBe(true)
  })

  it('writes grep patterns through quoted heredocs (never inline-quoted)', () => {
    const steps = postRedSteps(opts)
    expect(steps[0].command).toContain("<<'PATTERN_EOF'\n[+][[:space:]]*def test_\nPATTERN_EOF")
    // Must go through the installed `datum dev` wrapper, never a repo-relative
    // `bash scripts/...` path — consumer repos don't have datum's scripts/ dir
    // and `datum init --refresh` does not materialise it (exit 127 in the field).
    expect(steps[0].command).toContain('datum dev test-count-gate --repo "/wt/T1" --files "tests/test_a.py" "tests/test_b.py" --pattern-file "$PATFILE" --required 2')
    expect(steps[0].command).not.toContain('bash scripts/test-count-gate')
    expect(steps[5].command).toContain("<<'PATTERN_EOF'\ndef test_|async def test_\nPATTERN_EOF")
  })

  it('drops the count gate when the lane has no acceptance criteria and the ownership read when not deterministic', () => {
    const steps = postRedSteps({ ...opts, acCount: 0, ownership: false })
    expect(names(steps)).not.toContain('count-gate')
    expect(names(steps)).not.toContain('ownership')
  })

  it('ownershipCommand is the stage-commit diff', () => {
    expect(ownershipCommand('/wt/T1')).toBe('git -C "/wt/T1" diff --name-only HEAD~1 HEAD')
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

  it('appends a test-verify step, independently re-running the test command, when verifyTestCmd is given', () => {
    const steps = postGreenSteps({ wt: '/wt/T1', verifyTestCmd: 'pytest -q' })
    expect(names(steps)).toContain('test-verify')
    const step = steps.find((s) => s.name === 'test-verify')!
    expect(step.tolerant).toBe(true)
    expect(step.command).toContain('pytest -q')
    expect(step.command).toContain('TEST_EXIT=$?')
    expect(step.command).toContain('/wt/T1')
  })
})

describe('setupSteps', () => {
  it('creates the root worktree, sets up lanes from it, then distributes the plan — fail-fast on each', () => {
    const steps = setupSteps({ batchRunId: 'r1-b0', epicBranch: 'datum/e', laneIds: ['T1', 'T2'], lanePlanPath: 'docs/epics/datum/e/lane-plan.json' })
    expect(names(steps)).toEqual(['root-wt', 'setup-wt', 'distribute'])
    expect(steps.every((s) => !s.tolerant)).toBe(true)
    expect(steps[0].command).toContain('git worktree add --detach ".datum/worktrees/r1-b0-root" "datum/e"')
    expect(steps[0].command).toContain('printf \'{"root": "%s"}\' "$__root"')
    expect(steps[1].command).toContain('cd "$__root" && datum worktrees setup --run-id "r1-b0" --epic-branch "datum/e" --lane-ids T1,T2')
    expect(steps[2].command).toContain('select(type=="string" and startswith("/"))')
    expect(steps[2].command).toContain('datum lane-plan-distribute "$__root/docs/epics/datum/e/lane-plan.json" "${__targets[@]}"')
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

describe('mergeSteps', () => {
  const write = laneStateWriteScript({ epicBranch: 'datum/e', epicSlug: 'datum-e', runId: 'r1', entriesJson: '[{"task_id":"T1","spec_hash":"h"}]' })

  it('writes completion markers, merges, records lane-state only when the merge succeeded, then cleans up', () => {
    const steps = mergeSteps({ batchRunId: 'r1', epicBranch: 'datum/e', completedIds: ['T1', 'T2'], mergeOrder: ['T1', 'T2'], laneStateWriteScript: write })
    expect(names(steps)).toEqual(['completion-markers', 'merge', 'lane-state-write', 'cleanup'])
    expect(steps.every((s) => s.tolerant)).toBe(true)
    expect(steps[0].command).toContain(completionMarkerCommand('r1', 'T1'))
    expect(steps[0].command).toContain(completionMarkerCommand('r1', 'T2'))
    expect(steps[1].command).toContain('__merge_out=$(datum worktrees merge --epic-branch "datum/e" --lane-order T1,T2 --commit-message "act(r1): merge 2 lanes")')
    expect(steps[1].command).toContain('__merge_rc=$?')
    expect(steps[1].command).toContain(`printf '%s\\n' "$__merge_out"`)
    // The merge JSON's `merged` list — not the exit code — decides which
    // lanes get an epic-scoped marker: a partial merge (later lane conflicted,
    // earlier lanes committed) still records the lanes that landed.
    expect(steps[2].command).toMatch(/^__merged_ids=" \$\(printf '%s' "\$\{__merge_out:-\}" \| jq -r '\.merged\[\]\?' 2>\/dev\/null \| tr '\\n' ' '\)"\n/)
    expect(steps[2].command).toContain('if [ "$__merged_ids" = " " ]; then echo SKIPPED_MERGE_FAILED; else')
    expect(steps[2].command).toContain('datum lane-state write')
    expect(steps[3].command).toBe('datum worktrees cleanup --run-id "r1" --epic-branch "datum/e"')
  })

  it('the lane-state write script skips entries the merge did not list as merged', () => {
    // The rendered script filters on $__merged_ids when the merge step set it;
    // without it (unset) every entry is written.
    expect(write).toMatch(/case "\$\{__merged_ids:- \$TID \}" in \*" \$TID "\*\) ;; \*\) continue;; esac/)
  })

  it('skips the merge and lane-state when nothing is GREEN, but still cleans up', () => {
    const steps = mergeSteps({ batchRunId: 'r1', epicBranch: 'datum/e', completedIds: [], mergeOrder: [], laneStateWriteScript: null })
    expect(names(steps)).toEqual(['cleanup'])
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
  it('datum-go: init, branch, timestamp, resolve, plan-bytes, plan-sha, plan-shape, lane-state-read — no read-plan step', () => {
    const steps = actStartSteps({ branch: 'init', lanePlanPath: null, laneStateReadScript: read })
    expect(names(steps)).toEqual(['bootstrap', 'branch', 'timestamp', 'resolve', 'plan-bytes', 'plan-sha', 'plan-shape', 'lane-state-read'])
    expect(steps[0].command).toContain('datum init --json')
    expect(steps[0].tolerant).toBeFalsy()
    expect(steps[3].command).toContain('lane-plan-final.json')
    expect(steps[3].command).toContain('echo none')
    expect(steps[4].command).toContain('wc -c') // plan-bytes
    expect(steps[4].command).toContain('$__plan')
    expect(steps[5].command).toContain('git hash-object') // plan-sha
    expect(steps[5].command).toContain('$__plan')
    expect(steps[6].command).toContain('jq -c') // plan-shape: shape only, never the whole plan
    expect(steps[6].command).not.toContain('cat "$__plan"')
    expect(steps[7].command).toContain('datum lane-state read --epic "$__eb"')
    expect(steps[7].command).toContain('.topological_order[]')
  })

  it('datum-tdd-act yolo: detects the branch instead of running init; explicit branch/plan skip both', () => {
    const detect = actStartSteps({ branch: 'detect', lanePlanPath: null, laneStateReadScript: read })
    expect(names(detect)).toEqual(['branch', 'timestamp', 'resolve', 'plan-bytes', 'plan-sha', 'plan-shape', 'lane-state-read'])
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

describe('closeoutCollectSteps (#368 follow-up — deterministic closeout collect)', () => {
  it('produces one step per collector, in order, all tolerant, no || true / 2>/dev/null swallowing', () => {
    const steps = closeoutCollectSteps({ runId: 'r1' })
    expect(names(steps)).toEqual([
      'branch', 'timestamp', 'base-sha', 'merge-sha', 'config',
      'mkdir', 'collect-git', 'collect-tasks', 'collect-token-metrics', 'collate', 'data-exists',
    ])
    for (const s of steps) expect(s.tolerant).toBe(true)
    for (const s of steps) {
      expect(s.command).not.toMatch(/\|\|\s*true\b/)
      expect(s.command).not.toContain('2>/dev/null')
    }
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
      const script = batchScript(steps).replace(/datum closeout-collect[a-z-]*[^\n]*/g, 'true')
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
      'tag', 'archive',
      'move-spec-md', 'move-tasks-md', 'move-questions-md', 'move-properties-md', 'move-ticket-md',
      'move-tasks-json', 'move-lane-plan-json',
      'commit', 'commit-sha',
    ])
    expect(steps.every((s) => s.tolerant)).toBe(true)
  })

  it('tags HEAD with epic/<branch>/<runId>, no || true and no 2>/dev/null anywhere', () => {
    const steps = closeoutArchiveSteps(opts)
    expect(steps[0].command).toBe('git tag "epic/datum/e/r1" HEAD')
    for (const s of steps) {
      expect(s.command).not.toMatch(/\|\|\s*true\b/)
      expect(s.command).not.toContain('2>/dev/null')
    }
  })

  it('runs datum closeout-archive with the run id', () => {
    const steps = closeoutArchiveSteps(opts)
    expect(steps[1].command).toBe('datum closeout-archive --run-id "r1"')
  })

  it('moves each root artifact into the epic dir via git mv when present, ABSENT otherwise', () => {
    const steps = closeoutArchiveSteps(opts)
    const spec = steps.find((s) => s.name === 'move-spec-md')!
    expect(spec.command).toBe(
      'if [ -f "SPEC.md" ]; then mkdir -p "docs/epics/datum/e" && git mv "SPEC.md" "docs/epics/datum/e/SPEC.md"; else echo ABSENT; fi',
    )
    const tasksJson = steps.find((s) => s.name === 'move-tasks-json')!
    expect(tasksJson.command).toContain('git mv "tasks.json" "docs/epics/datum/e/tasks.json"')
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

describe('actStartSteps — plan-bytes / plan-sha steps', () => {
  const read = laneStateReadScript({ epicBranch: '$__eb', epicSlug: 'x', taskIdsSpace: '$(jq -r \'.topological_order[]\' "$__plan")' })

  it('emits plan-bytes (wc -c) and plan-sha (git hash-object) against $__plan, both tolerant, after resolve and before plan-shape', () => {
    const steps = actStartSteps({ branch: 'detect', lanePlanPath: null, laneStateReadScript: read })
    const n = names(steps)
    expect(n.indexOf('plan-bytes')).toBeGreaterThan(n.indexOf('resolve'))
    expect(n.indexOf('plan-sha')).toBeGreaterThan(n.indexOf('plan-bytes'))
    expect(n.indexOf('plan-shape')).toBeGreaterThan(n.indexOf('plan-sha'))
    const bytesStep = steps.find((s) => s.name === 'plan-bytes')!
    const shaStep = steps.find((s) => s.name === 'plan-sha')!
    expect(bytesStep.tolerant).toBe(true)
    expect(shaStep.tolerant).toBe(true)
    expect(bytesStep.command).toContain('wc -c')
    expect(bytesStep.command).toContain('$__plan')
    expect(shaStep.command).toContain('git hash-object')
    expect(shaStep.command).toContain('$__plan')
  })

  it('reports -1 bytes and an empty sha when no plan was resolved, rather than failing the batch', () => {
    const steps = actStartSteps({ branch: 'datum/e', lanePlanPath: 'docs/epics/datum/e/lane-plan.json', laneStateReadScript: read })
    const bytesStep = steps.find((s) => s.name === 'plan-bytes')!
    const shaStep = steps.find((s) => s.name === 'plan-sha')!
    expect(bytesStep.command).toContain("printf -- '-1'")
    expect(shaStep.command).toContain("printf ''")
  })

  it('runs under bash and reports the real byte count and a 40-hex git blob sha for a written plan file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-actstart-planbytes-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      const content = '{"lanes":{"a":{}},"topological_order":["a"],"total_lanes":1}'
      writeFileSync(join(dir, 'plan.json'), content)
      const steps = actStartSteps({ branch: 'datum/e', lanePlanPath: join(dir, 'plan.json'), laneStateReadScript: 'echo "{}"' })
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps)
      expect(r.failed).toBeNull()
      expect(stepStdout(r, 'plan-bytes')?.trim()).toBe(String(content.length))
      expect(stepStdout(r, 'plan-sha')?.trim()).toMatch(/^[0-9a-f]{40}$/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Lane-plan relay integrity. The plan is read by an LLM `reader` agent and
// echoed back; a large plan can be silently abridged (a 90 KB batch came back
// as 6.7 KB of "successful" hand-summarised JSON in eedom). The act-start
// batch now emits the plan's SHAPE via jq — tiny, safe to relay — and the
// script compares it to what the reader returned. Mismatch is a named
// failure, never a shorter plan silently executed.
// ---------------------------------------------------------------------------

describe('actStartSteps — plan-shape step', () => {
  const read = laneStateReadScript({ epicBranch: '$__eb', epicSlug: 'x', taskIdsSpace: '$(jq -r \'.topological_order[]\' "$__plan")' })

  it('emits the plan shape (sorted lane ids, topo length, total_lanes) after resolve, tolerant', () => {
    const steps = actStartSteps({ branch: 'detect', lanePlanPath: null, laneStateReadScript: read })
    const idx = names(steps).indexOf('plan-shape')
    expect(idx).toBeGreaterThan(names(steps).indexOf('resolve'))
    expect(steps[idx].tolerant).toBe(true)
    expect(steps[idx].command).toContain('jq -c')
    expect(steps[idx].command).toContain('.lanes|keys')
    expect(steps[idx].command).toContain('.topological_order|length')
    expect(steps[idx].command).toContain('.total_lanes')
  })
})

describe('verifyLanePlanShape', () => {
  const plan = {
    lanes: { 'task-001': { title: 'a', files: [] }, 'task-002': { title: 'b', files: [] } },
    topological_order: ['task-001', 'task-002'],
    total_lanes: 2,
  }

  it('accepts a relayed plan that matches the shape emitted by jq', () => {
    const r = verifyLanePlanShape(plan as never, '{"lanes":["task-001","task-002"],"topo":2,"total":2}')
    expect(r.ok).toBe(true)
  })

  it('rejects a relayed plan that dropped a lane', () => {
    const short = { ...plan, lanes: { 'task-001': plan.lanes['task-001'] }, topological_order: ['task-001'] }
    const r = verifyLanePlanShape(short as never, '{"lanes":["task-001","task-002"],"topo":2,"total":2}')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/task-002/)
  })

  it('rejects a relayed plan whose topological_order length differs', () => {
    const r = verifyLanePlanShape({ ...plan, topological_order: ['task-001'] } as never, '{"lanes":["task-001","task-002"],"topo":2,"total":2}')
    expect(r.ok).toBe(false)
  })

  it('rejects when the shape step produced no JSON — the relay cannot be verified', () => {
    const r = verifyLanePlanShape(plan as never, '')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/shape/i)
  })
})

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

