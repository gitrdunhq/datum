# Pattern Library

Living catalog of failure patterns used by `scripts/diagnose_failure.py`.
Updated by `scripts/learn_patterns.py` after each epic's unknown failures are reviewed.
Version-controlled so the library grows with the project.

**Format:** each pattern has a `regex`, a `classification` (ENVIRONMENTAL/REASONING/HARD_STOP),
a `cause` key, and a `fix_hint` for ENVIRONMENTAL patterns.
Add new patterns at the bottom of each section. Do not reorder — the classifier
uses first-match; more specific patterns should appear before general ones.

---

## HARD_STOP patterns

```toml
[[patterns]]
regex = "hook blocked|pre-commit hook.*failed.*layer.boundary"
classification = "HARD_STOP"
cause = "hook_blocked_write"
note = "Layer boundary or banned pattern hook fired. Never retry."

[[patterns]]
regex = "banned pattern detected"
classification = "HARD_STOP"
cause = "hook_blocked_write"

[[patterns]]
regex = "test_ratchet.*violation|ratchet.*commit blocked"
classification = "HARD_STOP"
cause = "test_ratchet_violation"

[[patterns]]
regex = "sandbox.violation|ulimit.*exceeded|network.*blocked.*sandbox"
classification = "HARD_STOP"
cause = "lane_tool_sandbox_violation"

[[patterns]]
regex = "pip install|npm install|brew install|apt-get install"
classification = "HARD_STOP"
cause = "external_dependency_install"
```

---

## ENVIRONMENTAL patterns

```toml
[[patterns]]
regex = "error: no such file or directory"
classification = "ENVIRONMENTAL"
cause = "stale_path"
fix_hint = "Re-resolve file path via GitNexus context or filesystem check; rewrite brief"

[[patterns]]
regex = "cannot find .* in scope|use of unresolved identifier"
classification = "ENVIRONMENTAL"
cause = "stub_not_committed"
fix_hint = "Wait for upstream stub commit; re-dispatch when stub lands"

[[patterns]]
regex = "warning:.*auto-correctable"
classification = "ENVIRONMENTAL"
cause = "lint_fixable"
fix_hint = "Run: datum lint --fix; re-verify"

[[patterns]]
regex = "reformatted \\d+ files|format.*check.*failed"
classification = "ENVIRONMENTAL"
cause = "format_mismatch"
fix_hint = "Run: datum format; re-verify"

[[patterns]]
regex = "exit code 124"
classification = "ENVIRONMENTAL"
cause = "subagent_timeout"
fix_hint = "Re-dispatch single agent with same brief"

[[patterns]]
regex = "nothing to commit"
classification = "ENVIRONMENTAL"
cause = "duplicate_commit"
fix_hint = "Patch already applied; fetch HEAD and continue"

[[patterns]]
regex = "error: Your local changes would be overwritten"
classification = "ENVIRONMENTAL"
cause = "dirty_working_tree"
fix_hint = "Run: git stash; re-dispatch"

[[patterns]]
regex = "CONFLICT \\(content\\): Merge conflict|error: patch failed|error: patch does not apply"
classification = "ENVIRONMENTAL"
cause = "patch_apply_failed"
fix_hint = "Fetch latest HEAD; rebase agent context; retry"

[[patterns]]
regex = "ImportError|ModuleNotFoundError"
classification = "ENVIRONMENTAL"
cause = "python_missing_module"
fix_hint = "Missing dependency; propose 'pip install' via gate"

[[patterns]]
regex = "address already in use|EADDRINUSE"
classification = "ENVIRONMENTAL"
cause = "port_conflict"
fix_hint = "Port blocked by another process; kill the process or change port"
```

---

## REASONING patterns

```toml
[[patterns]]
regex = "Assertion failed.*expected.*got|XCTAssertEqual.*failed|expect\\(.*\\).*toBe.*received"
classification = "REASONING"
cause = "wrong_implementation"

[[patterns]]
regex = "TS\\d{4}:|error TS\\d+"
classification = "REASONING"
cause = "typescript_compile_error"

[[patterns]]
regex = "undefined: \\w+|cannot use .* as type|not enough arguments"
classification = "REASONING"
cause = "go_compile_error"

[[patterns]]
regex = "AC \\d+ not satisfied|acceptance criteria.*not met"
classification = "REASONING"
cause = "ac_gap"

[[patterns]]
regex = "lane.tool.*available.*not used"
classification = "REASONING"
cause = "tool_discovery_failure"

[[patterns]]
regex = "test passes but.*not satisfied|wrong interpretation"
classification = "REASONING"
cause = "wrong_interpretation"
```

---

## How to add patterns

Run `datum learn-patterns --review` after any epic with UNKNOWN failures.
The script reads `.datum/runs/*/unknown-failures.json` files, clusters by similarity,
and prints proposed TOML entries for this file. Review them, paste the ones that
look correct into the appropriate section above, and commit.

Each pattern you add here improves classification for all future epics in this repo.
