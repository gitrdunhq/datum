# CURRENT_STATE — datum-ax

_Last updated: end of session (CLOSEOUT). Branch: `claude/agentic-lang-pipeline-8dqtgr` in
`gitrdunhq/datum`. Working tree clean; everything below is committed and pushed._

## What this is

Two related things, both staged under `datum-ax/` for later migration to a standalone repo
(`gitrdunhq/datum-ax`):

1. **datum-ax** — an asymmetric agentic coding pipeline (a datum-inspired variant). Cognition
   (Apple Silicon + oMLX + LangGraph) is decoupled from execution (ephemeral sandboxes); context is a
   firewall; eedom is the deterministic review gate. **Design is complete (29 ADRs); E1 code is real
   and green.**
2. **Product Team** (`skills/product-team/`) — a discovery-&-shaping skill suite (the fuzzy front
   end), which orchestrates the `sam-fakhreddine/product-manager-skills` library (49 frameworks).

> Staging note: the git proxy only authorizes `gitrdunhq/eedom` + `gitrdunhq/datum`, so a separate
> `datum-ax` repo couldn't be created/pushed. Hence staged here. Migration = `git mv datum-ax/* ` into
> a new repo root; nothing references the parent.

## Status at a glance

| Area | State |
|------|-------|
| Architecture & ADRs | ✅ Complete — 29 ADRs + ARCHITECTURE, PIPELINE (ASCII), GLOSSARY, RESEARCH-NOTES, BUILD-INITIATIVE |
| E1 — Contracts & schemas (code) | ✅ Built & green — strict Pydantic, 3 enforced tiers |
| E2 — Inference layer (code) | ✅ Built & green — oMLX `OmlxInferenceClient`, pluggable transports (HTTPX + Native MLX) |
| Test suite | ✅ 164 tests green (`uv run pytest`) — property + boundary + E2 integration |
| nl-to-ticket intake skill | ✅ Built (skill, runnable) |
| Product Team skill suite | ✅ Built — orchestrator + 4 lenses + framework dispatch map |
| E6 — Orchestration (code) | ✅ Built — LangGraph state machine (Triage → Planner → Synthesis) with self-healing retries |
| E3 — Execution Hosts (code) | 🟡 Partially Built — `LocalHost` implemented for patch execution; `X86DockerHost` pending |
| E4, E5, E7–E11 | ⬜ Designed, not built |
| CLI / API (ADR-0028) | ✅ Built — `datumax run` and `datumax status` surfaces operational |
| Migration to gitrdunhq/datum-ax | ⬜ Pending (proxy/scope) |

## Repo map (under `datum-ax/`)

```
README.md                      entry point + ADR index
CURRENT_STATE.md               this file
docs/
  ARCHITECTURE.md              master design (principles, topology, lifecycle, pressure-test)
  PIPELINE.md                  one-page ASCII end-to-end chart
  GLOSSARY.md                  datum vocabulary -> datum-ax stance
  RESEARCH-NOTES.md            verified vs fabricated ledger (oMLX/LangGraph/etc.)
  BUILD-INITIATIVE.md          the dogfooded build roadmap (E1..E11, dependency waves)
  adr/0001..0029-*.md          29 Architecture Decision Records
  epics/e1-contracts/          emulated E1 ticket + lane-plan
pyproject.toml                 strict mypy + pydantic; dev deps (pytest, hypothesis)
src/datum_ax/                  E1 CODE (three enforced tiers)
  _base.py                     Contract base (strict/frozen/extra=forbid)
  contracts/                   ports: execution, inference, context, review, status (LiveStatus)
  schemas/                     ticket, properties (DPS-12), rules
  presentation/ core/ data/    tier packages (empty; import boundary enforced)
tests/                         Hypothesis property tests + test_architecture.py (boundary guard)
skills/
  nl-to-ticket/                raw text -> TICKET.md/.json (scale-aware)
  product-team/                discovery & shaping suite (orchestrator + clarify/research/skeptic/shape)
```

## How to verify (E1)

```bash
cd datum-ax
uv pip install -e ".[dev]"
uv run pytest          # ~133 tests green (property tests + tier-boundary enforcement)
```

## Load-bearing decisions (so you don't relitigate them)

- **datum = inspiration only**; **oMLX, Serena, TokenSave, Context7, Headroom.ai locked in**.
- **Three tiers always, hard boundaries, contract at every handoff** (ADR-0026) — enforced by a test.
- **Strongly typed always** (strict Pydantic) + **Hypothesis property tests** (DPS-12 domains).
- **Dual artifacts: Markdown for humans, JSON for machines** (ADR-0027); a wrong handoff fails schema
  validation.
- **Tokenomics:** right model for the work; ~80k window is generous *if curated* — firewall (in) + DCP
  (stays) + RemoveMessage (out) + lane sizing (plan to fit); `max_connections × window ≤ memory`.
- **eedom** review = deterministic (OPA + Opengrep, zero LLM). **Worktrees not needed** — containers +
  disjoint-file waves (ADR-0012). **GitHub Issues** = human view of the DAG (epic + sub-issues +
  `wave:` labels, ADR-0023). **Compound engineering** harvest -> rules registry (ADR-0020).
- **Work scale:** task / epic / **initiative** (decompose products, never cram) — ADR-0025.

## Open threads / next steps (pick up here)

1. ~~Build E2 (inference layer)~~ ✅ done — `src/datum_ax/data/inference/`.
2. ~~Build E3 (execution hosts)~~ ✅ partially done — `LocalHost` built. Next: **`X86DockerHost`**.
3. ~~Build E6 (orchestration)~~ ✅ done — `src/datum_ax/core/orchestration/graph.py` running the DAG.
4. ~~Thin E10 CLI~~ ✅ done — `datumax run` and `datumax status` operational.
5. **E4 Context Firewall** — Next up: Wire `TokenSave` integration for footprint validation (currently stubbed in `lane_plan.py`).
3. **Product Team dry-run** — run a real idea end-to-end (FRAME → clarify → research → skeptic →
   BRIEF) to pressure-test and tune the magnificent version.
4. **Migrate** datum-ax + Product Team to `gitrdunhq/datum-ax` once repo creation is possible
   (or mirror `product-manager-skills` into datum for full native access).
5. **Optional ADRs deferred:** human-resume UX; long-term eval/quality feedback loop.

## Pointers

- Big picture: `docs/PIPELINE.md`. Why-decisions: `docs/adr/`. Vocabulary: `docs/GLOSSARY.md`.
- Build order: `docs/BUILD-INITIATIVE.md`. What's real vs fabricated: `docs/RESEARCH-NOTES.md`.
- Product Team: `skills/product-team/README.md` + `FRAMEWORK-MAP.md`.
</content>
