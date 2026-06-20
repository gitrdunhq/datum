# Gap Ledger — MVP → Aspirational

The ADRs are the **north star** (intent); the code is an **MVP**. This ledger is the delta — what's
stubbed today vs the ADR target — so iteration is directed, not vibes. Each row has an ADR, the
current MVP state, the aspirational target, and the acceptance demo that proves the climb.

> Rule: we iterate the MVP **up** toward the ADRs. We do **not** downgrade ADRs to match stubs. When a
> climb lands, update the row (and the ADR's "as-built" note if its decision genuinely evolved).

| # | Area | ADR | MVP today | Aspirational target | Acceptance demo | Priority |
|---|------|-----|-----------|---------------------|-----------------|----------|
| G1 | ContextCrane wiring | 0030 | ✅ **landed** — graph injects the crane; triage/lane_plan/synthesis build initial prompts via `crane.assemble` (per-phase budget). Retry-prompt rebuilds still inline. | every model prompt (incl. retries, with real hoisting) via the crane | graph run routes prompts through `crane.assemble`; oversized → `ContextBudgetExceededError` ✔ | **P0 ✅ (retries remain)** |
| G2 | Context adapters | 0004 | `adapters.py` return canned strings | real Serena/TokenSave (code) + Context7/Headroom (NL) | a lane's packet contains real hoisted symbols + compressed docs | P1 |
| G3 | Token counter | 0030 | `len//4` heuristic | injected real tokenizer (e.g. tiktoken/MLX) | counter swap changes budget math; crane/DCP/client all use it | P2 |
| G4 | Execution host | 0011/0012 | `LocalHost` (patch); Docker/Tart shells | hardened `X86DockerHost`: egress allowlist, rlimits, guaranteed teardown | apply+test a diff in a container; teardown leaves nothing; egress blocked | P1 |
| G5 | eedom gate | 0006 | `core/eedom/adapter.py` shell | real containerized `eedom evaluate` (OPA + Opengrep), version-pinned | clean diff → approve, secret-leak diff → reject; eedom error → needs_review | P1 |
| G6 | Data plane | 0005/0013/0031/0032 | 🟡 **ledger + checkpointer pluggable** — SQLite ledger behind `RunLedger` (run-scoping/metering/persistence); `InMemoryCheckpointer` resume behind `CheckpointStore`; `build_ledger`/`build_checkpointer` factories (centralized = config swap). Real Postgres/Valkey adapters + per-run DB branch remain. | local + centralized adapters behind both ports; per-run DB branch | ledger metered+swappable ✔; resume roundtrip ✔; real centralized backends pending | P2 |
| G7 | Verifier rigor | 0007/0010/0017 | MVP heuristics (discipline/SKEPTIC) | real RED-before-GREEN, REFLECT scoring, adversarial bug-hunt, 3-attempt prune | a planted bug is caught by SKEPTIC; RED-before-GREEN enforced | P2 |
| G8 | Compounding | 0020 | not built | CLOSEOUT harvest → versioned rules registry → next-run gates | run 2 catches a pattern run 1 was rejected for, at zero extra tokens | P3 |
| G9 | GitHub projection | 0023 | not built (CLI run/status only) | epic + sub-issue mirroring, `wave:`/`status:` labels, sync | `datumax run` mirrors a real epic issue + checklists | P3 |
| G10 | Live oMLX | 0003 | mock-tested; transports exist | smoke run against the user's oMLX endpoint | `datumax run` completes a real tic-tac-toe lane on hardware | P1 |
| G11 | Port the remaining seams | 0032 | 🟡 **eedom → `ReviewGate` (plugin registry) + status → `StatusSource` ported**; eedom I/O moved core→data; returns typed `ReviewDecision` (fail-open). GitHub projection still concrete/unbuilt. | each external dep behind a port + factory + conformance suite | ReviewGate/StatusSource conformance ✔; eedom enhancement (emit ReviewDecision JSON) + GitHub port remain | P2 |

**Sequencing intuition:** G1 (crane wiring) is the unlock — it gives one seam to then drop real
adapters (G2) and a real tokenizer (G3) behind. G4/G5/G10 make execution+review real. G6 makes state
durable. G7 deepens quality. G8/G9 are the compounding/human-surface layers.
</content>
