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
    expect(steps[1].command).toBe('git -C "/wt/T1" log --format="%H %s"')
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
  }

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
    expect(steps[0].command).toContain('bash scripts/test-count-gate --repo "/wt/T1" --files "tests/test_a.py" "tests/test_b.py" --pattern-file "$PATFILE" --required 2')
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

describe('postRedSteps — executed against a real git worktree', () => {
  it('counts the new test functions and lists the files the RED commit touched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-postred-'))
    try {
      const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      git('init', '-q')
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
  it('fails open when the diff step did not run (same as a null agent result)', () => {
    expect(ownershipFromStdout(null, ['tests/test_a.py'], ['src/a.py'])).toEqual({ ok: true, violations: [] })
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

describe('postGreenSteps', () => {
  it('is the single ownership read', () => {
    const steps = postGreenSteps({ wt: '/wt/T1' })
    expect(names(steps)).toEqual(['ownership'])
    expect(steps[0].command).toBe(ownershipCommand('/wt/T1'))
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

describe('mergeSteps', () => {
  const write = laneStateWriteScript({ epicBranch: 'datum/e', epicSlug: 'datum-e', runId: 'r1', entriesJson: '[{"task_id":"T1","spec_hash":"h"}]' })

  it('writes completion markers, merges, records lane-state only when the merge succeeded, then cleans up', () => {
    const steps = mergeSteps({ batchRunId: 'r1', epicBranch: 'datum/e', completedIds: ['T1', 'T2'], mergeOrder: ['T1', 'T2'], laneStateWriteScript: write })
    expect(names(steps)).toEqual(['completion-markers', 'merge', 'lane-state-write', 'cleanup'])
    expect(steps.every((s) => s.tolerant)).toBe(true)
    expect(steps[0].command).toContain(completionMarkerCommand('r1', 'T1'))
    expect(steps[0].command).toContain(completionMarkerCommand('r1', 'T2'))
    expect(steps[1].command).toContain('datum worktrees merge --epic-branch "datum/e" --lane-order T1,T2 --commit-message "act(r1): merge 2 lanes"')
    expect(steps[1].command).toContain('__merge_rc=$?')
    expect(steps[2].command).toMatch(/^if \[ "\$\{__merge_rc:-0}" -ne 0 \]; then echo SKIPPED_MERGE_FAILED; else/)
    expect(steps[2].command).toContain('datum lane-state write')
    expect(steps[3].command).toBe('datum worktrees cleanup --run-id "r1" --epic-branch "datum/e"')
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

  it('datum-go: init, branch, timestamp, resolve, read-plan, lane-state-read', () => {
    const steps = actStartSteps({ branch: 'init', lanePlanPath: null, laneStateReadScript: read })
    expect(names(steps)).toEqual(['bootstrap', 'branch', 'timestamp', 'resolve', 'read-plan', 'lane-state-read'])
    expect(steps[0].command).toContain('datum init --json')
    expect(steps[0].tolerant).toBeFalsy()
    expect(steps[3].command).toContain('lane-plan-final.json')
    expect(steps[3].command).toContain('echo none')
    expect(steps[4].command).toBe('[ -n "$__plan" ] && cat "$__plan"')
    expect(steps[5].command).toContain('datum lane-state read --epic "$__eb"')
    expect(steps[5].command).toContain('.topological_order[]')
  })

  it('datum-tdd-act yolo: detects the branch instead of running init; explicit branch/plan skip both', () => {
    const detect = actStartSteps({ branch: 'detect', lanePlanPath: null, laneStateReadScript: read })
    expect(names(detect)).toEqual(['branch', 'timestamp', 'resolve', 'read-plan', 'lane-state-read'])
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

  it('runs under bash for an explicit branch + plan and reads the plan verbatim', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-actstart-'))
    try {
      writeFileSync(join(dir, 'plan.json'), '{"lanes":{},"topological_order":[]}')
      const steps = actStartSteps({ branch: 'datum/e', lanePlanPath: join(dir, 'plan.json'), laneStateReadScript: 'echo "{}"' })
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { encoding: 'utf8' }), steps)
      expect(r.failed).toBeNull()
      expect(stepStdout(r, 'branch')).toBe('datum/e')
      expect(stepStdout(r, 'timestamp')).toMatch(/^\d{8}-\d{6}\n$/)
      expect(stepStdout(r, 'read-plan')).toBe('{"lanes":{},"topological_order":[]}')
      expect(stepResult(r, 'lane-state-read')?.stdout).toBe('{}\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
