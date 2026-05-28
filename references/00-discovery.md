# Phase: Discovery

**Goal:** Survey the repo's current architecture so that all subsequent phases have grounded context. Discovery is optional — skip it if the executor already knows the codebase or if CURRENT_STATE.md is up to date.

## When to run

- First use of DATUM in a repo
- After a long gap between epics (> 2 weeks)
- When the TICKET.md references unfamiliar subsystems

## Steps

### 1. Read project state docs

If they exist, read: `CURRENT_STATE.md`, `ROADMAP.md`. These are the primary sources of project orientation. Do not re-derive what is already documented.

### 2a. Generate LANDSCAPE.md

Run: `uv run datum landscape`

This generates docs/LANDSCAPE.md with a base scaffold (tech stack, file tree with LOC, module descriptions). If the content hash matches the last run, it returns a cached result.

To force regeneration: `uv run datum landscape --force`

### 2b. Enrich LANDSCAPE.md with GitNexus (if available)

If GitNexus is available, enrich docs/LANDSCAPE.md with architecture data:
- Query `gitnexus_query("architecture")` for cluster information
- Query `gitnexus_query("entry points")` for execution flow entry points
- Append findings between `<!-- gitnexus:start -->` and `<!-- gitnexus:end -->` markers in LANDSCAPE.md
- Do NOT overwrite the CLI-generated scaffold sections above the markers

If GitNexus is unavailable, the CLI scaffold stands alone as the complete LANDSCAPE.md.

### 2. GitNexus survey (if available)

```
gitnexus list_repos              — confirm the repo is indexed
gitnexus query "architecture"    — high-level structure
gitnexus query "entry points"    — main execution paths
```

If GitNexus is unavailable: read the top-level README, then scan for a docs/ or ARCHITECTURE.md. Do not grep the entire codebase; work from documentation first.

### 3. Language and toolchain detection

Run: `python3 scripts/language_detect.py`

Note: package manager, test framework, linter, formatter. These inform ACT phase tool selection.

**Context7 MCP Protocol:** If the project uses frameworks, SDKs, or libraries that are unfamiliar or whose APIs might have drifted, you MUST use the Context7 MCP (`resolve-library-id` followed by `query-docs`) to fetch current, authoritative documentation. Do not guess API surfaces or rely on stale training data.

### 4. Security seam identification

Scan for security-critical boundaries. This feeds directly into the GitNexus risk context for Plan phase.

**Auth/authz:** Locate all authentication and authorization checks. Note where they live, what they guard, and whether any are missing from entry points.

**Transport security:** Check CORS configuration (allowed origins, methods, headers), CSRF protection presence, and whether security headers are set (CSP, HSTS, X-Frame-Options, etc.).

**Rate limiting:** Confirm rate limiting exists on public-facing endpoints. Flag any endpoint that accepts external input without throttling.

**High-risk seams** (flag each one explicitly):
- Direct database access from client-side or presentation-layer code
- Unvalidated redirects (URL params flowing into Location headers)
- User-controlled input reaching shell, eval, or subprocess calls
- Serialization/deserialization of untrusted data without schema validation
- Credential or secret material in logs, error responses, or URL params

If GitNexus is available: run `gitnexus query "authentication authorization"` and `gitnexus query "input validation"` to surface related code quickly.

Record findings as a `security_seams` block in the orientation summary. These surface as risk annotations in Plan step 1 (impact analysis).

### 5. Test framework support check

Check if `scripts/test_signal.py` supports the detected test framework. If not, flag it now:
"test_signal.py does not support [framework]. ACT phase will be blocked unless the parser is extended."

### 6. Summarize findings

Write a brief orientation summary (internal, not an artifact) covering:
- Primary language and toolchain
- Test framework and whether it's supported
- Key modules relevant to the ticket
- Security seams found (from step 4) — any high-risk items surfaced immediately
- CURRENT_STATE.md freshness (is it current?)
- GitNexus index status (fresh / stale / unavailable)

This summary is used as context for the Refine phase, not archived independently.

## Outputs

- Orientation context for the executor (internal)
- `docs/LANDSCAPE.md` — optional, generated on first run or when stale (not generated every epic)

## Skip condition

If CURRENT_STATE.md was updated in the last 7 days, the ticket does not reference unfamiliar subsystems, AND docs/LANDSCAPE.md exists, skip Discovery and proceed directly to Refine.
