# ADR-0017: REFLECT + SKEPTIC — Adversarial Verification (distinct from eedom)

## Status

Accepted (design)

## Context

datum runs two verification stages the first datum-ax pass collapsed into a single "adversarial"
error-reformatter:

- **REFLECT** — an independent post-RED score of whether the tests actually exercise the ACs;
  gates below a threshold.
- **SKEPTIC** — a post-GREEN adversarial panel (edge / error / contract lenses) that hunts bugs the
  suite missed, each finding backed by EVIDENCE, ending in a VERDICT (`PASS` / `FRAGILE` / `BROKEN`).

These are not the same as the error-reformatter, and not the same as eedom. We separate the
ADVERSARIAL role's jobs.

## Decision

Three distinct adversarial touchpoints, ordered in the Phase-B loop:

```
RED ─▶ REFLECT(gate) ─▶ GREEN ─▶ [tests pass?] ─no─▶ error-reformat (ADR-0007) ─▶ retry
                                       │ yes
                                       ▼
                              SKEPTIC ─▶ VERDICT(gate) ─▶ discipline gates ─▶ eedom gate
```

- **REFLECT** — cheap/independent (small model or deterministic heuristics over the PROPERTIES↔AC
  map, ADR-0016). If tests don't cover the mapped properties, reject back to RED. Token-cheap.
- **SKEPTIC** — the ADVERSARIAL (reasoning) role, run **only on passing code**, probing
  edge/error/contract lenses; every finding requires EVIDENCE; emits a VERDICT. `FRAGILE`/`BROKEN`
  routes back to the executor (consumes a loop attempt); `PASS` proceeds.
- **Error-reformatter** (ADR-0007) stays separate: it handles **test failures**, SKEPTIC handles
  **passing-but-suspect** code.

**SKEPTIC vs eedom are complementary, not redundant:** SKEPTIC is an *LLM adversary* finding
*behavioral* bugs; eedom is *deterministic* policy/vuln/license/secret review with zero LLM. SKEPTIC's
VERDICT gates the loop; eedom's `decision` gates the push.

All of this is **ROUTE- and tokenomics-gated** (ADR-0018, ADR-0009): SKEPTIC depth scales with
COMPLEXITY; trivial routes may skip it.

## Consequences

- Stronger correctness *before* the deterministic gate, with the expensive reasoning model used
  surgically (passing code only) rather than on every attempt.
- `VERDICT` (loop gate) and eedom `decision` (push gate) are distinct, recorded separately in the ledger.
- Risk: false-positive SKEPTIC findings burn attempts; bounded by the 3-attempt cap (ADR-0007) and the
  mandatory-EVIDENCE rule.
- REFLECT must consume the PROPERTIES↔AC map (ADR-0016) — sequencing dependency.
