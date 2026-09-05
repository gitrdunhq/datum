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
    expect(propertiesSrc).toMatch(/if \(!specContent\) throw new Error\(.*datum-refine/)
  })
  it('throws when TASKS.md is missing, telling the operator to run datum-plan first', () => {
    expect(propertiesSrc).toMatch(/if \(!tasksContent\) throw new Error\(.*datum-plan/)
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

  it('reads SPEC.md/TASKS.md and derives branch/epic-dir via readContextSteps/contextFromSteps', () => {
    expect(propertiesSrc).toMatch(/readContextSteps\(/)
    expect(propertiesSrc).toMatch(/contextFromSteps\(/)
  })

  it('fails loud with context_relay_mismatch, not a silent fallback, when the batch agent returns nothing parseable', () => {
    expect(propertiesSrc).toMatch(/context_relay_mismatch/)
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
  it('writes and commits PROPERTIES.md before running the properties gate', () => {
    const commitIdx = propertiesSrc.indexOf('git commit -m "properties: derive PROPERTIES.md"')
    const gateIdx = propertiesSrc.indexOf("gateSteps('properties'")
    expect(commitIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeGreaterThan(-1)
    expect(commitIdx).toBeLessThan(gateIdx)
  })

  it('the gate flags carry --approve only in yolo mode, matching datum-plan.ts', () => {
    expect(propertiesSrc).toMatch(/gateSteps\('properties', yolo \? ' --approve' : ''\)/)
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
