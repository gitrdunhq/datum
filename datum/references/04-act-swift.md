# ACT Phase — Swift Overrides

Apply these rules when the detected language is `swift`. They supplement `references/04-act.md`, they don't replace it.

## Test Framework

**Default:** Swift Testing (`@Test`, `#expect`, `#require`).
**Fallback:** XCTest (`func test...()`, `XCTAssert*`) if the repo uses XCTest only.

Auto-detect: if `import Testing` appears in existing test files → Swift Testing. If `import XCTest` only → XCTest. If mixed → prefer Swift Testing for new tests.

## RED agent — Swift specifics

Stub commit format:
```swift
// Stub: introduced by task-001 for downstream RED agents
public struct RecordingSession {
    public func startRecording() async throws -> RecordingHandle {
        fatalError("not implemented")
    }
}
```

Test file structure (Swift Testing):
```swift
import Testing
@testable import YourModule

@Suite("RecordingSession")
struct RecordingSessionTests {
    @Test(.tags(.safe001))
    func noSessionWithoutPermission() async throws {
        // Arrange: permission denied
        // Act: call startRecording()
        // Assert: throws PermissionDenied — proving SAFE-001
        await #expect(throws: RecordingError.permissionDenied) {
            try await session.startRecording()
        }
    }
}
```

Property ID in test: use `.tags(.<propertyId>)` or embed in the test function name: `func test_SAFE001_...()`.

## GREEN agent — Swift specifics

Implementation target: `Sources/` (never touch `Tests/`).

Minimum code: implement only what the compile error and assertion signal demand.
```swift
public func startRecording() async throws -> RecordingHandle {
    guard await permissionManager.hasCameraPermission() else {
        throw RecordingError.permissionDenied
    }
    // ... minimum to make test pass
}
```

Prefer `async/await` over completion handlers in new code. Use Swift 6 concurrency where supported (check `Package.swift` for language version).

## REFACTOR agent — Swift specifics

- Apply structured concurrency: `actor` for shared mutable state, `@Sendable` for closures crossing isolation boundaries
- Use `os.log` / `Logger` (not `print`) for observability properties
- Honor layer boundaries: domain types in `Sources/Domain/`, adapters in `Sources/Infrastructure/`
- `fatalError` in stub bodies must be replaced; `preconditionFailure` for programmer errors in final code

## Commit message convention

```
red(task-001): failing test for SAFE-001 – RecordingSession permission guard

green(task-001): minimum implementation for SAFE-001

refactor(task-001): full AC coverage – RecordingSession.startRecording()
```

## File layout expectations

```
Sources/
  <ModuleName>/
    Domain/        — pure logic, no UIKit/AppKit/SwiftUI
    Infrastructure/ — adapters (network, persistence, system APIs)
    Presentation/   — SwiftUI views, view models
Tests/
  Unit/
    Domain/
    Infrastructure/
  Integration/
```

## test_signal.py framework: `xctest`

Both XCTest and Swift Testing output is parsed by the `xctest` parser in `test_signal.py`.
Pass `--framework xctest` when invoking test_signal.py in this repo.
