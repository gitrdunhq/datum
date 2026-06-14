# Bug Squash — 7 Pipeline Friction Bugs (#167)

## What
Fix 7 open bugs (4 critical, 3 high) that cause the datum pipeline to produce wrong results or block progress. All found during 2026-06-14 session.

## Requirements

### Critical — pipeline produces wrong results

1. **#166 Act phase silently skipped** — datum-go runs plan→review→closeout without executing any lanes. Act block must log whether lane-plan was found, how many lanes detected, and never complete silently with 0 lanes. If lane-plan.json isn't found at the epic dir path OR fallback path, throw with the paths tried.

2. **#161 Skeleton template generates invalid Python** — skeleton_creator.py produces function names with hyphens (e.g. `test_ac6_when-mypy-output-has-error-lines`). Function names must be slugified to valid Python identifiers (hyphens → underscores, strip special chars).

3. **#163 Lane plan assigns same impl file to multiple lanes** — when plan-decompose outputs multiple tasks touching the same file, lane-plan.json assigns it to all lanes causing RED/GREEN conflicts. Plan must detect shared files and either: (a) assign each file to exactly one lane, or (b) create a dependency chain so shared-file lanes run sequentially.

4. **#160 skeleton_creator.py overwrites test file on each lane** — when multiple lanes share a test file, each lane's skeleton overwrites the previous lane's tests. Skeleton must APPEND to existing test files, not overwrite.

### High — blocks pipeline progress

5. **#165 datum-go uses relative scriptPath** — `skills/datum-tdd-act-setup.js` etc. break when CWD isn't repo root. Use absolute paths resolved from the package install location.

6. **#158 + #162 test-count gate misses class-based tests** — grep pattern `def test_` misses `class TestFoo` methods. Use ast-grep or a broader grep that counts both `def test_` and `class Test`.

7. **#159 lane plan generates file_conflict_with but no resolution** — plan detects conflicts but doesn't act on them. If file_conflict_with is non-empty, auto-add dependency edges between conflicting lanes.

## Not This
- Don't refactor beyond what's needed for each fix
- Don't change the pipeline architecture
- Don't add new features — just fix what's broken
- Don't touch the fail-fast-validation epic (separate work)
