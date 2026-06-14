# Clarifying Questions — Bug Squash #167

## Refine — 2026-06-14

### Q1: [Architecture] For shared-file conflicts (#163), should the fix assign each file to exactly one lane (ownership model) or create sequential dependency edges between all lanes touching the file?

> `build_file_ownership()` already implements a first-claimant ownership model at `datum/lane_plan.py:121` — the first task to claim a file owns it. The return value `conflicts` is currently discarded (`_` at line 356). Two strategies are possible: (a) strip the file from non-owner lanes' `files` arrays so only the owner lane attempts to write it, or (b) keep all lanes' `files` arrays intact and inject `depends_on` edges so non-owner lanes run sequentially after the owner. Strategy (a) changes what each lane is responsible for; strategy (b) keeps lane scope intact but serializes execution.
>
> I'm assuming strategy (b) — dependency edges, no scope change — because it's the minimal diff and the existing `depends_on` field already supports it. Is that right, or should non-owner lanes have the shared file removed from their `files` list?

[Answer]:

---

### Q2: [Behavior] For the missing lane-plan error in `datum-go.js` (#166), what error type should be thrown and should the paths be logged to stdout, stderr, or as structured JSON?

> The Act phase currently throws a plain string or `Error` object when `lanePlan` is null. The ticket says "throw with the paths tried" but doesn't specify: (a) error class (`ValueError`-equivalent in JS, `FileNotFoundError`, or a custom `DatumError`), (b) whether paths should appear in the thrown message only or also as a pre-throw `console.error` / structured log line, and (c) whether the path list should be machine-readable JSON or a human-readable string.
>
> I'm assuming: throw a plain `Error` with the paths embedded in the message string (e.g. `"Lane plan not found. Tried:\n  - /path/a\n  - /path/b"`), with a `console.error` pre-throw log of the same info to stderr. No structured JSON logging. Is that the right format, or does the error need to be machine-parseable?

[Answer]:

---

### Q3: [Integration] For the test-count gate fix (#158/#162), is a broader `grep` pattern sufficient, or is `ast-grep` required for correctness?

> The current pattern `"def test_\\|async def test_"` and the diff-context pattern `'^+def test_'` miss class-method tests because they require the match to start at column 0. A broader grep like `grep -c 'def test_'` (no column anchor) would count both top-level functions and class methods. `ast-grep` would be more precise (only counts real function definitions, ignores comments/strings) but requires a new binary dependency.
>
> I'm assuming broader grep (no column anchor, no ast-grep) is acceptable — it avoids a new dep and the false-positive rate (matching `# def test_` in comments) is low in practice. Is that right, or do we need ast-grep accuracy?

[Answer]:

---

### Q4: [Architecture] For `datum-go.js` script path resolution (#165), should paths be resolved relative to `__dirname` of `datum-go.js` itself, or relative to the installed package root?

> `datum-go.js` lives at `skills/datum-go.js`. The sibling scripts it calls (`datum-tdd-act-setup.js`, etc.) also live in `skills/`. Resolving via `path.resolve(__dirname, 'datum-tdd-act-setup.js')` would work if `datum-go.js` is always co-located with its siblings. However, if `datum` is ever installed as an npm package into `node_modules/`, the relative structure may differ.
>
> I'm assuming `__dirname`-relative resolution is correct for the current setup — all scripts live in `skills/` alongside `datum-go.js`. Is that the right anchor, or should paths be resolved from the package install root (e.g. via `require.resolve()`)?

[Answer]:

---

### Q5: [Behavior] For skeleton append mode (#160), should existing duplicate function names be detected and skipped, or should we append blindly and let `pytest` report the collision?

> When two lanes each generate a test for the same acceptance criterion (e.g. both produce `test_ac1_when_foo`), appending the second skeleton produces a duplicate function name in the test file. Python allows this (last definition wins), but `pytest` may warn or behave unexpectedly.
>
> I'm assuming blind append is acceptable for this ticket — deduplication is called out as out-of-scope in the TICKET's "Not This" section. Is that right, or should the append step skip functions that already exist in the file?

[Answer]: Blind append is correct. Deduplication is explicitly out-of-scope ("Not This" in TICKET.md). Python's last-definition-wins behavior is acceptable — pytest will exercise the final function definition. If a lane generates duplicate test names, that's a lane planning issue to address separately, not a skeleton append concern. Keep the append step simple: parse, append, write.
