# Phase: PR Comments

**Goal:** Triage all PR review comments, fix the actionable ones, and close threads — without touching things that were intentional decisions.

## Trigger

Entered after a PR is open and reviewers have left comments. Input: PR URL.

## Steps

### 1. Fetch comments

Run: `unset GITHUB_TOKEN && gh pr view <PR_URL> --json reviews,comments --jq '...'`

Or use the available VCS tool for the active platform. Collect all open threads.

### 2. Load context for each commented file

If GitNexus available: run `gitnexus context <file>` for each file with comments.
This informs triage: is the concern about blast radius? An existing known pattern? A pre-existing issue?

### 3. Triage

For each comment, produce a verdict (see `assets/schemas/triage.schema.json`):

| Verdict | Meaning |
|---|---|
| `fix` | Actionable; fix it |
| `discuss` | Ambiguous; ask the reviewer for clarification |
| `intentional` | Deliberate decision in the SPEC; add a code comment explaining why, close the thread |
| `pre-existing` | Exists before this PR; create a follow-up issue, close the thread |
| `wontfix` | Out of scope for this epic; explain and close |

If a verdict is ambiguous after one LLM pass: re-run triage with more context. If still ambiguous: surface to user.

If `triage_human_approval = required`: present `triage.json` to user for approval before making any fixes.

### 4. Fix `fix` verdicts

Dispatch fix agents for each `fix` comment. Fixes run concurrently (independent comments) or sequentially (same file).

Each fix:
- Must not break existing tests
- Must stay within the scope of the comment
- Commits with message: `fix(pr-comment): <thread-id> — <short description>`

After each fix: re-run tests to confirm still green.

### 5. Close threads

For `intentional`, `pre-existing`, and `wontfix` verdicts: post a reply to the thread explaining the decision, then resolve/close the thread.

For `discuss` verdicts: post the clarifying question and mark as pending.

### 6. Gate

Confirm all threads are resolved or have a pending reply. Surface unresolved `discuss` threads to user.

Run `datum gate pr-comments`

If `triage_human_approval = required` in config, the gate pauses with `needs_human: true`. After human review: `datum gate pr-comments --approve`

On pass: archive `triage.json`, update state. Record `pr_author_login` in state from the PR metadata.

Start the PR comment monitor sidecar:
```
datum pr-monitor --run-id <RUN_ID> --interval 60 &
```

The monitor polls for `/datum <command>` comments. Only the PR author's commands are accepted
(trust boundary enforced by `pr_author_login` from state). Valid commands:
- `/datum go` or `/datum resume` — resume the pipeline
- `/datum update <request>` — requeue with a revision request
- `/datum status` — post current phase and run_id as a reply
- `/datum rollback` — initiate rollback protocol

Comments from other authors are silently processed without action. A brief acknowledgement
is posted as a reply (`environment.yaml` `pr.comments.reply` controls this).

See `datum pr-monitor` for the full trust boundary implementation.

## Outputs

- `triage.json` — verdicts for all PR comments
- Fixes committed to work branch
- PR threads closed or replied-to

## Failure modes

- Ambiguous verdict after two passes → surface to user
- Fix breaks a test → revert, surface diagnostic to user
- Merge conflict after fix → halt; never auto-resolve
