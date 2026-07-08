// Tests for task datum-plan-buildorder-and-context: a dependency-cycle
// guard, context_files injection, and a build-order prompt section wired
// into datum-plan.
//
// Covers:
// - shared/utils.ts's `assertAcyclicTasks` export (cycle guard).
// - shared/utils.ts's `buildContextFilesSection` export (context injection).
// - datum-plan.ts calling both helpers before lane-plan generation.
// - prompts/plan-decompose.md's BUILD-ORDER / IMPORT ANALYSIS CHECK and
//   PROJECT BUILD CONSTRAINTS sections.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertAcyclicTasks, buildContextFilesSection } from './shared/utils'

const datumPlanSrc = readFileSync(join(__dirname, 'datum-plan.ts'), 'utf8')

// ---------------------------------------------------------------------------
// AC1 — cyclic dependency graph halts the run with an explicit error naming
// the cyclic task ids, before lane-plan.json is written.
// ---------------------------------------------------------------------------

describe('datum-plan-buildorder-and-context — AC1: cycle guard halts on cyclic tasks', () => {
  it('assertAcyclicTasks throws an Error naming the cyclic task ids for a→b→a', () => {
    const cyclicTasks = [
      { id: 'task-a', depends_on: ['task-b'] },
      { id: 'task-b', depends_on: ['task-a'] },
      { id: 'task-c', depends_on: [] as string[] },
    ]

    expect(() => assertAcyclicTasks(cyclicTasks)).toThrow()
    let caught: Error | undefined
    try {
      assertAcyclicTasks(cyclicTasks)
    } catch (err) {
      caught = err as Error
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught!.message).toMatch(/task-a/)
    expect(caught!.message).toMatch(/task-b/)
    // The acyclic task must NOT be named as part of the cycle.
    expect(caught!.message).not.toMatch(/task-c/)
  })

  it('datum-plan.ts calls the cycle guard on the decomposed tasks before writing tasks.json/lane-plan.json', () => {
    // GREEN must wire `assertAcyclicTasks(tasks)` in before the collapsed
    // write-tasks-json + build-lane-plan agent call that writes
    // "${epicDir}/tasks.json" and "${epicDir}/lane-plan.json".
    expect(datumPlanSrc).toMatch(/assertAcyclicTasks\(\s*tasks\s*\)/)

    const guardIdx = datumPlanSrc.indexOf('assertAcyclicTasks(')
    const writeTasksJsonIdx = datumPlanSrc.indexOf('tasks.json": ${tasksJson}')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(writeTasksJsonIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(writeTasksJsonIdx)
  })
})

// ---------------------------------------------------------------------------
// AC2 — acyclic tasks proceed to lane-plan generation unchanged.
// ---------------------------------------------------------------------------

describe('datum-plan-buildorder-and-context — AC2: acyclic tasks proceed unchanged', () => {
  it('assertAcyclicTasks does not throw for a valid dependency-ordered task list', () => {
    const acyclicTasks = [
      { id: 'task-a', depends_on: [] as string[] },
      { id: 'task-b', depends_on: ['task-a'] },
      { id: 'task-c', depends_on: ['task-a', 'task-b'] },
    ]

    expect(() => assertAcyclicTasks(acyclicTasks)).not.toThrow()
    expect(assertAcyclicTasks(acyclicTasks)).toBeUndefined()
  })

  it('assertAcyclicTasks does not throw for tasks with no depends_on at all', () => {
    const noDeps = [{ id: 'solo-task' }]
    expect(() => assertAcyclicTasks(noDeps)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// AC3 — context_files from the merged config are read, and each existing
// file's full contents (resolved relative to project root) are injected
// into the decompose prompt payload.
// ---------------------------------------------------------------------------

describe('datum-plan-buildorder-and-context — AC3: context_files injection', () => {
  it('injects the full contents of an existing context_files entry into the returned section', () => {
    const sentinel = 'SENTINEL_BUILD_ORDER_CONTENT_9f3c'
    const warnings: string[] = []
    const section = buildContextFilesSection({ 'docs/architecture.md': sentinel }, (msg: string) => warnings.push(msg))

    expect(section).toContain(sentinel)
    expect(section).toContain('PROJECT BUILD CONSTRAINTS')
    expect(warnings).toEqual([])
  })

  it('datum-plan.ts reads context_files from repoCfg via agent() and wires buildContextFilesSection into the decompose prompt call', () => {
    expect(datumPlanSrc).toMatch(/repoCfg\.context_files/)
    expect(datumPlanSrc).toMatch(/buildContextFilesSection\(/)
    // Must not reintroduce direct fs access — workflow scripts run sandboxed.
    expect(datumPlanSrc).not.toMatch(/from 'node:fs'/)
    expect(datumPlanSrc).not.toMatch(/from 'node:path'/)

    const cfgIdx = datumPlanSrc.indexOf('repoCfg.context_files')
    const decomposeCallIdx = datumPlanSrc.indexOf('planDecomposeTemplate')
    expect(cfgIdx).toBeGreaterThan(-1)
    expect(decomposeCallIdx).toBeGreaterThan(-1)
    expect(cfgIdx).toBeLessThan(decomposeCallIdx)
  })
})

// ---------------------------------------------------------------------------
// AC4 — a context_files entry whose path does not exist relative to project
// root logs a warning and is skipped; the run continues (no throw).
// ---------------------------------------------------------------------------

describe('datum-plan-buildorder-and-context — AC4: missing context_files entry warns and is skipped', () => {
  it('does not throw and calls the warn callback naming the missing path', () => {
    const warnings: string[] = []

    let section: string | undefined
    expect(() => {
      section = buildContextFilesSection({ 'docs/does-not-exist.md': null }, (msg: string) => warnings.push(msg))
    }).not.toThrow()

    expect(warnings.length).toBe(1)
    expect(warnings[0]).toMatch(/docs\/does-not-exist\.md/)
    // The missing file must not silently appear as injected content.
    expect(section).not.toContain('does-not-exist')
  })

  it('mixes a missing entry with an existing one: existing content is injected, missing one only warns', () => {
    const sentinel = 'SENTINEL_PRESENT_FILE_7ad1'
    const warnings: string[] = []
    const section = buildContextFilesSection(
      { 'docs/present.md': sentinel, 'docs/absent.md': null },
      (msg: string) => warnings.push(msg),
    )

    expect(section).toContain(sentinel)
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toMatch(/docs\/absent\.md/)
  })
})

// ---------------------------------------------------------------------------
// AC5 — when context_files is absent or [], no context-files prompt section
// content is injected; the decompose prompt payload stays backward
// compatible (byte-identical to today's).
// ---------------------------------------------------------------------------

describe('datum-plan-buildorder-and-context — AC5: absent/empty context_files is a no-op', () => {
  it('returns an empty string when fileContents is undefined', () => {
    const warnings: string[] = []
    const section = buildContextFilesSection(undefined, (msg: string) => warnings.push(msg))
    expect(section).toBe('')
    expect(warnings).toEqual([])
  })

  it('returns an empty string when fileContents is an empty object', () => {
    const warnings: string[] = []
    const section = buildContextFilesSection({}, (msg: string) => warnings.push(msg))
    expect(section).toBe('')
    expect(warnings).toEqual([])
  })

  it('an empty context-files section never introduces a PROJECT BUILD CONSTRAINTS header', () => {
    const section = buildContextFilesSection({}, () => {})
    expect(section).not.toContain('PROJECT BUILD CONSTRAINTS')
  })
})

// ---------------------------------------------------------------------------
// AC6 — prompts/plan-decompose.md contains a BUILD-ORDER / IMPORT ANALYSIS
// CHECK section and a PROJECT BUILD CONSTRAINTS section that references
// context_files and states project docs take precedence over inferred
// imports.
// ---------------------------------------------------------------------------

describe('datum-plan-buildorder-and-context — AC6: plan-decompose.md build-order + constraints sections', () => {
  const decomposeTemplate = readFileSync(join(__dirname, 'prompts', 'plan-decompose.md'), 'utf8')

  it('contains a BUILD-ORDER or IMPORT ANALYSIS CHECK section title', () => {
    expect(decomposeTemplate).toMatch(/BUILD-ORDER|IMPORT ANALYSIS CHECK/)
  })

  it('contains a PROJECT BUILD CONSTRAINTS section', () => {
    expect(decomposeTemplate).toMatch(/PROJECT BUILD CONSTRAINTS/)
  })

  it('the PROJECT BUILD CONSTRAINTS section references context_files and states project docs take precedence over inferred imports', () => {
    const idx = decomposeTemplate.indexOf('PROJECT BUILD CONSTRAINTS')
    expect(idx).toBeGreaterThan(-1)
    const section = decomposeTemplate.slice(idx, idx + 2000)
    expect(section).toMatch(/context_files/)
    expect(section).toMatch(/precedence/i)
  })
})
