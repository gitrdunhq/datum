// Tests for task add-cycle-detection: deterministic import-graph cycle
// detection module.
// RED phase — detectCycles is not yet implemented/exported from ./graph.
// These tests must fail (import error, or thrown/undefined-behavior error)
// until the GREEN phase implements and exports detectCycles.

import { describe, it, expect } from 'vitest'
import { detectCycles } from './graph'

interface GraphTask {
  id: string
  depends_on: string[]
}

function makeTasks(depsById: Record<string, string[]>): GraphTask[] {
  return Object.entries(depsById).map(([id, depends_on]) => ({ id, depends_on }))
}

describe('detectCycles', () => {
  // AC1: detectCycles([]) and detectCycles for any acyclic DAG returns []
  it('returns an empty array for an empty task list', () => {
    const result = detectCycles([])
    expect(result).toEqual([])
  })

  it('returns an empty array for any acyclic DAG', () => {
    const tasks = makeTasks({
      A: [],
      B: ['A'],
      C: ['A', 'B'],
      D: ['C'],
    })
    const result = detectCycles(tasks)
    expect(result).toEqual([])
  })

  // AC2: detectCycles detects a direct cycle: A(depends_on:[B]) and
  // B(depends_on:[A]) returns a cycle containing both A and B
  it('detects a direct two-node mutual dependency cycle', () => {
    const tasks = makeTasks({
      A: ['B'],
      B: ['A'],
    })
    const result = detectCycles(tasks)

    expect(result.length).toBeGreaterThan(0)
    const flatMembers = new Set(result.flat())
    expect(flatMembers.has('A')).toBe(true)
    expect(flatMembers.has('B')).toBe(true)
    // The direct cycle must be reported as a single cycle containing both.
    const cycleWithBoth = result.find(
      (cycle) => cycle.includes('A') && cycle.includes('B')
    )
    expect(cycleWithBoth).toBeDefined()
    expect(cycleWithBoth?.length).toBe(2)
  })

  // AC3: detectCycles detects a transitive cycle: A->B->C->A returns a
  // cycle containing A, B, and C
  it('detects a transitive three-node cycle', () => {
    const tasks = makeTasks({
      A: ['B'],
      B: ['C'],
      C: ['A'],
    })
    const result = detectCycles(tasks)

    expect(result.length).toBeGreaterThan(0)
    const cycleWithAll = result.find(
      (cycle) =>
        cycle.includes('A') && cycle.includes('B') && cycle.includes('C')
    )
    expect(cycleWithAll).toBeDefined()
    expect(cycleWithAll?.length).toBe(3)
  })

  // AC4: detectCycles is pure (no I/O, no filesystem, deterministic for
  // identical input)
  it('is deterministic: identical input produces identical output across repeated calls', () => {
    const tasks = makeTasks({
      A: ['B'],
      B: ['C'],
      C: ['A'],
      D: [],
    })

    const first = detectCycles(tasks)
    const second = detectCycles(tasks)
    const third = detectCycles(structuredClone(tasks))

    expect(second).toEqual(first)
    expect(third).toEqual(first)
    // Input must not be mutated as a side effect.
    expect(tasks).toEqual(
      makeTasks({ A: ['B'], B: ['C'], C: ['A'], D: [] })
    )
  })
})
