# Phase: Review

**Goal:** Produce a structured REVIEW-REPORT.md from per-domain review packets, each grounded in the actual diff.

## Inputs

- The work branch diff vs main
- `SPEC.md`, `PROPERTIES.md`, `TASKS.md`
- GitNexus `impact` per finding (if available)
- `.datum/profiles/quality.yaml` — repo-specific review dimensions and pass policy (if present)

## Review Domains

If `.datum/profiles/quality.yaml` exists, use its `review_dimensions` as the domain list
instead of the defaults below. Weights and pass conditions come from the profile.
The `pass_policy` determines gate verdict — if absent, default to requiring no `high` findings.

Default domains (used when no quality profile exists):

Instead of spawning concurrent agents per domain, **a single Review Agent** runs a rigorous multi-pass checklist, producing one unified JSON packet of findings (see `assets/schemas/packet.schema.json`).

| Domain | Focus |
|---|---|
| correctness | Does the implementation match the SPEC and ACs? |
| properties | Are all PROPERTIES.md invariants demonstrably held? |
| security | OWASP top 10, injection, auth, secrets exposure |
| performance | Hot paths, N+1 queries, unbounded operations |
| architecture | Tier violations, coupling, layer boundary respect |
| observability | Logging, metrics, error messages per DPS-6/DPS-10 |

## Steps

### 1. Prepare review packet

Create a pre-filled JSON packet envelope for the single agent:
```json
{
  "schema_version": "1.0",
  "domain": "unified",
  "output_path": ".datum/runs/<RUN_ID>/review-packets/unified.json",
  "diff": "<the diff>",
  "spec_summary": "<relevant SPEC sections>",
  "properties": "<relevant PROPERTIES>",
  "findings": []
}
```

### 2. Multi-Pass Review Execution

Spawn **one single Review Agent**. The agent must conduct the review in sequential passes corresponding to the domains (correctness, properties, security, etc.). 
For each pass, the agent reads the context and appends any discovered issues to the single unified packet.

Each finding in the packet:
```json
{
  "id": "SEC-001",
  "severity": "high|medium|low|info",
  "file": "Sources/...",
  "line": 42,
  "description": "...",
  "suggestion": "..."
}
```

If GitNexus available: run `gitnexus impact` on each `high` or `medium` finding's file to confirm blast radius matches severity. Downgrade findings where blast radius is local-only.

### 2.5 Deduplication and Minority Protection

Run `python3 scripts/dedupe.py --input .datum/runs/<RUN_ID>/review-packets/unified.json`.
This script ensures that if the agent surfaced duplicate findings across different passes (e.g. a performance issue that was also flagged as an architecture issue), they are consolidated. Crucially, it enforces **Minority Protection Rules**: if a security or property invariant finding looks similar to a general correctness finding, the higher-severity/domain-specific finding is strictly protected and never collapsed into a generic finding.

### 3. Validate packets

Run `python3 scripts/gate.py validate-packets` — confirms each packet has `schema_version`, `domain`, and `findings` array. On schema drift: normalizer maps to canonical; logs drift event.

### 4. Render report

Run `python3 scripts/render.py --packets .datum/runs/<RUN_ID>/review-packets/ --output REVIEW-REPORT.md`

The renderer is a script, not an LLM. It aggregates findings, sorts by severity, and produces a deterministic markdown report.

### 5. Satisfaction Loop & Gate (Orchestration Port)

Run `python3 scripts/gate.py review [--yolo]`

**Satisfaction Loop (Max 3 Iterations):**
If any `high` or `critical` severity findings exist (from Review or the concurrent Security Sidecar):
1. **Iteration Count:** Check `.datum/runs/<RUN_ID>/.review-iteration`. If missing, set to 1. If >= 3, **HALT** and produce an "Escalation to Chief of Staff" payload. Do not loop infinitely.
2. **Remediation Package:** If iteration < 3, run `python3 scripts/remediate.py --run-id <RUN_ID> --findings .datum/runs/<RUN_ID>/review-packets/unified.json` to generate `REMEDIATION-PACKAGE.md`.
3. **Dispatch Fixes:** Automatically dispatch targeted RED-GREEN-REFACTOR loops for the wave backlog inside the remediation package.
4. Increment `.review-iteration` and re-run Review and Security Sidecar.

- If `medium` findings only and yolo active: log and proceed.
- Present REVIEW-REPORT.md to user if `validate_human_review = required`

On pass (0 high/critical findings): archive packets and report, update state, transition to PR.

## Outputs

- `review-packets/` — per-domain JSON findings
- `REVIEW-REPORT.md` — rendered aggregate report

## Failure modes

- Review packet schema drift → normalizer maps to canonical; log drift event
- GitNexus unavailable → severity downgrade skipped; findings retained as-is; log
- High severity finding → halt; user must decide (fix, accept, or reject)
