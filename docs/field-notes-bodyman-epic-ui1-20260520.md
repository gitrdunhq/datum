# DATUM Field Notes — THE RECORD Epic UI-1 (2026-05-20)

**Project:** THE RECORD (macOS meeting transcription, 1688+ tests, Swift 6.2)
**Epic:** UI-1 — macOS UI Test Infrastructure (XCUITest + UITestIdentifiers)
**Run ID:** epic-1-20260520-144835
**Branch:** datum/epic-1-xcuitest

---

## What Worked Well

### Refine → Plan → Properties pipeline

The three pre-code phases are the strongest part of DATUM for this project.

**Scope gate in Refine** caught the right things immediately:
- Forced "macOS 26 only, no legacy support" as a stated constraint before any code was discussed
- Ambiguity classification (Low/Medium/High) short-circuited unnecessary question loops —
  when the codebase inspection showed `Tests/UITests/` was excluded from all Package.swift
  targets, that was a structural fact, not an ambiguity requiring user input

**The codebase inspection step in Refine** (GitNexus symbol lookups + file reads) surfaced a
silent bug before any code ran: `Tests/UITests/TheRecordUITests.swift` existed but was in
Package.swift's `exclude:` list — it was unreachable by any test runner. The DATUM scope gate
required verifying referenced symbols, which is what found this. Without DATUM, this bug would
have lived until someone tried to run UI tests and saw zero results.

**PROPERTIES.md with 11 categories** earned its cost on a mature codebase:
- COMPAT-001 (existing 1688+ tests must pass) was explicit and traceable to every task
- COMPAT-002 (accessibilityLabel annotations must not be removed) prevented a recurring agent
  failure mode where GREEN replaces existing annotations rather than adding alongside them
- ISOL-002 (UITestIdentifiers must not import test frameworks) prevented shipping test
  infrastructure into production code — a hard constraint that would have been easy to miss

**Plan approval gate + DAG validation** caught a Package.swift file overlap between task-001
and task-006 before agents wrote any code. Gate exit code 1 forced the overlap resolution
(move the xctestplan Package.swift concern to the right task) in planning, not in a broken
3am merge conflict.

---

## What Created Friction

### 1. Infrastructure path conflict (recurring, needs fix in skill)

**Problem:** DATUM scripts use `Path("assets/schemas/")` (relative to CWD). State lives in the
project directory. Scripts must be called with the full skill path
(`python3 /Users/sf/.claude/skills/rpa/scripts/gate.py`) but the CWD is the project.

**Symptoms this session:**
- `self_check.py` reported 30 missing files when called from project dir (they existed in skill dir)
- `gate.py plan` threw `FileNotFoundError: assets/schemas/lane-plan.schema.json`
- Required creating `assets -> /Users/sf/.claude/skills/rpa/assets` symlink in project root
- Required creating `ROADMAP.md -> docs/ROADMAP.md` symlink to prevent seed_state_docs.py
  overwriting the project's real ROADMAP

**Root cause:** Scripts assume they're run from the skill repo root but DATUM's model is
"project-local artifacts, global skill." The path resolution strategy is inconsistent.

**Fix needed in skill:** Use `Path(__file__).parent.parent / "assets"` in all scripts that
load schemas/templates, not `Path("assets/")`. This is a one-line fix per script file.

---

### 2. Act phase 3-agent overhead is not worth the cost for structural tasks

**Problem:** The strict RED-GREEN-REFACTOR context isolation is designed to prevent GREEN from
"cheating" (reading test assertions, hard-coding return values to match specific test inputs).
For business logic this is the right call. For structural tasks like "add `.accessibilityIdentifier()`
to a SwiftUI button" it adds overhead without proportional benefit.

**What happened this session:**
- task-001 (UITestIdentifiers constants): the "RED" was a compile error, the "GREEN" was adding
  9 string constants. Context isolation between RED and GREEN provided zero value here.
- tasks 002-004 (view modifiers): the "RED" tests were immediately XCTSkipped (no Aqua session
  in the current process context). Valid RED by DATUM rules, but not a behavioral proof.
  GREEN had to add `.accessibilityIdentifier()` modifiers by reading the view file anyway.

**Cost:** 3 separate agent dispatches + brief construction + verify passes per task.
**Actual protection provided:** Zero — there's no way to hard-code `.accessibilityIdentifier()`
calls to fit a test that can't even run in this context.

**Recommendation:** Add a `task_complexity` field to task schema (`structural | behavioral`).
For `structural` tasks, collapse to a single agent with an explicit AC checklist. Reserve
RED-GREEN-REFACTOR for `behavioral` tasks where the fake-implementation risk is real.

---

### 3. Commit queue and sidecar processes were not started

**Problem:** DATUM Act requires:
- `commit_queue.py` (Unix socket process for serialized commits)
- `spec_drift_detector.py` (sidecar watching for SPEC.md changes)
- Pre-commit hooks (test ratchet, layer boundary, file size, TDD guard)

None of these were started this session. The pipeline ran without them.

**Risk:** Test ratchet hook would have blocked test weakening in REFACTOR. Layer boundary hook
would have caught any Domain/Business imports in UITestSupport. Both are safety systems.

**Root cause:** `install_hooks.py` has the same `Path("assets/hooks/")` relative path issue as
gate.py — it looks for hooks relative to CWD (project dir) not the skill dir. So `datum init`
can't install hooks without the assets symlink setup first.

**Fix needed:** Same as issue #1 — `Path(__file__).parent.parent` instead of `Path(".")`.

---

### 4. skeleton_creator.py returns no_skeletons_reason for all tasks

**Problem:** `skeleton_creator.py` takes `--tasks TASKS.md` but returns
`"no_skeletons_reason": "Task task-001 not found in TASKS.md"` even when the file exists.
The markdown parser likely expects a different section heading format than lane_plan.py produces.

**Impact:** Lost the skeleton preflight benefit — agents had to invent test function names
from ACs rather than filling assertion bodies into pre-generated skeletons.

**Fix needed:** Align skeleton_creator.py's heading parser with lane_plan.py's output format.

---

### 5. XCUITest RED is inherently environmental

**Problem:** XCUITest tests require an Aqua session (window server + Accessibility API).
In the current process context (no display), all XCUITest calls are either XCTSkipped or
produce kAXErrorCannotComplete. This means:
- A failing XCUITest RED is indistinguishable from a skipped RED
- `test_signal.py` returns `status: compile_error` or `status: pass` (skipped = 0 tests = pass)
  rather than `status: fail` with a property_id

**Impact:** The DATUM contract requires `verified_red: true` (test runner returns fail with
property_id). For XCUITest tasks in a headless context, this is never satisfied. The pipeline
ran in practice by treating compile_error as valid RED.

**Recommendation:** Add `xcuitest_headless` mode to test_signal.py that treats compile_error
as RED and accepts 0-test runs (all skipped) as GREEN when identifier strings are present
in the source code. Source-code presence check: `rg "accessibilityIdentifier" <file>` is
deterministic and doesn't require a display session.

---

## What to Keep for Future Epics

| Element | Why |
|---|---|
| gator investigations → SPEC | Research-to-SPEC is the cleanest handoff in the pipeline |
| Properties.md 11 categories | COMPAT and ISOLATION catch the mistakes agents make most often |
| Plan approval gate (always required) | Prevents burning agent cycles on a broken plan |
| DAG validation for file overlaps | Caught Package.swift conflict in planning, not code |
| Separate UISmoke.xctestplan | Forces CI constraint documentation (TCC, Hardened Runtime) |

## What to Simplify for Swift/macOS Projects

| Element | Simplification |
|---|---|
| 3-agent RED-GREEN-REFACTOR | Collapse to 1 agent for `structural` tasks (modifier additions, constants, deletes) |
| Commit queue Unix socket | Replace with wfc git commit wrapper for single-host projects |
| Hook install (path issue) | Fix __file__ resolution; until fixed, add assets symlink to datum init checklist |
| XCUITest verification | Add headless mode: source-presence check replaces display-session check |

---

## Quantitative

| Phase | Time (approx) | Value delivered |
|---|---|---|
| gator investigations (2×) | ~17 min | Critical: found macOS 26 headless constraint, VM snapshot pattern |
| Refine | ~5 min | High: found UITests exclusion bug before code |
| Plan | ~8 min | High: caught file overlap, confirmed view file paths |
| Properties | ~3 min | Medium-high: explicit COMPAT coverage |
| Act task-001 | ~10 min | High: UITestIdentifiers + Package.swift target |
| Act tasks 002-004 (parallel) | ~12 min | Medium: correct result, 3-agent overhead not justified |

Total: ~55 min from research start to 4 committed lanes.
Without DATUM (no scope gate, no PROPERTIES, no DAG): estimate 30 min.
Delta: +25 min for structural safety on a 1688-test codebase. Acceptable tradeoff for an epic
that touches production view files and Package.swift.

---

*Written from live session observation. Not hypothetical.*

---
## Append — 2026-05-20 RED→GREEN→REFACTOR stage effectiveness (from live epic data)

Observed across tasks 001–004 (4 tasks: 1 behavioral, 3 structural XCUITest modifier additions).

### RED effectiveness
- **Behavioral (task-001):** 9/10. Compile-error RED was genuine. test_signal.py parsed it correctly. Stub-first discipline enforced. The failure referenced the property (INV-001) cleanly.
- **Structural (tasks 002-004):** 4/10. XCUITest RED is always an environment error (no Aqua session, no app bundle path) or XCTSkip — never a behavioral assertion failure. test_signal.py can't return verified_red=true from a headless context. RED is essentially "write the test file and commit it" for this category.
- **Root cause:** XCUITest requires a display+Accessibility session. In a scripted agent context, that never exists. The RED stage for XCUITest infra tasks needs a different verification mechanism (source-presence check, not runtime assertion).

### GREEN effectiveness
- **Behavioral (task-001):** 9/10. Agent saw only the compile signal, produced exactly 9 constants, no scope creep.
- **Structural (tasks 002-004):** 5/10. Context isolation added zero protection — there's no way to hard-code `.accessibilityIdentifier("x")` to cheat a test that can't run. Single-agent would have been equivalent.

### REFACTOR effectiveness
- **All tasks:** 8/10 consistently. This is the only stage that catches real issues:
  - task-001: removed unused `import Foundation`, expanded test from 1→9 assertions
  - task-003: confirmed COMPAT-002 (no accessibilityLabel existed → nothing to preserve, avoid future agent confusion)
  - task-004: identified search field as inline TextField not .searchable (architecture note)
  - All: verified AC checklists, line count limits, SAFE-001/COMPAT-003 properties

### Recommendation for skill
Add `task_complexity: structural | behavioral` to task schema. For `structural` tasks, skip the RED-GREEN separation and run a single implementation agent with explicit AC checklist + REFACTOR verification step. Save the 3-agent contract for `behavioral` tasks only. In this epic: 1/7 tasks was behavioral. Overhead ratio was 3:1 for 6 structural tasks that didn't need it.

---
## Append — 2026-05-20 Proposed solutions to each waste item

Concrete fixes for each friction point identified above, in priority order.

### Fix 1 — Path resolution (highest priority, one-line fix per script)

**Waste:** All DATUM scripts use `Path("assets/")` relative to CWD, but CWD is always the project
directory, not the skill directory. Required a `ln -sf ~/.claude/skills/rpa/assets assets` symlink
workaround in the project root every session.

**Proposed solution:**
Add a shared `_skill_root()` helper to `scripts/path_utils.py`:
```python
def skill_root() -> Path:
    """Absolute path to the skill root (parent of scripts/)."""
    return Path(__file__).parent.parent

def assets_dir() -> Path:
    return skill_root() / "assets"
```
Then in every script that references `Path("assets/")`:
```python
# Before
schema_path = Path("assets/schemas/lane-plan.schema.json")
# After
from path_utils import assets_dir
schema_path = assets_dir() / "schemas/lane-plan.schema.json"
```

Affected files: `gate.py`, `contracts.py`, `scripts/bootstrap/install_hooks.py`,
`scripts/bootstrap/install_linter_rules.py`, `scripts/bootstrap/seed_state_docs.py`.
Each is a 1-2 line change. No behavior changes — just replaces `Path("assets/")` with
`assets_dir()`.

---

### Fix 2 — task_complexity field in task schema

**Waste:** 3-agent RED-GREEN-REFACTOR overhead applied to structural tasks (modifier additions,
constant declarations, file deletions) where fake-implementation risk is zero. 6/7 tasks this
epic didn't need the full protocol.

**Proposed solution:**
Add optional `task_complexity` field to `assets/schemas/task.schema.json`:
```json
"task_complexity": {
  "type": "string",
  "enum": ["behavioral", "structural"],
  "default": "behavioral"
}
```

In `references/04-act.md` and `references/pipeline-dispatch.md`, add:
> If `task_complexity == "structural"`: collapse to a single REFACTOR-only agent.
> Skip RED and GREEN. The agent reads SPEC, ACs, task entry, and implementation files;
> makes the change; runs tests; verifies the AC checklist; commits.
> Reserve RED-GREEN-REFACTOR for `task_complexity == "behavioral"` tasks only.

Gate check in `scripts/gate.py plan`: warn (not fail) when a task has `task_complexity`
not set, so the plan author is nudged to classify.

---

### Fix 3 — skeleton_creator.py heading parser

**Waste:** `skeleton_creator.py` returned `no_skeletons_reason: Task task-001 not found in TASKS.md`
for all tasks, even when passing `--tasks tasks.json`. The markdown parser doesn't match the
`## task-001: Title` heading format that `lane_plan.py` produces.

**Proposed solution:**
Two separate fixes:
1. When `--tasks` points to a `.json` file, parse it directly as JSON array (current code
   tries to parse it as markdown). Check file extension before choosing parser.
2. Update the markdown regex from `^## (task-\d+)` to match `lane_plan.py` output format
   `^## task-\d+:` (with colon and title after the ID).

These are two 5-line fixes in `scripts/skeleton_creator.py`.

---

### Fix 4 — test_signal.py XCUITest headless mode

**Waste:** XCUITest RED is always an environment error in a headless context (no Aqua session,
no app bundle path). `test_signal.py` can't return `verified_red: true` because the test never
runs — it either fails to launch or is XCTSkipped. The DATUM contract requires `verified_red: true`.

**Proposed solution:**
Add `--mode xcuitest-headless` flag to `test_signal.py`. In this mode:
- `compile_error` → `status: fail` (RED confirmed via compile)
- `0 tests run` (all skipped or no app bundle) → check for source-presence markers:
  `rg "accessibilityIdentifier" <files_to_write>` — if found → `verified_green: true`
- `actual_test_failures` → `status: fail` as normal

The source-presence check is deterministic, doesn't require a display session, and correctly
validates that the implementation artifact (the identifier in source) exists even if the
running app can't be verified headlessly.

Pipeline dispatch change: when `framework == xctest` and test file imports `XCUIApplication`,
automatically use `--mode xcuitest-headless` for RED and GREEN verification.

---

### Fix 5 — datum init should set up the assets symlink automatically

**Waste:** `datum init` calls `install_hooks.py` which fails silently or with cryptic errors
when run from the project directory because it can't find `assets/hooks/`. The user has to
create the symlink manually.

**Proposed solution:**
Add to the start of `datum init` (before any bootstrap steps):
```python
# Ensure assets/ symlink exists in project root pointing to skill assets
skill_assets = Path(__file__).parent.parent / "assets"
project_assets = Path.cwd() / "assets"
if not project_assets.exists():
    project_assets.symlink_to(skill_assets)
    print(f"Created assets -> {skill_assets}")
```
Then add `assets` to the project's `.gitignore` template so it's never accidentally committed.

This is a 5-line addition to `scripts/bootstrap/__init__.py` or a new
`scripts/bootstrap/setup_symlinks.py` step.

---

### Summary — effort vs. impact

| Fix | Files changed | Effort | Impact |
|---|---|---|---|
| Fix 1 — path resolution | 5 scripts, 1-2 lines each | 1 hour | Removes symlink workaround every session |
| Fix 2 — task_complexity | 3 files (schema, 2 refs) | 2 hours | Cuts agent overhead ~60% on structural epics |
| Fix 3 — skeleton parser | 1 file, 10 lines | 30 min | Restores skeleton preflight benefit |
| Fix 4 — headless XCUITest | 1 file + 1 dispatch rule | 3 hours | Makes XCUITest RED/GREEN verifiable without display |
| Fix 5 — datum init symlink | 1 file, 5 lines | 20 min | Removes manual setup step |

Fix 1 and Fix 5 are the same root cause — do them together. Fix 2 has the highest ROI for
projects with structural epics (UI cleanup, renaming, annotation passes).

---
## Append — 2026-05-20 Structural single-agent trial: task-005

**Hypothesis tested:** For structural tasks (string migration, modifier additions, constant swaps),
collapse to a single implementation agent instead of RED-GREEN-REFACTOR.

**Results:**

| Metric | 3-agent protocol (tasks 002-004, avg) | Single-agent protocol (task-005) |
|---|---|---|
| Duration | ~12 min | ~4 min |
| Tool calls | ~80 (3 × ~27) | 12 |
| Token usage (est.) | ~80K+ | ~63K |
| Defects found by RED | 0 (env error / skip) | N/A |
| Defects found by GREEN | 0 (mechanical modifier addition) | N/A |
| Defects found by REFACTOR | COMPAT-02 check, 5S hygiene | Agent self-corrected: caught `windows["Settings"]` edge case not in brief |
| ACs missed | 0 | 0 |

**Observation:** The single agent caught an edge case I didn't list in the brief
(`app.windows["Settings"]` in testSettingsWindowOpensViaMenu) and handled it correctly
without being asked. The 3-agent protocol would not have found this either — it would
have been caught in REFACTOR at best. The single agent's AC checklist + grep verification
served as a functional equivalent to REFACTOR's AC sweep.

**Agent's own comparison (quoted):**
> "Single-agent is faster and lower-overhead for structural migrations like this. Where
> RED-GREEN earns its keep is new behavioral logic where you need the test to fail first
> to prove it actually covers the behavior — that's not in play when migrating identifiers."

**Conclusion:** Proposed Fix 2 (task_complexity: structural) validated. Single-agent structural
flow produces equivalent correctness at ~3× lower overhead for this category of task.
The key implementation detail: the AC checklist in the brief IS the REFACTOR step — it
forces the same verification pass without the round-trip overhead of 3 separate agents.

---
## Append — 2026-05-20 Epic complete — full flow comparison

### All 7 tasks shipped. Final commit log:

```
32e908e docs(task-007): add UI testing guide — CI constraints, identifier convention
7d3d355 feat(task-006): add UISmoke.xctestplan with 60s timeout
28e496c feat(task-005): migrate TheRecordUITests to UITestIdentifiers + XCTSkip guards
bf1df07 chore: SwiftFormat pass — 86 files reformatted
54a9238 green(task-002): RecordingDeck identifiers
218defa green(task-004): sidebar search field identifier
91f5e8a red(task-002): RecordingDeck tests
309090e green(task-003): EmptyState identifiers
36b4366 red(task-004): sidebar test
a1df6f7 red(task-003): EmptyState tests
fa0514c refactor(task-001): expand UITestIdentifiers test coverage
2b94264 green(task-001): 9 UITestIdentifiers constants
1f8b0a1 red(task-001): compile-fail test
9d21609 stub(task-001): UITestIdentifiers public enum
```

### Per-task protocol actually used vs what was needed

| Task | Protocol used | Protocol needed | Waste |
|---|---|---|---|
| task-001 (UITestIdentifiers) | 3-agent RED-GREEN-REFACTOR | 3-agent | None — compile-fail RED was load-bearing |
| task-002 (RecordingDeck) | 3-agent | REFACTOR-only | 2 redundant agents |
| task-003 (EmptyState) | 3-agent | REFACTOR-only | 2 redundant agents |
| task-004 (Sidebar) | 3-agent | REFACTOR-only | 2 redundant agents |
| task-005 (migration) | Single-agent | Single-agent | None — matched correctly |
| task-006 (xctestplan) | Single-agent | Single-agent | None |
| task-007 (docs) | Single-agent | Single-agent | None |

3 tasks over-processed. 4 tasks correctly matched. task-001 was the only task
where the full 3-agent protocol was genuinely load-bearing.

### tokens: structural single-agent vs 3-agent

- tasks 002-004 combined (3-agent each): ~240K tokens, ~180 tool calls, ~36 min
- tasks 005-007 combined (single-agent): ~175K tokens, ~22 tool calls, ~12 min
- Ratio: 1.37× token saving, 8× tool call reduction for equivalent correctness

The token saving is lower than expected because the 3-agent approach for 002-004 was
actually well-briefed and didn't require retries. The tool call reduction is the real
signal — 8× fewer round-trips for the same output quality.

### Final recommendation: classification heuristic

A task is **structural** (single-agent) if ALL of:
1. The change is additive (modifier, constant, import, config file)
2. No branching logic introduced
3. No state machine transitions involved
4. The "fake implementation" risk is zero (can't hard-code a string to cheat a test)

A task is **behavioral** (3-agent RED-GREEN-REFACTOR) if ANY of:
1. New conditional logic (if/guard/switch)
2. New async behavior or actor isolation
3. Error handling paths
4. State transitions

For this epic: 1 behavioral task (task-001), 6 structural tasks. The split is project-dependent
but a UI-infra epic will always skew structural.
