# datum — Current State

**Branch:** `main` | **Last updated:** 2026-07-07 | **Run:** `20260707-173926`

---

## Shipped

### Consumer-First Build-Order (2026-07-07, run 20260707-173926)

Epic ticket (GitHub issue #264, `docs/epics/datum/consumer-first-build-order/TICKET.md`)
fixed a `datum-plan` gap where `lane-plan.json` `depends_on` relationships were inferred
purely from SPEC narrative, never from the actual import graph of files being built —
causing parallel lanes to race ahead of interfaces they depend on and act-lane agents to
hallucinate upstream interface shapes. Merge `9241846` (base `7be6c6f082cd`, 30 files,
+1753/-18 LOC for the epic's own scope; see Data Gap below for total-run figures).

Five tasks landed per `docs/epics/datum/consumer-first-build-order/TASKS.md`:

| Task | What Shipped |
|---|---|
| `add-context-files-config-default` | `context_files: []` added to `DEFAULT_CONFIG` (`skills/src/shared/models.ts`) so projects can declare build-constraint docs |
| `add-upstream-source-context` | `TaskPacket.upstream_source` + `resolveUpstreamSource()` helper in `skills/src/shared/utils.ts` — reads transitive `depends_on` implFiles from the worktree, excludes testFiles, fails fast on missing upstream files |
| `wire-lane-upstream-injection` | `datum-tdd-act-lane.ts`'s `runLane` wires `resolveUpstreamSource` into RED/GREEN/REFACTOR `buildPacket` calls so every stage receives real upstream source, not just SPEC.md |
| `add-cycle-detection` | New pure `detectCycles()` module (`skills/src/shared/graph.ts`) — direct and transitive dependency-cycle detection over `{id, depends_on}` task graphs |
| `datum-plan-buildorder-and-context` | `datum-plan.ts` wired to call `detectCycles` before writing `lane-plan.json` (halts loud on cycles), reads `context_files` into the decompose prompt, and `plan-decompose.md` gained a "BUILD-ORDER / IMPORT ANALYSIS CHECK" + "PROJECT BUILD CONSTRAINTS" section |

**Self-hosted fix during the run:** the final commit (`9241846`) fixed the just-landed
`context_files` reader, which had used `node:fs` directly and broke the build; it was
switched to read via the `agent()` tool convention, per the standing "fix pipeline inline"
practice.

**Review:** one pass, 6 findings, 2 high (`PERF-001` N+1 git subprocess calls in
`worktree_manager.py::housekeep_epic()`; `ARCH-001` bidirectional logic in
`pathBoundaryMatch()` contradicting its documented one-directional contract), plus 2
medium performance findings (`PERF-002`/`PERF-003`, O(n·m) `.some()` loops in
`verifyFileOwnership`/`findScopeGaps`) and 2 medium architecture findings (`ARCH-002`
`WalkthroughResult` subclassing `Path`; `ARCH-003` `contextlib.redirect_stdout` coupling
in `cli.py::init()`). **None of the 6 findings were confirmed fixed in this run's commit
log** — see Data Gap and `follow-ups.json`.

**Data gap — scope conflation.** This run's `closeout-data.json` reports `git.commits`
spanning all the way back to base `badb2a9bceb9` (68 commits, +4462/-461 LOC across 64
files), which is **before** the prior epic (Bug Squash Round 2, merged at `7be6c6f082cd`)
even started. That means the captured git stats conflate three separate units of work:
(1) Bug Squash Round 2 itself, (2) an **un-closed-out intermediate hardening pass** — 36
commits between `7be6c6f082cd` and `ef25421` (pipeline reliability fixes covering issues
#213, #270, #301–#304, #307–#310, #315, #319, #325–#327, #331–#335, three review passes
converging 12 → 9 → 6 findings — see "What's Next" below), and (3) this epic's actual
5-task scope (`ef25421`..`9241846`, 30 files, +1753/-18 LOC). `tasks`, `solutions`, and
`token_metrics` were again empty/zero in `closeout-data.json` (same capture gap noted in
the prior closeout's `follow-ups.json` FU-2, still unresolved). `gitnexus_diff` reports
`available: true` but carries no impact-detail payload (MCP not live during capture).

### Prior: Bug Squash Round 2 (2026-07-07, run 20260707-093851)

Ten self-filed bugs from epic #282 landed (TOML config crash, file-ownership false
positives, rigid test-artifact convention, missing branch-bootstrap path, closeout gaps,
silent LLM-escalation failure, noisy memory extraction, unvalidated `testCommand`,
orphaned lane branches). 21 commits, 55 files, +2556/-203 LOC, merged at `7be6c6f082cd`.
R1–R10 completion vs. issues #265/#269/#270/#213/#301/#302/#303/#304/#307/#309 was left
**unverified** by that run's telemetry gap (see its `follow-ups.json` FU-1) — still open;
carried forward below.

### Prior Sessions (Epics 1–23+, PRs #25–#56, Bug Squash #167)

23+ epics shipped historically: local LLM pipeline (MLX Gemma/Qwen3), self-healing,
semantic memory, TUI dashboard, full installer, closeout command, and the original
Bug Squash #167 partial pass. See git log for `43be12e` era for detail.

---

## What's Next

**Priority 1 — Close out the un-closed-out intermediate hardening pass.** 36 commits
between `7be6c6f082cd` (Bug Squash Round 2 merge) and `ef25421` (this epic's SPEC commit)
shipped real fixes — auto-repair of lane scope gaps (#325/#334/#335), per-lane
`test_command` auto-detection and preflight (#326/#307), RED-stage retry on no-commit
(#333), count-gate crash guards (#315), CLI-arg-flag recovery (#319), worktree branch
preservation during cleanup, `pathBoundaryMatch` nested-path fixes, `resilientAgent`
StructuredOutput-crash handling, decompose-tasks protocol/contract completeness checks,
`RETRO.md`/`closeout` epic-number and walkthrough-fallback fixes (#264-adjacent), memory
extraction noise filtering — but never went through Refine → Plan → Review → Closeout as
its own epic. It rode along inside this run's `closeout-data.json` git-stat window
undocumented as its own unit. Recommend a retroactive mini-closeout (or explicit
acknowledgment in the next epic's SPEC) so these fixes are traceable to issue numbers
rather than only living in commit messages.

**Priority 2 — Verify the 6 review findings from this epic got addressed.** `PERF-001`
(N+1 subprocess calls), `ARCH-001` (bidirectional `pathBoundaryMatch` bug — a correctness
risk, not just style, since it can produce false-positive path-ownership matches),
`PERF-002`/`PERF-003` (O(n·m) loops), `ARCH-002` (`Path` subclassing), `ARCH-003`
(`redirect_stdout` coupling) — none appear in the commit list after `5f50fec` (the review
commit) other than the unrelated `9241846` build fix. Confirm whether these were folded
into `9241846` silently or remain open (tracked in `follow-ups.json`).

**Priority 3 — Confirm R1–R10 from Bug Squash Round 2** (carried from prior state,
still unverified).

**Priority 4 — Wire up closeout telemetry capture** (carried from prior state):
`token_metrics`, `tasks`, `solutions` have now been empty/zero across at least two
consecutive closeout runs. This is a repeat data-capture gap, not a one-off.

---

## In Flight

No active feature branches after this closeout. `main` is the merge target (`9241846`).

---

## Backlog

Carried from prior state where unresolved:
- R1–R10 verification (Bug Squash Round 2, see Priority 3 above)
- Closeout telemetry capture fix (see Priority 4 above)
- GitNexus MCP live-during-run requirement so `gitnexus_diff` impact detail populates
- New this run: retroactive accounting for the 36-commit intermediate hardening pass
  (Priority 1) and the 6 unresolved review findings (Priority 2)
