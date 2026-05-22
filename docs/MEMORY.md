# DATUM Global Memory

> This file acts as the primary collective memory for the DATUM factory. It contains past feedback, rules, and engineering conventions.

## Feedback Use Context7

---
name: Use context7 for docs lookup
description: Always use context7 MCP for Docker, BuildKit, Podman, uv, and any other tool docs before guessing — stops the trial-and-error loop
type: feedback
originSessionId: 1ba6627a-a697-4730-a7fe-e2de62b0b496
---
Use context7 MCP to look up documentation BEFORE making changes to container configs, CI pipelines, or tool configurations.

**Why:** Wasted 3 iterations guessing Docker BuildKit seccomp behavior when context7 could have given the answer in one call. The user has context7 available globally — it covers Docker, Podman, BuildKit, uv, pytest, and every major tool.

**How to apply:** Before editing Dockerfiles, Makefiles, CI configs, or any tool configuration:
1. `mcp__context7__resolve-library-id` with the tool name
2. `mcp__context7__query-docs` with the specific question
3. THEN make the edit based on actual docs, not guesses

---

## Memory

## Daily drivers (fires every session)
- [3-agent TDD pipeline](feedback_3agent_tdd.md) — Each task: RED writes failing test, GREEN implements (no test access), REFACTOR verifies
- [Max 6 concurrent agents](feedback_max_6_agents.md) — Claude Code limit of 6 simultaneous background agents. Batch accordingly.
- [Use Sonnet for subagents](feedback_sonnet_agents.md) — Spawn task agents with model=sonnet. Opus stays on orchestration only.

## Patterns & pitfalls (timeless)
- [defer inside if-let executes immediately](feedback_defer_scope_swift.md) — Use outer-scope defer + nil check when hoisting code out of if/else branches
- [Pipelined TDD](feedback_pipelined_tdd.md) — Non-blocking parallel TDD: 3-agent handoff, 6 lanes max, complexity gate, sparse contract enforcement

---

## Feedback 3Agent Tdd

---
name: 3-agent TDD pipeline
description: Each task uses 3 separate agents (RED/GREEN/REFACTOR) to architecturally enforce TDD discipline
metadata:
  type: feedback
  scope: global
  originSessionId: 028a3873-67ca-457d-add5-efc0c052d802
---
Split each task across 3 agents:
1. RED agent writes the failing test (sees ACs only)
2. GREEN agent writes the implementation (sees ACs only, NEVER sees the test)
3. REFACTOR agent verifies both files, runs tests, checks ACs

**Why:** The agent boundary prevents GREEN from mining test assertions to hardcode values. It must implement real logic from the requirements. Stronger than any hook.

**How to apply:** Always use this pattern for behavioral coding tasks. See bodyman-epic-executor SKILL.md Phase 3 for templates.

**GREEN agent isolation:**
- Use `green-no-read-tests.sh` hook (blocks Read + Bash on test files when source exists)
- Use `isolation: "worktree"` for GREEN agents (separate working tree)
- **DO NOT use sparse-checkout** — it leaks from worktree back to main repo and deletes all test files. On 2026-05-09 this nuked 60+ test files from the working tree.

**VIOLATION LOG:** On 2026-05-09, Epic 6 agents were given both test + implementation bundled together. This defeats the architectural enforcement that makes TDD work. NEVER bundle test + implementation in the same agent.

---

## Feedback Defer Scope Swift

---
name: feedback_defer_scope_swift
description: defer inside if-let executes immediately at if-let exit — use outer-scope defer with nil check for env cleanup
metadata:
  type: feedback
  scope: global
  node_type: memory
  originSessionId: 2ce04355-4d71-42ba-90b7-cc64a493d966
---

`defer` fires at the end of its **enclosing scope**, not the end of the function. Inside an `if let` block, it fires when that block exits — before any code after the block.

```swift
// WRONG — defer fires before loadModel
if let token {
    setenv("HF_TOKEN", token, 1)
    defer { unsetenv("HF_TOKEN") }
}
try await plugin.loadModel(id)  // HF_TOKEN already unset!

// CORRECT — defer fires after loadModel
if let token { setenv("HF_TOKEN", token, 1) }
defer { if token != nil { unsetenv("HF_TOKEN") } }
try await plugin.loadModel(id)
```

**Why:** Compiler warning `'defer' statement at end of scope always executes immediately` is the signal — means the defer is the last statement in its scope and executes immediately on scope exit with no code after it to guard.

**How to apply:** When refactoring duplicate `if/else` blocks by hoisting the common call, always check whether any `defer` inside the conditional needs to move to the outer scope. Use `if token != nil { cleanup }` pattern to avoid calling cleanup when the setup never ran.

---

## Feedback Max 6 Agents

---
name: Max 6 concurrent agents
description: Claude Code limit of 6 simultaneous background agents. Batch accordingly.
metadata:
  type: feedback
  scope: global
  originSessionId: 028a3873-67ca-457d-add5-efc0c052d802
---
Maximum 6 background agents at a time. With the 3-agent TDD pipeline (RED → GREEN → REFACTOR), that means 6 tasks per RED wave, then 6 GREEN, then 6 REFACTOR.

**How to apply:** Never launch more than 6 Agent calls in one batch. If a batch has more tasks, split into waves of 6.

---

## Feedback Pipelined Tdd

---
name: pipelined-tdd
description: "Non-blocking parallel TDD pipeline with complexity gate, sparse contract handoff, and commit/isolation rules"
metadata:
  type: feedback
  scope: global
  node_type: memory
  originSessionId: 8c1382e3-a4e6-4731-9c29-f4539196b401
---

Use Pipelined TDD for independent bug fixes and features. Two modes based on a complexity gate:

**1-Agent (mechanical changes):** Single agent does RED + GREEN. Use for type changes, renames, parameter additions, wrapping calls, removing dead code. The implementation has no degrees of freedom — you can't fake a type rename.

**3-Agent with Sparse Contract (behavioral changes):** RED writes test + extracts a plain-English test contract. GREEN receives ONLY the contract and source files — cannot read test source. Can run `swift test` for pass/fail but never sees assertion code. Use for formulas, state machines, conditional logic, data transforms.

**When unsure → default to 3-agent.** The cost is ~2x agents. The risk of 1-agent on a behavioral fix is a test that passes for the wrong reason.

**Pipeline rules:**
- Max 6 concurrent lanes
- GitNexus impact analysis before batching (zero file overlap within a batch)
- Non-blocking: each lane flows independently, merge on complete
- Batch boundary is the only sync point

**Commit + Isolation Rules:**

| Lane type | Isolation | Who commits |
|---|---|---|
| 3-agent RED | `isolation: "worktree"` | RED agent commits the failing test file(s) |
| 3-agent GREEN | Works in RED's worktree | GREEN agent commits the implementation |
| 3-agent REFACTOR | Works in GREEN's worktree | REFACTOR agent commits if fixes made; orchestrator merges if clean |
| 1-agent mechanical | No isolation | Orchestrator commits after agent returns |
| 1-agent behavioral | `isolation: "worktree"` | Agent commits |

**Why:** Single-agent TDD lets the implementer cheat. Barrier-sync blocks on the slowest task. Pipelined TDD with sparse contracts solves both.

---

## Feedback Sonnet Agents

---
name: Use Sonnet for subagents
description: Spawn subagents with model=sonnet, not opus. Opus stays on orchestration only.
metadata:
  type: feedback
  scope: global
  originSessionId: 028a3873-67ca-457d-add5-efc0c052d802
---
Use Sonnet model when spawning subagents via the Agent tool for task execution. Opus is too expensive and slow for granular task work. The orchestrator (main conversation) stays on Opus, but all spawned agents should use `model: "sonnet"`.

**Why:** Tasks are scoped tightly enough (one file + one test) that Sonnet handles them fine. Cost and speed matter at 26 tasks per epic.

**How to apply:** Always set `model: "sonnet"` in Agent tool calls for task execution agents.

---
