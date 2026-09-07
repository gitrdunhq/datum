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
    // GREEN must wire `assertAcyclicTasks(tasks)` in before the build batch
    // (planBuildSteps) that writes "${epicDir}/tasks.json" and runs
    // datum lane-plan.
    expect(datumPlanSrc).toMatch(/assertAcyclicTasks\(\s*tasks\s*\)/)

    const guardIdx = datumPlanSrc.indexOf('assertAcyclicTasks(')
    const writeTasksJsonIdx = datumPlanSrc.indexOf('planBuildSteps({ epicDir, tasksJson })')
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
  // The gate runs as a deterministic batch step (shared/gate.ts) with phase
  // 'plan'; the FIRST such call must be the early one (--approve: structural
  // checks only, the human hold is re-checked by the final gate).
  const gateIdx = datumPlanSrc.indexOf("gateSteps('plan', ' --approve')")
  const lanePlanIdx = datumPlanSrc.indexOf('planBuildSteps({ epicDir, tasksJson })')
  const skeletonIdx = datumPlanSrc.indexOf('skeletonBatchSteps({ epicDir, language })')
  const triageIdx = datumPlanSrc.indexOf("phase('Triage')")

  it('runs a plan gate after datum lane-plan and before the skeleton batch', () => {
    expect(lanePlanIdx).toBeGreaterThan(-1)
    expect(skeletonIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeGreaterThan(lanePlanIdx)
    expect(gateIdx).toBeLessThan(skeletonIdx)
    expect(gateIdx).toBeLessThan(triageIdx)
  })

  it('does not commit the plan artifacts until the early gate has passed', () => {
    const commitIdx = datumPlanSrc.indexOf("'plan: tasks.json + lane-plan.json + TASKS.md'")
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
// The build, the plan commit, the skeleton batch and the post-deepen rebuild
// were "Run these commands" agents: the runner was handed the whole
// tasks.json text and trusted to write it verbatim and report {"exit_code"}.
// A runner that abridged or re-serialised a task wrote a different plan than
// decompose produced, and the schema gate still passed. Every one of them is
// now a batch whose exit codes the script reads; the tasks.json write is
// byte-verified against the blob sha of the bytes the script intended.
// ---------------------------------------------------------------------------

// Triage: the agent decided AND wrote .datum/routing.json AND committed it,
// reply discarded — and `datum gate triage`, the check that routing.json
// exists with a valid decision, had no caller. Now the agent only decides;
// the script writes routing.json from the parsed decision (byte-verified),
// commits it, and runs the triage gate.
describe('datum-plan — triage decision is written, committed and gated by the script', () => {
  it('the triage prompt no longer asks the agent to write routing.json or commit', () => {
    const idx = datumPlanSrc.indexOf("label: 'triage-decision'")
    expect(idx).toBeGreaterThan(-1)
    const block = datumPlanSrc.slice(idx - 600, idx)
    expect(block).not.toMatch(/routing\.json/)
    expect(block).not.toMatch(/git commit/)
  })

  // elonchesd wf_1b098b4d-33c: the routing commit failed `git add exited 1:
  // .datum | hint: Use -f` — datum's own gitignore-check ignores .datum run
  // state, and a consumer's global excludes can ignore the whole directory.
  // routing.json is run state read from disk by `datum gate triage`; no
  // consumer reads it from git, so it is written and gated, never committed.
  it('writes .datum/routing.json from the parsed decision through writeFileSteps, runs gateSteps("triage") on it, and never commits it', () => {
    const triageIdx = datumPlanSrc.indexOf('const triage: TriageDecision')
    const writeIdx = datumPlanSrc.indexOf("writeFileSteps({ path: '.datum/routing.json', content: routingJson })")
    const gateIdx = datumPlanSrc.indexOf("gateSteps('triage', '')")
    const deepenIdx = datumPlanSrc.indexOf("if (triage.decision === 'deepen')")
    expect(triageIdx).toBeGreaterThan(-1)
    expect(writeIdx).toBeGreaterThan(triageIdx)
    expect(gateIdx).toBeGreaterThan(writeIdx)
    expect(deepenIdx).toBeGreaterThan(gateIdx)
    expect(datumPlanSrc).not.toMatch(/commitPlanFiles\(\['\.datum\//)
    expect(datumPlanSrc).toMatch(/throw new Error\(`Triage gate failed/)
  })

  it('no commit batch in any phase script adds a path under .datum (run state, ignored in consumer repos)', () => {
    for (const f of ['datum-refine.ts', 'datum-plan.ts', 'datum-properties.ts', 'datum-validate.ts', 'datum-review.ts', 'datum-closeout.ts', 'datum-tdd-act-docs.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8')
      expect(src, f).not.toMatch(/commit\w*\(\[[^\]]*'\.datum\//)
      expect(src, f).not.toMatch(/files: \[[^\]]*'\.datum\//)
    }
  })
})

describe('datum-plan — build/commit/skeleton/rebuild are batches, not "Run these commands" agents', () => {
  it('no agent prompt asks the runner to write tasks.json or to git commit', () => {
    expect(datumPlanSrc).not.toMatch(/Write this JSON to/)
    expect(datumPlanSrc).not.toMatch(/Do these steps in order/)
    expect(datumPlanSrc).not.toMatch(/Run these commands in order/)
    expect(datumPlanSrc).not.toMatch(/Commit the plan artifacts/)
    expect(datumPlanSrc).not.toMatch(/git commit -m "plan: (tasks\.json|pre-generate|deepen)/)
  })

  it('verifies the tasks.json write against tasksJsonBlobSha and halts on plan_write_mismatch / plan_build_failed', () => {
    expect(datumPlanSrc).toMatch(/planBuildFromSteps\(await runBatch\(/)
    expect(datumPlanSrc).toMatch(/tasksJsonBlobSha\(tasksJson\)/)
    expect(datumPlanSrc).toMatch(/if \(!build\.ok\) throw new Error\(build\.error\)/)
  })

  it('commits the plan artifacts and the skeletons through commitFilesSteps and halts on a failed commit', () => {
    // One helper, commitPlanFiles, wraps commitFilesSteps/commitFilesFromSteps
    // and halts by name; every plan commit goes through it.
    expect(datumPlanSrc).toMatch(/commitFilesSteps\(\{ wt: '\.', files, message \}\)/)
    expect(datumPlanSrc).toMatch(/commitFilesFromSteps\(await runBatch\(/)
    expect(datumPlanSrc).toMatch(/commitPlanFiles\(\s*\[`\$\{epicDir\}\/tasks\.json`, `\$\{epicDir\}\/lane-plan\.json`, `\$\{epicDir\}\/TASKS\.md`\],\s*'plan: tasks\.json \+ lane-plan\.json \+ TASKS\.md',/)
    expect(datumPlanSrc).toMatch(/commitPlanFiles\(\[skeletonDir\], 'plan: pre-generate RED skeletons'/)
    expect(datumPlanSrc).toMatch(/throw new Error\(`plan_commit_failed: /)
  })

  it('after deepen there is NO lane-plan rebuild — it regenerated TASKS.md from tasks.json and wiped the appended Research Findings', () => {
    // plan-deepen.md is append-only to TASKS.md (tasks.json is untouched), so
    // `datum lane-plan --md-output TASKS.md` afterwards had nothing new to
    // build and overwrote the findings the agent had just appended — the
    // very section `datum gate deepen` requires. The findings are committed
    // deterministically instead, and the deepen gate (a producer nothing
    // consumed) now runs on them.
    const deepenIdx = datumPlanSrc.indexOf("label: 'deepen-research'")
    expect(deepenIdx).toBeGreaterThan(-1)
    const block = datumPlanSrc.slice(deepenIdx - 800, deepenIdx)
    expect(block).not.toMatch(/datum lane-plan --input/)
    expect(block).not.toMatch(/git commit/)
    const after = datumPlanSrc.slice(deepenIdx)
    expect(after).not.toMatch(/datum lane-plan --input/)
    expect(after).toMatch(/commitPlanFiles\(\[`\$\{epicDir\}\/TASKS\.md`\], 'plan: deepen - research findings'/)
    expect(after).toMatch(/gateSteps\('deepen', ''\)/)
    expect(after).toMatch(/throw new Error\(`Deepen gate failed/)
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
    expect(datumPlanSrc).not.toMatch(/READ_CONFIG_PROMPT/)
  })

  it('imports configReadSteps/configFromSteps from shared/config-steps and batch helpers from shared/batch', () => {
    expect(datumPlanSrc).toMatch(/import\s*\{[^}]*configReadSteps[^}]*configFromSteps[^}]*\}\s*from\s*'\.\/shared\/config-steps'/)
    expect(datumPlanSrc).toMatch(/import\s*\{[^}]*\}\s*from\s*'\.\/shared\/batch'/)
    expect(datumPlanSrc).toMatch(/batchCommandPrompt/)
    expect(datumPlanSrc).toMatch(/parseBatchResult/)
  })

  it('reads config via configReadSteps() before deriving language/test_framework', () => {
    const readIdx = datumPlanSrc.indexOf('configReadSteps(')
    const configFromIdx = datumPlanSrc.indexOf('configFromSteps(')
    const languageIdx = datumPlanSrc.indexOf('repoCfg.language')
    expect(readIdx).toBeGreaterThan(-1)
    expect(configFromIdx).toBeGreaterThan(-1)
    expect(languageIdx).toBeGreaterThan(-1)
    expect(readIdx).toBeLessThan(configFromIdx)
    expect(configFromIdx).toBeLessThan(languageIdx)
  })
})

describe('determinism fix — context_files relay is one verified batch, not a per-file LLM echo', () => {
  it('no longer issues a per-file "Read the file at path" agent prompt in a loop', () => {
    expect(datumPlanSrc).not.toMatch(/Read the file at path/)
    expect(datumPlanSrc).not.toMatch(/read-context-file:\$\{relPath\}/)
  })

  it('probes sizes/hashes first and inlines only the files that fit the relay budget (shared/context-relay.ts)', () => {
    // The probe/inline split, the budget and the byte verification all live
    // in the shared module (its own tests cover them); the script must route
    // context_files through it rather than cat everything in one batch.
    expect(datumPlanSrc).toMatch(/contextProbeSteps\(\{ files: contextFilesList \}\)/)
    expect(datumPlanSrc).toMatch(/contextRelayPlan\(cfProbe, contextFilesList\)/)
    expect(datumPlanSrc).toMatch(/contextInlineSteps\(cfPlan\.inline\)/)
    expect(datumPlanSrc).not.toMatch(/name: `ctx-cat-\$\{i\}`/)
  })

  it('hands oversized files to the decompose agent by path + bytes + hash instead of relaying an abridged copy', () => {
    const relaySrc = readFileSync(join(__dirname, 'shared', 'context-relay.ts'), 'utf8')
    expect(relaySrc).toMatch(/CONTEXT_RELAY_BUDGET_BYTES = 16 \* 1024/)
    expect(relaySrc).toMatch(/Read tool/)
    expect(datumPlanSrc).toMatch(/contextFileContents\[relPath\] = f\.exists \? contextSlot\(f\) : null/)
  })
})

// ---------------------------------------------------------------------------
// Determinism fix (#368 follow-up) — the top-of-file "Read" phase relayed
// SPEC.md / CURRENT_STATE.md / prior-failure data through an LLM `reader`
// agent echoing util-read-context.md's JSON contract back verbatim. That
// relay is replaced with the deterministic readContextSteps/contextFromSteps
// batch already used by datum-refine.ts / datum-properties.ts; SPEC.md is
// byte-verified, current_state/prior_defects/error_history ride along as
// tolerant extraCommands.
// ---------------------------------------------------------------------------

describe('determinism fix — top-of-file Read phase is a deterministic batch, not an LLM relay', () => {
  it('no longer imports the util-read-context.md LLM relay prompt', () => {
    expect(datumPlanSrc).not.toMatch(/from '\.\/prompts\/util-read-context\.md'/)
  })

  it('reads SPEC.md and context_files through the two-phase budgeted relay (probe → plan → inline → slot)', () => {
    // A 31 KB SPEC relayed in one batch was spilled by the harness and the
    // runner fabricated the echo (caught as context_relay_mismatch). Large
    // files are handed to the agents by path + hash instead.
    expect(datumPlanSrc).toMatch(/from '\.\/shared\/context-relay'/)
    expect(datumPlanSrc).toMatch(/contextProbeSteps\(/)
    expect(datumPlanSrc).toMatch(/contextRelayPlan\(/)
    expect(datumPlanSrc).toMatch(/contextInlineSteps\(/)
    expect(datumPlanSrc).toMatch(/const specContent: string = contextSlot\(specFile\)/)
    expect(datumPlanSrc).toMatch(/contextFileContents\[relPath\] = f\.exists \? contextSlot\(f\) : null/)
    expect(datumPlanSrc).not.toMatch(/readContextSteps\(|contextFromSteps\(|Buffer\.byteLength|utf8ByteLength\(/)
  })

  it('fails loud with context_relay_mismatch, not a silent fallback, when a relay batch returns nothing parseable', () => {
    const relaySrc = readFileSync(join(__dirname, 'shared', 'context-relay.ts'), 'utf8')
    expect(relaySrc).toMatch(/context_relay_mismatch/)
    expect(datumPlanSrc).toMatch(/contextFromRelay\(readBatch, inlineBatch, relayPlan\)/)
    expect(datumPlanSrc).toMatch(/contextFromRelay\(cfProbe, cfInline, cfPlan\)/)
  })

  it('carries current_state / prior_defects / error_history as extraCommands, not through the LLM relay', () => {
    expect(datumPlanSrc).toMatch(/name:\s*'current-state'/)
    expect(datumPlanSrc).toMatch(/name:\s*'prior-defects'/)
    expect(datumPlanSrc).toMatch(/name:\s*'error-history'/)
    expect(datumPlanSrc).toMatch(/CURRENT_STATE\.md/)
    expect(datumPlanSrc).toMatch(/\.datum\/ERRORS\.md/)
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

// ---------------------------------------------------------------------------
// FLOW.md open gap 2 — a deferred specContent (contextSlot's Read
// instruction) is never verified as actually read. propose-approaches is the
// only decompose-phase agent that both consumes specContent directly and
// parses a JSON object back — that's the one wired to the read-witness gate.
// decompose-tasks is NOT gated: its contract is a bare JSON array (feeds
// datum lane-plan's schema validation), with no object slot for a
// read_witness field without changing that contract.
// ---------------------------------------------------------------------------

describe('datum-plan — read-witness gate on propose-approaches (FLOW.md open gap 2)', () => {
  it('imports contextWitnessInstruction and assertReadWitness from shared/context-relay', () => {
    expect(datumPlanSrc).toMatch(/contextWitnessInstruction/)
    expect(datumPlanSrc).toMatch(/assertReadWitness/)
  })

  it('appends contextWitnessInstruction([specFile]) to the propose-approaches prompt', () => {
    const idx = datumPlanSrc.indexOf("label: 'propose-approaches'")
    expect(idx).toBeGreaterThan(-1)
    const block = datumPlanSrc.slice(Math.max(0, idx - 400), idx)
    expect(block).toMatch(/contextWitnessInstruction\(\[specFile\]\)/)
  })

  it('gates the parsed approaches result with assertReadWitness before it is used to choose an approach', () => {
    const parseIdx = datumPlanSrc.indexOf('const approaches: ApproachResult')
    const assertIdx = datumPlanSrc.indexOf('assertReadWitness([specFile], approaches)')
    const chosenIdx = datumPlanSrc.indexOf('const chosen: Approach')
    expect(parseIdx).toBeGreaterThan(-1)
    expect(assertIdx).toBeGreaterThan(parseIdx)
    expect(assertIdx).toBeLessThan(chosenIdx)
  })

  it('appends contextWitnessWrapInstruction(decomposeFiles, "tasks") to the decompose-tasks prompt', () => {
    const idx = datumPlanSrc.indexOf("label: 'decompose-tasks'")
    expect(idx).toBeGreaterThan(-1)
    const block = datumPlanSrc.slice(Math.max(0, idx - 500), idx)
    expect(block).toMatch(/contextWitnessWrapInstruction\(decomposeFiles, 'tasks'\)/)
  })

  it('decomposeFiles covers the SPEC and every existing context_file — all of them can be deferred', () => {
    expect(datumPlanSrc).toMatch(/const decomposeFiles: ContextFile\[\] = \[specFile, \.\.\.contextFileEntries\]/)
    expect(datumPlanSrc).toMatch(/contextFileEntries\.push\(f\)/)
  })

  it('gates the parsed decompose result with assertReadWitness, then unwraps the array, before the cycle check', () => {
    const parseIdx = datumPlanSrc.indexOf('const tasksParsed')
    const assertIdx = datumPlanSrc.indexOf('assertReadWitness(decomposeFiles, tasksParsed)')
    const unwrapIdx = datumPlanSrc.indexOf("unwrapWitnessedArray(tasksParsed, 'tasks')")
    const acyclicIdx = datumPlanSrc.indexOf('assertAcyclicTasks(tasks)')
    expect(parseIdx).toBeGreaterThan(-1)
    expect(assertIdx).toBeGreaterThan(parseIdx)
    expect(unwrapIdx).toBeGreaterThan(assertIdx)
    expect(acyclicIdx).toBeGreaterThan(unwrapIdx)
  })

  it('the named failure lives in shared/context-relay.ts, not a bespoke throw here', () => {
    const relaySrc = readFileSync(join(__dirname, 'shared', 'context-relay.ts'), 'utf8')
    expect(relaySrc).toMatch(/context_read_unverified/)
  })
})

// ---------------------------------------------------------------------------
// FLOW.md design principle 2 — an unparseable propose-approaches response
// must not silently become {approaches: []}: `chosen` would end up undefined
// and decompose-tasks would run against a nonexistent approach with no trace.
// ---------------------------------------------------------------------------

describe('datum-plan — propose-approaches uses the strict parser', () => {
  it('imports parseAgentJsonStrict', () => {
    expect(datumPlanSrc).toMatch(/import \{[^}]*parseAgentJsonStrict[^}]*\} from '\.\/shared\/utils'/)
  })

  it('approaches is parsed with parseAgentJsonStrict labelled "propose-approaches"', () => {
    expect(datumPlanSrc).toMatch(/const approaches: ApproachResult = parseAgentJsonStrict<ApproachResult>\(approachesRaw as string, 'propose-approaches'\)/)
  })
})

// Phase review wf_9a69f891-462: a parseable {approaches: []} left `chosen`
// undefined and "undefined" flowed into the decompose prompt.
describe('datum-plan — an empty approaches array halts by name', () => {
  const src = readFileSync(join(__dirname, 'datum-plan.ts'), 'utf8')
  it('throws plan_no_approaches before selecting the chosen approach', () => {
    expect(src).toMatch(/if \(!Array\.isArray\(approaches\.approaches\) \|\| approaches\.approaches\.length === 0\) throw new Error\(`plan_no_approaches:/)
    expect(src.indexOf('plan_no_approaches')).toBeLessThan(src.indexOf('const chosen: Approach'))
  })
})

// caliper eedom wf_9bf2c994-801 (#566): the runner dropped a 340-byte span
// from the middle of a relayed QUESTIONS.md. A mismatched inline file is
// re-fetched once with a fresh runner (a distinct prompt, so a resume does
// not replay the corrupted result) and merged; what still mismatches is
// deferred to the consuming agent, never a halt.
describe('a mismatched inline relay is re-fetched once, then deferred', () => {
  const src = readFileSync(join(__dirname, 'datum-plan.ts'), 'utf8')
  it('retries with contextInlineRetryPrompt and merges with mergeRelayRetry', () => {
    expect(src).toMatch(/contextInlineRetryPrompt\(/)
    expect(src).toMatch(/mergeRelayRetry\(/)
    expect(src).toMatch(/context_relay_mismatch on /)
  })
})

// elonchesd datum/player-guidance wf_251cf8a3-363: 15 agents and 20 minutes
// of planning, then the plan gate failed on SPEC.md's Assumption Audit, a
// refine artifact that never changes during plan. Plan checks refine's own
// gate (structural, --approve) right after Read, before any planning agent,
// and halts by name with the gate's message when it fails.
describe('datum-plan checks the refine gate before any planning agent', () => {
  it('runs gateSteps("refine", " --approve") between Read and Decompose and names plan_prerequisite_failed', () => {
    const refineGateAt = datumPlanSrc.indexOf("gateSteps('refine', ' --approve')")
    expect(refineGateAt).toBeGreaterThan(datumPlanSrc.indexOf("phase('Read')"))
    expect(refineGateAt).toBeLessThan(datumPlanSrc.indexOf("phase('Decompose')"))
    expect(datumPlanSrc.slice(refineGateAt, refineGateAt + 900)).toMatch(/plan_prerequisite_failed/)
  })
})

// datum self-hosted wf_2749a43b-680: the decomposer listed the generated
// bundle skills/datum-properties.js beside its prompt source. The prompt
// says so once, centrally; lane-plan enforces it.
describe('the decompose prompt forbids generated files in a task\'s files', () => {
  it('names the @generated banner and says generated outputs are rebuilt, never edited', () => {
    const prompt = readFileSync(join(__dirname, 'prompts', 'plan-decompose.md'), 'utf8')
    expect(prompt).toMatch(/@generated/)
    expect(prompt).toMatch(/never (list|include)/i)
    expect(prompt).toMatch(/rebuilt|regenerated/i)
  })
})

// DEV-002 in the operator's coding rules: vertical slices are shippable,
// testable units cut through every layer, one thin end-to-end slice before
// expanding, never all-state-then-all-UI. The decompose prompt asked for
// modules with file ownership and got one lane per module (integration-lanes
// epic: nine module lanes, the ordering defect found only in review).
describe('plan-decompose.md — a task is a vertical slice', () => {
  const decompose = readFileSync(join(__dirname, 'prompts', 'plan-decompose.md'), 'utf8')
  it('defines a task as a shippable, testable slice through every layer, first slice thin, never layer-by-layer', () => {
    expect(decompose).toMatch(/VERTICAL SLICES/)
    expect(decompose).toMatch(/shippable/i)
    expect(decompose).toMatch(/every layer/i)
    expect(decompose).toMatch(/all-state-then-all-UI|one layer per task|layer-by-layer/i)
    expect(decompose).toMatch(/thin/i)
    expect(decompose).toMatch(/plan_not_sliced/)
  })
})

// #372: two independent lanes each created a new ADR under docs/adr/ and both
// chose 012, so the second lane hit file_ownership_violation at GREEN. The
// gate now halts as plan_adr_sequence_collision; the planner is told the rule
// so it does not produce the plan in the first place.
describe('plan-decompose.md — ADR sequence numbers are unique across lanes', () => {
  const decompose = readFileSync(join(__dirname, 'prompts', 'plan-decompose.md'), 'utf8')
  it('tells the planner to make docs/adr/NNN unique and continue from the highest existing number', () => {
    expect(decompose).toMatch(/docs\/adr\/NNN/)
    expect(decompose).toMatch(/unique/i)
    expect(decompose).toMatch(/highest/i)
    expect(decompose).toMatch(/plan_adr_sequence_collision/)
  })
})
