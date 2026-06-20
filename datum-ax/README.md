# datum-ax — Asymmetric Agentic Language Pipeline

> **Status:** architecture & design (no runtime code yet).
> **Provenance:** a *variant inspired by* [`datum`](../). Staged inside the `datum` repo on branch
> `claude/agentic-lang-pipeline-8dqtgr` for now; intended to migrate to a standalone repo
> (`gitrdunhq/datum-ax`). This whole directory is self-contained so migration is "move the folder."

`datum-ax` ("Asymmetric eXecution") is an autonomous coding pipeline that treats **code generation
as reasoning**, **code execution as a decoupled utility**, and **context as a strict firewall**.
A cognition tier (Apple Silicon + oMLX + a LangGraph state machine) plans and writes code but
**never runs it**; ephemeral execution sandboxes run the code and are discarded. `eedom` is the
**deterministic, no-LLM code-review gate**.

## Two core principles

1. **Separate cognition from execution.** The orchestrator reasons; it never executes
   model-generated code. Sandboxes execute and are thrown away. Anything decidable without a model
   (platform routing, the eedom gate, discipline checks) is **deterministic Python**, not an LLM call.
2. **Tokenomics — right model for the right work ("token-mining, not token-maxing").** Every unit of
   work goes to the *smallest model that can do it correctly*, or to *no model at all*. Escalate a
   tier only on demonstrated need (low confidence / repeated failure / timeout). Token spend is
   metered per attempt so routing is tuned with evidence.

## Implementation language

**Python** for the orchestrator (LangGraph, MLX/oMLX, the lifted `datum`/`eedom` safety primitives
are all Python-native; pure Python removes `datum`'s brittle TypeScript↔Python seam). **Targets are
language-agnostic** — the sandbox adapters run Python/JS/Go/Rust/Swift/… as needed. These design
docs are Markdown.

## Read in this order

| Doc | What it is |
|-----|-----------|
| [`docs/PIPELINE.md`](docs/PIPELINE.md) | One-page ASCII chart of the whole system end-to-end (spine, topology, context window, data plane + compounding). Start here for the big picture. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The master design — topology, interfaces, run lifecycle, failure handling, and a candid pressure-test of the source blueprint. |
| [`docs/GLOSSARY.md`](docs/GLOSSARY.md) | datum's domain vocabulary (TICKET, SPEC, PROPERTIES, LANE, ROUTE, REFLECT, SKEPTIC, Task Packet, …) mapped to datum-ax's stance on each (adopt/rename/replace/elevate). |
| [`docs/RESEARCH-NOTES.md`](docs/RESEARCH-NOTES.md) | The verified-vs-fabricated ledger. Which blueprint claims survived fact-checking, and which were discarded. |
| [`docs/adr/`](docs/adr/) | 15 Architecture Decision Records (see index below). |

## ADR index

Authored contract-first (the order the pipeline itself would build code in):

**Contracts**
- [0006](docs/adr/0006-eedom-deterministic-review-gate.md) — eedom deterministic review gate (the gate I/O contract)

**Consumers**
- [0002](docs/adr/0002-langgraph-state-machine-and-checkpointer.md) — LangGraph state machine & checkpointer
- [0007](docs/adr/0007-verification-loop.md) — the 3-attempt verification loop
- [0010](docs/adr/0010-code-discipline-gates.md) — code-discipline gates (contract-first, TDD)
- [0009](docs/adr/0009-tokenomics-model-routing.md) — tokenomics / model routing

**Producers**
- [0001](docs/adr/0001-asymmetric-topology.md) — asymmetric compute topology & `ExecutionHost`
- [0003](docs/adr/0003-omlx-inference-and-model-roles.md) — oMLX inference & model roles
- [0004](docs/adr/0004-context-firewall.md) — context firewall (Serena / TokenSave / Context7 / Headroom.ai)
- [0005](docs/adr/0005-data-plane.md) — data & state plane (Valkey + libSQL)

**Cross-cutting & closure**
- [0011](docs/adr/0011-security-trust-boundary.md) — security & trust boundary
- [0012](docs/adr/0012-working-tree-topology.md) — working-tree topology & diff transport
- [0013](docs/adr/0013-observability-and-budgets.md) — observability, timeouts & budgets
- [0014](docs/adr/0014-failure-recovery-and-lifecycle.md) — failure recovery & resource lifecycle
- [0015](docs/adr/0015-onboarding-and-runtime-services.md) — onboarding, runtime services & scheduling
- [0008](docs/adr/0008-relationship-to-datum.md) — relationship to `datum` (borrowed vs net-new)

**Vocabulary & verification (iteration 2)**
- [0016](docs/adr/0016-properties-phase.md) — PROPERTIES phase (invariants in eedom's DPS-12 taxonomy)
- [0017](docs/adr/0017-reflect-and-skeptic.md) — REFLECT + SKEPTIC adversarial verification
- [0018](docs/adr/0018-route-shapes.md) — ROUTE shapes as a tokenomics lever
- [0019](docs/adr/0019-gitnexus-code-graph-intelligence.md) — GitNexus as complementary code-graph intelligence
- [0020](docs/adr/0020-compound-engineering.md) — compound engineering (the learning loop: harvest + rule delivery)
- [0021](docs/adr/0021-active-context-management-dcp.md) — active context management (Dynamic Context Pruning)
- [0022](docs/adr/0022-context-budget-aware-lane-granularity.md) — context-budget-aware lane granularity (a single-turn blowup is a planning defect)
- [0023](docs/adr/0023-github-issues-human-view.md) — GitHub Issues as the human view of the DAG (epic + sub-issue checklist)
- [0024](docs/adr/0024-nl-to-ticket-intake.md) — natural-language → TICKET.md intake skill (the front door) · **first built skill:** [`skills/nl-to-ticket/`](skills/nl-to-ticket/)
- [0025](docs/adr/0025-work-scale-hierarchy.md) — work-scale hierarchy: task / epic / initiative (decompose products, don't cram)

- [0026](docs/adr/0026-three-tier-enforced-boundaries.md) — three-tier architecture with **enforced** boundaries (presentation → core → data; contract at every handoff)
- [0027](docs/adr/0027-dual-artifacts-md-and-json.md) — dual artifacts: Markdown for humans, JSON for machines (handoff = schema validation)
- [0028](docs/adr/0028-cli-and-api-surface.md) — CLI + API surface to kick off any stage (presentation tier)
- [0029](docs/adr/0029-live-status-snapshot.md) — live status snapshot: a single JSON of what the pipeline is doing now (`GET /status`)
- [0030](docs/adr/0030-context-crane-single-source.md) — ContextCrane: single source of truth for context assembly (one assembler, one token counter, one pruner)
- [0031](docs/adr/0031-pluggable-ledger-backend.md) — pluggable ledger backend (local SQLite → centralized DB behind one port)
- [0032](docs/adr/0032-ports-and-adapters-everywhere.md) — ports & adapters everywhere (every external dependency = port + shapes + factory)
- [0033](docs/adr/0033-persona-registry.md) — Persona registry: Roles + Skills as versioned markdown artifacts behind a port (our own lean build; fills the crane's persona seam)
- [0034](docs/adr/0034-determinism-by-default.md) — determinism by default, reasoning when warranted (gate stays zero-LLM; cognition may use embeddings/LLM, escalating on need)
- [0035](docs/adr/0035-subagent-harness-for-playbooks.md) — subagent harness for playbook skills (procedures run on an isolated worker + JSON contract, not inlined; bug-hunt / research-workflow)

**Build roadmap (dogfooded):** [`docs/initiatives/datum-ax-build/INITIATIVE.md`](docs/initiatives/datum-ax-build/INITIATIVE.md) — the datum-ax plan run through `nl-to-ticket`, decomposed into ~11 epics (with per-epic tickets + lane-plans). The bridge from blueprint to code.

**Code (E1–E9 + CLI):** [`src/datum_ax/`](src/datum_ax/) — three enforced tiers (boundary test), strict Pydantic, Hypothesis property tests. Contracts/schemas, oMLX inference, execution hosts, ContextCrane firewall, data plane, LangGraph orchestration, planner, verifier, eedom gate, and the `datumax` CLI. `uv pip install -e . pytest pytest-asyncio hypothesis && uv run pytest` → **202 green**. Roadmap + epic tickets under [`docs/initiatives/datum-ax-build/`](docs/initiatives/datum-ax-build/).

## Status of the locked-in stack

Required, user-mandated components (each wrapped in a thin adapter so the design stays decoupled):
**oMLX** (Apple-Silicon inference), **Serena** (LSP/AST code metadata), **TokenSave** (token-efficient
repo metadata), **Context7** (version-specific docs), **Headroom.ai** (NL-channel semantic
compression). See [`docs/RESEARCH-NOTES.md`](docs/RESEARCH-NOTES.md) for verification status.
