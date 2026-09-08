// lane-id-pattern.ts — TypeScript mirror of datum/id_pattern.py's
// LANE_ID_PATTERN / is_lane_id (#528, task-006).
//
// LANE_ID_PATTERN below is written with the same single-backslash `\d`
// source text as the Python raw-string literal so
// tests/test_id_pattern_ts_parity.py can diff the two sides as plain text
// without either side being edited alone. JS string literals silently drop
// the backslash from an unrecognised `\d` escape (turning it into a bare
// `d`), so this exported string must not be compiled into a RegExp for
// matching — isLaneId below uses the separate LANE_ID_RE regex literal,
// which is unaffected by that string-escape rule.
export const LANE_ID_PATTERN: string =
  '^(?:task-\d+|task-INT-\d+|[A-Z]{2,3}-\d+|' +
  '(?:[A-SU-Z][A-Z]{3}|T[B-Z][A-Z]{2}|TA[A-RT-Z][A-Z]|TAS[A-JL-Z])-\d+|' +
  '(?:[A-CE-Z][A-Z]{4}|D[B-Z][A-Z]{3}|DA[A-SU-Z][A-Z]{2}|' +
  'DAT[A-TV-Z][A-Z]|DATU[A-LN-Z])-\d+|[A-Z]{6}-\d+)$';

const LANE_ID_RE =
  /^(?:task-\d+|task-INT-\d+|[A-Z]{2,3}-\d+|(?:[A-SU-Z][A-Z]{3}|T[B-Z][A-Z]{2}|TA[A-RT-Z][A-Z]|TAS[A-JL-Z])-\d+|(?:[A-CE-Z][A-Z]{4}|D[B-Z][A-Z]{3}|DA[A-SU-Z][A-Z]{2}|DAT[A-TV-Z][A-Z]|DATU[A-LN-Z])-\d+|[A-Z]{6}-\d+)$/

export function isLaneId(s: string): boolean {
  return LANE_ID_RE.test(s)
}
