// Tests for task-002: packWaves partitioner + computeBlockedLanes helper.
// RED phase — packWaves and computeBlockedLanes are not yet exported from
// ./utils. These tests must fail (import error or thrown/undefined-call
// error) until the GREEN phase implements and exports them.

import { describe, it, expect } from 'vitest'
import { buildWaves, packWaves, computeBlockedLanes } from './utils'
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

    const batches = packWaves(waves, 5)
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
      const batches = packWaves(waves, 5)
      assertNoForwardDependency(lanePlan, batches)
    }
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
