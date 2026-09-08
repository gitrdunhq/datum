// #520: `datum retrospect` had no producer. After Act, datum-go records one
// event per lane outcome through `datum events lane` in a single tolerant
// batch, so the runs directory carries what retrospect reads.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { laneEventSteps } from './events-steps'

describe('laneEventSteps', () => {
  const results = {
    'task-001': { task_id: 'task-001', status: 'completed', stage: 'REFACTOR' },
    'task-003': { task_id: 'task-003', status: 'failed', stage: 'GREEN', error: 'green_verify_failed: independent test-verify step exit=1 (agent "said" tests_pass=true)' },
    'task-004': { task_id: 'task-004', status: 'blocked', stage: 'SKIPPED', error: 'integration_dependency_unmerged: task-003' },
  }

  it('is one tolerant `datum events lane` step per lane, in lane order, carrying status, stage and the error', () => {
    const steps = laneEventSteps({ runId: '20260907-163917', results })
    expect(steps.map((s) => s.name)).toEqual(['event-task-001', 'event-task-003', 'event-task-004'])
    for (const s of steps) expect(s.tolerant).toBe(true)
    expect(steps[0].command).toBe('datum events lane --run-id "20260907-163917" --task-id "task-001" --status "completed" --stage "REFACTOR"')
    expect(steps[1].command).toContain('--status "failed" --stage "GREEN" --reason "green_verify_failed: independent test-verify step exit=1 (agent \\"said\\" tests_pass=true)"')
    expect(steps[2].command).toContain('--status "blocked"')
  })

  it('a batch run id is passed through as-is (the CLI maps -bN to the base run)', () => {
    expect(laneEventSteps({ runId: 'r1-b2', results: { 'task-001': { task_id: 'task-001', status: 'completed', stage: 'REFACTOR' } } })[0].command).toContain('--run-id "r1-b2"')
  })

  it('step names are valid batch step names for INT lane ids', () => {
    const steps = laneEventSteps({ runId: 'r1', results: { 'task-INT-12': { task_id: 'task-INT-12', status: 'completed', stage: 'RED' } } })
    expect(steps[0].name).toMatch(/^[a-z0-9-]+$/i)
  })

  it('datum-go records lane events after Act with the act-events label', () => {
    const src = readFileSync(join(__dirname, '..', 'datum-go.ts'), 'utf8')
    expect(src).toMatch(/laneEventSteps\(\{ runId, results: actResults \}\)/)
    expect(src).toMatch(/label: 'act-events'/)
  })
})
