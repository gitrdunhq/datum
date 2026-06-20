# ADR-0035: Subagent Harness for Playbook Skills

## Status

Accepted. **As-built (deterministic seam):** `Skill.delivery: inline|subagent` exists;
`gitnexus-bug-hunt` + `agentic-research-workflow` are tagged `subagent`; the crane's `_render_skills`
**filters out subagent skills**, so a playbook can never be inlined (in the prefix or the variable
slot). A `Worker` port (`contracts/worker.py`) + `WORKERS` registry + `FakeWorker` adapter encode the
run-a-playbook contract (`run(playbook, inputs, output_schema) -> WorkerResult`). The **live** worker
(GitNexus MCP + oMLX tool loop, canary spawning) remains hardware-gated. GAP-LEDGER **G13**.

## Context

Skills (ADR-0033) are lifted into the `[System]` prefix as text. That works for *steering* skills
(short, advisory — `gitnexus-debugging`, `swift-clean-architecture`, the rules). It does **not** work
for *playbook* skills: `gitnexus-bug-hunt` (a 13 KB methodology that traces execution flows, runs
`gitnexus_*` queries in a loop, and produces findings) and `agentic-research-workflow` (which itself
*describes* spawning investigation + validation sub-agents). When the crane tried to inline
`bug-hunt` on a retry, the DCP pruned it — the firewall correctly rejecting a procedure masquerading
as steering.

Three reasons inlining is the wrong delivery for a playbook:

1. **Tool use + iteration.** A playbook calls tools (GitNexus MCP) and reasons over results across
   turns — a tool-calling loop, not one completion over 13 KB of instructions.
2. **Context isolation (BASE_PERSONA §2).** *"The orchestrator never does raw work — it protects its
   context window and spawns one-shot workers."* The playbook text and all intermediate tool output
   belong in the **worker's** window; only a compact structured result returns to the orchestrator.
   Inlining does the opposite.
3. **Determinism boundary (ADR-0034).** The worker *reasons*, but it returns **findings**, which feed
   the deterministic eedom/discipline gate (ADR-0006/0010). It never emits a verdict. Cognition in
   the worker; the gate stays zero-LLM.

## Decision

**Skills have a delivery mode; playbooks run on a subagent harness, not the prompt.**

- **`Skill.delivery: inline | subagent`.** `inline` skills are lifted by the crane (today's
  behavior). `subagent` skills are **never inlined** — the crane skips them — so over-lifting a
  playbook is structurally impossible, not budget-dependent. Tag `gitnexus-bug-hunt` and
  `agentic-research-workflow` as `subagent`.
- **A `Worker` (subagent) port** — `run(playbook, inputs, output_schema) -> StructuredResult` —
  behind a registry, same port+adapter+registry shape as everything else. The playbook becomes the
  worker's system prompt; the worker has scoped tool access and a **typed JSON output contract**
  (ADR-0027); its window is isolated and discarded (ADR-0012-style), so only the result crosses back.
- **Orchestrator spawns workers** per BASE_PERSONA §2: scope-gate first, **canary one** before a
  batch, validate results. Workers are a tokenomics lever (ADR-0009) — heavy raw work is pushed off
  the orchestrator's context.
- The harness is **cognition** (it reasons + uses tools); its output is evidence for a gate, never a
  gate decision.

## Consequences

- **Buildable now (deterministic, testable):** the `delivery` field + tagging, the crane skipping
  `subagent` skills, and the `Worker` port + registry + a fake adapter (typed contract, isolation
  semantics). This hardens the over-lift fix permanently.
- **Gated on hardware (cf. G10):** the real worker adapter — a tool-calling loop against the GitNexus
  MCP + oMLX with canary-first batch spawning — needs a live model + tools, so it can't run in CI/
  this sandbox.
- A clean home for ADR-0017's SKEPTIC and the research workflow's investigation/validation agents:
  all are workers behind this one port.
