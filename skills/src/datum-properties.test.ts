// datum-properties.ts previously had zero dedicated test coverage — this
// file covers the args-parsing idiom, the agent_types precedence rule, the
// SPEC.md/TASKS.md guards, and (below) a real bug: ctx.epic_dir was used
// directly with no fallback, unlike every sibling phase script that reads
// the same read-context field.
//
// The workflow scripts are sandbox programs (host-injected `agent`, `args`,
// `phase`, `log`) and cannot be imported by vitest, so — matching
// datum-plan.test.ts / datum-validate.test.ts — this walks the raw
// TypeScript source for the properties that can't be exercised by calling
// an exported pure function directly.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const propertiesSrc = readFileSync(join(__dirname, 'datum-properties.ts'), 'utf8')

describe('datum-properties — args parsing', () => {
  it('accepts the bare yolo string and JSON args, matching the shared inline idiom', () => {
    expect(propertiesSrc).toMatch(/rawArgs\.toLowerCase\(\) === 'yolo'/)
    expect(propertiesSrc).toMatch(/JSON\.parse\(args\)/)
    expect(propertiesSrc).toMatch(/const yolo: boolean = !!a\.yolo/)
  })
})

describe('datum-properties — agent_types precedence (#368)', () => {
  it('args.agentTypes (from datum-go) is applied first; the config.json agent_types field is only the standalone fallback', () => {
    const fromArgs = propertiesSrc.indexOf('configureAgentTypes(a.agentTypes)')
    expect(fromArgs).toBeGreaterThan(-1)
    // The fallback configure is guarded on the parent switches being absent
    // and reads the batch's agent-types step.
    const fallback = propertiesSrc.indexOf("configureAgentTypes({ agentTypes: agentTypesRaw !== 'false' })")
    expect(fallback).toBeGreaterThan(fromArgs)
    const guard = propertiesSrc.slice(propertiesSrc.lastIndexOf('if (', fallback), fallback)
    expect(guard).toMatch(/!\(a\.agentTypes && typeof a\.agentTypes === 'object'\)/)
    // And the read that precedes configuration never carries an agentType on its own.
    expect(propertiesSrc).toMatch(/bootstrapOpts\('cli', \{ label: 'read-context'/)
  })
})

describe('datum-properties — Read phase guards', () => {
  it('throws when SPEC.md is missing, telling the operator to run datum-refine first', () => {
    expect(propertiesSrc).toMatch(/if \(!specFile\.exists\) throw new Error\(.*datum-refine/)
  })
  it('throws when TASKS.md is missing, telling the operator to run datum-plan first', () => {
    expect(propertiesSrc).toMatch(/if \(!tasksFile\.exists\) throw new Error\(.*datum-plan/)
  })
})

// ---------------------------------------------------------------------------
// Determinism fix: the Read phase used to hand an LLM `reader` agent
// util-read-context.md and trust its echoed JSON verbatim for SPEC.md's and
// TASKS.md's full contents — an LLM echoing a file is lossy (a 90 KB relay
// came back as 6.7 KB of "successful" abridged content in dogfooding), and
// nothing verified it. Mirrors the fix already applied to datum-plan.ts's
// context_files relay (commit a7093d2): one batched cat + wc -c per file,
// verified with Buffer.byteLength before the file's content is trusted.
// epicDir itself is now always derived deterministically by the epic-dir
// batch step (readContextSteps/contextFromSteps), so the old missing-fallback
// bug (ctx.epic_dir used raw, no `|| docs/epics/${ctx.branch}` guard) no
// longer has a code path where it could recur.
// ---------------------------------------------------------------------------

describe('datum-properties — SPEC.md/TASKS.md relay is a byte-verified batch, not an LLM echo', () => {
  it('no longer imports the util-read-context.md LLM relay prompt', () => {
    expect(propertiesSrc).not.toMatch(/from '\.\/prompts\/util-read-context\.md'/)
  })

  it('reads SPEC.md/TASKS.md through the two-phase budgeted relay (probe → plan → inline → slot)', () => {
    expect(propertiesSrc).toMatch(/contextProbeSteps\(/)
    expect(propertiesSrc).toMatch(/contextRelayPlan\(/)
    expect(propertiesSrc).toMatch(/contextInlineSteps\(/)
    expect(propertiesSrc).toMatch(/contextFromRelay\(/)
    expect(propertiesSrc).toMatch(/contextSlot\(specFile\)/)
    expect(propertiesSrc).toMatch(/contextSlot\(tasksFile\)/)
    expect(propertiesSrc).not.toMatch(/readContextSteps\(|contextFromSteps\(/)
  })

  it('fails loud with context_relay_mismatch, not a silent fallback, when a relay batch returns nothing parseable', () => {
    const relaySrc = readFileSync(join(__dirname, 'shared', 'context-relay.ts'), 'utf8')
    expect(relaySrc).toMatch(/context_relay_mismatch/)
    expect(propertiesSrc).toMatch(/contextRelayPlan\(readBatch/)
    expect(propertiesSrc).toMatch(/contextFromRelay\(readBatch, inlineBatch, relayPlan\)/)
  })

  it('derives epicDir from the batch result, not a hand-rolled fallback expression', () => {
    expect(propertiesSrc).toMatch(/const epicDir: string = ctx\.epicDir/)
  })

  it('writes and commits PROPERTIES.md via the epicDir constant', () => {
    expect(propertiesSrc).toMatch(/\$\{epicDir\}\/PROPERTIES\.md/)
  })

  it('epicDir is declared before it is used in the derive/commit prompt', () => {
    const declIdx = propertiesSrc.indexOf('const epicDir: string =')
    const useIdx = propertiesSrc.indexOf('${epicDir}/PROPERTIES.md')
    expect(declIdx).toBeGreaterThan(-1)
    expect(useIdx).toBeGreaterThan(-1)
    expect(declIdx).toBeLessThan(useIdx)
  })
})

describe('datum-properties — Derive phase ordering', () => {
  it('commits PROPERTIES.md (deterministic commitFilesSteps batch) before running the properties gate', () => {
    const commitIdx = propertiesSrc.indexOf("commitFilesSteps({ wt: '.', files: [`${epicDir}/PROPERTIES.md`], message: 'properties: derive PROPERTIES.md' })")
    const gateIdx = propertiesSrc.indexOf("gateSteps('properties'")
    expect(commitIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeGreaterThan(-1)
    expect(commitIdx).toBeLessThan(gateIdx)
  })

  it('the gate flags carry --approve only in yolo mode, matching datum-plan.ts', () => {
    expect(propertiesSrc).toMatch(/gateSteps\('properties', yolo \? ' --approve' : ''\)/)
  })
})

// ---------------------------------------------------------------------------
// FLOW.md open gap 2 — the derive agent consumed a possibly-deferred SPEC.md
// / TASKS.md and its return value was discarded (it wrote AND committed
// PROPERTIES.md itself), so nothing could carry a read_witness. Now: the
// agent writes the file and returns JSON (with the witness when anything was
// deferred); the script gates the witness and commits deterministically.
// ---------------------------------------------------------------------------

describe('datum-properties — read-witness gate on derive (FLOW.md open gap 2)', () => {
  it('appends contextWitnessInstruction([specFile, tasksFile]) to the derive prompt', () => {
    const idx = propertiesSrc.indexOf("label: 'derive'")
    expect(idx).toBeGreaterThan(-1)
    const block = propertiesSrc.slice(Math.max(0, idx - 900), idx)
    expect(block).toMatch(/contextWitnessInstruction\(\[specFile, tasksFile\]\)/)
  })

  it('the derive agent no longer commits — the prompt forbids git and asks for a JSON receipt', () => {
    const idx = propertiesSrc.indexOf("label: 'derive'")
    const block = propertiesSrc.slice(Math.max(0, idx - 900), idx)
    expect(block).not.toMatch(/&& git commit -m/)
    expect(block).toMatch(/Do NOT git add or git commit/)
    expect(block).toMatch(/"written"/)
  })

  it('parses the receipt strictly and gates it with assertReadWitness before committing', () => {
    const parseIdx = propertiesSrc.indexOf("parseAgentJsonStrict<DeriveReceipt>(deriveRaw as string, 'derive')")
    const assertIdx = propertiesSrc.indexOf('assertReadWitness([specFile, tasksFile], derive)')
    const commitIdx = propertiesSrc.indexOf('commitFilesSteps(')
    expect(parseIdx).toBeGreaterThan(-1)
    expect(assertIdx).toBeGreaterThan(parseIdx)
    expect(commitIdx).toBeGreaterThan(assertIdx)
  })

  // Phase review (wf_8a923794-99c): `git add` of a missing file fails the
  // batch (commit.error), so nothingToCommit can only mean the file exists
  // and already matches HEAD — a resume after derive+commit landed but the
  // gate threw. Throwing "the derive agent did not write it" there was a
  // wrong diagnosis that blocked a legitimate resume.
  it('a failed commit is a named properties_commit_failed halt; nothing-to-commit is a logged no-op (file unchanged since last run)', () => {
    expect(propertiesSrc).toMatch(/commitFilesFromSteps\(/)
    expect(propertiesSrc).toMatch(/throw new Error\(`properties_commit_failed: \$\{commit\.error\}`\)/)
    expect(propertiesSrc).toMatch(/if \(commit\.nothingToCommit\) log\(`PROPERTIES\.md unchanged since the last run/)
    expect(propertiesSrc).not.toMatch(/nothingToCommit\) throw/)
  })
})

describe('datum-properties — workflow result shape', () => {
  it('exports branch and gatePassed taken from the deterministic gate verdict', () => {
    expect(propertiesSrc).toMatch(/export const __workflowResult = \{ branch: ctx\.branch, gatePassed: gate\.passed/)
  })
})

// ---------------------------------------------------------------------------
// The phase gate verdict must come from the CLI's exit code via a
// deterministic batch step (shared/gate.ts), never from an LLM agent that
// ran `datum gate` and echoed the JSON back.
// ---------------------------------------------------------------------------

describe('datum-properties — deterministic gate verdict', () => {
  const src = readFileSync(join(__dirname, 'datum-properties.ts'), 'utf8')
  it('runs the gate through gateSteps/parseGateResult, not the util-run-gate LLM relay', () => {
    expect(src).not.toMatch(/util-run-gate/)
    expect(src).toMatch(/gateSteps\(/)
    expect(src).toMatch(/parseGateResult\(/)
  })
})

// caliper eedom wf_9bf2c994-801 (#566): the runner dropped a 340-byte span
// from the middle of a relayed QUESTIONS.md. A mismatched inline file is
// re-fetched once with a fresh runner (a distinct prompt, so a resume does
// not replay the corrupted result) and merged; what still mismatches is
// deferred to the consuming agent, never a halt.
describe('a mismatched inline relay is re-fetched once, then deferred', () => {
  const src = readFileSync(join(__dirname, 'datum-properties.ts'), 'utf8')
  it('retries with contextInlineRetryPrompt and merges with mergeRelayRetry', () => {
    expect(src).toMatch(/contextInlineRetryPrompt\(/)
    expect(src).toMatch(/mergeRelayRetry\(/)
    expect(src).toMatch(/context_relay_mismatch on /)
  })
})

// Review iteration 3, CORR-001: datum go runs Plan before Properties, so the
// planner's --properties read hit a file that did not exist yet and no
// task-INT lane was ever scheduled. Properties now re-runs the planner after
// PROPERTIES.md is committed and gated, commits the regenerated plan, and
// re-runs the plan gate.
describe('datum-properties — schedules integration lanes after its own gate', () => {
  it('re-runs datum lane-plan with PROPERTIES.md, commits lane-plan.json + TASKS.md, and re-gates plan, only after the properties gate passed', () => {
    const propGate = propertiesSrc.indexOf("gateSteps('properties'")
    const lanePlan = propertiesSrc.indexOf('lanePlanCommand(')
    const planGate = propertiesSrc.indexOf("gateSteps('plan'")
    expect(propGate).toBeGreaterThan(0)
    expect(lanePlan).toBeGreaterThan(propGate)
    expect(planGate).toBeGreaterThan(lanePlan)
    expect(propertiesSrc.slice(propGate, lanePlan)).toMatch(/gate\.passed/)
    expect(propertiesSrc).toMatch(/lane-plan\.json[^\n]*TASKS\.md|TASKS\.md[^\n]*lane-plan\.json/)
    expect(propertiesSrc).toMatch(/integration_lanes_scheduled|integration_lanes_none/)
  })
})
