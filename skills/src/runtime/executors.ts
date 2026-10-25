// Which StageExecutor a runtime kind gets. The runner's main() asks here
// instead of composing a test double itself (ARCH-003). Only the fake ships
// (SPEC Q5) plus the pi executor (LLM-363).

import type { StageExecutor } from './executor'
import type { RuntimeConfig } from '../shared/models'
import { FakeExecutor } from './fake-executor'
import { PiExecutor } from './pi-executor'

export interface ExecutorContext {
  repoRoot: string
  runId: string
}

export function selectExecutor(runtime: RuntimeConfig, ctx: ExecutorContext): StageExecutor {
  if (runtime.kind === 'fake') return new FakeExecutor([], { text: '{}' })
  if (runtime.kind === 'pi') return new PiExecutor(runtime, ctx)
  throw new Error(`runtime_kind_unsupported: ${runtime.kind}`)
}
