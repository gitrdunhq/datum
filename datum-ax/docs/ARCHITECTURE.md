# datum-ax — Architecture

**Asymmetric agentic language pipeline.** Cognition is decoupled from execution; context is a
firewall, not a dumping ground; the review gate is deterministic. This document is the master design.
Decisions are recorded as ADRs in [`adr/`](adr/); this file is the map that ties them together.

---

## 1. Principles

1. **Separate cognition from execution.** The Apple-Silicon orchestrator plans and writes code; it
   **never executes model-generated code**. Ephemeral sandboxes execute and are discarded. Whatever
   can be decided without a model — platform routing, the eedom gate, discipline checks — is
   **deterministic Python**, not an LLM call.
2. **Tokenomics — right model for the right work.** Route each unit of work to the smallest model
   that can do it correctly, or to no model at all. Escalate only on demonstrated need. Meter tokens
   per attempt so routing is evidence-driven. (ADR-0009.)

Everything below serves these two principles.

---

## 2. Topology

The blueprint's **logical** three-tier split is load-bearing (it protects Apple-Silicon memory and
contains untrusted execution). The **physical** count is not — a single developer may collapse
Nodes 0 and 1 onto two machines, or run the x86 sandbox as a VM. The abstraction that makes this
safe is the `ExecutionHost` interface (ADR-0001).

> **Apple-Silicon memory reality (governing design driver).** oMLX supplies KV + SSD cache, but the
> hard limits are the **active context window**: tok/s falls off a cliff past **~80k tokens**, and the
> Mac **OOMs** without fast memory reclamation. So the window is a budgeted resource — kept well under
> the cliff, reclaimed eagerly, and bounded by `max_connections × per-call window ≤ memory`
> (ADR-0003/0013). This is *why* the context firewall, eager pruning, and the `max_connections=2`
> semaphore exist — they are memory-safety mechanisms first, cost optimizations second.

```
                          ┌───────────────────────────────────────────────┐
                          │  NODE 0 — ORCHESTRATOR (Apple Silicon)          │
                          │  • LangGraph state machine (Python)             │
                          │  • oMLX inference (triage / executor / adv.)    │
                          │  • Context firewall (Serena, TokenSave,         │
                          │    Context7, Headroom.ai) + prompt assembler    │
                          │  • Authoritative git worktree(s)                │
                          │  • Secrets live HERE and only here              │
                          │  ✗ NEVER runs model-generated code              │
                          └───────────────┬───────────────────────────────┘
                                          │  diff in  /  (exit code, stderr, artifacts) out
                                          │  (no credentials cross this line)
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                                 ▼
   ┌─────────────────────────────────┐            ┌─────────────────────────────────┐
   │ NODE 1 — x86 LINUX SANDBOX       │            │ NODE 2 — macOS SANDBOX (OPTIONAL)│
   │ (PRIMARY)                        │            │ Tart VM / SSH                    │
   │ ephemeral Docker/Podman per task │            │ SwiftUI / CoreData / xcodebuild  │
   │ egress allowlist, rlimits        │            │ v1: interface + stub             │
   └─────────────────────────────────┘            └─────────────────────────────────┘

   DATA PLANE (ADR-0005)
   ┌──────────────────────────┐     ┌──────────────────────────────────────────────┐
   │ Valkey  (hot, :6379)     │     │ libSQL / sqld  (durable)                       │
   │ LangGraph checkpointer   │     │ run ledger + telemetry + token accounting      │
   │ volatile DAG state       │     │ per-run DB isolation via file-copy/Backup API  │
   └──────────────────────────┘     └──────────────────────────────────────────────┘
```

| Node | Function | Runs generated code? |
|------|----------|----------------------|
| 0 — Orchestrator (Apple Silicon) | LangGraph + oMLX + context firewall + authoritative worktree | **No** |
| 1 — x86 Linux sandbox (primary) | ephemeral Docker/Podman; native x86 | Yes (disposable) |
| 2 — macOS sandbox (optional) | Tart/SSH for Darwin/Swift targets | Yes (disposable) |

---

## 3. Interfaces (the contracts everything else depends on)

These signatures are the contract surface. Concrete implementations are described in the producer
ADRs (0001, 0003, 0004, 0005). Shown in Python-ish pseudotype for intent, not as final code.

### 3.1 `ExecutionHost` (ADR-0001, ADR-0012)
```python
class ExecutionHost(Protocol):
    def apply_diff(self, diff: UnifiedDiff) -> ApplyResult: ...      # to a throwaway checkout
    def run_tests(self, selector: TestSelector) -> TestResult: ...   # exit code + stderr + report
    def run_lint(self, selector: PathSet) -> LintResult: ...
    def collect_artifacts(self, globs: list[str]) -> ArtifactBundle: ...
    def reset(self) -> None: ...                                     # guaranteed teardown
```
Implementations: `X86DockerHost` (v1, concrete), `MacOSTartHost` (v1 stub). The host receives a
**diff and returns results only** — nothing inside it is authoritative, and it holds **no secrets**.

### 3.2 `InferenceClient` (ADR-0003, ADR-0009)
```python
class InferenceClient(Protocol):
    async def complete(self, role: ModelRole, prompt: AssembledPrompt,
                       budget: TokenBudget) -> Completion: ...
# ModelRole ∈ {TRIAGE, EXECUTOR, ADVERSARIAL}; concrete model IDs come from config, not code.
# All calls pass through an asyncio.Semaphore (default max_connections=2).
```

### 3.3 Context-firewall adapters (ADR-0004)
```python
class CodeContext(Protocol):       # Serena + TokenSave — LOSSLESS, never compressed
    def global_map(self) -> AstMap: ...
    def symbol(self, name: str) -> SymbolSlice: ...
    def references(self, name: str) -> list[SymbolSlice]: ...

class DocContext(Protocol):        # Context7 — natural-language, compressible
    def library_docs(self, lib: str, version: str | None) -> NlDoc: ...

class NlCompressor(Protocol):      # Headroom.ai — the ONLY sanctioned compression point
    def compress(self, doc: NlDoc, budget: TokenBudget) -> NlDoc: ...
```

### 3.4 eedom decision contract (ADR-0006) — verified against eedom source
The gate consumes eedom's `ReviewDecision` JSON (`eedom evaluate … --output-json`). Branch on:
```
decision ∈ {approve, reject, needs_review, approve_with_constraints}
should_mark_unstable: bool   # advise mode: true on reject|needs_review
```
`reject` / `should_mark_unstable == true` → not a terminal success. **No LLM in this node.**

### 3.5 `discipline` policy (ADR-0010)
Rules-as-data (eedom-style): contract-first ordering, RED-before-GREEN, required gates — declared in
config, enforced by pure-Python validators.

---

## 4. The context firewall

The single most differentiating idea. **Code is exact; only natural language is compressed.**

```
   ┌─────────────── CODE CHANNEL (lossless, never compressed) ───────────────┐
   │ Serena  → LSP symbols / AST slices (exact bindings & imports)            │
   │ TokenSave → standardized, token-efficient, language-agnostic repo map    │
   └──────────────────────────────┬──────────────────────────────────────────┘
                                   │
   ┌─────────────── NL CHANNEL (compressible) ──────────────┐                │
   │ Context7 → version-specific library/API docs           │                │
   │      │                                                  │                │
   │      ▼  Headroom.ai (the ONLY compression point)        │                │
   └──────┬─────────────────────────────────────────────────┘                │
          ▼                                                                    ▼
   ┌──────────────────────── PROMPT ASSEMBLER ───────────────────────────────┐
   │ Emits the TASK PACKET (datum's STEERING/TASK PACKET — see GLOSSARY).     │
   │ Rigid prefix for oMLX prompt-cache reuse:                                │
   │   [ System ] + [ Global AST/Map ] + [ Diff ]    ← stable, cache-friendly │
   │ Untrusted text (issue bodies, repo content, docs) is FENCED as data,     │
   │ never as instructions (ADR-0011).                                        │
   └─────────────────────────────────────────────────────────────────────────┘
```

Why it matters: compressing code loses exact signatures/imports and breaks generation; compressing
prose is cheap and safe. Keeping the prefix byte-stable lets oMLX reuse the KV/prompt cache and cut
time-to-first-token across the rapid retry loop. (ADR-0003, ADR-0004.)

---

## 5. Orchestration lifecycle (LangGraph)

Two isolated sub-graphs prevent message-array bloat. Checkpointer = Valkey (`RedisSaver`). datum-ax
keeps datum's phase vocabulary (see [`GLOSSARY.md`](GLOSSARY.md)): Phase-A covers **REFINE / PLAN /
PROPERTIES**, Phase-B covers **ACT / VALIDATE / REVIEW**, and the terminal push is **CLOSEOUT**. The
entry **ROUTE** (`feature` / `hotfix` / `spike` / `audit` / `resume`) decides which phases run — a
tokenomics lever, since skipped phases spend no tokens (ADR-0009).

### Phase A — Triage & Planner sub-graph (REFINE / PLAN / PROPERTIES)
```
ingest ─▶ route_select ─▶ serena_parse (Global AST) ─▶ deterministic_triage ─▶ [complex?] ─▶ plan_dag ─▶ properties ─▶ yield
         (deterministic) (+ GitNexus impact, PLAN)   (pure Python, no LLM)       │ no       (GitNexus deps)  (DPS-12)
         ROUTE shape                                  target = x86 | macos        └──────────▶ yield (single step)
```
1. **Route select** — deterministic choice of ROUTE (`feature`/`hotfix`/`spike`/`audit`/`resume`)
   from COMPLEXITY/SCOPE/AMBIGUITY; gates which later phases run (ADR-0018) — a tokenomics lever.
2. **Ingest & parse** — Serena/TokenSave build the Global AST/map (REFINE → SPEC).
3. **Deterministic triage** — pure Python inspects markers (e.g. `import SwiftUI`, `#if os(macOS)`)
   → sets the execution target. **Zero tokens.**
4. **Plan DAG** — the Executor model decomposes into an atomic DAG of lanes with **git-worktree file
   ownership** and **contract-first ordering** (ADR-0010); **GitNexus** supplies risk-scored impact
   and call-graph dependencies (ADR-0019, not used inside the loop).
5. **Properties** — derive the PROPERTIES invariant set in eedom's DPS-12 taxonomy, traced to lanes
   (ADR-0016). ROUTE-gated.
6. **Yield** a static array of steps to the parent graph.

### Phase B — Verification sub-graph (ACT / VALIDATE / REVIEW), per step, max 3 attempts
```
        ┌──────────────────────────────────────────────────────────────────────────────┐
        ▼                                                                                │
 RED ─▶ REFLECT(gate) ─▶ GREEN (oMLX) ─▶ sandbox_apply (ExecutionHost) ─▶ run tests/lint │
        │                                                                                │
        ▼                                                                                │
 [pass?] ──no──▶ prune failed attempt (RemoveMessage) ─▶ adversarial_reformat ───────────┘
        │ yes                                            (attempts < 3)
        ▼
 SKEPTIC ─▶ VERDICT(gate) ─▶ discipline gates (RED-before-GREEN, contract) ─▶ eedom gate (deterministic)
        │                                                                          │
        │ PASS + clear                                              reject / unstable / FRAGILE / BROKEN
        ▼                                                                          ▼
 terminal: push branch (CLOSEOUT)                          route findings back to executor,
                                                           or interrupt() for a human
```
1. **RED → REFLECT** — write failing tests; REFLECT (cheap/independent) gates that they cover the
   lane's PROPERTIES/ACs before GREEN is allowed (ADR-0016, ADR-0017).
2. **GREEN / Execute** — assemble the Task Packet `[System]+[AST]+[Diff]` + compressed NL docs; call
   the EXECUTOR role through the semaphore.
3. **Sandbox apply** — `ExecutionHost.apply_diff()` then `run_tests()`/`run_lint()` on the triaged host.
4. **Verify & prune** — on test failure, capture exit code + stderr and **prune the failed attempt**
   via `RemoveMessage`; the **error-reformatter** (ADVERSARIAL role) rewrites the error into the next
   prompt (ADR-0007).
5. **SKEPTIC → VERDICT** — on passing code, the ADVERSARIAL role adversarially hunts missed bugs
   (edge/error/contract, evidence-backed); `FRAGILE`/`BROKEN` routes back to the executor (ADR-0017).
6. **Discipline + eedom gates** — deterministic; SKEPTIC (LLM adversary, behavioral) and eedom
   (deterministic policy/vuln/license/secret) are complementary (ADR-0010 / ADR-0006).
7. **Terminal** — at 3 attempts: push the branch (CLOSEOUT), or `interrupt()` for a human.

> **Load-bearing invariant (ADR-0002, ADR-0007):** on resume, a LangGraph node **re-executes from
> its start**. Every side effect (sandbox apply, git push, DB branch) must be **idempotent or placed
> after the `interrupt()`**.

---

## 6. Failure handling & lifecycle (summary; full detail in ADR-0014)

- **Within a step:** bounded to 3 attempts with pruning + adversarial reformatting. Loop/repetition
  detection (lifted from datum) breaks degenerate cycles early.
- **Across the DAG:** a failed contract/consumer lane **blocks its dependent producer lanes** — never
  produce against an unproven contract.
- **Resource lifecycle:** guaranteed sandbox / VM / DB-branch teardown even on crash (no leaks).
- **Orchestrator crash:** resume from the Valkey checkpoint; idempotency invariant makes replay safe.
- **Budgets:** per-node timeouts (inference / sandbox / eedom) and a global wall-clock + **token**
  ceiling (ADR-0013) — the hard backstop for tokenomics.
- **Compounding (CLOSEOUT harvest):** every run turns its lessons (eedom rejects, SKEPTIC findings,
  repeated failures) into durable guardrails in a versioned **rules registry** — auto-binding safe
  deterministic ones, proposing the rest (ADR-0020). Rules reach future agents as **gates** (zero
  prompt tokens until violated) or **relevance-scoped steering** in the Task Packet, so token cost per
  task trends down as the pipeline learns.

---

## 7. Where datum-ax comes from (and how it differs)

**Lifted from datum (proven, evidenced in review):** the lane DAG + git-worktree file ownership,
mandatory TDD gates, the model escalation ladder, the command allowlist (`command_guard.py`), the
observation sanitizer (`strip_secrets` + invisible-unicode/special-token stripping), rules-salting
with tamper detection, subprocess `setrlimit` caps, and loop/repetition detection.

**Net-new:** the LangGraph state machine + Valkey checkpointer, asymmetric multi-host execution, the
context firewall, the explicit 3-attempt prune+adversarial loop, and eedom as the deterministic gate.

**Datum flaws explicitly fixed:** tri-source state drift (`state.db` + `state.json` +
agent-written `pipeline-state.json`) → one authoritative store per tier with no LLM-mediated writes;
advisory lint gates that write anyway → **blocking** discipline gates; in-process `delegate_task`
subagent → isolated execution host; stringly-typed TS↔Python `agent("…")` seam → pure-Python typed
contracts; late 80%-threshold compaction → proactive pruning. (Full table in ADR-0008.)

---

## 8. Differing opinions / pressure-test

The source blueprint is strong on the load-bearing ideas and over-built on infrastructure. Honest
positions taken in this design:

- **Three *physical* hosts are not required.** The logical separation is; the physical count is a
  deployment knob behind `ExecutionHost`. v1 ships x86 only; macOS is an optional stubbed adapter.
- **"Eliminate Postgres to avoid MVCC write amplification" is over-justification.** The real reason
  for Valkey + libSQL is simpler: volatile RAM state for the hot loop, a simple file DB for the
  durable ledger. (It also mirrors datum's existing SQLite/DuckDB choices.)
- **Two-tier RAM+SSD KV cache is not a dependency.** The papers cited for it are fabricated
  (RESEARCH-NOTES). The real, verified win is **prompt-prefix caching** via a stable prompt prefix —
  which this design enforces structurally.
- **Speculative model names are not wired in.** The blueprint's `Qwen3.5/3.6-…` names are
  unverifiable. datum-ax pins **roles** (triage / executor / adversarial); the **model IDs are
  config**, defaulting to verified families (Qwen3 MoE, DeepSeek-R1).
- **oMLX and Headroom.ai are user-locked but adapter-isolated.** Independent verification was weak;
  wrapping each behind a one-method contract means a wrong bet costs one adapter, not the architecture.
- **The eedom gate must be deterministic.** Putting an LLM in the review decision would defeat the
  purpose; eedom's value is precisely that it has *zero LLM in the decision path*.

---

## 9. Validating the design (when code work begins)

A single vertical slice proves the contracts: **triage → plan (one lane) → one x86 sandbox attempt →
eedom gate**. It exercises `ExecutionHost`, `InferenceClient`, the prompt assembler, and the eedom
decision contract end-to-end without building the whole system. Everything else layers onto that spine.
</content>
