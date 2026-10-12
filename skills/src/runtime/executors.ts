// Which StageExecutor a runtime kind gets. The runner's main() asks here
// instead of composing a test double itself (ARCH-003). Only the fake ships
// (SPEC Q5); 'pi' is declared but has no executor yet.

import type { StageExecutor } from './executor'
import type { RuntimeConfig } from '../shared/models'
import { FakeExecutor } from './fake-executor'

export function selectExecutor(runtime: RuntimeConfig): StageExecutor {
  if (runtime.kind === 'fake') return new FakeExecutor([], { text: '{}' })
  throw new Error(`runtime_kind_unsupported: ${runtime.kind}`)
}
