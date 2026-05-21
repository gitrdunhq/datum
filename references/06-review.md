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

Each domain is reviewed by a separate subagent. Agents fill structured JSON packets (see `assets/schemas/packet.schema.json`).

| Domain | Focus |
|---|---|
| correctness | Does the implementation match the SPEC and ACs? |
| properties | Are all PROPERTIES.md invariants demonstrably held? |
| security | OWASP top 10, injection, auth, secrets exposure |
| performance | Hot paths, N+1 queries, unbounded operations |
| architecture | Tier violations, coupling, layer boundary respect |
| observability | Logging, metrics, error messages per DPS-6/DPS-10 |

## Steps

### 1. Prepare review packets

For each domain, create a pre-filled JSON packet:
```json
{
  "schema_version": "1.0",
  "domain": "security",
  "output_path": ".datum/runs/<RUN_ID>/review-packets/security.json",
  "diff": "<the diff>",
  "spec_summary": "<relevant SPEC sections>",
  "properties": "<relevant PROPERTIES>",
  "findings": []
}
```

### 2. Dispatch reviewers concurrently

Spawn one subagent per domain. Each reads its packet and produces findings.

Each finding:
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

### 3. Validate packets

Run `python3 scripts/gate.py validate-packets` — confirms each packet has `schema_version`, `domain`, and `findings` array. On schema drift: normalizer maps to canonical; logs drift event.

### 4. Render report

Run `python3 scripts/render.py --packets .datum/runs/<RUN_ID>/review-packets/ --output REVIEW-REPORT.md`

The renderer is a script, not an LLM. It aggregates findings, sorts by severity, and produces a deterministic markdown report.

### 5. Gate

Run `python3 scripts/gate.py review [--yolo]`

- If any `high` severity findings exist: halt; surface for user decision
- If `medium` findings only and yolo active: log and proceed
- Present REVIEW-REPORT.md to user if `validate_human_review = required`

On pass: archive packets and report, update state, transition to PR.

## Outputs

- `review-packets/` — per-domain JSON findings
- `REVIEW-REPORT.md` — rendered aggregate report

## Failure modes

- Review packet schema drift → normalizer maps to canonical; log drift event
- GitNexus unavailable → severity downgrade skipped; findings retained as-is; log
- High severity finding → halt; user must decide (fix, accept, or reject)
