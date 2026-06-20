# ADR-0006: eedom as the Deterministic Review Gate

## Status

Accepted (design)

## Context

The pipeline must not merge or push code that fails policy, has known-vulnerable dependencies, leaks
secrets, or violates license rules. Putting an LLM in that decision would defeat the purpose. `eedom`
is purpose-built for exactly this: **fully deterministic dependency + code review, zero LLM in the
decision path.** This ADR is authored first (it is the contract every consumer branches on).

eedom's deterministic engines (for accuracy, since datum-ax depends on them):
- **OPA / Rego** — the policy decision engine (the `deny`/`warn` rules that produce the verdict).
- **Opengrep** — static code scanning (Semgrep-compatible syntax, **local rules only, no registry
  dependency**); eedom replaced Semgrep with Opengrep.
- plus dependency / secret / license / SBOM scanners (e.g. trivy, osv-scanner, gitleaks, scancode,
  syft). datum-ax treats all of these as eedom's internals and depends only on the decision contract
  below — but the engine names matter for the container/version pinning in ADR-0013/0015.

## Decision

Run eedom as a **deterministic node** in Phase B, before any terminal success. Invoke it in a
container against the candidate diff and consume its machine-readable decision:

```
# eedom's real required flags (verified against src/eedom/cli/main.py): repo-path, diff (a file),
# pr-url, team, operating-mode; --output-json writes his published ReviewDecision JSON to a file.
eedom evaluate --repo-path /workspace --diff change.diff --pr-url <url> --team <team> \
               --operating-mode advise --output-json /out/decision.json
# (or `eedom review --format sarif` for the code-scan surface)
```

`EedomReviewGate` (datum-ax `data/review/eedom.py`) invokes exactly this and reads the decision back
from the `--output-json` file. Branch on the verified `ReviewDecision` contract (confirmed against
eedom `core/models.py`; his verdict + severity enums match ours 1:1, his category set is broader and
is mapped):

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
