# The Record Suite — Expanded Agent Preamble

> Local-first macOS meeting recorder — Swift 6.2 strict concurrency, 4-layer Clean Architecture, TDD mandatory

---

## 1. Architecture: 4-Layer Clean Architecture


Domain          — pure value types, protocols, errors. Foundation only. 100 lines max.
Business        — pure transformations. Domain + Foundation + OSLog. 300 lines max.
Infrastructure  — actors, side effects, frameworks. Domain + any framework. 300 lines max.
Presentation    — SwiftUI views + @Observable ViewModels. Domain + Business + SwiftUI.
                  ViewModels 200 lines, Views 150 lines.


### Hard import rules
- Presentation NEVER imports Infrastructure
- Business NEVER imports Infrastructure
- Domain NEVER imports except Foundation
- Protocol seams between every layer — consumer defines the protocol, Infrastructure conforms

### Functional Core / Imperative Shell
- Business layer: pure functions (data in → data out). Zero side effects.
- Infrastructure layer: all actors, all I/O, all side effects.
- All shared mutable state in `actor` types.
- `@MainActor` on all Presentation types.

---

## 2. Swift 6.2 Strict Concurrency

- `StrictConcurrency` enabled via `.enableExperimentalFeature` and `-strict-concurrency=complete` in Package.swift.
- `@unchecked Sendable` is ONLY allowed in `Infrastructure/Audio/` and `Domain/Audio/AudioBuffer.swift`. Nowhere else.
- Never use `nonisolated(unsafe) static let` for `DateFormatter` or `ISO8601DateFormatter` — use stateless `FormatStyle` instead:


// WRONG
nonisolated(unsafe) static let iso8601 = ISO8601DateFormatter()

// CORRECT
let formatted = date.formatted(.iso8601)


---

## 3. Error Handling

- Typed error enums per domain: `AudioError`, `TranscriptionError`, etc.
- Never `raw Error` or `NSError` at domain boundaries.
- All Infrastructure errors translated to domain errors at the boundary.
- Never silently swallow errors with `try?` (except documented exceptions).
- After fixing any `try?` that swallows errors, grep the whole file and fix all siblings in the same commit.
- Never `try?` on `Task.sleep` inside Task loop bodies — let `CancellationError` propagate:


// WRONG
await try? Task.sleep(for: .seconds(1))

// CORRECT
try await Task.sleep(for: .seconds(1))



// Typed error enum pattern
enum TranscriptionError: Error {
    case modelNotLoaded
    case audioBufferInvalid
    case processingFailed(underlying: Error)
}


---

## 4. Logging

- Use `OSLog` (os.log) everywhere.
- Every string interpolation MUST have an explicit privacy label:


// WRONG
logger.debug("Processing segment \(segment)")

// CORRECT
logger.debug("Processing segment \(segment, privacy: .private)")
logger.info("Session count: \(count, privacy: .public)")


- NEVER log user content at `.public` level.

---

## 5. TDD — Mandatory Red-Green

1. Write the failing test (RED) — run it, confirm it fails for the right reason.
2. Implement just enough to pass (GREEN).
3. Commit both together.

Post-hoc testing is forbidden. No hardcoded return values to pass tests.

### Negative paths required
Always test: invalid inputs, retry exhaustion, timeouts, state violations.


@Test("throws processingFailed when model is not loaded")
func throwsWhenModelNotLoaded() async throws {
    let sut = Transcriber(model: MockModel(loaded: false))
    await #expect(throws: TranscriptionError.modelNotLoaded) {
        try await sut.transcribe(audio: .empty)
    }
}


---

## 6. Test Conventions

### Suite and test naming

import Testing
import Foundation
@testable import Business
import Domain
import TestMocks

@Suite("PipelineCoordinator")
struct PipelineCoordinatorTests {

    @Test("archives session when memory gate passes")
    func archivesSessionWhenMemoryGatePasses() async throws {
        // arrange
        let store = MockSessionStore()
        let sut = PipelineCoordinator(store: store)
        // act
        try await sut.run(session: .fixture())
        // assert
        #expect(store.archivedSessions.count == 1)
    }
}


### Mock types
- Live in `TestMocks` shared library: `MockSpeakerProfileStore`, `MockVoiceEmbeddingEngine`, etc.
- Inline helper funcs at top of test file for data fabrication (not in TestMocks unless reused widely).

### Assertions
- `#expect(value == expected)` for fallible checks.
- `#require(try expr)` to unwrap non-optional or throw on failure.
- Never `XCTAssert*` — this project uses Swift Testing, not XCTest.

### Test runner gotcha
- `swift test --filter` from repo root only reaches Record-App-hosted targets.
- For Record-Audio or Record-ML tests: `cd Record-Audio && swift test` (or `cd Record-ML && swift test`).

### Test locations

Record-App/Tests/Unit/Domain/
Record-App/Tests/Unit/Business/
Record-App/Tests/Unit/Infrastructure/
Record-App/Tests/Unit/Presentation/
Record-App/Tests/Integration/
Record-App/Tests/E2E/
Record-Audio/Tests/Unit/
Record-ML/Tests/Unit/


---

## 7. No Embedded Languages

Never embed non-Swift content as inline string literals in Swift source.

| Content | Extract to |
|---------|------------|
| SQL | `*SQL.swift` — caseless enum with static funcs |
| LLM prompts | `*Prompts.swift` |
| JSON schemas | `*Prompts.swift` or `*Schema.swift` |
| JSON-RPC wire | `*Protocol.swift` |
| Shell commands | `*Commands.swift` |
| HTML templates | `*Templates.swift` |
| Regex patterns | `*Patterns.swift` |


// WRONG
let sql = "SELECT * FROM recordings WHERE id = ?\n  ORDER BY created_at DESC"

// CORRECT — in DuckDBSQL.swift
enum DuckDBSQL {
    static func selectRecording(id: String) -> String {
        "SELECT * FROM recordings WHERE id = '\(id)' ORDER BY created_at DESC"
    }
}
// Consumer:
DuckDBSQL.selectRecording(id: id)


Exception: trivial single-value strings under 80 chars that are non-reusable may stay inline. Test fixtures may use inline examples.

---

## 8. Infrastructure / Data Rules

- DuckDB writes: always `INSERT OR IGNORE` (idempotent).
- Buffers cleared ONLY on confirmed success — never on attempt.
- Every external call needs an explicit timeout and capped-backoff retry.
- All mutations must be idempotent.
- No network egress — local-first only.

---

## 9. Sentinel Values and Canonical Constants

- SpeakerID sentinel strings: must be `public static let` constants on `SpeakerID.swift`, never constructed inline.
- Never hardcode canonical values — reference `UITheme.default`, `PrivacyMode.default`, etc.
- C library init: always guard the returned optional and log on nil; never silently proceed with nil state.

---

## 10. SwiftLint Rules (active)

Disabled: `trailing_whitespace`, `line_length`, `identifier_name`

Enabled / enforced:
- `force_unwrapping`, `force_cast`, `force_try` — all errors
- `implicitly_unwrapped_optional` — error
- `unowned_variable_capture` — error
- `strict_fileprivate` — error
- `empty_count` — use `.isEmpty` not `== 0`
- `explicit_self` — analyzer rule, always use `self.` inside closures
- `function_body_length`: warning at 100 lines, error at 150
- Custom `no_setenv`: `setenv()` is banned — inject configuration instead

---

## 11. File and Commit Conventions

- PascalCase for types and files; camelCase for properties/methods.
- Test files: `TypeNameTests.swift`.
- File size: 500 lines absolute ceiling. Layer limits are stricter (see Architecture section).
- Git commit format: `Epic {N}: [{Layer}] {Description}` — no AI attribution.
- Squash before first push to remote; additive commits only after PR opens.
- Never force-push `main` or `master`.

---

## 12. Out-of-Scope Problems

- Open a GitHub issue for any bug or smell >= severity 4 discovered but not being fixed.
- Label format: `[see-something] category: description (file:line)`.
- Do not block current work — log and keep moving.
- Keep at least one task active in TaskList during a coding session.

---

## 13. Anti-Patterns Quick Reference

| Anti-pattern | Correct pattern |
|---|---|
| `nonisolated(unsafe) static let formatter` | `date.formatted(.iso8601)` |
| `@unchecked Sendable` on Business/Domain type | Use proper actor isolation |
| `try?` on `Task.sleep` | `try await Task.sleep(...)` |
| Inline SQL/prompt string | Extract to `*SQL.swift` / `*Prompts.swift` |
| `import Infrastructure` in Business | Protocol seam — Business defines protocol, Infra conforms |
| `XCTAssertEqual` | `#expect(a == b)` (Swift Testing) |
| `setenv()` | Inject via constructor/config |
| Hardcoded sentinel string inline | `public static let` on `SpeakerID.swift` |
| `NSError` at domain boundary | Typed domain error enum |
| Silent `try?` swallowing errors | Propagate or convert to typed error |
