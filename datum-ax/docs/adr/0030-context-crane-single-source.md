# ADR-0030: ContextCrane — Single Source of Truth for Context Assembly

## Status

Accepted (built)

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
- **Follow-up (tracked):** the inline `AssembledPrompt(...)` construction in `planner/triage`,
  `planner/lane_plan`, and `verifier/synthesis` should route through the crane so *all* packets flow
  through the single source. Until then, those build the `AssembledPrompt` contract directly for
  zero-context prompts; the crane is the sanctioned path for anything with hoisted context.
- Property/behaviour targets: Determinism (same inputs → same packet), Boundedness (assembled packet
  never exceeds `max_input`), Integrity (essential prefix over budget always raises, never silently
  truncates).
