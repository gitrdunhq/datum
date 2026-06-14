# GitHub Issues as Source of Truth for Lane IDs

## What

Replace local `task-001` / `task-002` IDs in lane-plan.json with real GitHub issue numbers. When `datum plan` produces tasks, it creates a parent epic issue and child task issues on GitHub, links them as sub-issues, and uses `#number` as the lane ID throughout the pipeline. Metadata (files, depends_on, ACs) lives in invisible HTML comments on the issue body so it round-trips cleanly.

## Requirements

1. `create_issues_from_plan(lane_plan, repo)` creates one GH issue per lane, returns a dict mapping task_id to issue number. Dedup: reuses existing issues with matching titles.
2. `build_issue_body(lane)` embeds datum metadata as an invisible `<!-- datum:metadata {...} -->` HTML comment. `parse_issue_metadata(body)` extracts it. Round-trip: parse(build(lane)) == original metadata.
3. `link_sub_issues(parent_number, child_numbers, repo)` links child issues as sub-issues of the parent epic issue via the GH REST API. Handles 409 conflicts gracefully (already linked).
4. `create_epic_with_tasks(lane_plan, repo)` is the top-level function: creates parent epic, creates child task issues, links them, returns `{epic_number, task_map}`.
5. `datum plan` CLI integration: after writing tasks.json, optionally call `create_epic_with_tasks` when `--gh-issues` flag is passed. Lane IDs in lane-plan.json become `#N` instead of `task-001`.
6. Lane status sync: when a lane completes in `datum-tdd-act`, close the corresponding GH issue. When a lane fails, add a comment with the failure reason.

## Not This

- No GH Projects board integration (that's a separate epic)
- No migration of existing local-only lane plans to GH issues retroactively
- No GH Actions / webhook triggers — this is CLI-driven only
