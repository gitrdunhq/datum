// Tests for DAT-11 — FakeExecutor: scripted replies by label prefix, request
// recording with timestamps, and hold/release gating.

import { describe, it, expect } from 'vitest'
import { FakeExecutor } from './fake-executor'
import type { StageReply, StageRequest } from './executor'

type Recorded = {
  prompt: string
  model: string
  opts: { label?: string }
  startedAt: number
  endedAt?: number | null
}

function req(label: string | undefined, prompt = 'p'): StageRequest {
  return { prompt, opts: label === undefined ? {} : { label }, model: 'm1', headers: {} }
}

function recorded(ex: FakeExecutor): Recorded[] {
  return ex.requests as unknown as Recorded[]
}

function endedCount(ex: FakeExecutor): number {
  return recorded(ex).filter((r) => typeof r.endedAt === 'number').length
}

const tick = () => new Promise<void>((r) => setTimeout(r, 10))

const DEFAULT: StageReply = { text: 'default-reply' }

describe('FakeExecutor script matching', () => {
  it('AC7: answers with the script entry whose labelPrefix prefixes the label', async () => {
    const ex = new FakeExecutor(
      [
        { labelPrefix: 'red-', reply: { text: 'red-reply' } },
        { labelPrefix: 'green-', reply: { text: 'green-reply' } },
      ],
      DEFAULT,
    )
    expect(await ex.execute(req('green-DAT-1'))).toEqual({ text: 'green-reply' })
    expect(await ex.execute(req('red-DAT-1'))).toEqual({ text: 'red-reply' })
  })

  it('AC7: the first matching entry wins when several prefixes match', async () => {
    const ex = new FakeExecutor(
      [
        { labelPrefix: 'ab', reply: { text: 'first' } },
        { labelPrefix: 'a', reply: { text: 'second' } },
      ],
      DEFAULT,
    )
    expect((await ex.execute(req('abc'))).text).toBe('first')
    expect((await ex.execute(req('azz'))).text).toBe('second')
  })

  it('AC7: answers with the default reply when no labelPrefix matches', async () => {
    const ex = new FakeExecutor([{ labelPrefix: 'red-', reply: { text: 'red-reply' } }], DEFAULT)
    expect(await ex.execute(req('blue-1'))).toEqual(DEFAULT)
  })

  it('AC7: a request with no label gets the default reply (negative path)', async () => {
    const ex = new FakeExecutor([{ labelPrefix: 'red-', reply: { text: 'red-reply' } }], DEFAULT)
    expect(await ex.execute(req(undefined))).toEqual(DEFAULT)
  })

  it('AC7: a label that is only a partial match of the prefix does not match', async () => {
    const ex = new FakeExecutor([{ labelPrefix: 'red-long', reply: { text: 'red-reply' } }], DEFAULT)
    expect((await ex.execute(req('red-'))).text).toBe('default-reply')
  })

  it('AC7: a function reply receives the request and its return value is the reply', async () => {
    const ex = new FakeExecutor(
      [
        {
          labelPrefix: 'echo-',
          reply: (r: StageRequest): StageReply => ({
            text: `got:${r.prompt}`,
            usage: { prompt_tokens: 4, completion_tokens: 2, cached_tokens: 1 },
          }),
        },
      ],
      DEFAULT,
    )
    const reply = await ex.execute(req('echo-1', 'hello'))
    expect(reply).toEqual({
      text: 'got:hello',
      usage: { prompt_tokens: 4, completion_tokens: 2, cached_tokens: 1 },
    })
  })

  it('AC7: two identical executors given the same requests return identical replies (ISOLATION-006)', async () => {
    const script = [{ labelPrefix: 'x-', reply: { text: 'x-reply' } }]
    const a = new FakeExecutor(script, DEFAULT)
    const b = new FakeExecutor(script, DEFAULT)
    const labels = ['x-1', 'y-1', 'x-2']
    const ra = await Promise.all(labels.map((l) => a.execute(req(l))))
    const rb = await Promise.all(labels.map((l) => b.execute(req(l))))
    expect(ra).toEqual(rb)
    expect(ra.map((r) => r.text)).toEqual(['x-reply', 'default-reply', 'x-reply'])
  })
})

describe('FakeExecutor request recording', () => {
  it('AC7: requests records every request in call order with its prompt, model and label', async () => {
    const ex = new FakeExecutor([], DEFAULT)
    await ex.execute(req('one', 'p1'))
    await ex.execute(req('two', 'p2'))
    await ex.execute(req('three', 'p3'))
    const recs = recorded(ex)
    expect(recs.map((r) => r.opts.label)).toEqual(['one', 'two', 'three'])
    expect(recs.map((r) => r.prompt)).toEqual(['p1', 'p2', 'p3'])
    expect(recs.map((r) => r.model)).toEqual(['m1', 'm1', 'm1'])
  })

  it('AC7: each recorded request has numeric startedAt <= endedAt once it finished', async () => {
    const ex = new FakeExecutor([], DEFAULT)
    await ex.execute(req('one'))
    await ex.execute(req('two'))
    for (const r of recorded(ex)) {
      expect(typeof r.startedAt).toBe('number')
      expect(typeof r.endedAt).toBe('number')
      expect(r.endedAt as number).toBeGreaterThanOrEqual(r.startedAt)
    }
  })

  it('AC7: startedAt is non-decreasing across requests that start sequentially (ORDERING-010)', async () => {
    const ex = new FakeExecutor([], DEFAULT)
    await ex.execute(req('one'))
    await tick()
    await ex.execute(req('two'))
    await tick()
    await ex.execute(req('three'))
    const starts = recorded(ex).map((r) => r.startedAt)
    expect(starts).toHaveLength(3)
    expect(starts[1]).toBeGreaterThanOrEqual(starts[0])
    expect(starts[2]).toBeGreaterThanOrEqual(starts[1])
  })

  it('AC7: a fresh executor has no recorded requests', () => {
    expect(new FakeExecutor([], DEFAULT).requests).toHaveLength(0)
  })
})

describe('FakeExecutor hold and release', () => {
  it('AC8: hold(h) then 3 h-requests gives 3 recorded starts and 0 ends; release(h) gives 3 ends', async () => {
    const ex = new FakeExecutor([{ labelPrefix: 'h', reply: { text: 'held-reply' } }], DEFAULT)
    ex.hold('h')
    const pending = [ex.execute(req('h1')), ex.execute(req('h2')), ex.execute(req('h3'))]
    await tick()
    expect(recorded(ex)).toHaveLength(3)
    expect(endedCount(ex)).toBe(0)

    ex.release('h')
    const replies = await Promise.all(pending)
    expect(endedCount(ex)).toBe(3)
    expect(replies.map((r) => r.text)).toEqual(['held-reply', 'held-reply', 'held-reply'])
  })

  it('AC8: a request whose label does not match the hold prefix completes while others stay held', async () => {
    const ex = new FakeExecutor([], DEFAULT)
    ex.hold('h')
    const held = ex.execute(req('h1'))
    const free = await ex.execute(req('free-1'))
    expect(free).toEqual(DEFAULT)
    expect(recorded(ex)).toHaveLength(2)
    expect(endedCount(ex)).toBe(1)
    ex.release('h')
    await held
    expect(endedCount(ex)).toBe(2)
  })

  it('AC8: release of one prefix leaves requests held under another prefix waiting', async () => {
    const ex = new FakeExecutor([], DEFAULT)
    ex.hold('a')
    ex.hold('b')
    const pa = ex.execute(req('a1'))
    const pb = ex.execute(req('b1'))
    await tick()
    ex.release('a')
    await pa
    await tick()
    expect(endedCount(ex)).toBe(1)
    expect(recorded(ex).find((r) => r.opts.label === 'b1')?.endedAt ?? null).toBeNull()
    ex.release('b')
    await pb
    expect(endedCount(ex)).toBe(2)
  })

  it('AC8: release with nothing held for that prefix is a no-op and does not throw', () => {
    const ex = new FakeExecutor([], DEFAULT)
    expect(() => ex.release('never-held')).not.toThrow()
    expect(ex.requests).toHaveLength(0)
  })
})
