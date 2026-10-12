// Deterministic in-memory StageExecutor for tests: scripted replies chosen by
// label prefix, a request log with timestamps, and hold/release gating so a
// test can observe which requests are in flight at the same time.

import type { StageExecutor, StageOpts, StageReply, StageRequest } from './executor'

export interface ScriptEntry {
  labelPrefix: string
  reply: StageReply | ((req: StageRequest) => StageReply)
}

export interface RecordedRequest {
  prompt: string
  model: string
  opts: StageOpts
  startedAt: number
  /** null while the request is still pending (for example held). */
  endedAt: number | null
}

interface Gate {
  promise: Promise<void>
  open: () => void
}

export class FakeExecutor implements StageExecutor {
  readonly requests: RecordedRequest[] = []
  private readonly holds = new Map<string, Gate>()

  constructor(
    private readonly script: readonly ScriptEntry[],
    private readonly defaultReply: StageReply,
  ) {}

  hold(labelPrefix: string): void {
    if (this.holds.has(labelPrefix)) return
    let open!: () => void
    const promise = new Promise<void>((resolve) => {
      open = resolve
    })
    this.holds.set(labelPrefix, { promise, open })
  }

  release(labelPrefix: string): void {
    const gate = this.holds.get(labelPrefix)
    if (!gate) return
    this.holds.delete(labelPrefix)
    gate.open()
  }

  async execute(req: StageRequest): Promise<StageReply> {
    const record: RecordedRequest = {
      prompt: req.prompt,
      model: req.model,
      opts: req.opts,
      startedAt: performance.now(),
      endedAt: null,
    }
    this.requests.push(record)
    try {
      const label = req.opts.label
      if (label !== undefined) {
        const gates = [...this.holds].filter(([prefix]) => label.startsWith(prefix)).map(([, g]) => g.promise)
        await Promise.all(gates)
      }
      const entry = label === undefined ? undefined : this.script.find((e) => label.startsWith(e.labelPrefix))
      if (!entry) return this.defaultReply
      return typeof entry.reply === 'function' ? entry.reply(req) : entry.reply
    } finally {
      record.endedAt = performance.now()
    }
  }
}
