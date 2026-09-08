# PROPERTIES: Sequential repo-wide task numbers (DAT-NNN)

## 1. SAFETY — what must NEVER happen

- PROPERTY(SAFETY-001): `LANE_ID_PATTERN` never accepts `DAT142` (no hyphen), `dat-142` (lowercase), or `DATUM-142` (7-letter prefix).
- PROPERTY(SAFETY-002): No file under `datum/models/` contains the literal substring `task-\d` after task-005 lands.
- PROPERTY(SAFETY-003): The renumbering step never runs on the `--validate` path — a `tasks.json` containing `task-001`/`task-002` is byte-identical before and after `datum lane-plan --validate`.
- PROPERTY(SAFETY-004): `resolve_task_id_prefix` never writes a prefix shorter than 2 characters to `.datum/config.json` — a directory basename deriving to 0 or 1 letters raises `TaskIdPrefixError` instead of persisting.
- PROPERTY(SAFETY-005): No existing committed `tasks.json` under `docs/epics/` is migrated, rewritten, or has a `<PREFIX>-\d+` id introduced into it by any code path in this change.
- PROPERTY(SAFETY-006): A task lane whose id happens to start with `task-INT` but whose `kind` is `behavioral` is never classified as an integration lane by `datum/gate.py`.
- PROPERTY(SAFETY-007): `find_task_id_collisions` never reports the same id committed twice for the *same* lane/epic (self-match) as a collision.

## 2. LIVENESS — what must EVENTUALLY happen

- PROPERTY(LIVENESS-001): A fully automated `datum lane-plan` run on a fresh epic eventually produces a `tasks.json` with `<PREFIX>-<n>` ids, with no operator step in between.
- PROPERTY(LIVENESS-002): Every `depends_on` reference in `tasks.json` that pointed at a renumbered `task-NNN` id is eventually rewritten to the corresponding `<PREFIX>-<n>` value by the end of the renumbering pass.
- PROPERTY(LIVENESS-003): When `.datum/config.json` lacks `task_id_prefix`, a call to `resolve_task_id_prefix` eventually persists the derived value so a second call in the same repo returns it without re-deriving.
- PROPERTY(LIVENESS-004): When a real `task_id_collision` exists, `datum lane-plan --validate` eventually reports it (exits non-zero with the `task_id_collision` code) rather than passing silently.

## 3. INVARIANT — what must ALWAYS be true

- PROPERTY(INVARIANT-001): `datum.id_pattern.LANE_ID_PATTERN` is the single source of truth; `assets/schemas/task.schema.json`'s `id` and `depends_on` item patterns always equal it exactly (asserted by reading the JSON file, not re-typing the literal).
- PROPERTY(INVARIANT-002): The TypeScript `LANE_ID_PATTERN` string in `skills/src/shared/lane-id-pattern.ts` is always character-for-character identical to the Python `datum.id_pattern.LANE_ID_PATTERN`.
- PROPERTY(INVARIANT-003): For any accepted id, `re.fullmatch(LANE_ID_PATTERN, x)` and `isLaneId(x)` (TS) always agree (both true or both false) for the shared fixture list (`task-1`, `task-INT-1`, `DAT-142`, and their negatives).
- PROPERTY(INVARIANT-004): Widening is monotonic — every id shape that validated before this change (`task-\d+`, `task-INT-\d+`) always continues to validate after, across every touched schema file.
- PROPERTY(INVARIANT-005): An integration lane is always identified solely by `kind == 'integration'`, never by id shape, in `datum/gate.py` and downstream counters (`skills/src/datum-properties.ts`).
- PROPERTY(INVARIANT-006): `next_task_number(repo_root, prefix)` always equals `max(n for <PREFIX>-n found in committed docs/epics/*/tasks.json and lane-plan.json on HEAD) + 1`, or `1` when no such id exists.

## 4. BOUNDARY — valid input ranges

- PROPERTY(BOUNDARY-001): The prefix pattern `^[A-Z]{2,6}$` accepts exactly 2–6 uppercase letters; a derived prefix of length 0 or 1 is rejected with `task_id_prefix_invalid`, and a repo basename yielding more than 6 letters is truncated to the first 3 per the derivation rule (`AB-1` and `ABCDEF-9` both accepted as pre-existing/explicit values at the pattern-test boundary, but auto-derivation always truncates to 3).
- PROPERTY(BOUNDARY-002): `renumber_tasks(tasks, prefix, start)` assigns ids starting exactly at `start` and increases by 1 per lane with no gaps or reuse within a single decompose batch.
- PROPERTY(BOUNDARY-003): A task id numeric suffix of `0` is never assigned by the counter — the first id when none exist is `<PREFIX>-1`, not `<PREFIX>-0`.
- PROPERTY(BOUNDARY-004): An id with a different prefix (e.g. `ABC-99`) never contributes to or raises the `DAT` counter's maximum.

## 5. IDEMPOTENT — what is safe to run twice

- PROPERTY(IDEMPOTENT-001): Calling `resolve_task_id_prefix` twice on a fresh repo writes `.datum/config.json` once and leaves identical content on the second call (no re-derivation, no double-write).
- PROPERTY(IDEMPOTENT-002): Running `datum lane-plan --validate` twice in a row on the same `tasks.json` produces the same verdict and leaves the file byte-identical both times.
- PROPERTY(IDEMPOTENT-003): A task whose id is already `DAT-142` is left untouched by a second renumbering pass — its number is not reissued to another lane.

## 6. ORDERING — order invariants

- PROPERTY(ORDERING-001): Renumbering visits lanes in dependency (topological) order — a lane's id is assigned only after every lane it `depends_on` already has its final id, so no lower `<PREFIX>-<n>` number depends on a higher one within the same decompose batch.
- PROPERTY(ORDERING-002): The renumbering step always runs after decompose and before the plan gate validates the epic, for the non-`--validate` `datum lane-plan` path only.
- PROPERTY(ORDERING-003): Integration lane numbers always continue from the highest number the task lanes consumed in the same build (e.g. task lanes ending at `DAT-145` yield the first integration lane as `DAT-146`), and integration lanes appear in `topological_order` after the task lanes they cover.
- PROPERTY(ORDERING-004): task-005's repo-wide sweep test is only meaningful once task-001 through task-004 have converted their files — the dependency graph enforces this lane runs last among the widening lanes.

## 7. ISOLATION — what cannot leak between contexts

- PROPERTY(ISOLATION-001): A `<PREFIX>-<n>` id present only in the working tree (uncommitted) is never counted by `next_task_number`.
- PROPERTY(ISOLATION-002): A `<PREFIX>-<n>` id committed only on another local branch is never counted by `next_task_number` scoped to the current branch's HEAD.
- PROPERTY(ISOLATION-003): Two epics planned concurrently on separate branches can independently compute the same next number with no shared state leaking between them — collisions are only detected later via `task_id_collision`, never prevented via cross-branch state.
- PROPERTY(ISOLATION-004): Hermetic git-fixture tests (counter, collision) never read the invoking machine's global git config, hooks path, or `~/.ignore` — `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` are pinned to isolate the test from ambient environment.
- PROPERTY(ISOLATION-005): The brief/result schema test files (task-003, task-004) never import or share fixtures with each other — each is self-contained per the RED note's isolation rule.

## 8. PERFORMANCE — latency/throughput/size bounds

- PROPERTY(PERFORMANCE-001): The `max(existing)` counter scan over 100 synthetic epics in a temp repo completes in under 2 seconds.
- PROPERTY(PERFORMANCE-002): The counter scan issues exactly one `git show HEAD:<path>` per enumerated file (via `git ls-tree`/`git ls-files`), never a filesystem glob, keeping cost linear in committed file count, not repo history size.

## 9. SECURITY — access controls

- PROPERTY(SECURITY-001): `lane-steps.ts`'s `completionMarkerCommand`/`laneSpecExportCommand` reject any task id containing a shell metacharacter (an id `isLaneId` rejects) rather than passing it into a constructed shell command.
- PROPERTY(SECURITY-002): No `eval()`, `os.system()`, or `shell=True` is introduced by the git-plumbing counter/collision code (`git show`, `git ls-tree` invoked via safe subprocess argument lists).
- PROPERTY(SECURITY-003): `.datum/config.json` writes preserve every pre-existing key unchanged — prefix persistence never clobbers unrelated config fields.

## 10. OBSERVABILITY — what must be logged or measured

- PROPERTY(OBSERVABILITY-001): `TaskIdPrefixError`'s payload always contains exactly `{code: "task_id_prefix_invalid", message, correlationId}` and the test asserts all three keys, not just the code.
- PROPERTY(OBSERVABILITY-002): `datum lane-plan --validate`'s JSON output on collision always contains the code `task_id_collision`, the colliding id, and both conflicting epic paths — `{"valid": false, "reason": "task_id_collision", "collisions": [{"id": ..., "epics": [...]}]}`.
- PROPERTY(OBSERVABILITY-003): A schema-shape failure and a topology (cycle) failure each produce their own distinct error code, never `task_id_collision`, and a collision is never downgraded to a generic validation error.
- PROPERTY(OBSERVABILITY-004): `skills/src/datum-properties.ts` logs `integration_lanes_scheduled` with the correct count for both `DAT-`-prefixed and legacy `task-INT-`-prefixed integration lanes, and `integration_lanes_none` when there are none.

## 11. COMPATIBILITY — existing behavior that must be preserved

- PROPERTY(COMPATIBILITY-001): `DatumTask(id='task-001', depends_on=['task-002'], ...)` still constructs without raising (widening, not tightening).
- PROPERTY(COMPATIBILITY-002): `tests/test_lane_plan_schema_int_ids.py`, `tests/test_integration_invariants_frontier.py`, `tests/test_lane_plan_integration_lanes.py`, and `tests/test_gate_plan_integration_lanes.py` continue to pass byte-identical/unmodified.
- PROPERTY(COMPATIBILITY-003): For a lane plan still using `task-INT-1` with `kind: integration`, `datum/gate.py`'s behaviour is byte-identical to today (same verdict, same error list).
- PROPERTY(COMPATIBILITY-004): For a legacy `lane-plan.json` with `task-INT-1`/`task-INT-2` integration lanes, `skills/src/datum-properties.ts`'s reported count is unchanged (still 2).
- PROPERTY(COMPATIBILITY-005): Every epic present in `docs/epics/` at ship time passes `datum lane-plan --validate` with exit code 0 and zero file diffs.
- PROPERTY(COMPATIBILITY-006): `tests/test_task_slug.py` keeps passing unmodified after task-001 lands.

## Traceability Table

| Property ID | Category | Predicate | Task IDs |
|---|---|---|---|
| SAFETY-001 | SAFETY | Rejects DAT142/dat-142/DATUM-142 | task-001, task-006 |
| SAFETY-002 | SAFETY | No `task-\d` literal survives under datum/models/ | task-005 |
| SAFETY-003 | SAFETY | Renumber never fires on --validate path | task-010 |
| SAFETY-004 | SAFETY | No sub-2-char prefix ever persisted | task-008 |
| SAFETY-005 | SAFETY | No existing epic migrated | task-007, task-010, task-011, task-014 |
| SAFETY-006 | SAFETY | kind is sole integration discriminator | task-007 |
| SAFETY-007 | SAFETY | No self-match collision | task-013 |
| LIVENESS-001 | LIVENESS | Fresh epic auto-produces PREFIX-n ids | task-010 |
| LIVENESS-002 | LIVENESS | depends_on rewritten alongside id | task-010 |
| LIVENESS-003 | LIVENESS | Prefix persisted after first derive | task-008 |
| LIVENESS-004 | LIVENESS | Real collision always reported | task-013 |
| INVARIANT-001 | INVARIANT | JSON schema pattern == LANE_ID_PATTERN | task-001 |
| INVARIANT-002 | INVARIANT | TS pattern == Python pattern | task-006 |
| INVARIANT-003 | INVARIANT | Python/TS fullmatch agreement | task-001, task-006 |
| INVARIANT-004 | INVARIANT | Widening is monotonic across all schemas | task-001, task-002, task-003, task-004, task-005 |
| INVARIANT-005 | INVARIANT | Integration lane identified by kind only | task-007, task-011, task-012 |
| INVARIANT-006 | INVARIANT | next_task_number == max+1 over committed ids | task-009 |
| BOUNDARY-001 | BOUNDARY | Prefix length/derivation boundaries | task-008 |
| BOUNDARY-002 | BOUNDARY | renumber_tasks assigns start..start+n-1 with no gaps | task-010 |
| BOUNDARY-003 | BOUNDARY | First id is <PREFIX>-1, never -0 | task-009 |
| BOUNDARY-004 | BOUNDARY | Different-prefix id never raises counter | task-009 |
| IDEMPOTENT-001 | IDEMPOTENT | resolve_task_id_prefix idempotent | task-008 |
| IDEMPOTENT-002 | IDEMPOTENT | Repeated --validate stable and non-mutating | task-010, task-014 |
| IDEMPOTENT-003 | IDEMPOTENT | Already-prefixed id untouched by renumber | task-010 |
| ORDERING-001 | ORDERING | Topological renumber order | task-010 |
| ORDERING-002 | ORDERING | Renumber runs after decompose, before gate, only on build path | task-010 |
| ORDERING-003 | ORDERING | Integration lane numbers continue after task lanes | task-011 |
| ORDERING-004 | ORDERING | Sweep lane scheduled last among widening lanes | task-005 |
| ISOLATION-001 | ISOLATION | Uncommitted id ignored | task-009 |
| ISOLATION-002 | ISOLATION | Other-branch id ignored | task-009 |
| ISOLATION-003 | ISOLATION | Concurrent branches can compute same number | task-009, task-013 |
| ISOLATION-004 | ISOLATION | Hermetic git env in counter/collision tests | task-009, task-013 |
| ISOLATION-005 | ISOLATION | Brief/result test files self-contained | task-003, task-004 |
| PERFORMANCE-001 | PERFORMANCE | 100-epic scan under 2s | task-009 |
| PERFORMANCE-002 | PERFORMANCE | One git show per file, no glob | task-009 |
| SECURITY-001 | SECURITY | Shell-metacharacter id rejected by TS commands | task-006 |
| SECURITY-002 | SECURITY | No eval/os.system/shell=True introduced | task-009, task-013 |
| SECURITY-003 | SECURITY | Config write preserves unrelated keys | task-008 |
| OBSERVABILITY-001 | OBSERVABILITY | TaskIdPrefixError payload shape | task-008 |
| OBSERVABILITY-002 | OBSERVABILITY | Collision JSON output shape | task-013 |
| OBSERVABILITY-003 | OBSERVABILITY | Distinct error codes per failure kind | task-013 |
| OBSERVABILITY-004 | OBSERVABILITY | integration_lanes_scheduled/none counts | task-012 |
| COMPATIBILITY-001 | COMPATIBILITY | task-001-style id still constructs | task-001 |
| COMPATIBILITY-002 | COMPATIBILITY | Named witness test files pass unmodified | task-002, task-011 |
| COMPATIBILITY-003 | COMPATIBILITY | gate.py byte-identical for legacy task-INT- | task-007 |
| COMPATIBILITY-004 | COMPATIBILITY | datum-properties.ts count unchanged for legacy ids | task-012 |
| COMPATIBILITY-005 | COMPATIBILITY | All existing epics validate, zero diffs | task-014 |
| COMPATIBILITY-006 | COMPATIBILITY | test_task_slug.py unmodified | task-001 |

## Per-Task Property Assignments

- **task-001**: SAFETY-001, INVARIANT-001, INVARIANT-003, INVARIANT-004, COMPATIBILITY-001, COMPATIBILITY-006
- **task-002**: INVARIANT-004, COMPATIBILITY-002
- **task-003**: INVARIANT-004, ISOLATION-005
- **task-004**: INVARIANT-004, ISOLATION-005
- **task-005**: SAFETY-002, INVARIANT-004, ORDERING-004
- **task-006**: SAFETY-001, INVARIANT-002, INVARIANT-003, SECURITY-001
- **task-007**: SAFETY-005, SAFETY-006, INVARIANT-005, COMPATIBILITY-003
- **task-008**: SAFETY-004, LIVENESS-003, BOUNDARY-001, IDEMPOTENT-001, OBSERVABILITY-001, SECURITY-003
- **task-009**: INVARIANT-006, BOUNDARY-003, BOUNDARY-004, ISOLATION-001, ISOLATION-002, ISOLATION-003, ISOLATION-004, PERFORMANCE-001, PERFORMANCE-002, SECURITY-002
- **task-010**: SAFETY-003, LIVENESS-001, LIVENESS-002, BOUNDARY-002, IDEMPOTENT-002, IDEMPOTENT-003, ORDERING-001, ORDERING-002
- **task-011**: SAFETY-005, INVARIANT-005, ORDERING-003, COMPATIBILITY-002
- **task-012**: INVARIANT-005, OBSERVABILITY-004, COMPATIBILITY-004
- **task-013**: SAFETY-007, LIVENESS-004, ISOLATION-003, ISOLATION-004, OBSERVABILITY-002, OBSERVABILITY-003, SECURITY-002
- **task-014**: SAFETY-005, IDEMPOTENT-002, COMPATIBILITY-005
- **task-015**: No independent testable property — this is a documentation-only lane (ADR). Flagged below.

### Flagged: task without a testable property

- **task-015** (ADR: repo-wide sequential task ids) has no runtime-testable property of its own; it records rationale already covered by the properties assigned to task-001, task-008, task-006, and task-013. Per the RED Note, this lane is "Documentation only, no test stage," so this is expected, not a gap.

## Integration Invariants

| ID | Invariant | Covers | Source |
|---|---|---|---|
| II-001 | The shared `assets/schemas/lane-id.json` `pattern`/`prefix_pattern`/`new_id_pattern` fields are consumed identically by the Python loader and the esbuild-bundled TS loader, with one test per language asserting the same accept/reject set over a shared fixture list | task-001, task-006 | question:Q1 |
| II-002 | `datum lane-plan --validate` on a collision exits 1 with exactly `{"valid": false, "reason": "task_id_collision", "collisions": [{"id", "epics"}]}` and the plan gate surfaces the halt message naming both epic paths and the `--renumber` remedy, without auto-renumbering | task-013 | question:Q2 |
| II-003 | The `max(existing)` counter scan (`git ls-files` + one `git show HEAD:<path>` per file) completes in under 2 seconds for 100 synthetic epics in a temp repo, pinned by a dedicated performance test | task-009 | question:Q3 |
| II-004 | The counter and collision checks are strictly scoped to the current branch's committed HEAD; unmerged/other-branch ids never count toward `next_task_number`, and cross-branch duplicates are only ever caught post hoc by `task_id_collision`, never prevented | task-009, task-013 | question:Q4 |
| II-005 | A lane id renumbered by task-010 in dependency order flows unchanged through task-007's kind-based gate classification, task-011's counter-based integration-lane synthesis, task-012's kind-based counting, and task-013's collision detection — the same `<PREFIX>-<n>` string is never reshaped between these stages | task-007, task-009, task-010, task-011, task-012, task-013 | spec:Requirement 4 |
| II-006 | A `DAT-142` id produced by decompose+renumber propagates verbatim into the branch name, worktree path, marker file name, commit subjects, `Datum-Lane` trailer, and issue title with no intermediate reshaping across the CLI/render/github_issues boundary | task-010, task-014 | spec:Requirement 8 |
