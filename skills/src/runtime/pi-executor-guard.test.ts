// RED tests for LLM-318: the pi executor writes <worktree>/.datum/lane-guard.json
// before the stage script runs. The only stand-in is a fixture stage script that
// copies the guard file aside at the moment it runs (or records MISSING).
//
// Scope note: only the judge case is pinned. No field on agent()/StageOpts or
// StageRequest carries a writer stage's allowed/forbidden file lists today (the
// lane script writes them to .datum/lane-context.json by shell), so the writer
// case is not pinned here; see the LLM-318 report.

import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectExecutor } from './executors'
import { readRuntimeConfig } from '../shared/models'

const tmp = mkdtempSync(join(tmpdir(), 'llm318-guard-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const SCRIPT = `#!/usr/bin/env bash
dir="$(dirname "$0")"
if [ -f "$1/.datum/lane-guard.json" ]; then cp "$1/.datum/lane-guard.json" "$dir/guard-seen.json"; else printf 'MISSING' > "$dir/guard-seen.json"; fi
printf '{"text":"{}"}' > "$(dirname "$2")/reply.json"
exit 0
`

describe('lane-guard.json', () => {
  it('is written for a judge stage before the script runs, read_only true with empty lists', async () => {
    // Catches: no guard file at script time, or a judge guard that is not read_only with empty write lists
    const base = join(tmp, 'judge')
    const repoRoot = join(base, 'repo')
    const worktree = join(base, 'wt')
    const scriptDir = join(base, 'script')
    for (const d of [repoRoot, worktree, scriptDir]) mkdirSync(d, { recursive: true })
    const script = join(scriptDir, 'stage.sh')
    writeFileSync(script, SCRIPT)
    const runtime = readRuntimeConfig({
      runtime: { kind: 'pi', models: { fast: 'm-fast', balanced: 'm-bal', deep: 'm-deep' }, stage_script: script },
    })
    const ex = selectExecutor(runtime, { repoRoot, runId: 'run-1' } as never)
    await ex.execute({
      prompt: 'judge it',
      model: 'm-bal',
      headers: { 'X-Client': 'datum', 'X-Priority': 'batch' },
      opts: { label: 'panel-1', agentType: 'datum-skeptic', worktree },
    })
    const seen = readFileSync(join(scriptDir, 'guard-seen.json'), 'utf8')
    expect(seen).not.toBe('MISSING')
    expect(JSON.parse(seen)).toEqual({ allowed_write_files: [], forbidden_write_files: [], read_only: true })
  })
})

// Writer stages take their lists from <worktree>/.datum/lane-context.json, the
// file laneCtxCmd (skills/src/shared/utils.ts) writes before each dispatch.
const LANE_CONTEXT = {
  task_id: 't-1',
  stage: 'RED',
  allowed_write_files: ['src/a.ts'],
  forbidden_write_files: ['tests/a.test.ts'],
  commit_prefix: 'test(a)',
  test_count_floor: 0,
}

function writerCase(name: string, laneContext: object | undefined) {
  const base = join(tmp, name)
  const repoRoot = join(base, 'repo')
  const worktree = join(base, 'wt')
  const scriptDir = join(base, 'script')
  for (const d of [repoRoot, join(worktree, '.datum'), scriptDir]) mkdirSync(d, { recursive: true })
  if (laneContext !== undefined) writeFileSync(join(worktree, '.datum', 'lane-context.json'), JSON.stringify(laneContext))
  const script = join(scriptDir, 'stage.sh')
  writeFileSync(script, SCRIPT)
  const runtime = readRuntimeConfig({
    runtime: { kind: 'pi', models: { fast: 'm-fast', balanced: 'm-bal', deep: 'm-deep' }, stage_script: script },
  })
  const ex = selectExecutor(runtime, { repoRoot, runId: 'run-1' } as never)
  const run = () =>
    ex.execute({
      prompt: 'write it',
      model: 'm-bal',
      headers: { 'X-Client': 'datum', 'X-Priority': 'batch' },
      opts: { label: 'red:t-1', agentType: 'datum-red', worktree },
    })
  return { run, seenFile: join(scriptDir, 'guard-seen.json') }
}

describe('lane-guard.json for writer stages', () => {
  it('copies the allowed and forbidden lists from lane-context.json, read_only false, before the script runs', async () => {
    // Catches: a writer guard with empty lists or read_only true, or lists not taken from lane-context.json
    const c = writerCase('writer-ok', LANE_CONTEXT)
    await c.run()
    const seen = readFileSync(c.seenFile, 'utf8')
    expect(seen).not.toBe('MISSING')
    expect(JSON.parse(seen)).toEqual({ allowed_write_files: ['src/a.ts'], forbidden_write_files: ['tests/a.test.ts'], read_only: false })
  })

  it('fails closed with stage_guard_context_missing and never runs the script when lane-context.json is absent', async () => {
    // Catches: a writer stage running with no guard (open write access) when the lane context was never written
    const c = writerCase('writer-no-context', undefined)
    await expect(c.run()).rejects.toThrow(/stage_guard_context_missing: red:t-1 \(.*\/stages\/[0-9]+-red_t-1\)/)
    expect(existsSync(c.seenFile)).toBe(false)
  })
})
