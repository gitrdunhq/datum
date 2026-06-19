# ADR-0020: Compound Engineering — the Learning Loop

## Status

Accepted (design)

## Context

Each run currently starts fresh. A mistake caught by eedom or SKEPTIC this week can be repeated next
week, because nothing remembers the lesson — the pipeline re-pays for it in tokens and attempts every
time. **Compound engineering** means each run leaves the pipeline smarter: lessons become durable
guardrails. This is the same arrow as tokenomics (ADR-0009) — a lesson baked into a gate is work the
model never re-does and tokens never re-spent.

datum already has the raw ingredients (run ledger, CLOSEOUT retrospective, corpus memory); what is
missing is a first-class loop that **captures** lessons and **delivers** them to future agents.

**Decision policy (user-chosen): tiered binding** — auto-bind safe, deterministic lessons;
propose-and-gate new or risky ones.

## Decision

### A. Capture — lessons become rules (CLOSEOUT harvest)

CLOSEOUT gains a **harvest** step that turns run outcomes from the ledger (ADR-0013) into candidate
artifacts, bound under two tiers:

- **Auto-bind** (safe, deterministic, evidence-backed):
  - a **regression test** for a bug just fixed (RED that now stays green);
  - **tightening an existing rule's** parameters (incl. an existing **Opengrep** rule);
  - **routing/threshold tuning** data (ADR-0009);
  - **lane-sizing heuristics** learned from `lane-plan` blowups (ADR-0022) — the planner gets better
    at granularity over time;
  - **solution-memory** entries — retrieval-only, never binding.
- **Propose-and-gate** (new/risky — surfaced for a yes/no):
  - new **discipline rules** (ADR-0010), including new **local Opengrep rules**;
  - new/edited **eedom policies** (ADR-0006);
  - new **blocking PROPERTIES** (ADR-0016);
  - any **prompt/steering guidance**.

**Opengrep as the natural harvest target for code patterns.** Because eedom uses **Opengrep with
local rules and no registry** (ADR-0006), a learned *code anti-pattern* (e.g. the pattern behind a
recurring SKEPTIC finding or eedom reject) can be harvested directly as an **Opengrep rule file
committed into the repo**, sitting beside eedom's existing custom rules. This is the cleanest concrete
instance of "lesson → deterministic gate": the next run's diff is scanned for the pattern with **zero
prompt tokens**, and no external rule registry or network is involved. A *new* such rule is
propose-and-gate; *tightening* an existing one is auto-bind.

Every learned artifact is **evidence-backed** (≥1 real reject/failure, not a single model opinion),
**versioned, attributable** to the originating run, and **revertible**. The ledger records which rules
fire; never-firing/stale rules are pruned. This is the anti-poisoning and anti-bloat guarantee.

### B. Delivery — how rules reach agents as they build

Two paths; the deterministic one is preferred and is the scaling answer:

1. **Deterministic gates (preferred).** Most rules live in **config**, not the prompt — the discipline
   policy (ADR-0010), eedom policies (ADR-0006), and PROPERTIES (ADR-0016). They run on the agent's
   diff and reject violations. A rule in a gate costs **zero prompt tokens until violated**, so the
   prompt never bloats as the rulebook grows run after run.
2. **Scoped steering in the Task Packet (ADR-0004).** Rules better known *before* writing are compiled
   into the packet with prompt-cache discipline:
   - **global, project-wide rules** → the **stable `[System]` prefix** (cache-friendly across lanes);
   - **lane-specific rules** → the **variable slot, selected by relevance** — only rules tagged to the
     files/symbols/execution-flows this lane touches (via Serena + GitNexus, ADR-0019), never the whole
     rulebook.

### Rules registry

A **versioned rules registry** in the target repo/config is the single source of truth. It is loaded
at **onboarding** (ADR-0015); gates register from it; the prompt assembler selects steering from it;
the harvest step writes to it. Registry entries carry: id, evidence link, scope tags (path/symbol/flow/
language), tier (auto/gated), version, and fire-count.

## Consequences

- The pipeline improves measurably over time; token cost per task trends **down** as guardrails accrete
  — compounding and tokenomics reinforce each other.
- Preferring gates over prompt text means rule growth does not degrade the context window — the
  "build and build" scaling concern is structurally answered.
- Relevance-scoped steering keeps per-lane prompts small; prefix discipline preserves prompt-cache hits.
- The tiered policy keeps momentum on safe lessons while preventing a wrong lesson from entrenching
  itself; revertibility + fire-count pruning keep the registry curated.
- New dependency: a registry schema + harvest logic in CLOSEOUT, and rule-selection in the assembler.
- Property-test targets: Monotonicity (a reverted rule never silently re-binds), Non-repudiation
  (every learned rule traces to its evidence), Boundedness (the active rule set stays curated, not
  monotonically growing).
