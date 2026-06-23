# Comparison Brief: `datum/fix-skills-path` → `datum-ax`

**Goal:** Determine what exists on the `datum` repo's `fix-skills-path` branch that
`datum-ax` does **not** have, and decide—per item—whether it's worth porting forward
into `datum-ax`.

Both repos should be checked out in this session:
- `datum` — original codebase. Branch under review: **`datum/fix-skills-path`** (compare against `main`).
- `datum-ax` — the successor/rewrite (Python). Treat as the destination.

> Names differ between repos. `datum-ax` may implement the same *concept* under a
> different symbol or module. Compare by **behavior/intent**, not by string match.
> When in doubt, grep `datum-ax` for the underlying idea before declaring it "missing."

---

## How to run the comparison

For each candidate below:
1. Confirm it exists and works on `datum/fix-skills-path` (diff vs `main`).
2. Search `datum-ax` for an equivalent (concept, not name).
3. Classify: **Present** / **Partial** / **Missing in ax**.
4. If Missing/Partial, judge: is it worth porting? (value vs. ax's architecture). Note
   whether ax already supersedes it with a better mechanism.

---

## Candidate features on `fix-skills-path` (grounded in the actual diff)

These are the substantive, potentially-novel additions. Verify each against `datum-ax`:

### 1. DDI — Dependency Derivation Input  *(highest-value candidate)*
- `inject_ddi_dependencies(...)` in `datum/lane_plan.py`
- New CLI arg `--dependencies <dependencies.json>` that merges an external DDI manifest
- Manifest maps **output file → input files**; edges are injected into task `depends_on`
  by matching files to task **ownership**. Returns count of edges injected.
- Tests: `tests/test_lane_plan_ddi.py` (`test_basic_injection`, `test_no_matching_files`,
  `test_self_ref_ignored`, `test_partial_match`, `test_no_duplicates`).
- **Check ax:** does it derive cross-lane/file dependency edges from a manifest, or only
  from declared `depends_on`? If ax's planner is purely declarative, this is a real gap.

### 2. Kahn topological sort + cycle detection
- `kahn_sort(tasks)` in `datum/lane_plan.py` (aliased `topological_sort`), applied at both
  unit and task level. Raises `ValueError` on circular `depends_on`, naming the cyclic set.
- Sets a `cycle_risk` flag on affected tasks.
- Tests: `test_linear_chain`, `test_diamond`, `test_parallel_lanes`, `test_cycle_detection`,
  `test_partial_cycle`, `test_no_deps`, `test_ignores_unknown_deps`,
  `test_no_cycle_risk_when_no_cycles`, `test_cycle_risk_set_for_cyclic_tasks`.
- **Check ax:** does ax topo-sort lanes with explicit cycle detection + a risk flag, or
  assume acyclic input?

### 3. `depcruise` CLI command — planned-vs-actual import audit
- `@app.command(name="depcruise")` in `datum/cli.py`.
- Reads planned deps + lane-plan file ownership, runs dependency-cruiser, diffs
  **planned vs actual** imports, flags unexpected imports and circular dependencies.
- **Check ax:** is there any post-hoc verification that the realized import graph matches
  the planned dependency graph? This is a guardrail, distinct from #1/#2.

### 4. `local_llm` PYTHONPATH hardening (#137)
- In `datum/local_llm.py`: prepends the datum root to `PYTHONPATH` on the subprocess env
  so the package imports regardless of cwd.
- **Check ax:** small but a real cwd-robustness fix. Likely already moot if ax doesn't
  shell out the same way — verify.

### 5. Skill/prompt + model-tier changes (`skills/src/`)
- `skills/src/shared/models.ts` (+ model-tier additions), `shared/types.ts`,
  `tests/test_model_tiers.py`, `datum-validate.ts`, `datum-plan.ts`, `datum-tdd-act*.ts`.
- `prompts/agent-preamble-full.md` was regenerated to a project-specific "Record Suite"
  (Swift 6.2 / 4-layer clean architecture) preamble — **this is target-project config, not
  a portable feature.** Don't port the preamble content; do check whether the *mechanism*
  (regenerating the preamble from a repo scan — commit `2c24d10`) exists in ax.

---

## Known dead weight — do NOT port (already evaluated)

- **The grep-based stub feature** (extract signatures via `grep` → write `.stub.js` →
  inject into dependent lanes). It is broken, untested, never wired into the runnable `.js`,
  and conceptually **superseded** by ax's context-curation approach. Skip it.
- **`.tokensave/` artifacts** committed on the branch (incl. a 9.7 MB `tokensave.db`) —
  build/tooling cruft, not a feature. Ignore.

---

## Output requested

A table: `Feature | On branch? | In ax? (Present/Partial/Missing) | Port? (Y/N + why)`,
followed by a short recommendation on the 1–2 items actually worth porting (DDI and
cycle-detection are the leading candidates).
