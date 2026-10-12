// Per-model counting semaphores. A model with no concurrency entry gets one
// slot. When a slot frees up it goes to the earliest waiter that shares the
// finishing request's agentType (keeps a model's prompt cache warm for one
// agent type), otherwise to the earliest-arrived waiter.

export type Release = () => void

export interface ModelSemaphores {
  acquire(model: string, agentType?: string): Promise<Release>
}

interface Waiter {
  agentType: string | undefined
  grant: () => void
}

interface ModelState {
  limit: number
  active: number
  waiters: Waiter[]
}

export function createModelSemaphores(concurrency: Readonly<Record<string, number>>): ModelSemaphores {
  const states = new Map<string, ModelState>()

  const stateFor = (model: string): ModelState => {
    let s = states.get(model)
    if (!s) {
      const limit = Object.prototype.hasOwnProperty.call(concurrency, model) ? concurrency[model] : 1
      s = { limit, active: 0, waiters: [] }
      states.set(model, s)
    }
    return s
  }

  const take = (state: ModelState, agentType: string | undefined): Release => {
    state.active++
    let released = false
    return () => {
      if (released) return
      released = true
      state.active--
      if (state.waiters.length === 0) return
      let idx = agentType === undefined ? -1 : state.waiters.findIndex((w) => w.agentType === agentType)
      if (idx < 0) idx = 0
      const [next] = state.waiters.splice(idx, 1)
      next.grant()
    }
  }

  return {
    acquire(model, agentType) {
      const state = stateFor(model)
      if (state.active < state.limit) return Promise.resolve(take(state, agentType))
      return new Promise<Release>((resolve) => {
        state.waiters.push({ agentType, grant: () => resolve(take(state, agentType)) })
      })
    },
  }
}
