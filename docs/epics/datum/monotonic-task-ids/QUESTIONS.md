## Refine — 2026-09-07

### Q1: [Architecture] What exact fields and validation rules make up the shared `laneIdPattern` definition, and in what format (JSON Schema, a plain regex string, a small TS/Python module) does it live under `assets/schemas` so both languages consume the same source without a build step re-deriving it?
> The SPEC (Requirement 5) requires one shared, table-driven pattern consumed by both Pydantic `constr` patterns and TypeScript regexes, replacing at least 12 duplicated literals. I'm assuming a single plain-text regex source (e.g. a `.json` file with a `pattern` string field) that both a Python loader and a TypeScript loader read at runtime or import-time, rather than a generated/duplicated constant in each language — is that right, or should the source of truth instead be a code-generation step that emits language-specific constants at build time?

[Answer]:

### Q2: [Behavior] What is the exact error message format and payload shape the `task_id_collision` gate check emits, and does it fail the whole `datum lane-plan --validate` run or only the specific epic/lane pair in conflict?
> Requirement 6's ACs require the check to be "distinguishable ... by the task_id_collision code specifically" but the SPEC does not pin the exact JSON/text shape (field names, whether it matches the `{code, message, correlationId}` structured-error convention used elsewhere in the repo). I'm assuming it reuses that same `{code, message, correlationId}` shape with additional `colliding_id`, `epic_a`, `epic_b` fields — is that right, or does the plan gate use a different existing error envelope for validation failures that this should match instead?

[Answer]:

### Q3: [NFR] Is there a maximum number of committed epics/tasks.json files or repo history size at which the `max(existing)` counter scan is expected to stay fast, or is "scan every docs/epics/*/tasks.json and lane-plan.json on HEAD" acceptable at any repo size with no stated bound?
> The SPEC's Requirement 2 defines the counter scan but the ticket and scan results flagged this as "assumed negligible, not specified." I'm assuming no explicit performance target is needed because the file count is small relative to typical repos (tens to low hundreds of epics) — is that right, or should the SPEC state a concrete bound (e.g. "under N ms for M epics") that the implementation must meet?

[Answer]:

### Q4: [Scope] Do draft epics or lane plans that exist only on unmerged feature branches (not yet on the base branch used for the scan) count toward the `max(existing)` computation, or is the scan strictly limited to the current branch's own committed history as stated in Requirement 2?
> The SPEC (Requirement 2, NFR table) currently scopes the scan to "the current git branch's committed tree only," which by construction excludes other branches' draft epics — this is the source of the cross-branch collision scenario that Requirement 6's `task_id_collision` check exists to catch. I'm assuming this exclusion is intentional (git carries the counter per-branch, not globally) and that including other branches' unmerged commits in the scan is explicitly out of scope — is that right, or should the counter instead attempt to look across known remote branches before assigning a number, trading a cheaper collision rate for a more expensive scan?

[Answer]:
