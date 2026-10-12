// Tests for DAT-10 — readRuntimeConfig pure parser and concurrencyFor helper.
// Provisional defaults recorded in test names: Q4 (no invented models when a
// tier is missing) and Q5 (no invented runtime block; kind 'pi' parses, the
// CLI is what rejects it).

import { describe, it, expect } from 'vitest'
import { readRuntimeConfig, concurrencyFor } from './models'

const models = { fast: 'f', balanced: 'b', deep: 'd' }

describe('readRuntimeConfig', () => {
  it('AC1: minimal fake block returns exact object with defaults (concurrency {}, priority batch, client datum)', () => {
    const rc = readRuntimeConfig({ runtime: { kind: 'fake', models: { fast: 'f', balanced: 'b', deep: 'd' } } })
    expect(rc).toEqual({
      kind: 'fake',
      models: { fast: 'f', balanced: 'b', deep: 'd' },
      concurrency: {},
      priority: 'batch',
      client: 'datum',
    })
  })

  it('AC2: explicit priority interactive and client x are returned unchanged', () => {
    const rc = readRuntimeConfig({ runtime: { kind: 'fake', models, priority: 'interactive', client: 'x' } })
    expect(rc.priority).toBe('interactive')
    expect(rc.client).toBe('x')
    expect(rc.kind).toBe('fake')
    expect(rc.models).toEqual(models)
  })

  it('AC3: unknown kind throws runtime_kind_unknown: bogus', () => {
    expect(() => readRuntimeConfig({ runtime: { kind: 'bogus', models } })).toThrow('runtime_kind_unknown: bogus')
  })

  it('AC3: the thrown value is an Error instance carrying exactly that message', () => {
    let caught: unknown
    try {
      readRuntimeConfig({ runtime: { kind: 'bogus', models } })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('runtime_kind_unknown: bogus')
  })

  it('AC4 (Q4 default: no invented models): missing models.balanced throws runtime_models_missing: balanced', () => {
    expect(() =>
      readRuntimeConfig({ runtime: { kind: 'fake', models: { fast: 'f', deep: 'd' } } }),
    ).toThrow('runtime_models_missing: balanced')
  })

  it('AC5: concurrency 0 throws runtime_concurrency_invalid: m1', () => {
    expect(() =>
      readRuntimeConfig({ runtime: { kind: 'fake', models, concurrency: { m1: 0 } } }),
    ).toThrow('runtime_concurrency_invalid: m1')
  })

  it('AC5: concurrency 1.5 throws runtime_concurrency_invalid: m1', () => {
    expect(() =>
      readRuntimeConfig({ runtime: { kind: 'fake', models, concurrency: { m1: 1.5 } } }),
    ).toThrow('runtime_concurrency_invalid: m1')
  })

  it('AC5: concurrency -2 throws runtime_concurrency_invalid: m1', () => {
    expect(() =>
      readRuntimeConfig({ runtime: { kind: 'fake', models, concurrency: { m1: -2 } } }),
    ).toThrow('runtime_concurrency_invalid: m1')
  })

  it('AC5: a valid positive-integer concurrency is kept and looked up by concurrencyFor', () => {
    const rc = readRuntimeConfig({ runtime: { kind: 'fake', models, concurrency: { m1: 4 } } })
    expect(rc.concurrency).toEqual({ m1: 4 })
    expect(concurrencyFor(rc, 'm1')).toBe(4)
  })

  it('AC6: concurrencyFor returns 1 for a model with no concurrency entry', () => {
    const rc = readRuntimeConfig({ runtime: { kind: 'fake', models, concurrency: { m1: 4 } } })
    expect(concurrencyFor(rc, 'unknown-model')).toBe(1)
  })

  it('AC6: concurrencyFor returns 1 for unknown model on the default (empty) concurrency map', () => {
    const rc = readRuntimeConfig({ runtime: { kind: 'fake', models } })
    expect(concurrencyFor(rc, 'unknown-model')).toBe(1)
  })

  it('AC7 (Q5 default: no invented models): no runtime block throws runtime_block_missing', () => {
    expect(() => readRuntimeConfig({})).toThrow('runtime_block_missing')
  })

  it('AC7: the function never invents models, so a block without models throws rather than defaulting', () => {
    expect(() => readRuntimeConfig({ runtime: { kind: 'fake' } })).toThrow(/^runtime_models_missing: /)
  })

  it('AC8 (Q5): kind pi is accepted by the parser; rejecting it is the CLI job', () => {
    const rc = readRuntimeConfig({ runtime: { kind: 'pi', models } })
    expect(rc.kind).toBe('pi')
    expect(rc.models).toEqual(models)
    expect(rc.priority).toBe('batch')
    expect(rc.client).toBe('datum')
  })

  it('AC9: pure function of its argument: repeated calls on a frozen input return equal fresh results and do not mutate the input', () => {
    const input = Object.freeze({
      runtime: Object.freeze({
        kind: 'fake',
        models: Object.freeze({ fast: 'f', balanced: 'b', deep: 'd' }),
        concurrency: Object.freeze({ m1: 2 }),
      }),
    })
    const snapshot = JSON.stringify(input)
    const a = readRuntimeConfig(input)
    const b = readRuntimeConfig(input)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(a).toEqual({
      kind: 'fake',
      models: { fast: 'f', balanced: 'b', deep: 'd' },
      concurrency: { m1: 2 },
      priority: 'batch',
      client: 'datum',
    })
  })
})
