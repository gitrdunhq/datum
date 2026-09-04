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
  it('args.agentTypes (from datum-go) wins over the config.json agent_types field read via read-context', () => {
    const idx = propertiesSrc.indexOf('configureAgentTypes(')
    expect(idx).toBeGreaterThan(-1)
    const call = propertiesSrc.slice(idx, propertiesSrc.indexOf('\n', idx))
    expect(call).toMatch(/a\.agentTypes/)
    expect(call).toMatch(/ctx\.agent_types/)
  })
})

describe('datum-properties — Read phase guards', () => {
  it('throws when SPEC.md is missing, telling the operator to run datum-refine first', () => {
    expect(propertiesSrc).toMatch(/if \(!ctx\.spec_content\) throw new Error\(.*datum-refine/)
  })
  it('throws when TASKS.md is missing, telling the operator to run datum-plan first', () => {
    expect(propertiesSrc).toMatch(/if \(!ctx\.tasks_content\) throw new Error\(.*datum-plan/)
  })
})

// ---------------------------------------------------------------------------
// BUG: every other phase script that reads ctx.epic_dir off the read-context
// agent's JSON falls back to `docs/epics/${ctx.branch || 'unknown'}` when
// epic_dir is missing/empty (see datum-plan.ts and datum-refine.ts, both of
// which declare `const epicDir: string = ctx.epic_dir || \`docs/epics/...\``).
// datum-properties.ts is the only consumer of that same field that uses
// `ctx.epic_dir` raw. A read-context agent that returns valid JSON with
// spec_content/tasks_content present but epic_dir empty or omitted (a
// realistic partial-output failure, not a contrived one) makes this phase
// write PROPERTIES.md to "/PROPERTIES.md" or "undefined/PROPERTIES.md"
// instead of the epic directory, and commit whatever git happens to find
// there — silently, with no thrown error.
// ---------------------------------------------------------------------------

describe('datum-properties — epic_dir fallback (bug fix)', () => {
  it('declares an epicDir constant with the same fallback used by datum-plan.ts / datum-refine.ts', () => {
    expect(propertiesSrc).toMatch(/const epicDir: string = ctx\.epic_dir \|\| `docs\/epics\/\$\{ctx\.branch \|\| 'unknown'\}`/)
  })

  it('writes and commits PROPERTIES.md via the epicDir constant, not raw ctx.epic_dir', () => {
    expect(propertiesSrc).not.toMatch(/\$\{ctx\.epic_dir\}\/PROPERTIES\.md/)
    expect(propertiesSrc).toMatch(/\$\{epicDir\}\/PROPERTIES\.md/)
  })

  it('the epicDir fallback is declared before it is used in the derive/commit prompt', () => {
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
    const gateIdx = propertiesSrc.indexOf("renderPrompt(runGateTemplate, { phase: 'properties'")
    expect(commitIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeGreaterThan(-1)
    expect(commitIdx).toBeLessThan(gateIdx)
  })

  it('the gate flags carry --approve only in yolo mode, matching datum-plan.ts', () => {
    expect(propertiesSrc).toMatch(/flags: yolo \? ' --approve' : ''/)
  })
})

describe('datum-properties — workflow result shape', () => {
  it('exports branch and gatePassed, coerced to a boolean', () => {
    expect(propertiesSrc).toMatch(/export const __workflowResult = \{ branch: ctx\.branch, gatePassed: !!gate\?\.passed \}/)
  })
})
