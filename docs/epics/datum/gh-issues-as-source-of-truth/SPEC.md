# SPEC.md — GitHub Issues as Source of Truth for Lane IDs

## Summary

This ticket wires `datum/github_issues.py` (currently a standalone, zero-caller module) into the active pipeline by adding a `--gh-issues` flag to `datum lane-plan` that creates a GH parent epic, child task issues, links them as sub-issues, and writes `#N`-style lane IDs into `lane-plan.json`. Lane status sync is also added: `datum-tdd-act` closes the corresponding GH issue on lane completion and posts a failure comment on lane failure.

## Context

`datum/github_issues.py` already contains most of the required primitives (`create_epic`, `create_task`, `link_sub_issue` singular, `parse_metadata`, `update_issue_stage`) but they are not imported anywhere and have zero test coverage. The missing pieces are a public orchestrator (`create_epic_with_tasks`), a plural batch linker with 409 handling (`link_sub_issues`), a public `build_issue_body(lane)` adapter with the ticket's signature, a `parse_issue_metadata` alias, and title-based dedup logic. On the CLI side, `datum/cli.py:91` (`lane-plan` command) needs a `--gh-issues` flag, and `skills/datum-tdd-act.js` (lines 136–143, where completed vs. failed is determined) needs calls into Python's `update_issue_stage`. Lane IDs propagate through `pipeline_scheduler.py`, `wave_builder.py`, `status_render.py`, and `spec_drift_detector.py` as dict keys only — `#N` strings are structurally compatible with no changes required to those files, provided consistency is maintained between `lane-plan.json` and `tasks.json`.

## Requirements

### R1 — `create_issues_from_plan(lane_plan, repo)`

Creates one GH issue per lane entry. Deduplicates by searching for open issues whose title exactly matches the lane's `task_id` title (case-insensitive). Returns a `dict[str, int]` mapping original `task_id` to GH issue number.

**AC-1.1** Given a `lane_plan` with three lanes, calling `create_issues_from_plan` returns a dict with exactly three entries mapping task_id strings to positive integers.

**AC-1.2** Given a GH issue already exists with a title matching a lane's title, `create_issues_from_plan` does not create a duplicate issue and returns the existing issue's number for that lane.

**AC-1.3** The returned dict contains every `task_id` present in the input `lane_plan`.

**AC-1.4** Issues are created with the `datum-task` label.

**Affected files:** `datum/github_issues.py` (new function)

---

### R2 — `build_issue_body(lane)` and `parse_issue_metadata(body)`

`build_issue_body(lane: dict) -> str` is a public function that accepts a lane dict and returns a GH issue body string containing a `<!-- datum:metadata {...} -->` HTML comment with the lane's `files`, `depends_on`, and `acceptance_criteria` fields. `parse_issue_metadata(body: str) -> dict | None` is a public alias for the existing `parse_metadata` at line 73.

**AC-2.1** `build_issue_body(lane)` returns a string containing the substring `<!-- datum:metadata`.

**AC-2.2** `parse_issue_metadata(build_issue_body(lane))` returns a dict that is semantically equal (same keys, same values) to the metadata portion of the original lane dict (`files`, `depends_on`, `acceptance_criteria`).

**AC-2.3** `parse_issue_metadata` returns `None` when given a body string with no `<!-- datum:metadata` comment.

**AC-2.4** The metadata JSON in the HTML comment is valid JSON (parseable by `json.loads` without error).

**AC-2.5** The existing private `_build_issue_body` continues to work unchanged (no regression on `create_task`).

**Affected files:** `datum/github_issues.py` (new public function + alias)

---

### R3 — `link_sub_issues(parent_number, child_numbers, repo)`

Links a list of child issue numbers as sub-issues of a parent issue number using the GH GraphQL `addSubIssue` mutation. Resolves issue numbers to node IDs internally. Handles 409-equivalent conflicts (issue already linked) by catching `RuntimeError` raised by `_gh_check` when stderr contains `already` or the exit code indicates a duplicate, and silently continuing.

**AC-3.1** Given valid `parent_number`, `child_numbers=[n1, n2]`, and `repo`, after `link_sub_issues` completes, both `n1` and `n2` appear in the parent's sub-issues list when queried.

**AC-3.2** Calling `link_sub_issues` twice with the same arguments does not raise an exception on the second call (idempotent — 409 conflict is swallowed).

**AC-3.3** `link_sub_issues` with an empty `child_numbers` list returns without error and makes no API calls.

**AC-3.4** `link_sub_issues` raises `RuntimeError` for non-409 GH API failures (e.g. 404 issue not found).

**Affected files:** `datum/github_issues.py` (new public function using existing `link_sub_issue` primitive)

---

### R4 — `create_epic_with_tasks(lane_plan, repo)`

Top-level orchestrator: creates a parent epic issue, creates one child task issue per lane using `create_issues_from_plan`, links all children as sub-issues of the epic via `link_sub_issues`, and returns `{"epic_number": int, "task_map": dict[str, int]}`.

**AC-4.1** Return value is a dict with keys `epic_number` (positive int) and `task_map` (dict mapping each task_id to a positive int).

**AC-4.2** The epic issue is created with the `datum-epic` label.

**AC-4.3** After `create_epic_with_tasks`, listing sub-issues of `epic_number` via GH API returns all task issue numbers in `task_map.values()`.

**AC-4.4** If any child issue creation fails, the function raises the exception without leaving partial sub-issue links silently uncreated (fail-fast, not silent partial success).

**Affected files:** `datum/github_issues.py` (new public function)

---

### R5 — `datum lane-plan --gh-issues` CLI flag

Adds an optional `--gh-issues` boolean flag to the `lane-plan` command in `datum/cli.py`. When passed, after writing `tasks.json` and building the lane plan, the command calls `create_epic_with_tasks` and rewrites lane IDs in the output `lane-plan.json` from `task-001`-style strings to `#N` strings using the returned `task_map`. When omitted, behavior is identical to today (no GH calls, local IDs only).

**AC-5.1** `datum lane-plan` without `--gh-issues` produces `lane-plan.json` with local `task-XXX` IDs and makes no GH API calls.

**AC-5.2** `datum lane-plan --gh-issues` produces `lane-plan.json` where every lane's `task_id` is of the form `#N` (e.g. `#42`).

**AC-5.3** `datum lane-plan --gh-issues` produces `lane-plan.json` where `depends_on` references use `#N` format matching the corresponding task's assigned issue number.

**AC-5.4** The `epic_number` is written to `lane-plan.json` at the top level as `"epic_issue": N`.

**AC-5.5** `wave_builder.validate_lane_plan` passes on a `lane-plan.json` produced by `--gh-issues` without modification.

**Affected files:** `datum/cli.py` (flag addition), `datum/lane_plan.py` (ID remap step), `datum/github_issues.py` (orchestrator call)

---

### R6 — Lane Status Sync in `datum-tdd-act`

When a lane completes (`status: 'completed'`) in `datum-tdd-act.js`, the corresponding GH issue is closed via `update_issue_stage`. When a lane fails (`status: 'failed'`), a comment with the failure reason is posted. GH sync is skipped if the lane's `task_id` does not start with `#` (local-only mode).

**AC-6.1** When a lane with `task_id: "#42"` completes, GH issue #42 is closed and has the `datum-done` label applied.

**AC-6.2** When a lane with `task_id: "#42"` fails with `error: "some reason"`, GH issue #42 receives a comment containing "some reason" and is NOT closed.

**AC-6.3** When a lane with `task_id: "task-001"` (no `#` prefix) completes or fails, no GH API calls are made.

**AC-6.4** GH sync failure does not abort the pipeline — errors are logged to stderr and the pipeline result is unaffected.

**Affected files:** `skills/datum-tdd-act.js` (result loop, lines 136–143), `skills/src/datum-tdd-act.ts` (source), `datum/github_issues.py` (existing `update_issue_stage` at line 270)

---

### R7 — Test Coverage for All New Public Functions

All new public functions must have pytest tests. Because `github_issues.py` has zero coverage today, tests mock `_gh` and `_gh_check` (or `subprocess.run`) at the module boundary.

**AC-7.1** `pytest tests/` passes with no errors against the new code.

**AC-7.2** Tests exist for `create_issues_from_plan` covering: new issue creation, dedup path (existing issue reused), and partial lane plan.

**AC-7.3** Tests exist for `build_issue_body` / `parse_issue_metadata` covering: round-trip equality, missing comment returns `None`, valid JSON inside comment.

**AC-7.4** Tests exist for `link_sub_issues` covering: success path, idempotent (409-equivalent silenced), empty list no-op, non-409 error propagates.

**AC-7.5** Tests exist for `create_epic_with_tasks` covering: success path returns correct shape, fail-fast on child creation error.

**AC-7.6** Tests exist for `datum lane-plan --gh-issues` CLI flag: lane IDs become `#N`, `depends_on` updated, `epic_issue` key present, `--gh-issues` absent leaves IDs unchanged.

**Affected files:** `tests/test_github_issues.py` (new file), `tests/test_units.py` (CLI integration test additions)

---

## Failure Modes

| Failure | Trigger | Handling |
|---|---|---|
| GH rate limit during batch issue creation | Many lanes, rapid `create_issues_from_plan` calls | Raise `RuntimeError` with message containing rate limit signal; caller surfaces to user |
| `addSubIssue` already-linked conflict | `link_sub_issues` called twice | Detect in stderr, swallow silently, continue |
| `addSubIssue` non-409 GH error (404, 403, 500) | Invalid issue numbers, missing permissions | Re-raise `RuntimeError` from `_gh_check` |
| `--gh-issues` flag with no GH auth (`gh auth status` fails) | No `gh auth login` or missing GITHUB_TOKEN override | `_gh` raises; surface as `RuntimeError: gh auth required` before any issues are created |
| Lane ID remap mismatch (task_map missing a task_id) | Bug in `create_issues_from_plan` return value | `KeyError` at remap step; fail-fast, do not write partial `lane-plan.json` |
| `wave_builder.validate_lane_plan` rejects `#N` IDs | Validation regex does not allow `#N` format | Check in AC-5.5; fix validation if needed before shipping |
| GH sync in `datum-tdd-act` fails mid-pipeline | Network error, token expired | Log to stderr, do not abort pipeline; pipeline result is authoritative |
| Title-based dedup matches wrong issue | Two lanes with identical titles | Dedup returns first match; documented behavior — user must ensure unique lane titles |
| `tasks.json` `task_id` field is a non-string | Malformed tasks.json | Raise `TypeError` at `create_issues_from_plan` entry |

---

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Roundtrip fidelity | `parse_issue_metadata(build_issue_body(lane))` must equal original metadata dict (key/value semantic equality, not byte-for-byte JSON) |
| Dedup search latency | Title search via `gh issue list --search` must complete within 5 seconds per lane |
| 409 handling | `link_sub_issues` must not raise for already-linked sub-issues under any circumstances |
| Backwards compatibility | `datum lane-plan` without `--gh-issues` must be behavior-identical to current behavior with zero GH calls |
| Test isolation | All new tests mock GH API calls; no tests make live network calls |
| `GITHUB_TOKEN` handling | All `_gh` calls unset `GITHUB_TOKEN` (consistent with existing `_gh` helper at line 34) |
| Lane ID format | `#N` IDs must be valid as JSON object keys and pass `wave_builder.validate_lane_plan` |

---

## Out of Scope

- GH Projects board integration
- Retroactive migration of existing local `task-001` lane plans to GH issues
- GH Actions / webhook triggers (CLI-only)
- GH issue labels beyond `datum-epic`, `datum-task`, `datum-red`, `datum-green`, `datum-done` (already defined)
- Bulk migration tooling or backfill commands
- Modifying `pipeline_scheduler.py`, `wave_builder.py`, `status_render.py`, or `spec_drift_detector.py` — `#N` IDs must be structurally compatible without changes to these files

---

## Open Questions

**Q1 — Dedup title matching:** Should title comparison for existing issue reuse be case-insensitive exact match, or case-sensitive? What happens when multiple open issues share the same title — first match, error, or prompt?

**Q2 — Metadata schema:** What is the exact required set of fields in the `datum:metadata` JSON comment? The scan found `files`, `depends_on`, `acceptance_criteria`, and `red_note` on `TaskIssue`. Are all required, or only a subset?

**Q3 — Issue body structure:** Should the `<!-- datum:metadata -->` comment appear at the top (before human-readable text), at the bottom, or in a fixed section? Placement affects whether GH UI truncates it.

**Q4 — `datum-tdd-act.js` GH sync invocation:** Does the JS skill shell out to a Python helper (`datum gh-sync-lane`), or does it call `update_issue_stage` directly via a Python subprocess? The JS skill has no current Python interop pattern for `github_issues.py`.

**Q5 — `repo` parameter type:** What is the type of the `repo` parameter passed to all new functions — a PyGithub `Repository` object, a plain `"owner/repo"` string, or something else? The existing `create_epic` / `create_task` functions accept `repo: str` as `"owner/repo"` format but this should be confirmed.

**Q6 — 409 detection strategy:** `_gh_check` raises `RuntimeError` on non-zero exit with no HTTP status code. How should `link_sub_issues` distinguish an already-linked 409 from a different error — by matching stderr string content (e.g. "already")? What is the exact stderr string GH CLI emits for this case?

**Q7 — `epic_issue` field in `lane-plan.json`:** Should `epic_issue` be added to the existing `lane-plan.json` schema (requiring updates to any schema validators), or stored in a sidecar file?

---

## Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| A1 | GH REST/GraphQL API supports sub-issue linking via `addSubIssue` mutation | Existing `link_sub_issue` in `github_issues.py:190` uses this mutation with `GraphQL-Features: sub_issues` header and is presumed to have been tested | guess | Q6 |
| A2 | `#N` lane IDs are structurally compatible with `pipeline_scheduler.py`, `wave_builder.py`, `status_render.py`, `spec_drift_detector.py` | These files use lane IDs as dict keys only (confirmed by scan pattern notes) | confirmed | n/a |
| A3 | `wave_builder.validate_lane_plan` does not regex-validate lane ID format | Scan states IDs must match between `topological_order` and lane dict keys but no format constraint was found | guess | Q7, AC-5.5 |
| A4 | `--gh-issues` is optional; omitting it preserves current behavior | Ticket states "optionally call `create_epic_with_tasks` when `--gh-issues` flag is passed" | confirmed | n/a |
| A5 | `repo` parameter is a `"owner/repo"` string, consistent with existing `create_epic`/`create_task` signatures | Existing functions use `repo: str` and pass it to `_gh` as a `--repo` flag | confirmed | Q5 |
| A6 | `datum-tdd-act.js` GH sync shells out to a Python subprocess or `datum` CLI subcommand | No current Python interop exists in the JS skill; a new `datum gh-sync` or `datum close-issue` CLI command is the most consistent approach | guess | Q4 |
| A7 | Invisible HTML comments survive GH API round-trips unmodified | `_build_issue_body` already uses this pattern and the existing `parse_metadata`/`METADATA_PATTERN` regex exists, implying prior validation | confirmed | n/a |
| A8 | Dedup should be automatic (reuse first matching open issue), not interactive | Ticket states "reuses existing issues with matching titles" with no mention of prompting | confirmed | Q1 |
| A9 | `tasks.json` lanes have `files`, `depends_on`, and `acceptance_criteria` fields | `TaskIssue` dataclass and `build_lane_plan_from_epic` reconstruct these fields; scan confirms structure | confirmed | Q2 |
| A10 | GH sync failure in `datum-tdd-act` must not abort the pipeline | Ticket does not specify; tolerant design is safer for a sync side-effect | guess | n/a |

---

## Classification Metadata

```yaml
estimated_files: 5
estimated_loc: 280
clusters_touched:
  - datum/github_issues.py       # primary — 5 new public functions/aliases
  - datum/cli.py                 # --gh-issues flag on lane-plan command
  - datum/lane_plan.py           # ID remap post-processing step
  - skills/datum-tdd-act.js      # lane status GH sync (generated from src/)
  - skills/src/datum-tdd-act.ts  # TypeScript source for above
new_public_api:
  - create_issues_from_plan(lane_plan: dict, repo: str) -> dict[str, int]
  - build_issue_body(lane: dict) -> str
  - parse_issue_metadata(body: str) -> dict | None
  - link_sub_issues(parent_number: int, child_numbers: list[int], repo: str) -> None
  - create_epic_with_tasks(lane_plan: dict, repo: str) -> dict
dependency_additions: []
test_files_added:
  - tests/test_github_issues.py
```
