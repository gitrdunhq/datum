// lane-id-pattern.ts — TypeScript side of datum/id_pattern.py's
// LANE_ID_PATTERN / is_lane_id (#528, #514).
//
// The regex is written exactly once, in assets/schemas/task.schema.json
// ($defs.laneId.pattern). esbuild inlines the JSON into the bundle at build
// time and vitest resolves it natively, so this module never restates the
// pattern — tests/test_id_pattern_ts_parity.py fails if a literal creeps in.
import taskSchema from '../../../assets/schemas/task.schema.json'

export const LANE_ID_PATTERN: string = (taskSchema as { $defs: { laneId: { pattern: string } } })
  .$defs.laneId.pattern

const LANE_ID_RE = new RegExp(LANE_ID_PATTERN)

export function isLaneId(s: string): boolean {
  return LANE_ID_RE.test(s)
}
