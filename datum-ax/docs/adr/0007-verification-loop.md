# ADR-0007: The Verification Loop (3-Attempt, Prune + Adversarial Reformat)

## Status

Accepted (design)

## Context

Code generation rarely succeeds first try. datum handles failure inside multi-turn generation but has
no structured, bounded retry with context pruning, and its history accumulates until an 80% threshold
compaction — by which point the prompt may already have overflowed. We want a tight, cache-friendly,
token-efficient loop with a hard stop.

## Decision

Phase B runs a per-step loop, **max 3 attempts**:

1. **Execute** — assemble `[System]+[AST]+[Diff]` + compressed NL docs; call the `EXECUTOR` role via
   the semaphore.
2. **Sandbox apply** — `ExecutionHost.apply_diff()` → `run_tests()`/`run_lint()`.
3. **Verify & prune** — on failure, capture exit code + stderr, then **prune the failed attempt from
   the context array** with `RemoveMessage`, **eagerly** (immediately, not at a threshold). Bulky tool
   outputs (test/lint logs, file reads) are handled by **Dynamic Context Pruning** — replaced with
   retrievable placeholders rather than hard-deleted (ADR-0021). The array stays small, the prefix
   stays cache-stable, and — critically on Apple Silicon — the **in-memory window stays comfortably
   inside the ~80k window and away from OOM** (ADR-0003/0013). Pruning here is an OOM-avoidance
   mechanism, not only a token optimization.
4. **Adversarial reformat** — the `ADVERSARIAL` role rewrites the isolated stderr into the next
   `EXECUTOR` prompt (it sees the error, not the whole failed transcript).
5. **Gates** — discipline gates (ADR-0010) then the eedom gate (ADR-0006), both deterministic.
6. **Terminal** — at attempt 3: push the branch, or `interrupt()` to suspend for a human.

Loop/repetition detection (n-gram + tool-signature, lifted from datum) breaks degenerate cycles
before the cap. `recursion_limit` is the hard backstop.

## Consequences

- Pruning is proactive (every failed attempt), not threshold-triggered — directly serves tokenomics
  and keeps the oMLX prompt cache warm.
- The adversarial role isolates *signal* (the error) from *noise* (the failed attempt), which both
  saves tokens and improves the next attempt.
- **Idempotency invariant (ADR-0002):** each attempt's side effects must be safe to replay on resume;
  sandbox apply uses a throwaway checkout (ADR-0012), and pushes happen only at the terminal state.
- Three is a default, not a law — it lives in config alongside the per-node timeouts (ADR-0013).
- Terminal `interrupt()` requires the human-resume path (ADR-0014); side effects must sit after the
  interrupt.
