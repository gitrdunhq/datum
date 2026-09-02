// Tests for task-002: packWaves partitioner + computeBlockedLanes helper.
// RED phase — packWaves and computeBlockedLanes are not yet exported from
// ./utils. These tests must fail (import error or thrown/undefined-call
// error) until the GREEN phase implements and exports them.

import { describe, it, expect } from 'vitest'
import { buildWaves, packWaves, computeBlockedLanes, groupBlockedByRoot, filterGreenLanes, extractRequiredScopeFiles, findScopeGaps } from './utils'
import type { Lane, LanePlan, LaneOutcome } from './types'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeLane(dependsOn: string[] = []): Lane {
  return { title: 'lane', files: [], depends_on: dependsOn }
}

function makeLanePlan(depsById: Record<string, string[]>): LanePlan {
  const lanes: Record<string, Lane> = {}
  for (const [id, deps] of Object.entries(depsById)) {
    lanes[id] = makeLane(deps)
  }
  return {
    lanes,
    topological_order: Object.keys(depsById),
    total_lanes: Object.keys(depsById).length,
  }
}

// Deterministic PRNG (mulberry32) so the property test is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Builds the batch-index lookup for every lane id produced by packWaves.
function batchIndexLookup(batches: string[][]): Record<string, number> {
  const lookup: Record<string, number> = {}
  batches.forEach((batch, idx) => {
    for (const id of batch) lookup[id] = idx
  })
  return lookup
}

// Asserts the core scheduling invariant: every lane's depends_on ids must
// land in a strictly earlier batch index than the lane itself.
function assertNoForwardDependency(lanePlan: LanePlan, batches: string[][]): void {
  const batchOf = batchIndexLookup(batches)
  for (const [id, lane] of Object.entries(lanePlan.lanes)) {
    const myBatch = batchOf[id]
    expect(myBatch, `lane ${id} must appear in some batch`).toBeDefined()
    for (const dep of lane.depends_on || []) {
      const depBatch = batchOf[dep]
      expect(depBatch, `dep ${dep} of ${id} must appear in some batch`).toBeDefined()
      expect(
        depBatch,
        `lane ${id} (batch ${myBatch}) depends on ${dep} (batch ${depBatch}) — dep must be strictly earlier`,
      ).toBeLessThan(myBatch)
    }
  }
}

// ---------------------------------------------------------------------------
// AC1 — whole waves fit within cap, merged into one batch
// ---------------------------------------------------------------------------

describe('task-002 — packWaves', () => {
  it('AC1: merges whole waves into a single batch when they fit under the cap', () => {
    const result = packWaves([['a', 'b', 'c'], ['d', 'e']], 5)
    expect(result).toEqual([['a', 'b', 'c', 'd', 'e']])
  })

  // -------------------------------------------------------------------------
  // AC2 — single oversized wave split across consecutive batches
  // -------------------------------------------------------------------------

  it('AC2: splits an oversized wave across consecutive batches, scheduling every lane', () => {
    const result = packWaves([['a', 'b', 'c', 'd', 'e', 'f', 'g']], 5)
    expect(result).toEqual([
      ['a', 'b', 'c', 'd', 'e'],
      ['f', 'g'],
    ])
    // Every lane from the oversized wave must be scheduled exactly once.
    expect(result.flat()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  })

  // -------------------------------------------------------------------------
  // AC3 — intra-wave split allowed under a tighter cap
  // -------------------------------------------------------------------------

  it('AC3: allows an intra-wave split when the cap is tighter than the combined wave size', () => {
    const result = packWaves([['a', 'b', 'c'], ['d', 'e']], 4)
    expect(result).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e'],
    ])
  })

  // -------------------------------------------------------------------------
  // AC4 — 22-lane / 8-wave fixture mirroring the epic-287 evidence run
  // -------------------------------------------------------------------------

  it('AC4: 22-lane/8-wave fixture (maxBatch=5) has no lane scheduled before its dependency', () => {
    // 8 waves of sizes [3,3,3,3,3,3,2,2] = 22 lanes. Each lane in wave k>0
    // depends on exactly one lane from wave k-1, mirroring a realistic
    // fan-out/fan-in lane plan.
    const waveSizes = [3, 3, 3, 3, 3, 3, 2, 2]
    const waveIds: string[][] = []
    let counter = 1
    for (const size of waveSizes) {
      const ids: string[] = []
      for (let i = 0; i < size; i++) {
        ids.push(`n${String(counter).padStart(2, '0')}`)
        counter++
      }
      waveIds.push(ids)
    }
    expect(waveIds.flat().length).toBe(22)
    expect(waveIds.length).toBe(8)

    const depsById: Record<string, string[]> = {}
    waveIds[0].forEach((id) => {
      depsById[id] = []
    })
    for (let w = 1; w < waveIds.length; w++) {
      const prevWave = waveIds[w - 1]
      waveIds[w].forEach((id, i) => {
        depsById[id] = [prevWave[i % prevWave.length]]
      })
    }

    const lanePlan = makeLanePlan(depsById)
    const waves = buildWaves(lanePlan)
    expect(waves.length).toBe(8)
    expect(waves.flat().length).toBe(22)

    const batches = packWaves(waves, 5, lanePlan)
    assertNoForwardDependency(lanePlan, batches)
  })

  // -------------------------------------------------------------------------
  // AC5 — property test over >=100 random acyclic DAGs
  // -------------------------------------------------------------------------

  it('AC5: property — for >=100 random DAGs (10-50 nodes), packWaves never schedules a dep at or after its dependent', () => {
    const rand = mulberry32(287001)
    const TRIALS = 120

    for (let trial = 0; trial < TRIALS; trial++) {
      const nodeCount = 10 + Math.floor(rand() * 41) // 10..50 inclusive
      const ids = Array.from({ length: nodeCount }, (_, i) => `t${trial}_${i}`)

      const depsById: Record<string, string[]> = {}
      ids.forEach((id) => {
        depsById[id] = []
      })

      // Random acyclic edges: an edge only ever points from a lower index
      // to a higher index node, which guarantees the graph is a DAG.
      for (let i = 1; i < nodeCount; i++) {
        const maxCandidateDeps = Math.min(i, 3)
        const depCount = Math.floor(rand() * (maxCandidateDeps + 1))
        const candidates = Array.from({ length: i }, (_, k) => k)
        const chosen = new Set<number>()
        for (let d = 0; d < depCount; d++) {
          const pick = candidates[Math.floor(rand() * candidates.length)]
          chosen.add(pick)
        }
        depsById[ids[i]] = Array.from(chosen).map((k) => ids[k])
      }

      const lanePlan = makeLanePlan(depsById)
      const waves = buildWaves(lanePlan)
      const batches = packWaves(waves, 5, lanePlan)
      assertNoForwardDependency(lanePlan, batches)
    }
  })

  // -------------------------------------------------------------------------
  // #300 (RED) — the 2-wave fast path must not co-batch a lane with its own
  // dependency just because both waves fit under maxBatch. This is the
  // real-world shape every actual caller hits: buildWaves(lanePlan) waves
  // always carry genuine cross-wave dependency edges, unlike the bare
  // fixture arrays AC1-3 use.
  // -------------------------------------------------------------------------

  it('#300: a 2-wave lane plan with a real cross-wave dependency never co-batches a lane with its own dep', () => {
    const lanePlan = makeLanePlan({
      A: [],
      B: ['A'],
    })
    const waves = buildWaves(lanePlan)
    expect(waves).toEqual([['A'], ['B']])

    // maxBatch=5 gives ample room for the old merging fast path to cram
    // both A and B into one batch — exactly the bug.
    const batches = packWaves(waves, 5, lanePlan)
    assertNoForwardDependency(lanePlan, batches)
  })

  it('#300: still packs tightly when two small waves genuinely have no dependency between them', () => {
    const lanePlan = makeLanePlan({
      A: [],
      B: [],
    })
    // Two independent single-lane waves fed in directly (not via buildWaves,
    // which would put both in wave 0) — simulates a caller with real
    // pre-partitioned, dependency-free wave groups.
    const batches = packWaves([['A'], ['B']], 5, lanePlan)
    expect(batches).toEqual([['A', 'B']])
  })
})

// ---------------------------------------------------------------------------
// computeBlockedLanes
// ---------------------------------------------------------------------------

describe('task-002 — computeBlockedLanes', () => {
  // -------------------------------------------------------------------------
  // AC6 — single failed dependency blocks its direct dependent
  // -------------------------------------------------------------------------

  it('AC6: lane B depends_on A, A failed — B comes back blocked/SKIPPED referencing A and its failure stage', () => {
    const lanePlan = makeLanePlan({
      A: [],
      B: ['A'],
    })
    const failures = ['A']
    const results: Record<string, LaneOutcome> = {
      A: { task_id: 'A', status: 'failed', stage: 'GREEN', error: 'boom' },
    }

    const blocked = computeBlockedLanes(lanePlan, ['B'], [], failures, results)

    expect(blocked.B).toBeDefined()
    expect(blocked.B.status).toBe('blocked')
    expect(blocked.B.stage).toBe('SKIPPED')
    expect(blocked.B.error).toContain('A')
    expect(blocked.B.error).toContain('GREEN')
  })

  // -------------------------------------------------------------------------
  // AC7 — transitive chain: A fails -> B depends_on A -> C depends_on B
  // -------------------------------------------------------------------------

  it('AC7: transitive chain (A fails, B depends_on A, C depends_on B) blocks both B and C with correct upstream refs', () => {
    const lanePlan = makeLanePlan({
      A: [],
      B: ['A'],
      C: ['B'],
    })
    const failures = ['A']
    const results: Record<string, LaneOutcome> = {
      A: { task_id: 'A', status: 'failed', stage: 'GREEN', error: 'boom' },
    }

    const blocked = computeBlockedLanes(lanePlan, ['B', 'C'], [], failures, results)

    expect(blocked.B).toBeDefined()
    expect(blocked.B.status).toBe('blocked')
    expect(blocked.B.stage).toBe('SKIPPED')
    expect(blocked.B.error).toContain('A')

    expect(blocked.C).toBeDefined()
    expect(blocked.C.status).toBe('blocked')
    expect(blocked.C.stage).toBe('SKIPPED')
    expect(blocked.C.error).toContain('B')

    // Neither blocked lane should be eligible for dispatch as a runnable lane.
    expect(blocked.B.status).not.toBe('completed')
    expect(blocked.C.status).not.toBe('completed')
  })
})

// ---------------------------------------------------------------------------
// task-004 — groupBlockedByRoot
// ---------------------------------------------------------------------------

describe('task-004 — groupBlockedByRoot', () => {
  it('groups a single blocked descendant under its one failed root', () => {
    const lanePlan = makeLanePlan({
      A: [],
      B: ['A'],
    })

    const groups = groupBlockedByRoot(lanePlan, ['A'], ['B'])

    expect(groups.A).toEqual(['B'])
  })

  it('groups a transitive chain (A fails, B depends_on A, C depends_on B) under A, not B', () => {
    const lanePlan = makeLanePlan({
      A: [],
      B: ['A'],
      C: ['B'],
    })

    const groups = groupBlockedByRoot(lanePlan, ['A'], ['B', 'C'])

    expect(groups.A).toEqual(['B', 'C'])
  })

  it('diamond dependency: a lane blocked by two independent failed roots appears under both', () => {
    // A and D both fail. C depends_on both A and D. C must be grouped under
    // both roots, not deduplicated to just one (Refine Q2).
    const lanePlan = makeLanePlan({
      A: [],
      D: [],
      C: ['A', 'D'],
    })

    const groups = groupBlockedByRoot(lanePlan, ['A', 'D'], ['C'])

    expect(groups.A).toEqual(['C'])
    expect(groups.D).toEqual(['C'])
  })

  it('a failed root with no blocked descendants still appears as an empty group', () => {
    const lanePlan = makeLanePlan({ A: [] })

    const groups = groupBlockedByRoot(lanePlan, ['A'], [])

    expect(groups.A).toEqual([])
  })

  it('a blocked lane whose ancestry never reaches a failed root contributes to no group', () => {
    // B depends on A, but A is not in `failures` (e.g. A is still running,
    // or A's own status is 'blocked' rather than 'failed') — B should not be
    // silently attributed to any root.
    const lanePlan = makeLanePlan({
      A: [],
      B: ['A'],
    })

    const groups = groupBlockedByRoot(lanePlan, [], ['B'])

    expect(groups).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// task-005 — filterGreenLanes
// ---------------------------------------------------------------------------

describe('task-005 — filterGreenLanes', () => {
  it('a lane whose stage is RED is excluded from greenIds and reported in redOnlyIds', () => {
    const results: Record<string, LaneOutcome> = {
      A: { task_id: 'A', status: 'completed', stage: 'REFACTOR' },
      B: { task_id: 'B', status: 'completed', stage: 'RED' },
    }

    const { greenIds, redOnlyIds } = filterGreenLanes(['A', 'B'], results)

    expect(greenIds).toEqual(['A'])
    expect(redOnlyIds).toEqual(['B'])
  })

  it('all-GREEN input produces an empty redOnlyIds and preserves order in greenIds', () => {
    const results: Record<string, LaneOutcome> = {
      A: { task_id: 'A', status: 'completed', stage: 'REFACTOR' },
      B: { task_id: 'B', status: 'completed', stage: 'REFACTOR' },
    }

    const { greenIds, redOnlyIds } = filterGreenLanes(['A', 'B'], results)

    expect(greenIds).toEqual(['A', 'B'])
    expect(redOnlyIds).toEqual([])
  })

  it('a completed id missing from results (no stage recorded) is treated as green, not excluded', () => {
    const results: Record<string, LaneOutcome> = {}

    const { greenIds, redOnlyIds } = filterGreenLanes(['A'], results)

    expect(greenIds).toEqual(['A'])
    expect(redOnlyIds).toEqual([])
  })
})

describe('extractRequiredScopeFiles — issue #325/#334/#335: RED test import/assertion targets', () => {
  it('resolves a TS relative `import * as x from` target to a repo-relative path', () => {
    const content = `import * as utils from './shared/utils'\n`
    const required = extractRequiredScopeFiles(content, 'skills/src/datum-tdd-act-lane.test.ts', 'typescript')
    expect(required).toContain('skills/src/shared/utils.ts')
  })

  it('resolves a readFileSync(join(__dirname, ...)) hard-coded source-read target', () => {
    const content = `const utilsSource = readFileSync(join(__dirname, 'shared', 'utils.ts'), 'utf8')\n`
    const required = extractRequiredScopeFiles(content, 'skills/src/datum-tdd-act-lane.test.ts', 'typescript')
    expect(required).toContain('skills/src/shared/utils.ts')
  })

  it('resolves a Python first-party `from a.b import c` target to a repo-relative .py path', () => {
    const content = `    from datum.render import render_closeout_retro\n`
    const required = extractRequiredScopeFiles(content, 'tests/test_commit_closeout.py', 'python')
    expect(required).toContain('datum/render.py')
  })

  it('does not treat stdlib/third-party Python imports (pytest, json, subprocess) as required repo files', () => {
    const content = `import pytest\nimport json\nimport subprocess\n`
    const required = extractRequiredScopeFiles(content, 'tests/test_commit_closeout.py', 'python')
    expect(required).toEqual([])
  })

  it('dedupes when the same target is referenced more than once', () => {
    const content = `import * as utils from './shared/utils'\nimport { verifyFileOwnership } from './shared/utils'\n`
    const required = extractRequiredScopeFiles(content, 'skills/src/datum-tdd-act-lane.test.ts', 'typescript')
    expect(required.filter((f) => f === 'skills/src/shared/utils.ts')).toHaveLength(1)
  })
})

describe('findScopeGaps — issue #325/#334/#335: allowed_write_files vs RED test requirements', () => {
  it('flags a required file missing from allowed_write_files', () => {
    const gaps = findScopeGaps(
      ['skills/src/shared/utils.ts'],
      ['skills/src/datum-tdd-act-lane.ts', 'skills/datum-tdd-act-lane.js'],
    )
    expect(gaps).toEqual(['skills/src/shared/utils.ts'])
  })

  it('reports no gap when the required file is already allowed (path-boundary aware)', () => {
    const gaps = findScopeGaps(
      ['datum/render.py'],
      ['datum/closeout/commit_closeout.py', 'datum/render.py'],
    )
    expect(gaps).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// detectExistingLaneCommits — issue #331: don't re-dispatch RED/GREEN for a
// lane branch that already has those stage-complete commits.
// ---------------------------------------------------------------------------

import { detectExistingLaneCommits } from './utils'

describe('detectExistingLaneCommits — issue #331: stale lane-plan vs actual git history', () => {
  it('reports both RED and GREEN as present when both stage-complete commits exist', () => {
    const log = [
      'cccccccccccccccccccccccccccccccccccccccccc green(filter-transcript-noise-memory-extract): GREEN complete',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb red(filter-transcript-noise-memory-extract): RED complete',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa initial commit',
    ].join('\n')
    expect(detectExistingLaneCommits(log, 'filter-transcript-noise-memory-extract')).toEqual({
      hasRed: true,
      hasGreen: true,
    })
  })

  it('reports only RED as present when GREEN has not landed yet', () => {
    const log = [
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb red(some-lane): RED complete',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa initial commit',
    ].join('\n')
    expect(detectExistingLaneCommits(log, 'some-lane')).toEqual({ hasRed: true, hasGreen: false })
  })

  it('reports neither present for a fresh lane branch with no stage commits', () => {
    const log = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa initial commit'
    expect(detectExistingLaneCommits(log, 'some-lane')).toEqual({ hasRed: false, hasGreen: false })
  })

  it('does not match commits belonging to a different lane id (prefix collision)', () => {
    // "filter-transcript-noise" must not match "filter-transcript-noise-memory-extract"
    const log = [
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb red(filter-transcript-noise): RED complete',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa initial commit',
    ].join('\n')
    expect(detectExistingLaneCommits(log, 'filter-transcript-noise-memory-extract')).toEqual({
      hasRed: false,
      hasGreen: false,
    })
  })

  it('handles empty log output without throwing', () => {
    expect(detectExistingLaneCommits('', 'some-lane')).toEqual({ hasRed: false, hasGreen: false })
  })
})

// ---------------------------------------------------------------------------
// #357 — one commit convention for RED/GREEN/REFACTOR: same author identity,
// same trailer scheme, subjects `red(task-NNN): ...` / `green(task-NNN): ...`
// / `refactor(task-NNN): ...`. The REFACTOR step used to commit under the
// user's identity with no trailer, so GREEN agents reported a "stray
// concurrent writer".
// ---------------------------------------------------------------------------

import { laneCommitCommand, LANE_COMMIT_AUTHOR_EMAIL } from './utils'

describe('laneCommitCommand — issue #357: unified lane commit convention', () => {
  const wt = '/tmp/wt/task-022'
  const red = laneCommitCommand({ wt, taskId: 'task-022', stage: 'RED', runId: '20260902-101500' })
  const green = laneCommitCommand({ wt, taskId: 'task-022', stage: 'GREEN', runId: '20260902-101500' })
  const refactor = laneCommitCommand({ wt, taskId: 'task-022', stage: 'REFACTOR', runId: '20260902-101500' })

  it('uses the stage-prefixed subject for every stage', () => {
    expect(red).toContain('-m "red(task-022): RED complete"')
    expect(green).toContain('-m "green(task-022): GREEN complete"')
    expect(refactor).toContain('-m "refactor(task-022): REFACTOR complete"')
  })

  it('pins the same datum author identity on all three stages', () => {
    const author = (cmd: string) => cmd.match(/-c user\.name="([^"]+)" -c user\.email="([^"]+)"/)
    expect(author(red)).not.toBeNull()
    expect(author(red)![1]).toBe('datum/20260902-101500')
    expect(author(red)![2]).toBe(LANE_COMMIT_AUTHOR_EMAIL)
    expect(author(green)!.slice(1)).toEqual(author(red)!.slice(1))
    expect(author(refactor)!.slice(1)).toEqual(author(red)!.slice(1))
  })

  it('carries the run/lane/stage trailers so a later reader can attribute the commit', () => {
    for (const [cmd, stage] of [[red, 'RED'], [green, 'GREEN'], [refactor, 'REFACTOR']] as const) {
      expect(cmd).toContain('-m "Datum-Run: 20260902-101500"')
      expect(cmd).toContain('-m "Datum-Lane: task-022"')
      expect(cmd).toContain(`-m "Datum-Stage: ${stage}"`)
    }
  })

  it('targets the worktree explicitly and keeps the subject greppable by detectExistingLaneCommits', () => {
    expect(red.startsWith(`git -C "${wt}"`)).toBe(true)
    expect(detectExistingLaneCommits(`abc123 red(task-022): RED complete`, 'task-022').hasRed).toBe(true)
  })

  it('falls back to a plain datum identity when no runId is known', () => {
    const cmd = laneCommitCommand({ wt, taskId: 'task-001', stage: 'GREEN', runId: '' })
    expect(cmd).toContain('-c user.name="datum"')
    expect(cmd).not.toContain('Datum-Run:')
  })
})

// ---------------------------------------------------------------------------
// #356 — GREEN cannot pass when the RED test contradicts an existing
// contract. The orchestrator must (b) turn a structured blocked result into
// one lead-approval question (or auto-widen in yolo mode), and (c) never
// re-run GREEN with an unchanged allowed_write_files when the previous
// failure was a TypeError/AttributeError originating in a forbidden file.
// ---------------------------------------------------------------------------

import { decideGreenBlock, autoWidenTargets, parseContractPreflight } from './utils'
import type { StageResult, ContractPreflight } from './types'

describe('decideGreenBlock — issue #356', () => {
  const okPreflight: ContractPreflight = { status: 'ok', conflicts: [], needs_write: [], reason: '' }

  it('honours a structured blocked result from the GREEN agent', () => {
    const green: StageResult = {
      success: false, tests_pass: false, committed: false,
      status: 'blocked', needs_write: ['datum/tool.py'], reason: 'ToolResult needs stderr default',
    }
    const d = decideGreenBlock(green, null)
    expect(d.blocked).toBe(true)
    expect(d.needsWrite).toEqual(['datum/tool.py'])
    expect(d.reason).toContain('ToolResult needs stderr default')
  })

  it('parses the legacy scope_exceeded failure_reason into needs_write', () => {
    const green: StageResult = {
      success: false, tests_pass: false, committed: false,
      failure_reason: 'scope_exceeded: datum/tool.py, datum/other.py',
    }
    const d = decideGreenBlock(green, null)
    expect(d.blocked).toBe(true)
    expect(d.needsWrite).toEqual(['datum/tool.py', 'datum/other.py'])
  })

  it('blocks (never retries) when the contract preflight found a TypeError/AttributeError in an unwritable file', () => {
    const green: StageResult = { success: false, tests_pass: false, committed: false, failure_reason: '2 tests still failing' }
    const preflight: ContractPreflight = {
      status: 'contract_conflict',
      conflicts: [{ test: 'test_construct', kind: 'signature_mismatch', error_type: 'TypeError', message: 'ToolResult.__init__() missing 1 required positional argument: \'stderr\'', origin_file: 'tests/test_tool.py', symbol: 'ToolResult', defined_in: ['datum/tool.py'] }],
      needs_write: ['datum/tool.py'],
      reason: 'RED test contradicts an existing contract',
    }
    const d = decideGreenBlock(green, preflight)
    expect(d.blocked).toBe(true)
    expect(d.needsWrite).toEqual(['datum/tool.py'])
    expect(d.reason).toMatch(/ToolResult/)
    expect(d.reason).toMatch(/contract/i)
  })

  it('does not block an ordinary GREEN failure — the normal retry path still applies', () => {
    const green: StageResult = { success: false, tests_pass: false, committed: false, failure_reason: 'assertion mismatch in test_x' }
    expect(decideGreenBlock(green, okPreflight).blocked).toBe(false)
    expect(decideGreenBlock(green, { status: 'skipped', conflicts: [], needs_write: [], reason: 'not a pytest lane' }).blocked).toBe(false)
    expect(decideGreenBlock(null, null).blocked).toBe(false)
  })

  it('never blocks a successful GREEN', () => {
    const green: StageResult = { success: true, tests_pass: true, committed: true }
    expect(decideGreenBlock(green, { status: 'contract_conflict', conflicts: [], needs_write: ['x.py'], reason: 'r' }).blocked).toBe(false)
  })
})

describe('autoWidenTargets — issue #356 yolo auto-widen', () => {
  it('accepts only paths inside src/ and rejects the rest', () => {
    const r = autoWidenTargets(['src/pkg/tool.py', 'datum/tool.py', 'src/../etc/passwd', 'tests/test_x.py'])
    expect(r.widen).toEqual(['src/pkg/tool.py'])
    expect(r.rejected).toEqual(['datum/tool.py', 'src/../etc/passwd', 'tests/test_x.py'])
  })

  it('is empty for an empty request', () => {
    expect(autoWidenTargets([])).toEqual({ widen: [], rejected: [] })
  })
})

describe('parseContractPreflight — issue #356', () => {
  it('falls back to skipped on unparseable agent output', () => {
    const p = parseContractPreflight('the agent said nothing useful')
    expect(p.status).toBe('skipped')
    expect(p.needs_write).toEqual([])
  })

  it('reads the module JSON as-is', () => {
    const p = parseContractPreflight('{"status":"contract_conflict","conflicts":[],"needs_write":["a.py"],"reason":"r"}')
    expect(p.status).toBe('contract_conflict')
    expect(p.needs_write).toEqual(['a.py'])
  })
})
