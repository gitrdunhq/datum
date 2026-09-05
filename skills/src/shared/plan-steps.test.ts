// plan-steps.ts — the Plan phase's build/skeleton/rebuild batches.
//
// datum-plan used to hand an LLM runner the whole tasks.json text inside a
// prompt ("Write this JSON to <path>") and trust its {"exit_code": 0}. A
// runner that abridged, re-serialised or "fixed" a task wrote a different
// plan than the one the decompose agent produced, with no trace: the schema
// gate would still pass. The write is now a quoted heredoc inside a batch
// step and the on-disk blob sha is compared against the sha of the exact
// bytes the script intended to write (plan_write_mismatch).

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  planBuildSteps,
  planBuildFromSteps,
  tasksJsonBlobSha,
  skeletonBatchSteps,
  skeletonBatchFromSteps,
} from './plan-steps'
import { batchScript, parseBatchResult } from './batch'

const names = (steps: { name: string }[]) => steps.map((s) => s.name)
const tasksJson = JSON.stringify([{ id: 'task-001', slug: 'a', title: 'A "quoted" $title `x`', files: ['src/a.py'], depends_on: [] }])

describe('planBuildSteps', () => {
  const steps = planBuildSteps({ epicDir: 'docs/epics/x', tasksJson })

  it('is mkdir → heredoc write → blob sha → datum lane-plan, with only the sha step tolerant', () => {
    expect(names(steps)).toEqual(['mkdir', 'write-tasks', 'tasks-sha', 'lane-plan'])
    expect(steps.map((s) => !!s.tolerant)).toEqual([false, false, true, false])
  })

  it('writes the JSON verbatim through a quoted heredoc (no expansion of $ or backticks) ending in a newline', () => {
    const write = steps[1].command
    expect(write).toMatch(/^cat > "docs\/epics\/x\/tasks\.json" <<'DATUM_TASKS_EOF'\n/)
    expect(write).toContain(tasksJson)
    expect(write).toMatch(/\nDATUM_TASKS_EOF$/)
  })

  it('refuses a tasksJson that contains the heredoc terminator or is not a single line', () => {
    expect(() => planBuildSteps({ epicDir: 'x', tasksJson: '[{"a":"DATUM_TASKS_EOF"}]' })).toThrow(/heredoc terminator/)
    expect(() => planBuildSteps({ epicDir: 'x', tasksJson: '[\n]' })).toThrow(/single line/)
  })

  it('runs datum lane-plan with the epic-scoped input, output and md-output paths', () => {
    expect(steps[3].command).toBe(
      'datum lane-plan --input "docs/epics/x/tasks.json" --output "docs/epics/x/lane-plan.json" --md-output "docs/epics/x/TASKS.md"',
    )
    expect(steps[2].command).toBe('git hash-object "docs/epics/x/tasks.json"')
  })
})

describe('tasksJsonBlobSha', () => {
  it('is the git blob sha of the JSON bytes plus the trailing newline the heredoc writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-plan-sha-'))
    try {
      const script = batchScript(planBuildSteps({ epicDir: dir, tasksJson }).slice(0, 3))
      const out = execFileSync('bash', ['-c', script], { encoding: 'utf8', cwd: dir })
      const result = parseBatchResult(out, planBuildSteps({ epicDir: dir, tasksJson }))
      const onDisk = result.steps.find((s) => s.name === 'tasks-sha')!.stdout.trim()
      expect(onDisk).toBe(tasksJsonBlobSha(tasksJson))
      expect(readFileSync(join(dir, 'tasks.json'), 'utf8')).toBe(tasksJson + '\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('handles non-ASCII task text (UTF-8 bytes, not UTF-16 units)', () => {
    const j = JSON.stringify([{ id: 'task-001', title: 'héllo — 日本語 😀' }])
    const dir = mkdtempSync(join(tmpdir(), 'datum-plan-sha-'))
    try {
      const script = batchScript(planBuildSteps({ epicDir: dir, tasksJson: j }).slice(0, 3))
      const out = execFileSync('bash', ['-c', script], { encoding: 'utf8', cwd: dir })
      const onDisk = parseBatchResult(out, planBuildSteps({ epicDir: dir, tasksJson: j })).steps.find((s) => s.name === 'tasks-sha')!.stdout.trim()
      expect(onDisk).toBe(tasksJsonBlobSha(j))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('planBuildFromSteps', () => {
  const steps = planBuildSteps({ epicDir: 'docs/epics/x', tasksJson })
  const sha = tasksJsonBlobSha(tasksJson)
  const res = (arr: Array<{ name: string; exit_code: number; stdout?: string; stderr?: string }>) =>
    parseBatchResult(JSON.stringify(arr.map((s) => ({ stdout: '', stderr: '', ...s }))), steps)

  it('is ok when the write landed byte-exact and datum lane-plan exited 0', () => {
    const r = planBuildFromSteps(res([
      { name: 'mkdir', exit_code: 0 }, { name: 'write-tasks', exit_code: 0 },
      { name: 'tasks-sha', exit_code: 0, stdout: sha + '\n' }, { name: 'lane-plan', exit_code: 0, stdout: 'wrote lane-plan.json' },
    ]), sha)
    expect(r).toEqual({ ok: true, error: '' })
  })

  it('a sha that differs from the intended bytes is plan_write_mismatch naming both hashes', () => {
    const r = planBuildFromSteps(res([
      { name: 'mkdir', exit_code: 0 }, { name: 'write-tasks', exit_code: 0 },
      { name: 'tasks-sha', exit_code: 0, stdout: 'deadbeef' }, { name: 'lane-plan', exit_code: 0 },
    ]), sha)
    expect(r.ok).toBe(false)
    expect(r.error).toBe(`plan_write_mismatch: tasks.json on disk is blob deadbeef, the script wrote ${sha} — the runner did not copy the heredoc verbatim`)
  })

  it('a failed lane-plan step is plan_build_failed with the exit code and the CLI tail', () => {
    const r = planBuildFromSteps(res([
      { name: 'mkdir', exit_code: 0 }, { name: 'write-tasks', exit_code: 0 },
      { name: 'tasks-sha', exit_code: 0, stdout: sha }, { name: 'lane-plan', exit_code: 1, stderr: 'task.schema.json: task-001 missing acceptance_criteria' },
    ]), sha)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^plan_build_failed: datum lane-plan exited 1 — .*missing acceptance_criteria/)
  })

  it('a batch that stopped at the write, or returned nothing, is plan_build_failed', () => {
    expect(planBuildFromSteps(res([{ name: 'mkdir', exit_code: 0 }, { name: 'write-tasks', exit_code: 1, stderr: 'Permission denied' }]), sha).error)
      .toMatch(/^plan_build_failed: write-tasks exited 1.*Permission denied/)
    expect(planBuildFromSteps(parseBatchResult(null, steps), sha).error).toMatch(/^plan_build_failed: /)
  })
})

describe('skeletonBatchSteps / skeletonBatchFromSteps', () => {
  it('is mkdir → datum skeleton --batch (non-tolerant); the commit is a separate commitFilesSteps batch', () => {
    const steps = skeletonBatchSteps({ epicDir: 'docs/epics/x', language: 'python' })
    expect(names(steps)).toEqual(['mkdir', 'skeleton'])
    expect(steps[1].command).toBe('datum skeleton --batch --language python --tasks "docs/epics/x/lane-plan.json" --output-dir "docs/epics/x/skeletons"')
    expect(steps[1].tolerant).toBeFalsy()
    expect(steps.some((s) => /git (add|commit)/.test(s.command))).toBe(false)
  })

  it('reads the verdict from the skeleton step exit code', () => {
    const steps = skeletonBatchSteps({ epicDir: 'x', language: 'python' })
    const ok = parseBatchResult(JSON.stringify([{ name: 'mkdir', exit_code: 0, stdout: '', stderr: '' }, { name: 'skeleton', exit_code: 0, stdout: '3 skeletons', stderr: '' }]), steps)
    expect(skeletonBatchFromSteps(ok)).toEqual({ ok: true, error: '' })
    const bad = parseBatchResult(JSON.stringify([{ name: 'mkdir', exit_code: 0, stdout: '', stderr: '' }, { name: 'skeleton', exit_code: 2, stdout: '', stderr: 'unknown language' }]), steps)
    expect(skeletonBatchFromSteps(bad).error).toMatch(/^skeleton_batch_failed: datum skeleton exited 2 — unknown language/)
    expect(skeletonBatchFromSteps(parseBatchResult(null, steps)).error).toMatch(/^skeleton_batch_failed: /)
  })
})
