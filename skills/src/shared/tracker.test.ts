// tracker.ts — the tracker is non-critical (a failed label update must not
// fail a lane) but it must never be SILENT: updateStage told the agent "if
// the command fails, silently continue, output nothing", so a broken
// `datum issue-stage` was invisible for the whole run; publishLanePlan used
// a raw JSON.parse that throws on any non-JSON reply, crashing the Plan phase
// on a transient tracker hiccup.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'tracker.ts'), 'utf8')

describe('tracker.updateStage is best-effort but never silent', () => {
  it('no longer instructs the agent to silently continue / output nothing', () => {
    expect(src).not.toMatch(/silently continue/i)
    expect(src).not.toMatch(/Output nothing/)
  })

  it('captures the agent result, returns a boolean, and logs a [tracker] warning on failure', () => {
    const fn = src.slice(src.indexOf('export async function updateStage'), src.indexOf('export function getIssueId'))
    expect(fn).toMatch(/Promise<boolean>/)
    expect(fn).toMatch(/const \w+(: [^=]+)? = await agent\(/)
    expect(fn).toMatch(/log\(`\[tracker\][^`]*(fail|error)/i)
  })
})

describe('tracker.publishLanePlan tolerates non-JSON replies', () => {
  it('parses through parseAgentJson with a fallback instead of a raw JSON.parse', () => {
    const fn = src.slice(src.indexOf('export async function publishLanePlan'), src.indexOf('export async function updateStage'))
    expect(fn).not.toMatch(/JSON\.parse\(/)
    expect(fn).toMatch(/parseAgentJson/)
  })

  it('uses the model tier helper, not a hard-coded model name', () => {
    expect(src).not.toMatch(/model: 'haiku'/)
    expect(src).toMatch(/model\('fast'\)/)
  })
})
