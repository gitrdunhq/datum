# The Record Suite

> Local-first macOS meeting recorder — Swift 6.2 strict concurrency, 4-layer Clean Architecture, TDD mandatory

## Architecture
- Layer order (import direction only): Domain → Business → Infrastructure → Presentation
- Domain: Foundation only, 100 lines max
- Business: Domain + Foundation + OSLog, 300 lines max — pure transformations, no side effects
- Infrastructure: Domain + any framework, 300 lines max — all side effects live here
- Presentation: Domain + Business + SwiftUI, ViewModels 200 lines, Views 150 lines
- Presentation NEVER imports Infrastructure; Business NEVER imports Infrastructure
- All shared mutable state in actors; @MainActor on all Presentation types
- Protocol seams between every layer

## Coding Rules
- No invented APIs: confirm every symbol exists before calling it
- Minimal diffs: only change what the current task requires
- No @unchecked Sendable except Infrastructure/Audio/ and Domain/Audio/AudioBuffer.swift
- No nonisolated(unsafe) static let for DateFormatter — use stateless FormatStyle
- No inline non-Swift content: extract SQL → *SQL.swift, prompts → *Prompts.swift, regex → *Patterns.swift, etc.
- Trivial single-value strings under 80 chars non-reusable may stay inline
- Never setenv() — inject configuration instead
- Never try? on Task.sleep in Task loop bodies — let CancellationError propagate
- After fixing any try? that swallows errors, grep the file and fix all siblings in same commit
- SpeakerID sentinel strings must be public static let on SpeakerID.swift, never inline
- C library init must guard the optional and log error; never silently proceed with nil
- Never hardcode canonical values — reference UITheme.default, PrivacyMode.default, etc.
- DuckDB writes use INSERT OR IGNORE; buffers cleared only on success
- No network egress — local-first only
- OSLog with explicit privacy labels on every interpolation; never log user content at .public
- Typed error enums per domain; never raw Error at domain boundaries; never swallowed silently
- State represented as enums; transitions guarded and explicit
- Every external call needs explicit timeout + capped-backoff retry
- All mutations idempotent
- Open a GitHub issue for any out-of-scope bug >= severity 4
- Keep at least one task active in TaskList during a coding session

## TDD Rules
- Write failing test first (RED), confirm failure, then implement (GREEN) — no post-hoc tests
- Tests must verify specific business outcomes; deleting the function body must break the test
- No hardcoded return values to pass tests
- Always test negative paths: invalid input, retry exhaustion, timeouts, state violations

## Test Conventions
- Framework: Swift Testing (import Testing)
- Suite naming: @Suite("TypeName") struct TypeNameTests
- Test naming: @Test("verb scenario in plain English") func verbScenario()
- Assertions: #expect(value == expected); #require for non-optional unwrapping
- Mock types live in TestMocks shared library (MockSpeakerProfileStore, MockVoiceEmbeddingEngine, etc.)
- Inline helper funcs at top of test file for data fabrication
- Test locations: Record-App/Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
- Sub-packages: cd into Record-Audio or Record-ML to run their tests (swift test --filter from root only reaches Record-App targets)

## File Conventions
- PascalCase types and files; camelCase properties/methods
- Test files: TypeNameTests.swift
- 500 lines absolute ceiling; layer-specific limits are stricter
- Git commit format: Epic {N}: [{Layer}] {Description} — no AI attribution
- Squash before first push; additive commits only after PR opens; never force-push main

## Full Context
- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and anti-patterns
