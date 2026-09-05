import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyLaneError, triageDestination, type TriageClassifyCategory } from './triage-classify'

describe('classifyLaneError — deterministic infrastructure prefixes', () => {
  const infraCases: Array<[string, string]> = [
    ['lane_intake_failed', 'lane_intake_failed: could not read intake batch result'],
    ['count_gate_no_output', 'count_gate_no_output: test-count-check returned null — cannot verify 3 new test functions were committed'],
    ['count_gate_failed', 'count_gate_failed: test-count-gate produced no JSON (exit 1)'],
    ['merge_failed', 'merge_failed: could not squash-merge task-004 onto epic-99'],
    ['dep_merge_failed (still merge_failed family)', 'dep_merge_failed: could not merge [epic--a] into b worktree — exit 1'],
    ['ownership_check_failed', 'ownership_check_failed: ownership diff step did not run or returned no result'],
    ['validate_run_failed', 'VALIDATION FAILED — validate_run_failed: independent test run did not execute (crash)'],
    ['lane_plan_relay_mismatch', 'lane_plan_relay_mismatch: shape differs (lane-plan.json) — refusing to execute a plan that differs from the file'],
    ['context_relay_mismatch', 'context_relay_mismatch: batch agent returned no parseable result for context_files'],
    ['no worktree path', 'no worktree path for task-004 (setup returned undefined) — refusing to run outside an isolated worktree'],
  ]

  it.each(infraCases)('%s classifies as infrastructure with deterministic confidence', (_label, error) => {
    const result = classifyLaneError(error, 'RED')
    expect(result.category).toBe('infrastructure')
    expect(result.confidence).toBe('deterministic')
    expect(result.reason.length).toBeGreaterThan(0)
  })
})

describe('classifyLaneError — deterministic lane_plan prefixes', () => {
  const lanePlanCases: Array<[string, string]> = [
    ['contract_conflict', 'contract_conflict: acceptance criteria conflict with existing contract'],
    ['scope_gap', 'scope_gap: declared files do not cover required acceptance criteria'],
    ['no_test_files', 'no_test_files: classifyFiles returned empty testFiles for lane'],
  ]

  it.each(lanePlanCases)('%s classifies as lane_plan with deterministic confidence', (_label, error) => {
    const result = classifyLaneError(error, 'RED')
    expect(result.category).toBe('lane_plan')
    expect(result.confidence).toBe('deterministic')
  })
})

describe('classifyLaneError — deterministic agent_behavior prefixes', () => {
  const agentBehaviorCases: Array<[string, string]> = [
    ['placeholder_assertions', 'placeholder_assertions: 3: expect(true).toBe(false)'],
    ['no_new_test_functions_committed', 'no_new_test_functions_committed: 0 of 3 required test functions found'],
    ['green_blindness_violation', 'green_blindness_violation: GREEN agent read RED test file contents'],
    ['file_ownership_violation', 'file_ownership_violation: wrote outside allowed_write_files'],
    ['skeptic_broken', 'skeptic_broken: 2 confirmed bugs — off-by-one in loop bound'],
    ['green_verify_failed', 'green_verify_failed: independent test-verify step exit=1 (agent self-reported tests_pass=true)'],
    ['refactor_verify_failed', 'refactor_verify_failed: independent test-verify step exit=1 after refactor'],
  ]

  it.each(agentBehaviorCases)('%s classifies as agent_behavior with deterministic confidence', (_label, error) => {
    const result = classifyLaneError(error, 'GREEN')
    expect(result.category).toBe('agent_behavior')
    expect(result.confidence).toBe('deterministic')
  })
})

describe('classifyLaneError — deterministic *_no_result prefixes (stage agent returned nothing)', () => {
  const noResultCases: Array<[string, string]> = [
    ['green_no_result', 'green_no_result: GREEN agent returned nothing on both attempts (likely the maxTurns cap in agents/datum-green.md — the lane may need a smaller scope, or the cap raised)'],
    ['red_no_result', 'red_no_result: RED agent returned nothing on both attempts (likely the maxTurns cap in agents/datum-red.md — the lane may need a smaller scope, or the cap raised)'],
    ['refactor_no_result', 'refactor_no_result: REFACTOR agent returned nothing (likely the maxTurns cap in agents/datum-refactor.md, an API error, or a skip)'],
  ]

  it.each(noResultCases)('%s classifies as infrastructure with deterministic confidence', (_label, error) => {
    const result = classifyLaneError(error, 'RED')
    expect(result.category).toBe('infrastructure')
    expect(result.confidence).toBe('deterministic')
  })
})

describe('classifyLaneError — no_new_tests_written (post-RED count from epic merge-base)', () => {
  it('classifies as agent_behavior with deterministic confidence, same as no_new_test_functions_committed', () => {
    const result = classifyLaneError('no_new_tests_written: RED agent did not append any test functions', 'RED')
    expect(result.category).toBe('agent_behavior')
    expect(result.confidence).toBe('deterministic')
  })
})

describe('classifyLaneError — context_read_unverified (assertReadWitness)', () => {
  it('classifies as agent_behavior with deterministic confidence', () => {
    const result = classifyLaneError(
      "context_read_unverified: docs/big-file.md — agent did not evidence reading the deferred file (expected blob abc123, got ?)",
      'RED',
    )
    expect(result.category).toBe('agent_behavior')
    expect(result.confidence).toBe('deterministic')
  })
})

describe('classifyLaneError — agent_output_unparseable (parseAgentJsonStrict)', () => {
  it('classifies as agent_behavior with deterministic confidence', () => {
    const result = classifyLaneError('agent_output_unparseable: green:task-004 — (no result)', 'GREEN')
    expect(result.category).toBe('agent_behavior')
    expect(result.confidence).toBe('deterministic')
  })
})

describe('classifyLaneError — agent_types_unconfigured (stageOpts called before configureAgentTypes)', () => {
  it('classifies as infrastructure with deterministic confidence', () => {
    const result = classifyLaneError(
      "Error: agent_types_unconfigured: stageOpts('red', red:task-004) called before configureAgentTypes() — configure from args/config first, or use bootstrapOpts() for the read that has to precede configuration",
      'CRASH',
    )
    expect(result.category).toBe('infrastructure')
    expect(result.confidence).toBe('deterministic')
  })
})

describe('classifyLaneError — dependency (blocked/SKIPPED)', () => {
  it('classifies stage=SKIPPED as dependency regardless of error text', () => {
    const result = classifyLaneError('anything at all', 'SKIPPED')
    expect(result.category).toBe('dependency')
    expect(result.confidence).toBe('deterministic')
  })

  it('classifies a "blocked: ..." error as dependency even without SKIPPED stage', () => {
    const result = classifyLaneError('blocked: upstream dependency \'task-001\' is blocked (count_gate_failed: ...)', undefined)
    expect(result.category).toBe('dependency')
    expect(result.confidence).toBe('deterministic')
  })

  it('classifies a "blocked: dep(s) failed [...]" error as dependency', () => {
    const result = classifyLaneError('blocked: dep(s) failed [task-002]', 'RED')
    expect(result.category).toBe('dependency')
    expect(result.confidence).toBe('deterministic')
  })
})

describe('classifyLaneError — table completeness vs datum-tdd-act-lane.ts', () => {
  // Source-text heuristic, not a parser: pulls the leading `snake_case:`
  // prefix (the `"<prefix>: <human detail>"` convention every producer in
  // this file follows) out of any `error: <literal>` object-property value or
  // `throw new Error(<literal>)` call whose literal is inlined at that call
  // site. Known limits:
  //   - misses a prefix built via an intermediate variable first, e.g.
  //     `const failure = 'refactor_no_result: ...'; ...; error: failure` —
  //     refactor_no_result is one such case and is added to the table by
  //     hand rather than caught here.
  //   - only scans datum-tdd-act-lane.ts, not the other pipeline scripts
  //     (datum-validate.ts, datum-go.ts, datum-plan.ts, datum-refine.ts,
  //     shared/*.ts) that also produce prefixes this module classifies.
  // The point of this test is not full coverage — it's a tripwire so the
  // *next* new inlined lane-error prefix added to datum-tdd-act-lane.ts
  // fails CI until someone teaches classifyLaneError about it (the #387 /
  // #392 / #414 failure mode this module exists to prevent).
  const laneSrc = readFileSync(join(__dirname, '../datum-tdd-act-lane.ts'), 'utf8')
  const PREFIX_LITERAL_RE = /(?:error:\s*|throw new Error\()\s*[`'"]([a-z]+(?:_[a-z]+)+):/g

  const foundPrefixes = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = PREFIX_LITERAL_RE.exec(laneSrc))) {
    foundPrefixes.add(m[1])
  }

  it('regex sanity check: found a non-trivial number of known prefixes', () => {
    // Guards against the regex silently matching nothing after a refactor
    // (e.g. if the file moves or the `error:`/`throw new Error(` convention
    // changes) and this whole describe block going quietly green.
    expect(foundPrefixes.size).toBeGreaterThanOrEqual(10)
  })

  it.each([...foundPrefixes].sort().map((p): [string] => [p]))(
    'inlined lane-error prefix %s is classified deterministically',
    (prefix) => {
      const result = classifyLaneError(`${prefix}: something happened`, 'RED')
      expect(result.confidence).toBe('deterministic')
    },
  )
})

describe('triageDestination — bug: consumer-code findings (e.g. #417) must never be filed to datum\'s tracker', () => {
  it('routes agent_behavior (skeptic_broken / green_verify_failed) findings to consumer, not datum', () => {
    const result = triageDestination(
      { category: 'agent_behavior', confidence: 'deterministic', reason: 'skeptic_broken: 2 confirmed bugs' },
      'skeptic_broken: 2 confirmed bugs — off-by-one in loop bound',
    )
    expect(result).toBe('consumer')
  })

  it('routes lane_plan (contract_conflict / scope_gap) findings to consumer, not datum', () => {
    const result = triageDestination(
      { category: 'lane_plan', confidence: 'deterministic', reason: 'scope_gap: ...' },
      'scope_gap: declared files do not cover required acceptance criteria',
    )
    expect(result).toBe('consumer')
  })

  it('routes test_quality findings to consumer, not datum', () => {
    const result = triageDestination(
      { category: 'test_quality', confidence: 'heuristic', reason: 'weak assertions' },
      'tests assert nothing meaningful',
    )
    expect(result).toBe('consumer')
  })

  it('routes infrastructure findings to datum (pipeline/tooling is at fault)', () => {
    const result = triageDestination(
      { category: 'infrastructure', confidence: 'deterministic', reason: 'count_gate_no_output: ...' },
      'count_gate_no_output: test-count-check returned null',
    )
    expect(result).toBe('datum')
  })

  it('routes workflow_bug findings to datum (datum-tdd-act.js logic error)', () => {
    const result = triageDestination(
      { category: 'workflow_bug', confidence: 'heuristic', reason: 'pipeline logic error' },
      'TypeError in datum-tdd-act-lane.ts scheduling',
    )
    expect(result).toBe('datum')
  })

  it('routes dependency (already-skipped) failures to none — they were never filed anywhere', () => {
    const result = triageDestination(
      { category: 'dependency', confidence: 'deterministic', reason: 'blocked' },
      'blocked: dep(s) failed [task-002]',
    )
    expect(result).toBe('none')
  })

  it('routes unknown/heuristic findings to consumer (never assume datum is at fault without a known pipeline prefix)', () => {
    const result = triageDestination(
      { category: 'unknown', confidence: 'heuristic', reason: 'no known prefix matched' },
      'TypeError: cannot read property of undefined',
    )
    expect(result).toBe('consumer')
  })
})

describe('triageDestination — every taxonomy category in triage-classify.ts has an explicit destination', () => {
  // Source-text scan (like the classifyLaneError table-completeness test above)
  // so this test fails the moment a new TriageClassifyCategory value is
  // introduced into PREFIX_RULES without also being taught to triageDestination
  // — the exact failure mode this module exists to prevent (a new category
  // silently defaulting to 'datum' and misfiling a consumer-code finding,
  // as happened with #417).
  const src = readFileSync(join(__dirname, 'triage-classify.ts'), 'utf8')
  const CATEGORY_LITERAL_RE = /category:\s*'([a-z_]+)'/g
  const foundCategories = new Set<string>(['dependency', 'unknown'])
  let m: RegExpExecArray | null
  while ((m = CATEGORY_LITERAL_RE.exec(src))) {
    foundCategories.add(m[1])
  }

  it('regex sanity check: found a non-trivial number of known taxonomy categories', () => {
    expect(foundCategories.size).toBeGreaterThanOrEqual(5)
  })

  const EXPECTED_DESTINATION: Record<string, 'datum' | 'consumer' | 'none'> = {
    infrastructure: 'datum',
    workflow_bug: 'datum',
    lane_plan: 'consumer',
    agent_behavior: 'consumer',
    test_quality: 'consumer',
    dependency: 'none',
    unknown: 'consumer',
  }

  it.each([...foundCategories].sort())('taxonomy category %s has an explicit destination table entry', (category) => {
    expect(
      EXPECTED_DESTINATION[category],
      `no expected destination for taxonomy category "${category}" — update EXPECTED_DESTINATION in this test and triageDestination in triage-classify.ts`,
    ).toBeDefined()
    const result = triageDestination(
      { category: category as TriageClassifyCategory, confidence: 'deterministic', reason: 'x' },
      'some error text',
    )
    expect(result).toBe(EXPECTED_DESTINATION[category])
  })
})

describe('classifyLaneError — unknown fallback', () => {
  it('returns unknown/heuristic for an error with no recognized prefix', () => {
    const result = classifyLaneError('TypeError: cannot read property of undefined', 'GREEN')
    expect(result.category).toBe('unknown')
    expect(result.confidence).toBe('heuristic')
  })

  it('returns unknown/heuristic for an undefined error', () => {
    const result = classifyLaneError(undefined, undefined)
    expect(result.category).toBe('unknown')
    expect(result.confidence).toBe('heuristic')
  })

  it('returns unknown/heuristic for an empty error string', () => {
    const result = classifyLaneError('', 'RED')
    expect(result.category).toBe('unknown')
    expect(result.confidence).toBe('heuristic')
  })
})
