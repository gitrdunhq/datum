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

// ---------------------------------------------------------------------------
// #352 — the decompose prompt must ask for `task-NNN` ids (the schemas
// require ^task-\d+$) plus a descriptive `slug`, and the plan gate must run
// right after `datum lane-plan` — before the skeleton/deepen phases commit.
// ---------------------------------------------------------------------------

const decomposePrompt = readFileSync(join(__dirname, 'prompts', 'plan-decompose.md'), 'utf8')

describe('#352 — decompose prompt id/slug contract', () => {
  it('asks for zero-padded task-NNN ids and a slug, not descriptive ids', () => {
    expect(decomposePrompt).not.toMatch(/DESCRIPTIVE task IDs/)
    expect(decomposePrompt).toMatch(/task-001/)
    expect(decomposePrompt).toMatch(/"slug"/)
    expect(decomposePrompt).toMatch(/\^\[a-z0-9\]\[a-z0-9-\]\{2,60\}\$/)
    // The example object must model the contract it describes.
    expect(decomposePrompt).toMatch(/"id":\s*"task-001"/)
    expect(decomposePrompt).not.toMatch(/"id":\s*"descriptive-task-id"/)
  })
})

describe('#352 — plan gate ordering', () => {
  // The gate is rendered from prompts/util-run-gate.md with phase 'plan';
  // the FIRST such call must be the early one.
  const gateIdx = datumPlanSrc.indexOf("renderPrompt(runGateTemplate, { phase: 'plan'")
  const lanePlanIdx = datumPlanSrc.indexOf('datum lane-plan --input')
  const skeletonIdx = datumPlanSrc.indexOf('datum skeleton --batch')
  const triageIdx = datumPlanSrc.indexOf("phase('Triage')")

  it('runs a plan gate after datum lane-plan and before the skeleton batch', () => {
    expect(lanePlanIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeGreaterThan(lanePlanIdx)
    expect(gateIdx).toBeLessThan(skeletonIdx)
    expect(gateIdx).toBeLessThan(triageIdx)
  })

  it('does not commit the plan artifacts until the early gate has passed', () => {
    const commitIdx = datumPlanSrc.indexOf('git commit -m "plan: tasks.json')
    expect(commitIdx).toBeGreaterThan(-1)
    expect(commitIdx).toBeGreaterThan(gateIdx)
    expect(commitIdx).toBeLessThan(skeletonIdx)
  })

  it('halts (throws) when the early gate reports a hard failure', () => {
    // A failing schema gate must abort the run before anything is committed.
    const earlyGateBlock = datumPlanSrc.slice(gateIdx, skeletonIdx)
    expect(earlyGateBlock).toMatch(/throw new Error\(/)
  })
})

// ---------------------------------------------------------------------------
// Determinism fix — datum-plan.ts must no longer relay config/context files
// through an LLM "read this file back to me" agent call. A 90KB relay came
// back abridged in eedom dogfooding, and nothing verified the relay. Config
// merge is now a deterministic batch (cat + parse) + mergeConfig(); context
// files are read via one batch with a byte-count check per file, failing
// loud on mismatch instead of silently planning on an abridged file.
// ---------------------------------------------------------------------------

describe('determinism fix — config read is a deterministic batch, not an LLM relay', () => {
  it('no longer calls agent(READ_CONFIG_PROMPT ...)', () => {
    expect(datumPlanSrc).not.toMatch(/agent\(\s*READ_CONFIG_PROMPT/)
  })

  it('imports mergeConfig from shared/models and batch helpers from shared/batch', () => {
    expect(datumPlanSrc).toMatch(/import\s*\{[^}]*mergeConfig[^}]*\}\s*from\s*'\.\/shared\/models'/)
    expect(datumPlanSrc).toMatch(/import\s*\{[^}]*\}\s*from\s*'\.\/shared\/batch'/)
    expect(datumPlanSrc).toMatch(/batchCommandPrompt/)
    expect(datumPlanSrc).toMatch(/parseBatchResult/)
    expect(datumPlanSrc).toMatch(/stepStdout/)
  })

  it('reads repo config and global config as two named batch steps', () => {
    expect(datumPlanSrc).toMatch(/['"`]repo-config['"`]/)
    expect(datumPlanSrc).toMatch(/['"`]global-config['"`]/)
    expect(datumPlanSrc).toMatch(/cat \.datum\/config\.json/)
  })

  it('fails loud with the promised message when repo config is missing', () => {
    expect(datumPlanSrc).toMatch(/missing \.datum\/config\.json — run datum init first/)
  })

  it('calls mergeConfig with parsed global/repo config before deriving language/test_framework', () => {
    const mergeIdx = datumPlanSrc.indexOf('mergeConfig(')
    const languageIdx = datumPlanSrc.indexOf("repoCfg.language")
    expect(mergeIdx).toBeGreaterThan(-1)
    expect(languageIdx).toBeGreaterThan(-1)
    expect(mergeIdx).toBeLessThan(languageIdx)
  })
})

describe('determinism fix — context_files relay is one verified batch, not a per-file LLM echo', () => {
  it('no longer issues a per-file "Read the file at path" agent prompt in a loop', () => {
    expect(datumPlanSrc).not.toMatch(/Read the file at path/)
    expect(datumPlanSrc).not.toMatch(/read-context-file:\$\{relPath\}/)
  })

  it('uses a wc -c byte-count step alongside the cat step for each context file', () => {
    expect(datumPlanSrc).toMatch(/wc -c/)
  })

  it('verifies declared vs actual byte length using Buffer.byteLength and fails loud on mismatch', () => {
    expect(datumPlanSrc).toMatch(/Buffer\.byteLength\(/)
    expect(datumPlanSrc).toMatch(/context_relay_mismatch/)
  })

  it('caps relay at 64KB and skips (with a size warning) oversized context files instead of relaying an abridged copy', () => {
    expect(datumPlanSrc).toMatch(/64\s*\*\s*1024|65536/)
    expect(datumPlanSrc).toMatch(/exceeds relay limit/)
  })
})

describe('datum-plan — deterministic gate verdict', () => {
  const src = readFileSync(join(__dirname, 'datum-plan.ts'), 'utf8')
  it('runs the gate through gateSteps/parseGateResult, not the util-run-gate LLM relay', () => {
    expect(src).not.toMatch(/util-run-gate/)
    expect(src).toMatch(/gateSteps\('plan', yolo \? ' --approve' : ''\)/)
    expect(src).toMatch(/parseGateResult\(/)
    // publishing tracker issues is still gated on the verdict
    expect(src).toMatch(/if \(gate\.passed\) \{\s*\n\s*const published = await publishLanePlan/)
  })
})
