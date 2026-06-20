---
name: swift-clean-architecture
description: Use this skill when generating Swift code or modifying the architecture of an iOS or macOS application. It enforces the 4-layer clean architecture rules, strict dependency graphs, and macOS 26+ specific requirements like @Observable.
---

# Swift 4-Layer Clean Architecture Rules

You must strictly adhere to the following 4-layer architecture when building Swift applications.

## 1. The Layers & Dependency Rules (STRICT)

```
Domain (structs, protocols) ← Business (actors) ← Infrastructure (actors)
                            ← Presentation (@MainActor classes)
```

| Layer | Allowed Imports | File Limit |
|-------|----------------|------------|
| **Domain** | `Foundation` only | 100 lines |
| **Business** | Domain + Foundation + OSLog | 300 lines |
| **Infrastructure**| Domain + any 3rd-party framework (DuckDB, CoreAudio, etc.) | 300 lines |
| **Presentation** | Domain + Business + SwiftUI | ViewModels: 200, Views: 150 |

*CRITICAL:* Presentation NEVER imports Infrastructure directly. Business NEVER imports Infrastructure. Domain NEVER imports anything except Foundation.

## 2. macOS 26+ Concurrency & State

*   **Actors everywhere:** Use Actors for all shared mutable state to comply with Swift 6.2 strict concurrency.
*   **Presentation Layer:** All ViewModels and Views must be decorated with `@MainActor`.
*   **Observation:** You MUST use `@Observable` for ViewModels. NEVER use `ObservableObject` or `@Published` (we target macOS 26+).
*   **Protocol Seams:** Infrastructure implements Domain protocols. The Presentation layer only speaks to Infrastructure via these Domain protocols injected into the Business layer.
*   **No `@unchecked Sendable`** unless explicitly manipulating low-level C-pointers (like AudioBuffers).

## 3. TDD Order (MANDATORY)

1. Write test
2. Verify it FAILS (RED)
3. Implement
4. Verify it PASSES (GREEN)
5. Commit together

Never write implementation before the test. Tests must use the new Swift Testing framework (`@Suite`, `@Test`, `#expect`), NOT XCTest.
