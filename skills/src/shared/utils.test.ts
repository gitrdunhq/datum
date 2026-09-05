// Tests for task-002: packWaves partitioner + computeBlockedLanes helper.
// RED phase — packWaves and computeBlockedLanes are not yet exported from
// ./utils. These tests must fail (import error or thrown/undefined-call
// error) until the GREEN phase implements and exports them.

import { describe, it, expect } from 'vitest'
import { buildWaves, packWaves, computeBlockedLanes, groupBlockedByRoot, filterGreenLanes, extractRequiredScopeFiles, findScopeGaps, classifyFiles, parseAgentJson, parseAgentJsonStrict, crossValidateBugs, buildPacket, laneSpecHash } from './utils'
import type { ContextFile } from './context-relay'
import type { Lane, LanePlan, LaneOutcome, PipelineConfig } from './types'

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

// #524 dogfooding — isTest()'s directory check was `f.includes('/tests/')`,
// requiring a slash BEFORE "tests" — so a repo-root-relative path like
// "tests/unit/test_part_score.py" (no leading slash) never matched via the
// directory check, only via the "test_" basename convention. Currently
// masked whenever every test file also happens to follow a recognized
// basename convention (test_*.py, *.spec.ts, etc.) — but it's dead code
// for the common root-relative case, and would silently misclassify a test
// file whose basename doesn't match any convention (e.g. a Kotlin/Java
// suite like tests/integration/SomeSuite.kt).
describe('classifyFiles — root-relative tests/ directory (#524)', () => {
  it('classifies a root-relative tests/ path as a test file via the directory check alone', () => {
    // "SomeSuite.kt" matches no basename convention — only the directory
    // check can classify it, and only if it accounts for a path that
    // starts with "tests/" rather than requiring a leading slash.
    const { testFiles, implFiles } = classifyFiles(['tests/integration/SomeSuite.kt'])
    expect(testFiles).toEqual(['tests/integration/SomeSuite.kt'])
    expect(implFiles).toEqual([])
  })

  it('still classifies a nested tests/ path (with a leading slash) as a test file', () => {
    const { testFiles } = classifyFiles(['src/module/tests/SomeSuite.kt'])
    expect(testFiles).toEqual(['src/module/tests/SomeSuite.kt'])
  })

  it('still classifies a root-relative Tests/ (capitalized) path as a test file', () => {
    const { testFiles } = classifyFiles(['Tests/IntegrationSuite.swift'])
    expect(testFiles).toEqual(['Tests/IntegrationSuite.swift'])
  })

  it('does not misclassify an implementation file merely containing "test" in its name', () => {
    const { testFiles, implFiles } = classifyFiles(['src/caliper/core/latest_config.py'])
    expect(testFiles).toEqual([])
    expect(implFiles).toEqual(['src/caliper/core/latest_config.py'])
  })
})

// ---------------------------------------------------------------------------
// parseAgentJson — bracket-matching robustness
// ---------------------------------------------------------------------------

describe('parseAgentJson', () => {
  it('parses a clean JSON object response', () => {
    const result = parseAgentJson('{"ok": true}', { ok: false })
    expect(result).toEqual({ ok: true })
  })

  it('does not overshoot into a stray closing bracket in trailing prose', () => {
    // Real response: a valid JSON object followed by prose mentioning a
    // filename that happens to contain a ']' character.
    const text = '{"ok": true}\n\nSee the example output in results].txt for details.'
    const result = parseAgentJson(text, { ok: false })
    expect(result).toEqual({ ok: true })
  })

  it('does not anchor on an illustrative JSON example that precedes the real answer', () => {
    const text = 'For example: {"example": true}\n\nActual answer:\n{"ok": true, "value": 42}'
    const result = parseAgentJson(text, { ok: false, value: 0 })
    expect(result).toEqual({ ok: true, value: 42 })
  })

  it('falls back to bracket-scanning when the whole string is not valid JSON on its own', () => {
    const text = 'Here is the result:\n{"ok": true}\nThanks!'
    const result = parseAgentJson(text, { ok: false })
    expect(result).toEqual({ ok: true })
  })

  it('returns the fallback when no JSON is present at all', () => {
    const result = parseAgentJson('no json here', { ok: false })
    expect(result).toEqual({ ok: false })
  })
})

// ---------------------------------------------------------------------------
// parseAgentJsonStrict — throws a named error instead of returning a default
// ---------------------------------------------------------------------------

describe('parseAgentJsonStrict', () => {
  it('parses a clean JSON object response', () => {
    expect(parseAgentJsonStrict('{"ok": true}', 'my-label')).toEqual({ ok: true })
  })

  it('returns a real empty array rather than treating it as "not found"', () => {
    // A naive `if (!value) throw` would wrongly reject this — an agent
    // legitimately reporting "no findings" must come through as [].
    expect(parseAgentJsonStrict('[]', 'my-label')).toEqual([])
  })

  it('returns a real 0 rather than treating it as "not found"', () => {
    expect(parseAgentJsonStrict('0', 'my-label')).toBe(0)
  })

  it('extracts JSON from prose via bracket-scanning like parseAgentJson', () => {
    const text = 'Here is the result:\n{"ok": true}\nThanks!'
    expect(parseAgentJsonStrict(text, 'my-label')).toEqual({ ok: true })
  })

  it('throws a named agent_output_unparseable error with the label and truncated text when no JSON is present', () => {
    expect(() => parseAgentJsonStrict('no json here', 'my-label')).toThrow(
      /^agent_output_unparseable: my-label — no json here$/,
    )
  })

  it('throws for null input', () => {
    expect(() => parseAgentJsonStrict(null as unknown as string, 'my-label')).toThrow(
      /^agent_output_unparseable: my-label/,
    )
  })

  it('throws for empty string input', () => {
    expect(() => parseAgentJsonStrict('', 'my-label')).toThrow(/^agent_output_unparseable: my-label/)
  })

  it('truncates the raw text in the error message to 200 characters', () => {
    const longText = 'x'.repeat(500)
    try {
      parseAgentJsonStrict(longText, 'my-label')
      throw new Error('expected parseAgentJsonStrict to throw')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg.startsWith('agent_output_unparseable: my-label — ' + 'x'.repeat(200))).toBe(true)
      expect(msg.length).toBeLessThan(500)
    }
  })

  it('throws for truncated/unbalanced JSON', () => {
    const text = 'Result: {"incomplete": true'
    expect(() => parseAgentJsonStrict(text, 'my-label')).toThrow(/^agent_output_unparseable: my-label/)
  })
})

// ---------------------------------------------------------------------------
// findMatchingBracketEnd — character-level bracket matching (tested via parseAgentJson)
// ---------------------------------------------------------------------------

describe('findMatchingBracketEnd (via parseAgentJson)', () => {
  it('extracts plain JSON object from agent prose', () => {
    const text = 'The result is:\n{"status":"ok"}\nDone.'
    const result = parseAgentJson(text, { status: 'unknown' })
    expect(result).toEqual({ status: 'ok' })
  })

  it('extracts plain JSON array from agent prose', () => {
    const text = 'Items: [1, 2, 3]'
    const result = parseAgentJson(text, [])
    expect(result).toEqual([1, 2, 3])
  })

  it('handles nested objects with multiple levels', () => {
    const text = 'Result: {"a":{"b":{"c":1}}}'
    const result = parseAgentJson(text, {})
    expect(result).toEqual({ a: { b: { c: 1 } } })
  })

  it('handles nested arrays inside objects', () => {
    const text = 'Data: {"items":[1,2,[3,4]]}'
    const result = parseAgentJson(text, {})
    expect(result).toEqual({ items: [1, 2, [3, 4]] })
  })

  it('preserves brackets inside string values and does not close early', () => {
    const text = 'Result: {"message":"contains } and ] brackets"}'
    const result = parseAgentJson(text, {})
    expect(result).toEqual({ message: 'contains } and ] brackets' })
  })

  it('handles escaped quotes inside strings', () => {
    const text = 'Result: {"message":"contains \\"quotes\\""}'
    const result = parseAgentJson(text, {})
    expect(result).toEqual({ message: 'contains "quotes"' })
  })

  it('handles backslash-escaped brackets inside strings', () => {
    const text = 'Result: {"pattern":"\\\\}"}'
    const result = parseAgentJson(text, {})
    expect(result).toEqual({ pattern: '\\}' })
  })

  it('finds the LAST valid JSON object when multiple candidates exist (agent answers come last)', () => {
    const text = 'Example: {"example":true}\n\nActual: {"actual":true}'
    const result = parseAgentJson(text, {})
    expect(result).toEqual({ actual: true })
  })

  it('returns fallback for truncated/unbalanced JSON', () => {
    const text = 'Result: {"incomplete": true'
    const result = parseAgentJson(text, { fallback: true })
    expect(result).toEqual({ fallback: true })
  })

  it('strips ```json code fence wrapping the entire response', () => {
    const text = '```json\n{"ok":true}\n```'
    const result = parseAgentJson(text, {})
    expect(result).toEqual({ ok: true })
  })

  it('strips ```  (no language) code fence wrapping the entire response', () => {
    const text = '```\n{"ok":true}\n```'
    const result = parseAgentJson(text, {})
    expect(result).toEqual({ ok: true })
  })

  it('keeps the LAST parseable JSON even when it is fenced — prompts put the example first and the answer last', () => {
    // Documented convention (commit 654ee95): the real answer comes last; an
    // illustrative example, if any, comes first. Skipping fenced candidates
    // would return the fallback for the most common reply shape below.
    const text = 'Example:\n```json\n{"example":true}\n```\nAnswer: {"ok":true}'
    expect(parseAgentJson(text, {})).toEqual({ ok: true })
  })

  it('parses a reply that is prose followed by a single fenced JSON block', () => {
    expect(parseAgentJson('Here you go:\n```json\n{"a": 2}\n```\n', null)).toEqual({ a: 2 })
  })

  it('parses the first { or [ bracket when no full-response JSON parse succeeds', () => {
    const text = 'Response: [1,2,3]'
    const result = parseAgentJson(text, {})
    expect(result).toEqual([1, 2, 3])
  })

  it('returns fallback for completely invalid input', () => {
    const text = 'no json here at all'
    const result = parseAgentJson(text, { fallback: 42 })
    expect(result).toEqual({ fallback: 42 })
  })

  it('returns fallback for null/undefined input', () => {
    expect(parseAgentJson(null as unknown as string, { ok: false })).toEqual({ ok: false })
    expect(parseAgentJson(undefined as unknown as string, { ok: false })).toEqual({ ok: false })
  })

  it('handles JSON with empty string values', () => {
    const text = '{"key":""}'
    const result = parseAgentJson(text, {})
    expect(result).toEqual({ key: '' })
  })

  it('handles very deeply nested JSON', () => {
    const text = '{"a":{"b":{"c":{"d":{"e":{"f":1}}}}}}'
    const result = parseAgentJson(text, {})
    expect((result as any).a.b.c.d.e.f).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// joinPosix — POSIX path joining with . and .. handling (via extractRequiredScopeFiles)
// ---------------------------------------------------------------------------

describe('joinPosix (via extractRequiredScopeFiles)', () => {
  it('joins base and relative paths with /', () => {
    const content = 'import * as x from "./utils"'
    const required = extractRequiredScopeFiles(content, 'src/dir/test.ts', 'typescript')
    expect(required).toContain('src/dir/utils.ts')
  })

  it('handles ./ current-directory prefixes', () => {
    const content = 'import * as x from "./subdir/utils"'
    const required = extractRequiredScopeFiles(content, 'src/dir/test.ts', 'typescript')
    expect(required).toContain('src/dir/subdir/utils.ts')
  })

  it('handles ../ parent-directory references', () => {
    const content = 'import * as x from "../sibling"'
    const required = extractRequiredScopeFiles(content, 'src/deep/nested/test.ts', 'typescript')
    expect(required).toContain('src/deep/sibling.ts')
  })

  it('handles multiple ../ to walk up multiple levels', () => {
    const content = 'import * as x from "../../utils"'
    const required = extractRequiredScopeFiles(content, 'src/deep/nested/test.ts', 'typescript')
    expect(required).toContain('src/utils.ts')
  })

  it('stops at root when .. would go beyond (does not create leading /../..)', () => {
    const content = 'import * as x from "../../../../../outside"'
    const required = extractRequiredScopeFiles(content, 'src/test.ts', 'typescript')
    // Should never escape the root; exact behavior depends on joinPosix
    const result = required[0]
    expect(result).not.toContain('../')
  })

  it('handles . (current directory, no-op)', () => {
    const content = 'import * as x from "././nested"'
    const required = extractRequiredScopeFiles(content, 'src/dir/test.ts', 'typescript')
    expect(required).toContain('src/dir/nested.ts')
  })

  it('resolves readFileSync(join(__dirname, ...)) with multiple path segments', () => {
    const content = 'readFileSync(join(__dirname, "sub", "dir", "file.txt"))'
    const required = extractRequiredScopeFiles(content, 'src/test.ts', 'typescript')
    expect(required).toContain('src/sub/dir/file.txt')
  })

  it('resolves readFileSync with .. segments', () => {
    const content = 'readFileSync(join(__dirname, "..", "sibling", "file.txt"))'
    const required = extractRequiredScopeFiles(content, 'src/nested/test.ts', 'typescript')
    expect(required).toContain('src/sibling/file.txt')
  })
})

// ---------------------------------------------------------------------------
// crossValidateBugs — merges skeptic results across lenses
// ---------------------------------------------------------------------------

describe('crossValidateBugs', () => {
  it('collects bugs from all three skeptic lenses', () => {
    const results = [
      {
        verdict: 'PASS' as const,
        bugs_found: [{ description: 'bug1', evidence: 'e1', severity: 'high' as const }],
        confidence: 0.9,
      },
      {
        verdict: 'PASS' as const,
        bugs_found: [{ description: 'bug2', evidence: 'e2', severity: 'low' as const }],
        confidence: 0.8,
      },
      {
        verdict: 'PASS' as const,
        bugs_found: [{ description: 'bug3', evidence: 'e3', severity: 'medium' as const }],
        confidence: 0.85,
      },
    ]
    const lenses = [
      { key: 'lens1', model: 'opus' as const, prompt: 'test' },
      { key: 'lens2', model: 'sonnet' as const, prompt: 'test' },
      { key: 'lens3', model: 'haiku' as const, prompt: 'test' },
    ]
    const { allBugs, brokenCount, crossValidated } = crossValidateBugs(results, lenses)
    expect(allBugs).toHaveLength(3)
    expect(brokenCount).toBe(0)
  })

  it('counts BROKEN verdicts', () => {
    const results = [
      { verdict: 'BROKEN' as const, bugs_found: [], confidence: 0.5 },
      { verdict: 'PASS' as const, bugs_found: [], confidence: 0.9 },
      { verdict: 'FRAGILE' as const, bugs_found: [], confidence: 0.7 },
    ]
    const lenses = [
      { key: 'l1', model: 'opus' as const, prompt: 'test' },
      { key: 'l2', model: 'sonnet' as const, prompt: 'test' },
      { key: 'l3', model: 'haiku' as const, prompt: 'test' },
    ]
    const { brokenCount } = crossValidateBugs(results, lenses)
    expect(brokenCount).toBe(1)
  })

  it('identifies cross-validated bugs (same description in multiple lenses)', () => {
    const results = [
      {
        verdict: 'PASS' as const,
        bugs_found: [{ description: 'off by one error', evidence: 'e1', severity: 'high' as const }],
        confidence: 0.9,
      },
      {
        verdict: 'PASS' as const,
        bugs_found: [{ description: 'off by one error', evidence: 'e2', severity: 'high' as const }],
        confidence: 0.85,
      },
      {
        verdict: 'PASS' as const,
        bugs_found: [],
        confidence: 0.95,
      },
    ]
    const lenses = [
      { key: 'l1', model: 'opus' as const, prompt: 'test' },
      { key: 'l2', model: 'sonnet' as const, prompt: 'test' },
      { key: 'l3', model: 'haiku' as const, prompt: 'test' },
    ]
    const { crossValidated } = crossValidateBugs(results, lenses)
    expect(crossValidated).toHaveLength(2)
    expect(crossValidated[0].description).toBe('off by one error')
  })

  it('normalizes bug descriptions to lowercase and truncates to 60 chars for comparison', () => {
    const results = [
      {
        verdict: 'PASS' as const,
        bugs_found: [
          { description: 'OFF BY ONE ERROR IN LOOP', evidence: 'e1', severity: 'high' as const },
        ],
        confidence: 0.9,
      },
      {
        verdict: 'PASS' as const,
        bugs_found: [
          { description: 'off  by   one   ERROR  in  LOOP', evidence: 'e2', severity: 'high' as const },
        ],
        confidence: 0.85,
      },
      { verdict: 'PASS' as const, bugs_found: [], confidence: 0.95 },
    ]
    const lenses = [
      { key: 'l1', model: 'opus' as const, prompt: 'test' },
      { key: 'l2', model: 'sonnet' as const, prompt: 'test' },
      { key: 'l3', model: 'haiku' as const, prompt: 'test' },
    ]
    const { crossValidated } = crossValidateBugs(results, lenses)
    expect(crossValidated).toHaveLength(2)
  })

  it('handles null entries in skepticResults', () => {
    const results = [
      {
        verdict: 'PASS' as const,
        bugs_found: [{ description: 'bug1', evidence: 'e1', severity: 'high' as const }],
        confidence: 0.9,
      },
      null,
      {
        verdict: 'PASS' as const,
        bugs_found: [{ description: 'bug2', evidence: 'e2', severity: 'low' as const }],
        confidence: 0.8,
      },
    ]
    const lenses = [
      { key: 'l1', model: 'opus' as const, prompt: 'test' },
      { key: 'l2', model: 'sonnet' as const, prompt: 'test' },
      { key: 'l3', model: 'haiku' as const, prompt: 'test' },
    ]
    const { allBugs } = crossValidateBugs(results, lenses)
    expect(allBugs).toHaveLength(2)
  })

  it('handles empty bugs_found array', () => {
    const results = [
      { verdict: 'PASS' as const, bugs_found: [], confidence: 0.9 },
      { verdict: 'PASS' as const, bugs_found: [], confidence: 0.85 },
      { verdict: 'PASS' as const, bugs_found: [], confidence: 0.95 },
    ]
    const lenses = [
      { key: 'l1', model: 'opus' as const, prompt: 'test' },
      { key: 'l2', model: 'sonnet' as const, prompt: 'test' },
      { key: 'l3', model: 'haiku' as const, prompt: 'test' },
    ]
    const { allBugs, crossValidated } = crossValidateBugs(results, lenses)
    expect(allBugs).toHaveLength(0)
    expect(crossValidated).toHaveLength(0)
  })

  it('preserves lens key on each bug entry', () => {
    const results = [
      {
        verdict: 'PASS' as const,
        bugs_found: [{ description: 'bug1', evidence: 'e1', severity: 'high' as const }],
        confidence: 0.9,
      },
      { verdict: 'PASS' as const, bugs_found: [], confidence: 0.85 },
      { verdict: 'PASS' as const, bugs_found: [], confidence: 0.95 },
    ]
    const lenses = [
      { key: 'opus-lens', model: 'opus' as const, prompt: 'test' },
      { key: 'sonnet-lens', model: 'sonnet' as const, prompt: 'test' },
      { key: 'haiku-lens', model: 'haiku' as const, prompt: 'test' },
    ]
    const { allBugs } = crossValidateBugs(results, lenses)
    expect(allBugs[0].lens).toBe('opus-lens')
  })
})

// ---------------------------------------------------------------------------
// buildPacket — constructs TaskPacket for RED/GREEN/REFACTOR agents
// ---------------------------------------------------------------------------

describe('buildPacket', () => {
  const testLane: Lane = {
    title: 'Test Lane',
    files: [],
    acceptance_criteria: ['AC1', 'AC2'],
    red_note: 'This is tricky',
  }

  const cfg = {
    lanePlanPath: '/path/to/lane-plan.json',
    epicBranch: 'epic/test',
    runId: 'test-run-123',
    language: 'typescript',
    testCommand: 'npm test',
    test_framework: 'vitest',
  } as PipelineConfig
  const specFile: ContextFile = { path: '/wt/.datum/lane-spec.json', exists: true, inlined: false, bytes: 300, sha: 'f'.repeat(40), content: null }

  it('builds a packet for RED stage with test files allowed and impl files forbidden', () => {
    const packet = buildPacket('task-123', ['tests/test.ts'], ['src/impl.ts'], testLane, '/wt', cfg, 'RED', specFile)
    expect(packet.stage).toBe('RED')
    expect(packet.allowed_write_files).toEqual(['tests/test.ts'])
    expect(packet.forbidden_write_files).toEqual(['src/impl.ts'])
    expect(packet.commit_prefix).toBe('red(task-123)')
  })

  it('builds a packet for GREEN stage with impl files allowed and test files forbidden', () => {
    const packet = buildPacket('task-123', ['tests/test.ts'], ['src/impl.ts'], testLane, '/wt', cfg, 'GREEN', specFile)
    expect(packet.stage).toBe('GREEN')
    expect(packet.allowed_write_files).toEqual(['src/impl.ts'])
    expect(packet.forbidden_write_files).toEqual(['tests/test.ts'])
    expect(packet.commit_prefix).toBe('green(task-123)')
  })

  it('builds a packet for REFACTOR stage with both files allowed and none forbidden', () => {
    const packet = buildPacket('task-123', ['tests/test.ts'], ['src/impl.ts'], testLane, '/wt', cfg, 'REFACTOR', specFile)
    expect(packet.stage).toBe('REFACTOR')
    expect(packet.allowed_write_files).toEqual(['tests/test.ts', 'src/impl.ts'])
    expect(packet.forbidden_write_files).toEqual([])
    expect(packet.commit_prefix).toBe('refactor(task-123)')
  })

  it('includes schema version and task_id', () => {
    const packet = buildPacket('task-456', [], [], testLane, '/wt', cfg, 'RED', specFile)
    expect(packet.schema_version).toBe('1.0')
    expect(packet.task_id).toBe('task-456')
  })

  it('copies title from lane', () => {
    const packet = buildPacket('task-123', [], [], testLane, '/wt', cfg, 'RED', specFile)
    expect(packet.title).toBe('Test Lane')
  })

  it('carries the lane spec FILE reference, never the criteria or red_note text', () => {
    const packet = buildPacket('task-123', [], [], testLane, '/wt', cfg, 'RED', specFile)
    expect(packet.lane_spec_file).toEqual({ path: '/wt/.datum/lane-spec.json', bytes: 300, sha: 'f'.repeat(40) })
    expect((packet as any).acceptance_criteria).toBeUndefined()
    expect((packet as any).red_note).toBeUndefined()
    expect(JSON.stringify(packet)).not.toContain('AC1')
  })

  it('sets working_directory from wt parameter', () => {
    const packet = buildPacket('task-123', [], [], testLane, '/my/wt', cfg, 'RED', specFile)
    expect(packet.working_directory).toBe('/my/wt')
  })

  it('includes test_command from config', () => {
    const packet = buildPacket('task-123', [], [], testLane, '/wt', cfg, 'RED', specFile)
    expect(packet.test_command).toBe('npm test')
  })

  it('includes test_framework from config when present', () => {
    const packet = buildPacket('task-123', [], [], testLane, '/wt', cfg, 'RED', specFile)
    expect(packet.test_framework).toBe('vitest')
  })

  it('omits test_framework when config does not have it', () => {
    const minCfg = { testCommand: 'npm test' }
    const packet = buildPacket('task-123', [], [], testLane, '/wt', minCfg as any, 'RED', specFile)
    expect((packet as any).test_framework).toBeUndefined()
  })

  it('merges extras into the packet', () => {
    const packet = buildPacket('task-123', [], [], testLane, '/wt', cfg, 'RED', specFile, {
      custom_field: 'custom_value',
      upstream_source: 'main',
    })
    expect((packet as any).custom_field).toBe('custom_value')
    expect((packet as any).upstream_source).toBe('main')
  })

  it('extras do not override core fields (schema_version, task_id, stage, etc.)', () => {
    const packet = buildPacket('task-123', [], [], testLane, '/wt', cfg, 'RED', specFile, {
      stage: 'GREEN',
      schema_version: '2.0',
      task_id: 'wrong-id',
    })
    expect(packet.stage).toBe('RED')
    expect(packet.schema_version).toBe('1.0')
    expect(packet.task_id).toBe('task-123')
  })

  it('handles empty test and impl file lists', () => {
    const packet = buildPacket('task-123', [], [], testLane, '/wt', cfg, 'REFACTOR', specFile)
    expect(packet.allowed_write_files).toEqual([])
    expect(packet.forbidden_write_files).toEqual([])
  })

  it('preserves order of test files when allowed', () => {
    const testFiles = ['test1.ts', 'test2.ts', 'test3.ts']
    const packet = buildPacket('task-123', testFiles, [], testLane, '/wt', cfg, 'RED', specFile)
    expect(packet.allowed_write_files).toEqual(testFiles)
  })

  it('preserves order of impl files when allowed', () => {
    const implFiles = ['impl1.ts', 'impl2.ts', 'impl3.ts']
    const packet = buildPacket('task-123', [], implFiles, testLane, '/wt', cfg, 'GREEN', specFile)
    expect(packet.allowed_write_files).toEqual(implFiles)
  })
})

// ---------------------------------------------------------------------------
// laneSpecHash — cross-language pin against tests/fixtures/lane_spec_hash_vectors.json
//
// tests/fixtures/lane_spec_hash_vectors.json is a static, committed fixture:
// an array of {name, lane, hash}, one entry per interesting laneSpecHash
// input shape (multibyte text, emoji/astral-plane characters, quotes,
// backslashes, newlines, empty arrays, and a lane missing all three fields
// entirely). It was generated once from this exact `laneSpecHash` by a
// throwaway vitest run and is now pinned by BOTH sides: this test asserts
// laneSpecHash still reproduces every vector's hash (TS regressions caught
// here), and tests/test_lane_hash.py asserts the Python port
// datum/lane_hash.py `lane_spec_hash` reproduces the same vectors (Python
// regressions/divergence caught there). Neither side regenerates the
// fixture — if either implementation's output would change, the fixture
// (and the other side's test) makes that a loud, deliberate diff instead of
// a silent drift that breaks `datum lane-state rehash` skip-condition
// matching against markers written by the TS orchestrator.
// ---------------------------------------------------------------------------

import laneSpecHashVectors from '../../../tests/fixtures/lane_spec_hash_vectors.json'

describe('laneSpecHash — cross-language pin (tests/fixtures/lane_spec_hash_vectors.json)', () => {
  for (const vector of laneSpecHashVectors as Array<{ name: string; lane: Partial<Lane>; hash: string }>) {
    it(`matches pinned vector: ${vector.name}`, () => {
      expect(laneSpecHash(vector.lane as Pick<Lane, 'files' | 'acceptance_criteria' | 'depends_on'>)).toBe(vector.hash)
    })
  }
})
