# CURRENT_STATE — datum-ax

_Branch: `claude/agentic-lang-pipeline-8dqtgr` in `gitrdunhq/datum`. Working tree clean; everything
below is committed and pushed. Test suite: **227 green** (`uv run pytest`)._

## What this is

Two related things, both staged under `datum-ax/` for later migration to a standalone repo
(`gitrdunhq/datum-ax`):

1. **datum-ax** — an asymmetric agentic coding pipeline (a datum-inspired variant). Cognition
   (Apple Silicon + oMLX + LangGraph) is decoupled from execution (ephemeral sandboxes); context is a
   firewall owned by the ContextCrane; eedom is the deterministic review gate. **Design complete (32
   ADRs); E1–E9 + CLI implemented and green.**
2. **Product Team** (`skills/product-team/`) — a discovery-&-shaping skill suite that orchestrates the
   `sam-fakhreddine/product-manager-skills` library (49 frameworks). `skills/` is canonical.

> Staging note: the git proxy only authorizes `gitrdunhq/eedom` + `gitrdunhq/datum`, so a standalone
> `datum-ax` repo couldn't be created. Migration = move `datum-ax/*` to a new repo root.

## Status at a glance

| Area | State |
|------|-------|
| Architecture & ADRs | ✅ 32 ADRs + ARCHITECTURE, PIPELINE (ASCII), GLOSSARY, RESEARCH-NOTES, INITIATIVE |
| E1 — Contracts & schemas | ✅ Built & green — strict Pydantic, 3 enforced tiers (boundary test) |
| E2 — Inference layer | ✅ Built — `OmlxInferenceClient` (role registry, semaphore, budgets), httpx + native MLX transports; mock-tested |
| E3 — Execution hosts | ✅ `LocalHost` (patch apply); 🟡 Docker + Tart present, x86 docker not hardened |
| E4 — Context firewall + DCP | ✅ Built — **ContextCrane is the single source of truth** (ADR-0030): hoist→assemble→prune→budget; adapters + DCP |
| E5 — Data plane & observability | ✅ Built — SQLite ledger (run-scoped + metering + persistence) **behind a `RunLedger` port** (centralized DB = config swap, ADR-0031); `InMemoryCheckpointer` resume behind a `CheckpointStore` port; status provider |
| E6 — Orchestration (LangGraph) | ✅ Built — graph (ROUTE→PhaseA→PhaseB→CLOSEOUT), scheduler, state; deps injected via config (DI) |
| E7 — Planner (Phase A) | ✅ Built — triage, DAG/waves, lane_plan, properties |
| E8 — Verifier (Phase B) | ✅ Built — loop, synthesis, discipline; adversarial reviewer |
| E9 — eedom gate | ✅ Built — `EedomReviewGate` behind a `ReviewGate` **plugin** port (registry), `data/review/`; returns typed `ReviewDecision` (fail-open) |
| E10/E11 — CLI / intake | ✅ `datumax run` / `status`; `nl-to-ticket` skill |
| Migration to gitrdunhq/datum-ax | ⬜ Pending (proxy/scope) |

## Repo map (under `datum-ax/`)

```
README.md                         entry point + ADR index
registry.py                       adapter/plugin registry (ADR-0032)
CURRENT_STATE.md                  this file
langgraph.json                    Studio entrypoint -> presentation.studio:make_graph
docs/
  ARCHITECTURE.md  PIPELINE.md  GLOSSARY.md  RESEARCH-NOTES.md
  adr/0001..0032-*.md             32 ADRs
  initiatives/datum-ax-build/      INITIATIVE.md + epics/e1..e11 tickets + lane-plans (the roadmap)
  initiatives/{tic-tac-toe,beta-wiring,integration-sweep}/  emulated runs
src/datum_ax/                     three enforced tiers (boundary test guards imports)
  contracts/   ports + value objects: execution, inference, context, review (ReviewGate), status (StatusSource), ledger, checkpoint, tokens
  schemas/     ticket, properties (DPS-12), rules
  core/        orchestration (graph/scheduler/crane/state), planner, verifier, reviewer
  data/        inference (oMLX+transports), execution (local/docker/tart), context (adapters/dcp), review (eedom plugin), state (ledger/checkpoint/status)
  presentation/  composition (env wiring) + studio (LangGraph factory)
  cli/         datumax CLI (run / status)
tests/                            227 tests: property + boundary guard + per-module integration
skills/  nl-to-ticket/ , product-team/   (canonical; .agents/ is NOT a second copy)
```

## How to verify

```bash
cd datum-ax
uv pip install -e . pytest pytest-asyncio hypothesis
uv run pytest          # 227 green (property + tier-boundary + integration)
```

## Load-bearing decisions (don't relitigate)

- **datum = inspiration only**; **oMLX, Serena, TokenSave, Context7, Headroom.ai locked in**.
- **Three tiers always, hard boundaries, contract at every handoff** (ADR-0026) — enforced by a test;
  `core` never imports `data` (deps injected via `config`, wired by `presentation`/`cli`).
- **Strongly typed always** (strict/frozen Pydantic) + **Hypothesis property tests** (DPS-12 domains).
- **Single source of truth:** dual artifacts md+json with JSON canonical (ADR-0027); **ContextCrane**
  is the one assembler + one token counter + one pruner (ADR-0030).
- **Tokenomics:** right model for the work; ~80k window generous *if curated* — crane firewall (in) +
  DCP (stays) + lane sizing (plan to fit); `max_connections × window ≤ memory`.
- **eedom** review = deterministic (OPA + Opengrep, zero LLM). Worktrees not needed — containers +
  disjoint-file waves (ADR-0012). GitHub Issues = human view of the DAG (ADR-0023). Compound
  engineering harvest → rules registry (ADR-0020).
- **Model roles** (ADR-0003): TRIAGE / PLANNER / EXECUTOR / ADVERSARIAL.

## Open threads / next steps

_Tracked in `docs/initiatives/integration-sweep/GAP-LEDGER.md` (MVP → aspirational)._
1. **G1 (done, retries remain):** crane wired into the loop; retry-prompt rebuilds still inline.
2. **G6 (in progress):** ledger + checkpointer pluggable behind `RunLedger`/`CheckpointStore` ports (resume ✔, metering ✔); real Postgres/Valkey adapters + per-run DB branch remain.
3. **G2/G4/G5/G10:** real context adapters, hardened `X86DockerHost`, real eedom container, live oMLX
   smoke run.
4. **Migrate** datum-ax + Product Team to `gitrdunhq/datum-ax` when repo creation is possible.

## Pointers

- **How we build:** `WORKFLOW.md` (dogfood the pipeline — INTAKE→PLAN→PROPERTIES→RED→GREEN→GATES→CLOSEOUT).
- Big picture: `docs/PIPELINE.md`. Why-decisions: `docs/adr/`. Vocabulary: `docs/GLOSSARY.md`.
- Build roadmap: `docs/initiatives/datum-ax-build/INITIATIVE.md`. Verified vs fabricated:
  `docs/RESEARCH-NOTES.md`. Product Team: `skills/product-team/README.md` + `FRAMEWORK-MAP.md`.
</content>
