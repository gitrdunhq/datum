## Refine — 2026-06-14

### Q1: [Behavior] How should deduplication match existing issues — case-sensitive exact title match, case-insensitive, or substring?

> This determines whether a lane titled "Add user auth" matches an existing issue "add user auth" or "Add user auth endpoint". If substring matching is used, multiple issues could match, and we need a tiebreaker rule. If exact match fails silently, duplicate issues accumulate on every re-run. I'm assuming case-insensitive exact match on the full title — is that right, or should we use a machine-readable ID from the metadata comment instead?

[Answer]:

---

### Q2: [Architecture] What is the exact schema of the `datum:metadata` JSON block — which fields are required, which are optional?

> The round-trip validation requirement (`parse(build(lane)) == original`) only works if both sides agree on the schema. If fields like `depends_on`, `ac_ids`, or `lane_id` are optional, the builder must emit them consistently (e.g., always emit `null` vs. omit the key) or the equality check will be flaky. I'm assuming at minimum `{ lane_id, task_id, epic_id, depends_on: [], acs: [] }` are required — confirm the full field list and nullability.

[Answer]:

---

### Q3: [Architecture] Where does the `datum:metadata` HTML comment live in the issue body — top, bottom, or a fixed delimiter section?

> GitHub's editor renders HTML comments as invisible, but users can still edit the body. If the comment is at the top, users prepending content will corrupt parsing. If it's at the bottom, appended text is safe but the parser must scan the whole body. A fixed delimiter pattern (e.g., `<!-- datum:metadata:begin --> ... <!-- datum:metadata:end -->`) is more resilient. I'm assuming bottom placement with begin/end delimiters — confirm the chosen approach so the parser and builder stay in sync.

[Answer]:

---

### Q4: [Integration] Does the GitHub REST API actually support sub-issue (parent/child) linking, and what are the rate limits and batch size constraints?

> The spec implies a `link_sub_issues()` call, but GitHub's native sub-issues API is only available on specific plan tiers and may require GraphQL (`addSubIssue` mutation), not REST. If unavailable, we fall back to body links or project board relationships. Rate limits matter because a large epic could spawn 20+ lanes. I'm assuming the target org has access to the sub-issues beta and we use the GraphQL mutation — confirm this, or specify the fallback.

[Answer]:

---

### Q5: [Architecture] How are parent epic issues distinguished from child lane issues — separate labels, title prefix, or metadata field only?

> If both are regular GitHub issues, queries like "show me all epics" require a reliable discriminator. A label (`datum:epic` vs `datum:lane`) is filterable via the API. A metadata field alone requires fetching and parsing every issue body, which is expensive. I'm assuming we apply distinct labels (`datum:epic`, `datum:lane`) and also set `type: "epic"|"lane"` in the metadata JSON — confirm label names and whether the GitHub issue `type` field (if available) should be used instead.

[Answer]:

---

### Q6: [Behavior] What triggers `close_issue()` in `datum-tdd-act` — an automatic post-lane hook, a gate pass event, or a manual call?

> If it's a post-lane hook, the issue closes even on partial completion (e.g., tests pass but lint fails). If it's gate-pass-triggered, the gate must emit a close signal, adding coupling. If manual, automation is incomplete. I'm assuming `close_issue()` is called automatically when all ACs in the lane's metadata are marked green by the gate — confirm the trigger event and whether a failed lane should close with a `failure reason` comment or stay open.

[Answer]:

---

### Q7: [Behavior] What is the exact format of the 'failure reason' comment posted when a lane fails?

> This affects how downstream tooling (dashboards, reports) parses failure state. A freeform prose comment is human-readable but not machine-parseable. A structured comment (another HTML metadata block, or a JSON code fence) enables automation. I'm assuming a structured comment with fields `{ status: "failed", reason: "...", gate: "...", timestamp: "..." }` inside an HTML comment — confirm format or provide a template.

[Answer]:

---

### Q8: [NFR] What is the retry strategy for 409 conflicts — exponential backoff, fixed delay, max retry count?

> "Handle 409 gracefully" is underspecified. Without a cap, infinite retries can stall the pipeline. Without backoff, tight retries hammer the API and hit secondary rate limits. I'm assuming 3 retries with exponential backoff starting at 1s (1s, 2s, 4s), then raise a hard error — confirm the cap and backoff parameters, or indicate if 409s should be treated as fatal immediately.

[Answer]:

---

### Q9: [Behavior] What happens when `--gh-issues` is omitted — do lanes fall back to `task-001` IDs, or is the flag mandatory for any GH-integrated run?

> If the flag is optional and omitted, the pipeline must maintain two code paths (local task IDs vs. GH issue numbers) throughout `datum-tdd-act`. If it becomes mandatory once a repo is configured, the CLI should error early with a clear message. I'm assuming the flag is optional and defaults to local `task-001` IDs, with GH issue linking as an additive opt-in — confirm whether there's a repo-level config that makes it the default.

[Answer]:

---

### Q10: [Architecture] What is the type and interface of the `repo` object passed through the CLI — PyGithub `Repository`, a thin wrapper, or a plain config dict with credentials?

> The implementation of `create_issue()`, `close_issue()`, and `link_sub_issues()` depends entirely on this. If it's a PyGithub `Repository`, we use `.create_issue()` and `.get_issue()` directly. If it's a wrapper, we need its interface documented. If it's a config dict, we call the REST API via `httpx` ourselves. I'm assuming a PyGithub `Repository` instance is injected via a `GHClient` helper already in the codebase — confirm the type or point to the existing auth/client setup.

[Answer]:

---

### Q11: [Behavior] Does round-trip validation require byte-for-byte identical JSON or semantic equivalence (same keys/values, any key order)?

> JSON key ordering is not guaranteed by the spec, so `json.dumps(parse(build(lane))) == json.dumps(original)` can fail even when semantically identical. Semantic equivalence (deep equality after parse) is more practical but requires defining how floats, nulls, and empty arrays are normalized. I'm assuming semantic equivalence with sorted keys and normalized nulls (empty list for missing array fields, `null` for missing scalar fields) — confirm normalization rules.

[Answer]:

---
