# CLAUDE.md — datum-ax

Guidance for Claude Code working in **datum-ax**. These instructions override default behavior.

## What This Is

`datum-ax` ("Asymmetric eXecution") is an autonomous coding pipeline that treats **code generation as
reasoning**, **code execution as a decoupled utility**, and **context as a strict firewall**. A
cognition tier (Apple-Silicon oMLX + a LangGraph state machine) plans and writes code but **never runs
it**; ephemeral sandboxes execute and are discarded. `eedom` is the **deterministic, zero-LLM review
gate**.

Two principles drive every decision:
1. **Separate cognition from execution.** Anything decidable without a model (platform routing, the
   eedom gate, discipline checks) is deterministic Python, not an LLM call.
2. **Tokenomics — right model for the right work.** Work goes to the smallest model that can do it
   correctly, or to no model at all; escalate a tier only on demonstrated need (ADR-0009/0034).

> Provenance: a variant *inspired by* the parent `datum` project, staged on branch
> `claude/agentic-lang-pipeline-8dqtgr`, intended to migrate to a standalone repo. The directory is
> self-contained. The parent repo's `AGENTS.md` / GitNexus / `datum bugfile` instructions do **not**
> apply here.

## Commands

Tooling is `uv`. Lint/format is `ruff` (line-length 100); types are `mypy --strict`.

```bash
uv sync --group dev                     # install all deps (pytest, mypy, ruff, ...)
uv run pytest                           # full suite (-q is default; ~318 tests)
uv run pytest tests/test_graph.py -q    # a single file
uv run pytest -k loop_compounds         # by keyword
uv run ruff format src/ tests/          # format
uv run ruff check src/ tests/           # lint
uv run mypy                             # strict type-check (src + tests)
uv run datumax <args>                   # the CLI entry point (datum_ax.cli.main:run_cli)
./rebuild.sh                            # reinstall the datumax CLI globally (uv tool install)
```

Optional extras (off by default, hardware/LLM-gated): `semantic` (sentence-transformers — RAG persona
selection), `tokenizer` (tiktoken — exact token counts), `inference`/`mlx` (real oMLX transport).
Without them the code degrades deterministically (keyword ranker, ~4-chars/token heuristic, fakes) so
the suite runs fully offline.

## Architecture — Three Enforced Tiers

Imports flow **downward only**, mechanically enforced by `tests/test_architecture.py` (ADR-0026):

- `src/datum_ax/presentation/` — entry points + **composition root**. The ONLY tier that may import
  `data`; it builds concrete adapters and injects them into `core`.
- `src/datum_ax/core/` — orchestration logic (graph, planner, verifier, compound, reviewer). May
  import **only** `contracts` + `schemas`. **Never** `data` or `presentation`.
- `src/datum_ax/data/` — persistence + external I/O (oMLX, execution hosts, eedom, persona/rule
  files, ledger). May import **only** `contracts` + `schemas`; it *implements* the ports.

Two boundary layers sit beneath the tiers:
- `src/datum_ax/contracts/` — `Protocol` ports at every handoff. Imports only `schemas` + `_base`.
- `src/datum_ax/schemas/` — domain value objects. Imports only `_base`.

If you add a cross-tier import, `tests/test_architecture.py` fails. That's intended — fix the design,
not the test.

## Critical Design Rules

**Dependency inversion (ADR-0026/0032).** `core` never constructs `data` adapters. The composition
root (`presentation/composition.py::default_configurable`) builds them and passes them under
`config['configurable']`; `core/orchestration/graph.py` reads them via `get_inference_client`,
`get_execution_host`, `get_context_crane`, `get_ledger`, `get_review_gate`. Adding a dependency to a
node = add a `build_*` in composition + a `get_*` accessor in graph. Construction is **offline-safe**:
nothing touches the network at graph-load (HTTP connects on first `complete()`, ledger is in-memory,
tokenizer resolves lazily).

**Everything crossing a tier is typed (`_base.py`).** `Contract` is `strict=True, frozen=True,
extra="forbid"`. Cross-tier values are a `Contract` or a `runtime_checkable` Protocol — **never a raw
dict**.

**Ports & adapters everywhere (ADR-0032).** Every external dependency is a port (`contracts/`) +
adapters (`data/<area>/`) behind a `Registry` (`registry.py`). Adapters self-register with
`@SOME_REGISTRY.register("name")`; each `data/<area>/__init__.py` calls `autodiscover(__name__,
__path__)`, so **dropping a new `*.py` in the package makes it available — no central dispatch edit**
(open/closed). Registries: `CONTEXT_ASSEMBLERS`, `REVIEW_GATES`, `PERSONA_REGISTRIES`,
`RULE_REGISTRIES`, `WORKERS`, `ISSUE_PROJECTORS`.

**Determinism by default, reasoning when warranted (ADR-0034).** Escalate only as needed:
logic → tags → embeddings → LLM. The review gate (eedom) stays hard-deterministic / zero-LLM; cognition
(persona selection, synthesis) may use embeddings/LLM.

**Fail-open / fail-soft.** Recording, gate, and artifact-loading failures degrade gracefully (log +
skip / NEEDS_REVIEW / stub) rather than breaking the run.

## The Pipeline (LangGraph)

`core/orchestration/graph.py` compiles a state machine over `OrchestratorState`:
`START → ROUTE → PhaseA → PhaseB → CLOSEOUT → END`.

- **ROUTE** mints/threads the `run_id` (one trace key per run) and records to the ledger.
- **PhaseA** triages the ticket and plans lanes; builds the wave DAG.
- **PhaseB** per lane: synthesize RED test → apply, synthesize GREEN impl → apply, run the review
  gate, and record per-lane `attempt` + `verdict` to the ledger.
- **CLOSEOUT** (compound engineering, ADR-0020) reads the run's ledger trace → derives `Lesson`s →
  `harvest` tiers them → auto-binds the safe ones into the learned-rules registry so the next run's
  crane lifts them.

## Key Subsystems

- **ContextCrane (ADR-0030)** — `core/orchestration/crane.py`. The single context assembler:
  `compose_system` (BASE_PERSONA + role + skills + rules, tiered: tags → RAG) → `assemble` (stable
  prefix for cache reuse, DCP-pruned suffix, budget-checked) → raises `ContextBudgetExceededError` when
  the essential prefix doesn't fit (a planning defect per ADR-0022 — degrade to a stub, don't crash the
  node). `lift_skills` injects skills into VARIABLE slots without disturbing the cache-stable prefix.
- **Persona registry (ADR-0033)** — `contracts/persona.py`, `data/persona/{file,semantic}_registry.py`,
  markdown under `src/datum_ax/personas/` (`BASE_PERSONA.md`, `roles/` = red/green/lane-plan/triage,
  `skills/`). Roles carry a `model_role`; Skills carry a `SkillDelivery` (`INLINE` steering vs
  `SUBAGENT` playbook — never inlined, ADR-0035) and `scope_tags`. The semantic adapter does RAG
  (MiniLM) and degrades to a keyword ranker when the backend is absent.
- **Rules + compound (ADR-0020)** — `contracts/rules.py`, `data/rules/file_registry.py`,
  `core/compound/{harvest,closeout}.py`. Generic liftable rules (markdown in `src/datum_ax/rules/`)
  plus a writable **learned** root the `RuleBinder` writes to (the registry's last root = write target
  = read-winner). Lessons tier into `AUTO_BIND` vs `PROPOSE_AND_GATE`; `fire_count` is the anti-bloat
  signal for which rules actually influence lanes.
- **Review gate (ADR-0006)** — `contracts/review.py`, `data/review/eedom.py`. `ReviewGate.evaluate`
  returns a `ReviewDecision` (`DecisionVerdict`). `BLOCKING_VERDICTS` is the single source of truth for
  "blocking" (`is_blocking`, the eedom adapter, and compound-harvest all derive from it). The eedom
  adapter shells the real `eedom evaluate` CLI (zero LLM); fail-open → `NEEDS_REVIEW` (never silently
  approves).
- **Ledger (ADR-0005/0031)** — `contracts/ledger.py`, `data/state/ledger.py`. Records the per-`run_id`
  trace (node, model role, tokens, attempt, verdict, determinism); backs token metering. SQLite by
  default; centralized backends drop in behind the port at `build_ledger`.

## Code Conventions

- `structlog` via `observability.get_logger(__name__)` — never `print()` (centralized in
  `observability.py`; a test forbids stdlib logging in modules).
- `str, Enum` for every state/verdict field — never raw strings.
- Typed `Contract` / Protocol at every boundary (`_base.py`).
- Docstrings cite the governing ADR (`docs/adr/NNNN-*.md`).
- New external dependency → port in `contracts/` + adapter in `data/<area>/` + registry registration;
  wire it in `presentation/composition.py` and read it via a `get_*` accessor in `graph.py`.

## Testing

- Run in-repo with `uv run pytest` (no container needed; runs fully offline).
- `tests/test_architecture.py` enforces the tier import rules — keep it green.
- Property-based tests use Hypothesis (`tests/strategies.py`) mapped to the DPS-12 domains; the generic
  `TestProperties` in `tests/test_contracts_properties.py` checks every Contract for determinism (JSON
  roundtrip), integrity (`extra="forbid"`, immutability). Name the formal property
  (SAFETY/LIVENESS/INVARIANT/PERFORMANCE).
- Test doubles live in `tests/fakes.py` (`FakeExecutionHost`, `FakeOmlxTransport`) and fake adapters in
  `data/*/fake.py`. Prefer injecting a fake over reaching for a real adapter.
- Hardware/LLM-gated paths (live oMLX, live eedom binary, GitHub MCP) stay gated behind the ports and
  are exercised via fakes in CI.

## Commit Discipline

Conventional commits, scoped `(datum-ax)`, conservative semver:
- `feat(datum-ax):` — new user-facing capability.
- `fix(datum-ax):` — bug/behavior correction, config/CI fix.
- `chore(datum-ax):` — docs, refactors, test-only, housekeeping.

Don't use `feat:` for internal refactors or config tweaks.

## Map

- ADRs: `docs/adr/0001-0035` (architecture decisions; docstrings reference these).
- Design docs: `docs/PIPELINE.md`, `docs/ARCHITECTURE.md`, `docs/GLOSSARY.md`.
- Roadmap / MVP-vs-target gaps: `docs/initiatives/integration-sweep/GAP-LEDGER.md` (the `G1..G13`
  items), build roadmap under `docs/initiatives/datum-ax-build/`.
