// lane-id-pattern.test.ts — RED for task-006 (#528).
//
// skills/src/shared/lane-id-pattern.ts is the TypeScript mirror of
// datum/id_pattern.py's LANE_ID_PATTERN / is_lane_id: task ids flow through
// completionMarkerCommand / laneSpecExportCommand into shell-interpolated
// strings, so the TS side needs the same acceptance shape (task-N,
// task-INT-N, DAT-142) while still rejecting shell metacharacters and the
// reserved DATUM- prefix. tests/test_id_pattern_ts_parity.py asserts the two
// pattern literals never drift apart.

import { describe, it, expect } from 'vitest'
import { LANE_ID_PATTERN, isLaneId } from './lane-id-pattern'
import { completionMarkerCommand, laneSpecExportCommand } from './lane-steps'

describe('lane-id-pattern — AC1: exports', () => {
  it('exports LANE_ID_PATTERN as an anchored string and isLaneId as a function', () => {
    expect(typeof LANE_ID_PATTERN).toBe('string')
    expect(LANE_ID_PATTERN.startsWith('^')).toBe(true)
    expect(LANE_ID_PATTERN.endsWith('$')).toBe(true)
    expect(typeof isLaneId).toBe('function')
  })
})

describe('lane-id-pattern — AC2: isLaneId acceptance shape', () => {
  it.each(['task-1', 'task-INT-1', 'DAT-142'])('accepts %s', (id) => {
    expect(isLaneId(id)).toBe(true)
  })

  it.each(['DAT142', 'dat-142', 'DATUM-142'])('rejects %s', (id) => {
    expect(isLaneId(id)).toBe(false)
  })
})

describe('lane-id-pattern — AC3: lane-steps.ts consumes isLaneId', () => {
  it('completionMarkerCommand accepts DAT-142 without throwing', () => {
    expect(() => completionMarkerCommand('20260907-000000-aa', 'DAT-142')).not.toThrow()
  })

  it('completionMarkerCommand rejects a shell-metacharacter task id', () => {
    expect(() => completionMarkerCommand('20260907-000000-aa', 'DAT-142; rm -rf /')).toThrow()
  })

  it('completionMarkerCommand rejects an id isLaneId rejects even without metacharacters (lowercase short prefix)', () => {
    expect(isLaneId('dat-142')).toBe(false)
    expect(() => completionMarkerCommand('20260907-000000-aa', 'dat-142')).toThrow()
  })

  it('laneSpecExportCommand accepts DAT-142 without throwing', () => {
    expect(() =>
      laneSpecExportCommand({
        planPath: 'docs/epics/x/lane-plan.json',
        taskId: 'DAT-142',
        outPath: '.datum/runs/r/lane-spec.json',
        expectHash: 'fnv1a64:deadbeef',
      })
    ).not.toThrow()
  })

  it('laneSpecExportCommand rejects a shell-metacharacter task id', () => {
    expect(() =>
      laneSpecExportCommand({
        planPath: 'docs/epics/x/lane-plan.json',
        taskId: 'DAT-142`whoami`',
        outPath: '.datum/runs/r/lane-spec.json',
        expectHash: 'fnv1a64:deadbeef',
      })
    ).toThrow()
  })
})
