# ADR-0006: eedom as the Deterministic Review Gate

## Status

Accepted (design)

## Context

The pipeline must not merge or push code that fails policy, has known-vulnerable dependencies, leaks
secrets, or violates license rules. Putting an LLM in that decision would defeat the purpose. `eedom`
is purpose-built for exactly this: **fully deterministic dependency + code review, zero LLM in the
decision path.** This ADR is authored first (it is the contract every consumer branches on).

## Decision

Run eedom as a **deterministic node** in Phase B, before any terminal success. Invoke it in a
container against the candidate diff and consume its machine-readable decision:

```
eedom evaluate --repo-path /workspace --diff - --operating-mode advise --output-json /out/decision.json
# (or `eedom review --format sarif` for the code-scan surface)
```

Branch on the verified `ReviewDecision` contract (confirmed against eedom
`core/models.py`):

| Field | Values | Gate behavior |
|-------|--------|---------------|
| `decision` | `approve` · `reject` · `needs_review` · `approve_with_constraints` | `reject`/`needs_review` block terminal success |
| `should_mark_unstable` | bool (advise: true on `reject`\|`needs_review`) | true → not a pass |
| `findings[]`, `policy_evaluation.triggered_rules` | structured | fed back to the executor as targeted fixes |
| `memo_text` | pre-rendered Markdown | reused for any human-facing comment |

On a blocking verdict: route findings back to the executor (consumes a loop attempt), or
`interrupt()` for a human if attempts are exhausted. **No LLM runs in this node.**

## Consequences

- The review decision is reproducible and auditable — same diff, same verdict.
- eedom runs in its own container (it ships hardened with checksum-verified binaries); the
  orchestrator mounts the candidate worktree read-only and reads `decision.json` back.
- Operating mode is a policy knob: `advise` gates (marks unstable), `monitor` logs only. datum-ax
  defaults to `advise` for the pre-push gate.
- eedom is **fail-open by design** (a scanner failure never blocks a build); datum-ax treats an eedom
  *execution* failure as `needs_review`, not silent pass, so the gate cannot be bypassed by crashing it.
- eedom timeouts (scanner=60s … pipeline=300s) inform this node's timeout budget (ADR-0013).
</content>
