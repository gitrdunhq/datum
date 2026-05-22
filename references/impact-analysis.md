# Playbook: Impact Analysis with GitNexus

**Goal:** Understand exactly what will break if code is modified, mathematically calculating blast radius before any code changes are made.

## Workflow

1. Identify the target symbol (function, class, module) the `TICKET.md` requires changing.
2. Run `gitnexus_impact({target: "X", direction: "upstream"})` to find what depends on it.
3. Assess the risk level.
4. Record the findings in the `SPEC.md` "Blast Radius & Impact Analysis" section.

> **Note:** If GitNexus reports "Index is stale", run `npx gitnexus analyze` in the terminal first.

## Understanding Output

| Depth | Risk Level       | Meaning                  |
| ----- | ---------------- | ------------------------ |
| d=1   | **WILL BREAK**   | Direct callers/importers |
| d=2   | LIKELY AFFECTED  | Indirect dependencies    |
| d=3   | MAY NEED TESTING | Transitive effects       |

## Risk Assessment

| Affected                       | Risk     | Action Required in Refine Phase |
| ------------------------------ | -------- | ------------------------------- |
| <5 symbols, few processes      | LOW      | Proceed normally                |
| 5-15 symbols, 2-5 processes    | MEDIUM   | Detail safeguards in SPEC       |
| >15 symbols or many processes  | HIGH     | Explicit test-plan required     |
| Critical path (auth, payments) | CRITICAL | **Trigger Advisory LLM Call**   |

### CRITICAL Risk Protocol
If the risk is CRITICAL, the Refine agent MUST pause and trigger a call to the highest available reasoning model (e.g. o1 or claude-3-5-sonnet/opus). Present the highest model with the impact graph and ask it to act as a **Safeguard Advisor**. The advisor's recommendations must be explicitly documented in the `SPEC.md`.

## Example: "What breaks if I change validateUser?"

1. `gitnexus_impact({target: "validateUser", direction: "upstream"})`
   → d=1: `loginHandler`, `apiMiddleware` (WILL BREAK)
   → d=2: `authRouter`, `sessionManager` (LIKELY AFFECTED)
2. Risk: 2 direct callers, 2 processes = MEDIUM.
3. Record in SPEC: "Blast Radius: Modifying validateUser will directly break loginHandler and apiMiddleware. Update their tests."
