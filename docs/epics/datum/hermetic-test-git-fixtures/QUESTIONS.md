## Refine — 2026-09-03

### Q1: [Behavior] Is `-c core.hooksPath=/dev/null` sufficient isolation, or should the fix also block other global git config (e.g. `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL` override, or a sandboxed `HOME`)?
> The ticket concretely confirms only the hooks-path leak (a global `post-checkout`-style hook breaking the AC2 add/add-conflict assertion) and confirms `git -c core.hooksPath=/dev/null` fixes that specific case. But `run()` currently passes no `env` overrides at all, so other global config — `credential.helper`, `core.autocrlf`, `init.defaultBranch`, custom aliases — could still leak into fixture repos and cause different, currently-unobserved flakes on some machine. Whether the fix should isolate hooks only, or go further and fully sandbox global/system config via `GIT_CONFIG_NOSYSTEM=1`/`GIT_CONFIG_GLOBAL=/dev/null`, changes both the implementation and how broad the "hermetic" claim in R1 can be.

[Answer]:

### Q2: [Behavior] Should the fix add an explicit regression test/assertion that proves the isolation mechanism is active (e.g. asserting a fixture repo reports no inherited `core.hooksPath`), or is passing the existing AC2 test sufficient evidence?
> Without a dedicated assertion, CI (which likely has no ambient global hooks) can't distinguish "isolation works" from "isolation was silently removed but nothing locally exposes it," since the AC2 test would still pass either way on a clean CI machine. Adding a direct check (e.g. asserting fixture `git config --get core.hooksPath` returns empty/`/dev/null` regardless of host config) would make regressions visible on any machine, but it's extra test code beyond what the ticket explicitly asks for.

[Answer]:

### Q3: [Scope] I'm assuming `run()` in `skills/src/datum-go.test.ts` is the only site in `skills/src/` that builds throwaway git fixture repos — confirmed by grepping `execFileSync` usage in all `skills/src/*.test.ts` files, which found only `datum-go.test.ts` (git-invoking) and `datum-tdd-act-lane.test.ts` (only invokes `bash scripts/build-workflows.sh`, never `git`). Is that scope boundary correct, or is there a git-fixture pattern elsewhere (e.g. a helper module, integration test, or script outside `skills/src/`) that should also be hardened?
> If scope is wider than the grep found — e.g. a shared test-utils file, or fixtures built outside `skills/src/*.test.ts` — the fix would need to touch additional files and R3's "no other file needs this" claim would be false, changing the estimated file/LOC count in the SPEC's Classification Metadata.

[Answer]:
