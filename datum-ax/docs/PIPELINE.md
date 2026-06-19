# datum-ax — End-to-End Pipeline (ASCII)

One picture of the whole system. ADR references in `[brackets]`. Read top-to-bottom for the run
lifecycle; the side panels are the cross-cutting planes that hold during the whole run.

## 1. The spine — TICKET → merged branch

```
                                   ┌─────────┐
                                   │ TICKET  │  issue / request
                                   └────┬────┘
                                        ▼
                    ROUTE select  (deterministic, 0 tokens)              [0018]
              COMPLEXITY / SCOPE / AMBIGUITY → feature|hotfix|spike|audit|resume
                                        │
   ╔════════════════════════════════════▼═══════════════════════════════════════╗
   ║  PHASE A — Triage & Planner  (sub-graph, Valkey-checkpointed)        [0002]  ║
   ║                                                                             ║
   ║   REFINE      Serena + TokenSave → Global AST/map  ──────►  SPEC      [0004] ║
   ║   TRIAGE      deterministic platform route  →  x86 | macOS  (0 tok)  [0001] ║
   ║   PLAN        DAG of lanes: contract-first order, git-worktree owner [0010] ║
   ║                 • sized so essentials fit the window budget → split  [0022] ║
   ║                 • GitNexus impact / deps (NOT used inside loop)      [0019] ║
   ║   PROPERTIES  invariants in eedom DPS-12 taxonomy, traced to lanes   [0016] ║
   ╚════════════════════════════════════╤═══════════════════════════════════════╝
                                         │ yield static step array
                                         ▼
                  SCHEDULER: waves / batches, throttled by oMLX semaphore  [0015]
                                         │
   ╔════════════════════════════════════▼═══════════════════════════════════════╗
   ║  PHASE B — Verification loop   (per lane, ≤ 3 attempts)        [0007]        ║
   ║                                                                             ║
   ║    ┌──────────────────────── retry: prune attempt, ≤3 ◄───────────────┐    ║
   ║    │                                                                    │   ║
   ║   RED ─► REFLECT ─► GREEN ─► apply diff ─► run tests / lint             │   ║
   ║  (tests) (gate)   (EXECUTOR  (ExecutionHost,    │                       │   ║
   ║          [0017]    @oMLX)     sandbox) [0012]   │                       │   ║
   ║                                                 │                       │   ║
   ║                         tests FAIL ─► DCP prune + error-reformat ───────┘   ║
   ║                                       (ADVERSARIAL)        [0021][0007]      ║
   ║                              tests PASS                                      ║
   ║                                   ▼                                         ║
   ║   SKEPTIC (ADVERSARIAL) ─► VERDICT ── FRAGILE/BROKEN ─► back to executor    ║
   ║   edge/error/contract     [0017]                                            ║
   ║                              │ PASS                                          ║
   ║                              ▼                                              ║
   ║   DISCIPLINE gates: RED-before-GREEN · contract tests · lint ·             ║
   ║                     learned Opengrep rules          [0010]                  ║
   ║                              │ clear                                        ║
   ║                              ▼                                              ║
   ║   eedom GATE  (DETERMINISTIC, 0 LLM):  OPA verdict + Opengrep scan +        ║
   ║               dep/secret/license/SBOM                [0006]                 ║
   ║                  │ approve                 reject / needs_review            ║
   ╚══════════════════╪═══════════════════════════════╪═════════════════════════╝
                      ▼                               ▼
              ┌──────────────┐          findings → executor (consume attempt),
              │  CLOSEOUT     │          or interrupt() → human            [0014]
              │  push branch  │
              │  + HARVEST ───┼──► lessons → rules registry                [0020]
              └──────────────┘
```

## 2. Topology — where it runs (cognition ≠ execution)

```
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ NODE 0 — ORCHESTRATOR (Apple Silicon)     ✗ never runs generated code        │
 │   LangGraph state machine + Valkey checkpointer                 [0002]       │
 │   oMLX inference:  TRIAGE · EXECUTOR · ADVERSARIAL   (semaphore max=2) [0003] │
 │   Context firewall + prompt assembler → TASK PACKET             [0004]       │
 │   authoritative git worktree(s) · ALL secrets live here        [0011/0012]   │
 └───────────────┬──────────────────────────────────────┬────────────────────┘
                 │  diff in ▼          ▲ exit code + stderr + artifacts out
                 │  (no credentials, no orchestrator env ever cross this line)
        ┌────────▼─────────┐                    ┌────────▼─────────────┐
        │ NODE 1 — x86      │                    │ NODE 2 — macOS        │
        │ Docker sandbox    │                    │ Tart VM / SSH         │
        │ PRIMARY · egress  │                    │ OPTIONAL (Swift/Darwin│
        │ allowlist·rlimits │                    │ ) · stub in v1        │
        └───────────────────┘                    └───────────────────────┘
```

## 3. The context window — generous if every character is controlled  [0003/0013]

```
   WINDOW BUDGET  (~80k generous when curated; target ≤ ~48–64k per call)
   ────────────────────────────────────────────────────────────────────
   PLAN   lanes sized so ESSENTIALS fit; 1-turn blowup ⇒ replan, not prune [0022]
   IN     firewall: Serena/TokenSave = exact code (lossless)               [0004]
                    Context7 → Headroom.ai = NL only (compressed)
                    + only the rules relevant to this lane's symbols/flows
   STAYS  DCP: prune stale/duplicate/bulky tool outputs → retrievable      [0021]
              placeholders. Triggers: watermark(primary) · pre-dispatch
              guard · event · ~10-turn sweep(backstop)
   OUT    RemoveMessage: hard-delete failed attempts                       [0007]
   ────────────────────────────────────────────────────────────────────
   OOM GUARANTEE:   max_connections × per-call window  ≤  unified memory   [0003]
   (oMLX provides KV + SSD cache → helps TTFT, NOT active-window pressure)
```

## 4. Data plane & compounding (hold across the whole run)

```
  ┌── Valkey (hot, :6379) ──────────┐   ┌── libSQL / sqld (durable) ─────────────────┐
  │ LangGraph checkpointer          │   │ run ledger · token + WINDOW metering        │
  │ volatile DAG state · resume     │   │ artifacts · per-run DB branch (file-copy)   │
  └─────────────────────────────────┘   │ RULES REGISTRY (versioned, evidence-backed) │
                              [0005]     └─────────────────────────────────────────────┘

  COMPOUND ENGINEERING — every run leaves the pipeline smarter                 [0020]
  ──────────────────────────────────────────────────────────────────────────────────
   CAPTURE (CLOSEOUT harvest):  eedom rejects · SKEPTIC findings · failures · lane-plan
     blowups · routing data  ──►  rules registry
        tier:  auto-bind safe (regression tests, tightened/Opengrep rules, routing) │
               propose-and-gate new/risky (new rules, eedom policy, blocking PROPERTIES)
   DELIVER next run:  ① deterministic GATES (0 prompt tokens, no bloat)  ──► eedom/discipline
                      ② scoped STEERING in the Task Packet (global=stable prefix;
                         lane=relevant rules only, via Serena+GitNexus)
```

## Legend

```
  EXECUTOR / TRIAGE / ADVERSARIAL = oMLX model roles (IDs are config)    [0003/0009]
  DETERMINISTIC / 0 tokens        = no LLM in this step (triage, gates, routing, eedom)
  [NNNN]                          = ADR reference (docs/adr/)
  ═ box                           = a LangGraph sub-graph
```
</content>
