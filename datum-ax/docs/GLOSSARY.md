# Glossary — datum vocabulary, mapped to datum-ax

datum-ax inherits datum's domain language so the two speak the same dialect. This table records
**every first-class datum term**, its meaning, and **datum-ax's stance**:

- **Adopt** — same term, same meaning.
- **Rename** — same concept, clearer name in datum-ax (old name noted).
- **Replace** — concept changes materially (usually: an LLM step becomes deterministic).
- **Elevate** — adopt and make it more first-class than datum did.
- **Defer** — recognized, not in v1.

> Where a term maps to an ADR, the ADR is cited. Terms marked **(gap)** were missing or
> under-modeled in the first design pass and are addressed by this iteration.

## Artifacts

| datum term | Meaning (datum) | datum-ax stance |
|------------|-----------------|-----------------|
| **TICKET** | Original request: scope, requirements, ACs; addenda for scope changes | **Adopt + elevate** — **produced from free-form text by the `nl-to-ticket` skill** (ADR-0024), then lives in the **GitHub epic issue** body; addenda = comments (ADR-0023). |
| **SPEC** | Refined requirements produced by REFINE | **Adopt** — REFINE output; feeds the planner and the prompt assembler. |
| **PROPERTIES** **(gap)** | Invariant set derived from SPEC + TASKS (categorized, task-traceable) | **Elevate** — formalize against eedom's DPS-12 property taxonomy (SAFETY/LIVENESS/INVARIANT/PERFORMANCE). Becomes the contract that discipline + eedom gates check. See "Open: PROPERTIES" below. |
| **TASKS** | Implementation plan, decomposed into tasks with IDs/files/ACs/deps | **Adopt** — the lanes of the DAG (ADR-0010), mirrored to **GitHub sub-issues** as the human checklist (ADR-0023). |
| **LANE PLAN** | DAG of lanes: topological order, deps, file ownership | **Adopt** — the Phase-A plan artifact (ADR-0001, ADR-0010). |
| **QUESTIONS** | Clarifications filed when REFINE detects ambiguity | **Adopt** — surfaced to a human via `interrupt()` (ADR-0014). |
| **ROADMAP** | Out-of-scope addenda triaged out of the current ticket | **Adopt**. |
| **CURRENT_STATE** | Running progress/defect log for resume + learning | **Replace** — the libSQL run ledger is the structured source of truth (ADR-0013); no LLM-written state. |
| **REVIEW-REPORT** | Synthesized findings from an LLM reviewer swarm (Security/Perf/Arch/Correctness) | **Replace** — the deterministic **eedom** decision + `memo_text` (ADR-0006). The LLM reviewer swarm is intentionally removed from the decision path. |

## Phases & routes

| datum term | Meaning | datum-ax stance |
|------------|---------|-----------------|
| **REFINE → PLAN → PROPERTIES → ACT → VALIDATE → REVIEW → CLOSEOUT** | The phase chain | **Adopt the names**, re-homed into two LangGraph sub-graphs (ADR-0002): Phase-A = REFINE/PLAN/PROPERTIES; Phase-B = ACT/VALIDATE/REVIEW; CLOSEOUT = terminal push **+ harvest** (compound-engineering learning loop, ADR-0020). |
| **ROUTE** **(gap)** | Pipeline shape selector: `feature`, `hotfix`, `spike`, `audit`, `resume`, `refine-only` | **Adopt** — the route is chosen at ingest and is itself a tokenomics lever (skip phases you don't need = spend no tokens; ADR-0009). |
| **PHASE** | Current execution position | **Adopt** — a state field on the LangGraph graph. |
| **GATE** | Quality checkpoint (required halts; skippable allows `--approve`) | **Adopt** — datum-ax gates are deterministic (discipline ADR-0010, eedom ADR-0006). |

## ACT stages (per lane)

| datum term | Meaning | datum-ax stance |
|------------|---------|-----------------|
| **RED** | Write failing tests proving the ACs | **Adopt** — RED-before-GREEN is a blocking gate (ADR-0010). |
| **REFLECT** **(gap)** | Independent post-RED test-quality score; gate below threshold | **Adopt** — a deterministic/cheap-model discipline check that test coverage actually exercises the ACs before GREEN is allowed (ADR-0010). |
| **GREEN** | Implement to pass RED | **Adopt** — the EXECUTOR role (ADR-0003). |
| **SKEPTIC** **(gap)** | Adversarial verification panel (edge/error/contract lenses) finding bugs the suite misses | **Adopt** — runs the ADVERSARIAL role as a *verification* step after GREEN, not only as the error-reformatter (ADR-0007). Distinct from eedom (which is deterministic policy/scan, not bug-hunting). |
| **REFACTOR** | Optional cleanup; tests still pass | **Adopt**. |
| **structural / behavioral** | Lane variants: stubs-only vs full TDD | **Adopt** — `structural` lanes are how contract-first ordering emits stubs before producers (ADR-0010). |
| `stub_committed` / `test_committed` / `verified_red` | Sub-stage markers | **Adopt** — lane state markers. |

## Scheduling

| datum term | Meaning | datum-ax stance |
|------------|---------|-----------------|
| **WAVE** | Parallel-executable lane group (Kahn-BFS on the DAG) | **Adopt** — the scheduler's unit of parallelism (ADR-0015), throttled by the oMLX semaphore; projected to humans as a **`wave:N` label** on sub-issues (ADR-0023). |
| **BATCH** | Partition of lanes (≤5) to bound orchestration cardinality | **Adopt** — bounds concurrent sandboxes (ADR-0015). |
| **depends_on** / **topological_order** | DAG edges / ordering | **Adopt** — also the mechanism for contract-first ordering (ADR-0010). |

## Context & execution

| datum term | Meaning | datum-ax stance |
|------------|---------|-----------------|
| **STEERING PACKET / TASK PACKET** **(gap)** | Structured per-lane, per-stage context (spec excerpt, properties, ACs, red_note, allowed/forbidden files, language, framework, upstream stubs) | **Rename → "Task Packet"** and adopt as the concrete output of the **prompt assembler** (ADR-0004). The packet is what the firewall assembles; naming it makes the assembler's contract explicit. |
| **INITIATIVE** *(new, above EPIC)* | A product/program spanning multiple independently-shippable epics | **New level** — `nl-to-ticket` emits an `INITIATIVE.md` decomposing into epics (each → its own TICKET); don't cram a product into one ticket (ADR-0025). |
| **EPIC / epicBranch** | Self-contained feature + its branch and `docs/epics/<branch>/` artifact dir | **Adopt** — backed by a **GitHub epic issue** (ADR-0023); the epic branch is the single authoritative tree; lane isolation via disjoint-file waves + containers, worktrees optional (ADR-0012). |
| **RUN / RUN_ID** | One end-to-end execution + its id | **Adopt** — ledger + checkpoint key (ADR-0005/0013). |
| **CHECKPOINT** | Saved lane/run state for skip/resume | **Adopt** — Valkey checkpoint (ADR-0002); skip-if-complete preserved. |
| **EVIDENCE** | Test output/traces backing a bug claim | **Adopt** — required for SKEPTIC findings; recorded in the ledger. |
| **ARTIFACT** | Output file written/committed during a run | **Adopt** — `collect_artifacts` on the host (ADR-0012). |

## Classification

| datum term | Meaning | datum-ax stance |
|------------|---------|-----------------|
| **SCOPE** (`narrow`/`moderate`/`broad`) | Change breadth | **Adopt** — feeds ROUTE + tokenomics routing. |
| **AMBIGUITY LEVEL** (`high`…`trivial`) | Spec clarity; controls REFINE depth | **Adopt** — drives how much REFINE/model effort to spend (tokenomics). |
| **COMPLEXITY** (`Patch`/`Feature`/`System`) | Epic size | **Adopt** — selects ROUTE shape. |
| **TRIAGE CATEGORY** | Failure root-cause class | **Adopt** — recorded on failed attempts. |
| **SEVERITY** (`critical`…`low`) | Finding importance | **Adopt** — aligns with eedom severities. |
| **VERDICT** (`PASS`/`FRAGILE`/`BROKEN`) | SKEPTIC judgment | **Adopt** — distinct from eedom's `decision` enum; SKEPTIC verdict gates the loop, eedom decision gates the push. |
| **ACCEPTANCE CRITERIA** / **red_note** | Per-lane test requirements / RED hint | **Adopt** — carried in the Task Packet. |

## Open items raised by this mapping — RESOLVED in iteration 2

These datum concepts were genuine gaps in the first design pass; each now has an ADR and is woven into
the lifecycle (ARCHITECTURE §5):

1. **PROPERTIES as a first-class phase** — invariants in eedom's DPS-12 taxonomy, checked by the
   discipline gate and SKEPTIC. → **ADR-0016**.
2. **REFLECT + SKEPTIC as adversarial verification stages** — separating the ADVERSARIAL role's jobs:
   error-reformatting (ADR-0007) vs adversarial bug-hunting with a VERDICT. → **ADR-0017**.
3. **ROUTE shapes** — feature/hotfix/spike/audit/resume as graph entry points and a tokenomics lever.
   → **ADR-0018**.

Related: **GitNexus** was assessed as *complementary* (transitive impact / execution-flow / change
scoping) to Serena/TokenSave/Context7, adopted in a bounded pre/post-loop role. → **ADR-0019**.
