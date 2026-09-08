# DATUM Retro

**Run:** 20260908-052437
**Merge SHA:** a162b295488ddaf52bdcda25853f73f0f1fceb87

## Delivery

- Tasks completed: 22 / 22
- Failed terminal lanes: 0
- Say:do ratio: 1.0
- Per-stage retries: not reported (`null`)

## Change Size

- Commits: 53
- Files touched: 95
- LOC added / removed / net: 8952 / 232 / 8720
- `git.warnings`: none (`[]`)

## Reliability Signals

- Brief defects: 0 (empty array)
- Lane tools added: 0 (empty array, `lane_tools: []`)
- Platform: not reported (`null`)
- Tokens total: not collected — `token_metrics.status: "no_state_available"`,
  reason: "no state.db at `.datum/runs/20260908-052437/state.db` or
  `.datum/state.db` (no producer writes one)". This is a pre-existing,
  repo-wide gap (no TS Workflow producer writes lane/stage/retry telemetry
  into `state.db`), unrelated to this epic's own scope, and not fixed by it.

## Review Findings

3 unique findings closed in `docs/epics/datum/monotonic-task-ids/REVIEW-REPORT.md`,
0 high/critical:

- **SEC-001 (medium)** — `resolve_task_id_prefix()` (`datum/task_ids.py:59`)
  returns a config-supplied `task_id_prefix` from `.datum/config.json`
  unvalidated; only the derived-prefix fallback enforces a shape. Not fixed
  before merge. See `follow-ups.json`.
- **PERF-001 (medium)** — `iter_committed_ids` (`datum/task_ids.py:116`) spawns
  one `git show` subprocess per committed epic id file, twice per plan
  execution (~52 spawns/plan) — an N+1 subprocess pattern. Not fixed before
  merge. See `follow-ups.json`.
- **CORR-001 (info)** — `SPEC.md` Requirement 4 AC3's literal wording
  ("unmodified") conflicts with Assumption 8's later addendum that explicitly
  sanctions modifying `tests/test_lane_plan_schema_int_ids.py`. Documented as a
  spec self-contradiction, not a code defect; no fix required for merge.

No REVIEW-RESPONSE.md exists yet for this epic, so no ACCEPT/DEFER decisions
are recorded here — `datum review-accept` will update `CURRENT_STATE.md`'s
review-decisions block when the operator records them.

## Solutions Detected

- None reported (`solutions: null` in `closeout-data.json`).

## Observations

- This is the first closeout run in the recent history reviewed
  (`state-single-source-of-truth`, `20260907-163917`) that reports zero
  `git.warnings` and no `base_sha_fallback` note — the commit/LOC stats above
  appear scoped to this epic alone, unlike the prior two closeouts which
  explicitly flagged their stats as spanning multiple epics.
- The epic shipped two out-of-scope-but-adjacent fixes mid-run (a batch-step
  truncation retry, `#539`; a runtime-artifact gate false-positive on a test's
  `repo_root` fixture) and one carried-over lint fix from a prior Validate
  phase (`#519`, commit `63d78085`) — all visible in the commit list but not
  named as SPEC requirements. Not flagged as scope-creep by the review (only
  CORR-001, a docs wording issue, was raised), but worth naming here since the
  state-single-source-of-truth epic's own retro flagged similar adjacent
  changes (CORR-001/CORR-002 there) as needing separate review coverage.
- `tasks.per_stage_retries` continues to report `null` across closeouts
  (also true for the prior epic) — no collector currently populates it.
