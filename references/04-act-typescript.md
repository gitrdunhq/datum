# ACT Phase — TypeScript Overrides

Apply when language is `typescript` or `javascript`. Supplements `references/04-act.md`.

## Test Framework

**Default:** Vitest (`it`, `test`, `expect`, `describe`).
**Fallback:** Jest if the repo's `package.json` specifies jest only.

Auto-detect: check `vitest.config.*` → Vitest. Check `jest.config.*` or `"jest"` in package.json → Jest.

## RED agent — TypeScript specifics

Stub commit format:
```typescript
// Stub: introduced by task-001 for downstream RED agents
export interface RecordingSession {
  startRecording(): Promise<RecordingHandle>;
}

export class RecordingSessionImpl implements RecordingSession {
  async startRecording(): Promise<RecordingHandle> {
    throw new Error("not implemented");
  }
}
```

Test file (Vitest):
```typescript
import { describe, it, expect } from "vitest";
import { RecordingSessionImpl } from "../RecordingSession";

// Property: SAFE-001 — no session without permission
describe("RecordingSession SAFE-001", () => {
  it("throws PermissionDenied when camera permission is denied", async () => {
    const session = new RecordingSessionImpl({ permissionGranted: false });
    await expect(session.startRecording()).rejects.toThrow("PermissionDenied");
  });
});
```

Property ID: embed in describe label or use a `@property` JSDoc tag.

## GREEN agent — TypeScript specifics

Implementation target: `src/` (never touch `*.test.ts`, `*.spec.ts`, `__tests__/`).

The redacted signal gives the error message and expected/received values — implement only what's needed:
```typescript
async startRecording(): Promise<RecordingHandle> {
  if (!this.config.permissionGranted) {
    throw new Error("PermissionDenied");
  }
  return this.createHandle();
}
```

Prefer `async/await`. Use TypeScript strict mode. No `any` types in new code.

## REFACTOR agent — TypeScript specifics

- Replace `any` with proper types
- Add structured logging (use `pino` or the project's existing logger — check `package.json`)
- Honor layer boundaries: domain in `src/domain/`, adapters in `src/infrastructure/`
- Error types should be typed, not raw `Error` with string matching

## Commit message convention

```
red(task-001): failing test for SAFE-001 – permission guard
green(task-001): minimum implementation for SAFE-001
refactor(task-001): full AC coverage – RecordingSession
```

## test_signal.py framework: `vitest`

Pass `--framework vitest` when invoking test_signal.py.
The vitest reporter must output JSON: `vitest run --reporter=json`.
