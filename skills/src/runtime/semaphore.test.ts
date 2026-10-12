// Tests for DAT-12 — per-model semaphores with agentType affinity. The
// semaphore is exercised directly: max in flight, FIFO order, and the
// "hand the slot to a waiter of the finishing request's agentType" rule.

import { describe, it, expect } from 'vitest'
import { createModelSemaphores } from './semaphore'
import { FakeExecutor } from './fake-executor'
import type { StageReply } from './executor'

const DEFAULT_REPLY: StageReply = { text: '{}' }

const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms))

async function waitFor(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (cond()) return
    await new Promise<void>((r) => setTimeout(r, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

type Sem = ReturnType<typeof createModelSemaphores>

// One request: take a slot, run it on the executor, give the slot back.
async function runOne(
  sem: Sem,
  ex: FakeExecutor,
  model: string,
  label: string,
  agentType?: string,
  onStart?: () => void,
): Promise<void> {
  const release = await sem.acquire(model, agentType)
  onStart?.()
  try {
    await ex.execute({ prompt: label, opts: { label, model, agentType }, model, headers: {} })
  } finally {
    release()
  }
}

function inFlight(ex: FakeExecutor): number {
  return ex.requests.filter((r) => r.endedAt === null).length
}

describe('createModelSemaphores concurrency bound', () => {
  it('AC1: with concurrency { m1: 2 } and 5 held requests, never more than 2 are in flight; all 5 finish after release', async () => {
    const sem = createModelSemaphores({ m1: 2 })
    const ex = new FakeExecutor([], DEFAULT_REPLY)
    ex.hold('w-')
    let maxInFlight = 0
    const sample = setInterval(() => {
      maxInFlight = Math.max(maxInFlight, inFlight(ex))
    }, 1)
    try {
      const all = [1, 2, 3, 4, 5].map((i) => runOne(sem, ex, 'm1', `w-${i}`))
      await waitFor(() => ex.requests.length >= 2, 'two requests to start')
      await tick(30)
      expect(ex.requests).toHaveLength(2)
      expect(inFlight(ex)).toBe(2)

      ex.release('w-')
      await Promise.all(all)
    } finally {
      clearInterval(sample)
    }
    expect(ex.requests).toHaveLength(5)
    expect(ex.requests.every((r) => r.endedAt !== null)).toBe(true)
    expect(maxInFlight).toBe(2)
  })

  it('AC2: a model with no concurrency entry runs 1 request at a time', async () => {
    const sem = createModelSemaphores({ m1: 3 })
    const ex = new FakeExecutor([], DEFAULT_REPLY)
    ex.hold('u-')
    const all = [1, 2, 3].map((i) => runOne(sem, ex, 'unlisted', `u-${i}`))
    await waitFor(() => ex.requests.length >= 1, 'first request to start')
    await tick(30)
    expect(ex.requests).toHaveLength(1)

    ex.release('u-')
    await Promise.all(all)
    expect(ex.requests).toHaveLength(3)
  })

  it('AC2: with an empty concurrency map every model is limited to 1 (negative path)', async () => {
    const sem = createModelSemaphores({})
    const started: string[] = []
    const r1 = await sem.acquire('any')
    const p2 = sem.acquire('any').then((r) => {
      started.push('second')
      return r
    })
    await tick(30)
    expect(started).toEqual([])
    r1()
    const r2 = await p2
    expect(started).toEqual(['second'])
    r2()
  })

  it('AC1: a saturated model does not block a different model (per-model, not global)', async () => {
    const sem = createModelSemaphores({ m1: 1, m2: 1 })
    const holdM1 = await sem.acquire('m1')
    const m2 = await Promise.race([
      sem.acquire('m2').then(() => 'acquired'),
      tick(100).then(() => 'blocked'),
    ])
    expect(m2).toBe('acquired')
    holdM1()
  })

  it('AC6: over 50 queued requests the in-flight count never exceeds concurrency[model]', async () => {
    const sem = createModelSemaphores({ m1: 3 })
    const ex = new FakeExecutor([], DEFAULT_REPLY)
    let live = 0
    let max = 0
    const all = Array.from({ length: 50 }, (_, i) =>
      (async () => {
        const release = await sem.acquire('m1')
        live++
        max = Math.max(max, live)
        try {
          await ex.execute({ prompt: `q-${i}`, opts: { label: `q-${i}` }, model: 'm1', headers: {} })
          await tick(1)
        } finally {
          live--
          release()
        }
      })(),
    )
    await Promise.all(all)
    expect(ex.requests).toHaveLength(50)
    expect(max).toBe(3)
    expect(live).toBe(0)
  })
})

describe('createModelSemaphores wake order', () => {
  it('AC3: waiters [A1, B1, A2] and a finishing request of agentType A start in order A1, A2, B1', async () => {
    const sem = createModelSemaphores({ m1: 1 })
    const order: string[] = []
    const holder = await sem.acquire('m1', 'A')
    const waiter = (name: string, type: string) =>
      sem.acquire('m1', type).then((release) => {
        order.push(name)
        return release
      })
    const pA1 = waiter('A1', 'A')
    const pB1 = waiter('B1', 'B')
    const pA2 = waiter('A2', 'A')
    await tick(20)
    expect(order).toEqual([])

    holder()
    const rA1 = await pA1
    await tick(20)
    expect(order).toEqual(['A1'])

    rA1()
    const rA2 = await pA2
    await tick(20)
    expect(order).toEqual(['A1', 'A2'])

    rA2()
    const rB1 = await pB1
    expect(order).toEqual(['A1', 'A2', 'B1'])
    rB1()
  })

  it('AC4: with no waiter matching the finished request\'s agentType, the earliest-arrived waiter starts next', async () => {
    const sem = createModelSemaphores({ m1: 1 })
    const order: string[] = []
    const holder = await sem.acquire('m1', 'C')
    const waiter = (name: string, type: string | undefined) =>
      sem.acquire('m1', type).then((release) => {
        order.push(name)
        return release
      })
    const pB1 = waiter('B1', 'B')
    const pA1 = waiter('A1', 'A')
    const pN = waiter('N1', undefined)

    holder()
    const rB1 = await pB1
    await tick(20)
    expect(order).toEqual(['B1'])

    rB1()
    const rA1 = await pA1
    await tick(20)
    expect(order).toEqual(['B1', 'A1'])

    rA1()
    const rN = await pN
    expect(order).toEqual(['B1', 'A1', 'N1'])
    rN()
  })

  it('AC4: waiters of one agentType are served first-come-first-served among themselves', async () => {
    const sem = createModelSemaphores({ m1: 1 })
    const order: string[] = []
    let release = await sem.acquire('m1', 'A')
    const ps = ['A1', 'A2', 'A3'].map((name) =>
      sem.acquire('m1', 'A').then((r) => {
        order.push(name)
        return r
      }),
    )
    for (const p of ps) {
      release()
      release = await p
    }
    release()
    expect(order).toEqual(['A1', 'A2', 'A3'])
  })
})

describe('createModelSemaphores bookkeeping overhead', () => {
  it('AC7: 1,000 queued requests against a FakeExecutor average under 5 ms of overhead each', async () => {
    const sem = createModelSemaphores({ m1: 4 })
    const ex = new FakeExecutor([], DEFAULT_REPLY)
    const t0 = performance.now()
    await Promise.all(Array.from({ length: 1000 }, (_, i) => runOne(sem, ex, 'm1', `o-${i}`, i % 2 === 0 ? 'A' : 'B')))
    const perRequest = (performance.now() - t0) / 1000
    expect(ex.requests).toHaveLength(1000)
    expect(perRequest).toBeLessThan(5)
  })
})
