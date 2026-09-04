# TICKET: Isolate test git fixtures from the developer machine's global git config

## Problem

`skills/src/datum-go.test.ts` (and likely other test files using the same
pattern) spin up throwaway git repos in temp directories and drive them with
plain `git` subprocess calls via a local `run()` helper
(`execFileSync('git', args, { cwd })`). These calls inherit the invoking
machine's global git config — including `core.hookspath`, global hooks, and
any other global settings — because they never disable it.

On a machine where global git hooks are configured (e.g. a `post-checkout`
hook that kicks off background work), those hooks fire during test git
operations exactly as they would for a real repo, and can interfere with the
test's expectations. Confirmed concretely: the AC2 test in
`skills/src/datum-go.test.ts` ("datum init exits non-zero with a clear error
when the branch has an unresolved merge conflict") sets up two branches that
each write conflicting content to the same new file (`shared.txt`, an
add/add conflict) and asserts the resulting `git merge` exits non-zero with
`MERGE_HEAD` present. With ambient global git hooks active, this assertion
fails — the merge does not conflict as expected. Running the identical
sequence of git commands with `git -c core.hooksPath=/dev/null` (isolating
the global hook) produces the expected `CONFLICT (add/add)` and non-zero
exit every time. This shows the test fixtures are not hermetic: their
correctness silently depends on the ambient state of the machine running
them, not just on the code under test.

## Impact

- The AC2 test fails intermittently/consistently depending on what global
  git hooks/config happen to be present on the machine running the suite,
  independent of whether `datum init`'s actual conflict-detection logic is
  correct.
- Any other test in this file (or sibling test files) using the same `run()`
  git-fixture pattern is equally exposed to this class of non-determinism,
  even where it isn't currently causing a visible failure.
- CI environments without such global hooks won't reproduce this, which
  makes the flake appear "local-only" and easy to dismiss incorrectly as an
  environment problem rather than a test-fixture gap — even though the fix
  belongs in the test fixture, not the environment.

## Desired outcome

Test-fixture git repos created by these tests behave the same regardless of
the invoking machine's global git configuration or hooks. The `run()` helper
(and any other spot that shells out to `git` to build fixture repos in this
test file) should isolate fixture git commands from ambient global git
config/hooks, so the AC2 unresolved-merge-conflict test (and any other test
relying on real git behavior in a throwaway repo) is deterministic on any
machine, with or without global hooks configured.

## Scope

- `skills/src/datum-go.test.ts`: harden the git-fixture helper(s) so they
  don't inherit the invoking machine's global git hooks/config.
- If any other `.test.ts` file under `skills/src/` uses the same pattern to
  build throwaway git repos, apply the same hardening there too.
- No production (non-test) code changes are expected — this is a test-only
  hermeticity fix.
