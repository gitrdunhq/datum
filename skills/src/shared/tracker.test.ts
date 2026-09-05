// tracker.ts — the tracker is non-critical (a failed label update must not
// fail a lane) but it must never be SILENT: updateStage told the agent "if
// the command fails, silently continue, output nothing", so a broken
// `datum issue-stage` was invisible for the whole run; publishLanePlan used
// a raw JSON.parse that throws on any non-JSON reply, crashing the Plan phase
// on a transient tracker hiccup.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { publishSteps, publishFromSteps, stageSteps, stageFromSteps } from './tracker'
import { parseBatchResult } from './batch'

const src = readFileSync(join(__dirname, 'tracker.ts'), 'utf8')

// Both tracker calls used to be a runner told to "Run: datum plan-issues /
// issue-stage" and return the JSON — or, on failure, to INVENT
// {"error": ...} / {"ok": false} itself. The CLI's exit code and stdout now
// come from a batch step; the runner never authors the verdict.
describe('tracker batch steps', () => {
  it('publishSteps is one tolerant `datum plan-issues` step with the lane plan and title quoted', () => {
    const steps = publishSteps('docs/epics/x/lane-plan.json', 'Epic: add $thing')
    expect(steps).toHaveLength(1)
    expect(steps[0].name).toBe('publish')
    expect(steps[0].tolerant).toBe(true)
    expect(steps[0].command).toBe('datum plan-issues --lane-plan "docs/epics/x/lane-plan.json" --title "Epic: add \\$thing"')
  })

  it('stageSteps refuses a non-numeric issue id or a non-hex sha instead of interpolating them raw', () => {
    expect(() => stageSteps('12; rm -rf x', 'green')).toThrow(/issue id/)
    expect(() => stageSteps('12', 'green', 'abc 123')).toThrow(/sha/)
    expect(() => stageSteps('', 'green')).toThrow(/issue id/)
  })

  it('stageSteps is one tolerant `datum issue-stage` step, with --commit only when a sha is given', () => {
    expect(stageSteps('12', 'green', 'abc123')[0].command).toBe('datum issue-stage --issue 12 --stage green --commit abc123')
    expect(stageSteps('12', 'red')[0].command).toBe('datum issue-stage --issue 12 --stage red')
    expect(stageSteps('12', 'red')[0].name).toBe('stage')
    expect(stageSteps('12', 'red')[0].tolerant).toBe(true)
  })

  const batch = (name: string, exit: number, stdout: string) =>
    parseBatchResult(JSON.stringify([{ name, exit_code: exit, stdout, stderr: '' }]), [{ name, command: '' }])

  it('publishFromSteps returns the parsed publisher JSON only on exit 0', () => {
    const r = publishFromSteps(batch('publish', 0, '{\n  "epic_number": 7,\n  "task_issues": {"T1": 8}\n}'))
    expect(r).toEqual({ ok: true, parsed: { epic_number: 7, task_issues: { T1: 8 } }, error: '' })
  })

  it('publishFromSteps names the exit code and the CLI tail on a non-zero exit', () => {
    const r = publishFromSteps(batch('publish', 1, 'Not found: docs/epics/x/lane-plan.json'))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^tracker_publish_failed: datum plan-issues exited 1.*Not found/)
  })

  it('publishFromSteps treats a missing batch or unparseable stdout as a named failure', () => {
    expect(publishFromSteps(parseBatchResult(null, [{ name: 'publish', command: '' }])).error).toMatch(/^tracker_publish_failed: /)
    expect(publishFromSteps(batch('publish', 0, 'not json')).error).toMatch(/^tracker_publish_failed: .*not json/)
  })

  it('stageFromSteps is ok only on exit 0 with ok:true in the printed JSON', () => {
    expect(stageFromSteps(batch('stage', 0, '{"ok": true, "issue": 12, "stage": "green"}'))).toEqual({ ok: true, error: '' })
    expect(stageFromSteps(batch('stage', 1, 'gh: HTTP 401')).error).toMatch(/^tracker_stage_failed: datum issue-stage exited 1.*401/)
    expect(stageFromSteps(batch('stage', 0, '')).error).toMatch(/^tracker_stage_failed: /)
    expect(stageFromSteps(parseBatchResult(null, [{ name: 'stage', command: '' }])).error).toMatch(/^tracker_stage_failed: /)
  })
})

describe('tracker.updateStage is best-effort but never silent', () => {
  it('no longer instructs the agent to silently continue / output nothing, and never asks it to invent a failure JSON', () => {
    expect(src).not.toMatch(/silently continue/i)
    expect(src).not.toMatch(/Output nothing/)
    expect(src).not.toMatch(/If it fails, return/)
    expect(src).not.toMatch(/If the command fails, return/)
  })

  it('runs the batch, returns a boolean, and logs the named [tracker] failure', () => {
    const fn = src.slice(src.indexOf('export async function updateStage'), src.indexOf('export function getIssueId'))
    expect(fn).toMatch(/Promise<boolean>/)
    expect(fn).toMatch(/stageFromSteps\(parseBatchResult\(/)
    expect(fn).toMatch(/log\(`\[tracker\] \$\{\w+\.error\}/)
  })
})

describe('tracker.publishLanePlan tolerates non-JSON replies', () => {
  it('reads the publisher JSON from the batch step through publishFromSteps, never a raw JSON.parse of an echo', () => {
    const fn = src.slice(src.indexOf('export async function publishLanePlan'), src.indexOf('export async function updateStage'))
    expect(fn).not.toMatch(/JSON\.parse\(/)
    expect(fn).toMatch(/publishFromSteps\(parseBatchResult\(/)
    expect(fn).not.toMatch(/Run: datum plan-issues/)
  })

  it('uses the model tier helper, not a hard-coded model name', () => {
    expect(src).not.toMatch(/model: 'haiku'/)
    expect(src).toMatch(/model\('fast'\)/)
  })
})

// A consumer repo with no GitHub remote had `datum plan-issues` file 18 of
// its task issues into datum's own tracker (the Python side guessed a
// default repo). The publisher now refuses with {"skipped":
// "github_repo_unresolved"}; the tracker must treat that as "no issue
// numbers", logged, never as a failure of the Plan phase.
describe('tracker.publishLanePlan honours a refused publish', () => {
  it('logs the skipped reason and returns null instead of an empty PublishResult', () => {
    const fn = src.slice(src.indexOf('export async function publishLanePlan'), src.indexOf('export async function updateStage'))
    expect(fn).toMatch(/parsed\.skipped/)
    expect(fn).toMatch(/publish skipped: \$\{parsed\.reason \|\| parsed\.skipped\}/)
  })
})
