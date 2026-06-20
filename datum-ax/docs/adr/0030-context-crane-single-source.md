# ADR-0030: ContextCrane — Single Source of Truth for Context Assembly

## Status

Accepted (built). **As-built:** the crane is now a first-class **mandatory plugin** behind the
`ContextAssembler` port (`contracts/context_assembler.py`), resolved from the `CONTEXT_ASSEMBLERS`
registry by the composition root (ADR-0032) — same port+adapter+registry shape as ReviewGate /
PersonaRegistry. "Single source of truth" is unchanged: there is always exactly **one** assembler
(default `crane`); an unknown/absent key is a hard error, never a silent fallback. Consumers depend
on the port, not the concrete class.

## Context

Context/prompt assembly had drifted to **three** implementations — `ContextCrane.pack_payload`
(core), `PromptAssembler.assemble` (data), and inline `AssembledPrompt(...)` construction in the
planner/verifier nodes — plus **four** copies of the token heuristic (`len // 4`) in the crane,
assembler, DCP, and the inference client. That is exactly the kind of duplication that drifts out of
sync. We demand a single source of truth.

## Decision

**`ContextCrane` (core) is the single source of truth for context assembly.** It owns the whole
window: the Context Firewall (ADR-0004), Dynamic Context Pruning (ADR-0021), and Budget-Aware Lane
Granularity (ADR-0022), via one path: **hoist → assemble → prune → budget-check**, with cross-payload
symbol dedup.

- **One assembler.** `PromptAssembler` is **retired**; its assemble+prune+budget logic now lives in
  `ContextCrane.assemble()`. Nothing else constructs a task packet's prefix/suffix policy.
- **One token counter.** `contracts.tokens.default_token_count` (+ a `TokenCounter` type) is the
  single estimator, imported by the crane, DCP, and the inference client. Inject a real tokenizer
  where exactness matters.
- **One pruner, behind a contract.** DCP is exposed as the `contracts.context.ContextPruner` port and
  **injected** into the crane, so core orchestrates pruning without importing a `data` concrete
  (ADR-0026). This makes the crane's "orchestrates DCP" claim true.
- **One budget-exceeded signal for context:** `ContextBudgetExceededError` (core). (The inference
  layer keeps its own `BudgetExceededError` for the per-call pre-dispatch guard — a distinct concern.)

The crane depends only on contract Protocols (`CodeContext`, `DocContext`, `NlCompressor`,
`ContextPruner`) + the token counter; the data adapters are injected by the composition root.

## Consequences

- A change to assembly, pruning, or budgeting happens in exactly one place.
- The crane is now a real, tested component (firewall + DCP + budget + dedup), not shelfware.
- **Wired in (G1, integration-sweep):** the graph now injects a `ContextCrane` via
  `config['configurable']['context_crane']` (built by the composition root), and `planner/triage`,
  `planner/lane_plan`, and `verifier/synthesis` build their **initial** prompt via
  `crane.assemble(..., budget=...)`. The production loop therefore routes assembly through the single
  source and enforces the per-phase budget on every prompt. (A bare-prompt fallback remains for direct
  unit calls without a crane.)
- **Retries routed (G1 done):** the retry/reformat prompt rebuilds in triage/lane_plan/synthesis now
  also go through `crane.assemble` (a local `_assemble` helper) — *every* prompt is crane-assembled.
- **Remaining:** real hoisting (symbols/docs via `pack_payload`) lands with G2 (real adapters).
- Property/behaviour targets: Determinism (same inputs → same packet), Boundedness (assembled packet
  never exceeds `max_input`), Integrity (essential prefix over budget always raises, never silently
  truncates).
