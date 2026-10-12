// Tests for DAT-14 — stage output schema validation with one tier-up retry.
// validateAgainstSchema is checked directly; the retry behaviour is driven
// through runBundle with FakeExecutor scripts and the metrics.jsonl sink.

import { describe, it, expect, vi, afterAll, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBundle } from './runner'
import { validateAgainstSchema } from './validate'
import { FakeExecutor } from './fake-executor'
import type { StageReply, StageRequest } from './executor'
import { STAGE_RESULT_SCHEMA } from '../shared/schemas'
import { readRuntimeConfig, setModelTiers } from '../shared/models'

const tmp = mkdtempSync(join(tmpdir(), 'dat14-stage-output-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
afterEach(() => {
  setModelTiers({})
  vi.restoreAllMocks()
})

let n = 0
function bundle(body: string): string {
  const p = join(tmp, `bundle-${n++}.js`)
  writeFileSync(p, `export const meta = { name: 'dat14-test' }\n${body}\n`)
  return p
}

const distinct = readRuntimeConfig({
  runtime: { kind: 'fake', models: { fast: 'fast-id', balanced: 'bal-id', deep: 'deep-id' } },
})
const sharedBalancedDeep = readRuntimeConfig({
  runtime: { kind: 'fake', models: { fast: 'fast-id', balanced: 'same-id', deep: 'same-id' } },
})

const VALID = {
  success: true,
  tests_pass: false,
  committed: false,
  read_witness: {},
  files_written: ['a.test.ts'],
  test_exit_code: 1,
}
const validReply: StageReply = { text: JSON.stringify(VALID) }
const invalidReply: StageReply = { text: JSON.stringify({ success: true }) }

type Metric = { label: string; model: string; attempt: number; outcome: string }

function setup(
  script: ConstructorParameters<typeof FakeExecutor>[0],
  runtime = distinct,
  defaultReply: StageReply = { text: '{}' },
) {
  const executor = new FakeExecutor(script, defaultReply)
  const logFn = vi.fn()
  const shell = vi.fn(async () => ({ exit_code: 0, stdout: '', stderr: '' }))
  const runId = `dat14-run-${n++}`
  const run = (body: string) =>
    runBundle({
      bundlePath: bundle(body),
      args: { runId },
      executor,
      shell,
      skillsDirs: [],
      log: logFn,
      runtime,
      repoRoot: tmp,
    })
  const metrics = (): Metric[] => {
    const p = join(tmp, '.datum', 'runs', runId, 'metrics.jsonl')
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Metric)
  }
  const logs = (): string[] => logFn.mock.calls.map((c) => String(c[0]))
  return { executor, run, metrics, logs }
}

// A bundle that makes one schema-bearing agent() call on the given tier.
const call = (model: string | null, label = 'stage-x') =>
  `return await agent('do it', { label: ${JSON.stringify(label)}, schema: ${JSON.stringify(STAGE_RESULT_SCHEMA)}${
    model === null ? '' : `, model: ${JSON.stringify(model)}`
  } })`

describe('validateAgainstSchema', () => {
  it('AC2: reports every missing required field by name', () => {
    const problems = validateAgainstSchema(STAGE_RESULT_SCHEMA, { success: true })
    for (const field of ['tests_pass', 'committed', 'read_witness', 'files_written', 'test_exit_code']) {
      expect(problems.some((p: string) => p.includes(field))).toBe(true)
    }
    expect(problems.some((p: string) => p.includes('success'))).toBe(false)
    expect(problems).toHaveLength(5)
  })

  it('AC2: returns no problems for a fully valid value', () => {
    expect(validateAgainstSchema(STAGE_RESULT_SCHEMA, VALID)).toEqual([])
  })

  it('AC2: a fractional test_exit_code is reported as wrongly typed integer', () => {
    const problems = validateAgainstSchema(STAGE_RESULT_SCHEMA, { ...VALID, test_exit_code: 1.5 })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('test_exit_code')
    expect(problems[0]).toContain('integer')
  })

  it('AC2: a whole-number test_exit_code is accepted as integer', () => {
    expect(validateAgainstSchema(STAGE_RESULT_SCHEMA, { ...VALID, test_exit_code: 0 })).toEqual([])
  })

  it.each([
    ['string', { type: 'object', properties: { f: { type: 'string' } }, required: ['f'] }, 5, 'x'],
    ['number', { type: 'object', properties: { f: { type: 'number' } }, required: ['f'] }, '5', 2.5],
    ['integer', { type: 'object', properties: { f: { type: 'integer' } }, required: ['f'] }, '5', 5],
    ['boolean', { type: 'object', properties: { f: { type: 'boolean' } }, required: ['f'] }, 'true', false],
    ['array', { type: 'object', properties: { f: { type: 'array' } }, required: ['f'] }, {}, []],
    ['object', { type: 'object', properties: { f: { type: 'object' } }, required: ['f'] }, [], {}],
  ])('AC2: %s is checked (wrong value flagged, right value accepted)', (type, schema, wrong, right) => {
    const bad = validateAgainstSchema(schema, { f: wrong })
    expect(bad).toHaveLength(1)
    expect(bad[0]).toContain('f')
    expect(bad[0]).toContain(type)
    expect(validateAgainstSchema(schema, { f: right })).toEqual([])
  })

  it('AC2: a non-object value is invalid (negative path)', () => {
    expect(validateAgainstSchema(STAGE_RESULT_SCHEMA, null).length).toBeGreaterThan(0)
    expect(validateAgainstSchema(STAGE_RESULT_SCHEMA, [VALID]).length).toBeGreaterThan(0)
  })
})

describe('runBundle schema-invalid replies', () => {
  it('AC3: an invalid fast reply logs the field list, writes an invalid/attempt-1 line and retries on balanced as attempt 2', async () => {
    const replies = [invalidReply, validReply]
    let i = 0
    const { executor, run, metrics, logs } = setup([{ labelPrefix: 'stage-x', reply: () => replies[i++] }])
    const out = await run(call('fast'))
    expect(out).toEqual(VALID)
    expect(executor.requests.map((r) => r.model)).toEqual(['fast-id', 'bal-id'])
    const line = logs().find((l) => l.startsWith('stage_output_invalid: stage-x: '))
    expect(line).toBeDefined()
    for (const field of ['tests_pass', 'committed', 'read_witness', 'files_written', 'test_exit_code']) {
      expect(line).toContain(field)
    }
    const m = metrics()
    expect(m).toHaveLength(2)
    expect([m[0].model, m[0].attempt, m[0].outcome]).toEqual(['fast-id', 1, 'invalid'])
    expect([m[1].model, m[1].attempt, m[1].outcome]).toEqual(['bal-id', 2, 'ok'])
  })

  it('AC3: the retry reuses the prompt and the label', async () => {
    const replies = [invalidReply, validReply]
    let i = 0
    const { executor, run } = setup([{ labelPrefix: 'stage-x', reply: () => replies[i++] }])
    await run(call('fast'))
    expect(executor.requests[1].prompt).toBe(executor.requests[0].prompt)
    expect(executor.requests[1].opts.label).toBe('stage-x')
  })

  it('AC4: an invalid reply on the retry returns null and leaves two invalid metrics lines', async () => {
    const { executor, run, metrics } = setup([{ labelPrefix: 'stage-x', reply: invalidReply }])
    expect(await run(call('fast'))).toBeNull()
    expect(executor.requests).toHaveLength(2)
    const m = metrics()
    expect(m.map((l) => [l.attempt, l.outcome])).toEqual([
      [1, 'invalid'],
      [2, 'invalid'],
    ])
    expect(m.map((l) => l.model)).toEqual(['fast-id', 'bal-id'])
  })

  it('AC5: an invalid deep-tier reply is not retried (one request, null)', async () => {
    const { executor, run, metrics } = setup([{ labelPrefix: 'stage-x', reply: invalidReply }])
    expect(await run(call('deep'))).toBeNull()
    expect(executor.requests).toHaveLength(1)
    expect(executor.requests[0].model).toBe('deep-id')
    expect(metrics().map((l) => [l.attempt, l.outcome])).toEqual([[1, 'invalid']])
  })

  it('AC5: an invalid balanced reply tiers up to deep as attempt 2', async () => {
    const replies = [invalidReply, validReply]
    let i = 0
    const { executor, run } = setup([{ labelPrefix: 'stage-x', reply: () => replies[i++] }])
    expect(await run(call('balanced'))).toEqual(VALID)
    expect(executor.requests.map((r) => r.model)).toEqual(['bal-id', 'deep-id'])
  })

  it('AC6: with no distinct higher tier an invalid balanced reply logs that and returns null without a retry', async () => {
    const { executor, run, logs } = setup([{ labelPrefix: 'stage-x', reply: invalidReply }], sharedBalancedDeep)
    expect(await run(call('balanced'))).toBeNull()
    expect(executor.requests).toHaveLength(1)
    expect(logs()).toContain('stage_output_invalid: stage-x: no distinct higher tier')
  })

  it('AC6: a model id outside the models map, including haiku, is treated as fast and retried on balanced', async () => {
    for (const id of ['haiku', 'some-unknown-model']) {
      const replies = [invalidReply, validReply]
      let i = 0
      const { executor, run } = setup([{ labelPrefix: 'stage-x', reply: () => replies[i++] }])
      expect(await run(call(id))).toEqual(VALID)
      expect(executor.requests.map((r) => r.model)).toEqual([id, 'bal-id'])
    }
  })

  it('AC7: a reply parseAgentJson cannot parse takes the invalid path (retried, then null)', async () => {
    const { executor, run, metrics, logs } = setup([{ labelPrefix: 'stage-x', reply: { text: 'no json here at all' } }])
    expect(await run(call('fast'))).toBeNull()
    expect(executor.requests).toHaveLength(2)
    expect(metrics().map((l) => l.outcome)).toEqual(['invalid', 'invalid'])
    expect(logs().some((l) => l.startsWith('stage_output_invalid: stage-x: '))).toBe(true)
  })

  it('AC7: an unparseable first reply followed by a valid one returns the valid value', async () => {
    const replies: StageReply[] = [{ text: 'prose only' }, validReply]
    let i = 0
    const { run } = setup([{ labelPrefix: 'stage-x', reply: (_r: StageRequest) => replies[i++] }])
    expect(await run(call('fast'))).toEqual(VALID)
  })

  it('a valid first reply makes one request, one ok line and no invalid log', async () => {
    const { executor, run, metrics, logs } = setup([{ labelPrefix: 'stage-x', reply: validReply }])
    expect(await run(call('fast'))).toEqual(VALID)
    expect(executor.requests).toHaveLength(1)
    expect(metrics().map((l) => [l.attempt, l.outcome])).toEqual([[1, 'ok']])
    expect(logs().some((l) => l.startsWith('stage_output_invalid'))).toBe(false)
  })
})

describe('runBundle without opts.schema', () => {
  it('AC8: returns the parsed value with no validation, no retry and no invalid log', async () => {
    const { executor, run, metrics, logs } = setup([{ labelPrefix: 'free', reply: { text: '{"anything":1}' } }])
    const out = await run(`return await agent('p', { label: 'free', model: 'fast' })`)
    expect(out).toEqual({ anything: 1 })
    expect(executor.requests).toHaveLength(1)
    expect(metrics().map((l) => l.outcome)).toEqual(['ok'])
    expect(logs().some((l) => l.startsWith('stage_output_invalid'))).toBe(false)
  })

  it('AC8: an unparseable reply without a schema keeps the null fallback with a single request', async () => {
    const { executor, run } = setup([{ labelPrefix: 'free', reply: { text: 'prose' } }])
    expect(await run(`return await agent('p', { label: 'free', model: 'fast' })`)).toBeNull()
    expect(executor.requests).toHaveLength(1)
  })
})
