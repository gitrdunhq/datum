// task-012: datum-properties counts integration lanes by kind instead of
// grepping literal task-INT- ids. Today (line 161) the workflow shells out
// to `grep -c '"task-INT-' lane-plan.json`, which only matches lanes whose
// id happens to contain the literal substring "task-INT-" — a monotonic
// task id like DAT-146 with kind "integration" is invisible to it, and the
// grep counts *matching lines*, not lanes, so pretty-printed JSON where the
// id also appears in an "id" field over-counts.
//
// datum-properties.ts is a sandboxed workflow script (host-injected agent/
// args/phase/log) and cannot be imported by vitest — matching the existing
// datum-properties.test.ts convention, this walks the raw source. But per
// the lane's red_note ("assert on the command/counting logic with three
// lane-plan fixtures"), AC1-AC3 do not pattern-match the source text: they
// extract the actual shell command the 'int-count' batch step runs, bind
// epicDir to a real temp-directory fixture, execute it for real, and assert
// on the real stdout. A rename or reformat of the command does not break
// these tests; only a behavioural regression does.

import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

const propertiesSrc = readFileSync(join(__dirname, 'datum-properties.ts'), 'utf8')

// Locate the 'int-count' step's `command:` template literal in the source
// and evaluate it with a real epicDir bound, so we run the SAME command the
// workflow would run (whatever its current implementation is) rather than
// re-implementing counting logic ourselves.
function extractIntCountCommand(src: string, epicDir: string): string {
  const marker = "name: 'int-count'"
  const markerIdx = src.indexOf(marker)
  if (markerIdx === -1) {
    throw new Error("int-count step not found in datum-properties.ts (marker \"name: 'int-count'\" missing)")
  }
  const commandIdx = src.indexOf('command:', markerIdx)
  if (commandIdx === -1) {
    throw new Error('int-count step has no command: field')
  }
  const backtickStart = src.indexOf('`', commandIdx)
  if (backtickStart === -1) {
    throw new Error('int-count command is not a template literal')
  }
  // Walk forward tracking ${ ... } nesting depth so a nested template
  // literal (e.g. ${JSON.stringify(`${epicDir}/lane-plan.json`)}) does not
  // prematurely terminate the outer template at its inner backtick.
  let i = backtickStart + 1
  let depth = 0
  while (i < src.length) {
    if (src[i] === '`' && depth === 0) break
    if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue }
    if (src[i] === '}' && depth > 0) { depth--; i++; continue }
    i++
  }
  if (i >= src.length) throw new Error('int-count command template literal never closes')
  const templateBody = src.slice(backtickStart + 1, i)
  // eslint-disable-next-line no-new-func
  const evalTemplate = new Function('epicDir', 'return `' + templateBody + '`')
  return evalTemplate(epicDir) as string
}

function runIntCount(lanesObj: Record<string, { id: string; kind: string }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'datum-properties-int-count-'))
  try {
    const lanes: Record<string, unknown> = {}
    for (const [key, lane] of Object.entries(lanesObj)) lanes[key] = lane
    const lanePlan = { schema_version: 1, lanes }
    writeFileSync(join(dir, 'lane-plan.json'), JSON.stringify(lanePlan, null, 2) + '\n', 'utf8')
    const cmd = extractIntCountCommand(propertiesSrc, dir)
    return execSync(cmd, { shell: '/bin/sh', encoding: 'utf8' }).trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('task-012 — int-count counts integration lanes by kind (AC1)', () => {
  it('counts 2 for two monotonic-id lanes (DAT-146/DAT-147) carrying kind "integration"', () => {
    const count = runIntCount({
      'DAT-146': { id: 'DAT-146', kind: 'integration' },
      'DAT-147': { id: 'DAT-147', kind: 'integration' },
      'task-001': { id: 'task-001', kind: 'behavioral' },
    })
    expect(count).toBe('2')
  })
})

describe('task-012 — int-count is unchanged for legacy task-INT- lanes (AC2)', () => {
  it('still counts 2 for legacy task-INT-1/task-INT-2 lanes carrying kind "integration"', () => {
    const count = runIntCount({
      'task-INT-1': { id: 'task-INT-1', kind: 'integration' },
      'task-INT-2': { id: 'task-INT-2', kind: 'integration' },
      'task-001': { id: 'task-001', kind: 'behavioral' },
    })
    expect(count).toBe('2')
  })
})

describe('task-012 — int-count reports 0 when no lane has kind "integration" (AC3)', () => {
  it('counts 0 for a lane-plan.json with only behavioral/structural lanes', () => {
    const count = runIntCount({
      'task-001': { id: 'task-001', kind: 'behavioral' },
      'task-002': { id: 'task-002', kind: 'structural' },
    })
    expect(count).toBe('0')
  })
})

describe('task-012 — the old grep-on-id-literal is fully retired (AC4)', () => {
  it('no `\'"task-INT-\'` grep literal remains in skills/src/datum-properties.ts', () => {
    expect(propertiesSrc).not.toMatch(/'"task-INT-'/)
  })
})
