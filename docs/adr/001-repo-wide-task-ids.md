# Repo-wide sequential task ids

* Status: accepted
* Date: 2026-09-08

## Context and Problem Statement

Task ids were originally scoped per-epic (`task-1`, `task-INT-1`, ...), which let two different epics allocate the same id and made it impossible to reference a task unambiguously outside its own `docs/epics/<name>/tasks.json`. We need repo-wide, short, human-readable task ids without standing up a coordination service, and without breaking every epic that already exists on disk with the old scheme.

## Decision Drivers

* No new always-on service (counter, database, lock server) just to hand out ids.
* Ids must stay short and readable in commit subjects, branch names, and shell-interpolated commands.
* Existing epics must keep working unmodified — migrating history is out of scope.
* The id shape has to be safe to interpolate into shell commands (see `skills/src/shared/lane-id-pattern.ts` consumers `completionMarkerCommand` / `laneSpecExportCommand`).

## Considered Options

* A central counter service or database that hands out the next id.
* Per-epic-scoped ids only (the pre-existing `task-N` / `task-INT-N` scheme), left as-is.
* A derived, per-repo short prefix (`<PREFIX>-N`) with locally-computed sequence numbers, plus after-the-fact collision detection.

## Decision Outcome

Chosen option: "a derived, per-repo short prefix with locally-computed sequence numbers and after-the-fact collision detection," because it needs no new service, keeps ids short, and lets every existing epic keep its ids unchanged.

### Prefix derivation

`datum.task_ids.resolve_task_id_prefix` (`datum/task_ids.py`) derives the prefix from the repository directory's basename: strip everything that is not an ASCII letter, uppercase what remains, and take the first 3 characters (`_derive_prefix`). For example a repo checked out as `datum` derives `DAT`; `my-cool-repo` derives `MYC`.

If fewer than 2 letters survive the strip, derivation fails with `TaskIdPrefixError`, whose payload is `{"code": "task_id_prefix_invalid", "message": ..., "correlationId": ...}` — a structured error, never a silent fallback to some default prefix.

### Persist-once behaviour

The derived prefix is written to `.datum/config.json` under the `task_id_prefix` key the first time it is resolved, and every subsequent call to `resolve_task_id_prefix` reads that value back instead of re-deriving it. This makes the prefix a one-time decision per repo: renaming the repo directory later does not change already-issued ids, and every task id a repo produces after the first resolution shares the same prefix.

New sequence numbers for that prefix come from `datum.task_ids.next_task_number`, which scans committed paths at `HEAD` (via `git ls-tree` + `git show`) for the highest existing `<PREFIX>-\d+` and returns one past it — never the uncommitted working tree, so an in-progress edit can't shift what the next id will be.

### Legacy ids are permanently accepted

`task-\d+` and `task-INT-\d+` remain permanently accepted alongside the new `<PREFIX>-\d+` shape (see `datum/id_pattern.py`'s `LANE_ID_PATTERN` / `is_lane_id`, which matches both forms with no sunset date). No existing epic is migrated to the new prefix scheme — every epic's `docs/epics/<name>/tasks.json` keeps the ids it already has, and old and new id shapes are expected to coexist indefinitely.

### Collisions are detected, not prevented

There is no counter service and no repo-wide lock coordinating id allocation, so two branches can independently mint the same `<PREFIX>-N` id before either merges. This is accepted, not prevented: `datum.lane_plan.find_task_id_collisions` (invoked from the CLI's `--validate` path, `_cli_task_id_collisions`) scans committed `docs/epics/**/tasks.json` content at `HEAD` for a given prefix's ids appearing under more than one epic path, and reports `{"valid": false, "code": "task_id_collision", "id": ..., "paths": ..., "collisions": [...]}` when it finds one. The check runs after the fact, at validation/merge time, rather than gating id issuance up front.

### `lane-id-pattern.ts` is hand-written, not generated

`skills/src/shared/lane-id-pattern.ts` mirrors `datum/id_pattern.py`'s `LANE_ID_PATTERN` for the TypeScript side (consumed by `completionMarkerCommand` and `laneSpecExportCommand` in `skills/src/shared/lane-steps.ts`, which interpolate task ids into shell commands and need the same acceptance/rejection shape as the Python side). The obvious alternative would be to codegen this TS literal from `datum/id_pattern.py` the same way `skills/datum-tdd-act*.js` is built from `skills/src/` by `scripts/build-workflows.sh` — but that would make `lane-id-pattern.ts` a `// @generated` file, and a `@generated` file can't be a lane's deliverable: the build overwrites its content on every regeneration, so no lane commit can be said to own it. `lane-id-pattern.ts` is therefore hand-written TypeScript source, not generated, and kept from drifting against `datum/id_pattern.py` by `tests/test_id_pattern_ts_parity.py`, which reads both source files directly and asserts their `LANE_ID_PATTERN` literals are byte-for-byte identical and both anchored (`^...$`).

### Positive Consequences

* No new service to run, monitor, or fail — id resolution is a pure function of the repo's own directory name and git history.
* Every existing epic keeps working with zero migration.
* Cross-branch id collisions are still caught, just at merge/validate time instead of being architecturally impossible.
* The TS/Python pattern duplication is guarded by a test, not by convention alone.

### Negative Consequences

* Two branches can each believe they hold a valid, unique id right up until one of them tries to merge and `task_id_collision` fires — the failure is late, not upfront.
* Renaming the repo's directory after the first `task_id_prefix` resolution has no effect (by design), which can surprise someone who renames the repo expecting a new prefix.
* `lane-id-pattern.ts` and `datum/id_pattern.py` are two source-of-truth files instead of one; the parity test only catches drift when it is run.
