

# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.build/checkouts/FluidAudio/AGENTS.md
# =========================================

# FluidAudio - Agent Development Guide

## Build & Test Commands

```bash
swift build                                    # Build project
swift build -c release                        # Release build
swift test                                     # Run all tests
swift test --filter CITests                   # Run single test class
swift test --filter CITests.testPackageImports # Run single test method
swift format --in-place --recursive --configuration .swift-format Sources/ Tests/
```

## Architecture

- **FluidAudio/**: Main library (ASR/, Diarizer/, VAD/, Shared/ modules)
- **FluidAudioCLI/**: CLI tool with benchmarking and processing commands
- **Tests/FluidAudioTests/**: Comprehensive test suite
- **Models**: Auto-downloaded from HuggingFace with CoreML compilation
- **Processing Pipeline**: Audio → VAD → Diarization → ASR → Timestamped transcripts

## Critical Rules

- **NEVER** use `@unchecked Sendable` - implement proper thread safety with actors/MainActor
- **NEVER** create dummy/mock models or synthetic audio data - use real models only
- **NEVER** create simplified versions - implement full solutions or consult first
- **NEVER** run `git push` unless explicitly requested by user
- Add unit tests when writing new code

## Code Style (swift-format config)

- Line length: 120 chars, 4-space indentation
- Import order: Alphabetical preferred (`import CoreML`, `import Foundation`, `import OSLog`), but OrderedImports rule is disabled due to Swift 6.1 (GitHub Actions CI) vs 6.3 (local) formatter incompatibility
- Naming: lowerCamelCase for variables/functions, UpperCamelCase for types
- Error handling: Use proper Swift error handling, no force unwrapping in production
- Documentation: Triple-slash comments (`///`) for public APIs
- Thread safety: Use actors, `@MainActor`, or proper locking - never `@unchecked Sendable`
- Control flow: Prefer flattened if statements with early returns/continues over nested if statements. Use guard statements and inverted conditions to exit early. Nested if statements should be absolutely avoided.

## Clean code

- When adding new interfaces, make sure that the API is consistent with the other model managers
- Files should be isolated and the code should contain a single responsibility for each

## Mobius Plan

When users ask you to perform tasks that might be more compilcated, make sure you look at PLANS.md and follow the instructions there to plan the change out first and follow the instructions there. The plans should be in a .mobius/ folder and never committed directly to Github


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.build/checkouts/FluidAudio/CLAUDE.md
# =========================================

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FluidAudio is a Swift framework for local, low-latency audio processing on Apple platforms. It provides speaker diarization, automatic speech recognition (ASR), and voice activity detection (VAD) through open-source models converted to Core ML.

## Critical Development Rules

### NEVER USE `@unchecked Sendable`

- Always implement thread-safe code with proper synchronization
- Use actors, `@MainActor`, or proper locking mechanisms instead
- If you encounter Sendable conformance issues, fix them properly

### NEVER CREATE DUMMY MODELS OR SYNTHETIC DATA

- Do not create dummy, mock, or fake models for testing or development
- Do not generate synthetic audio data for testing
- Always use the actual models required by the code
- If model authentication is required, inform the user rather than creating dummy versions

### NEVER UPLOAD TO HUGGINGFACE

- Do not upload models, datasets, or any files to HuggingFace
- Do not create HuggingFace repos
- Prepare files locally and let the user handle all HF uploads themselves

### MODEL OPERATIONS - CONSULT BEFORE IMPLEMENTING

- When asked to merge, convert, or modify models:
  - If it seems impossible or there are significant objections, consult the user first
  - If they say proceed, do it immediately without further objections
- Do not create placeholder models or implement alternatives without asking

## User Preferences

- Never start responses with positive re-affirming text ("You're absolutely right!", "Good change!", etc.)
- Get straight to the point with technical facts
- For debugging, use print statements and delete them at the end when instructed
- Never create fallbacks or simplified solutions that don't actually solve the problem
- When asked to implement something specific, do it first before explaining why it might not be optimal
- Don't over-do things that aren't asked

## Development Guidelines

1. **Follow Instructions**: Implementation first, explanation second
2. **Testing Policy**: Add unit tests when writing new code.
3. **Git Operations**: Never run `git push` unless explicitly requested.
   - **No Co-Author Tags**: Do not add `Co-Authored-By` lines for Claude, Copilot, or any AI assistant in commit messages.
   - **No GitHub comments**: Never post comments, reviews, or reactions on issues or PRs via `gh`. Reading issues, PRs, and comments is fine. Creating PRs and editing PR titles/bodies is fine.
4. **Multi-Agent Workflow**: This repo is worked on by multiple coding agents
   in parallel. Switching branches in a shared working tree drags unrelated
   WIP changes (and their build artifacts) into your compile and surfaces
   "file was modified during the build" errors. Use `git worktree` instead
   — shared `.git`, isolated working tree + `.build/`, no collisions.

   ```bash
   # From the primary checkout, create an isolated tree for your branch
   git worktree add ../FluidAudio-<task> -b <branch> origin/main
   cd ../FluidAudio-<task>
   # Independent working tree, independent .build/, shared .git
   ```

   One worktree per active task. Remove with `git worktree remove <path>` when
   done. List active worktrees with `git worktree list`.
5. **Code Formatting**: All code must pass swift-format checks before merge
6. **Avoid Deprecated Code**: Do not add support for deprecated models or features unless explicitly requested
7. **Performance**: Keep RTFx > 1.0x for real-time capability

## Code Style

- **Swift Format**: Enforced via `.swift-format` config, CI checked
- **Local formatting**: `swift format --in-place --recursive --configuration .swift-format Sources/ Tests/`
- **Line length**: 120 characters
- **Indentation**: 4 spaces
- **Import order**: Alphabetical preferred, but OrderedImports rule is disabled due to Swift 6.1 (GitHub Actions CI) vs 6.3 (local) formatter incompatibility. Swift 6.3 is unavailable in GitHub Actions runners.
- **Naming**: lowerCamelCase for variables/functions, UpperCamelCase for types
- **Error handling**: Proper Swift error handling, no force unwrapping in production. Per-module error enums conforming to `Error, LocalizedError` (e.g. `ASRError`, `VadError`, `OfflineDiarizationError`, `Qwen3AsrError`)
- **Logging**: Use `AppLogger(category:)` from `Shared/AppLogger.swift` — not `print()` in production code. One logger per component (e.g. `AppLogger(category: "VadManager")`)
- **Documentation**: Triple-slash comments (`///`) for public APIs
- **Control flow**: Prefer guard statements and early returns over nested if statements

## Build Commands

```bash
# Build
swift build                             # Debug build
swift build -c release                 # Release build (recommended for benchmarks)

# Test
swift test                             # Run all tests
swift test --filter CITests           # Run CI-specific tests only
swift test --filter AsrManagerTests   # Run specific test class

# Format
swift format --in-place --recursive --configuration .swift-format Sources/ Tests/
swift format lint --recursive --configuration .swift-format Sources/ Tests/

# Package management
swift package update
swift package resolve
swift package clean
```

### CLI Commands

```bash
# Transcription
swift run fluidaudiocli transcribe audio.wav
swift run fluidaudiocli transcribe audio.wav --low-latency
swift run fluidaudiocli qwen3-transcribe audio.wav
swift run fluidaudiocli multi-stream audio1.wav audio2.wav

# TTS
swift run fluidaudiocli tts "Hello world" --output hello.wav

# Diarization
swift run fluidaudiocli process meeting.wav --output results.json --threshold 0.6
swift run fluidaudiocli sortformer audio.wav
swift run fluidaudiocli parakeet-eou --input audio.wav

# Benchmarks
swift run fluidaudiocli asr-benchmark --subset test-clean --max-files 100
swift run fluidaudiocli diarization-benchmark --auto-download
swift run fluidaudiocli vad-benchmark --num-files 40 --threshold 0.5
swift run fluidaudiocli fleurs-benchmark --languages en_us,fr_fr --samples 10
swift run fluidaudiocli sortformer-benchmark
swift run fluidaudiocli qwen3-benchmark
swift run fluidaudiocli ctc-earnings-benchmark
swift run fluidaudiocli g2p-benchmark

# Dataset downloads
swift run fluidaudiocli download --dataset ami-sdm
swift run fluidaudiocli download --dataset librispeech-test-clean
```

## Project Structure

```
FluidAudio/
├── Sources/
│   ├── FluidAudio/           # Main library (single product)
│   │   ├── ASR/             # Automatic Speech Recognition
│   │   │   ├── Parakeet/    # Parakeet TDT (Decoder/, SlidingWindow/, Streaming/)
│   │   │   └── Qwen3/       # Qwen3 ASR
│   │   ├── Diarizer/        # Speaker diarization (segmentation, embedding, clustering)
│   │   ├── TTS/             # Text-to-speech (KokoroAne, PocketTTS, StyleTTS2, Magpie)
│   │   ├── VAD/             # Voice Activity Detection (Silero VAD)
│   │   └── Shared/          # Common utilities (audio conversion, model downloading)
│   └── FluidAudioCLI/       # Command-line interface (macOS only)
├── Tests/                   # Test suite
├── Scripts/                 # Python utilities (benchmarks, evaluation tools)
├── mobius/                  # Research submodule: model conversions, trials, and known issues
├── Documentation/           # Reference documentation
├── Frameworks/              # Vendored frameworks
└── ThirdPartyLicenses/      # Third-party license files
```

## Architecture Overview

### Core Components
- **AsrManager** (`ASR/Parakeet/`): Speech-to-text via TDT (Token Duration Transducer) decoding. Stateless per-chunk processing with automatic decoder state reset.
- **SlidingWindowAsrManager** (`ASR/Parakeet/SlidingWindow/`): Real-time ASR with sliding window processing and cancellation support.
- **StreamingAsrManager** (`ASR/Parakeet/Streaming/`): Protocol for true streaming ASR engines (EOU, Nemotron) with cache-aware encoders.
- **Qwen3AsrManager** (`ASR/Qwen3/`): Qwen3-based ASR with Whisper mel spectrogram frontend.
- **OfflineDiarizerManager** (`Diarizer/`): Speaker separation via segmentation, embedding extraction, and VBx clustering. 17.7% DER on AMI dataset.
- **VadManager** (`VAD/`): Voice activity detection with CoreML models.
- **KokoroAneManager** (`TTS/KokoroAne/`): ANE-resident Kokoro 82M (7-stage CoreML chain) — English + Mandarin.
- **PocketTtsSynthesizer** (`TTS/PocketTTS/`): PocketTTS streaming text-to-speech synthesis.
- **StyleTTS2Manager** (`TTS/StyleTTS2/`): StyleTTS2 LibriTTS zero-shot voice cloning.
- **MagpieManager** (`TTS/Magpie/`): Magpie multilingual TTS (experimental, RTFx < 1.0).

### Key Patterns
- **Actor-based concurrency**: Thread-safe processing, no `@unchecked Sendable`
- **Stateless ASR**: Each chunk transcribed independently (~14.96s chunks, 2.0s overlap)
- **Auto-recovery**: Corrupt CoreML model detection and re-download from HuggingFace
- **Model management**: Models auto-download from HuggingFace on first use. Can be pre-fetched via `swift run fluidaudiocli download`.
- **Cross-platform**: macOS 14.0+, iOS 17.0+ (library), CLI macOS-only

## Platform Requirements

- **Swift**: 5.10+ (Swift 6+ for swift-format)
- **C++17**: Required for `FastClusterWrapper` (set via `cxxLanguageStandard: .cxx17` in Package.swift)
- **Platforms**: macOS 14.0+, iOS 17.0+
- **Hardware**: Apple Silicon recommended

## CI/CD

GitHub Actions workflows:
- **swift-format.yml**: Code formatting compliance
- **tests.yml**: Build and test execution
- **asr-benchmark.yml**: ASR performance validation
- **diarizer-benchmark.yml**: Diarization benchmarks
- **vad-benchmark.yml**: VAD validation

## Model Sources

- **Diarization**:
  - Online/Streaming (DiarizerManager): [FluidInference/speaker-diarization-coreml](https://huggingface.co/FluidInference/speaker-diarization-coreml) (based on pyannote/speaker-diarization-3.1)
  - Offline Batch (OfflineDiarizerManager): [FluidInference/speaker-diarization-coreml](https://huggingface.co/FluidInference/speaker-diarization-coreml) (based on pyannote/speaker-diarization-community-1)
- **VAD CoreML**: [FluidInference/silero-vad-coreml](https://huggingface.co/FluidInference/silero-vad-coreml)
- **ASR Models**: [FluidInference/parakeet-tdt-0.6b-v3-coreml](https://huggingface.co/FluidInference/parakeet-tdt-0.6b-v3-coreml)
- **Test Data**: [alexwengg/musan_mini*](https://huggingface.co/datasets/alexwengg) variants


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a9e6ab67a6b733814/.build/checkouts/FluidAudio/CLAUDE.md
# =========================================

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FluidAudio is a Swift framework for local, low-latency audio processing on Apple platforms. It provides speaker diarization, automatic speech recognition (ASR), and voice activity detection (VAD) through open-source models converted to Core ML.

## Critical Development Rules

### NEVER USE `@unchecked Sendable`

- Always implement thread-safe code with proper synchronization
- Use actors, `@MainActor`, or proper locking mechanisms instead
- If you encounter Sendable conformance issues, fix them properly

### NEVER CREATE DUMMY MODELS OR SYNTHETIC DATA

- Do not create dummy, mock, or fake models for testing or development
- Do not generate synthetic audio data for testing
- Always use the actual models required by the code
- If model authentication is required, inform the user rather than creating dummy versions

### NEVER UPLOAD TO HUGGINGFACE

- Do not upload models, datasets, or any files to HuggingFace
- Do not create HuggingFace repos
- Prepare files locally and let the user handle all HF uploads themselves

### MODEL OPERATIONS - CONSULT BEFORE IMPLEMENTING

- When asked to merge, convert, or modify models:
  - If it seems impossible or there are significant objections, consult the user first
  - If they say proceed, do it immediately without further objections
- Do not create placeholder models or implement alternatives without asking

## User Preferences

- Never start responses with positive re-affirming text ("You're absolutely right!", "Good change!", etc.)
- Get straight to the point with technical facts
- For debugging, use print statements and delete them at the end when instructed
- Never create fallbacks or simplified solutions that don't actually solve the problem
- When asked to implement something specific, do it first before explaining why it might not be optimal
- Don't over-do things that aren't asked

## Development Guidelines

1. **Follow Instructions**: Implementation first, explanation second
2. **Testing Policy**: Add unit tests when writing new code.
3. **Git Operations**: Never run `git push` unless explicitly requested.
   - **No Co-Author Tags**: Do not add `Co-Authored-By` lines for Claude, Copilot, or any AI assistant in commit messages.
   - **No GitHub comments**: Never post comments, reviews, or reactions on issues or PRs via `gh`. Reading issues, PRs, and comments is fine. Creating PRs and editing PR titles/bodies is fine.
4. **Multi-Agent Workflow**: This repo is worked on by multiple coding agents
   in parallel. Switching branches in a shared working tree drags unrelated
   WIP changes (and their build artifacts) into your compile and surfaces
   "file was modified during the build" errors. Use `git worktree` instead
   — shared `.git`, isolated working tree + `.build/`, no collisions.

   ```bash
   # From the primary checkout, create an isolated tree for your branch
   git worktree add ../FluidAudio-<task> -b <branch> origin/main
   cd ../FluidAudio-<task>
   # Independent working tree, independent .build/, shared .git
   ```

   One worktree per active task. Remove with `git worktree remove <path>` when
   done. List active worktrees with `git worktree list`.
5. **Code Formatting**: All code must pass swift-format checks before merge
6. **Avoid Deprecated Code**: Do not add support for deprecated models or features unless explicitly requested
7. **Performance**: Keep RTFx > 1.0x for real-time capability

## Code Style

- **Swift Format**: Enforced via `.swift-format` config, CI checked
- **Local formatting**: `swift format --in-place --recursive --configuration .swift-format Sources/ Tests/`
- **Line length**: 120 characters
- **Indentation**: 4 spaces
- **Import order**: Alphabetical preferred, but OrderedImports rule is disabled due to Swift 6.1 (GitHub Actions CI) vs 6.3 (local) formatter incompatibility. Swift 6.3 is unavailable in GitHub Actions runners.
- **Naming**: lowerCamelCase for variables/functions, UpperCamelCase for types
- **Error handling**: Proper Swift error handling, no force unwrapping in production. Per-module error enums conforming to `Error, LocalizedError` (e.g. `ASRError`, `VadError`, `OfflineDiarizationError`, `Qwen3AsrError`)
- **Logging**: Use `AppLogger(category:)` from `Shared/AppLogger.swift` — not `print()` in production code. One logger per component (e.g. `AppLogger(category: "VadManager")`)
- **Documentation**: Triple-slash comments (`///`) for public APIs
- **Control flow**: Prefer guard statements and early returns over nested if statements

## Build Commands

```bash
# Build
swift build                             # Debug build
swift build -c release                 # Release build (recommended for benchmarks)

# Test
swift test                             # Run all tests
swift test --filter CITests           # Run CI-specific tests only
swift test --filter AsrManagerTests   # Run specific test class

# Format
swift format --in-place --recursive --configuration .swift-format Sources/ Tests/
swift format lint --recursive --configuration .swift-format Sources/ Tests/

# Package management
swift package update
swift package resolve
swift package clean
```

### CLI Commands

```bash
# Transcription
swift run fluidaudiocli transcribe audio.wav
swift run fluidaudiocli transcribe audio.wav --low-latency
swift run fluidaudiocli qwen3-transcribe audio.wav
swift run fluidaudiocli multi-stream audio1.wav audio2.wav

# TTS
swift run fluidaudiocli tts "Hello world" --output hello.wav

# Diarization
swift run fluidaudiocli process meeting.wav --output results.json --threshold 0.6
swift run fluidaudiocli sortformer audio.wav
swift run fluidaudiocli parakeet-eou --input audio.wav

# Benchmarks
swift run fluidaudiocli asr-benchmark --subset test-clean --max-files 100
swift run fluidaudiocli diarization-benchmark --auto-download
swift run fluidaudiocli vad-benchmark --num-files 40 --threshold 0.5
swift run fluidaudiocli fleurs-benchmark --languages en_us,fr_fr --samples 10
swift run fluidaudiocli sortformer-benchmark
swift run fluidaudiocli qwen3-benchmark
swift run fluidaudiocli ctc-earnings-benchmark
swift run fluidaudiocli g2p-benchmark

# Dataset downloads
swift run fluidaudiocli download --dataset ami-sdm
swift run fluidaudiocli download --dataset librispeech-test-clean
```

## Project Structure

```
FluidAudio/
├── Sources/
│   ├── FluidAudio/           # Main library (single product)
│   │   ├── ASR/             # Automatic Speech Recognition
│   │   │   ├── Parakeet/    # Parakeet TDT (Decoder/, SlidingWindow/, Streaming/)
│   │   │   └── Qwen3/       # Qwen3 ASR
│   │   ├── Diarizer/        # Speaker diarization (segmentation, embedding, clustering)
│   │   ├── TTS/             # Text-to-speech (Kokoro, PocketTTS)
│   │   ├── VAD/             # Voice Activity Detection (Silero VAD)
│   │   └── Shared/          # Common utilities (audio conversion, model downloading)
│   └── FluidAudioCLI/       # Command-line interface (macOS only)
├── Tests/                   # Test suite
├── Scripts/                 # Python utilities (benchmarks, evaluation tools)
├── mobius/                  # Research submodule: model conversions, trials, and known issues
├── Documentation/           # Reference documentation
├── Frameworks/              # Vendored frameworks
└── ThirdPartyLicenses/      # Third-party license files
```

## Architecture Overview

### Core Components
- **AsrManager** (`ASR/Parakeet/`): Speech-to-text via TDT (Token Duration Transducer) decoding. Stateless per-chunk processing with automatic decoder state reset.
- **SlidingWindowAsrManager** (`ASR/Parakeet/SlidingWindow/`): Real-time ASR with sliding window processing and cancellation support.
- **StreamingAsrManager** (`ASR/Parakeet/Streaming/`): Protocol for true streaming ASR engines (EOU, Nemotron) with cache-aware encoders.
- **Qwen3AsrManager** (`ASR/Qwen3/`): Qwen3-based ASR with Whisper mel spectrogram frontend.
- **OfflineDiarizerManager** (`Diarizer/`): Speaker separation via segmentation, embedding extraction, and VBx clustering. 17.7% DER on AMI dataset.
- **VadManager** (`VAD/`): Voice activity detection with CoreML models.
- **KokoroSynthesizer** (`TTS/Kokoro/`): Kokoro text-to-speech synthesis.
- **PocketTtsSynthesizer** (`TTS/PocketTTS/`): PocketTTS streaming text-to-speech synthesis.

### Key Patterns
- **Actor-based concurrency**: Thread-safe processing, no `@unchecked Sendable`
- **Stateless ASR**: Each chunk transcribed independently (~14.96s chunks, 2.0s overlap)
- **Auto-recovery**: Corrupt CoreML model detection and re-download from HuggingFace
- **Model management**: Models auto-download from HuggingFace on first use. Can be pre-fetched via `swift run fluidaudiocli download`.
- **Cross-platform**: macOS 14.0+, iOS 17.0+ (library), CLI macOS-only

## Platform Requirements

- **Swift**: 5.10+ (Swift 6+ for swift-format)
- **C++17**: Required for `FastClusterWrapper` (set via `cxxLanguageStandard: .cxx17` in Package.swift)
- **Platforms**: macOS 14.0+, iOS 17.0+
- **Hardware**: Apple Silicon recommended

## CI/CD

GitHub Actions workflows:
- **swift-format.yml**: Code formatting compliance
- **tests.yml**: Build and test execution
- **asr-benchmark.yml**: ASR performance validation
- **diarizer-benchmark.yml**: Diarization benchmarks
- **vad-benchmark.yml**: VAD validation

## Model Sources

- **Diarization**:
  - Online/Streaming (DiarizerManager): [FluidInference/speaker-diarization-coreml](https://huggingface.co/FluidInference/speaker-diarization-coreml) (based on pyannote/speaker-diarization-3.1)
  - Offline Batch (OfflineDiarizerManager): [FluidInference/speaker-diarization-coreml](https://huggingface.co/FluidInference/speaker-diarization-coreml) (based on pyannote/speaker-diarization-community-1)
- **VAD CoreML**: [FluidInference/silero-vad-coreml](https://huggingface.co/FluidInference/silero-vad-coreml)
- **ASR Models**: [FluidInference/parakeet-tdt-0.6b-v3-coreml](https://huggingface.co/FluidInference/parakeet-tdt-0.6b-v3-coreml)
- **Test Data**: [alexwengg/musan_mini*](https://huggingface.co/datasets/alexwengg) variants


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a9e6ab67a6b733814/AGENTS.md
# =========================================

# THE RECORD — Agent Instructions

Local-first macOS 26+ meeting transcription app. Swift 6.2, Clean Architecture, TDD.

This file is the universal entry point for ALL AI coding agents (Claude Code, OpenCode, Codex, Cursor, Copilot, Aider, etc.). Tool-specific configs (`.claude/`, `.cursorrules`, `.opencode.yaml`) extend this — they don't replace it.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, next action, and session handoff state.

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

### Layer Import Rules (STRICT)

| Layer | Allowed Imports | File Limit |
|-------|----------------|------------|
| Domain | `Foundation` only | 100 lines |
| Business | Domain + Foundation + OSLog | 300 lines |
| Infrastructure | Domain + any framework (CoreAudio, DuckDB, WhisperKit, etc.) | 300 lines |
| Presentation | Domain + Business + SwiftUI | ViewModels: 200, Views: 150 |

Presentation NEVER imports Infrastructure directly. Business NEVER imports Infrastructure. Domain NEVER imports anything except Foundation.

### Key Patterns

- **Actors** for all shared mutable state (Swift 6.2 strict concurrency)
- **@MainActor** for Presentation layer (ViewModels and Views)
- **@Observable** for ViewModels (NOT ObservableObject — macOS 26+ only)
- **Protocol seams** between layers — Infrastructure implements Domain protocols
- **All external errors translated** to domain errors at the Infrastructure boundary
- **No `@unchecked Sendable`** except `Infrastructure/Audio/` and `Domain/Audio/AudioBuffer.swift`

## TDD Order (MANDATORY)

```
1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together
```

Never write implementation before the test. Never skip the RED step. Tests use Swift Testing framework (`@Suite`, `@Test`, `#expect`), NOT XCTest.

## Build & Test

```bash
swift build                    # debug build
swift build -c release         # release build
swift test                     # run all tests (1208 tests, ~4.4s)
swift test --filter SuiteName  # run specific test suite
```

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/THE RECORDDomain/          ← library: Foundation only
Sources/THE RECORDBusiness/        ← library: depends on Domain
Sources/THE RECORDInfrastructure/  ← library: depends on Domain + 3rd-party
Sources/THE RECORDPresentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

## Skills (Progressive Disclosure)

Skills are detailed instruction sets for each architectural layer. Read the relevant skill BEFORE writing code for that layer. Skills are in `.claude/skills/` but the content is universal — any agent can read them.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |
| Audio permissions | `~/.claude/skills/apple-audio-permissions/SKILL.md` |
| Swift best practices | `.claude/skills/swift-best-practices/SKILL.md` |
| Core Audio Tap debugging | `.claude/skills/coreaudio-tap-troubleshooting/SKILL.md` |

## Current Audio Capture Stack

THE RECORD uses **Core Audio Taps** (`CATapDescription` + `AudioHardwareCreateProcessTap`), NOT ScreenCaptureKit:

- Permission: "System Audio Recording Only" (lighter tier, no screen sharing indicator)
- Process targeting: `tapDesc.bundleIDs` (macOS 26+) for per-app audio capture
- Reading: `AudioDeviceCreateIOProcIDWithBlock` + `AudioDeviceStart` (NOT AVAudioEngine)
- See `AUDIO-TAP-FIX-PLAN.md` for full implementation details and gotchas

## Canonical Decisions (override older docs)

| Decision | Current | Old (ignore) |
|----------|---------|-------------|
| Audio capture | Core Audio Taps (`CATapDescription`) | ScreenCaptureKit |
| macOS target | macOS 26+ only | macOS 15+ |
| Observation | `@Observable` | `ObservableObject` |
| Calendar integration | EventKit (primary) + MCP servers (extension) | Provider-specific OAuth |
| Extension model | MCP servers via `GenericMCPProvider` | Built-in provider plugins |
| Summarization | MLX GPU (Llama 3.1 8B, exploring Gemma 4) | ANE |

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work.

Architecture docs (read only when working on that layer):
- `docs/architecture/DOMAIN-LAYER.md`
- `docs/architecture/BUSINESS-LAYER.md`
- `docs/architecture/INFRASTRUCTURE-LAYER.md`
- `docs/architecture/PRESENTATION-LAYER.md`
- `docs/architecture/PLUGIN-ARCHITECTURE.md`

## Open Issues

See `ISSUES.md` for the full BM-### register. Key P0s:
- Audio capture: Core Audio Tap IOProc integration (see `AUDIO-TAP-FIX-PLAN.md`)
- `BM-051`: DuckDB lock → fatalError (should show alert)
- `BM-052`: Screen Recording error mapping fixed, System Audio error mapping in progress

## For Subagent Prompts

When spawning agents for parallel work, include:
- The skill file path to read for their layer
- SPEC and PLAN file paths for the current epic
- `Swift 6.2, macOS 26+, -strict-concurrency=complete`
- File size limits per layer (see table above)
- TDD discipline: RED test first, then GREEN implementation

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (12023 symbols, 129262 relationships, 175 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a9e6ab67a6b733814/CLAUDE.md
# =========================================

# THE RECORD

Local-first macOS meeting transcription app. Swift 6.2, Clean Architecture, TDD.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, and next action.

## Orchestration

This file is the conductor. Epics execute in dependency order:

```
COMPLETED                                    REMAINING
─────────                                    ─────────
Epic 1: Core Recording ─┐
Epic 1.5: Capture Fixes  ├──→ Epic 3.5: Parakeet + Telemetry (no UI)
Epic 3: Transcription    │
Epic 4: Diarization     ─┘──→ Epic 5: Menu Bar UI (needs desk)
Epic 2: Storage         ─┘──→ Epic 6: Summarization (MLX/GPU)
                              Epic 7: Streaming + Translation
                              Epic 8: THE RECORD Engine (MCP + NLP)
```

Each epic follows 5 phases: **REFINE** (SPEC) → **PLAN** (TASKS.md) → **PROPERTIES** (formal properties) → **ACT** (code) → **VALIDATE** (integration).
Human checkpoint after PLAN and before ACT. Within ACT, layers build sequentially: Domain → Business → Infrastructure → Presentation.

PROPERTIES.md (template at `docs/planning/PROPERTIES-TEMPLATE.md`) captures 11 property categories:
FUNCTIONAL, SAFETY, LIVENESS, PERFORMANCE, SECURITY, RELIABILITY, CONCURRENCY, OBSERVABILITY, UX, DATA INTEGRITY, PRIVACY.
Each property drives test generation (RED briefs) and reviewer validation (traceability matrix).

## Skills (Progressive Disclosure)

Read the skill file when entering that phase. Don't load all skills upfront.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

**Boundaries enforced by hooks:**
- Domain: only `import Foundation`
- Business: Domain + Foundation + OSLog
- Infrastructure: implements Domain protocols, translates all external errors to domain errors
- Presentation: Business + Domain + SwiftUI

**Also enforced by hooks:**
- File size limits: Domain 100, Business 300, Infrastructure 300, ViewModels 200, Views 150
- No `@unchecked Sendable` outside Infrastructure/Audio and Domain/Audio/AudioBuffer
- TDD guard: warns if writing source without corresponding test file

## Integration Test Environment Variables

```bash
# Enable integration tests (real WhisperKit, DuckDB, FluidAudio inference)
RUN_INTEGRATION_TESTS=1 python3 scripts/test.py --filter "SomeSuite" --no-parallel

# Enable MLX summarization tests (requires app bundle context for metallib — see #80, #81)
RUN_INTEGRATION_TESTS=1 RUN_MLX_TESTS=1 python3 scripts/test.py --filter "SummarizationModelComparison" --no-parallel
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUN_INTEGRATION_TESTS` | unset (skipped) | Enables real-hardware integration suites: WhisperKit, DuckDB, FluidAudio, pipeline |
| `RUN_MLX_TESTS` | unset (skipped) | Enables MLX summarization tests. Requires metallib accessible from bundle (blocked until #81 lands) |

Use `--no-parallel` for integration tests to prevent `swift test --parallel` from buffering stdout during long-running inference.

## TDD Order

1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together

## Rename / Refactor Protocol

**Before any rename swarm, run GitNexus impact analysis to get the complete caller map:**

```
gitnexus_impact({ target: "methodName", direction: "upstream", file_path: "path/to/file.swift", includeTests: true })
```

Pass the full `byDepth.1` list to each rename agent — no grepping, no missed call sites.

**After the swarm, reindex and verify zero orphans:**

```bash
node ~/.npm/_npx/32f98f05d98eef45/node_modules/gitnexus/dist/cli/index.js analyze --force
```

Then run:
```
gitnexus_cypher("MATCH (a)-[{type:'CALLS'}]->(b) WHERE b.name = 'oldName' RETURN a.name, a.filePath")
```

Any remaining hits = confirmed orphaned calls. The DuckDB `.execute()` SQL calls are false positives — filter by `filePath NOT CONTAINS 'DuckDB'` if needed.

## Subagent Briefing

When spawning agents for parallel work, include in the prompt:
- The skill file path to read
- SPEC and PLAN file paths for the current epic
- `Swift 6.2 -strict-concurrency=complete`, file size limits, TDD discipline
- context7 MCP access: `mcp__context7__resolve-library-id` then `mcp__context7__query-docs`

## Canonical Decisions (override older docs)

Some architecture docs predate the SPEC-EPIC1 v2.0 research enrichment. When in conflict:
- **Audio capture:** ScreenCaptureKit (NOT CATapDescription). SPEC-EPIC1.md is authoritative.
- **Project name:** THE RECORD (not "Meeting Transcriber Pro"). Some planning docs use the old name.
- **Observation:** @Observable (NOT ObservableObject). macOS 15+ only.

## Single Source of Truth — Canonical Defaults

**Never hardcode a value that already has a named canonical source.** Reference the source directly so changes propagate automatically.

| Value | Canonical source | Wrong |
|-------|-----------------|-------|
| Default UI theme | `UITheme.default` (= `.broadsheet`) | `.broadsheet` inline |
| Default privacy mode | `PrivacyMode.default` (= `.meetings`) | `.meetings` inline |
| Default meeting type | `SummaryConfig.default.meetingType` (= `.oneOnOne`) | `.oneOnOne` inline |
| Ready status message | `MenuBarViewModel.readyStatus` (= `"Ready"`) | `"Ready"` inline |
| Time format | `TimeInterval.mmss` extension | `String(format: "%d:%02d", ...)` inline |

In **tests**: reference canonical sources so tests stay correct when defaults change:
```swift
// WRONG — breaks if UITheme.default changes
#expect(AppConfig.default.uiTheme == .broadsheet)

// CORRECT
#expect(AppConfig.default.uiTheme == UITheme.default)
```

Detection signal: the same string or value in 3+ places is an SSOT violation.

## Agent Coding Patterns

### Asymmetric try? Fix

When fixing a `try?` that silently swallows errors in a type, audit ALL sibling `try?` calls in the same file before moving on. Silent error loss clusters — fixing one and missing another in the same type is a recurring agent failure pattern.

**Rule**: grep the file for `try?` after fixing any one instance. Fix all of them in the same commit.

### Never try? on Task.sleep in Task Loop Bodies

`try? await Task.sleep(...)` inside a `while !Task.isCancelled` loop swallows `CancellationError` and delays task exit by up to the full sleep duration. This is a responsiveness bug.

**Rule**: In Task loop bodies, always `try await Task.sleep(...)` and let `CancellationError` propagate. The `while` loop exits naturally on throw. Never `try?` a sleep that should respond to cancellation.

### C Library Init: Always Guard and Log Nil

When an actor's `init` calls C library init functions (Speex, CoreAudio, AVAudio, etc.) that return optional pointers, never silently proceed with nil state.

**Rule**: After every C init call in a Swift actor init, guard the returned optional:
```swift
if cState == nil {
    logger.error("C lib init failed — actor will operate in degraded/pass-through mode")
}
```
Longer-term: use a static factory (`Actor.make(...) throws`) so init failure is visible at the call site. Never let nil state produce silent behavioral degradation.

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work
(actor re-entrancy, @unchecked Sendable, parallel test conflicts, diagnostic methodology).

These docs exist but don't read them unless working on that layer:
- `docs/architecture/DOMAIN-LAYER.md` (1681 lines)
- `docs/architecture/BUSINESS-LAYER.md` (1377 lines)
- `docs/architecture/INFRASTRUCTURE-LAYER.md` (1954 lines)
- `docs/architecture/PRESENTATION-LAYER.md` (2045 lines)
- `docs/architecture/PLUGIN-ARCHITECTURE.md` (2367 lines)
- `docs/planning/DEVELOPMENT-PLAN.md` (1239 lines)

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/Domain/          ← library: Foundation only
Sources/Business/        ← library: depends on Domain
Sources/Infrastructure/  ← library: depends on Domain + 3rd-party
Sources/Presentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (12023 symbols, 129262 relationships, 175 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a83db33b7afa074d6/.worktrees/tdd-F/BM-047-green/CLAUDE.md
# =========================================


# BodyMan

Local-first macOS meeting transcription app. Swift 6.2, Clean Architecture, TDD.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, and next action.

## Orchestration

This file is the conductor. Epics execute in dependency order:

```
COMPLETED                                    REMAINING
─────────                                    ─────────
Epic 1: Core Recording ─┐
Epic 1.5: Capture Fixes  ├──→ Epic 3.5: Parakeet + Telemetry (no UI)
Epic 3: Transcription    │
Epic 4: Diarization     ─┘──→ Epic 5: Menu Bar UI (needs desk)
Epic 2: Storage         ─┘──→ Epic 6: Summarization (MLX/GPU)
                              Epic 7: Streaming + Translation
                              Epic 8: BodyMan Engine (MCP + NLP)
```

Each epic follows 4 phases: **REFINE** (SPEC) → **PLAN** (test plan) → **ACT** (code) → **VALIDATE** (integration).
Human checkpoint after each phase. Within ACT, layers build sequentially: Domain → Business → Infrastructure → Presentation.

## Skills (Progressive Disclosure)

Read the skill file when entering that phase. Don't load all skills upfront.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/bodyman-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/bodyman-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/bodyman-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/bodyman-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/bodyman-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/bodyman-integration-validator/SKILL.md` |

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

**Boundaries enforced by hooks:**
- Domain: only `import Foundation`
- Business: Domain + Foundation + OSLog
- Infrastructure: implements Domain protocols, translates all external errors to domain errors
- Presentation: Business + Domain + SwiftUI

**Also enforced by hooks:**
- File size limits: Domain 100, Business 300, Infrastructure 300, ViewModels 200, Views 150
- No `@unchecked Sendable` outside Infrastructure/Audio and Domain/Audio/AudioBuffer
- TDD guard: warns if writing source without corresponding test file

## TDD Order

1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together

## Subagent Briefing

When spawning agents for parallel work, include in the prompt:
- The skill file path to read
- SPEC and PLAN file paths for the current epic
- `Swift 6.2 -strict-concurrency=complete`, file size limits, TDD discipline
- context7 MCP access: `mcp__context7__resolve-library-id` then `mcp__context7__query-docs`

## Canonical Decisions (override older docs)

Some architecture docs predate the SPEC-EPIC1 v2.0 research enrichment. When in conflict:
- **Audio capture:** ScreenCaptureKit (NOT CATapDescription). SPEC-EPIC1.md is authoritative.
- **Project name:** BodyMan (not "Meeting Transcriber Pro"). Some planning docs use the old name.
- **Observation:** @Observable (NOT ObservableObject). macOS 15+ only.

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work
(actor re-entrancy, @unchecked Sendable, parallel test conflicts, diagnostic methodology).

These docs exist but don't read them unless working on that layer:
- `docs/architecture/DOMAIN-LAYER.md` (1681 lines)
- `docs/architecture/BUSINESS-LAYER.md` (1377 lines)
- `docs/architecture/INFRASTRUCTURE-LAYER.md` (1954 lines)
- `docs/architecture/PRESENTATION-LAYER.md` (2045 lines)
- `docs/architecture/PLUGIN-ARCHITECTURE.md` (2367 lines)
- `docs/planning/DEVELOPMENT-PLAN.md` (1239 lines)

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/BodyMan/{Domain,Business,Infrastructure,Presentation}/
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a83db33b7afa074d6/AGENTS.md
# =========================================

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyMan** (6041 symbols, 58294 relationships, 113 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyMan/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyMan/clusters` | All functional areas |
| `gitnexus://repo/bodyMan/processes` | All execution flows |
| `gitnexus://repo/bodyMan/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a83db33b7afa074d6/CLAUDE.md
# =========================================

# THE RECORD

Local-first macOS meeting transcription app. Swift 6.2, Clean Architecture, TDD.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, and next action.

## Orchestration

This file is the conductor. Epics execute in dependency order:

```
COMPLETED                                    REMAINING
─────────                                    ─────────
Epic 1: Core Recording ─┐
Epic 1.5: Capture Fixes  ├──→ Epic 3.5: Parakeet + Telemetry (no UI)
Epic 3: Transcription    │
Epic 4: Diarization     ─┘──→ Epic 5: Menu Bar UI (needs desk)
Epic 2: Storage         ─┘──→ Epic 6: Summarization (MLX/GPU)
                              Epic 7: Streaming + Translation
                              Epic 8: THE RECORD Engine (MCP + NLP)
```

Each epic follows 5 phases: **REFINE** (SPEC) → **PLAN** (TASKS.md) → **PROPERTIES** (formal properties) → **ACT** (code) → **VALIDATE** (integration).
Human checkpoint after PLAN and before ACT. Within ACT, layers build sequentially: Domain → Business → Infrastructure → Presentation.

PROPERTIES.md (template at `docs/planning/PROPERTIES-TEMPLATE.md`) captures 11 property categories:
FUNCTIONAL, SAFETY, LIVENESS, PERFORMANCE, SECURITY, RELIABILITY, CONCURRENCY, OBSERVABILITY, UX, DATA INTEGRITY, PRIVACY.
Each property drives test generation (RED briefs) and reviewer validation (traceability matrix).

## Skills (Progressive Disclosure)

Read the skill file when entering that phase. Don't load all skills upfront.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

**Boundaries enforced by hooks:**
- Domain: only `import Foundation`
- Business: Domain + Foundation + OSLog
- Infrastructure: implements Domain protocols, translates all external errors to domain errors
- Presentation: Business + Domain + SwiftUI

**Also enforced by hooks:**
- File size limits: Domain 100, Business 300, Infrastructure 300, ViewModels 200, Views 150
- No `@unchecked Sendable` outside Infrastructure/Audio and Domain/Audio/AudioBuffer
- TDD guard: warns if writing source without corresponding test file

## TDD Order

1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together

## Subagent Briefing

When spawning agents for parallel work, include in the prompt:
- The skill file path to read
- SPEC and PLAN file paths for the current epic
- `Swift 6.2 -strict-concurrency=complete`, file size limits, TDD discipline
- context7 MCP access: `mcp__context7__resolve-library-id` then `mcp__context7__query-docs`

## Canonical Decisions (override older docs)

Some architecture docs predate the SPEC-EPIC1 v2.0 research enrichment. When in conflict:
- **Audio capture:** ScreenCaptureKit (NOT CATapDescription). SPEC-EPIC1.md is authoritative.
- **Project name:** THE RECORD (not "Meeting Transcriber Pro"). Some planning docs use the old name.
- **Observation:** @Observable (NOT ObservableObject). macOS 15+ only.

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work
(actor re-entrancy, @unchecked Sendable, parallel test conflicts, diagnostic methodology).

These docs exist but don't read them unless working on that layer:
- `docs/architecture/DOMAIN-LAYER.md` (1681 lines)
- `docs/architecture/BUSINESS-LAYER.md` (1377 lines)
- `docs/architecture/INFRASTRUCTURE-LAYER.md` (1954 lines)
- `docs/architecture/PRESENTATION-LAYER.md` (2045 lines)
- `docs/architecture/PLUGIN-ARCHITECTURE.md` (2367 lines)
- `docs/planning/DEVELOPMENT-PLAN.md` (1239 lines)

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/Domain/          ← library: Foundation only
Sources/Business/        ← library: depends on Domain
Sources/Infrastructure/  ← library: depends on Domain + 3rd-party
Sources/Presentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyMan** (6041 symbols, 58294 relationships, 113 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyMan/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyMan/clusters` | All functional areas |
| `gitnexus://repo/bodyMan/processes` | All execution flows |
| `gitnexus://repo/bodyMan/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a039c7ef1394d736b/AGENTS.md
# =========================================

# THE RECORD — Agent Instructions

Local-first macOS 26+ meeting transcription app. Swift 6.2, Clean Architecture, TDD.

This file is the universal entry point for ALL AI coding agents (Claude Code, OpenCode, Codex, Cursor, Copilot, Aider, etc.). Tool-specific configs (`.claude/`, `.cursorrules`, `.opencode.yaml`) extend this — they don't replace it.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, next action, and session handoff state.

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

### Layer Import Rules (STRICT)

| Layer | Allowed Imports | File Limit |
|-------|----------------|------------|
| Domain | `Foundation` only | 100 lines |
| Business | Domain + Foundation + OSLog | 300 lines |
| Infrastructure | Domain + any framework (CoreAudio, DuckDB, WhisperKit, etc.) | 300 lines |
| Presentation | Domain + Business + SwiftUI | ViewModels: 200, Views: 150 |

Presentation NEVER imports Infrastructure directly. Business NEVER imports Infrastructure. Domain NEVER imports anything except Foundation.

### Key Patterns

- **Actors** for all shared mutable state (Swift 6.2 strict concurrency)
- **@MainActor** for Presentation layer (ViewModels and Views)
- **@Observable** for ViewModels (NOT ObservableObject — macOS 26+ only)
- **Protocol seams** between layers — Infrastructure implements Domain protocols
- **All external errors translated** to domain errors at the Infrastructure boundary
- **No `@unchecked Sendable`** except `Infrastructure/Audio/` and `Domain/Audio/AudioBuffer.swift`

## TDD Order (MANDATORY)

```
1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together
```

Never write implementation before the test. Never skip the RED step. Tests use Swift Testing framework (`@Suite`, `@Test`, `#expect`), NOT XCTest.

## Build & Test

```bash
swift build                    # debug build
swift build -c release         # release build
swift test                     # run all tests (1208 tests, ~4.4s)
swift test --filter SuiteName  # run specific test suite
```

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/THE RECORDDomain/          ← library: Foundation only
Sources/THE RECORDBusiness/        ← library: depends on Domain
Sources/THE RECORDInfrastructure/  ← library: depends on Domain + 3rd-party
Sources/THE RECORDPresentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

## Skills (Progressive Disclosure)

Skills are detailed instruction sets for each architectural layer. Read the relevant skill BEFORE writing code for that layer. Skills are in `.claude/skills/` but the content is universal — any agent can read them.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |
| Audio permissions | `~/.claude/skills/apple-audio-permissions/SKILL.md` |
| Swift best practices | `.claude/skills/swift-best-practices/SKILL.md` |
| Core Audio Tap debugging | `.claude/skills/coreaudio-tap-troubleshooting/SKILL.md` |

## Current Audio Capture Stack

THE RECORD uses **Core Audio Taps** (`CATapDescription` + `AudioHardwareCreateProcessTap`), NOT ScreenCaptureKit:

- Permission: "System Audio Recording Only" (lighter tier, no screen sharing indicator)
- Process targeting: `tapDesc.bundleIDs` (macOS 26+) for per-app audio capture
- Reading: `AudioDeviceCreateIOProcIDWithBlock` + `AudioDeviceStart` (NOT AVAudioEngine)
- See `AUDIO-TAP-FIX-PLAN.md` for full implementation details and gotchas

## Canonical Decisions (override older docs)

| Decision | Current | Old (ignore) |
|----------|---------|-------------|
| Audio capture | Core Audio Taps (`CATapDescription`) | ScreenCaptureKit |
| macOS target | macOS 26+ only | macOS 15+ |
| Observation | `@Observable` | `ObservableObject` |
| Calendar integration | EventKit (primary) + MCP servers (extension) | Provider-specific OAuth |
| Extension model | MCP servers via `GenericMCPProvider` | Built-in provider plugins |
| Summarization | MLX GPU (Llama 3.1 8B, exploring Gemma 4) | ANE |

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work.

Architecture docs (read only when working on that layer):
- `docs/architecture/DOMAIN-LAYER.md`
- `docs/architecture/BUSINESS-LAYER.md`
- `docs/architecture/INFRASTRUCTURE-LAYER.md`
- `docs/architecture/PRESENTATION-LAYER.md`
- `docs/architecture/PLUGIN-ARCHITECTURE.md`

## Open Issues

See `ISSUES.md` for the full BM-### register. Key P0s:
- Audio capture: Core Audio Tap IOProc integration (see `AUDIO-TAP-FIX-PLAN.md`)
- `BM-051`: DuckDB lock → fatalError (should show alert)
- `BM-052`: Screen Recording error mapping fixed, System Audio error mapping in progress

## For Subagent Prompts

When spawning agents for parallel work, include:
- The skill file path to read for their layer
- SPEC and PLAN file paths for the current epic
- `Swift 6.2, macOS 26+, -strict-concurrency=complete`
- File size limits per layer (see table above)
- TDD discipline: RED test first, then GREEN implementation

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (12776 symbols, 137262 relationships, 189 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a039c7ef1394d736b/CLAUDE.md
# =========================================

# THE RECORD

Local-first macOS meeting transcription app. Swift 6.2, Clean Architecture, TDD.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, and next action.

## Orchestration

This file is the conductor. Epics execute in dependency order:

```
COMPLETED                                    REMAINING
─────────                                    ─────────
Epic 1: Core Recording ─┐
Epic 1.5: Capture Fixes  ├──→ Epic 3.5: Parakeet + Telemetry (no UI)
Epic 3: Transcription    │
Epic 4: Diarization     ─┘──→ Epic 5: Menu Bar UI (needs desk)
Epic 2: Storage         ─┘──→ Epic 6: Summarization (MLX/GPU)
                              Epic 7: Streaming + Translation
                              Epic 8: THE RECORD Engine (MCP + NLP)
```

Each epic follows 5 phases: **REFINE** (SPEC) → **PLAN** (TASKS.md) → **PROPERTIES** (formal properties) → **ACT** (code) → **VALIDATE** (integration).
Human checkpoint after PLAN and before ACT. Within ACT, layers build sequentially: Domain → Business → Infrastructure → Presentation.

PROPERTIES.md (template at `docs/planning/PROPERTIES-TEMPLATE.md`) captures 11 property categories:
FUNCTIONAL, SAFETY, LIVENESS, PERFORMANCE, SECURITY, RELIABILITY, CONCURRENCY, OBSERVABILITY, UX, DATA INTEGRITY, PRIVACY.
Each property drives test generation (RED briefs) and reviewer validation (traceability matrix).

## Skills (Progressive Disclosure)

Read the skill file when entering that phase. Don't load all skills upfront.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

**Boundaries enforced by hooks:**
- Domain: only `import Foundation`
- Business: Domain + Foundation + OSLog
- Infrastructure: implements Domain protocols, translates all external errors to domain errors
- Presentation: Business + Domain + SwiftUI

**Also enforced by hooks:**
- File size limits: Domain 100, Business 300, Infrastructure 300, ViewModels 200, Views 150
- No `@unchecked Sendable` outside Infrastructure/Audio and Domain/Audio/AudioBuffer
- TDD guard: warns if writing source without corresponding test file

## Integration Test Environment Variables

```bash
# Enable integration tests (real WhisperKit, DuckDB, FluidAudio inference)
RUN_INTEGRATION_TESTS=1 python3 scripts/test.py --filter "SomeSuite" --no-parallel

# Enable MLX summarization tests (requires app bundle context for metallib — see #80, #81)
RUN_INTEGRATION_TESTS=1 RUN_MLX_TESTS=1 python3 scripts/test.py --filter "SummarizationModelComparison" --no-parallel
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUN_INTEGRATION_TESTS` | unset (skipped) | Enables real-hardware integration suites: WhisperKit, DuckDB, FluidAudio, pipeline |
| `RUN_MLX_TESTS` | unset (skipped) | Enables MLX summarization tests. Requires metallib accessible from bundle (blocked until #81 lands) |

Use `--no-parallel` for integration tests to prevent `swift test --parallel` from buffering stdout during long-running inference.

## TDD Order

1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together

## Rename / Refactor Protocol

**Before any rename swarm, run GitNexus impact analysis to get the complete caller map:**

```
gitnexus_impact({ target: "methodName", direction: "upstream", file_path: "path/to/file.swift", includeTests: true })
```

Pass the full `byDepth.1` list to each rename agent — no grepping, no missed call sites.

**After the swarm, reindex and verify zero orphans:**

```bash
node ~/.npm/_npx/32f98f05d98eef45/node_modules/gitnexus/dist/cli/index.js analyze --force
```

Then run:
```
gitnexus_cypher("MATCH (a)-[{type:'CALLS'}]->(b) WHERE b.name = 'oldName' RETURN a.name, a.filePath")
```

Any remaining hits = confirmed orphaned calls. The DuckDB `.execute()` SQL calls are false positives — filter by `filePath NOT CONTAINS 'DuckDB'` if needed.

## Subagent Briefing

When spawning agents for parallel work, include in the prompt:
- The skill file path to read
- SPEC and PLAN file paths for the current epic
- `Swift 6.2 -strict-concurrency=complete`, file size limits, TDD discipline
- context7 MCP access: `mcp__context7__resolve-library-id` then `mcp__context7__query-docs`

## Canonical Decisions (override older docs)

Some architecture docs predate the SPEC-EPIC1 v2.0 research enrichment. When in conflict:
- **Audio capture:** ScreenCaptureKit (NOT CATapDescription). SPEC-EPIC1.md is authoritative.
- **Project name:** THE RECORD (not "Meeting Transcriber Pro"). Some planning docs use the old name.
- **Observation:** @Observable (NOT ObservableObject). macOS 15+ only.

## Single Source of Truth — Canonical Defaults

**Never hardcode a value that already has a named canonical source.** Reference the source directly so changes propagate automatically.

| Value | Canonical source | Wrong |
|-------|-----------------|-------|
| Default UI theme | `UITheme.default` (= `.broadsheet`) | `.broadsheet` inline |
| Default privacy mode | `PrivacyMode.default` (= `.meetings`) | `.meetings` inline |
| Default meeting type | `SummaryConfig.default.meetingType` (= `.oneOnOne`) | `.oneOnOne` inline |
| Ready status message | `MenuBarViewModel.readyStatus` (= `"Ready"`) | `"Ready"` inline |
| Time format | `TimeInterval.mmss` extension | `String(format: "%d:%02d", ...)` inline |

In **tests**: reference canonical sources so tests stay correct when defaults change:
```swift
// WRONG — breaks if UITheme.default changes
#expect(AppConfig.default.uiTheme == .broadsheet)

// CORRECT
#expect(AppConfig.default.uiTheme == UITheme.default)
```

Detection signal: the same string or value in 3+ places is an SSOT violation.

## Agent Coding Patterns

### Asymmetric try? Fix

When fixing a `try?` that silently swallows errors in a type, audit ALL sibling `try?` calls in the same file before moving on. Silent error loss clusters — fixing one and missing another in the same type is a recurring agent failure pattern.

**Rule**: grep the file for `try?` after fixing any one instance. Fix all of them in the same commit.

### Never try? on Task.sleep in Task Loop Bodies

`try? await Task.sleep(...)` inside a `while !Task.isCancelled` loop swallows `CancellationError` and delays task exit by up to the full sleep duration. This is a responsiveness bug.

**Rule**: In Task loop bodies, always `try await Task.sleep(...)` and let `CancellationError` propagate. The `while` loop exits naturally on throw. Never `try?` a sleep that should respond to cancellation.

### C Library Init: Always Guard and Log Nil

When an actor's `init` calls C library init functions (Speex, CoreAudio, AVAudio, etc.) that return optional pointers, never silently proceed with nil state.

**Rule**: After every C init call in a Swift actor init, guard the returned optional:
```swift
if cState == nil {
    logger.error("C lib init failed — actor will operate in degraded/pass-through mode")
}
```
Longer-term: use a static factory (`Actor.make(...) throws`) so init failure is visible at the call site. Never let nil state produce silent behavioral degradation.

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work
(actor re-entrancy, @unchecked Sendable, parallel test conflicts, diagnostic methodology).

These docs exist but don't read them unless working on that layer:
- `docs/architecture/DOMAIN-LAYER.md` (1681 lines)
- `docs/architecture/BUSINESS-LAYER.md` (1377 lines)
- `docs/architecture/INFRASTRUCTURE-LAYER.md` (1954 lines)
- `docs/architecture/PRESENTATION-LAYER.md` (2045 lines)
- `docs/architecture/PLUGIN-ARCHITECTURE.md` (2367 lines)
- `docs/planning/DEVELOPMENT-PLAN.md` (1239 lines)

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/Domain/          ← library: Foundation only
Sources/Business/        ← library: depends on Domain
Sources/Infrastructure/  ← library: depends on Domain + 3rd-party
Sources/Presentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (12776 symbols, 137262 relationships, 189 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a7312cad4fb38a66f/AGENTS.md
# =========================================

# THE RECORD — Agent Instructions

Local-first macOS 26+ meeting transcription app. Swift 6.2, Clean Architecture, TDD.

This file is the universal entry point for ALL AI coding agents (Claude Code, OpenCode, Codex, Cursor, Copilot, Aider, etc.). Tool-specific configs (`.claude/`, `.cursorrules`, `.opencode.yaml`) extend this — they don't replace it.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, next action, and session handoff state.

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

### Layer Import Rules (STRICT)

| Layer | Allowed Imports | File Limit |
|-------|----------------|------------|
| Domain | `Foundation` only | 100 lines |
| Business | Domain + Foundation + OSLog | 300 lines |
| Infrastructure | Domain + any framework (CoreAudio, DuckDB, WhisperKit, etc.) | 300 lines |
| Presentation | Domain + Business + SwiftUI | ViewModels: 200, Views: 150 |

Presentation NEVER imports Infrastructure directly. Business NEVER imports Infrastructure. Domain NEVER imports anything except Foundation.

### Key Patterns

- **Actors** for all shared mutable state (Swift 6.2 strict concurrency)
- **@MainActor** for Presentation layer (ViewModels and Views)
- **@Observable** for ViewModels (NOT ObservableObject — macOS 26+ only)
- **Protocol seams** between layers — Infrastructure implements Domain protocols
- **All external errors translated** to domain errors at the Infrastructure boundary
- **No `@unchecked Sendable`** except `Infrastructure/Audio/` and `Domain/Audio/AudioBuffer.swift`

## TDD Order (MANDATORY)

```
1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together
```

Never write implementation before the test. Never skip the RED step. Tests use Swift Testing framework (`@Suite`, `@Test`, `#expect`), NOT XCTest.

## Build & Test

```bash
swift build                    # debug build
swift build -c release         # release build
swift test                     # run all tests (1208 tests, ~4.4s)
swift test --filter SuiteName  # run specific test suite
```

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/THE RECORDDomain/          ← library: Foundation only
Sources/THE RECORDBusiness/        ← library: depends on Domain
Sources/THE RECORDInfrastructure/  ← library: depends on Domain + 3rd-party
Sources/THE RECORDPresentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

## Skills (Progressive Disclosure)

Skills are detailed instruction sets for each architectural layer. Read the relevant skill BEFORE writing code for that layer. Skills are in `.claude/skills/` but the content is universal — any agent can read them.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |
| Audio permissions | `~/.claude/skills/apple-audio-permissions/SKILL.md` |
| Swift best practices | `.claude/skills/swift-best-practices/SKILL.md` |
| Core Audio Tap debugging | `.claude/skills/coreaudio-tap-troubleshooting/SKILL.md` |

## Current Audio Capture Stack

THE RECORD uses **Core Audio Taps** (`CATapDescription` + `AudioHardwareCreateProcessTap`), NOT ScreenCaptureKit:

- Permission: "System Audio Recording Only" (lighter tier, no screen sharing indicator)
- Process targeting: `tapDesc.bundleIDs` (macOS 26+) for per-app audio capture
- Reading: `AudioDeviceCreateIOProcIDWithBlock` + `AudioDeviceStart` (NOT AVAudioEngine)
- See `AUDIO-TAP-FIX-PLAN.md` for full implementation details and gotchas

## Canonical Decisions (override older docs)

| Decision | Current | Old (ignore) |
|----------|---------|-------------|
| Audio capture | Core Audio Taps (`CATapDescription`) | ScreenCaptureKit |
| macOS target | macOS 26+ only | macOS 15+ |
| Observation | `@Observable` | `ObservableObject` |
| Calendar integration | EventKit (primary) + MCP servers (extension) | Provider-specific OAuth |
| Extension model | MCP servers via `GenericMCPProvider` | Built-in provider plugins |
| Summarization | MLX GPU (Llama 3.1 8B, exploring Gemma 4) | ANE |

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work.

Architecture docs (read only when working on that layer):
- `docs/architecture/DOMAIN-LAYER.md`
- `docs/architecture/BUSINESS-LAYER.md`
- `docs/architecture/INFRASTRUCTURE-LAYER.md`
- `docs/architecture/PRESENTATION-LAYER.md`
- `docs/architecture/PLUGIN-ARCHITECTURE.md`

## Open Issues

See `ISSUES.md` for the full BM-### register. Key P0s:
- Audio capture: Core Audio Tap IOProc integration (see `AUDIO-TAP-FIX-PLAN.md`)
- `BM-051`: DuckDB lock → fatalError (should show alert)
- `BM-052`: Screen Recording error mapping fixed, System Audio error mapping in progress

## For Subagent Prompts

When spawning agents for parallel work, include:
- The skill file path to read for their layer
- SPEC and PLAN file paths for the current epic
- `Swift 6.2, macOS 26+, -strict-concurrency=complete`
- File size limits per layer (see table above)
- TDD discipline: RED test first, then GREEN implementation

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **the-record** (4476 symbols, 46835 relationships, 220 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/the-record/context` | Codebase overview, check index freshness |
| `gitnexus://repo/the-record/clusters` | All functional areas |
| `gitnexus://repo/the-record/processes` | All execution flows |
| `gitnexus://repo/the-record/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# DATUM Enforcement
This repository uses DATUM for all workflows. You must use the `/datum` skill commands (like `/datum go`, `/datum express`) for any feature work or fixes.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a7312cad4fb38a66f/CLAUDE.md
# =========================================

# THE RECORD

Local-first macOS meeting transcription app. Swift 6.2, Clean Architecture, TDD.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, and next action.

## Orchestration

This file is the conductor. Epics execute in dependency order:

```
COMPLETED                                    REMAINING
─────────                                    ─────────
Epic 1: Core Recording ─┐
Epic 1.5: Capture Fixes  ├──→ Epic 3.5: Parakeet + Telemetry (no UI)
Epic 3: Transcription    │
Epic 4: Diarization     ─┘──→ Epic 5: Menu Bar UI (needs desk)
Epic 2: Storage         ─┘──→ Epic 6: Summarization (MLX/GPU)
                              Epic 7: Streaming + Translation
                              Epic 8: THE RECORD Engine (MCP + NLP)
```

Each epic follows 5 phases: **REFINE** (SPEC) → **PLAN** (TASKS.md) → **PROPERTIES** (formal properties) → **ACT** (code) → **VALIDATE** (integration).
Human checkpoint after PLAN and before ACT. Within ACT, layers build sequentially: Domain → Business → Infrastructure → Presentation.

PROPERTIES.md (template at `docs/planning/PROPERTIES-TEMPLATE.md`) captures 11 property categories:
FUNCTIONAL, SAFETY, LIVENESS, PERFORMANCE, SECURITY, RELIABILITY, CONCURRENCY, OBSERVABILITY, UX, DATA INTEGRITY, PRIVACY.
Each property drives test generation (RED briefs) and reviewer validation (traceability matrix).

## Skills (Progressive Disclosure)

Read the skill file when entering that phase. Don't load all skills upfront.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |
| Pre-merge bug hunt | `.claude/skills/therecord-bug-hunt/SKILL.md` |

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

**Boundaries enforced by hooks:**
- Domain: only `import Foundation`
- Business: Domain + Foundation + OSLog
- Infrastructure: implements Domain protocols, translates all external errors to domain errors
- Presentation: Business + Domain + SwiftUI

**Also enforced by hooks:**
- File size limits: Domain 100, Business 300, Infrastructure 300, ViewModels 200, Views 150
- No `@unchecked Sendable` outside Infrastructure/Audio and Domain/Audio/AudioBuffer
- TDD guard: warns if writing source without corresponding test file

## Integration Test Environment Variables

```bash
# Enable integration tests (real WhisperKit, DuckDB, FluidAudio inference)
RUN_INTEGRATION_TESTS=1 python3 scripts/test.py --filter "SomeSuite" --no-parallel

# Enable MLX summarization tests (requires app bundle context for metallib — see #80, #81)
RUN_INTEGRATION_TESTS=1 RUN_MLX_TESTS=1 python3 scripts/test.py --filter "SummarizationModelComparison" --no-parallel
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUN_INTEGRATION_TESTS` | unset (skipped) | Enables real-hardware integration suites: WhisperKit, DuckDB, FluidAudio, pipeline |
| `RUN_MLX_TESTS` | unset (skipped) | Enables MLX summarization tests. Requires metallib accessible from bundle (blocked until #81 lands) |

Use `--no-parallel` for integration tests to prevent `swift test --parallel` from buffering stdout during long-running inference.

## TDD Order

1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together

## Rename / Refactor Protocol

**Before any rename swarm, run GitNexus impact analysis to get the complete caller map:**

```
gitnexus_impact({ target: "methodName", direction: "upstream", file_path: "path/to/file.swift", includeTests: true })
```

Pass the full `byDepth.1` list to each rename agent — no grepping, no missed call sites.

**After the swarm, reindex and verify zero orphans:**

```bash
node ~/.npm/_npx/32f98f05d98eef45/node_modules/gitnexus/dist/cli/index.js analyze --force
```

Then run:
```
gitnexus_cypher("MATCH (a)-[{type:'CALLS'}]->(b) WHERE b.name = 'oldName' RETURN a.name, a.filePath")
```

Any remaining hits = confirmed orphaned calls. The DuckDB `.execute()` SQL calls are false positives — filter by `filePath NOT CONTAINS 'DuckDB'` if needed.

## Subagent Briefing

When spawning agents for parallel work, include in the prompt:
- The skill file path to read
- SPEC and PLAN file paths for the current epic
- `Swift 6.2 -strict-concurrency=complete`, file size limits, TDD discipline
- context7 MCP access: `mcp__context7__resolve-library-id` then `mcp__context7__query-docs`

## Canonical Decisions (override older docs)

Some architecture docs predate the SPEC-EPIC1 v2.0 research enrichment. When in conflict:
- **Audio capture:** ScreenCaptureKit (NOT CATapDescription). SPEC-EPIC1.md is authoritative.
- **Project name:** THE RECORD (not "Meeting Transcriber Pro"). Some planning docs use the old name.
- **Observation:** @Observable (NOT ObservableObject). macOS 15+ only.

## Single Source of Truth — Canonical Defaults

**Never hardcode a value that already has a named canonical source.** Reference the source directly so changes propagate automatically.

| Value | Canonical source | Wrong |
|-------|-----------------|-------|
| Default UI theme | `UITheme.default` (= `.broadsheet`) | `.broadsheet` inline |
| Default privacy mode | `PrivacyMode.default` (= `.meetings`) | `.meetings` inline |
| Default meeting type | `SummaryConfig.default.meetingType` (= `.oneOnOne`) | `.oneOnOne` inline |
| Ready status message | `MenuBarViewModel.readyStatus` (= `"Ready"`) | `"Ready"` inline |
| Time format | `TimeInterval.mmss` extension | `String(format: "%d:%02d", ...)` inline |

In **tests**: reference canonical sources so tests stay correct when defaults change:
```swift
// WRONG — breaks if UITheme.default changes
#expect(AppConfig.default.uiTheme == .broadsheet)

// CORRECT
#expect(AppConfig.default.uiTheme == UITheme.default)
```

Detection signal: the same string or value in 3+ places is an SSOT violation.

## Newspaper Sections — Design Constraint

THE RECORD's long-term direction is a full newspaper with extensible, plugin-backed sections (see Horizon in ROADMAP.md). Keep this in mind when building new features so the eventual shoehorn is trivial:

**Rule 1 — Don't add cases to `BroadsheetSidebarItem`.**
Any new navigable section that would add a `case` to that enum must instead use the open-ended `case section(String)` pattern (same as `folder` and `person`). This keeps the switch small and makes the `SectionRegistry` migration a type-lift, not a refactor.

**Rule 2 — Section views own a narrow dependency, not all of `BroadsheetAppState`.**
When building a new section view (The Brief, Commitments, Intelligence, etc.), pass it a focused use case or repository slice — not the whole app state. The future `NewsSection.body(appState:)` seam should be naturally narrow because the view was already written that way.

**Rule 3 — New meeting-detail tabs follow `BroadsheetTab` pattern.**
Don't embed tab logic directly in the detail switch. New tabs go into `BroadsheetTab` enum as a named case so they can later be driven by a registered section.

## Agent Coding Patterns

### Asymmetric try? Fix

When fixing a `try?` that silently swallows errors in a type, audit ALL sibling `try?` calls in the same file before moving on. Silent error loss clusters — fixing one and missing another in the same type is a recurring agent failure pattern.

**Rule**: grep the file for `try?` after fixing any one instance. Fix all of them in the same commit.

### Never try? on Task.sleep in Task Loop Bodies

`try? await Task.sleep(...)` inside a `while !Task.isCancelled` loop swallows `CancellationError` and delays task exit by up to the full sleep duration. This is a responsiveness bug.

**Rule**: In Task loop bodies, always `try await Task.sleep(...)` and let `CancellationError` propagate. The `while` loop exits naturally on throw. Never `try?` a sleep that should respond to cancellation.

### Never nonisolated(unsafe) on NSFormatter Subclasses

`DateFormatter` and `ISO8601DateFormatter` are `NSFormatter` subclasses that mutate internal locale and timezone caches on every format call. They are **not thread-safe**. `nonisolated(unsafe)` silences Swift 6 without providing mutual exclusion — concurrent callers race on the internal cache.

**Rule**: Never use `nonisolated(unsafe) static let` for `DateFormatter` or `ISO8601DateFormatter`. Instead:
- For parsing: `Date(string, strategy: .iso8601.year().month().day())` — stateless, `Sendable`
- For formatting: `date.formatted(.iso8601)` or `date.formatted(style:)` — value types, `Sendable`
- If you need a specific locale/format: use `FormatStyle` or isolate the formatter to `@MainActor`

### SpeakerID Sentinel Strings Must Be Static Constants

Magic `SpeakerID("Unknown")` and `SpeakerID("Speaker 1")` strings scattered across the codebase violate SSOT and can drift silently.

**Rule**: All sentinel/default `SpeakerID` values must be `public static let` constants on `SpeakerID.swift` (e.g. `.unknown`, `.singleSpeaker`). Never construct sentinel IDs inline from string literals outside `SpeakerID.swift`.

### C Library Init: Always Guard and Log Nil

When an actor's `init` calls C library init functions (Speex, CoreAudio, AVAudio, etc.) that return optional pointers, never silently proceed with nil state.

**Rule**: After every C init call in a Swift actor init, guard the returned optional:
```swift
if cState == nil {
    logger.error("C lib init failed — actor will operate in degraded/pass-through mode")
}
```
Longer-term: use a static factory (`Actor.make(...) throws`) so init failure is visible at the call site. Never let nil state produce silent behavioral degradation.

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work
(actor re-entrancy, @unchecked Sendable, parallel test conflicts, diagnostic methodology).

These docs exist but don't read them unless working on that layer:
- `docs/architecture/DOMAIN-LAYER.md` (1681 lines)
- `docs/architecture/BUSINESS-LAYER.md` (1377 lines)
- `docs/architecture/INFRASTRUCTURE-LAYER.md` (1954 lines)
- `docs/architecture/PRESENTATION-LAYER.md` (2045 lines)
- `docs/architecture/PLUGIN-ARCHITECTURE.md` (2367 lines)
- `docs/planning/DEVELOPMENT-PLAN.md` (1239 lines)

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/Domain/          ← library: Foundation only
Sources/Business/        ← library: depends on Domain
Sources/Infrastructure/  ← library: depends on Domain + 3rd-party
Sources/Presentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **the-record** (4476 symbols, 46835 relationships, 220 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/the-record/context` | Codebase overview, check index freshness |
| `gitnexus://repo/the-record/clusters` | All functional areas |
| `gitnexus://repo/the-record/processes` | All execution flows |
| `gitnexus://repo/the-record/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-ad350026478f80cbb/AGENTS.md
# =========================================

# THE RECORD — Agent Instructions

Local-first macOS 26+ meeting transcription app. Swift 6.2, Clean Architecture, TDD.

This file is the universal entry point for ALL AI coding agents (Claude Code, OpenCode, Codex, Cursor, Copilot, Aider, etc.). Tool-specific configs (`.claude/`, `.cursorrules`, `.opencode.yaml`) extend this — they don't replace it.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, next action, and session handoff state.

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

### Layer Import Rules (STRICT)

| Layer | Allowed Imports | File Limit |
|-------|----------------|------------|
| Domain | `Foundation` only | 100 lines |
| Business | Domain + Foundation + OSLog | 300 lines |
| Infrastructure | Domain + any framework (CoreAudio, DuckDB, WhisperKit, etc.) | 300 lines |
| Presentation | Domain + Business + SwiftUI | ViewModels: 200, Views: 150 |

Presentation NEVER imports Infrastructure directly. Business NEVER imports Infrastructure. Domain NEVER imports anything except Foundation.

### Key Patterns

- **Actors** for all shared mutable state (Swift 6.2 strict concurrency)
- **@MainActor** for Presentation layer (ViewModels and Views)
- **@Observable** for ViewModels (NOT ObservableObject — macOS 26+ only)
- **Protocol seams** between layers — Infrastructure implements Domain protocols
- **All external errors translated** to domain errors at the Infrastructure boundary
- **No `@unchecked Sendable`** except `Infrastructure/Audio/` and `Domain/Audio/AudioBuffer.swift`

## TDD Order (MANDATORY)

```
1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together
```

Never write implementation before the test. Never skip the RED step. Tests use Swift Testing framework (`@Suite`, `@Test`, `#expect`), NOT XCTest.

## Build & Test

```bash
swift build                    # debug build
swift build -c release         # release build
swift test                     # run all tests (1208 tests, ~4.4s)
swift test --filter SuiteName  # run specific test suite
```

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/Domain/          ← library: Foundation only
Sources/Business/        ← library: depends on Domain
Sources/Infrastructure/  ← library: depends on Domain + 3rd-party
Sources/Presentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

## Skills (Progressive Disclosure)

Skills are detailed instruction sets for each architectural layer. Read the relevant skill BEFORE writing code for that layer. Skills are in `.claude/skills/` but the content is universal — any agent can read them.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |
| Audio permissions | `~/.claude/skills/apple-audio-permissions/SKILL.md` |
| Swift best practices | `.claude/skills/swift-best-practices/SKILL.md` |
| Core Audio Tap debugging | `.claude/skills/coreaudio-tap-troubleshooting/SKILL.md` |

## Current Audio Capture Stack

THE RECORD uses **Core Audio Taps** (`CATapDescription` + `AudioHardwareCreateProcessTap`), NOT ScreenCaptureKit:

- Permission: "System Audio Recording Only" (lighter tier, no screen sharing indicator)
- Process targeting: `tapDesc.bundleIDs` (macOS 26+) for per-app audio capture
- Reading: `AudioDeviceCreateIOProcIDWithBlock` + `AudioDeviceStart` (NOT AVAudioEngine)
- See `AUDIO-TAP-FIX-PLAN.md` for full implementation details and gotchas

## Canonical Decisions (override older docs)

| Decision | Current | Old (ignore) |
|----------|---------|-------------|
| Audio capture | Core Audio Taps (`CATapDescription`) | ScreenCaptureKit |
| macOS target | macOS 26+ only | macOS 15+ |
| Observation | `@Observable` | `ObservableObject` |
| Calendar integration | EventKit (primary) + MCP servers (extension) | Provider-specific OAuth |
| Extension model | MCP servers via `GenericMCPProvider` | Built-in provider plugins |
| Summarization | MLX GPU (Llama 3.1 8B, exploring Gemma 4) | ANE |

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work.

Architecture docs (read only when working on that layer):
- `docs/architecture/DOMAIN-LAYER.md`
- `docs/architecture/BUSINESS-LAYER.md`
- `docs/architecture/INFRASTRUCTURE-LAYER.md`
- `docs/architecture/PRESENTATION-LAYER.md`
- `docs/architecture/PLUGIN-ARCHITECTURE.md`

## Open Issues

See `ISSUES.md` for the full BM-### register. Key P0s:
- Audio capture: Core Audio Tap IOProc integration (see `AUDIO-TAP-FIX-PLAN.md`)
- `BM-051`: DuckDB lock → fatalError (should show alert)
- `BM-052`: Screen Recording error mapping fixed, System Audio error mapping in progress

## For Subagent Prompts

When spawning agents for parallel work, include:
- The skill file path to read for their layer
- SPEC and PLAN file paths for the current epic
- `Swift 6.2, macOS 26+, -strict-concurrency=complete`
- File size limits per layer (see table above)
- TDD discipline: RED test first, then GREEN implementation

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (8085 symbols, 75373 relationships, 128 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-ad350026478f80cbb/CLAUDE.md
# =========================================

# THE RECORD

Local-first macOS meeting transcription app. Swift 6.2, Clean Architecture, TDD.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, and next action.

## Orchestration

This file is the conductor. Epics execute in dependency order:

```
COMPLETED                                    REMAINING
─────────                                    ─────────
Epic 1: Core Recording ─┐
Epic 1.5: Capture Fixes  ├──→ Epic 3.5: Parakeet + Telemetry (no UI)
Epic 3: Transcription    │
Epic 4: Diarization     ─┘──→ Epic 5: Menu Bar UI (needs desk)
Epic 2: Storage         ─┘──→ Epic 6: Summarization (MLX/GPU)
                              Epic 7: Streaming + Translation
                              Epic 8: THE RECORD Engine (MCP + NLP)
```

Each epic follows 5 phases: **REFINE** (SPEC) → **PLAN** (TASKS.md) → **PROPERTIES** (formal properties) → **ACT** (code) → **VALIDATE** (integration).
Human checkpoint after PLAN and before ACT. Within ACT, layers build sequentially: Domain → Business → Infrastructure → Presentation.

PROPERTIES.md (template at `docs/planning/PROPERTIES-TEMPLATE.md`) captures 11 property categories:
FUNCTIONAL, SAFETY, LIVENESS, PERFORMANCE, SECURITY, RELIABILITY, CONCURRENCY, OBSERVABILITY, UX, DATA INTEGRITY, PRIVACY.
Each property drives test generation (RED briefs) and reviewer validation (traceability matrix).

## Skills (Progressive Disclosure)

Read the skill file when entering that phase. Don't load all skills upfront.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

**Boundaries enforced by hooks:**
- Domain: only `import Foundation`
- Business: Domain + Foundation + OSLog
- Infrastructure: implements Domain protocols, translates all external errors to domain errors
- Presentation: Business + Domain + SwiftUI

**Also enforced by hooks:**
- File size limits: Domain 100, Business 300, Infrastructure 300, ViewModels 200, Views 150
- No `@unchecked Sendable` outside Infrastructure/Audio and Domain/Audio/AudioBuffer
- TDD guard: warns if writing source without corresponding test file

## TDD Order

1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together

## Rename / Refactor Protocol

**Before any rename swarm, run GitNexus impact analysis to get the complete caller map:**

```
gitnexus_impact({ target: "methodName", direction: "upstream", file_path: "path/to/file.swift", includeTests: true })
```

Pass the full `byDepth.1` list to each rename agent — no grepping, no missed call sites.

**After the swarm, reindex and verify zero orphans:**

```bash
node ~/.npm/_npx/32f98f05d98eef45/node_modules/gitnexus/dist/cli/index.js analyze --force
```

Then run:
```
gitnexus_cypher("MATCH (a)-[{type:'CALLS'}]->(b) WHERE b.name = 'oldName' RETURN a.name, a.filePath")
```

Any remaining hits = confirmed orphaned calls. The DuckDB `.execute()` SQL calls are false positives — filter by `filePath NOT CONTAINS 'DuckDB'` if needed.

## Subagent Briefing

When spawning agents for parallel work, include in the prompt:
- The skill file path to read
- SPEC and PLAN file paths for the current epic
- `Swift 6.2 -strict-concurrency=complete`, file size limits, TDD discipline
- context7 MCP access: `mcp__context7__resolve-library-id` then `mcp__context7__query-docs`

## Canonical Decisions (override older docs)

Some architecture docs predate the SPEC-EPIC1 v2.0 research enrichment. When in conflict:
- **Audio capture:** ScreenCaptureKit (NOT CATapDescription). SPEC-EPIC1.md is authoritative.
- **Project name:** THE RECORD (not "Meeting Transcriber Pro"). Some planning docs use the old name.
- **Observation:** @Observable (NOT ObservableObject). macOS 15+ only.

## Single Source of Truth — Canonical Defaults

**Never hardcode a value that already has a named canonical source.** Reference the source directly so changes propagate automatically.

| Value | Canonical source | Wrong |
|-------|-----------------|-------|
| Default UI theme | `UITheme.default` (= `.broadsheet`) | `.broadsheet` inline |
| Default privacy mode | `PrivacyMode.default` (= `.meetings`) | `.meetings` inline |
| Default meeting type | `SummaryConfig.default.meetingType` (= `.oneOnOne`) | `.oneOnOne` inline |
| Ready status message | `MenuBarViewModel.readyStatus` (= `"Ready"`) | `"Ready"` inline |
| Time format | `TimeInterval.mmss` extension | `String(format: "%d:%02d", ...)` inline |

In **tests**: reference canonical sources so tests stay correct when defaults change:
```swift
// WRONG — breaks if UITheme.default changes
#expect(AppConfig.default.uiTheme == .broadsheet)

// CORRECT
#expect(AppConfig.default.uiTheme == UITheme.default)
```

Detection signal: the same string or value in 3+ places is an SSOT violation.

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work
(actor re-entrancy, @unchecked Sendable, parallel test conflicts, diagnostic methodology).

These docs exist but don't read them unless working on that layer:
- `docs/architecture/DOMAIN-LAYER.md` (1681 lines)
- `docs/architecture/BUSINESS-LAYER.md` (1377 lines)
- `docs/architecture/INFRASTRUCTURE-LAYER.md` (1954 lines)
- `docs/architecture/PRESENTATION-LAYER.md` (2045 lines)
- `docs/architecture/PLUGIN-ARCHITECTURE.md` (2367 lines)
- `docs/planning/DEVELOPMENT-PLAN.md` (1239 lines)

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/Domain/          ← library: Foundation only
Sources/Business/        ← library: depends on Domain
Sources/Infrastructure/  ← library: depends on Domain + 3rd-party
Sources/Presentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (8085 symbols, 75373 relationships, 128 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a2b4963b1b0f8982d/.claude/worktrees/agent-ad3d19f8530f3be88/AGENTS.md
# =========================================

# BodyMan — Agent Instructions

Local-first macOS 26+ meeting transcription app. Swift 6.2, Clean Architecture, TDD.

This file is the universal entry point for ALL AI coding agents (Claude Code, OpenCode, Codex, Cursor, Copilot, Aider, etc.). Tool-specific configs (`.claude/`, `.cursorrules`, `.opencode.yaml`) extend this — they don't replace it.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, next action, and session handoff state.

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

### Layer Import Rules (STRICT)

| Layer | Allowed Imports | File Limit |
|-------|----------------|------------|
| Domain | `Foundation` only | 100 lines |
| Business | Domain + Foundation + OSLog | 300 lines |
| Infrastructure | Domain + any framework (CoreAudio, DuckDB, WhisperKit, etc.) | 300 lines |
| Presentation | Domain + Business + SwiftUI | ViewModels: 200, Views: 150 |

Presentation NEVER imports Infrastructure directly. Business NEVER imports Infrastructure. Domain NEVER imports anything except Foundation.

### Key Patterns

- **Actors** for all shared mutable state (Swift 6.2 strict concurrency)
- **@MainActor** for Presentation layer (ViewModels and Views)
- **@Observable** for ViewModels (NOT ObservableObject — macOS 26+ only)
- **Protocol seams** between layers — Infrastructure implements Domain protocols
- **All external errors translated** to domain errors at the Infrastructure boundary
- **No `@unchecked Sendable`** except `Infrastructure/Audio/` and `Domain/Audio/AudioBuffer.swift`

## TDD Order (MANDATORY)

```
1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together
```

Never write implementation before the test. Never skip the RED step. Tests use Swift Testing framework (`@Suite`, `@Test`, `#expect`), NOT XCTest.

## Build & Test

```bash
swift build                    # debug build
swift build -c release         # release build
swift test                     # run all tests (1208 tests, ~4.4s)
swift test --filter SuiteName  # run specific test suite
```

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/BodyManDomain/          ← library: Foundation only
Sources/BodyManBusiness/        ← library: depends on Domain
Sources/BodyManInfrastructure/  ← library: depends on Domain + 3rd-party
Sources/BodyManPresentation/    ← library: depends on Domain + Business
Sources/BodyMan/                ← executable: composition root (BodyManApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

## Skills (Progressive Disclosure)

Skills are detailed instruction sets for each architectural layer. Read the relevant skill BEFORE writing code for that layer. Skills are in `.claude/skills/` but the content is universal — any agent can read them.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/bodyman-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/bodyman-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/bodyman-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/bodyman-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/bodyman-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/bodyman-integration-validator/SKILL.md` |
| Audio permissions | `~/.claude/skills/apple-audio-permissions/SKILL.md` |
| Swift best practices | `.claude/skills/swift-best-practices/SKILL.md` |
| Core Audio Tap debugging | `.claude/skills/coreaudio-tap-troubleshooting/SKILL.md` |

## Current Audio Capture Stack

BodyMan uses **Core Audio Taps** (`CATapDescription` + `AudioHardwareCreateProcessTap`), NOT ScreenCaptureKit:

- Permission: "System Audio Recording Only" (lighter tier, no screen sharing indicator)
- Process targeting: `tapDesc.bundleIDs` (macOS 26+) for per-app audio capture
- Reading: `AudioDeviceCreateIOProcIDWithBlock` + `AudioDeviceStart` (NOT AVAudioEngine)
- See `AUDIO-TAP-FIX-PLAN.md` for full implementation details and gotchas

## Canonical Decisions (override older docs)

| Decision | Current | Old (ignore) |
|----------|---------|-------------|
| Audio capture | Core Audio Taps (`CATapDescription`) | ScreenCaptureKit |
| macOS target | macOS 26+ only | macOS 15+ |
| Observation | `@Observable` | `ObservableObject` |
| Calendar integration | EventKit (primary) + MCP servers (extension) | Provider-specific OAuth |
| Extension model | MCP servers via `GenericMCPProvider` | Built-in provider plugins |
| Summarization | MLX GPU (Llama 3.1 8B, exploring Gemma 4) | ANE |

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work.

Architecture docs (read only when working on that layer):
- `docs/architecture/DOMAIN-LAYER.md`
- `docs/architecture/BUSINESS-LAYER.md`
- `docs/architecture/INFRASTRUCTURE-LAYER.md`
- `docs/architecture/PRESENTATION-LAYER.md`
- `docs/architecture/PLUGIN-ARCHITECTURE.md`

## Open Issues

See `ISSUES.md` for the full BM-### register. Key P0s:
- Audio capture: Core Audio Tap IOProc integration (see `AUDIO-TAP-FIX-PLAN.md`)
- `BM-051`: DuckDB lock → fatalError (should show alert)
- `BM-052`: Screen Recording error mapping fixed, System Audio error mapping in progress

## For Subagent Prompts

When spawning agents for parallel work, include:
- The skill file path to read for their layer
- SPEC and PLAN file paths for the current epic
- `Swift 6.2, macOS 26+, -strict-concurrency=complete`
- File size limits per layer (see table above)
- TDD discipline: RED test first, then GREEN implementation

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (12023 symbols, 129262 relationships, 175 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a2b4963b1b0f8982d/.claude/worktrees/agent-ad3d19f8530f3be88/CLAUDE.md
# =========================================

# BodyMan

Local-first macOS meeting transcription app. Swift 6.2, Clean Architecture, TDD.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, and next action.

## Orchestration

This file is the conductor. Epics execute in dependency order:

```
COMPLETED                                    REMAINING
─────────                                    ─────────
Epic 1: Core Recording ─┐
Epic 1.5: Capture Fixes  ├──→ Epic 3.5: Parakeet + Telemetry (no UI)
Epic 3: Transcription    │
Epic 4: Diarization     ─┘──→ Epic 5: Menu Bar UI (needs desk)
Epic 2: Storage         ─┘──→ Epic 6: Summarization (MLX/GPU)
                              Epic 7: Streaming + Translation
                              Epic 8: BodyMan Engine (MCP + NLP)
```

Each epic follows 5 phases: **REFINE** (SPEC) → **PLAN** (TASKS.md) → **PROPERTIES** (formal properties) → **ACT** (code) → **VALIDATE** (integration).
Human checkpoint after PLAN and before ACT. Within ACT, layers build sequentially: Domain → Business → Infrastructure → Presentation.

PROPERTIES.md (template at `docs/planning/PROPERTIES-TEMPLATE.md`) captures 11 property categories:
FUNCTIONAL, SAFETY, LIVENESS, PERFORMANCE, SECURITY, RELIABILITY, CONCURRENCY, OBSERVABILITY, UX, DATA INTEGRITY, PRIVACY.
Each property drives test generation (RED briefs) and reviewer validation (traceability matrix).

## Skills (Progressive Disclosure)

Read the skill file when entering that phase. Don't load all skills upfront.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/bodyman-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/bodyman-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/bodyman-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/bodyman-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/bodyman-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/bodyman-integration-validator/SKILL.md` |

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

**Boundaries enforced by hooks:**
- Domain: only `import Foundation`
- Business: Domain + Foundation + OSLog
- Infrastructure: implements Domain protocols, translates all external errors to domain errors
- Presentation: Business + Domain + SwiftUI

**Also enforced by hooks:**
- File size limits: Domain 100, Business 300, Infrastructure 300, ViewModels 200, Views 150
- No `@unchecked Sendable` outside Infrastructure/Audio and Domain/Audio/AudioBuffer
- TDD guard: warns if writing source without corresponding test file

## Integration Test Environment Variables

```bash
# Enable integration tests (real WhisperKit, DuckDB, FluidAudio inference)
RUN_INTEGRATION_TESTS=1 python3 scripts/test.py --filter "SomeSuite" --no-parallel

# Enable MLX summarization tests (requires app bundle context for metallib — see #80, #81)
RUN_INTEGRATION_TESTS=1 RUN_MLX_TESTS=1 python3 scripts/test.py --filter "SummarizationModelComparison" --no-parallel
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUN_INTEGRATION_TESTS` | unset (skipped) | Enables real-hardware integration suites: WhisperKit, DuckDB, FluidAudio, pipeline |
| `RUN_MLX_TESTS` | unset (skipped) | Enables MLX summarization tests. Requires metallib accessible from bundle (blocked until #81 lands) |

Use `--no-parallel` for integration tests to prevent `swift test --parallel` from buffering stdout during long-running inference.

## TDD Order

1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together

## Rename / Refactor Protocol

**Before any rename swarm, run GitNexus impact analysis to get the complete caller map:**

```
gitnexus_impact({ target: "methodName", direction: "upstream", file_path: "path/to/file.swift", includeTests: true })
```

Pass the full `byDepth.1` list to each rename agent — no grepping, no missed call sites.

**After the swarm, reindex and verify zero orphans:**

```bash
node ~/.npm/_npx/32f98f05d98eef45/node_modules/gitnexus/dist/cli/index.js analyze --force
```

Then run:
```
gitnexus_cypher("MATCH (a)-[{type:'CALLS'}]->(b) WHERE b.name = 'oldName' RETURN a.name, a.filePath")
```

Any remaining hits = confirmed orphaned calls. The DuckDB `.execute()` SQL calls are false positives — filter by `filePath NOT CONTAINS 'DuckDB'` if needed.

## Subagent Briefing

When spawning agents for parallel work, include in the prompt:
- The skill file path to read
- SPEC and PLAN file paths for the current epic
- `Swift 6.2 -strict-concurrency=complete`, file size limits, TDD discipline
- context7 MCP access: `mcp__context7__resolve-library-id` then `mcp__context7__query-docs`

## Canonical Decisions (override older docs)

Some architecture docs predate the SPEC-EPIC1 v2.0 research enrichment. When in conflict:
- **Audio capture:** ScreenCaptureKit (NOT CATapDescription). SPEC-EPIC1.md is authoritative.
- **Project name:** BodyMan (not "Meeting Transcriber Pro"). Some planning docs use the old name.
- **Observation:** @Observable (NOT ObservableObject). macOS 15+ only.

## Single Source of Truth — Canonical Defaults

**Never hardcode a value that already has a named canonical source.** Reference the source directly so changes propagate automatically.

| Value | Canonical source | Wrong |
|-------|-----------------|-------|
| Default UI theme | `UITheme.default` (= `.broadsheet`) | `.broadsheet` inline |
| Default privacy mode | `PrivacyMode.default` (= `.meetings`) | `.meetings` inline |
| Default meeting type | `SummaryConfig.default.meetingType` (= `.oneOnOne`) | `.oneOnOne` inline |
| Ready status message | `MenuBarViewModel.readyStatus` (= `"Ready"`) | `"Ready"` inline |
| Time format | `TimeInterval.mmss` extension | `String(format: "%d:%02d", ...)` inline |

In **tests**: reference canonical sources so tests stay correct when defaults change:
```swift
// WRONG — breaks if UITheme.default changes
#expect(AppConfig.default.uiTheme == .broadsheet)

// CORRECT
#expect(AppConfig.default.uiTheme == UITheme.default)
```

Detection signal: the same string or value in 3+ places is an SSOT violation.

## Agent Coding Patterns

### Asymmetric try? Fix

When fixing a `try?` that silently swallows errors in a type, audit ALL sibling `try?` calls in the same file before moving on. Silent error loss clusters — fixing one and missing another in the same type is a recurring agent failure pattern.

**Rule**: grep the file for `try?` after fixing any one instance. Fix all of them in the same commit.

### Never try? on Task.sleep in Task Loop Bodies

`try? await Task.sleep(...)` inside a `while !Task.isCancelled` loop swallows `CancellationError` and delays task exit by up to the full sleep duration. This is a responsiveness bug.

**Rule**: In Task loop bodies, always `try await Task.sleep(...)` and let `CancellationError` propagate. The `while` loop exits naturally on throw. Never `try?` a sleep that should respond to cancellation.

### C Library Init: Always Guard and Log Nil

When an actor's `init` calls C library init functions (Speex, CoreAudio, AVAudio, etc.) that return optional pointers, never silently proceed with nil state.

**Rule**: After every C init call in a Swift actor init, guard the returned optional:
```swift
if cState == nil {
    logger.error("C lib init failed — actor will operate in degraded/pass-through mode")
}
```
Longer-term: use a static factory (`Actor.make(...) throws`) so init failure is visible at the call site. Never let nil state produce silent behavioral degradation.

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work
(actor re-entrancy, @unchecked Sendable, parallel test conflicts, diagnostic methodology).

These docs exist but don't read them unless working on that layer:
- `docs/architecture/DOMAIN-LAYER.md` (1681 lines)
- `docs/architecture/BUSINESS-LAYER.md` (1377 lines)
- `docs/architecture/INFRASTRUCTURE-LAYER.md` (1954 lines)
- `docs/architecture/PRESENTATION-LAYER.md` (2045 lines)
- `docs/architecture/PLUGIN-ARCHITECTURE.md` (2367 lines)
- `docs/planning/DEVELOPMENT-PLAN.md` (1239 lines)

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/Domain/          ← library: Foundation only
Sources/Business/        ← library: depends on Domain
Sources/Infrastructure/  ← library: depends on Domain + 3rd-party
Sources/Presentation/    ← library: depends on Domain + Business
Sources/BodyMan/                ← executable: composition root (BodyManApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (12023 symbols, 129262 relationships, 175 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a5133012206de150a/AGENTS.md
# =========================================

# THE RECORD — Agent Instructions

Local-first macOS 26+ meeting transcription app. Swift 6.2, Clean Architecture, TDD.

This file is the universal entry point for ALL AI coding agents (Claude Code, OpenCode, Codex, Cursor, Copilot, Aider, etc.). Tool-specific configs (`.claude/`, `.cursorrules`, `.opencode.yaml`) extend this — they don't replace it.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, next action, and session handoff state.

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

### Layer Import Rules (STRICT)

| Layer | Allowed Imports | File Limit |
|-------|----------------|------------|
| Domain | `Foundation` only | 100 lines |
| Business | Domain + Foundation + OSLog | 300 lines |
| Infrastructure | Domain + any framework (CoreAudio, DuckDB, WhisperKit, etc.) | 300 lines |
| Presentation | Domain + Business + SwiftUI | ViewModels: 200, Views: 150 |

Presentation NEVER imports Infrastructure directly. Business NEVER imports Infrastructure. Domain NEVER imports anything except Foundation.

### Key Patterns

- **Actors** for all shared mutable state (Swift 6.2 strict concurrency)
- **@MainActor** for Presentation layer (ViewModels and Views)
- **@Observable** for ViewModels (NOT ObservableObject — macOS 26+ only)
- **Protocol seams** between layers — Infrastructure implements Domain protocols
- **All external errors translated** to domain errors at the Infrastructure boundary
- **No `@unchecked Sendable`** except `Infrastructure/Audio/` and `Domain/Audio/AudioBuffer.swift`

## TDD Order (MANDATORY)

```
1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together
```

Never write implementation before the test. Never skip the RED step. Tests use Swift Testing framework (`@Suite`, `@Test`, `#expect`), NOT XCTest.

## Build & Test

```bash
swift build                    # debug build
swift build -c release         # release build
swift test                     # run all tests (1208 tests, ~4.4s)
swift test --filter SuiteName  # run specific test suite
```

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/THE RECORDDomain/          ← library: Foundation only
Sources/THE RECORDBusiness/        ← library: depends on Domain
Sources/THE RECORDInfrastructure/  ← library: depends on Domain + 3rd-party
Sources/THE RECORDPresentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

## Skills (Progressive Disclosure)

Skills are detailed instruction sets for each architectural layer. Read the relevant skill BEFORE writing code for that layer. Skills are in `.claude/skills/` but the content is universal — any agent can read them.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |
| Audio permissions | `~/.claude/skills/apple-audio-permissions/SKILL.md` |
| Swift best practices | `.claude/skills/swift-best-practices/SKILL.md` |
| Core Audio Tap debugging | `.claude/skills/coreaudio-tap-troubleshooting/SKILL.md` |

## Current Audio Capture Stack

THE RECORD uses **Core Audio Taps** (`CATapDescription` + `AudioHardwareCreateProcessTap`), NOT ScreenCaptureKit:

- Permission: "System Audio Recording Only" (lighter tier, no screen sharing indicator)
- Process targeting: `tapDesc.bundleIDs` (macOS 26+) for per-app audio capture
- Reading: `AudioDeviceCreateIOProcIDWithBlock` + `AudioDeviceStart` (NOT AVAudioEngine)
- See `AUDIO-TAP-FIX-PLAN.md` for full implementation details and gotchas

## Canonical Decisions (override older docs)

| Decision | Current | Old (ignore) |
|----------|---------|-------------|
| Audio capture | Core Audio Taps (`CATapDescription`) | ScreenCaptureKit |
| macOS target | macOS 26+ only | macOS 15+ |
| Observation | `@Observable` | `ObservableObject` |
| Calendar integration | EventKit (primary) + MCP servers (extension) | Provider-specific OAuth |
| Extension model | MCP servers via `GenericMCPProvider` | Built-in provider plugins |
| Summarization | MLX GPU (Llama 3.1 8B, exploring Gemma 4) | ANE |

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work.

Architecture docs (read only when working on that layer):
- `docs/architecture/DOMAIN-LAYER.md`
- `docs/architecture/BUSINESS-LAYER.md`
- `docs/architecture/INFRASTRUCTURE-LAYER.md`
- `docs/architecture/PRESENTATION-LAYER.md`
- `docs/architecture/PLUGIN-ARCHITECTURE.md`

## Open Issues

See `ISSUES.md` for the full BM-### register. Key P0s:
- Audio capture: Core Audio Tap IOProc integration (see `AUDIO-TAP-FIX-PLAN.md`)
- `BM-051`: DuckDB lock → fatalError (should show alert)
- `BM-052`: Screen Recording error mapping fixed, System Audio error mapping in progress

## For Subagent Prompts

When spawning agents for parallel work, include:
- The skill file path to read for their layer
- SPEC and PLAN file paths for the current epic
- `Swift 6.2, macOS 26+, -strict-concurrency=complete`
- File size limits per layer (see table above)
- TDD discipline: RED test first, then GREEN implementation

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (13747 symbols, 144948 relationships, 190 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a5133012206de150a/CLAUDE.md
# =========================================

# THE RECORD

Local-first macOS meeting transcription app. Swift 6.2, Clean Architecture, TDD.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, and next action.

## Orchestration

This file is the conductor. Epics execute in dependency order:

```
COMPLETED                                    REMAINING
─────────                                    ─────────
Epic 1: Core Recording ─┐
Epic 1.5: Capture Fixes  ├──→ Epic 3.5: Parakeet + Telemetry (no UI)
Epic 3: Transcription    │
Epic 4: Diarization     ─┘──→ Epic 5: Menu Bar UI (needs desk)
Epic 2: Storage         ─┘──→ Epic 6: Summarization (MLX/GPU)
                              Epic 7: Streaming + Translation
                              Epic 8: THE RECORD Engine (MCP + NLP)
```

Each epic follows 5 phases: **REFINE** (SPEC) → **PLAN** (TASKS.md) → **PROPERTIES** (formal properties) → **ACT** (code) → **VALIDATE** (integration).
Human checkpoint after PLAN and before ACT. Within ACT, layers build sequentially: Domain → Business → Infrastructure → Presentation.

PROPERTIES.md (template at `docs/planning/PROPERTIES-TEMPLATE.md`) captures 11 property categories:
FUNCTIONAL, SAFETY, LIVENESS, PERFORMANCE, SECURITY, RELIABILITY, CONCURRENCY, OBSERVABILITY, UX, DATA INTEGRITY, PRIVACY.
Each property drives test generation (RED briefs) and reviewer validation (traceability matrix).

## Skills (Progressive Disclosure)

Read the skill file when entering that phase. Don't load all skills upfront.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

**Boundaries enforced by hooks:**
- Domain: only `import Foundation`
- Business: Domain + Foundation + OSLog
- Infrastructure: implements Domain protocols, translates all external errors to domain errors
- Presentation: Business + Domain + SwiftUI

**Also enforced by hooks:**
- File size limits: Domain 100, Business 300, Infrastructure 300, ViewModels 200, Views 150
- No `@unchecked Sendable` outside Infrastructure/Audio and Domain/Audio/AudioBuffer
- TDD guard: warns if writing source without corresponding test file

## Integration Test Environment Variables

```bash
# Enable integration tests (real WhisperKit, DuckDB, FluidAudio inference)
RUN_INTEGRATION_TESTS=1 python3 scripts/test.py --filter "SomeSuite" --no-parallel

# Enable MLX summarization tests (requires app bundle context for metallib — see #80, #81)
RUN_INTEGRATION_TESTS=1 RUN_MLX_TESTS=1 python3 scripts/test.py --filter "SummarizationModelComparison" --no-parallel
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUN_INTEGRATION_TESTS` | unset (skipped) | Enables real-hardware integration suites: WhisperKit, DuckDB, FluidAudio, pipeline |
| `RUN_MLX_TESTS` | unset (skipped) | Enables MLX summarization tests. Requires metallib accessible from bundle (blocked until #81 lands) |

Use `--no-parallel` for integration tests to prevent `swift test --parallel` from buffering stdout during long-running inference.

## TDD Order

1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together

## Rename / Refactor Protocol

**Before any rename swarm, run GitNexus impact analysis to get the complete caller map:**

```
gitnexus_impact({ target: "methodName", direction: "upstream", file_path: "path/to/file.swift", includeTests: true })
```

Pass the full `byDepth.1` list to each rename agent — no grepping, no missed call sites.

**After the swarm, reindex and verify zero orphans:**

```bash
node ~/.npm/_npx/32f98f05d98eef45/node_modules/gitnexus/dist/cli/index.js analyze --force
```

Then run:
```
gitnexus_cypher("MATCH (a)-[{type:'CALLS'}]->(b) WHERE b.name = 'oldName' RETURN a.name, a.filePath")
```

Any remaining hits = confirmed orphaned calls. The DuckDB `.execute()` SQL calls are false positives — filter by `filePath NOT CONTAINS 'DuckDB'` if needed.

## Subagent Briefing

When spawning agents for parallel work, include in the prompt:
- The skill file path to read
- SPEC and PLAN file paths for the current epic
- `Swift 6.2 -strict-concurrency=complete`, file size limits, TDD discipline
- context7 MCP access: `mcp__context7__resolve-library-id` then `mcp__context7__query-docs`

## Canonical Decisions (override older docs)

Some architecture docs predate the SPEC-EPIC1 v2.0 research enrichment. When in conflict:
- **Audio capture:** ScreenCaptureKit (NOT CATapDescription). SPEC-EPIC1.md is authoritative.
- **Project name:** THE RECORD (not "Meeting Transcriber Pro"). Some planning docs use the old name.
- **Observation:** @Observable (NOT ObservableObject). macOS 15+ only.

## Single Source of Truth — Canonical Defaults

**Never hardcode a value that already has a named canonical source.** Reference the source directly so changes propagate automatically.

| Value | Canonical source | Wrong |
|-------|-----------------|-------|
| Default UI theme | `UITheme.default` (= `.broadsheet`) | `.broadsheet` inline |
| Default privacy mode | `PrivacyMode.default` (= `.meetings`) | `.meetings` inline |
| Default meeting type | `SummaryConfig.default.meetingType` (= `.oneOnOne`) | `.oneOnOne` inline |
| Ready status message | `MenuBarViewModel.readyStatus` (= `"Ready"`) | `"Ready"` inline |
| Time format | `TimeInterval.mmss` extension | `String(format: "%d:%02d", ...)` inline |

In **tests**: reference canonical sources so tests stay correct when defaults change:
```swift
// WRONG — breaks if UITheme.default changes
#expect(AppConfig.default.uiTheme == .broadsheet)

// CORRECT
#expect(AppConfig.default.uiTheme == UITheme.default)
```

Detection signal: the same string or value in 3+ places is an SSOT violation.

## Newspaper Sections — Design Constraint

THE RECORD's long-term direction is a full newspaper with extensible, plugin-backed sections (see Horizon in ROADMAP.md). Keep this in mind when building new features so the eventual shoehorn is trivial:

**Rule 1 — Don't add cases to `BroadsheetSidebarItem`.**
Any new navigable section that would add a `case` to that enum must instead use the open-ended `case section(String)` pattern (same as `folder` and `person`). This keeps the switch small and makes the `SectionRegistry` migration a type-lift, not a refactor.

**Rule 2 — Section views own a narrow dependency, not all of `BroadsheetAppState`.**
When building a new section view (The Brief, Commitments, Intelligence, etc.), pass it a focused use case or repository slice — not the whole app state. The future `NewsSection.body(appState:)` seam should be naturally narrow because the view was already written that way.

**Rule 3 — New meeting-detail tabs follow `BroadsheetTab` pattern.**
Don't embed tab logic directly in the detail switch. New tabs go into `BroadsheetTab` enum as a named case so they can later be driven by a registered section.

## Agent Coding Patterns

### Asymmetric try? Fix

When fixing a `try?` that silently swallows errors in a type, audit ALL sibling `try?` calls in the same file before moving on. Silent error loss clusters — fixing one and missing another in the same type is a recurring agent failure pattern.

**Rule**: grep the file for `try?` after fixing any one instance. Fix all of them in the same commit.

### Never try? on Task.sleep in Task Loop Bodies

`try? await Task.sleep(...)` inside a `while !Task.isCancelled` loop swallows `CancellationError` and delays task exit by up to the full sleep duration. This is a responsiveness bug.

**Rule**: In Task loop bodies, always `try await Task.sleep(...)` and let `CancellationError` propagate. The `while` loop exits naturally on throw. Never `try?` a sleep that should respond to cancellation.

### Never nonisolated(unsafe) on NSFormatter Subclasses

`DateFormatter` and `ISO8601DateFormatter` are `NSFormatter` subclasses that mutate internal locale and timezone caches on every format call. They are **not thread-safe**. `nonisolated(unsafe)` silences Swift 6 without providing mutual exclusion — concurrent callers race on the internal cache.

**Rule**: Never use `nonisolated(unsafe) static let` for `DateFormatter` or `ISO8601DateFormatter`. Instead:
- For parsing: `Date(string, strategy: .iso8601.year().month().day())` — stateless, `Sendable`
- For formatting: `date.formatted(.iso8601)` or `date.formatted(style:)` — value types, `Sendable`
- If you need a specific locale/format: use `FormatStyle` or isolate the formatter to `@MainActor`

### SpeakerID Sentinel Strings Must Be Static Constants

Magic `SpeakerID("Unknown")` and `SpeakerID("Speaker 1")` strings scattered across the codebase violate SSOT and can drift silently.

**Rule**: All sentinel/default `SpeakerID` values must be `public static let` constants on `SpeakerID.swift` (e.g. `.unknown`, `.singleSpeaker`). Never construct sentinel IDs inline from string literals outside `SpeakerID.swift`.

### C Library Init: Always Guard and Log Nil

When an actor's `init` calls C library init functions (Speex, CoreAudio, AVAudio, etc.) that return optional pointers, never silently proceed with nil state.

**Rule**: After every C init call in a Swift actor init, guard the returned optional:
```swift
if cState == nil {
    logger.error("C lib init failed — actor will operate in degraded/pass-through mode")
}
```
Longer-term: use a static factory (`Actor.make(...) throws`) so init failure is visible at the call site. Never let nil state produce silent behavioral degradation.

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work
(actor re-entrancy, @unchecked Sendable, parallel test conflicts, diagnostic methodology).

These docs exist but don't read them unless working on that layer:
- `docs/architecture/DOMAIN-LAYER.md` (1681 lines)
- `docs/architecture/BUSINESS-LAYER.md` (1377 lines)
- `docs/architecture/INFRASTRUCTURE-LAYER.md` (1954 lines)
- `docs/architecture/PRESENTATION-LAYER.md` (2045 lines)
- `docs/architecture/PLUGIN-ARCHITECTURE.md` (2367 lines)
- `docs/planning/DEVELOPMENT-PLAN.md` (1239 lines)

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/Domain/          ← library: Foundation only
Sources/Business/        ← library: depends on Domain
Sources/Infrastructure/  ← library: depends on Domain + 3rd-party
Sources/Presentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (13747 symbols, 144948 relationships, 190 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-abc3ca61a9d2373c0/CLAUDE.md
# =========================================

# THE RECORD

Local-first macOS meeting transcription app. Swift 6.2, Clean Architecture, TDD.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, and next action.

## Orchestration

This file is the conductor. Epics execute in dependency order:

```
COMPLETED                                    REMAINING
─────────                                    ─────────
Epic 1: Core Recording ─┐
Epic 1.5: Capture Fixes  ├──→ Epic 3.5: Parakeet + Telemetry (no UI)
Epic 3: Transcription    │
Epic 4: Diarization     ─┘──→ Epic 5: Menu Bar UI (needs desk)
Epic 2: Storage         ─┘──→ Epic 6: Summarization (MLX/GPU)
                              Epic 7: Streaming + Translation
                              Epic 8: THE RECORD Engine (MCP + NLP)
```

Each epic follows 5 phases: **REFINE** (SPEC) → **PLAN** (TASKS.md) → **PROPERTIES** (formal properties) → **ACT** (code) → **VALIDATE** (integration).
Human checkpoint after PLAN and before ACT. Within ACT, layers build sequentially: Domain → Business → Infrastructure → Presentation.

PROPERTIES.md (template at `docs/planning/PROPERTIES-TEMPLATE.md`) captures 11 property categories:
FUNCTIONAL, SAFETY, LIVENESS, PERFORMANCE, SECURITY, RELIABILITY, CONCURRENCY, OBSERVABILITY, UX, DATA INTEGRITY, PRIVACY.
Each property drives test generation (RED briefs) and reviewer validation (traceability matrix).

## Skills (Progressive Disclosure)

Read the skill file when entering that phase. Don't load all skills upfront.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

**Boundaries enforced by hooks:**
- Domain: only `import Foundation`
- Business: Domain + Foundation + OSLog
- Infrastructure: implements Domain protocols, translates all external errors to domain errors
- Presentation: Business + Domain + SwiftUI

**Also enforced by hooks:**
- File size limits: Domain 100, Business 300, Infrastructure 300, ViewModels 200, Views 150
- No `@unchecked Sendable` outside Infrastructure/Audio and Domain/Audio/AudioBuffer
- TDD guard: warns if writing source without corresponding test file

## TDD Order

1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together

## Rename / Refactor Protocol

**Before any rename swarm, run GitNexus impact analysis to get the complete caller map:**

```
gitnexus_impact({ target: "methodName", direction: "upstream", file_path: "path/to/file.swift", includeTests: true })
```

Pass the full `byDepth.1` list to each rename agent — no grepping, no missed call sites.

**After the swarm, reindex and verify zero orphans:**

```bash
node ~/.npm/_npx/32f98f05d98eef45/node_modules/gitnexus/dist/cli/index.js analyze --force
```

Then run:
```
gitnexus_cypher("MATCH (a)-[{type:'CALLS'}]->(b) WHERE b.name = 'oldName' RETURN a.name, a.filePath")
```

Any remaining hits = confirmed orphaned calls. The DuckDB `.execute()` SQL calls are false positives — filter by `filePath NOT CONTAINS 'DuckDB'` if needed.

## Subagent Briefing

When spawning agents for parallel work, include in the prompt:
- The skill file path to read
- SPEC and PLAN file paths for the current epic
- `Swift 6.2 -strict-concurrency=complete`, file size limits, TDD discipline
- context7 MCP access: `mcp__context7__resolve-library-id` then `mcp__context7__query-docs`

## Canonical Decisions (override older docs)

Some architecture docs predate the SPEC-EPIC1 v2.0 research enrichment. When in conflict:
- **Audio capture:** ScreenCaptureKit (NOT CATapDescription). SPEC-EPIC1.md is authoritative.
- **Project name:** THE RECORD (not "Meeting Transcriber Pro"). Some planning docs use the old name.
- **Observation:** @Observable (NOT ObservableObject). macOS 15+ only.

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work
(actor re-entrancy, @unchecked Sendable, parallel test conflicts, diagnostic methodology).

These docs exist but don't read them unless working on that layer:
- `docs/architecture/DOMAIN-LAYER.md` (1681 lines)
- `docs/architecture/BUSINESS-LAYER.md` (1377 lines)
- `docs/architecture/INFRASTRUCTURE-LAYER.md` (1954 lines)
- `docs/architecture/PRESENTATION-LAYER.md` (2045 lines)
- `docs/architecture/PLUGIN-ARCHITECTURE.md` (2367 lines)
- `docs/planning/DEVELOPMENT-PLAN.md` (1239 lines)

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/Domain/          ← library: Foundation only
Sources/Business/        ← library: depends on Domain
Sources/Infrastructure/  ← library: depends on Domain + 3rd-party
Sources/Presentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (8085 symbols, 75373 relationships, 128 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.claude/worktrees/agent-a9638ffa28e7b6ec5/CLAUDE.md
# =========================================

# THE RECORD

Local-first macOS meeting transcription app. Swift 6.2, Clean Architecture, TDD.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, and next action.

## Orchestration

This file is the conductor. Epics execute in dependency order:

```
COMPLETED                                    REMAINING
─────────                                    ─────────
Epic 1: Core Recording ─┐
Epic 1.5: Capture Fixes  ├──→ Epic 3.5: Parakeet + Telemetry (no UI)
Epic 3: Transcription    │
Epic 4: Diarization     ─┘──→ Epic 5: Menu Bar UI (needs desk)
Epic 2: Storage         ─┘──→ Epic 6: Summarization (MLX/GPU)
                              Epic 7: Streaming + Translation
                              Epic 8: THE RECORD Engine (MCP + NLP)
```

Each epic follows 5 phases: **REFINE** (SPEC) → **PLAN** (TASKS.md) → **PROPERTIES** (formal properties) → **ACT** (code) → **VALIDATE** (integration).
Human checkpoint after PLAN and before ACT. Within ACT, layers build sequentially: Domain → Business → Infrastructure → Presentation.

PROPERTIES.md (template at `docs/planning/PROPERTIES-TEMPLATE.md`) captures 11 property categories:
FUNCTIONAL, SAFETY, LIVENESS, PERFORMANCE, SECURITY, RELIABILITY, CONCURRENCY, OBSERVABILITY, UX, DATA INTEGRITY, PRIVACY.
Each property drives test generation (RED briefs) and reviewer validation (traceability matrix).

## Skills (Progressive Disclosure)

Read the skill file when entering that phase. Don't load all skills upfront.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

**Boundaries enforced by hooks:**
- Domain: only `import Foundation`
- Business: Domain + Foundation + OSLog
- Infrastructure: implements Domain protocols, translates all external errors to domain errors
- Presentation: Business + Domain + SwiftUI

**Also enforced by hooks:**
- File size limits: Domain 100, Business 300, Infrastructure 300, ViewModels 200, Views 150
- No `@unchecked Sendable` outside Infrastructure/Audio and Domain/Audio/AudioBuffer
- TDD guard: warns if writing source without corresponding test file

## TDD Order

1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together

## Rename / Refactor Protocol

**Before any rename swarm, run GitNexus impact analysis to get the complete caller map:**

```
gitnexus_impact({ target: "methodName", direction: "upstream", file_path: "path/to/file.swift", includeTests: true })
```

Pass the full `byDepth.1` list to each rename agent — no grepping, no missed call sites.

**After the swarm, reindex and verify zero orphans:**

```bash
node ~/.npm/_npx/32f98f05d98eef45/node_modules/gitnexus/dist/cli/index.js analyze --force
```

Then run:
```
gitnexus_cypher("MATCH (a)-[{type:'CALLS'}]->(b) WHERE b.name = 'oldName' RETURN a.name, a.filePath")
```

Any remaining hits = confirmed orphaned calls. The DuckDB `.execute()` SQL calls are false positives — filter by `filePath NOT CONTAINS 'DuckDB'` if needed.

## Subagent Briefing

When spawning agents for parallel work, include in the prompt:
- The skill file path to read
- SPEC and PLAN file paths for the current epic
- `Swift 6.2 -strict-concurrency=complete`, file size limits, TDD discipline
- context7 MCP access: `mcp__context7__resolve-library-id` then `mcp__context7__query-docs`

## Canonical Decisions (override older docs)

Some architecture docs predate the SPEC-EPIC1 v2.0 research enrichment. When in conflict:
- **Audio capture:** ScreenCaptureKit (NOT CATapDescription). SPEC-EPIC1.md is authoritative.
- **Project name:** THE RECORD (not "Meeting Transcriber Pro"). Some planning docs use the old name.
- **Observation:** @Observable (NOT ObservableObject). macOS 15+ only.

## Single Source of Truth — Canonical Defaults

**Never hardcode a value that already has a named canonical source.** Reference the source directly so changes propagate automatically.

| Value | Canonical source | Wrong |
|-------|-----------------|-------|
| Default UI theme | `UITheme.default` (= `.broadsheet`) | `.broadsheet` inline |
| Default privacy mode | `PrivacyMode.default` (= `.meetings`) | `.meetings` inline |
| Default meeting type | `SummaryConfig.default.meetingType` (= `.oneOnOne`) | `.oneOnOne` inline |
| Ready status message | `MenuBarViewModel.readyStatus` (= `"Ready"`) | `"Ready"` inline |
| Time format | `TimeInterval.mmss` extension | `String(format: "%d:%02d", ...)` inline |

In **tests**: reference canonical sources so tests stay correct when defaults change:
```swift
// WRONG — breaks if UITheme.default changes
#expect(AppConfig.default.uiTheme == .broadsheet)

// CORRECT
#expect(AppConfig.default.uiTheme == UITheme.default)
```

Detection signal: the same string or value in 3+ places is an SSOT violation.

## Agent Coding Patterns

### Asymmetric try? Fix

When fixing a `try?` that silently swallows errors in a type, audit ALL sibling `try?` calls in the same file before moving on. Silent error loss clusters — fixing one and missing another in the same type is a recurring agent failure pattern.

**Rule**: grep the file for `try?` after fixing any one instance. Fix all of them in the same commit.

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work
(actor re-entrancy, @unchecked Sendable, parallel test conflicts, diagnostic methodology).

These docs exist but don't read them unless working on that layer:
- `docs/architecture/DOMAIN-LAYER.md` (1681 lines)
- `docs/architecture/BUSINESS-LAYER.md` (1377 lines)
- `docs/architecture/INFRASTRUCTURE-LAYER.md` (1954 lines)
- `docs/architecture/PRESENTATION-LAYER.md` (2045 lines)
- `docs/architecture/PLUGIN-ARCHITECTURE.md` (2367 lines)
- `docs/planning/DEVELOPMENT-PLAN.md` (1239 lines)

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/Domain/          ← library: Foundation only
Sources/Business/        ← library: depends on Domain
Sources/Infrastructure/  ← library: depends on Domain + 3rd-party
Sources/Presentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (8085 symbols, 75373 relationships, 128 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.worktrees/user-docs/AGENTS.md
# =========================================

# THE RECORD — Agent Instructions

Local-first macOS 26+ meeting transcription app. Swift 6.2, Clean Architecture, TDD.

This file is the universal entry point for ALL AI coding agents (Claude Code, OpenCode, Codex, Cursor, Copilot, Aider, etc.). Tool-specific configs (`.claude/`, `.cursorrules`, `.opencode.yaml`) extend this — they don't replace it.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, next action, and session handoff state.

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

### Layer Import Rules (STRICT)

| Layer | Allowed Imports | File Limit |
|-------|----------------|------------|
| Domain | `Foundation` only | 100 lines |
| Business | Domain + Foundation + OSLog | 300 lines |
| Infrastructure | Domain + any framework (CoreAudio, DuckDB, WhisperKit, etc.) | 300 lines |
| Presentation | Domain + Business + SwiftUI | ViewModels: 200, Views: 150 |

Presentation NEVER imports Infrastructure directly. Business NEVER imports Infrastructure. Domain NEVER imports anything except Foundation.

### Key Patterns

- **Actors** for all shared mutable state (Swift 6.2 strict concurrency)
- **@MainActor** for Presentation layer (ViewModels and Views)
- **@Observable** for ViewModels (NOT ObservableObject — macOS 26+ only)
- **Protocol seams** between layers — Infrastructure implements Domain protocols
- **All external errors translated** to domain errors at the Infrastructure boundary
- **No `@unchecked Sendable`** except `Infrastructure/Audio/` and `Domain/Audio/AudioBuffer.swift`

## TDD Order (MANDATORY)

```
1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together
```

Never write implementation before the test. Never skip the RED step. Tests use Swift Testing framework (`@Suite`, `@Test`, `#expect`), NOT XCTest.

## Build & Test

```bash
swift build                    # debug build
swift build -c release         # release build
swift test                     # run all tests (1208 tests, ~4.4s)
swift test --filter SuiteName  # run specific test suite
```

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/THE RECORDDomain/          ← library: Foundation only
Sources/THE RECORDBusiness/        ← library: depends on Domain
Sources/THE RECORDInfrastructure/  ← library: depends on Domain + 3rd-party
Sources/THE RECORDPresentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

## Skills (Progressive Disclosure)

Skills are detailed instruction sets for each architectural layer. Read the relevant skill BEFORE writing code for that layer. Skills are in `.claude/skills/` but the content is universal — any agent can read them.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |
| Audio permissions | `~/.claude/skills/apple-audio-permissions/SKILL.md` |
| Swift best practices | `.claude/skills/swift-best-practices/SKILL.md` |
| Core Audio Tap debugging | `.claude/skills/coreaudio-tap-troubleshooting/SKILL.md` |

## Current Audio Capture Stack

THE RECORD uses **Core Audio Taps** (`CATapDescription` + `AudioHardwareCreateProcessTap`), NOT ScreenCaptureKit:

- Permission: "System Audio Recording Only" (lighter tier, no screen sharing indicator)
- Process targeting: `tapDesc.bundleIDs` (macOS 26+) for per-app audio capture
- Reading: `AudioDeviceCreateIOProcIDWithBlock` + `AudioDeviceStart` (NOT AVAudioEngine)
- See `AUDIO-TAP-FIX-PLAN.md` for full implementation details and gotchas

## Canonical Decisions (override older docs)

| Decision | Current | Old (ignore) |
|----------|---------|-------------|
| Audio capture | Core Audio Taps (`CATapDescription`) | ScreenCaptureKit |
| macOS target | macOS 26+ only | macOS 15+ |
| Observation | `@Observable` | `ObservableObject` |
| Calendar integration | EventKit (primary) + MCP servers (extension) | Provider-specific OAuth |
| Extension model | MCP servers via `GenericMCPProvider` | Built-in provider plugins |
| Summarization | MLX GPU (Llama 3.1 8B, exploring Gemma 4) | ANE |

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work.

Architecture docs (read only when working on that layer):
- `docs/architecture/DOMAIN-LAYER.md`
- `docs/architecture/BUSINESS-LAYER.md`
- `docs/architecture/INFRASTRUCTURE-LAYER.md`
- `docs/architecture/PRESENTATION-LAYER.md`
- `docs/architecture/PLUGIN-ARCHITECTURE.md`

## Open Issues

See `ISSUES.md` for the full BM-### register. Key P0s:
- Audio capture: Core Audio Tap IOProc integration (see `AUDIO-TAP-FIX-PLAN.md`)
- `BM-051`: DuckDB lock → fatalError (should show alert)
- `BM-052`: Screen Recording error mapping fixed, System Audio error mapping in progress

## For Subagent Prompts

When spawning agents for parallel work, include:
- The skill file path to read for their layer
- SPEC and PLAN file paths for the current epic
- `Swift 6.2, macOS 26+, -strict-concurrency=complete`
- File size limits per layer (see table above)
- TDD discipline: RED test first, then GREEN implementation

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (34791 symbols, 427781 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/.worktrees/user-docs/CLAUDE.md
# =========================================

# THE RECORD

Local-first macOS meeting transcription app. Swift 6.2, Clean Architecture, TDD.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, and next action.

## Orchestration

This file is the conductor. Epics execute in dependency order:

```
COMPLETED                                    REMAINING
─────────                                    ─────────
Epic 1: Core Recording ─┐
Epic 1.5: Capture Fixes  ├──→ Epic 3.5: Parakeet + Telemetry (no UI)
Epic 3: Transcription    │
Epic 4: Diarization     ─┘──→ Epic 5: Menu Bar UI (needs desk)
Epic 2: Storage         ─┘──→ Epic 6: Summarization (MLX/GPU)
                              Epic 7: Streaming + Translation
                              Epic 8: THE RECORD Engine (MCP + NLP)
```

Each epic follows 5 phases: **REFINE** (SPEC) → **PLAN** (TASKS.md) → **PROPERTIES** (formal properties) → **ACT** (code) → **VALIDATE** (integration).
Human checkpoint after PLAN and before ACT. Within ACT, layers build sequentially: Domain → Business → Infrastructure → Presentation.

PROPERTIES.md (template at `docs/planning/PROPERTIES-TEMPLATE.md`) captures 11 property categories:
FUNCTIONAL, SAFETY, LIVENESS, PERFORMANCE, SECURITY, RELIABILITY, CONCURRENCY, OBSERVABILITY, UX, DATA INTEGRITY, PRIVACY.
Each property drives test generation (RED briefs) and reviewer validation (traceability matrix).

## Skills (Progressive Disclosure)

Read the skill file when entering that phase. Don't load all skills upfront.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

**Boundaries enforced by hooks:**
- Domain: only `import Foundation`
- Business: Domain + Foundation + OSLog
- Infrastructure: implements Domain protocols, translates all external errors to domain errors
- Presentation: Business + Domain + SwiftUI

**Also enforced by hooks:**
- File size limits: Domain 100, Business 300, Infrastructure 300, ViewModels 200, Views 150
- No `@unchecked Sendable` outside Infrastructure/Audio and Domain/Audio/AudioBuffer
- TDD guard: warns if writing source without corresponding test file

## Integration Test Environment Variables

```bash
# Enable integration tests (real WhisperKit, DuckDB, FluidAudio inference)
RUN_INTEGRATION_TESTS=1 python3 scripts/test.py --filter "SomeSuite" --no-parallel

# Enable MLX summarization tests (requires app bundle context for metallib — see #80, #81)
RUN_INTEGRATION_TESTS=1 RUN_MLX_TESTS=1 python3 scripts/test.py --filter "SummarizationModelComparison" --no-parallel
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUN_INTEGRATION_TESTS` | unset (skipped) | Enables real-hardware integration suites: WhisperKit, DuckDB, FluidAudio, pipeline |
| `RUN_MLX_TESTS` | unset (skipped) | Enables MLX summarization tests. Requires metallib accessible from bundle (blocked until #81 lands) |

Use `--no-parallel` for integration tests to prevent `swift test --parallel` from buffering stdout during long-running inference.

## TDD Order

1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together

## Rename / Refactor Protocol

**Before any rename swarm, run GitNexus impact analysis to get the complete caller map:**

```
gitnexus_impact({ target: "methodName", direction: "upstream", file_path: "path/to/file.swift", includeTests: true })
```

Pass the full `byDepth.1` list to each rename agent — no grepping, no missed call sites.

**After the swarm, reindex and verify zero orphans:**

```bash
node ~/.npm/_npx/32f98f05d98eef45/node_modules/gitnexus/dist/cli/index.js analyze --force
```

Then run:
```
gitnexus_cypher("MATCH (a)-[{type:'CALLS'}]->(b) WHERE b.name = 'oldName' RETURN a.name, a.filePath")
```

Any remaining hits = confirmed orphaned calls. The DuckDB `.execute()` SQL calls are false positives — filter by `filePath NOT CONTAINS 'DuckDB'` if needed.

## Subagent Briefing

When spawning agents for parallel work, include in the prompt:
- The skill file path to read
- SPEC and PLAN file paths for the current epic
- `Swift 6.2 -strict-concurrency=complete`, file size limits, TDD discipline
- context7 MCP access: `mcp__context7__resolve-library-id` then `mcp__context7__query-docs`

## Canonical Decisions (override older docs)

Some architecture docs predate the SPEC-EPIC1 v2.0 research enrichment. When in conflict:
- **Audio capture:** ScreenCaptureKit (NOT CATapDescription). SPEC-EPIC1.md is authoritative.
- **Project name:** THE RECORD (not "Meeting Transcriber Pro"). Some planning docs use the old name.
- **Observation:** @Observable (NOT ObservableObject). macOS 15+ only.

## Single Source of Truth — Canonical Defaults

**Never hardcode a value that already has a named canonical source.** Reference the source directly so changes propagate automatically.

| Value | Canonical source | Wrong |
|-------|-----------------|-------|
| Default UI theme | `UITheme.default` (= `.broadsheet`) | `.broadsheet` inline |
| Default privacy mode | `PrivacyMode.default` (= `.meetings`) | `.meetings` inline |
| Default meeting type | `SummaryConfig.default.meetingType` (= `.oneOnOne`) | `.oneOnOne` inline |
| Ready status message | `MenuBarViewModel.readyStatus` (= `"Ready"`) | `"Ready"` inline |
| Time format | `TimeInterval.mmss` extension | `String(format: "%d:%02d", ...)` inline |

In **tests**: reference canonical sources so tests stay correct when defaults change:
```swift
// WRONG — breaks if UITheme.default changes
#expect(AppConfig.default.uiTheme == .broadsheet)

// CORRECT
#expect(AppConfig.default.uiTheme == UITheme.default)
```

Detection signal: the same string or value in 3+ places is an SSOT violation.

## Newspaper Sections — Design Constraint

THE RECORD's long-term direction is a full newspaper with extensible, plugin-backed sections (see Horizon in ROADMAP.md). Keep this in mind when building new features so the eventual shoehorn is trivial:

**Rule 1 — Don't add cases to `BroadsheetSidebarItem`.**
Any new navigable section that would add a `case` to that enum must instead use the open-ended `case section(String)` pattern (same as `folder` and `person`). This keeps the switch small and makes the `SectionRegistry` migration a type-lift, not a refactor.

**Rule 2 — Section views own a narrow dependency, not all of `BroadsheetAppState`.**
When building a new section view (The Brief, Commitments, Intelligence, etc.), pass it a focused use case or repository slice — not the whole app state. The future `NewsSection.body(appState:)` seam should be naturally narrow because the view was already written that way.

**Rule 3 — New meeting-detail tabs follow `BroadsheetTab` pattern.**
Don't embed tab logic directly in the detail switch. New tabs go into `BroadsheetTab` enum as a named case so they can later be driven by a registered section.

## Agent Coding Patterns

### Asymmetric try? Fix

When fixing a `try?` that silently swallows errors in a type, audit ALL sibling `try?` calls in the same file before moving on. Silent error loss clusters — fixing one and missing another in the same type is a recurring agent failure pattern.

**Rule**: grep the file for `try?` after fixing any one instance. Fix all of them in the same commit.

### Never try? on Task.sleep in Task Loop Bodies

`try? await Task.sleep(...)` inside a `while !Task.isCancelled` loop swallows `CancellationError` and delays task exit by up to the full sleep duration. This is a responsiveness bug.

**Rule**: In Task loop bodies, always `try await Task.sleep(...)` and let `CancellationError` propagate. The `while` loop exits naturally on throw. Never `try?` a sleep that should respond to cancellation.

### Never nonisolated(unsafe) on NSFormatter Subclasses

`DateFormatter` and `ISO8601DateFormatter` are `NSFormatter` subclasses that mutate internal locale and timezone caches on every format call. They are **not thread-safe**. `nonisolated(unsafe)` silences Swift 6 without providing mutual exclusion — concurrent callers race on the internal cache.

**Rule**: Never use `nonisolated(unsafe) static let` for `DateFormatter` or `ISO8601DateFormatter`. Instead:
- For parsing: `Date(string, strategy: .iso8601.year().month().day())` — stateless, `Sendable`
- For formatting: `date.formatted(.iso8601)` or `date.formatted(style:)` — value types, `Sendable`
- If you need a specific locale/format: use `FormatStyle` or isolate the formatter to `@MainActor`

### SpeakerID Sentinel Strings Must Be Static Constants

Magic `SpeakerID("Unknown")` and `SpeakerID("Speaker 1")` strings scattered across the codebase violate SSOT and can drift silently.

**Rule**: All sentinel/default `SpeakerID` values must be `public static let` constants on `SpeakerID.swift` (e.g. `.unknown`, `.singleSpeaker`). Never construct sentinel IDs inline from string literals outside `SpeakerID.swift`.

### C Library Init: Always Guard and Log Nil

When an actor's `init` calls C library init functions (Speex, CoreAudio, AVAudio, etc.) that return optional pointers, never silently proceed with nil state.

**Rule**: After every C init call in a Swift actor init, guard the returned optional:
```swift
if cState == nil {
    logger.error("C lib init failed — actor will operate in degraded/pass-through mode")
}
```
Longer-term: use a static factory (`Actor.make(...) throws`) so init failure is visible at the call site. Never let nil state produce silent behavioral degradation.

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work
(actor re-entrancy, @unchecked Sendable, parallel test conflicts, diagnostic methodology).

These docs exist but don't read them unless working on that layer:
- `docs/architecture/DOMAIN-LAYER.md` (1681 lines)
- `docs/architecture/BUSINESS-LAYER.md` (1377 lines)
- `docs/architecture/INFRASTRUCTURE-LAYER.md` (1954 lines)
- `docs/architecture/PRESENTATION-LAYER.md` (2045 lines)
- `docs/architecture/PLUGIN-ARCHITECTURE.md` (2367 lines)
- `docs/planning/DEVELOPMENT-PLAN.md` (1239 lines)

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/Domain/          ← library: Foundation only
Sources/Business/        ← library: depends on Domain
Sources/Infrastructure/  ← library: depends on Domain + 3rd-party
Sources/Presentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (34791 symbols, 427781 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/AGENTS.md
# =========================================

# THE RECORD — Agent Instructions

Local-first macOS 26+ meeting transcription app. Swift 6.2, Clean Architecture, TDD.

This file is the universal entry point for ALL AI coding agents (Claude Code, OpenCode, Codex, Cursor, Copilot, Aider, etc.). Tool-specific configs (`.claude/`, `.cursorrules`, `.opencode.yaml`) extend this — they don't replace it.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, next action, and session handoff state.

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

### Layer Import Rules (STRICT)

| Layer | Allowed Imports | File Limit |
|-------|----------------|------------|
| Domain | `Foundation` only | 100 lines |
| Business | Domain + Foundation + OSLog | 300 lines |
| Infrastructure | Domain + any framework (CoreAudio, DuckDB, WhisperKit, etc.) | 300 lines |
| Presentation | Domain + Business + SwiftUI | ViewModels: 200, Views: 150 |

Presentation NEVER imports Infrastructure directly. Business NEVER imports Infrastructure. Domain NEVER imports anything except Foundation.

### Key Patterns

- **Actors** for all shared mutable state (Swift 6.2 strict concurrency)
- **@MainActor** for Presentation layer (ViewModels and Views)
- **@Observable** for ViewModels (NOT ObservableObject — macOS 26+ only)
- **Protocol seams** between layers — Infrastructure implements Domain protocols
- **All external errors translated** to domain errors at the Infrastructure boundary
- **No `@unchecked Sendable`** except `Infrastructure/Audio/` and `Domain/Audio/AudioBuffer.swift`

## TDD Order (MANDATORY)

```
1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together
```

Never write implementation before the test. Never skip the RED step. Tests use Swift Testing framework (`@Suite`, `@Test`, `#expect`), NOT XCTest.

## Build & Test

```bash
swift build                    # debug build
swift build -c release         # release build
swift test                     # run all tests (1208 tests, ~4.4s)
swift test --filter SuiteName  # run specific test suite
```

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/THE RECORDDomain/          ← library: Foundation only
Sources/THE RECORDBusiness/        ← library: depends on Domain
Sources/THE RECORDInfrastructure/  ← library: depends on Domain + 3rd-party
Sources/THE RECORDPresentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

## Skills (Progressive Disclosure)

Skills are detailed instruction sets for each architectural layer. Read the relevant skill BEFORE writing code for that layer. Skills are in `.claude/skills/` but the content is universal — any agent can read them.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |
| Audio permissions | `~/.claude/skills/apple-audio-permissions/SKILL.md` |
| Swift best practices | `.claude/skills/swift-best-practices/SKILL.md` |
| Core Audio Tap debugging | `.claude/skills/coreaudio-tap-troubleshooting/SKILL.md` |

## Current Audio Capture Stack

THE RECORD uses **Core Audio Taps** (`CATapDescription` + `AudioHardwareCreateProcessTap`), NOT ScreenCaptureKit:

- Permission: "System Audio Recording Only" (lighter tier, no screen sharing indicator)
- Process targeting: `tapDesc.bundleIDs` (macOS 26+) for per-app audio capture
- Reading: `AudioDeviceCreateIOProcIDWithBlock` + `AudioDeviceStart` (NOT AVAudioEngine)
- See `AUDIO-TAP-FIX-PLAN.md` for full implementation details and gotchas

## Canonical Decisions (override older docs)

| Decision | Current | Old (ignore) |
|----------|---------|-------------|
| Audio capture | Core Audio Taps (`CATapDescription`) | ScreenCaptureKit |
| macOS target | macOS 26+ only | macOS 15+ |
| Observation | `@Observable` | `ObservableObject` |
| Calendar integration | EventKit (primary) + MCP servers (extension) | Provider-specific OAuth |
| Extension model | MCP servers via `GenericMCPProvider` | Built-in provider plugins |
| Summarization | MLX GPU (Llama 3.1 8B, exploring Gemma 4) | ANE |

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work.

Architecture docs (read only when working on that layer):
- `docs/architecture/DOMAIN-LAYER.md`
- `docs/architecture/BUSINESS-LAYER.md`
- `docs/architecture/INFRASTRUCTURE-LAYER.md`
- `docs/architecture/PRESENTATION-LAYER.md`
- `docs/architecture/PLUGIN-ARCHITECTURE.md`

## Open Issues

See `ISSUES.md` for the full BM-### register. Key P0s:
- Audio capture: Core Audio Tap IOProc integration (see `AUDIO-TAP-FIX-PLAN.md`)
- `BM-051`: DuckDB lock → fatalError (should show alert)
- `BM-052`: Screen Recording error mapping fixed, System Audio error mapping in progress

## For Subagent Prompts

When spawning agents for parallel work, include:
- The skill file path to read for their layer
- SPEC and PLAN file paths for the current epic
- `Swift 6.2, macOS 26+, -strict-concurrency=complete`
- File size limits per layer (see table above)
- TDD discipline: RED test first, then GREEN implementation

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **the-record** (5454 symbols, 52742 relationships, 239 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/the-record/context` | Codebase overview, check index freshness |
| `gitnexus://repo/the-record/clusters` | All functional areas |
| `gitnexus://repo/the-record/processes` | All execution flows |
| `gitnexus://repo/the-record/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# DATUM Enforcement
This repository uses DATUM for all workflows. You must use the `/datum` skill commands (like `/datum go`, `/datum express`) for any feature work or fixes.

## Information Gathering Phase (Non-Pushy Rule)
If the human is simply gathering information, asking questions, or exploring the codebase, DO NOT be pushy about moving to development, committing code, or starting a sprint. Wait for the user's explicit lead before writing code or suggesting we start building. Be a patient architectural partner.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan-gemini/CLAUDE.md
# =========================================

# THE RECORD

Local-first macOS meeting transcription app. Swift 6.2, Clean Architecture, TDD.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, and next action.

## Orchestration

This file is the conductor. Epics execute in dependency order:

```
COMPLETED                                    REMAINING
─────────                                    ─────────
Epic 1: Core Recording ─┐
Epic 1.5: Capture Fixes  ├──→ Epic 3.5: Parakeet + Telemetry (no UI)
Epic 3: Transcription    │
Epic 4: Diarization     ─┘──→ Epic 5: Menu Bar UI (needs desk)
Epic 2: Storage         ─┘──→ Epic 6: Summarization (MLX/GPU)
                              Epic 7: Streaming + Translation
                              Epic 8: THE RECORD Engine (MCP + NLP)
```

Each epic follows 5 phases: **REFINE** (SPEC) → **PLAN** (TASKS.md) → **PROPERTIES** (formal properties) → **ACT** (code) → **VALIDATE** (integration).
Human checkpoint after PLAN and before ACT. Within ACT, layers build sequentially: Domain → Business → Infrastructure → Presentation.

PROPERTIES.md (template at `docs/planning/PROPERTIES-TEMPLATE.md`) captures 11 property categories:
FUNCTIONAL, SAFETY, LIVENESS, PERFORMANCE, SECURITY, RELIABILITY, CONCURRENCY, OBSERVABILITY, UX, DATA INTEGRITY, PRIVACY.
Each property drives test generation (RED briefs) and reviewer validation (traceability matrix).

## Skills (Progressive Disclosure)

Read the skill file when entering that phase. Don't load all skills upfront.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |
| Pre-merge bug hunt | `.claude/skills/therecord-bug-hunt/SKILL.md` |

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

**Boundaries enforced by hooks:**
- Domain: only `import Foundation`
- Business: Domain + Foundation + OSLog
- Infrastructure: implements Domain protocols, translates all external errors to domain errors
- Presentation: Business + Domain + SwiftUI

**Also enforced by hooks:**
- File size limits: Domain 100, Business 300, Infrastructure 300, ViewModels 200, Views 150
- No `@unchecked Sendable` outside Infrastructure/Audio and Domain/Audio/AudioBuffer
- TDD guard: warns if writing source without corresponding test file

## Integration Test Environment Variables

```bash
# Enable integration tests (real WhisperKit, DuckDB, FluidAudio inference)
RUN_INTEGRATION_TESTS=1 python3 scripts/test.py --filter "SomeSuite" --no-parallel

# Enable MLX summarization tests (requires app bundle context for metallib — see #80, #81)
RUN_INTEGRATION_TESTS=1 RUN_MLX_TESTS=1 python3 scripts/test.py --filter "SummarizationModelComparison" --no-parallel
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUN_INTEGRATION_TESTS` | unset (skipped) | Enables real-hardware integration suites: WhisperKit, DuckDB, FluidAudio, pipeline |
| `RUN_MLX_TESTS` | unset (skipped) | Enables MLX summarization tests. Requires metallib accessible from bundle (blocked until #81 lands) |

Use `--no-parallel` for integration tests to prevent `swift test --parallel` from buffering stdout during long-running inference.

## TDD Order

1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together

## Rename / Refactor Protocol

**Before any rename swarm, run GitNexus impact analysis to get the complete caller map:**

```
gitnexus_impact({ target: "methodName", direction: "upstream", file_path: "path/to/file.swift", includeTests: true })
```

Pass the full `byDepth.1` list to each rename agent — no grepping, no missed call sites.

**After the swarm, reindex and verify zero orphans:**

```bash
node ~/.npm/_npx/32f98f05d98eef45/node_modules/gitnexus/dist/cli/index.js analyze --force
```

Then run:
```
gitnexus_cypher("MATCH (a)-[{type:'CALLS'}]->(b) WHERE b.name = 'oldName' RETURN a.name, a.filePath")
```

Any remaining hits = confirmed orphaned calls. The DuckDB `.execute()` SQL calls are false positives — filter by `filePath NOT CONTAINS 'DuckDB'` if needed.

## Subagent Briefing

When spawning agents for parallel work, include in the prompt:
- The skill file path to read
- SPEC and PLAN file paths for the current epic
- `Swift 6.2 -strict-concurrency=complete`, file size limits, TDD discipline
- context7 MCP access: `mcp__context7__resolve-library-id` then `mcp__context7__query-docs`

## Canonical Decisions (override older docs)

Some architecture docs predate the SPEC-EPIC1 v2.0 research enrichment. When in conflict:
- **Audio capture:** ScreenCaptureKit (NOT CATapDescription). SPEC-EPIC1.md is authoritative.
- **Project name:** THE RECORD (not "Meeting Transcriber Pro"). Some planning docs use the old name.
- **Observation:** @Observable (NOT ObservableObject). macOS 15+ only.

## Single Source of Truth — Canonical Defaults

**Never hardcode a value that already has a named canonical source.** Reference the source directly so changes propagate automatically.

| Value | Canonical source | Wrong |
|-------|-----------------|-------|
| Default UI theme | `UITheme.default` (= `.broadsheet`) | `.broadsheet` inline |
| Default privacy mode | `PrivacyMode.default` (= `.meetings`) | `.meetings` inline |
| Default meeting type | `SummaryConfig.default.meetingType` (= `.oneOnOne`) | `.oneOnOne` inline |
| Ready status message | `MenuBarViewModel.readyStatus` (= `"Ready"`) | `"Ready"` inline |
| Time format | `TimeInterval.mmss` extension | `String(format: "%d:%02d", ...)` inline |

In **tests**: reference canonical sources so tests stay correct when defaults change:
```swift
// WRONG — breaks if UITheme.default changes
#expect(AppConfig.default.uiTheme == .broadsheet)

// CORRECT
#expect(AppConfig.default.uiTheme == UITheme.default)
```

Detection signal: the same string or value in 3+ places is an SSOT violation.

## Newspaper Sections — Design Constraint

THE RECORD's long-term direction is a full newspaper with extensible, plugin-backed sections (see Horizon in ROADMAP.md). Keep this in mind when building new features so the eventual shoehorn is trivial:

**Rule 1 — Don't add cases to `BroadsheetSidebarItem`.**
Any new navigable section that would add a `case` to that enum must instead use the open-ended `case section(String)` pattern (same as `folder` and `person`). This keeps the switch small and makes the `SectionRegistry` migration a type-lift, not a refactor.

**Rule 2 — Section views own a narrow dependency, not all of `BroadsheetAppState`.**
When building a new section view (The Brief, Commitments, Intelligence, etc.), pass it a focused use case or repository slice — not the whole app state. The future `NewsSection.body(appState:)` seam should be naturally narrow because the view was already written that way.

**Rule 3 — New meeting-detail tabs follow `BroadsheetTab` pattern.**
Don't embed tab logic directly in the detail switch. New tabs go into `BroadsheetTab` enum as a named case so they can later be driven by a registered section.

## Agent Coding Patterns

### Asymmetric try? Fix

When fixing a `try?` that silently swallows errors in a type, audit ALL sibling `try?` calls in the same file before moving on. Silent error loss clusters — fixing one and missing another in the same type is a recurring agent failure pattern.

**Rule**: grep the file for `try?` after fixing any one instance. Fix all of them in the same commit.

### Never try? on Task.sleep in Task Loop Bodies

`try? await Task.sleep(...)` inside a `while !Task.isCancelled` loop swallows `CancellationError` and delays task exit by up to the full sleep duration. This is a responsiveness bug.

**Rule**: In Task loop bodies, always `try await Task.sleep(...)` and let `CancellationError` propagate. The `while` loop exits naturally on throw. Never `try?` a sleep that should respond to cancellation.

### Never nonisolated(unsafe) on NSFormatter Subclasses

`DateFormatter` and `ISO8601DateFormatter` are `NSFormatter` subclasses that mutate internal locale and timezone caches on every format call. They are **not thread-safe**. `nonisolated(unsafe)` silences Swift 6 without providing mutual exclusion — concurrent callers race on the internal cache.

**Rule**: Never use `nonisolated(unsafe) static let` for `DateFormatter` or `ISO8601DateFormatter`. Instead:
- For parsing: `Date(string, strategy: .iso8601.year().month().day())` — stateless, `Sendable`
- For formatting: `date.formatted(.iso8601)` or `date.formatted(style:)` — value types, `Sendable`
- If you need a specific locale/format: use `FormatStyle` or isolate the formatter to `@MainActor`

### SpeakerID Sentinel Strings Must Be Static Constants

Magic `SpeakerID("Unknown")` and `SpeakerID("Speaker 1")` strings scattered across the codebase violate SSOT and can drift silently.

**Rule**: All sentinel/default `SpeakerID` values must be `public static let` constants on `SpeakerID.swift` (e.g. `.unknown`, `.singleSpeaker`). Never construct sentinel IDs inline from string literals outside `SpeakerID.swift`.

### C Library Init: Always Guard and Log Nil

When an actor's `init` calls C library init functions (Speex, CoreAudio, AVAudio, etc.) that return optional pointers, never silently proceed with nil state.

**Rule**: After every C init call in a Swift actor init, guard the returned optional:
```swift
if cState == nil {
    logger.error("C lib init failed — actor will operate in degraded/pass-through mode")
}
```
Longer-term: use a static factory (`Actor.make(...) throws`) so init failure is visible at the call site. Never let nil state produce silent behavioral degradation.

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work
(actor re-entrancy, @unchecked Sendable, parallel test conflicts, diagnostic methodology).

These docs exist but don't read them unless working on that layer:
- `docs/architecture/DOMAIN-LAYER.md` (1681 lines)
- `docs/architecture/BUSINESS-LAYER.md` (1377 lines)
- `docs/architecture/INFRASTRUCTURE-LAYER.md` (1954 lines)
- `docs/architecture/PRESENTATION-LAYER.md` (2045 lines)
- `docs/architecture/PLUGIN-ARCHITECTURE.md` (2367 lines)
- `docs/planning/DEVELOPMENT-PLAN.md` (1239 lines)

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/Domain/          ← library: Foundation only
Sources/Business/        ← library: depends on Domain
Sources/Infrastructure/  ← library: depends on Domain + 3rd-party
Sources/Presentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **the-record** (5454 symbols, 52742 relationships, 239 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/the-record/context` | Codebase overview, check index freshness |
| `gitnexus://repo/the-record/clusters` | All functional areas |
| `gitnexus://repo/the-record/processes` | All execution flows |
| `gitnexus://repo/the-record/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan/.temp/cast-src/Tests/CLAUDE.md
# =========================================

# Tests

All targets use [Swift Testing](https://developer.apple.com/documentation/testing) (`@Test`, `@Suite`, `#expect`), not XCTest. Run with `swift test` (or `swift test --filter <TargetName>` for a focused subset).

## Test targets

- `CastTests/` — main library tests: API shape, schema generation, property wrappers, validators, prompt engine, JSON repair, classification, error types.
- `CastMacroTests/` — `@Castable` macro expansion tests via `assertMacroExpansion`. Pure compile-time, no runtime dependencies.
- `MLXStructuredTests/` — vendored test suite for the grammar matcher / structural tag / generation paths. Many of these touch MLX runtime.

## CI vs local: the `.requiresMetal` trait

GitHub-hosted `macos-15` runners can't load `default.metallib`, so any test that triggers MLX runtime crashes the test process. The project defines a Swift Testing trait that **skips** affected tests when `CI=true`:

```swift
@Test("Llama loads", .requiresMetal)
func loadsModel() async throws { … }
```

Definitions live in:
- `Tests/CastTests/TestHelpers.swift`
- `Tests/MLXStructuredTests/TestHelpers.swift`

(Each test target needs its own copy; Swift Testing traits aren't transparently shared across targets.)

**Apply `.requiresMetal` only to tests that actually invoke MLX.** Macro tests, schema generation, property-wrapper introspection, validator logic, prompt-template assembly, JSON-repair logic, classification logic, configuration types — none of these need Metal. Tagging them would silently shrink CI coverage. When in doubt: write the test without the trait, run `CI=true swift test`, and only add the trait if it crashes with a metallib error.

Local development on Apple Silicon runs every test (the env var isn't set), so you don't lose coverage when shipping.

## Conventions

- One `@Suite` per concept (`@Suite("Classify")`, `@Suite("PromptEngine")`); flat `@Test` functions inside.
- Test names read as English sentences: `func stringEnumCastSchemaProviding()` → "String CastEnum conforms to CastSchemaProviding".
- Performance tests use `@Test` with timing assertions, not `XCTMeasure`. Tagging them `.requiresMetal` is usually correct since they exercise model loading.
- Async tests use `async throws`; `#expect(throws: ...)` for expected error paths.
- Helpers (test fixtures, custom traits) live in `TestHelpers.swift` per target — keep one file per target rather than splitting into many.

## Running

```bash
swift test                          # all tests, locally (Metal available)
CI=true swift test                  # mimic CI: MLX-runtime tests skip
swift test --filter CastMacroTests  # macros only
swift test --filter MLXStructured   # vendored grammar/matcher tests
```

For test-writing patterns and TDD workflow, see `.claude/agents/swift-test-writer.md` and `.claude/rules/testing.md`.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan/.temp/cast-src/Examples/CLAUDE.md
# =========================================

# Examples

Runnable demonstrations of Cast's public API. Each example is a self-contained Swift executable that builds against the parent package.

## Structure

```
Examples/
  Package.swift                           # references parent via .package(path: "..")
  Sources/
    HelloCast/main.swift                  # one example per directory
    PropertyWrappersTour/main.swift
    NestedTypes/main.swift
    …
```

`Package.swift` declares each example as an `executableTarget`; building `Examples/` runs `swift build` against all of them simultaneously.

## Adding a new example

1. **Create `Sources/<Name>/main.swift`.** First line *must* be a single-line comment in this exact form:
   ```swift
   // What this shows: <one-sentence description>
   ```
   This becomes the DocC article description (see "DocC mirroring" below).
2. **Register the executable** in `Examples/Package.swift` under `targets:`:
   ```swift
   .executableTarget(name: "<Name>", dependencies: ["Cast"], path: "Sources/<Name>")
   ```
3. **Add a DocC topic entry** in `Sources/Cast/Cast.docc/Cast.md` under `## Topics` → `### Examples`:
   ```markdown
   - <doc:<Name>>
   ```
4. **Build to verify**: `cd Examples && swift build`. CI will do the same on push to `stage` (path-filtered to `Sources/Cast/**` or `Examples/**`).

The corresponding `Cast.docc/Examples/<Name>.md` article is **auto-generated** — don't write it by hand; the script overwrites it.

## DocC mirroring

`scripts/generate-example-docs.sh` reads each `Examples/Sources/<Name>/main.swift`, takes the first-line `// What this shows:` comment as the article description, and writes `Sources/Cast/Cast.docc/Examples/<Name>.md` with the source rendered as a Swift code block.

CI (`.github/workflows/docs.yml`) regenerates these articles before building DocC, so committed `.md` files can drift from source — but the *published* site never does. If you only edit `main.swift`, run the script locally to see the rendered article; otherwise a stale committed `.md` will look wrong locally but be correct online.

```bash
./scripts/generate-example-docs.sh
```

## CI behavior

- `examples.yml` builds (no run) on push to `stage` and on PRs to `stage`, path-filtered to `Sources/Cast/**`, `Examples/**`, and the workflow file itself.
- `docs.yml` regenerates articles + builds DocC + deploys to GitHub Pages on push to `main`.
- Examples are never *executed* in CI — they typically need a downloaded LLM model, which is too heavy + slow.

## Don'ts

- Don't depend on `Sources/MLXStructured` directly from an example — the public API surface is `import Cast`. Examples are also documentation; reaching past the public layer would mislead users.
- Don't commit a generated `Cast.docc/Examples/<Name>.md` divergent from `main.swift` and assume CI will fix it — it does, but local DocC preview won't until you re-run the script.
- Don't add examples that require interactive input (stdin prompts, file picks, etc.) — they break the "build only, no run" CI assumption and confuse readers.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan/.temp/cast-src/Sources/MLXStructured/CLAUDE.md
# =========================================

# Sources/MLXStructured

Vendored from [petrukha-ivan/mlx-swift-structured](https://github.com/petrukha-ivan/mlx-swift-structured), Apache-2.0. The `LICENSE` file in this directory is the upstream's, kept verbatim for attribution. Cast itself is also Apache-2.0 — same license, no segmentation.

## Don't modify casually

The default stance is **don't touch these files**. The reason this code is vendored (rather than pulled as an SPM dependency) is to keep the binding stable while we shape Cast's public API; we expect to merge upstream changes back in periodically.

If you must modify a file:
- Leave the existing header intact (`// Created by Ivan Petrukha on …`).
- Add a one-line marker near the top: `// Modifications: <description> by <author>, <year>`. This is required by Apache-2.0 §4(b) when redistributing modified files.
- Keep modifications surgical — wider refactors should land upstream first, then sync down.

## Folder map

- `Backends/` — adapters between MLX arrays and the underlying grammar engine. `XGrammar.swift` is the bridge to `Sources/CMLXStructured/`.
- `Grammar/` — `Grammar`, `Grammar+Schema.swift`, `Grammar+Structural.swift`, `Grammar+Encoding.swift`. Pure-Swift grammar representation independent of the matching engine.
- `Structural/` — `StructuralTag` and its builder for the structural-output pattern.
- `GrammarMatcher.swift`, `GrammarMatcherFactory.swift`, `GrammarMaskedLogitProcessor.swift` — the runtime path: factory builds a matcher from a tokenizer + grammar, the processor masks invalid tokens during MLX generation.
- `Generate.swift` — the entry point that ties matcher + processor + MLX's `generate()` together.

## SPM gotcha

`LICENSE` in this directory must be in the `MLXStructured` target's `exclude:` list in the root `Package.swift`. Otherwise SPM emits "found 1 file(s) which are unhandled". Don't add other unhandled files here without also excluding them.

## Updating from upstream

Rough procedure (no automation today):
1. Fetch upstream: `git fetch https://github.com/petrukha-ivan/mlx-swift-structured main`.
2. Diff against local: `git diff FETCH_HEAD -- Sources/MLXStructured/`. Review every change.
3. Apply only the bits you want, preserving any local `// Modifications:` markers.
4. Bump the upstream commit SHA in the root `NOTICE` file.
5. Run `swift test` locally (where Metal works) to verify nothing broke.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan/.temp/cast-src/Sources/CastMacros/CLAUDE.md
# =========================================

# Sources/CastMacros

Compiler plugin target for the `@Castable` macro. Runs at **build time** inside the Swift compiler — not at runtime.

## Files

- `CastMacroPlugin.swift` — plugin entry point. Registers macros so the compiler can find them. Add new macros to this list.
- `CastableMacro.swift` — main `@Castable` implementation. Reads the annotated struct's stored properties + their property-wrapper attributes and emits the JSON Schema + grammar skeleton.

## Macro patterns

- Receive a `MacroExpansionContext` and `AttributeSyntax` / `DeclSyntax` node from SwiftSyntax. Walk the AST to extract what you need.
- Emit code as `DeclSyntax(stringLiteral: ...)` — Swift parses the string back into syntax for you.
- Diagnose problems with `context.diagnose(...)` rather than throwing or silently failing. Diagnostics show up in Xcode and `swift build` output and let users fix issues at the point of macro use.
- For `@Castable`: read property wrappers (`@MaxLength`, `@Range`, `@Description`) by walking attribute lists on each `VariableDeclSyntax`. The wrapper drives the schema — wrappers without a matching code-gen path will silently no-op, so add them deliberately.

## Testing macros

Tests live in `Tests/CastMacroTests/`. Use `swift-syntax`'s `assertMacroExpansion` to compare expected vs actual expansion as text. The test framework runs macros in-process, so:
- Test failures often show as a textual diff — read the diff carefully; subtle whitespace and trailing-comma differences trip people up.
- If the macro emits diagnostics, the test asserts on those too (file/line/severity/message).
- Tests run as part of the regular `swift test` and pass on CI (they don't need MLX runtime — pure compile-time work).

## Cross-references

- The grammar that this macro emits is consumed by `Sources/Cast/Schema/` at runtime to build a `GrammarMatcher`.
- For SwiftSyntax patterns or build-tooling questions, see `.claude/rules/macro-development.md` and `build-tooling.md`.

## Don'ts

- Don't add runtime dependencies here — this target is a compiler plugin and ships *only* at build time. Anything heavy belongs in `Sources/Cast/`.
- Don't fork SwiftSyntax behavior; if you need a new helper, add it to a small extension here rather than reaching across targets.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan/.temp/cast-src/CLAUDE.md
# =========================================

# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Cast is a Swift Package that enables type-safe structured output from any local LLM on Apple Silicon via constrained decoding. It uses MLX Swift for inference and Swift macros for compile-time grammar generation. Think `as?` for LLMs.

Repository: `github.com/jaylann/Cast`
License: Apache-2.0
Author: Justin Lanfermann

## Code Standards

Detailed rules live in `.claude/rules/`. Key principles:
- **Swift**: Value types by default, avoid force unwraps/tries/casts. See `swift6.md`, `concurrency.md`.
- **Style**: SwiftFormat + SwiftLint run automatically via PostToolUse hooks. Comments explain WHY not WHAT. See `documentation.md`.
- **Naming**: Engine, Processor, Builder, Cache, Provider, Compiler suffixes. Protocols use `-ing` suffix. See `naming-conventions.md`.
- **Testing**: Swift Testing framework, `swift test`. See `testing.md`.
- **MLX Safety**: GPU ops guidance for library consumers. See `mlx-safety.md`.
- **Parallel Work**: Consider subagents/teams for non-trivial tasks. See `parallel-work.md`.
- **Apple APIs**: Always verify with AppleDocs + web search before using. See `apple-api-verification.md`.
- **Macros**: SwiftSyntax patterns, testing macros. See `macro-development.md`.
- **Release**: Staged workflow — PRs target `stage`, `main` is release-only, semver tags via `release.yml`. See `release-workflow.md`.
- **PR conventions**: Every PR needs exactly one `type:*` label and at least one `area:*` label; milestone if it closes a milestoned issue. CI gate (`pr-conventions.yml`) hard-fails otherwise. See `pr-conventions.md`.
- **ADRs**: Write `docs/decisions/NNNN-*.md` for complex decisions before committing. See `documentation.md`.

## Pre-Commit Workflow

Use `/commit` which runs these steps in order:
1. `/simplify` on changed files
2. Revise CLAUDE.md with learnings
3. Run tests (`swift test`) — skip if changes don't affect testable code
4. Stage only your changes, commit with concise message

Never skip steps. Never commit with failing tests.

## Team Workflow

**Always consider parallelism** for non-trivial tasks. See `.claude/rules/parallel-work.md`.

When running teammates (subagents via Task tool):
- **Before committing**: Each teammate MUST run `/claude-md-management:revise-claude-md`
- **Before terminating**: Each teammate MUST run `/claude-md-management:revise-claude-md`

## Self-Documentation

When you discover or create something useful:
- Append one-line learnings to `## Learnings` below
- Add focused rules to `.claude/rules/` for topic-specific guidance
- See `documentation.md` for ADR and feature doc patterns

## Build and Development Commands

See `build-tooling.md` for full details. Quick reference:
```bash
swift build                    # Build the package
swift test                     # Run all tests
swift test --filter CastTests  # Run specific test target
swift test --filter CastMacroTests  # Run macro tests
swift package resolve          # Resolve dependencies
swift package clean            # Clean build artifacts
```

## Architecture Overview

Cast follows a **6-layer architecture** with **protocol-based dependency injection**:

### Layer 1 — Developer API (`Sources/Cast/API/`)
The only layer developers interact with. `@Castable` macro, property wrappers (`@MaxLength`, `@Range`, etc.), `CastModel`, generation methods (`.cast()`, `.classify()`, `.extract()`).

### Layer 2 — Prompt Engine (`Sources/Cast/Prompt/`)
Auto-constructs prompts from schema + annotations. Handles chat templates per model family (Llama, Qwen, Mistral, etc.).

### Layer 3 — Grammar Compiler (`Sources/CastMacros/`)
Runs at build time inside Swift macro. Converts annotated struct into deterministic grammar. Outputs static state machine skeleton on the type.

### Layer 4 — Tokenizer Linker (`Sources/Cast/Tokenizer/`)
Runtime one-time binding per (model, type) pair. Maps grammar states to concrete token IDs. Cached aggressively.

### Layer 5 — Constrained Sampler (`Sources/Cast/Sampler/`)
Custom LogitsProcessor for MLX Swift's generate(). Reads grammar state, masks invalid tokens, samples only valid continuations.

### Layer 6 — MLX Swift (external dependency)
Model loading, inference, token generation. Cast composes with it, never forks.

## Package Structure

```
Sources/
  Cast/                    # Main library target
    API/                   # Public-facing types: CastModel, property wrappers
    Prompt/                # Prompt construction engine
    Tokenizer/             # Tokenizer-grammar binding and caching
    Sampler/               # Constrained LogitsProcessor
    Schema/                # JSON Schema generation, grammar rules
  CastMacros/              # Macro target (compiler plugin)
    CastMacroPlugin.swift  # Plugin entry point
    CastableMacro.swift    # @Castable macro implementation
Tests/
  CastTests/               # Library tests
  CastMacroTests/          # Macro expansion tests
docs/
  decisions/               # Architecture Decision Records
```

## Learnings
<!-- Append discovered patterns, gotchas, and project-specific knowledge below -->
- `swift build`/`swift test` inside the Claude Code sandbox fails with `sandbox-exec: sandbox_apply: Operation not permitted` / `Invalid manifest` — SwiftPM compiles `Package.swift` under its own nested `sandbox-exec`, which the outer sandbox blocks. Run with `dangerouslyDisableSandbox: true` (Bash tool flag). This is the recurring failure mode for SPM-based subagents working in `$TMPDIR/Cast-worktrees/<name>/`.
- `@Castable` consumers need `import Cast` **plus** `import Collections` and `import JSONSchema` — the macro expansion references `JSONSchema` and `OrderedDictionary` directly and the library does not `@_exported`-re-export them.
- Runnable examples live in `Examples/` (own `Package.swift`, `.package(path: "..")`); each is `Examples/Sources/<Name>/main.swift`, registered as an `executableTarget`. CI is `.github/workflows/examples.yml` — `swift build` only, no auto-run.
- DocC site lives at `Sources/Cast/Cast.docc/`. Each `Examples/Sources/<Name>/main.swift` is mirrored to a `Cast.docc/Examples/<Name>.md` article via `scripts/generate-example-docs.sh`; CI (`.github/workflows/docs.yml`) regenerates before building, so committed articles can drift but the published site never does. When adding a new example, also add a `<doc:Name>` entry under `## Topics > Examples` in `Cast.docc/Cast.md`.
- Default branch is `stage`, not `main`. PRs target `stage`. `main` is release-only and updated exclusively by `.github/workflows/release.yml` (workflow_dispatch, semver input, fast-forwards `stage`→`main`, tags `vX.Y.Z`, creates GitHub Release). See `.claude/rules/release-workflow.md` (see docs/decisions/0004-staged-release-model.md).
- License is **Apache-2.0 unified** across the package. `LICENSE` (root) + `NOTICE` credits the two vendored upstreams (`petrukha-ivan/mlx-swift-structured` → `Sources/MLXStructured/`, `mlc-ai/xgrammar` submodule → `Sources/CMLXStructured/xgrammar/`). Both upstreams are also Apache-2.0; their LICENSE is preserved in-tree. Don't relicense; don't add GPL/LGPL/AGPL vendored code without explicit decision. (see docs/decisions/0002-license-unification.md)
- `Sources/MLXStructured/LICENSE` must be in the `MLXStructured` target's `exclude:` list in `Package.swift` — SPM otherwise emits an "unhandled file" warning. (see docs/decisions/0002-license-unification.md)
- CI (`macos-15`) cannot run MLX runtime tests — `swift test` exits with `MLX error: Failed to load the default metallib`. Tests that invoke MLX use the `.requiresMetal` Swift Testing trait (in `Tests/CastTests/TestHelpers.swift` and `Tests/MLXStructuredTests/TestHelpers.swift`) which skips when `CI=true`. Macro/schema/property-wrapper/validator/prompt-engine/JSON-repair tests do NOT need this gate. See issue #75. (see docs/decisions/0005-requires-metal-test-trait.md)
- `scripts/pre-public-check.sh` is the safety scanner used before any visibility change, history rewrite, or accepting CI-touching contributions. Exit `0` = safe; `1` = findings.
- Repo is **public** at `https://github.com/jaylann/Cast`. Standard `macos-15` runners are free with no minute cap on public repos. Never switch workflows to `macos-15-large` / `-xlarge` — those "larger runners" are billed even on public repos.
- `.claude/` is **selectively** gitignored: only `settings.local.json`, `worktrees/`, and `.credentials.json` are excluded. Everything else under `.claude/` (`rules/`, `agents/`, `skills/`, `hooks/`, baseline `settings.json`) ships with the repo so contributors using Claude Code get instant onboarding. Per-developer permissions/MCP-server choices live in `settings.local.json` (still local).
- `MLXModelContainer.perform { context in ... }` closure is `@Sendable` — captured `var`s from the enclosing scope can't be mutated inside (Swift 6 concurrency error). To surface in-flight state out of the closure (e.g. last buffer for `CastError.cancelled(partialOutput:)` recovery), wrap it in a small `final class ... : @unchecked Sendable` lock-protected holder. Closure return value is cleaner when state only needs to flow on the success path.
- Parallel-PR git worktrees can't live in `../Cast.worktrees/` — the Claude Code sandbox only allows writes inside the repo (`.`) or `$TMPDIR`. Use `$TMPDIR/Cast-worktrees/<name>` (e.g. `/tmp/claude-501/Cast-worktrees/streaming`) and `git worktree add -b feat/<x> "$TMPDIR/Cast-worktrees/<name>" stage`. They're ephemeral but survive long enough to push branches and open PRs. After `worktree add`, run `git submodule update --init --recursive` from inside the worktree before `swift build`/`swift test` — Cast vendors `Sources/CMLXStructured/xgrammar` as a submodule, which `git worktree add` does NOT initialize, and SPM fails to resolve `CMLXStructured` without it.
- New `CastModel+*` extensions whose signatures use `GenerateDisposition` need `@preconcurrency import MLXLMCommon` — the type lives in `MLXLMCommon`, not `MLXStructured` (`MLXStructured.generate` *takes* it but doesn't define it). `CastModel+Generation.swift` is the canonical reference for the import set.
- `@Castable`'s `@attached(member, names:)` declaration in `Sources/CastMacros/CastableMacro.swift` must list every synthesized name explicitly (`named(castSchema)`, `named(init)`, `named(PartiallyGenerated)`, …). Adding a new member without updating this list **silently fails** — the macro emits the decl but the compiler hides it from consumers. If a synthesized type/method works in macro-expansion tests but isn't visible from `Sources/Cast/`, this is the first place to look.
- The `CastTests` test target gained `JSONSchema` + `Collections` dependencies in `Package.swift` once tests started using `@Castable` — every `@Castable` consumer (library code OR tests) needs both. Add the products to the test-target's `dependencies:` when introducing the first `@Castable` test in a new test target.
- `Examples/Package.swift` uses `.package(path: "..")`, and SPM derives the path-package identifier from the **parent directory name** — not the `name:` field in the parent's `Package.swift`. Building `Examples/` from a git worktree whose dir is anything other than `Cast` (e.g. `$TMPDIR/Cast-worktrees/<feature>`) fails with `unknown package 'Cast'` for every target. CI is unaffected (it checks out into `Cast/`); for local Examples builds in a worktree, build inside the main `Cast/` checkout instead.
- Canonical label taxonomy is `type:*` / `area:*` / `priority:*` (see `.claude/rules/pr-conventions.md`). The legacy flat labels (`api`, `macro`, `prompt`, `safety`, `infra`, `schema`, `constraints`, `testing`, `performance`, `tooling`, `compat`, `examples`, `docs`) and `phase-0..3` were retired on 2026-04-30 — milestones replaced phase labels. Every PR needs ≥1 `type:` and ≥1 `area:`; CI gate `pr-conventions.yml` enforces this and skips Dependabot.
- `.github/workflows/claude.yml` and `claude-code-review.yml` were removed on 2026-04-30: the Claude Code GitHub App (https://github.com/apps/claude) wasn't installed on the repo, so every `claude-review` run failed `401 Unauthorized` on app-token exchange. Re-add the workflows only after installing the App.
- Chat templates are owned by MLXLMCommon's `processor.prepare(input:)`. Cast hands a flat `"\(system)\n\n\(prompt)"` string. Verified in Qwen-2.5/Llama-3.2/Mistral-v0.3/Phi-3.5/Gemma-2 via `Tests/CastTests/ChatTemplateTests.swift`; ADR `docs/decisions/0001-chat-template-handling.md`.
- GitHub PR review threads stay `isResolved: false` even after the fix commit lands — they don't auto-close on a follow-up push. When delegating "fix review feedback" work, the agent must explicitly resolve each addressed thread via the GraphQL `resolveReviewThread` mutation (`gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<id>"}) { thread { isResolved } } }'`). Get thread IDs with `pullRequest(number: N).reviewThreads`. Leave deferred-to-follow-up threads open and link the new issue in a reply.
- Repo merge policy is **squash-only** (set 2026-04-30 via `gh api -X PATCH repos/jaylann/Cast`): `allow_merge_commit=false`, `allow_rebase_merge=false`, `allow_squash_merge=true`. `gh pr merge --merge` / `--rebase` will fail; use `--squash` or no flag.
- `CastableDiagnostic` (`Sources/CastMacros/CastableDiagnostic.swift`) supports per-case `severity`. The early-return guard in `CastableMacro.expansion` MUST filter on `severity == .error` (not `diagnostics.isEmpty`) — otherwise adding a `.warning` case silently blocks all macro expansion for any consumer that triggers the warning. Pattern: `let hasError = diagnostics.contains { $0.0.severity == .error }; guard !hasError else { return [] }`. Test new warning cases by asserting both the `DiagnosticSpec(severity: .warning)` AND the full `expandedSource` to confirm expansion still produced members.
- A `private typealias` at file scope cannot appear in the parameter type of a non-private `init` (or any non-private decl) — Swift errors with `initializer must be declared fileprivate because its parameter uses a private type`. Workaround: keep the `private typealias` for the actor's stored property (where it stays internal) but desugar the type inline at the `init` signature (e.g. `init(loader: @escaping @Sendable (ModelConfiguration) async throws -> TokenizerArtifacts = ...)`). Alternative — make the typealias `internal` (drop `private`) — defeats the point of the access annotation. Hit while resolving #110 review on `GrammarProcessorCache.swift`.
- `gh api graphql -f query='...'` substitutes `$variables` directly into the query string. Replies whose body contains GraphQL-meaningful tokens (backticks, embedded quotes, `$word`) cause `Expected COLON, actual: IDENTIFIER` / `Expected VAR_SIGN` parse errors AND the resolve mutation in the same call still fires (so the thread gets resolved with no reply attached). Recover by `unresolveReviewThread`, then re-submit using `gh api graphql --input <file.json>` where the file is `{"query": "mutation($id: ID!, $body: String!) { ... }", "variables": {"id": "...", "body": "..."}}` — JSON variables bypass the gh argument parser entirely.
- A worktree can carry **already-rebased** local commits from a prior session: `git status` shows e.g. "9 and 2 different commits" while `git merge-base HEAD origin/stage` equals `git rev-parse HEAD~N` (where N is the PR's commit count). Verify before re-doing the rebase — check `git log --oneline origin/feat/<branch>..HEAD` and `git rev-parse HEAD~N` vs `origin/stage`. If the SHAs match the expected post-rebase shape and content inspection of the conflict files shows correct resolutions, just build/test/`--force-with-lease` push. Common after a previous Claude session ran the rebase but failed to push (e.g. ran out of context).
- `git rebase` against the Claude Code sandbox can wedge mid-replay: any commit that touches `.claude/skills/**` or `.claude/settings.json` fails with `unable to unlink old ...: Operation not permitted` because those paths are in the sandbox's `denyWithinAllow` list. `git rebase --abort` then also fails with `untracked working tree files would be overwritten`. Recovery: make any remaining commits manually on the detached HEAD, then `git update-ref refs/heads/<branch> HEAD && rm -rf .git/rebase-merge .git/rebase-apply && git checkout <branch>` to drop the rebase metadata cleanly. Or run the rebase up-front with `dangerouslyDisableSandbox: true` when you know commits will touch those paths.
- `import Hub` (from `huggingface/swift-transformers`) is **not** transitively re-exported through `MLXLMCommon`/`MLXStructured` — adding `HubApi` directly to a `Sources/Cast/` file requires `.product(name: "Hub", package: "swift-transformers")` on the `Cast` target in `Package.swift`. `Hub` is already in `MLXStructured`'s deps but downstream targets pulling in `Cast` don't see it without the explicit edge. Surfaced when adding `ModelSource.customEndpoint` (#101).


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/bodyMan/AGENTS.md
# =========================================

# THE RECORD — Agent Instructions

Local-first macOS 26+ meeting transcription app. Swift 6.2, Clean Architecture, TDD.

This file is the universal entry point for ALL AI coding agents (Claude Code, OpenCode, Codex, Cursor, Copilot, Aider, etc.). Tool-specific configs (`.claude/`, `.cursorrules`, `.opencode.yaml`) extend this — they don't replace it.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, next action, and session handoff state.

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

### Layer Import Rules (STRICT)

| Layer | Allowed Imports | File Limit |
|-------|----------------|------------|
| Domain | `Foundation` only | 100 lines |
| Business | Domain + Foundation + OSLog | 300 lines |
| Infrastructure | Domain + any framework (CoreAudio, DuckDB, WhisperKit, etc.) | 300 lines |
| Presentation | Domain + Business + SwiftUI | ViewModels: 200, Views: 150 |

Presentation NEVER imports Infrastructure directly. Business NEVER imports Infrastructure. Domain NEVER imports anything except Foundation.

### Key Patterns

- **Actors** for all shared mutable state (Swift 6.2 strict concurrency)
- **@MainActor** for Presentation layer (ViewModels and Views)
- **@Observable** for ViewModels (NOT ObservableObject — macOS 26+ only)
- **Protocol seams** between layers — Infrastructure implements Domain protocols
- **All external errors translated** to domain errors at the Infrastructure boundary
- **No `@unchecked Sendable`** except `Infrastructure/Audio/` and `Domain/Audio/AudioBuffer.swift`

## TDD Order (MANDATORY)

```
1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together
```

Never write implementation before the test. Never skip the RED step. Tests use Swift Testing framework (`@Suite`, `@Test`, `#expect`), NOT XCTest.

## Build & Test

```bash
swift build                    # debug build
swift build -c release         # release build
swift test                     # run all tests (1208 tests, ~4.4s)
swift test --filter SuiteName  # run specific test suite
```

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/THE RECORDDomain/          ← library: Foundation only
Sources/THE RECORDBusiness/        ← library: depends on Domain
Sources/THE RECORDInfrastructure/  ← library: depends on Domain + 3rd-party
Sources/THE RECORDPresentation/    ← library: depends on Domain + Business
Sources/THE RECORD/                ← executable: composition root (THE RECORDApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

## Skills (Progressive Disclosure)

Skills are detailed instruction sets for each architectural layer. Read the relevant skill BEFORE writing code for that layer. Skills are in `.claude/skills/` but the content is universal — any agent can read them.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |
| Audio permissions | `~/.claude/skills/apple-audio-permissions/SKILL.md` |
| Swift best practices | `.claude/skills/swift-best-practices/SKILL.md` |
| Core Audio Tap debugging | `.claude/skills/coreaudio-tap-troubleshooting/SKILL.md` |

## Current Audio Capture Stack

THE RECORD uses **Core Audio Taps** (`CATapDescription` + `AudioHardwareCreateProcessTap`), NOT ScreenCaptureKit:

- Permission: "System Audio Recording Only" (lighter tier, no screen sharing indicator)
- Process targeting: `tapDesc.bundleIDs` (macOS 26+) for per-app audio capture
- Reading: `AudioDeviceCreateIOProcIDWithBlock` + `AudioDeviceStart` (NOT AVAudioEngine)
- See `AUDIO-TAP-FIX-PLAN.md` for full implementation details and gotchas

## Canonical Decisions (override older docs)

| Decision | Current | Old (ignore) |
|----------|---------|-------------|
| Audio capture | Core Audio Taps (`CATapDescription`) | ScreenCaptureKit |
| macOS target | macOS 26+ only | macOS 15+ |
| Observation | `@Observable` | `ObservableObject` |
| Calendar integration | EventKit (primary) + MCP servers (extension) | Provider-specific OAuth |
| Extension model | MCP servers via `GenericMCPProvider` | Built-in provider plugins |
| Summarization | MLX GPU (Llama 3.1 8B, exploring Gemma 4) | ANE |

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work.

Architecture docs (read only when working on that layer):
- `docs/architecture/DOMAIN-LAYER.md`
- `docs/architecture/BUSINESS-LAYER.md`
- `docs/architecture/INFRASTRUCTURE-LAYER.md`
- `docs/architecture/PRESENTATION-LAYER.md`
- `docs/architecture/PLUGIN-ARCHITECTURE.md`

## Open Issues

See `ISSUES.md` for the full BM-### register. Key P0s:
- Audio capture: Core Audio Tap IOProc integration (see `AUDIO-TAP-FIX-PLAN.md`)
- `BM-051`: DuckDB lock → fatalError (should show alert)
- `BM-052`: Screen Recording error mapping fixed, System Audio error mapping in progress

## For Subagent Prompts

When spawning agents for parallel work, include:
- The skill file path to read for their layer
- SPEC and PLAN file paths for the current epic
- `Swift 6.2, macOS 26+, -strict-concurrency=complete`
- File size limits per layer (see table above)
- TDD discipline: RED test first, then GREEN implementation

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **the-record** (5454 symbols, 52742 relationships, 239 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/the-record/context` | Codebase overview, check index freshness |
| `gitnexus://repo/the-record/clusters` | All functional areas |
| `gitnexus://repo/the-record/processes` | All execution flows |
| `gitnexus://repo/the-record/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# DATUM Enforcement
This repository uses DATUM for all workflows. You must use the `/datum` skill commands (like `/datum go`, `/datum express`) for any feature work or fixes.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/the-record-suite/Record-Infrastructure/CLAUDE.md
# =========================================

# BodyMan

Local-first macOS meeting transcription app. Swift 6.2, Clean Architecture, TDD.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, and next action.

## Orchestration

This file is the conductor. Epics execute in dependency order:

```
COMPLETED                                    REMAINING
─────────                                    ─────────
Epic 1: Core Recording ─┐
Epic 1.5: Capture Fixes  ├──→ Epic 3.5: Parakeet + Telemetry (no UI)
Epic 3: Transcription    │
Epic 4: Diarization     ─┘──→ Epic 5: Menu Bar UI (needs desk)
Epic 2: Storage         ─┘──→ Epic 6: Summarization (MLX/GPU)
                              Epic 7: Streaming + Translation
                              Epic 8: BodyMan Engine (MCP + NLP)
```

Each epic follows 5 phases: **REFINE** (SPEC) → **PLAN** (TASKS.md) → **PROPERTIES** (formal properties) → **ACT** (code) → **VALIDATE** (integration).
Human checkpoint after PLAN and before ACT. Within ACT, layers build sequentially: Domain → Business → Infrastructure → Presentation.

PROPERTIES.md (template at `docs/planning/PROPERTIES-TEMPLATE.md`) captures 11 property categories:
FUNCTIONAL, SAFETY, LIVENESS, PERFORMANCE, SECURITY, RELIABILITY, CONCURRENCY, OBSERVABILITY, UX, DATA INTEGRITY, PRIVACY.
Each property drives test generation (RED briefs) and reviewer validation (traceability matrix).

## Skills (Progressive Disclosure)

Read the skill file when entering that phase. Don't load all skills upfront.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/bodyman-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/bodyman-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/bodyman-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/bodyman-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/bodyman-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/bodyman-integration-validator/SKILL.md` |

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

**Boundaries enforced by hooks:**
- Domain: only `import Foundation`
- Business: Domain + Foundation + OSLog
- Infrastructure: implements Domain protocols, translates all external errors to domain errors
- Presentation: Business + Domain + SwiftUI

**Also enforced by hooks:**
- File size limits: Domain 100, Business 300, Infrastructure 300, ViewModels 200, Views 150
- No `@unchecked Sendable` outside Infrastructure/Audio and Domain/Audio/AudioBuffer
- TDD guard: warns if writing source without corresponding test file

## Integration Test Environment Variables

```bash
# Enable integration tests (real WhisperKit, DuckDB, FluidAudio inference)
RUN_INTEGRATION_TESTS=1 python3 scripts/test.py --filter "SomeSuite" --no-parallel

# Enable MLX summarization tests (requires app bundle context for metallib — see #80, #81)
RUN_INTEGRATION_TESTS=1 RUN_MLX_TESTS=1 python3 scripts/test.py --filter "SummarizationModelComparison" --no-parallel
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUN_INTEGRATION_TESTS` | unset (skipped) | Enables real-hardware integration suites: WhisperKit, DuckDB, FluidAudio, pipeline |
| `RUN_MLX_TESTS` | unset (skipped) | Enables MLX summarization tests. Requires metallib accessible from bundle (blocked until #81 lands) |

Use `--no-parallel` for integration tests to prevent `swift test --parallel` from buffering stdout during long-running inference.

## TDD Order

1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together

## Rename / Refactor Protocol

**Before any rename swarm, run GitNexus impact analysis to get the complete caller map:**

```
gitnexus_impact({ target: "methodName", direction: "upstream", file_path: "path/to/file.swift", includeTests: true })
```

Pass the full `byDepth.1` list to each rename agent — no grepping, no missed call sites.

**After the swarm, reindex and verify zero orphans:**

```bash
node ~/.npm/_npx/32f98f05d98eef45/node_modules/gitnexus/dist/cli/index.js analyze --force
```

Then run:
```
gitnexus_cypher("MATCH (a)-[{type:'CALLS'}]->(b) WHERE b.name = 'oldName' RETURN a.name, a.filePath")
```

Any remaining hits = confirmed orphaned calls. The DuckDB `.execute()` SQL calls are false positives — filter by `filePath NOT CONTAINS 'DuckDB'` if needed.

## Subagent Briefing

When spawning agents for parallel work, include in the prompt:
- The skill file path to read
- SPEC and PLAN file paths for the current epic
- `Swift 6.2 -strict-concurrency=complete`, file size limits, TDD discipline
- context7 MCP access: `mcp__context7__resolve-library-id` then `mcp__context7__query-docs`

## Canonical Decisions (override older docs)

Some architecture docs predate the SPEC-EPIC1 v2.0 research enrichment. When in conflict:
- **Audio capture:** ScreenCaptureKit (NOT CATapDescription). SPEC-EPIC1.md is authoritative.
- **Project name:** BodyMan (not "Meeting Transcriber Pro"). Some planning docs use the old name.
- **Observation:** @Observable (NOT ObservableObject). macOS 15+ only.

## Single Source of Truth — Canonical Defaults

**Never hardcode a value that already has a named canonical source.** Reference the source directly so changes propagate automatically.

| Value | Canonical source | Wrong |
|-------|-----------------|-------|
| Default UI theme | `UITheme.default` (= `.broadsheet`) | `.broadsheet` inline |
| Default privacy mode | `PrivacyMode.default` (= `.meetings`) | `.meetings` inline |
| Default meeting type | `SummaryConfig.default.meetingType` (= `.oneOnOne`) | `.oneOnOne` inline |
| Ready status message | `MenuBarViewModel.readyStatus` (= `"Ready"`) | `"Ready"` inline |
| Time format | `TimeInterval.mmss` extension | `String(format: "%d:%02d", ...)` inline |

In **tests**: reference canonical sources so tests stay correct when defaults change:
```swift
// WRONG — breaks if UITheme.default changes
#expect(AppConfig.default.uiTheme == .broadsheet)

// CORRECT
#expect(AppConfig.default.uiTheme == UITheme.default)
```

Detection signal: the same string or value in 3+ places is an SSOT violation.

## Agent Coding Patterns

### Asymmetric try? Fix

When fixing a `try?` that silently swallows errors in a type, audit ALL sibling `try?` calls in the same file before moving on. Silent error loss clusters — fixing one and missing another in the same type is a recurring agent failure pattern.

**Rule**: grep the file for `try?` after fixing any one instance. Fix all of them in the same commit.

### Never try? on Task.sleep in Task Loop Bodies

`try? await Task.sleep(...)` inside a `while !Task.isCancelled` loop swallows `CancellationError` and delays task exit by up to the full sleep duration. This is a responsiveness bug.

**Rule**: In Task loop bodies, always `try await Task.sleep(...)` and let `CancellationError` propagate. The `while` loop exits naturally on throw. Never `try?` a sleep that should respond to cancellation.

### C Library Init: Always Guard and Log Nil

When an actor's `init` calls C library init functions (Speex, CoreAudio, AVAudio, etc.) that return optional pointers, never silently proceed with nil state.

**Rule**: After every C init call in a Swift actor init, guard the returned optional:
```swift
if cState == nil {
    logger.error("C lib init failed — actor will operate in degraded/pass-through mode")
}
```
Longer-term: use a static factory (`Actor.make(...) throws`) so init failure is visible at the call site. Never let nil state produce silent behavioral degradation.

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work
(actor re-entrancy, @unchecked Sendable, parallel test conflicts, diagnostic methodology).

These docs exist but don't read them unless working on that layer:
- `docs/architecture/DOMAIN-LAYER.md` (1681 lines)
- `docs/architecture/BUSINESS-LAYER.md` (1377 lines)
- `docs/architecture/INFRASTRUCTURE-LAYER.md` (1954 lines)
- `docs/architecture/PRESENTATION-LAYER.md` (2045 lines)
- `docs/architecture/PLUGIN-ARCHITECTURE.md` (2367 lines)
- `docs/planning/DEVELOPMENT-PLAN.md` (1239 lines)

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/Domain/          ← library: Foundation only
Sources/Business/        ← library: depends on Domain
Sources/Infrastructure/  ← library: depends on Domain + 3rd-party
Sources/Presentation/    ← library: depends on Domain + Business
Sources/BodyMan/                ← executable: composition root (BodyManApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (12776 symbols, 137262 relationships, 189 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/external-apps/OpenOats/OpenOats/.build/checkouts/FluidAudio/CLAUDE.md
# =========================================

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FluidAudio is a Swift framework for local, low-latency audio processing on Apple platforms. It provides speaker diarization, automatic speech recognition (ASR), and voice activity detection (VAD) through open-source models converted to Core ML.

## Critical Development Rules

### NEVER USE `@unchecked Sendable`

- Always implement thread-safe code with proper synchronization
- Use actors, `@MainActor`, or proper locking mechanisms instead
- If you encounter Sendable conformance issues, fix them properly

### NEVER CREATE DUMMY MODELS OR SYNTHETIC DATA

- Do not create dummy, mock, or fake models for testing or development
- Do not generate synthetic audio data for testing
- Always use the actual models required by the code
- If model authentication is required, inform the user rather than creating dummy versions

### NEVER UPLOAD TO HUGGINGFACE

- Do not upload models, datasets, or any files to HuggingFace
- Do not create HuggingFace repos
- Prepare files locally and let the user handle all HF uploads themselves

### MODEL OPERATIONS - CONSULT BEFORE IMPLEMENTING

- When asked to merge, convert, or modify models:
  - If it seems impossible or there are significant objections, consult the user first
  - If they say proceed, do it immediately without further objections
- Do not create placeholder models or implement alternatives without asking

## User Preferences

- Never start responses with positive re-affirming text ("You're absolutely right!", "Good change!", etc.)
- Get straight to the point with technical facts
- For debugging, use print statements and delete them at the end when instructed
- Never create fallbacks or simplified solutions that don't actually solve the problem
- When asked to implement something specific, do it first before explaining why it might not be optimal
- Don't over-do things that aren't asked

## Development Guidelines

1. **Follow Instructions**: Implementation first, explanation second
2. **Testing Policy**: Add unit tests when writing new code.
3. **Git Operations**: Never run `git push` unless explicitly requested.
   - **No Co-Author Tags**: Do not add `Co-Authored-By` lines for Claude, Copilot, or any AI assistant in commit messages.
   - **No GitHub comments**: Never post comments, reviews, or reactions on issues or PRs via `gh`. Reading issues, PRs, and comments is fine. Creating PRs and editing PR titles/bodies is fine.
4. **Code Formatting**: All code must pass swift-format checks before merge
5. **Avoid Deprecated Code**: Do not add support for deprecated models or features unless explicitly requested
6. **Performance**: Keep RTFx > 1.0x for real-time capability

## Code Style

- **Swift Format**: Enforced via `.swift-format` config, CI checked
- **Local formatting**: `swift format --in-place --recursive --configuration .swift-format Sources/ Tests/`
- **Line length**: 120 characters
- **Indentation**: 4 spaces
- **Import order**: Alphabetical preferred, but OrderedImports rule is disabled due to Swift 6.1 (GitHub Actions CI) vs 6.3 (local) formatter incompatibility. Swift 6.3 is unavailable in GitHub Actions runners.
- **Naming**: lowerCamelCase for variables/functions, UpperCamelCase for types
- **Error handling**: Proper Swift error handling, no force unwrapping in production. Per-module error enums conforming to `Error, LocalizedError` (e.g. `ASRError`, `VadError`, `OfflineDiarizationError`, `Qwen3AsrError`)
- **Logging**: Use `AppLogger(category:)` from `Shared/AppLogger.swift` — not `print()` in production code. One logger per component (e.g. `AppLogger(category: "VadManager")`)
- **Documentation**: Triple-slash comments (`///`) for public APIs
- **Control flow**: Prefer guard statements and early returns over nested if statements

## Build Commands

```bash
# Build
swift build                             # Debug build
swift build -c release                 # Release build (recommended for benchmarks)

# Test
swift test                             # Run all tests
swift test --filter CITests           # Run CI-specific tests only
swift test --filter AsrManagerTests   # Run specific test class

# Format
swift format --in-place --recursive --configuration .swift-format Sources/ Tests/
swift format lint --recursive --configuration .swift-format Sources/ Tests/

# Package management
swift package update
swift package resolve
swift package clean
```

### CLI Commands

```bash
# Transcription
swift run fluidaudiocli transcribe audio.wav
swift run fluidaudiocli transcribe audio.wav --low-latency
swift run fluidaudiocli qwen3-transcribe audio.wav
swift run fluidaudiocli multi-stream audio1.wav audio2.wav

# TTS
swift run fluidaudiocli tts "Hello world" --output hello.wav

# Diarization
swift run fluidaudiocli process meeting.wav --output results.json --threshold 0.6
swift run fluidaudiocli sortformer audio.wav
swift run fluidaudiocli parakeet-eou --input audio.wav

# Benchmarks
swift run fluidaudiocli asr-benchmark --subset test-clean --max-files 100
swift run fluidaudiocli diarization-benchmark --auto-download
swift run fluidaudiocli vad-benchmark --num-files 40 --threshold 0.5
swift run fluidaudiocli fleurs-benchmark --languages en_us,fr_fr --samples 10
swift run fluidaudiocli sortformer-benchmark
swift run fluidaudiocli qwen3-benchmark
swift run fluidaudiocli ctc-earnings-benchmark
swift run fluidaudiocli g2p-benchmark

# Dataset downloads
swift run fluidaudiocli download --dataset ami-sdm
swift run fluidaudiocli download --dataset librispeech-test-clean
```

## Project Structure

```
FluidAudio/
├── Sources/
│   ├── FluidAudio/           # Main library (single product)
│   │   ├── ASR/             # Automatic Speech Recognition
│   │   │   ├── Parakeet/    # Parakeet TDT (Decoder/, SlidingWindow/, Streaming/)
│   │   │   └── Qwen3/       # Qwen3 ASR
│   │   ├── Diarizer/        # Speaker diarization (segmentation, embedding, clustering)
│   │   ├── TTS/             # Text-to-speech (Kokoro, PocketTTS)
│   │   ├── VAD/             # Voice Activity Detection (Silero VAD)
│   │   └── Shared/          # Common utilities (audio conversion, model downloading)
│   └── FluidAudioCLI/       # Command-line interface (macOS only)
├── Tests/                   # Test suite
├── Scripts/                 # Python utilities (benchmarks, evaluation tools)
├── mobius/                  # Research submodule: model conversions, trials, and known issues
├── Documentation/           # Reference documentation
├── Frameworks/              # Vendored frameworks
└── ThirdPartyLicenses/      # Third-party license files
```

## Architecture Overview

### Core Components
- **AsrManager** (`ASR/Parakeet/`): Speech-to-text via TDT (Token Duration Transducer) decoding. Stateless per-chunk processing with automatic decoder state reset.
- **SlidingWindowAsrManager** (`ASR/Parakeet/SlidingWindow/`): Real-time ASR with sliding window processing and cancellation support.
- **StreamingAsrManager** (`ASR/Parakeet/Streaming/`): Protocol for true streaming ASR engines (EOU, Nemotron) with cache-aware encoders.
- **Qwen3AsrManager** (`ASR/Qwen3/`): Qwen3-based ASR with Whisper mel spectrogram frontend.
- **OfflineDiarizerManager** (`Diarizer/`): Speaker separation via segmentation, embedding extraction, and VBx clustering. 17.7% DER on AMI dataset.
- **VadManager** (`VAD/`): Voice activity detection with CoreML models.
- **KokoroSynthesizer** (`TTS/Kokoro/`): Kokoro text-to-speech synthesis.
- **PocketTtsSynthesizer** (`TTS/PocketTTS/`): PocketTTS streaming text-to-speech synthesis.

### Key Patterns
- **Actor-based concurrency**: Thread-safe processing, no `@unchecked Sendable`
- **Stateless ASR**: Each chunk transcribed independently (~14.96s chunks, 2.0s overlap)
- **Auto-recovery**: Corrupt CoreML model detection and re-download from HuggingFace
- **Model management**: Models auto-download from HuggingFace on first use. Can be pre-fetched via `swift run fluidaudiocli download`.
- **Cross-platform**: macOS 14.0+, iOS 17.0+ (library), CLI macOS-only

## Platform Requirements

- **Swift**: 5.10+ (Swift 6+ for swift-format)
- **C++17**: Required for `FastClusterWrapper` (set via `cxxLanguageStandard: .cxx17` in Package.swift)
- **Platforms**: macOS 14.0+, iOS 17.0+
- **Hardware**: Apple Silicon recommended

## CI/CD

GitHub Actions workflows:
- **swift-format.yml**: Code formatting compliance
- **tests.yml**: Build and test execution
- **asr-benchmark.yml**: ASR performance validation
- **diarizer-benchmark.yml**: Diarization benchmarks
- **vad-benchmark.yml**: VAD validation

## Model Sources

- **Diarization**: [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)
- **VAD CoreML**: [FluidInference/silero-vad-coreml](https://huggingface.co/FluidInference/silero-vad-coreml)
- **ASR Models**: [FluidInference/parakeet-tdt-0.6b-v3-coreml](https://huggingface.co/FluidInference/parakeet-tdt-0.6b-v3-coreml)
- **Test Data**: [alexwengg/musan_mini*](https://huggingface.co/datasets/alexwengg) variants


# =========================================
# SOURCE: /Users/samfakhreddine/repos/external-apps/OpenOats/OpenOats/.build/checkouts/speech-swift/AGENTS.md
# =========================================

# Agent Instructions

AI speech models for Apple Silicon (MLX Swift). ASR, TTS, speech-to-speech, VAD, diarization, speech enhancement.

## Workflow

- **Never commit, push, or comment on GitHub without explicit user confirmation.** Draft first, ask to confirm, then execute.
- **Every README.md change must update all 9 translations** (`README_zh.md`, `README_ja.md`, `README_ko.md`, `README_es.md`, `README_de.md`, `README_fr.md`, `README_hi.md`, `README_pt.md`, `README_ru.md`). No exceptions.

## Git Conventions

- Never mention Claude, AI, or any AI tool in commit messages, PR descriptions, or co-author tags
- No `Co-Authored-By` lines in commits
- **Never amend commits or force push** unless the user explicitly asks for it
- Always use branches and PRs — commit history must be preserved

## Build

```bash
# Release build (recommended)
make build

# Debug build
make debug

# Run tests (builds debug first)
make test

# Clean
make clean
```

Or manually:

```bash
swift build -c release --disable-sandbox
./scripts/build_mlx_metallib.sh release
```

The metallib step compiles MLX Metal shaders — without it, inference runs ~5x slower due to JIT shader compilation.

## Skills (Slash Commands)

Project skills in `.claude/skills/`:

| Command | Description |
|---------|-------------|
| `/build` or `/build release` | Release build with metallib |
| `/build debug` | Debug build |
| `/test` or `/test unit` | Run unit tests (skip E2E) |
| `/test e2e` | Full test suite with model downloads |
| `/test FilterName` | Run specific test filter |
| `/benchmark asr` | Benchmark ASR speed |
| `/benchmark tts` | Benchmark TTS speed |
| `/benchmark vad` | VAD benchmark on VoxConverse |
| `/benchmark diarize` | DER benchmark on VoxConverse |

## Project Structure

- `Sources/Qwen3ASR/` — Speech-to-text (Qwen3-ASR)
- `Sources/ParakeetASR/` — Speech-to-text (Parakeet TDT, CoreML)
- `Sources/ParakeetStreamingASR/` — Streaming speech-to-text (Parakeet EOU 120M, CoreML)
- `Sources/OmnilingualASR/` — Speech-to-text (Meta wav2vec2 CTC, 1,672 languages, CoreML 300M + MLX 300M/1B/3B/7B)
- `Sources/Qwen3TTS/` — Text-to-speech (Qwen3-TTS)
- `Sources/CosyVoiceTTS/` — Text-to-speech (CosyVoice3, streaming)
- `Sources/KokoroTTS/` — Text-to-speech (Kokoro-82M, CoreML, iOS-ready)
- `Sources/Qwen3TTSCoreML/` — Text-to-speech (Qwen3-TTS 0.6B, CoreML, 6-model pipeline)
- `Sources/PersonaPlex/` — Speech-to-speech (PersonaPlex 7B, full-duplex)
- `Sources/SpeechVAD/` — VAD (Silero + Pyannote), speaker diarization, speaker embedding (WeSpeaker)
- `Sources/SpeechEnhancement/` — Noise suppression (DeepFilterNet3, CoreML)
- `Sources/Qwen3Chat/` — On-device LLM chat (Qwen3.5-0.8B, MLX + CoreML, INT4/INT8)
- `Sources/MLXCommon/` — Shared MLX utilities (weight loading, quantized layers, memory estimation, `SDPA` multi-head attention helper)
- `Sources/AudioCommon/` — Audio I/O, protocols, HuggingFace downloader, shared `SentencePieceModel` protobuf reader
- `Sources/AudioCLILib/` — CLI commands
- `Sources/AudioCLI/` — CLI entry point (`audio` binary)
- `Tests/` — Unit and integration tests
- `scripts/` — Model conversion (PyTorch → MLX/CoreML), benchmarking
- `Examples/` — Demo apps (PersonaPlexDemo, SpeechDemo, iOSEchoDemo)

## Key Conventions

- Swift 6, macOS 15+ / iOS 18+, Apple Silicon (M-series)
- MLX for GPU inference (Metal), CoreML for Neural Engine (DeepFilterNet3, Kokoro, Qwen3-TTS, Silero VAD optional)
- Models are downloaded from HuggingFace on first use, cached in `~/Library/Caches/qwen3-speech/`
- All audio processing uses Float32 PCM, resampled to model-specific rates internally
- `DiarizedSegment`, `SpeechSegment`, protocol types defined in `Sources/AudioCommon/Protocols.swift`
- Tests that use MLX arrays require the compiled metallib; config/logic-only tests work without it

## Testing

Safe tests (no GPU/model download required):
```bash
make test
```

Full test suite (requires metallib + model downloads):
```bash
make test
```

### Testing requirements for new code

**Every new feature, model, or module MUST include tests:**

- **Unit tests**: Config parsing, data structures, weight loading, math/DSP logic — no GPU or model downloads needed
- **E2E tests**: Full pipeline with real model weights — verify correct output (e.g., ASR round-trip, correct transcription text)
- **Regression tests**: When fixing bugs, add a test that would have caught the bug

**Test organization**: Place tests in `Tests/<ModuleName>Tests/`. Follow existing patterns (e.g., `Qwen3ASRTests/`, `SpeechVADTests/`).

**E2E test naming**: Prefix E2E test classes with `E2E` (e.g., `E2ETranscriptionTests`, `E2EDiarizationTests`). CI uses `--skip E2E` regex to filter out all E2E tests that require model downloads — only unit tests run in the pipeline. E2E tests run locally with `make test` (full suite). **CRITICAL**: Any test class that downloads models or requires GPU inference MUST be prefixed with `E2E`. Unit test classes must NOT contain `E2E` in their name.

**What to test per category:**
| Change | Required tests |
|--------|---------------|
| New model/module | Unit (config, weight loading) + E2E (inference produces correct output) |
| New CLI command | Unit (argument parsing) + E2E (end-to-end with real files) |
| Bug fix | Regression test reproducing the bug |
| New protocol/type | Unit test for conformance and behavior |
| DSP/audio processing | Unit test with known input/output pairs |

## CLI

The `audio` binary is the main entry point:

```bash
.build/release/audio transcribe recording.wav          # ASR
.build/release/audio speak "Hello" --output hi.wav     # TTS
.build/release/audio respond --input q.wav             # Speech-to-speech
.build/release/audio diarize meeting.wav               # Speaker diarization (pyannote)
.build/release/audio diarize meeting.wav --engine sortformer  # Sortformer (CoreML, end-to-end)
.build/release/audio diarize meeting.wav --rttm        # RTTM output
.build/release/audio vad audio.wav                     # Voice activity detection
.build/release/audio embed-speaker voice.wav           # Speaker embedding
.build/release/audio denoise noisy.wav                 # Speech enhancement
.build/release/audio kokoro "Hello" --voice af_heart   # Kokoro TTS (iOS)
.build/release/audio qwen3-tts-coreml "Hello"          # Qwen3-TTS CoreML (6-model pipeline)
```

## Documentation

### Local docs (`docs/`)

Architecture and implementation docs live in this repo:

```
docs/
  models/                       Model architecture, weights, layers
    asr-model.md                Qwen3-ASR architecture
    tts-model.md                Qwen3-TTS architecture
    cosyvoice-tts.md            CosyVoice3 architecture
    kokoro-tts.md               Kokoro-82M architecture
    parakeet-asr.md             Parakeet TDT architecture
    personaplex.md              PersonaPlex architecture
    fireredvad.md               FireRedVAD (DFSMN) architecture
  inference/                    Pipelines, usage, configs
    qwen3-asr-inference.md      Qwen3-ASR inference pipeline
    parakeet-asr-inference.md   Parakeet TDT inference (CoreML)
    qwen3-tts-inference.md      TTS inference pipeline
    forced-aligner.md           Forced alignment pipeline
    silero-vad.md               Silero VAD streaming
    fireredvad.md               FireRedVAD inference + tuning results
    speaker-diarization.md      Speaker diarization pipeline
    speech-enhancement.md       DeepFilterNet3 pipeline
  audio/                        Audio I/O, playback, voice pipeline
    playback.md                 Streaming playback, pre-buffer, Apple audio architecture
    voice-pipeline.md           VoicePipeline state machine, events, config
  benchmarks/                   WER, DER, RTF results
  shared-protocols.md       Protocol reference (cross-cutting)
```

**Keep local docs in sync when making code changes.**

### Documentation site (soniqo-web)

The public documentation is hosted at **https://soniqo.audio** (Firebase Hosting) and lives in a separate private repository: **soniqo-web**.

**Whenever code changes are made in this repo, both local docs AND the soniqo-web site must be updated.**

### What requires a docs update

- New features or capabilities added
- CLI commands added, removed, or flags changed
- Public API changes (protocols, types, function signatures)
- New models or model variants added
- Performance characteristics changed
- Build requirements or installation steps changed
- New modules or source structure changes

### Documentation site structure

```
soniqo-web/public/
  index.html                Landing page (feature grid, performance stats)
  getting-started/          Installation, build instructions, quick start
  guides/
    transcribe/             Qwen3-ASR guide
    parakeet/               Parakeet TDT guide
    speak/                  Qwen3-TTS guide
    cosyvoice/              CosyVoice3 guide
    voice-cloning/          Voice cloning guide
    respond/                PersonaPlex guide
    vad/                    VAD guide (Pyannote + Silero)
    diarize/                Speaker diarization guide
    embed-speaker/          Speaker embeddings guide
    denoise/                Speech enhancement guide
    align/                  Forced alignment guide
    kokoro/                 Kokoro-82M guide (iOS TTS)
  cli/                      CLI command reference (all flags/options)
  api/                      Protocols and shared types
  architecture/             Module structure, backends, weight formats
```

### README translations

Translated READMEs live in the repo root: `README_zh.md`, `README_ja.md`, `README_ko.md`, `README_es.md`, `README_de.md`, `README_fr.md`, `README_hi.md`, `README_pt.md`, `README_ru.md`. **Whenever README.md is updated, all translations must be updated to match.** Each translation links back to the main README and lists all available languages at the top.

### Mapping: code changes → docs pages

| Code change | Local docs | soniqo-web page(s) |
|---|---|---|
| CLI flag added/changed | Relevant inference doc | `/cli/index.html` + relevant guide |
| New model/module | New model + inference doc | Landing page + new guide + architecture |
| Protocol change | `shared-protocols.md` | `/api/index.html` |
| Performance improvement | `benchmarks/` | Landing page perf section + relevant guide |
| Build/install change | — | `/getting-started/index.html` |
| New CLI command | Relevant inference doc | `/cli/index.html` + new guide + landing page |
| Build/dependency change in demo | `Examples/<Demo>/README.md` | — |
| New demo app | `Examples/<Demo>/README.md` | Landing page + relevant guide |


# =========================================
# SOURCE: /Users/samfakhreddine/repos/external-apps/OpenOats/.claude/skills/swift-architecture/AGENTS.md
# =========================================

# AGENTS Guidelines for Swift Architecture Skill

This repository provides an Agent Skill for Swift iOS architecture guidance. It contains architecture playbooks and selection guides to help coding agents provide concrete design and implementation patterns for Swift/SwiftUI/UIKit projects.

## Working with This Repository

### 1. Understanding the Skill

Before making changes:
- Read `swift-architecture-skill/SKILL.md` to understand the overall workflow
- The skill acts as a router that selects appropriate architecture playbooks based on user requests
- Each playbook in `references/` is a self-contained guide with patterns, anti-patterns, and checklists

### 2. Modifying Architecture Playbooks

When editing playbooks in `swift-architecture-skill/references/`:
- **Maintain consistent structure**: Each playbook should have core concepts, code patterns, anti-patterns, testing strategy, and PR review checklist
- **Use modern Swift**: All code examples should use Swift concurrency (async/await, actors) and SwiftUI patterns where applicable
- **Include complete examples**: Code snippets should be runnable and demonstrate the full pattern
- **Provide anti-pattern fixes**: Show both the wrong way and the correct way with explanations

### 3. Testing and Validation

This repository contains documentation and skill definitions rather than app code:
- **Run automated validation**: `python -m skills_ref.cli validate ./swift-architecture-skill`
- **Validate testing snippets**: `./tooling/scripts/validate/testing-snippets.sh`
- **Validate testing quality contract**: `python3 ./tooling/scripts/validate/testing-quality.py`
- **Run external benchmark suite**: `./tooling/scripts/run/benchmarks.py`
- **Validate benchmark architecture coverage**: `python3 ./tooling/scripts/validate/benchmark-coverage.py`
- **Run real-world corpus eval**: `python3 ./tooling/scripts/run/corpus.py`
- **Validate architecture consistency**: `python3 ./tooling/scripts/validate/architecture.py`
- **Check markdown formatting**: Ensure all `.md` files are properly formatted
- **Cross-reference consistency**: Ensure SKILL.md correctly references all playbooks

### 4. Adding New Architecture Patterns

To add a new architecture playbook:

1. Create a new `.md` file in `swift-architecture-skill/references/`
2. Follow the existing playbook structure:
   - Overview and when to use this pattern
   - Core concepts and principles
   - Code patterns with examples
   - Anti-patterns with fixes
   - Testing strategy
   - PR review checklist
3. Update `swift-architecture-skill/SKILL.md` to reference the new playbook
4. Update `references/selection-guide.md` to include the new pattern in decision criteria

### 5. Coding Conventions

When writing Swift code examples in playbooks:
- Use Swift 5.9+ features (async/await, actors, structured concurrency)
- Prefer SwiftUI over UIKit unless demonstrating UIKit-specific patterns
- Follow Swift naming conventions (PascalCase for types, camelCase for properties/functions)
- Use protocol-based dependency injection
- Include error handling in all async operations
- Add comments only when explaining non-obvious architecture decisions

### 6. Documentation Style

- Use clear, concise language
- Include "Why" explanations for architectural decisions
- Provide comparative examples (e.g., "Instead of X, do Y because...")
- Use bullet points for lists of rules or guidelines
- Use code blocks with Swift syntax highlighting
- Keep examples focused and minimal (prefer clarity over completeness)

## Useful Commands

| Command | Purpose |
| ------- | ------- |
| `find . -name "*.md"` | List all markdown files |
| `grep -r "pattern" swift-architecture-skill/references/` | Search across all playbooks |
| `wc -l swift-architecture-skill/references/*.md` | Check playbook sizes |

## Memory and Context

When working on this repository:
- **State management patterns**: ViewModels use `private(set)` for state properties
- **Testing conventions**: Use `@MainActor` on test classes that test MainActor-isolated types
- **Error handling**: Effects must handle their own errors and map to failure actions
- **Navigation**: Model navigation as value types (enum/struct), not UIKit references
- **Assembly pattern**: Use static factory methods like `makeViewModel()` for dependency injection

## Reference Links

- [AGENTS.md specification](https://github.com/agentsmd/agents.md)
- [Swift Architecture Skill Guide](swift-architecture-skill/SKILL.md)

---

Following these guidelines will help maintain consistency and quality when working on architecture playbooks and skill definitions.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/external-apps/OpenOats/.claude/skills/swift-architecture/CLAUDE.md
# =========================================

# Swift Architecture Skill

This repository contains an Agent Skill that provides Swift architecture design and implementation patterns for iOS codebases.

## Project Structure

```
swift-architecture-skill/
  SKILL.md                    # Skill definition and workflow
  agents/
    openai.yaml               # Agent interface configuration
  references/
    selection-guide.md        # Architecture decision framework
    mvp.md                    # MVP pattern playbook
    mvvm.md                   # MVVM pattern playbook
    mvi.md                    # MVI pattern playbook
    tca.md                    # TCA (Composable Architecture) playbook
    clean-architecture.md     # Clean Architecture playbook
    viper.md                  # VIPER pattern playbook
    coordinator.md            # Coordinator pattern playbook
    reactive.md               # Reactive (Combine/RxSwift) playbook
```

## How the Skill Works

1. User requests architecture guidance for a Swift feature or module
2. The skill routes to the appropriate architecture playbook based on explicit request or inferred constraints
3. The playbook provides concrete patterns, code examples, anti-patterns, testing strategies, and PR review checklists
4. Output is tailored to the user's specific feature context

## Key Conventions

- All architecture references are standalone markdown playbooks in `references/`
- Each playbook follows a consistent structure: core concepts, code patterns, anti-patterns with fixes, testing strategy, and PR review checklist
- The skill supports MVP, MVVM, MVI, TCA, Clean Architecture, VIPER, Coordinator, and Reactive patterns
- When no architecture is specified, use `references/selection-guide.md` to infer the best fit
- Code examples use modern Swift concurrency (async/await, actors) and cover both SwiftUI and UIKit patterns


# =========================================
# SOURCE: /Users/samfakhreddine/repos/gitrdunhq/the-record-suite/.agents/datum/worktrees/20260615-194020-b0-b0-root/docs/wiki/AGENTS.md
# =========================================

# THE RECORD — Agent Instructions

Local-first meeting transcription app. macOS 15+ (shipped) · Windows/Linux (roadmap). Swift 6.2, Clean Architecture, TDD.

This file is the universal entry point for ALL AI coding agents (Claude Code, OpenCode, Codex, Cursor, Copilot, Aider, etc.). Tool-specific configs (`.claude/`, `.cursorrules`, `.opencode.yaml`) extend this — they don't replace it.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, next action, and session handoff state.
If you are a human developer, start with `ONBOARDING.md`.

## GRAPHIFY FIRST (MANDATORY)

Before any research, planning, or implementation, you MUST ensure the knowledge graphs are up-to-date:
```bash
./scripts/graphify_suite.sh
```
- **Code Graph**: `graphify-code/graph.html` (Sources only)
- **Test Graph**: `graphify-tests/graph.html` (Tests only)

Open the relevant HTML and read the `GRAPH_REPORT.md` in each directory. Use `graphify query --graph graphify-code/graph.json` for architectural questions.

## Codebase-Wide Invariants (MANDATORY)

Every agent MUST adhere to these 10 core invariants. See `docs/architecture/INVARIANTS.md` for details.

1.  **Actor isolation prevents races** — everywhere you have shared mutable state.
2.  **No meeting content in telemetry/public logs** — never log user content at `.public`.
3.  **INSERT OR IGNORE / Idempotent writes** — everywhere DuckDB is touched.
4.  **Buffer only cleared on success** — any buffered flush pattern.
5.  **Existing API signatures unchanged** — preserve compatibility during refactors.
6.  **No network egress / Local-first** — user data stays on-device.
7.  **Explicit OSLog privacy labels** — every interpolation needs a label.
8.  **All existing tests must pass** — count never decreases.
9.  **No logic changes during structural refactors** — move first, then modify.
10. **Weak self in ViewModel Tasks** — prevent memory leaks.

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

### Layer Import Rules (STRICT)

| Layer | Allowed Imports | File Limit |
|-------|----------------|------------|
| Domain | `Foundation` only | 100 lines |
| Business | Domain + Foundation + OSLog | 300 lines |
| Infrastructure | Domain + any framework (CoreAudio, DuckDB, WhisperKit, etc.) | 300 lines |
| Presentation | Domain + Business + SwiftUI | ViewModels: 200, Views: 150 |

Presentation NEVER imports Infrastructure directly. Business NEVER imports Infrastructure. Domain NEVER imports anything except Foundation.

### Key Patterns

- **Actors** for all shared mutable state (Swift 6.2 strict concurrency)
- **@MainActor** for Presentation layer (ViewModels and Views)
- **@Observable** for ViewModels (NOT ObservableObject)
- **Protocol seams** between layers — Infrastructure implements Domain protocols
- **All external errors translated** to domain errors at the Infrastructure boundary
- **No `@unchecked Sendable`** except `Infrastructure/Audio/` and `Domain/Audio/AudioBuffer.swift`

## Functional Core / Imperative Shell

Business logic (the Business layer) must be expressed as pure transformations: given the same inputs, produce the same outputs, with no hidden side effects. All side effects — persistence, audio I/O, network, calendar writes — live in Infrastructure actors at the edge of the system. This is the principle that makes the layer import rules meaningful: if Business could call Infrastructure directly, side effects would bleed into logic and tests would require full infrastructure setup.

## Boundary Validation

Validate the shape of all external inputs immediately at the boundary where they enter the system — IPC payloads, deserialized JSON/DuckDB rows, file-parsed data, MCP server responses. No business logic executes on unvalidated payloads. In Swift, this means decoding to a typed struct/enum at the Infrastructure boundary and returning a domain error if decoding fails — never passing raw `[String: Any]` into Business or Domain.

## File Size Cap

Hard cap: **500 lines per file** across the entire codebase (layer limits are stricter — see the layer table; this is the absolute ceiling). When a file approaches the limit, split it at a functional seam, never at an arbitrary line count. Extracting a protocol or a sub-actor is preferred over creating a `+Extension` file that just shuffles lines.

## Coding Standards — Resiliency

- **Timeouts & retries.** Every external call (HTTP, DB, subprocess, XPC) must have an explicit timeout and capped-backoff retry. Never fire-and-forget external I/O.
- **Idempotency.** All mutating operations must be idempotent — use upserts or dedup checks before side effects. (Swift-specific: `INSERT OR IGNORE` for DuckDB — already an invariant, applies broadly.)
- **Explicit state.** Represent state as enums or literals. State transitions must be guarded and explicit — no implicit boolean flags that grow over time.
- **Structured errors.** Errors are never silently swallowed. In Swift, use typed error enums (e.g. `AudioError`, `TranscriptionError`) — never `Error` or `NSError` at domain boundaries. At IPC/XPC boundaries, errors must carry a code and a human-readable message.
- **No silent fallbacks.** Never use nil-coalescing (`??`) or short-circuit (`||`) to substitute a default when the data should not be missing. Fail fast and surface the problem.

## No Invented APIs

Do not call APIs, methods, types, or SPM packages that you have not confirmed exist in the codebase or in official documentation. Before using any symbol you did not write yourself:
1. Search the codebase for its definition.
2. If it is an external dependency, confirm it exists in the current version declared in `Package.swift`.
Hallucinating a symbol and then implementing it to make the call compile is a violation of this rule.

## Minimal Diffs

Only change what is required by the current task. No drive-by rewrites, style normalizations, or unrequested refactors in the same commit. If you spot a problem outside the task scope, open a GitHub issue to track it — do not fix it silently in the same diff.

## Preserve Diagnostic Logging

Never remove or silence diagnostic log statements in the same commit as a bug fix. If a log is noisy, reduce its level or mark it for cleanup in a dedicated follow-up commit — but keep it present when the fix lands so the fix can be observed.

## Validate Before Applying at Scale

Before applying generated code or mechanical changes across many files:
1. Apply to **one file first** and verify it builds and tests pass.
2. Break large batches into testable chunks of ≤10 files.
3. For anything with syntax risk (templates, string interpolations, shell scripts), dry-run or compile-check before applying broadly.

Never apply unvalidated output to 10+ files in a single pass.

## No Re-Planning Completed Work

Do not re-plan, re-explore, or re-research any phase of work that has already been completed in the current session or is marked complete in CURRENT_STATE.md / TASKS.md. If you are unsure whether something is done, check CURRENT_STATE.md or ask — do not restart from scratch.

## See Something, Say Something

When you encounter a bug, security issue, broken assumption, or missing test outside the current task scope — do not ignore it and do not fix it in-scope. Open a GitHub issue to track it:

```bash
gh issue create \
  --title "[see-something] category: brief description (file:line)" \
  --label "see-something" \
  --body "What is wrong, why it matters, and suggested fix."
```

Deduplicate: search open issues before creating a new one. Severity threshold: anything that could cause data loss, a crash, a security breach, or a silent correctness failure.

## Active TODO (Mandatory)

**Always keep at least one task active in the TaskList tool during any coding session.**

Before starting work: create tasks for every step. Mark each `in_progress` when you start it. Mark `completed` the moment it's done. Never let the list go empty mid-session — if you finish a task and have more work, create the next one before marking the current one complete.

This keeps the user informed at a glance. A session with no tasks is a session with no visibility.

## TDD Order (MANDATORY)

```
1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together
```

Never write implementation before the test. Never skip the RED step. Tests use Swift Testing framework (`@Suite`, `@Test`, `#expect`), NOT XCTest.

## Build & Test

```bash
swift build                    # debug build
swift build -c release         # release build
swift test                     # run all tests (1479+ tests, ~5.2s)
swift test --filter SuiteName  # run specific test suite
```

**Sub-package test gotcha:** `swift test --filter` from the repo root only reaches Record-App-hosted test targets. Tests in `Record-Audio/Tests/` and `Record-ML/Tests/` must be run from inside that sub-package (`cd Record-Audio && swift test --filter SuiteName`) — from the root the filter silently matches 0 tests and reports success.

## Maintenance Tools

- **Invariants Analysis**: Run `python3 scripts/analyze_properties.py` to identify predicates appearing in 5+ epics for promotion to `docs/architecture/INVARIANTS.md`.

## Semantic Memory (ChromaDB)

Query BEFORE implementing — check for prior art, prior fixes, and reviewed patterns.

| Collection | Docs | Contains |
|---|---|---|
| `architecture_knowledge` | 261 | Architecture analysis, SwiftUI patterns, skill references |
| `agentic_knowledge` | 4117 | Solution docs, review reports, test strategies, prior fixes |

**Query** (run from any shell):

```bash
~/.agents/chroma_env/bin/python3 -c "
import chromadb, os
client = chromadb.PersistentClient(path=os.path.expanduser('~/.agents/chromadb/'))
col = client.get_collection('agentic_knowledge')
results = col.query(query_texts=['YOUR QUERY HERE'], n_results=5)
for doc, meta in zip(results['documents'][0], results['metadatas'][0]):
    print(meta.get('source',''), '\n', doc[:300], '\n---')
"
```

- Query `architecture_knowledge` for layer design, protocol shape, or SwiftUI patterns.
- Query `agentic_knowledge` for prior bug fixes, solution docs, or review findings.
- **Ingest new references:** `.agents/ingest_references.py` — place `.md` files in `.agents/references/`.

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

Additional constraints:
- **No tool attribution.** Never add "Co-Authored-By: \<AI tool\>" or any AI/vendor attribution to commit messages.
- **Squash before first push.** Before the branch has a remote tracking branch or open PR, squash all local commits into one. Use datum's PR phase (`datum pr`) if datum is active — it handles squashing automatically. Otherwise: `git rebase -i origin/main`. One commit per PR at open time.
- **Additive after publish.** Once a branch has a PR open, never rebase, amend, squash, or force-push. Stack new commits on top for review fixups.
- **Never force-push main/master.**

## Git Operations Default Scope

Default to **local-only** git operations: commit, branch, merge, tag. Do NOT push to remote, create PRs, open issues, or perform any remote git operation unless the user explicitly requests it in the current session.

## Project Layout

Single root `Package.swift` — `swift build` / `swift test` from repo root.

```
Sources:
  Record-Foundation/Sources/Domain/              ← Domain layer (Foundation only)
  Record-Foundation/Sources/Logging/             ← Logging (Domain-tier, OSLog wrapper)
  Record-Audio/Sources/AudioInfrastructure/      ← Audio capture I/O (CoreAudio, AVFoundation, CSpeex)
  Record-ML/Sources/MLInfrastructure/            ← ML inference + Storage (WhisperKit, MLX, DuckDB)
    Storage/                                         ← DuckDB persistence
    Transcription/                                   ← WhisperKit transcription
    Diarization/                                     ← FluidAudio speaker diarization
    Summarization/                                   ← MLX summarization
  Record-App/Sources/Business/                   ← Business layer (actors, use cases)
  Record-App/Sources/TheRecord/                  ← Executable: composition root
  Record-Presentation/Sources/Presentation/      ← Presentation layer (SwiftUI)
  Record-Pro/Sources/RecordPro/                  ← RecordPro (Pro tier: DTW, xgrammar)

Tests:
  Record-Foundation/Tests/Unit/Domain/              → DomainTests
  Record-Audio/Tests/Unit/                          → AudioInfrastructureTests
  Record-ML/Tests/Unit/                             → MLInfrastructureTests
    Storage/
    Mocks/
  Record-App/Tests/Unit/Business/                   → BusinessTests
  Record-App/Tests/Unit/Infrastructure/             → AppInfrastructureTests
  Record-Presentation/Tests/Unit/Presentation/      → PresentationTests
  Record-App/Tests/Unit/Presentation/               → AppPresentationTests

Isolated (cross-platform, macOS 15+, no heavy deps):
  Record-CrossPlatform-Foundation/                  ← Future Windows/Linux work
```

Sub-packages (`Record-Foundation/`, `Record-Audio/`, `Record-ML/`, `Record-App/`, etc.) remain valid standalone builds.

## Skills (Progressive Disclosure)

Skills are detailed instruction sets for each architectural layer. Read the relevant skill BEFORE writing code for that layer. Skills are in `.claude/skills/` but the content is universal — any agent can read them.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/therecord-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/therecord-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/therecord-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/therecord-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/therecord-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/therecord-integration-validator/SKILL.md` |
| Audio permissions | `~/.claude/skills/apple-audio-permissions/SKILL.md` |
| Swift best practices | `.claude/skills/swift-best-practices/SKILL.md` |
| Core Audio Tap debugging | `.claude/skills/coreaudio-tap-troubleshooting/SKILL.md` |

## Current Audio Capture Stack

THE RECORD uses **Core Audio Taps** (`CATapDescription` + `AudioHardwareCreateProcessTap`), NOT ScreenCaptureKit:

- Permission: "System Audio Recording Only" (lighter tier, no screen sharing indicator)
- Process targeting: `tapDesc.bundleIDs` requires macOS 26 — guarded with `#available(macOS 26, *)`; falls back to global tap on macOS 15
- `tapDesc.isProcessRestoreEnabled` also requires macOS 26 — guarded in both CoreAudioTapCapture files
- Reading: `AudioDeviceCreateIOProcIDWithBlock` + `AudioDeviceStart` (NOT AVAudioEngine)
- See `AUDIO-TAP-FIX-PLAN.md` for full implementation details and gotchas

## Canonical Decisions (override older docs)

| Decision | Current | Old (ignore) |
|----------|---------|-------------|
| Audio capture | Core Audio Taps (`CATapDescription`) | ScreenCaptureKit |
| macOS target | macOS 15+ (78-file audit: zero 26-only APIs found) | macOS 26+ only |
| Observation | `@Observable` | `ObservableObject` |
| Calendar integration | EventKit (primary) + MCP servers (extension) | Provider-specific OAuth |
| Extension model | MCP servers via `GenericMCPProvider` | Built-in provider plugins |
| Summarization | MLX GPU (Gemma E4B, 128K context) | Llama 3.1 8B / ANE |

## Planning & Strategy Docs

Read these when you need product, business, or team context — not for day-to-day coding.

| Directory | Contains |
|-----------|----------|
| `docs/planning/roles/` | Team scaling roadmap, VP of Research role, Data Scientist role |
| `docs/planning/product/` | Development plan, epic definitions, feature specs, perf budgets |
| `docs/planning/process/` | Engineering process: bug squash workflow, pipelined TDD |
| `docs/planning/sprints/` | Active and historical sprint task lists |
| `docs/PITCH_DECK.md` | Product positioning and core value proposition ("Not a transcript. A memory.") |

---

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work.

Architecture docs (read only when working on that layer):
- `docs/architecture/DOMAIN-LAYER.md`
- `docs/architecture/BUSINESS-LAYER.md`
- `docs/architecture/INFRASTRUCTURE-LAYER.md`
- `docs/architecture/PRESENTATION-LAYER.md`
- `docs/architecture/PLUGIN-ARCHITECTURE.md`

## Open Issues

See `ISSUES.md` for the full BM-### register. Key P0s:
- Audio capture: Core Audio Tap IOProc integration (see `AUDIO-TAP-FIX-PLAN.md`)
- `BM-051`: DuckDB lock → fatalError (should show alert)
- `BM-052`: Screen Recording error mapping fixed, System Audio error mapping in progress

## File Placement Rules

Never write intermediate outputs, generated files, or run artifacts to `/tmp` — it is cleared on reboot and loses work.

Use project-local directories:
- Scratch / intermediate files → `<repo>/.temp/` (gitignored)
- Published outputs → alongside the source file (e.g. `docs/`)
- Pipeline run archives → `<source-dir>/.runs/<pipeline>-<RUN_ID>/`

Every pipeline run must use a RUN_ID so outputs are never overwritten:
```bash
RUN_ID=$(date +%Y%m%d-%H%M%S)
```

## Shell Discipline

**No backslash line continuations.** Multi-line `\`-continued commands are fragile and hard to review. For complex commands, write a named script in `scripts/` and call it with a single line.

**Never read files with shell commands.** Do not use `cat`, `head`, `tail`, or `less` to read source files. Use the agent's native file-read capability. This ban applies inside any tool that executes shell — not just interactive sessions.

## Agent Operations Lessons

Hard-won session findings (curated from `headroom learn` analysis, 2026-06-12). Verified, not auto-generated.

- **"Empty" background agents are usually recoverable.** When a background agent appears to return nothing (0 tool calls, 0 tokens), its transcript is at `/private/tmp/claude-501/<project-slug>/<session>/tasks/*.output` — check there before re-running the work. (`/private/tmp` is the macOS-canonical path for Claude Code's own system files — not a violation of the write-to-/tmp ban, which applies to agent-written artifacts.)
- **Don't WebFetch GitHub tree/blob URLs.** `github.com/.../tree/...` and `blob/...` pages return near-empty results. Use `unset GITHUB_TOKEN && gh api "repos/<owner>/<repo>/git/trees/main?recursive=1"` for file listings and `gh api repos/<owner>/<repo>/contents/<path>` for file contents.
- **Bulk mechanical text replacement (≥5 files)** may use a `sed`/`for` loop ONLY with: clean tree first, `grep -rl` blast-radius preview, post-hoc `git diff` review + build check. Never for symbol renames or anything semantic — use `gitnexus_rename`/serena (see Never Do above).
- **Stale SourceKit diagnostics on new files.** After an agent adds a new source file, IDE diagnostics may report "cannot find X in scope" against it. Trust `swift build`/`swift test` output, not the stale index.

## Sub-Agent Pre-Flight Protocol

Before launching a batch of parallel agents:
1. **Verify prerequisites.** Confirm all files the agents need (SPEC, TASKS, skill files) exist on disk before dispatching any agent.
2. **Canary first.** Launch one agent from the batch and wait for it to succeed before launching the rest. If the canary fails, diagnose and fix before continuing — do not retry in a loop.
3. **No sleep-polling.** Do not use `sleep` loops to wait for agent output. Use the monitor/notification mechanism available to the agent runtime.
4. **One unit of work per agent.** Each agent gets exactly one well-scoped task. Do not ask one agent to both research and implement.

## For Subagent Prompts

When spawning agents for parallel work, include:
- The skill file path to read for their layer
- SPEC and PLAN file paths for the current epic
- `Swift 6.2, macOS 15+, -strict-concurrency=complete`
- File size limits per layer (see table above)
- TDD discipline: RED test first, then GREEN implementation

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Record-Suite** (75285 symbols, 1373608 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Record-Suite/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Record-Suite/clusters` | All functional areas |
| `gitnexus://repo/Record-Suite/processes` | All execution flows |
| `gitnexus://repo/Record-Suite/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# DATUM — Engineering Pipeline

This repo uses DATUM for all feature/fix workflows. Every epic goes through:
`refine → plan → triage → deepen → properties → architect → act → validate → review → closeout`

## File Locations (read these before any datum work)

| What | Path |
|------|------|
| **DATUM CLI** | `uv run ~/.claude/skills/datum/scripts/datum.py <cmd>` |
| **SKILL.md** (full pipeline reference) | `~/.claude/skills/datum/SKILL.md` |
| **Reference docs** (act, brief-builder, etc.) | `~/.claude/skills/datum/references/` |
| **Python package source** | `~/.claude/skills/datum/datum/` |
| **Templates** | `~/.claude/skills/datum/templates/` |
| **Config** | `.datum/config.toml` |
| **State** (current phase, run_id, branch) | `.datum/state.json` + `.datum/state.db` |
| **Lane plan** | `.datum/lane-plan.json` |
| **Epic artifacts** | `docs/epics/datum/<epic-branch-name>/` |
| **SPEC.md** | `docs/epics/datum/<epic>/SPEC.md` |
| **TASKS.md** | `docs/epics/datum/<epic>/TASKS.md` (canonical) |
| **PROPERTIES.md** | `docs/PROPERTIES.md` |
| **TICKET.md** | `docs/epics/datum/<epic>/TICKET.md` |
| **tasks.json** | `tasks.json` (repo root, machine-readable) |

## Current Epic State

Read `.datum/state.json` to find the active run_id and current phase:
```bash
python3 -c "import json; s=json.load(open('.datum/state.json')); print(s['run_id'], s['current_phase'], s['work_branch'])"
```

## Common Commands

```bash
uv run ~/.claude/skills/datum/scripts/datum.py status          # show current phase + run
uv run ~/.claude/skills/datum/scripts/datum.py act --task NNN  # run act for a task
uv run ~/.claude/skills/datum/scripts/datum.py gate check      # run the current phase gate
uv run ~/.claude/skills/datum/scripts/datum.py state show      # show full state
```

## Act Phase — What Agents Do

Each task in `docs/epics/datum/<epic>/TASKS.md` has:
- `id`, `title`, `files[]` (files to touch), `red_note` (what the failing test must assert)
- `acceptance_criteria`, `properties[]` (from PROPERTIES.md to prove)

TDD order is MANDATORY: RED (failing test) → GREEN (minimal implementation) → commit together. Structural tasks (no behavioral change) skip RED/GREEN and go straight to REFACTOR.

**Brief-builder spec:** `~/.claude/skills/datum/references/brief-builder.md`
**Act reference:** `~/.claude/skills/datum/references/04-act.md` (or `04-act-typescript.md`)

## Information Gathering Phase (Non-Pushy Rule)
If the human is simply gathering information, asking questions, or exploring the codebase, DO NOT be pushy about moving to development, committing code, or starting a sprint. Wait for the user's explicit lead before writing code or suggesting we start building. Be a patient architectural partner.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/gitrdunhq/the-record-suite/.agents/datum/worktrees/20260615-194020-b0-b0-root/Record-App/AGENTS.md
# =========================================

# TheRecord — Agent Instructions

Local-first macOS 26+ meeting transcription app. Swift 6.2, Clean Architecture, TDD.

This file is the universal entry point for ALL AI coding agents (Claude Code, OpenCode, Codex, Cursor, Copilot, Aider, etc.). Tool-specific configs (`.claude/`, `.cursorrules`, `.opencode.yaml`) extend this — they don't replace it.

## Resume

Read `CURRENT_STATE.md` — it has the current epic, phase, next action, and session handoff state.

## Architecture (4-Layer Clean)

```
Domain (structs, enums, protocols)  ←  Business (actors)  ←  Infrastructure (actors)
                                    ←  Presentation (@MainActor classes)
```

### Layer Import Rules (STRICT)

| Layer | Allowed Imports | File Limit |
|-------|----------------|------------|
| Domain | `Foundation` only | 100 lines |
| Business | Domain + Foundation + OSLog | 300 lines |
| Infrastructure | Domain + any framework (CoreAudio, DuckDB, WhisperKit, etc.) | 300 lines |
| Presentation | Domain + Business + SwiftUI | ViewModels: 200, Views: 150 |

Presentation NEVER imports Infrastructure directly. Business NEVER imports Infrastructure. Domain NEVER imports anything except Foundation.

### Key Patterns

- **Actors** for all shared mutable state (Swift 6.2 strict concurrency)
- **@MainActor** for Presentation layer (ViewModels and Views)
- **@Observable** for ViewModels (NOT ObservableObject — macOS 26+ only)
- **Protocol seams** between layers — Infrastructure implements Domain protocols
- **All external errors translated** to domain errors at the Infrastructure boundary
- **No `@unchecked Sendable`** except `Infrastructure/Audio/` and `Domain/Audio/AudioBuffer.swift`

## TDD Order (MANDATORY)

```
1. Write test → 2. Verify it FAILS (RED) → 3. Implement → 4. Verify it PASSES (GREEN) → 5. Commit together
```

Never write implementation before the test. Never skip the RED step. Tests use Swift Testing framework (`@Suite`, `@Test`, `#expect`), NOT XCTest.

## Build & Test

```bash
swift build                    # debug build
swift build -c release         # release build
swift test                     # run all tests (1208 tests, ~4.4s)
swift test --filter SuiteName  # run specific test suite
```

## Git Commits

Format: `Epic {N}: [{Layer}] {Description}`

## Project Layout

```
Sources/TheRecordDomain/          ← library: Foundation only
Sources/TheRecordBusiness/        ← library: depends on Domain
Sources/TheRecordInfrastructure/  ← library: depends on Domain + 3rd-party
Sources/TheRecordPresentation/    ← library: depends on Domain + Business
Sources/TheRecord/                ← executable: composition root (TheRecordApp.swift)
Tests/Unit/{Domain,Business,Infrastructure,Presentation}/
Tests/{Integration,E2E}/
docs/epics/epic-{N}/{requirements,plan,validation,execution}/
```

## Skills (Progressive Disclosure)

Skills are detailed instruction sets for each architectural layer. Read the relevant skill BEFORE writing code for that layer. Skills are in `.claude/skills/` but the content is universal — any agent can read them.

| Phase / Layer | Skill File to Read |
|---------------|-------------------|
| Full epic workflow | `.claude/skills/bodyman-epic-executor/SKILL.md` |
| Domain types | `.claude/skills/bodyman-domain-architect/SKILL.md` |
| Business actors | `.claude/skills/bodyman-business-architect/SKILL.md` |
| Infrastructure | `.claude/skills/bodyman-infrastructure-architect/SKILL.md` |
| Presentation | `.claude/skills/bodyman-presentation-architect/SKILL.md` |
| Quality gate | `.claude/skills/bodyman-integration-validator/SKILL.md` |
| Audio permissions | `~/.claude/skills/apple-audio-permissions/SKILL.md` |
| Swift best practices | `.claude/skills/swift-best-practices/SKILL.md` |
| Core Audio Tap debugging | `.claude/skills/coreaudio-tap-troubleshooting/SKILL.md` |

## Current Audio Capture Stack

TheRecord uses **Core Audio Taps** (`CATapDescription` + `AudioHardwareCreateProcessTap`), NOT ScreenCaptureKit:

- Permission: "System Audio Recording Only" (lighter tier, no screen sharing indicator)
- Process targeting: `tapDesc.bundleIDs` (macOS 26+) for per-app audio capture
- Reading: `AudioDeviceCreateIOProcIDWithBlock` + `AudioDeviceStart` (NOT AVAudioEngine)
- See `AUDIO-TAP-FIX-PLAN.md` for full implementation details and gotchas

## Canonical Decisions (override older docs)

| Decision | Current | Old (ignore) |
|----------|---------|-------------|
| Audio capture | Core Audio Taps (`CATapDescription`) | ScreenCaptureKit |
| macOS target | macOS 26+ only | macOS 15+ |
| Observation | `@Observable` | `ObservableObject` |
| Calendar integration | EventKit (primary) + MCP servers (extension) | Provider-specific OAuth |
| Extension model | MCP servers via `GenericMCPProvider` | Built-in provider plugins |
| Summarization | MLX GPU (Llama 3.1 8B, exploring Gemma 4) | ANE |

## Deep Reference

Read `docs/architecture/swift-pitfalls.md` before Infrastructure or Presentation work.

Architecture docs (read only when working on that layer):
- `docs/architecture/DOMAIN-LAYER.md`
- `docs/architecture/BUSINESS-LAYER.md`
- `docs/architecture/INFRASTRUCTURE-LAYER.md`
- `docs/architecture/PRESENTATION-LAYER.md`
- `docs/architecture/PLUGIN-ARCHITECTURE.md`

## Open Issues

See `ISSUES.md` for the full BM-### register. Key P0s:
- Audio capture: Core Audio Tap IOProc integration (see `AUDIO-TAP-FIX-PLAN.md`)
- `BM-051`: DuckDB lock → fatalError (should show alert)
- `BM-052`: Screen Recording error mapping fixed, System Audio error mapping in progress

## For Subagent Prompts

When spawning agents for parallel work, include:
- The skill file path to read for their layer
- SPEC and PLAN file paths for the current epic
- `Swift 6.2, macOS 26+, -strict-concurrency=complete`
- File size limits per layer (see table above)
- TDD discipline: RED test first, then GREEN implementation

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bodyGuy** (12776 symbols, 137262 relationships, 189 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bodyGuy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bodyGuy/clusters` | All functional areas |
| `gitnexus://repo/bodyGuy/processes` | All execution flows |
| `gitnexus://repo/bodyGuy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/gitrdunhq/the-record-suite/.agents/datum/worktrees/20260615-194020-b0-b0-root/CLAUDE.md
# =========================================

Read `AGENTS.md` for all instructions and architecture constraints. This file is intentionally blank to force collation of rules into single sources of truth.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Record-Suite** (75285 symbols, 1373608 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Record-Suite/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Record-Suite/clusters` | All functional areas |
| `gitnexus://repo/Record-Suite/processes` | All execution flows |
| `gitnexus://repo/Record-Suite/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/gitrdunhq/the-record-suite/docs/wiki/AGENTS.md
# =========================================

# THE RECORD — Agent Instructions

Local-first meeting transcription app. macOS 15+. Swift 6.2, Clean Architecture, TDD.

## Environment
- **OS**: macOS 15+
- **Toolchain**: Swift 6.2 (Strict Concurrency: Complete)
- **Setup**: `./onboarding.sh`
- **Graphs**: `./scripts/graphify_suite.sh` (Run before any work)

## Commands
- **Build**: `swift build`
- **Test**: `swift test` (Use `cd <module> && swift test` for sub-packages)
- **Audit**: `python3 scripts/analyze_properties.py`
- **Memory**: Query via ChromaDB (see `docs/agents/semantic-memory--chromadb-.md`)

## Conventions
- **Architecture**: 4-Layer Clean (Domain, Business, Infrastructure, Presentation).
- **Invariants**: 10 Core Invariants in `docs/architecture/INVARIANTS.md`.
- **File Cap**: 500 lines absolute ceiling; layer-specific limits apply.
- **TDD**: RED → GREEN → COMMIT (Swift Testing framework).
- **Naming**: Epic {N}: [{Layer}] {Description}.
- **Discovery**: Use `git ls-files` for recursive searches (ignore worktrees).

## Testing
- **Framework**: Swift Testing (`@Suite`, `@Test`, `#expect`).
- **RED Step**: Verify failure before implementation.
- **Scope**: Run all tests before PR; ensure count never decreases.

## Structure
- **Domain**: `Record-Foundation/Sources/Domain/`
- **Business**: `Record-App/Sources/Business/`
- **Infrastructure**: `Record-Audio/`, `Record-ML/` (MLX, DuckDB, WhisperKit)
- **Presentation**: `Record-Presentation/Sources/Presentation/`
- **Assets/Temp**: Use `.temp/` for scratch files; never `/tmp`.

## Permissions
- **Autonomous**: Read, lint, audit, local test, local commit.
- **Restricted**: Push to remote, create PRs, delete files, change `Package.swift`.

## PR & Commit
- **Format**: `Epic {N}: [{Layer}] {Description}`
- **Squash**: One commit per PR at open time.
- **Impact**: Run `gitnexus impact <SymbolName>` before editing existing symbols.

---

## Detailed References
- [Architecture & Layers](docs/agents/architecture--4-layer-clean-.md)
- [Project Layout](docs/agents/project-layout.md)
- [Semantic Memory](docs/agents/semantic-memory--chromadb-.md)
- [Canonical Decisions](CURRENT_STATE.md)


# =========================================
# SOURCE: /Users/samfakhreddine/repos/ai-code-tools/Swift-Agent-Skills/frankenapp-skills/swift-security/AGENTS.md
# =========================================

# AGENTS.md

This repository contains the **Keychain & Security Expert Skill** — a non-opinionated, correctness-focused reference for iOS/macOS keychain operations, biometric authentication, CryptoKit cryptography, credential lifecycle management, certificate trust, and OWASP compliance mapping.

## Repo Structure

```
AGENTS.md                              ← you are here (repo-level agent onboarding)
CLAUDE.md -> AGENTS.md                ← symlink for Claude Code compatibility
README.md                              ← human-facing documentation
LICENSE
.claude-plugin/
  plugin.json                          ← Claude Code plugin manifest
  marketplace.json                     ← Claude Code marketplace catalog
swift-security-expert/
  SKILL.md                             ← the skill: router, guidelines, behavioral rules
  references/
    keychain-fundamentals.md           ← SecItem* CRUD, query dictionaries, OSStatus
    keychain-item-classes.md           ← kSecClass types, composite primary keys
    keychain-access-control.md         ← accessibility constants, SecAccessControl
    biometric-authentication.md        ← keychain-bound biometrics, LAContext bypass
    secure-enclave.md                  ← hardware-backed P256, simulator traps
    cryptokit-symmetric.md             ← SHA-2/3, HMAC, AES-GCM, ChaChaPoly, HKDF
    cryptokit-public-key.md            ← ECDSA, ECDH, HPKE, ML-KEM/ML-DSA
    credential-storage-patterns.md     ← OAuth tokens, API keys, refresh rotation
    keychain-sharing.md                ← access groups, Team ID, extensions
    certificate-trust.md               ← SecTrust, SPKI pinning, mTLS
    migration-legacy-stores.md         ← UserDefaults/plist → Keychain migration
    common-anti-patterns.md            ← top 10 AI-generated security mistakes
    testing-security-code.md           ← protocol mocks, CI/CD, Swift Testing
    compliance-owasp-mapping.md        ← OWASP Mobile Top 10, MASVS, MASTG
```

## How to Use This Skill

1. **Start with `SKILL.md`** — it contains the decision tree router (review / improve / implement), core guidelines, quick reference tables, behavioral rules, and the references index.
2. **Load reference files on demand** — `SKILL.md` tells you which files to load for each query type. Do not load all 14 at once.
3. **Follow the behavioral rules in `SKILL.md`** — tone calibration, output format, common AI mistakes watchlist, and scope boundaries are all defined there.

## Contribution Format

When adding or editing reference files:

- Every reference file must have an H1 title, a scope blockquote, and a `## Summary Checklist` at the bottom
- Code examples use ✅ (correct) and ❌ (incorrect) markers — always provide both for security patterns
- Cite iOS version requirements for every API (`iOS 13+`, `iOS 17+`, `iOS 26+`)
- Cross-references use backtick-quoted filenames: `keychain-fundamentals.md`
- One canonical source per pattern — other files get a one-sentence summary + cross-reference link

## Testing

See `testing-security-code.md` for protocol-based mocking patterns. Key constraints:

- **Simulator:** No Secure Enclave, limited keychain behavior, no biometric prompts
- **CI runners:** Require `security create-keychain` before `SecItem*` calls work
- **Device:** Required for integration tests touching real keychain, SE, or biometrics

## Scope Boundaries

**In scope:** Client-side Apple platform security — Keychain Services, CryptoKit, Secure Enclave, LAContext + keychain binding, certificate trust, OWASP mobile compliance.

**Out of scope:** App Transport Security, CloudKit encryption, server-side auth, WebAuthn relying party, code signing, jailbreak detection, third-party crypto libraries (OpenSSL, LibSodium).

See `SKILL.md` for the full exclusion table with redirect suggestions.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/ai-code-tools/Swift-Agent-Skills/frankenapp-skills/swiftui-design/AGENTS.md
# =========================================

# SwiftUI Design Principles

This repository contains an agent skill for building polished SwiftUI apps and WidgetKit widgets.

## Structure

- `SKILL.md` — The skill definition with all design principles
- `metadata.json` — Skill metadata (version, author, abstract)
- `LICENSE` — MIT license

## How the skill works

The skill is loaded when an agent detects SwiftUI or WidgetKit-related tasks. It provides:

1. A base-4/8 spacing grid to prevent arbitrary padding values
2. A typography hierarchy using weight differentiation (not just size)
3. System semantic color usage instead of hardcoded opacity values
4. Native WidgetKit patterns (Gauge, containerBackground)
5. A pre-ship checklist for verification

The skill is purely instructional — no scripts or build steps required.
