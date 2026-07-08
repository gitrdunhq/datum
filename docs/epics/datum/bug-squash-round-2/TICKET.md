# Bug Squash Round 2

## What

Fix ten open, self-filed DATUM pipeline bugs left over after epic #282 (bug-squash-281):

- `datum/local_llm.py`: `TOMLDecodeError: Cannot declare ('local_llm',) twice` (#265)
- `verifyFileOwnership` in `datum-tdd-act-lane.ts` uses suffix-only matching, producing false-positive `file_ownership_violation`s (#269)
- lane-plan's test-artifact convention forces docs-only epics into flat-extension test files, which conflicts with real test-package conventions for compiled languages (#270)
- `datum-go.ts` cannot bootstrap a new epic from an existing feature branch without a manual branch + TICKET.md dance (#213) — this bug is currently live: it's why this very epic had to be bootstrapped by hand via `datum init`
- `datum closeout`'s epic-number parser only recognizes `epic-NNN` branch naming, not `bug-squash-NNN` or other slugs already used elsewhere in this repo (#301)
- `datum closeout`'s RETRO.md "Delivery" section reports 0/0 with no git-based fallback when the run has no `.datum/runs/<runId>/lane-state/` (#302)
- `datum closeout`'s `generate_walkthrough` silently degrades to an empty fallback on LLM escalation failure but still prints a success checkmark (#303)
- `datum dream`'s regex extraction fallback surfaces raw transcript/tool-call noise as high-confidence memory candidates (#304)
- `datum-plan`/act-setup does not detect or validate that a lane's `testCommand` is runnable against sub-package files before dispatching the batch (#307)
- `datum worktrees cleanup` leaves empty lane branches behind after a stopped run instead of deleting branches with zero lane commits (#309)

## Requirements

- Each fix references its GitHub issue number in the lane's commit trailer so the issue can be closed on merge.
- Fixes must go through the CLI path (`datum <command>`), not ad-hoc scripts, per AGENTS.md Core Directive #7.
- No behavior change to lanes/phases not named above.

## Not This

- Do not attempt the larger feature epics (#134, #259, #260, #264) — those need dedicated planning, not a bugfix lane.
- Do not touch #275/#276 — those are tied to a downstream repo's (the-record-suite) specific run context and aren't reproducible generically here.
