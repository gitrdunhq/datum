# SPEC: Isolate test git fixtures from the developer machine's global git config

## 1. Summary

`skills/src/datum-go.test.ts` drives throwaway git repos through a local `run()` helper that shells out to `git` via `execFileSync` without disabling the invoking machine's global git config, so ambient `core.hookspath` and other global hooks/settings leak into fixture repos and can silently change test behavior (concretely: the AC2 unresolved-merge-conflict test fails to observe a `CONFLICT (add/add)` when a global `post-checkout`-style hook interferes). This change hardens the git-fixture helper(s) so fixture repos are hermetic — deterministic regardless of the host machine's global git configuration — with no production code changes.

## 2. Context

- `skills/src/datum-go.test.ts` defines a local `function run(cmd: string, args: string[], cwd: string)` (lines 22–34) that wraps `execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] })` and normalizes thrown non-zero exits into a `{status, stdout, stderr}` object instead of throwing. It is called 15 times in the file, the large majority driving `git` subcommands (`init`, `config`, `add`, `commit`, `checkout`, `merge`) to build and mutate fixture repos.
- `function initRepo(dir: string)` (lines 36–43), called once per test from `beforeEach` (line 49), builds the base fixture repo through `run()`: `git init -q -b main`, `git config user.email`, `git config user.name`, write `README.md`, `git add .`, `git commit`. It already sets explicit `user.email`/`user.name` per repo, so those are not at risk from missing global config — the gap is specifically hooks and other global git settings/config leaking in, not identity config.
- The concretely confirmed-flaky test is the AC2 describe/it block (around lines 85–115): two branches (`feature/conflicted` vs `main`) each write conflicting content to `shared.txt` (add/add conflict), then `git merge main` (line 99) is asserted to exit non-zero with `MERGE_HEAD` present, followed by a `datum init --json` call (line 103). Running the identical sequence with `git -c core.hooksPath=/dev/null` reproduces the expected `CONFLICT (add/add)` and non-zero exit deterministically; without it, ambient global hooks can suppress or alter that outcome.
- `execFileSync` (imported from `node:child_process` at line 13) is the only subprocess primitive in use; it currently passes no `env` overrides and no `-c` config flags, so every fixture git invocation inherits the full ambient global/system git config of the host.
- A sibling file, `skills/src/datum-tdd-act-lane.test.ts`, has a same-shaped local `run()` helper (lines 34–46), but its only call site (line 205) runs `bash scripts/build-workflows.sh` — it never shells out to `git` and does not build throwaway git repos. A repo-wide scan (`grep -rl "execFileSync" skills/src/*.test.ts`) confirms only `datum-go.test.ts` and `datum-tdd-act-lane.test.ts` use `execFileSync` at all in `skills/src/`, and only `datum-go.test.ts` uses it against `git`. No other test file under `skills/src/` is in scope for this fix.
- This is a test-only hermeticity fix. No `skills/src/datum-go.ts` (or other production) behavior changes; `datum init`'s actual conflict-detection logic is not touched.

## 3. Requirements

### R1 — Isolate fixture git invocations from ambient global git config and hooks
The `run()` helper in `skills/src/datum-go.test.ts`, when invoked with `cmd === 'git'`, must execute git commands such that they cannot read or act on the invoking machine's global (`--global`) or system (`--system`) git config — including `core.hooksPath` and any configured hooks — regardless of what is present on the host running the test.

**Acceptance criteria:**
- AC1.1: With a global git hook configured on the host machine (e.g. a `pre-commit`, `post-checkout`, or `post-merge` hook that would normally fire and alter working-tree state or exit codes), running the full `datum-go.test.ts` suite produces the same pass/fail outcome as running it on a machine with no global git hooks configured.
- AC1.2: The AC2 describe/it block ("datum init exits non-zero with a clear error when the branch has an unresolved merge conflict") passes deterministically (asserts `mergeResult.status !== 0` and `MERGE_HEAD` present after the add/add conflict on `shared.txt`) both on a machine with an interfering global hook installed and on a machine with none.
- AC1.3: A fixture git command that would consult global config for values other than hooks (e.g. a global `user.email`/`user.name`, a global `core.autocrlf`, or a global `credential.helper`) does not have those values take effect inside the fixture repo; every fixture repo's effective config is fully determined by what the test itself sets (via `initRepo`'s explicit `git config user.email`/`user.name`) plus git's built-in defaults.

### R2 — Apply the same isolation to every git-invoking call site in the file
Every place in `skills/src/datum-go.test.ts` that shells out to `git` to build, mutate, or inspect a fixture repo (via `run()`, including but not limited to `init`, `config`, `add`, `commit`, `checkout`, `merge`) must use the isolated invocation path — no git subcommand in this file's fixture-building code is exempt.

**Acceptance criteria:**
- AC2.1: Every `run('git', ...)` call site in `skills/src/datum-go.test.ts` (all 15+ call sites, including inside `initRepo` and inside individual `describe`/`it` blocks) executes with the same isolation applied — there is no git call in the file that bypasses it.
- AC2.2: A regression test (or an assertion added to an existing test) demonstrates the isolation is active — e.g. by asserting that a fixture repo does not report a `core.hooksPath` value inherited from outside the fixture, or by an equivalent effective-config check.

### R3 — No other `skills/src/*.test.ts` file requires the same fix
Confirm and document that no test file under `skills/src/` other than `datum-go.test.ts` builds throwaway git repos via unisolated `git` subprocess calls, so scope is not silently incomplete.

**Acceptance criteria:**
- AC3.1: A search of `skills/src/*.test.ts` for `execFileSync` (or any subprocess invocation of `git`) turns up only `datum-go.test.ts` as building git fixtures; `datum-tdd-act-lane.test.ts`'s `run()` helper is confirmed to never invoke `git` and is left unchanged.
- AC3.2: If a future scan finds another file with the same git-fixture pattern, this requirement is treated as violated and that file must receive the same hardening before the change is considered complete.

### R4 — No production code changes
`skills/src/datum-go.ts` and all other non-test production files remain unmodified by this change; only test fixture code changes.

**Acceptance criteria:**
- AC4.1: `git diff` (or equivalent) for this change touches only `skills/src/datum-go.test.ts` (and, if warranted by R3, other `*.test.ts` files) — zero non-test files are modified.
- AC4.2: The existing test suite's assertions about `datum init`'s conflict-detection behavior (already-passing tests unrelated to AC2) continue to pass unchanged, confirming no behavioral drift was introduced under the guise of the fixture fix.

## 4. Failure Modes

| Failure mode | Handling |
|---|---|
| Isolation flag/env var applied only to some `run('git', ...)` call sites, missed on others (e.g. `merge` or `checkout`) | R2/AC2.1 requires every call site covered; a lint-style grep or code review check should confirm no bare `run('git', ...)` bypasses the isolated path. |
| Isolation approach breaks `initRepo`'s explicit `user.email`/`user.name` config (e.g. `GIT_CONFIG_NOSYSTEM` or `HOME` override applied before those `git config` calls run) | AC1.3 explicitly requires identity config set by the test itself to still take effect; verify by running the full suite after the change and confirming `git commit` calls still succeed (no "no identity" error). |
| Isolation approach (e.g. blank `HOME` override) breaks unrelated git behavior the tests depend on (e.g. `core.autocrlf`, default branch name resolution) | Prefer the narrowest isolation (config-level `-c` flags / `GIT_CONFIG_NOSYSTEM` / `GIT_CONFIG_GLOBAL=/dev/null`) over a full `HOME` sandbox unless a fuller sandbox proves necessary; re-run full suite to confirm no new failures. |
| Fix hides the AC2 flake locally but CI (which has no ambient hooks) can't validate the fix actually restores hook-immunity | Add or update a test (AC2.2) that fails without the isolation and passes with it, so CI itself proves the isolation mechanism works rather than relying on absence of failure. |
| A future contributor adds a new `run('git', ...)` call site to `datum-go.test.ts` without isolation | Centralizing isolation inside `run()` itself (rather than at each call site) makes this structurally impossible for `cmd === 'git'` calls — this is why R1 targets `run()` rather than individual call sites. |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Determinism | AC2 test (and full suite) produces identical pass/fail results across machines regardless of global git hooks/config presence. |
| No production behavior change | Zero diffs outside `*.test.ts` files (R4). |
| Test run time | No material increase in `datum-go.test.ts` suite runtime from the isolation mechanism (config flags/env vars add negligible overhead vs. e.g. spinning up a full temp `HOME`). |
| Maintainability | Isolation is applied in one place (`run()`) rather than duplicated per call site, so future git call sites inherit it automatically. |

## 6. Out of Scope

- Any change to `skills/src/datum-go.ts` or other production `datum init` / conflict-detection logic.
- Any change to `skills/src/datum-tdd-act-lane.test.ts` (confirmed not to build git fixtures — R3/AC3.1).
- Broader CI environment hardening (e.g. running the whole CI job inside a sandboxed `HOME`) — this fix is scoped to the test fixture helper(s), not the invoking environment.
- Introducing a shared cross-file test-fixture utility module — only `datum-go.test.ts` needs the fix per the current scan; extracting a shared helper is not required unless a second file is found to need it (see R3/AC3.2).

## 7. Open Questions

- Q1: Is `git -c core.hooksPath=/dev/null` sufficient in isolation, or should the fix also set `GIT_CONFIG_NOSYSTEM=1` / override `GIT_CONFIG_GLOBAL` (or `HOME`) to guard against other global config (not just hooks) leaking in — e.g. global `core.autocrlf`, `init.defaultBranch`, or `credential.helper`?
- Q2: Should the isolation mechanism be verified by an explicit new assertion/test (AC2.2), or is it sufficient to rely on the AC2 test itself passing as the signal that isolation works?

## 8. Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | `run()` in `skills/src/datum-go.test.ts` is the only site building git fixture repos in `skills/src/` test files | Repo-wide grep for `execFileSync` across `skills/src/*.test.ts` returns only `datum-go.test.ts` and `datum-tdd-act-lane.test.ts`; the latter's only call site runs `bash scripts/build-workflows.sh`, not `git` | confirmed | n/a |
| 2 | `git -c core.hooksPath=/dev/null` (or equivalent) is sufficient to fix the confirmed AC2 flake | Ticket states this exact flag reproduces the expected `CONFLICT (add/add)` deterministically when tested manually | confirmed | n/a |
| 3 | Whether broader config isolation (`GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL`, or `HOME` override) is needed beyond hooks isolation | Ticket only concretely confirms the hooks-path case; other global config leakage (autocrlf, credential helpers) is plausible but unverified | guess | Q1 |
| 4 | Fixture repos should keep using explicit `user.email`/`user.name` via `initRepo`'s existing `git config` calls rather than relying on any global identity config | `initRepo` already sets these explicitly (lines 38–39 of `datum-go.test.ts`), independent of this fix | confirmed | n/a |
| 5 | AC2 is the only test currently observed to fail from ambient config; other tests in the file are exposed to the same class of risk but not confirmed failing | Ticket explicitly states other tests are "equally exposed... even where it isn't currently causing a visible failure" | decided | n/a |
| 6 | A dedicated regression assertion proving isolation is active should be added, not just relying on AC2 passing | Strengthens the fix against silent regression per Failure Modes table, but is not explicitly demanded by the ticket | guess | Q2 |

## 9. Classification Metadata

```yaml
estimated_files: 1
estimated_loc: 20
clusters_touched:
  - test-fixtures
  - datum-go-tests
new_public_api: false
dependency_additions: []
```
