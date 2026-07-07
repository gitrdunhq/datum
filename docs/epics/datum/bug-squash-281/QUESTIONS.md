## Refine — 2026-07-06

### Q1: [Architecture] Should the new `datum lane-state` CLI subcommand follow the multi-verb `worktrees_app` Typer sub-app pattern (`datum/cli.py:1468-1512`), or the simpler single-command `lane-cleanup` pattern (`datum/cli.py:504`)?
> The ticket says "`datum lane-state read|write --epic <branch> --task <id> [--merge-commit <sha>] (or similar)`," explicitly leaving flag order, exact sub-verb structure, and error/output conventions to the implementer. I'm assuming the `worktrees_app` sub-app pattern (two verbs, shared option set) since it's the closer structural match — is that right, or would a flatter `lane-state-read` / `lane-state-write` pair of top-level commands (mirroring `lane-cleanup`) be preferred for consistency with the simpler precedent?

[Answer]:

### Q2: [Behavior] When triage groups blocked lanes under a root failure, should the grouping be strictly one-group-per-independent-failure-root, even when a blocked lane has multiple failed ancestors (diamond dependency)?
> SPEC assumes one group per dependency-chain root (a lane blocked transitively through A appears once, under A's group). This is unambiguous for linear chains, but if lane D depends on both failed lane A and failed lane B (a diamond), it's not fully specified whether D should appear in both A's and B's triage groups, or be assigned to whichever failed first. I'm assuming "assign to all applicable root groups" (D can appear under both A and B) since that gives the most complete picture for a human triaging failures — is that right, or should each blocked lane be deduplicated into exactly one group?

[Answer]:

### Q3: [Scope] Is "this release cycle" the correct scope for keeping the legacy run-scoped marker write/read path, with full removal deferred to a separate future ticket?
> The ticket says "keep writing the legacy per-run marker for backward compat during transition" without giving a sunset date. SPEC's Out of Scope section explicitly excludes removing the legacy marker path from this ticket. I'm assuming that's correct and a follow-up ticket will handle removal once all consumers have migrated to epic-scoped markers — is that the intended plan, or should this ticket also add a deprecation warning / removal timeline artifact (e.g., a tracked issue) as part of its own scope?

[Answer]:

### Q4: [NFR] Is a property test over ≥100 randomly generated DAGs (up to 50 nodes) a sufficient/appropriate bar for verifying the wave-packed batch partitioner (Requirement B), or is a different scale/tooling expected?
> The ticket's acceptance criteria explicitly calls for "a property test over random DAGs" but doesn't specify iteration count, node-count range, or whether it should use a property-testing library (e.g., fast-check) vs. a hand-rolled generator. SPEC assumes 100+ random graphs up to 50 nodes using whatever property-testing approach is idiomatic for the existing TS test setup (vitest) — is that an acceptable bar, or is a larger/smaller scale or a specific tool expected?

[Answer]:
