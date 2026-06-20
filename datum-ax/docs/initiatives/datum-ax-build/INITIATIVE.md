# INITIATIVE: Build the datum-ax pipeline

> **Dogfood / self-host.** This file is what the `nl-to-ticket` skill (ADR-0024/0025) produces when
> the input is *"build the datum-ax pipeline described by the ADRs in this repo."* Scale detection →
> **initiative** (a product spanning many epics), so it decomposes into epics rather than one ticket.
> It doubles as the implementation roadmap — the bridge from the markdown blueprint to running code.
> Each epic below is later run back through `nl-to-ticket` to produce its own `TICKET.md`.

## Intent

Build the asymmetric agentic coding pipeline specified in `docs/adr/` — a Python orchestrator on
Apple Silicon that plans, generates, sandbox-executes, and deterministically reviews code, improving
itself over time. Runs on the user's M4 Pro + x86 host (not in a generic container).

## Scale

**Initiative — ~11 epics.** Not a single ticket. Sequenced **contract-first** (the same build order
as `ARCHITECTURE.md`): contracts → producers → orchestration → loop → cross-cutting.

## Epics

### E1 — Contracts & schemas  ✅ BUILT *(foundation; build first)*

- **Intent:** the typed interfaces everything depends on.
- **Scope:** `ExecutionHost`, `InferenceClient`, context-firewall adapters, the eedom decision
  contract, the `TICKET`/`PROPERTIES`/rules-registry schemas. No behavior — just contracts + tests.
- **Depends on:** none. **Shippable/testable:** yes (contract tests).  *(ADR-0006/0012/0003/0004/0016/0020)*

### E2 — Inference layer  ✅ BUILT (`src/datum_ax/data/inference/`)

- **Intent:** talk to oMLX, by role, safely.
- **Scope:** `InferenceClient` adapter (OpenAI-compatible), model-role registry (TRIAGE/PLANNER/
  EXECUTOR/ADVERSARIAL), concurrency semaphore, token-budget enforcement, httpx + native MLX
  transports. (Prompt assembly lives in the ContextCrane — E4/ADR-0030.)
- **Depends on:** E1. **Shippable:** yes (mock endpoint).  *(ADR-0003/0004/0013)*

### E3 — Execution hosts  🟡 PARTIALLY BUILT

- **Intent:** run code off the orchestrator.
- **Scope:** `X86DockerHost` (concrete), `MacOSTartHost` (stub), diff-in/results-out, guaranteed
  teardown, egress/rlimits.
- **Depends on:** E1. **Shippable:** yes (run a diff, get results).  *(ADR-0001/0012/0014/0011)*

### E4 — Context firewall & DCP  🟡 PARTIALLY BUILT

- **Intent:** feed the model exact code + compressed docs, and keep the window curated.
- **Scope:** Serena + TokenSave (code), Context7 + Headroom (NL) adapters; Dynamic Context Pruning
  (watermark/guard/event/sweep); relevance-scoped steering.
- **Depends on:** E1, E2. **Shippable:** yes.  *(ADR-0004/0021)*

### E5 — Data plane & observability  ✅ BUILT

- **Intent:** state that survives and is measurable.
- **Scope:** Valkey checkpointer, libSQL ledger (run trace, token+window metering), per-run DB branch,
  budgets/timeouts.
- **Depends on:** E1. **Shippable:** yes.  *(ADR-0005/0013)*

### E6 — Orchestration core (LangGraph)  ✅ BUILT

- **Intent:** the state machine.
- **Scope:** two sub-graphs, Valkey checkpointing, ROUTE entry points, scheduler/waves with
  backpressure, interrupt/resume.
- **Depends on:** E2, E5. **Shippable:** yes (graph runs end-to-end with stub nodes).  *(ADR-0002/0015/0018)*

### E7 — Planner (Phase A)  ✅ BUILT

- **Intent:** TICKET → lane DAG.
- **Scope:** REFINE→SPEC, deterministic triage, DAG decomposition with disjoint-file waves +
  contract-first ordering, PROPERTIES derivation, context-budget lane sizing, GitNexus impact (opt).
- **Depends on:** E4, E6. **Shippable:** yes.  *(ADR-0010/0016/0022/0019)*

### E8 — Verification loop (Phase B)  ✅ BUILT

- **Intent:** make a lane go green and pass review.
- **Scope:** RED→REFLECT→GREEN→sandbox→SKEPTIC→VERDICT→discipline→eedom gate, 3-attempt prune +
  error-reformat, replan-on-blowup.
- **Depends on:** E3, E7. **Shippable:** yes (a lane end-to-end).  *(ADR-0007/0010/0016/0017/0006)*

### E9 — eedom gate integration  ✅ BUILT

- **Intent:** the deterministic review node.
- **Scope:** containerized `eedom evaluate`/`review` invocation, decision-contract branching, fail-open
  → needs_review handling, version pinning (OPA + Opengrep).
- **Depends on:** E1, E3. **Shippable:** yes.  *(ADR-0006)*

### E10 — GitHub projection & intake  🟡 PARTIALLY BUILT

- **Intent:** the human surface.
- **Scope:** `nl-to-ticket` skill (**started**), epic+sub-issue mirroring, `wave:`/`status:` labels,
  machine-status / human-scope sync.
- **Depends on:** E1, E7. **Shippable:** yes (intake works standalone today).  *(ADR-0023/0024/0025)*

### E11 — Compound engineering

- **Intent:** the pipeline gets smarter each run.
- **Scope:** CLOSEOUT harvest, versioned rules registry, tiered binding (auto/gated), rule delivery as
  gates (incl. learned Opengrep rules) + scoped steering.
- **Depends on:** E5, E8, E9. **Shippable:** yes (incremental).  *(ADR-0020)*

## Sequencing

```
 E1 ─┬─► E2 ─┬─► E4 ─┐
     ├─► E3 ─┤       ├─► E6 ─► E7 ─► E8 ─► E11
     ├─► E5 ─┘       │              ▲
     └─► E9 ──────────────────────┘  (E8 calls E9)
 E10 after E7 (intake usable before E7; mirroring needs the DAG)
```

Wave 0: **E1**. Wave 1: E2, E3, E5, E9 (parallel). Wave 2: E4, E6. Wave 3: E7. Wave 4: E8, E10.
Wave 5: E11. (E10's `nl-to-ticket` half already exists.)

## Acceptance demo per epic (the testable deliverable)

Every epic ends with an **acceptance gate**, not just code:

1. a **runnable command** (a CLI subcommand or script),
2. **green tests** (Hypothesis property + integration), and
3. a **dual artifact** out — JSON that validates against an E1 contract + human-readable output.

Because of contract-first + dual artifacts, each epic is demoable against mocks well before the end —
you're never flying blind. **E8 is the first epic where the pipeline actually writes working code.**

| Epic | Testable deliverable (demo) | How you test it |
|------|------------------------------|-----------------|
| E1 Contracts | the typed package | ✅ `uv run pytest` green (**335 passed, 3 skipped**) + tier-boundary guard; schemas emit JSON Schema |
| E2 Inference | `InferenceClient` vs a **mock oMLX** | ✅ Real oMLX and Native MLX transports built; parallel budgets enforced |
| E3 Exec hosts | `X86DockerHost` runs a diff | 🟡 `LocalHost` built; `X86DockerHost` pending |
| E4 Firewall + DCP | the prompt assembler | 🟡 `ContextCrane` footprint validation stubbed |
| E5 Data + observability | ledger + checkpoint + `LiveStatus` | ✅ SQLite/`PostgresLedger` behind `RunLedger`; in-memory/`RedisCheckpointer` (Redis·Valkey) behind `CheckpointStore`; resume roundtrip + metering ✔ (centralized adapters via `[database]`, G6) |
| E6 Orchestration | the graph runs **with stub nodes** | ✅ Full ROUTE→PhaseA→PhaseB→CLOSEOUT trace running successfully |
| E7 Planner | `TICKET → lane DAG` | ✅ DAG chunks into disjoint-file waves perfectly |
| E8 Verify loop | **one real lane goes green** | ✅ Real lanes execute; JSON failures successfully auto-heal |
| E9 eedom gate | containerized review | ⬜ Containerized review pending |
| E10 GitHub + intake | `datum-ax intake "tic tac toe"` | 🟡 `datumax` CLI and `nl-to-ticket` built; GitHub syncing pending |
| E11 Compounding | run 2 is smarter than run 1 | recurring reject → harvest writes an Opengrep rule → next run catches the pattern at zero extra prompt tokens; entry versioned + revertible |

## Non-Goals

- Running inside a generic Linux container (the pipeline targets Apple Silicon + x86 host).
- Re-implementing eedom or GitNexus (consumed as external tools).

## Assumptions

- oMLX, Serena, TokenSave, Context7, Headroom.ai are available on the target hardware (user-locked).
- Python orchestrator (ADR-0003 rationale); targets are language-agnostic.

## Open Questions

- [blocking? no] Build E9 against the existing eedom container image, or vendor a pinned version?
- [blocking? no] Default window target + `max_connections` for the specific Mac (tune from E5 traces)?

## Classification

- Overall complexity: System (multi-epic)
- Suggested first epic(s): **E1 (Contracts & schemas)** — then E2/E3/E5/E9 in parallel.
