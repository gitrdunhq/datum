# Audit: `references/` — datum @ `9d1b24a` (2026-09-06)

**run_id:** 20260906-164303 · report only, no file in references/ changed

**Scope:** 59 files, 379,573 bytes (the task says 58; `references/current-state.md` was added 2026-05-27 in `2df2e2f6` and last touched today in `9c1621e4`, so it may not have been in the caller's listing. All 59 are covered.)

## Method and the two facts that decide almost every row

**Fact 1 — there is no runtime loader for `references/`.** The only injection mechanism in the tree is `datum/prompt_loader.py`, which resolves every path through `Path(__file__).parent.parent / "skills" / "datum-workflow" / doc_path` (`prompt_loader.py:25`, `:63-70`). **`skills/datum-workflow/` does not exist** — `skills/` contains only `src/`, `datum-tdd/`, `gitnexus-bug-hunt/` and the generated `datum-*.js` bundles. `git grep 'prompt_loader'` outside `references/`/`docs/` returns one hit, its own docstring: **it has no caller.** The only `<!-- inject: -->` marker in the entire repo is `references/04-act.md:109` (`references/04-act-edge-cases.md`), and it is processed by nothing.

The same dead path breaks two more consumers:
- `datum/diagnose_failure.py:24` → `skills/datum-workflow/references/pattern-library.md` (missing → builtin fallbacks at `:31+` fire on every run)
- `datum/learn_patterns.py:23` → same missing path
- `scripts/resilient_diagram.py:303` → `references/guides/troubleshooting.md` — a `guides/` subdirectory that does not exist either.

**Fact 2 — `datum init` copies nothing from `references/`.** `datum/skills_materialize.py:22` sets `SKILL_GLOB = "datum-*.js"`; `materialize_skills` (`:35`) copies only that glob into `.datum/skills`. `datum/bootstrap/install_skill.py:51` (`datum install`, `cli.py:874`) symlinks the **whole repo root** into `~/.claude/skills/datum`, so the bytes are *exposed* to the agent's skill tree but never *copied into* a consumer repo.

**The only reference file with a proven reader-adjacent tie is `model-tiers.md`**, linked at `SKILL.md:179` and therefore existence-checked by `datum/self_check.py:103-110` (`datum doctor` fails if it disappears). Nothing else in `references/` is read by `skills/src/*.ts`, `skills/src/prompts/*.md`, or `agents/*.md` — `git grep references skills/src/` returns only the word "references" in prose.

**Consumer categories used below:** (a) read at runtime; (b) pinned by name only in `tests/test_datum_hardening.py:193-210` `test_all_phase_references_exist`; (c) documentation link; (d) orphan.

---

## Group 1 — Phase docs (`00-` … `08-`, `0x-`)

FLOW.md:3 and `skills/src/shared/models.ts:31` fix the pipeline at seven phases: `refine, plan, properties, act, validate, review, closeout`.

### `references/00-discovery.md` — 4,679 B — 2026-05-27
Purpose: *"**Goal:** Survey the repo's current architecture so that all subsequent phases have grounded context."*
Consumers: **(b)** `tests/test_datum_hardening.py:196`. Nothing else.
Verdict: **DEAD.**
Evidence: there is no Discovery phase in `PHASES` (`models.ts:31`) or any `ROUTE_PHASES` entry (`models.ts:20-27`). `:76` — *"Check if `scripts/test_signal.py` supports the detected test framework"* — `scripts/test_signal.py` does not exist (it is `datum/test_signal.py`, reached as `datum test-signal`).
Action: **delete**; remove `"00-discovery.md"` from `tests/test_datum_hardening.py:196` in the same commit. If the GitNexus LANDSCAPE enrichment at `:27-40` is wanted, it belongs in the `datum landscape` command, not a phase doc.

### `references/0x-express.md` — 4,450 B — 2026-05-27
Purpose: *"**Goal:** Ship trivial changes (< 50 LOC, single cluster, no new public API) with minimal ceremony."*
Consumers: **(b)** `test_datum_hardening.py:197`.
Verdict: **DEAD.**
Evidence: `:7` — *"`datum classify` returns `{"tier": "patch", "pipeline_shape": "express"}`"*; no `express` route exists in `ROUTE_PHASES` (`models.ts:20-27` lists `feature/hotfix/spike/audit/resume/refine-only`). `:33` — *"| Architect | ADR + C4 | **Skipped.**"* names a phase that does not exist. `:68` — *"Log the reclassification in `.datum/state.json`"*; FLOW.md:3 says state lives in `.datum/pipeline-state.json`.
Action: **delete** + unpin `:197`. The one live idea (a patch tier) is already served by `ROUTE_PHASES.hotfix`.

### `references/01-refine.md` — 4,825 B — 2026-06-14
Purpose: *"**Goal:** Transform TICKET.md into a SPEC.md that a planner can act on without asking questions."*
Consumers: **(b)** `test_datum_hardening.py:198`; **(b)** semantic pins — `tests/test_gate_enhancements.py:83` (*"references/01-refine.md numbers Assumption Audit as section 9"*) and `tests/test_classify.py:125` (*"numbers Classification Metadata as section 10"*); **(c)** `evals/evals.json:16-18` asserts a response *mentions* `01-refine.md` being loaded.
Verdict: **STALE** (real phase, drifted doc).
Evidence: the eval at `evals/evals.json:7` expects *"reference to 01-refine.md loading"* — nothing loads it. The refine phase is `skills/src/datum-refine.ts` driving `prompts/refine-{triage,classify,scan,spec,questions}.md`; none reads this file. FLOW.md:312's closure (the refine gate runs the Assumption Audit itself) is not reflected here.
Action: **keep, update.** It is the closest thing to a human-readable Refine spec and two tests assert its section numbering. Add a header line naming `skills/src/datum-refine.ts` + `skills/src/prompts/refine-*.md` as the authority; fix `evals/evals.json:7,16-18` to stop asserting a load that never happens.

### `references/01.5-research.md` — 1,636 B — 2026-05-27
Purpose: *"**Goal:** Establish a strict boundary for high-uncertainty exploration, prior-art comparison, and architectural spikes *before* entering the Plan phase."*
Consumers: **(b)** `test_datum_hardening.py:199`.
Verdict: **DEAD.**
Evidence: `:24` — *"the Epic must pass through the Research phase"*. No Research phase exists. `ROUTE_PHASES.spike` (`models.ts:23`) is `['refine','plan']` — the spike shape is already the route, not a phase.
Action: **delete** + unpin `:199`.

### `references/02-plan.md` — 8,045 B — 2026-06-14
Purpose: *"**Goal:** Decompose docs/epics/$BRANCH/SPEC.md into a topologically-sorted, machine-readable TASKS.md where every task has a clear scope, acceptance criteria, file set, and RED note."*
Consumers: **(b)** `test_datum_hardening.py:200`; **(c)** named as an example path in `datum/prompt_loader.py:15` (dead loader).
Verdict: **STALE.**
Evidence: the goal sentence names **TASKS.md** as the machine-readable artifact; FLOW.md:124/132-134 makes `tasks.json` (schema-validated) and `lane-plan.json` machine-readable and `TASKS.md` "human-readable". `:35` — *"present 2-3 distinct architectural approaches to the human and wait for a choice"* — `skills/src/datum-plan.ts:211` runs `impact-analysis` and the approaches agent without any human wait; the human hold is `datum gate plan` (FLOW.md:123). Nothing here mentions the early gate that FLOW.md:123 calls "the contract" (*"gate plan --approve runs before any commit"*) or the synthesized `task-INT-<n>` integration lanes (FLOW.md:126).
Action: **keep, update** — rewrite Inputs/Outputs to `tasks.json` + `lane-plan.json`, document the gate-before-commit ordering, delete §0.5's human-wait claim, add the integration-lane synthesis. Reference `skills/src/prompts/plan-decompose.md` as authority.

### `references/02.3-prior-art.md` — 12,261 B — 2026-06-10
Purpose: *"**Goal:** Before anyone writes a line of code, search for existing solutions — open-source libraries, packages, internal repos, published techniques — that could replace, simplify, or inform each task in the plan. Reduce build-from-scratch to wrap-existing wherever possible."*
Consumers: **(d) none.** Not in the hardening list, not linked, not read.
Verdict: **ORPHAN.**
Evidence: `datum/gate.py:1159 gate_prior_art` exists in `GATES` (`gate.py:1581`) but `git grep prior_art -- skills/src/ datum/cli.py` returns **nothing** — no phase workflow ever calls it. A gate with no caller and a doc with no reader.
Action: **delete** (12 KB, the largest orphan outside the diagram set). If prior-art search is wanted it belongs as a step in `plan-approaches.md`. Separately worth a see-something issue: `gate_prior_art` is a dead consumer in the `#394` class FLOW.md:334 names.

### `references/02.5-triage.md` — 1,553 B — 2026-05-27
Purpose: *"You have entered the Triage phase. Your objective is to dynamically route the pipeline by deciding if the `TASKS.md` plan warrants deep codebase research (`deepen`)…"*
Consumers: **(d) none.**
Verdict: **DEAD.**
Evidence: `:27` — *"Run `datum transition <decision>` (e.g., `datum transition deepen`)"*. **`datum transition` does not exist** — the CLI's 50 command decorators contain no such name. Triage is not a phase; it is a step inside `datum-plan` (SKILL.md:63, *"Plan (includes triage + deepen)"*), driven by `skills/src/prompts/plan-triage.md`.
Action: **delete.** `plan-triage.md` is the live prompt.

### `references/02.8-deepen.md` — 1,781 B — 2026-05-27
Purpose: *"You are in the Deepen phase. Your objective is to ground the abstract plan in reality by gathering codebase evidence…"*
Consumers: **(d) none.**
Verdict: **DEAD.**
Evidence: `:30` — *"run `datum doctor --phase deepen` to pass the gate"*. `datum doctor` takes no `--phase`; the gate is `datum gate deepen` (`gate.py:1583`). Deepen is a step inside Plan (`skills/src/prompts/plan-deepen.md`), not a phase.
Action: **delete**; `plan-deepen.md` is the live prompt.

### `references/03-properties.md` — 3,963 B — 2026-05-27
Purpose: *"**Goal:** Derive a docs/PROPERTIES.md that covers all 11 property categories for every requirement in docs/epics/$BRANCH/SPEC.md."*
Consumers: **(b)** `test_datum_hardening.py:201`.
Verdict: **STALE.**
Evidence: the goal says **`docs/PROPERTIES.md`**; FLOW.md:143/146 and `gate_properties` (`gate.py:1267`) put it at `docs/epics/<branch>/PROPERTIES.md`. The doc has no mention of the **`## Integration Invariants` table**, which FLOW.md:143 makes *required* by the gate and which FLOW.md:126 says drives the synthetic `task-INT-<n>` lanes — the single most consequential thing Properties now produces.
Action: **keep, update** — fix the path, add the Integration Invariants contract (`ID | Invariant | Covers | Source`, `spec:` rows cover 2+ tasks, one row per answered QUESTIONS id).

### `references/03.5-architect.md` — 1,909 B — 2026-05-27
Purpose: *"**Goal:** Validate architectural decisions, audit ADR coverage, and enforce C4 context mapping before any code is written."*
Consumers: **(b)** `test_datum_hardening.py:202`.
Verdict: **DEAD.**
Evidence: no Architect phase; no `gate architect` in `GATES` (`gate.py:1578-1589`). `:9` — *"`docs/adr/` — existing architecture decision records"* — no `docs/adr/` in the tree. `:44` — *"`architect-output.json` containing the verdict and ADR inventory"* — no producer, no consumer. FLOW.md:307 explicitly records that "flowcharts with an Architect gate" were the deleted-docs defect.
Action: **delete** + unpin `:202`. This is the same artifact class FLOW.md:307 already condemned once.

### `references/04-act.md` — 6,781 B — 2026-06-11
Purpose: *"**Goal:** Implement all tasks via pipelined three-agent TDD (RED → GREEN → REFACTOR), committing verified code to the work branch."*
Consumers: **(b)** `test_datum_hardening.py:203`; **(c)** `datum/remediate.py:74` (*"Execute Wave 1 via `04-act.md` targeted fix loops."* — a string in a report, not a load); **(c)** supplemented by the four language files.
Verdict: **STALE — the worst file in the directory.** It describes a machine that does not exist.
Evidence, each checked against the tree:
- `:29` — *"Confirm `scripts/test_signal.py` supports the detected test framework"* — no such file.
- `:32` — *"Start the commit queue process: `datum commit-queue --run-id <RUN_ID>`"* — **`datum commit-queue` is not a CLI command and `datum/commit_queue.py` does not exist.** FLOW.md:307 lists "a commit queue" among the mechanisms of the deleted pre-implementation design spec.
- `:36` — *"`datum spec-drift --run-id <RUN_ID> --interval 60 &`"* — no `spec-drift` command.
- `:101-105` — *"Each stage commit goes through the commit queue: Lane signals commit-ready → commit_queue.py applies patch …"* — contradicts FLOW.md:195/247 outright: each stage commits directly in its own git worktree.
- `:109` — a dead `<!-- inject: -->` marker.
- It names three agents (RED/GREEN/REFACTOR); the real lane is six stages including Reflect and the Skeptic panel (FLOW.md:199-250, SKILL.md:131-138).
Action: **rewrite from FLOW.md §3, or delete and point the pin at FLOW.md.** Deleting is defensible: FLOW.md §3 plus SKILL.md "Act Phase" already document Act correctly. If deleted, unpin `test_datum_hardening.py:203` and fix the string at `datum/remediate.py:74`.

### `references/05-validate.md` — 2,566 B — 2026-05-27
Purpose: *"**Goal:** Confirm the integrated result of all ACT lanes meets the SPEC and PROPERTIES requirements before opening a PR."*
Consumers: **(b)** `test_datum_hardening.py:204`.
Verdict: **STALE — and actively contradicts a FLOW.md invariant.**
Evidence: `:9-12` — *"If any lanes failed terminally, surface their diagnostic packets and ask the user: Proceed with remaining lanes' output? Retry the failed lanes? Halt?"*. FLOW.md:12 and FLOW.md:74 say the opposite and say it in bold: *"A failed, blocked or unmerged lane halts the pipeline before Validate/Review/Closeout"*, *"halts even in yolo"*. Validate is never reached with a failed lane. `:26` — *"run `gitnexus detect_changes` on the full PR diff"* — no GitNexus call anywhere in `skills/src/datum-validate.ts`. Missing entirely: the deterministic independent test re-run that FLOW.md:168-172 calls "the final correctness gate of the whole pipeline", and `validate_run_failed` / `testExit === null`.
Action: **keep, update** — delete the "ask the user" branch, document the `testExitCode` re-run and `mainSync`. Highest-priority correction in the phase group.

### `references/06-review.md` — 3,112 B — 2026-05-27
Purpose: *"**Goal:** Produce a structured REVIEW-REPORT.md using a true parallel Map-Reduce Swarm architecture."*
Consumers: **(b)** `test_datum_hardening.py:205`.
Verdict: **STALE.**
Evidence: the four-lens fan-out (`:14-18`) matches FLOW.md:179, so the skeleton is right. Wrong: `:27` — *"Navigate to the worktree (`cd .datum/worktrees/<RUN_ID>`), run `git fetch origin main`, and `git rebase origin/main`"* — Review does not rebase; the base is resolved by `datum epic-base` (FLOW.md:325) and the main sync happens in Validate (FLOW.md:168). `:28` — `git diff main...HEAD` hard-wires `main`, which is exactly the defect FLOW.md:325 closed. `:20` — *"If `.datum/profiles/quality.yaml` exists, spawn agents based on its `review_dimensions`"* — no such file, no producer. Absent: the finding **Key** (lens/file/normalised-description), `datum review-accept`, the iteration counter and the 3-iteration hard stop — all of SKILL.md:159 and FLOW.md:323/335/338.
Action: **keep, update** — fix the base-branch resolution, drop the rebase and `quality.yaml`, add the key/accept/iteration model.

### `references/07-pr-comments.md` — 3,454 B — 2026-06-14
Purpose: *"**Goal:** Triage all PR review comments, fix the actionable ones, and close threads — without touching things that were intentional decisions."*
Consumers: **(b)** `test_datum_hardening.py:206`.
Verdict: **DEAD.**
Evidence: there is no PR-Comments phase (`models.ts:31`). FLOW.md:307 names "a PR phase" as one of the mechanisms in the deleted design spec. `gate.py:1480 gate_pr_comments` does exist and is registered at `gate.py:1588`, but no workflow calls it — a second dead gate alongside `gate_prior_art`.
Action: **delete** + unpin `:206`. Fold the useful triage rubric into `skills/src/prompts/review-domain.md` only if someone wants it; otherwise drop.

### `references/08-closeout.md` — 5,510 B — 2026-05-27
Purpose: *"**Goal:** After the PR merges, produce the full set of post-epic artifacts: updated project docs, retro, solutions, follow-ups, git tag, and GitNexus reindex."*
Consumers: **(b)** `test_datum_hardening.py:207`.
Verdict: **STALE.**
Evidence: `:110` — *"ACT done → Validate → Review → PR opened → PR Comments → fixes → PR merged → Closeout"* — a pipeline with two stages that do not exist; FLOW.md:56-70 ends `Review → Closeout`. `:68` — *"`datum closeout-archive` # copies state.json to runs dir, clears live state"* — state is `.datum/pipeline-state.json` (FLOW.md:3), and `collect_tasks` reading a `state.json` lane map is precisely the dead-producer bug FLOW.md:334 closed. Missing: the `data-exists` gate (FLOW.md:189), `closeout-file-followups` (FLOW.md:356), `datum housekeep-epic` judging merged against the epic branch (FLOW.md:190).
Action: **keep, update** — one correct pipeline line, correct state path, add the collect-batch gate and the follow-up filer.

---

## Group 2 — the Act briefs (11 files, 36,796 B)

**Every one of these is category (d) — orphan.** `git grep` of each basename across the repo (excluding `references/`, `docs/LANDSCAPE.md`, `graphify-out/`, `docs/research/`, `.caliper/`, `docs/epics/`, `docs/archive/`, `CHANGELOG.md`) returns **zero hits** for all eleven. None is in `test_all_phase_references_exist`. The live equivalents are `skills/src/prompts/{red,green,green-retry,refactor,refactor-check,reflect,skeptic-*}.md` and `agents/datum-{red,green,refactor,skeptic,reflect}.md`.

| File | Bytes | Date | Own header | Verdict |
|---|---|---|---|---|
| `04-act-red-brief.md` | 3,432 | 05-27 | *"The RED agent's epistemic role is to write a test that proves a property fails without the implementation."* | **DUPLICATE** of `skills/src/prompts/red.md` (5.0 KB), stale |
| `04-act-green-brief.md` | 3,782 | 05-27 | *"The most important invariant: GREEN never sees test source."* | **STALE + contradictory** (below) |
| `04-act-refactor-brief.md` | 4,557 | 05-27 | *"Its one hard constraint: tests are a one-way ratchet."* | **DUPLICATE** of `prompts/refactor.md`, stale |
| `04-act-adversarial-brief.md` | 4,304 | 05-27 | *"The adversarial agent runs after REFACTOR marks a lane done."* | **DEAD** — the skeptic panel runs **before** REFACTOR (FLOW.md:244-247) |
| `04-act-green-multiturn.md` | 4,530 | 05-27 | *"By default, when GREEN fails the orchestrator spawns a brand new agent with a fresh context."* | **DEAD** — no multi-turn GREEN; the retry is `prompts/green-retry.md` with a sonnet→opus escalation (SKILL.md:135) |
| `04-act-completed-with-risks.md` | 3,594 | 05-27 | *"`completed_with_risks` is a REFACTOR result status…"* | **DEAD** — `LaneStatus` is `'completed'\|'failed'\|'skipped'\|'blocked'` (`models.ts:38`); no such status exists |
| `04-act-skeleton-preflight.md` | 4,118 | 05-27 | *"Before the first RED agent runs, a skeleton creator agent walks the task's acceptance criteria…"* | **STALE** — `:17` names `scripts/skeleton_creator.py`; the file is `datum/skeleton_creator.py`, reached as `datum skeleton`, and it is deterministic, not "a skeleton creator agent" |
| `04-act-edge-cases.md` | 842 | 05-27 | *"## Hard stops during ACT — Test framework unsupported by test_signal.py → refuse to enter ACT; Redaction failed (`signal_redaction_failed`) → halt lane"* | **DEAD** — target of the one dead inject marker; `signal_redaction_failed` exists nowhere in the tree |
| `04-act-python.md` | 2,356 | 05-27 | *"Apply when language is `python`. Supplements `references/04-act.md`."* | **STALE** — `:69` *"Extend the parser in scripts/test_signal.py"*; wrong path |
| `04-act-typescript.md` | 2,535 | 05-27 | *"Apply when language is `typescript` or `javascript`."* | **ORPHAN** |
| `04-act-go.md` | 2,405 | 05-27 | *"Apply when language is `go`."* | **ORPHAN** |
| `04-act-swift.md` | 3,386 | 06-13 | *"Apply these rules when the detected language is `swift`."* | **ORPHAN** |

The four language files have exactly one referrer in the tree and it is a **comment**: `datum/command_guard.py:26` — *"(references/04-act-{python,go,typescript,swift}.md), plus datum's own"*. No code reads them. `datum language-detect` exists and returns a language; nothing then loads a language brief.

**The contradiction worth naming (see §3 below): `04-act-green-brief.md:3` — "GREEN never sees test source"** — plus `:13` *"TEST SIGNAL — redacted output from scripts/test_signal.py"*, `:82-86` a `redaction_failed` halt, `:92` *"the lane halts before GREEN is dispatched"*. None of the redaction machinery exists. `skills/src/datum-tdd-act-lane.ts:984` builds `test_signal` as `{ exit_code, errors }` straight from the RED result with no redaction pass, and `skills/src/prompts/green.md:41` forbids GREEN from *editing* tests, not from reading them.

**Action for the group: delete all eleven** (36,796 B, no test to change). If any content is worth saving it is the RED/GREEN/REFACTOR responsibility split, and the canonical statement of that is `agents/datum-*.md` — the files `datum init` actually materialises into `.claude/agents/`.

---

## Group 3 — the diagram guides (8 files, 143,851 B; 10 if you count the two Mermaid-tooling docs, 178,103 B)

**The direct answer to the question asked: nothing injects any of these into an agent. Not one prompt, not one workflow script, not one CLI command.**

`git grep -l` for the eight basenames returns exactly: `docs/LANDSCAPE.md` (excluded by the audit rules — it is a generated filesystem inventory) and each other. `git grep references skills/src/` returns only the English word. `datum mermaid` is not a CLI command; the two real Mermaid commands are `datum dev extract-mermaid` → `scripts/extract_mermaid.py` and `datum dev render-diagram` → `scripts/mermaid_to_image.py` (`cli.py:2862-2864`), and neither opens a guide.

| File | Bytes | Date | Own header | Consumers | Verdict |
|---|---|---|---|---|---|
| `architecture-diagrams.md` | 37,583 | 05-27 | *"# Architecture Diagrams Guide / **Version:** 2.0 / **Last Updated:** 2025-05-19"* | (d) | **ORPHAN** |
| `sequence-diagrams.md` | 27,988 | 05-27 | *"**Version:** 1.0 / **Last Updated:** 2025-01-13"* | (d) | **ORPHAN** |
| `deployment-diagrams.md` | 18,045 | 05-27 | *"Deployment diagrams visualize infrastructure, server architecture, network topology…"* | (d) | **ORPHAN** |
| `mermaid-diagram-guide.md` | 17,788 | 05-27 | *"This reference provides comprehensive guidance on creating effective Mermaid diagrams for design documents."* | (d) | **ORPHAN** |
| `unicode-symbols.md` | 14,640 | 05-27 | *"Using Unicode characters in Mermaid diagrams enhances clarity, expressiveness, and visual meaning."* | (d) | **ORPHAN** |
| `activity-diagrams.md` | 13,916 | 05-27 | *"Activity diagrams show workflows, business processes, and algorithmic flows."* | (d) | **ORPHAN** |
| `diagram-legibility.md` | 12,923 | 05-27 | *"Mermaid renders in a fixed viewport. A diagram that looks clean at 8 nodes becomes illegible at 20…"* | (d) | **ORPHAN** |
| `cross-cutting-visual.md` | 968 | 05-27 | *"# Cross-Cutting Skill: Visual Explainers (datum-visual)"* | (d) | **DEAD** — names a skill `datum-visual` that does not exist in `skills/` or `.claude/skills/` |

The two Mermaid tooling docs that belong with them:

### `references/troubleshooting.md` — 18,096 B — 2026-05-27
Purpose: *"# Mermaid Syntax Troubleshooting Guide / **Version:** 1.0 / **Last Updated:** 2025-01-13"* — despite the generic filename this is **not** a datum troubleshooting doc.
Consumers: **(a)-intended, in practice (d).** `scripts/resilient_diagram.py:113-135` parses "troubleshooting.md into searchable entries", but `_find_troubleshooting_guide` (`:300-304`) looks in `references/**guides**/troubleshooting.md`. **`references/guides/` does not exist**, so the method returns `None` on every call. Reachable only as `datum dev resilient-diagram` (`cli.py:2864`), which nothing in the pipeline invokes.
Verdict: **ORPHAN with a broken would-be reader.**
Action: **delete**, and delete `scripts/resilient_diagram.py` + its `_DEV_PYTHON_SCRIPTS` entry with it — or fix the path to `skill_root() / "references" / "troubleshooting.md"`. Pick one; leaving a parser aimed at a non-existent directory is the `#394` dead-consumer shape FLOW.md:334 names.

### `references/resilient-workflow.md` — 16,156 B — 2026-05-27
Purpose: *"# Resilient Diagram Generation Workflow / **Version:** 1.0 / **Last Updated:** 2025-01-15"*
Consumers: **(d) none** (only `docs/LANDSCAPE.md:669` lists it as a file).
Verdict: **ORPHAN.** Documents `scripts/resilient_diagram.py`, itself unreachable from the pipeline.
Action: **delete** with the script.

**Action for the whole diagram set: delete all ten (178,103 B, 47% of `references/`), no test to change.** If the diagramming know-how is worth keeping to a human, it is a standalone skill (the environment already has a `mermaid` skill), not a subdirectory of a pipeline's prompt references. FLOW.md's own diagrams are hand-written in `docs/FLOW.md`; none of these guides was used to write them.

---

## Group 4 — the rest (30 files)

### `references/model-tiers.md` — 2,912 B — 2026-05-27
Purpose: *"DATUM uses abstract tiers, never raw model IDs. The host tool resolves tiers to its own models."*
Consumers: **(c)** `SKILL.md:179` — *"Model tiers resolve per-tool via `[models]` in config. See `references/model-tiers.md`."* — and therefore existence-pinned by `datum/self_check.py:103-110`, which appends any missing SKILL.md-referenced path to the `missing_paths` failure of `datum doctor`.
Verdict: **STALE but KEEP — the only file in `references/` with a hard tie to running code.**
Evidence of drift: `:15` — *"Map tiers to model IDs in `.datum/config.toml`"* — the pipeline's config is `.datum/config.json` (FLOW.md:99, SKILL.md:89-97, `skills_materialize.py`). `:46-47` list *"PR Comments triage"* / *"PR Comments fix"* rows for a phase that does not exist. `:57` — `deepen_downshift = true` — a TOML key nothing reads. `:38-41` describe the ACT tiers as "standard (fast if deepened)"; SKILL.md:144 is now *"haiku (evaluators), sonnet (writers), sonnet→opus (GREEN retry)"*, and `AGENT_TYPE_TABLE` in `skills/src/shared/agent-types.ts` is the real mapping.
Action: **keep, update** — swap `.datum/config.toml` → `.datum/config.json`, drop the PR-Comments rows and `deepen_downshift`, and point at `skills/src/shared/agent-types.ts`. Do **not** delete: `datum doctor` fails if it vanishes while `SKILL.md:179` still links it. If it is deleted, `SKILL.md:179` must change in the same commit.

### `references/pattern-library.md` — 4,487 B — 2026-06-10
Purpose: *"Living catalog of failure patterns used by `datum/diagnose_failure.py`. Updated after each epic's unknown failures are reviewed."*
Consumers: **(a)-intended, in practice broken.** `datum/diagnose_failure.py:101` — *"Load patterns from pattern-library.md TOML blocks"* — resolves `REPO_ROOT / "skills" / "datum-workflow" / "references" / "pattern-library.md"` (`:24`). That directory does not exist. `datum/learn_patterns.py:23` uses the identical dead path and `:167` writes proposals *"to references/pattern-library.md"*. `datum/retrospect.py:251` recommends adding recurring reasons to it.
Verdict: **STALE — keep and fix. This is the single strongest finding in the audit.**
Evidence: because the path never resolves, `diagnose_failure` falls through to `_BUILTIN_HARD_STOP` / `_BUILTIN_ENVIRONMENTAL` (`:31`, `:47`) on **every** classification, and the library's docstring promise — *"the library grows with each epic without requiring code changes"* (`diagnose_failure.py:8`) — has never once been true. A producer (`learn_patterns`) and a consumer (`diagnose_failure`) both writing/reading a path neither can reach: verbatim FLOW.md:334's *"a consumer without a producer is dead code that fails at the worst moment."*
Action: **keep; fix the resolver** in both modules to `path_utils.skill_root() / "references" / "pattern-library.md"` (the pattern `path_utils.py:52-62` already establishes for `assets/` and `templates/`). File a see-something issue per ISSUE-001 — this is outside any current task's scope and severity ≥4.

### `references/current-state.md` — 2,213 B — added 2026-05-27 (`2df2e2f6`), last touched 2026-09-06 (`9c1621e4 docs: delete the empty docs/ROADMAP.md duplicate`)
Purpose: *"> **@convention** This is the deterministic playbook for generating `CURRENT_STATE.md` during the DATUM Closeout phase, or on-demand to reorient the team."*
Consumers: **(d) none.** The `git grep current-state.md` hits are all the *step name* `preserve-current-state` in `skills/src/shared/lane-steps.ts:981` and `datum-closeout.ts:111`, and the `current-state` step in `datum-plan.ts:63` — different strings, not this file.
Verdict: **ORPHAN.**
Evidence: the CURRENT_STATE.md that ships is written by the closeout synthesis agent from `skills/src/prompts/closeout-synthesize.md`, whose rules (KEPT_ROOT handling, moving an untracked root file aside) come from FLOW.md:333, none of which appears here.
Action: **merge into `skills/src/prompts/closeout-synthesize.md`** if any of the playbook is worth keeping; otherwise delete.

### `references/dream.md` — 2,772 B — 2026-06-10
Purpose: *"> **@convention** This playbook drives the memory generation phase during Closeout and can be invoked standalone via `datum dream`."*
Consumers: **(c)** `SKILL.md:25` documents `/datum dream`; `datum/cli.py:1336 def dream` and `cli.py:1588` (post-closeout invocation) exist — but neither reads this file. `CHANGELOG.md:259` records the frontmatter schema being added here and `datum/memory_audit.py` parsing it.
Verdict: **STALE-KEEP** — the command is real, the doc is the only written spec of the memory frontmatter, but nothing loads it.
Action: **keep**, verify the frontmatter fields against `datum/memory_audit.py`, and note in the header that it is documentation for `datum dream`, not an injected prompt.

### `references/agent-contracts.md` — 15,330 B — 2026-05-27
Purpose: *"Every agent in the DATUM pipeline operates under a typed contract… These are **hard contracts**, not style guidelines."*
Consumers: **(d) none.**
Verdict: **STALE + DUPLICATE.** The typed contracts are real and live in `skills/src/shared/types.ts` (`StageResult`, `LaneOutcome`, `SetupResult`, `MergeResult`, `DocsResult`, `TriageResult` — FLOW.md:153-159) and `datum/models/*_schema.py`.
Evidence: `:90`, `:100`, `:183`, `:271`, `:300` build briefs around `gitnexus_context` / `gitnexus_impact` fields — no such fields in `types.ts`. `:152` — *"`status: done` AND `verified_red: true` → submit commits to commit queue; advance lane to GREEN"* — the commit queue does not exist, and the real post-RED gate is a deterministic `datum-cli` batch reading exit codes (FLOW.md:224-231). `read_witness`, the mechanism FLOW.md:222/313/354 treats as the core agent contract, appears nowhere in this 15 KB file.
Action: **delete.** 15 KB describing a contract shape superseded by `shared/types.ts`; a stale contract doc is worse than none because an agent reading it would look for `gitnexus_context` in its packet.

### `references/brief-builder.md` — 11,538 B — 2026-06-13
Purpose: *"A brief is the agent's entire working reality. Context isolation between RED, GREEN, and REFACTOR is not a guideline — it is the mechanism that makes test-first development meaningful."*
Consumers: **(d) none.**
Verdict: **STALE.** The brief-building code is `skills/src/shared/lane-steps.ts` + the lane spec relay (`datum lane-spec-export`, FLOW.md:214-222).
Evidence: `:23,27,44,173` build briefs from `gitnexus impact <file>` / `gitnexus context <symbol>` — no GitNexus call exists in the lane runner. `:178` — *"`.datum/state.json` → `brief_defects` for this task"* — the live path is `.datum/runs/*/closeout-data.json` `.brief_defects[]` (`skills/src/datum-plan.ts:64`). `:47` names `detect_spm_subpackage()` from `tdd_driver.py`; no `tdd_driver.py` in the tree.
Action: **delete** (or reduce to a one-page "what the lane spec file contains" note pointing at `lane-steps.ts`).

### `references/pipeline-dispatch.md` — 4,513 B — 2026-05-27
Purpose: *"## Lane Model — Each task is one lane. Lanes flow independently: Lane A's GREEN can run while Lane B is still in RED. There is no wave synchronization."*
Consumers: **(d) none.**
Verdict: **DEAD — the opening claim is false.**
Evidence: *"There is no wave synchronization"* directly contradicts FLOW.md:150: *"read plan → **build waves** → pack into batches of ≤5 → per batch: setup worktrees, run lanes, squash-merge"*, and `datum/wave_builder.py` is the module that does it. `:18` — *"The scheduler (`scripts/pipeline_scheduler.py`)"* — the file is `datum/pipeline_scheduler.py`. It also references a "§Commit Queue … patch format and serialization protocol" that `references/04-act.md:107` links to and that does not exist.
Action: **delete.** An agent that read this would believe lanes are unsynchronised and that a commit queue serialises patches — both wrong, both actionable.

### `references/quality-profiles.md` — 4,759 B — 2026-05-27
Purpose: *"Quality profiles are per-repo YAML files that define what 'done' means for Review and acceptance. They replace the implicit '6 review domains with generic criteria'…"*
Consumers: **(d) none.**
Verdict: **DEAD.**
Evidence: `datum/gate.py:1552 gate_validate_profiles` exists but is not in `GATES` (`gate.py:1578-1589`) and has no caller. No `.datum/profiles/quality.yaml` producer anywhere. `:100` — *"`default_model: "standard"` # maps to config.toml [models] tiers"* — wrong config format. Review runs four fixed lenses (FLOW.md:179), not profile-driven dimensions. `references/06-review.md:20` points here, orphan→orphan.
Action: **delete.** Third dead review-side gate function (with `gate_prior_art`, `gate_pr_comments`) — worth one see-something issue covering all three.

### `references/recovery-modes.md` — 4,975 B — 2026-05-27
Purpose: *"## Diagnosis First — Before any retry, run `datum diagnose <log_path>`."*
Consumers: **(d) none.**
Verdict: **DEAD.**
Evidence: **`datum diagnose` is not a CLI command** — no such name among the 50 command decorators in `datum/cli.py`. `datum/diagnose_failure.py` is a module with no CLI wrapper. The real retry ladder is documented at SKILL.md:161-165 and implemented in `resilientAgent` / `runBatch` (FLOW.md:311, :314, :318, :358).
Action: **delete**, or **merge** the ENVIRONMENTAL/REASONING taxonomy into SKILL.md's "Error Recovery" section, which already carries three lines of it.

### `references/rollback.md` — 3,048 B — 2026-05-27
Purpose: *"`datum rollback <run_id>` reverts a merged epic cleanly… it creates a new revert commit and opens it as a new epic, entering at the PR Comments phase."*
Consumers: **(c)** `datum/rollback.py:121` prints *"See `references/rollback.md` for protocol."* into its output.
Verdict: **DEAD.**
Evidence: **`datum rollback` is not a CLI command.** `datum/rollback.py` exists with a `python3 scripts/rollback.py` usage line (`:6`) pointing at a file that does not exist, and it is not in `_DEV_PYTHON_SCRIPTS`. It entering "at the PR Comments phase" names a phase that does not exist.
Action: **delete the doc and `datum/rollback.py` together** — a module whose only reachable behaviour is printing a pointer to a doc about a command nobody can run. If rollback is wanted, it needs a real command and a real phase target.

### `references/sagas.md` — 1,847 B — 2026-05-27
Purpose: *"**Goal:** Treat the DATUM pipeline as a distributed transaction. Every phase that mutates state must have a registered 'compensation' (rollback action) in case a downstream phase fails terminally."*
Consumers: **(d) none.**
Verdict: **DEAD, and contradicts a FLOW.md rule.**
Evidence: FLOW.md:293 — *"**Nothing destructive runs before Closeout** — lane branches and pipeline-state are only deleted by `datum housekeep-epic`"* — and FLOW.md:288: on a halt, lane branches and worktrees are *preserved*. datum's failure model is halt-and-preserve, the opposite of compensating transactions. No "registered compensation" exists in any script.
Action: **delete.**

### `references/spec-drift.md` — 3,559 B — 2026-05-27
Purpose: *"Spec drift occurs when SPEC.md is modified while ACT lanes are actively running."*
Consumers: **(d) none** (`datum/spec_drift_detector.py:107` writes `.datum/runs/{run_id}/.spec-drift-detected`, but does not read this file).
Verdict: **DEAD.**
Evidence: `references/04-act.md:36` prescribes `datum spec-drift --run-id … --interval 60 &`; that command does not exist and `spec_drift_detector.py` is not in `_DEV_PYTHON_SCRIPTS` — **the detector has no launcher**. Nothing in `skills/src/` checks the `.spec-drift-detected` flag.
Action: **delete the doc**; file a see-something issue on `spec_drift_detector.py` (a producer with no invoker and no consumer — the `analyze_properties.py` class FLOW.md:307 already deleted once).

### `references/proof-of-work.md` — 2,882 B — 2026-05-27
Purpose: *"Every REFACTOR agent produces a `proof-of-work.md` alongside its implementation commit. This is not a code artifact — it is a trust signal for the reviewer."*
Consumers: **(d) none.** The two `proof_of_work` hits are a schema field (`datum/models/executor_result_schema.py:116`) and a fixture (`assets/fixtures/contracts/refactor-result.valid.json:32`).
Verdict: **DEAD.**
Evidence: *"Every REFACTOR agent produces…"* is false — `skills/src/prompts/refactor.md` and `agents/datum-refactor.md` never mention proof-of-work, and FLOW.md:247-249 has REFACTOR *"clean up without touching tests, commit"* and nothing else. The schema field is optional and unset by any producer.
Action: **delete**, and drop the unused optional field from `executor_result_schema.py:116` (or leave it and say why).

### `references/property-categories.md` — 5,999 B — 2026-05-27
Purpose: *"The 11 property categories used in PROPERTIES.md. Every requirement maps to at least one category."*
Consumers: **(d) none.**
Verdict: **DUPLICATE — but the content is live.**
Evidence: the 11 categories are enforced by `datum gate properties` (FLOW.md:143 lists them verbatim: SAFETY, LIVENESS, INVARIANT, BOUNDARY, IDEMPOTENT, ORDERING, ISOLATION, PERFORMANCE, SECURITY, OBSERVABILITY, COMPATIBILITY) and the derivation prompt is `skills/src/prompts/properties-derive.md`. This file has no Integration Invariants section, so it is a *stale* copy of a live list.
Action: **merge into `skills/src/prompts/properties-derive.md`** (the file the agent actually receives) and delete. That is the only change that puts the definitions in front of the deriving agent.

### `references/coding-steering.md` — 3,605 B — 2026-05-27
Purpose: *"# WFC Coding Steering (Distilled) — This document consolidates 12 fragmented Claude rule files into a single, token-efficient steering doctrine for LLM context injection."*
Consumers: **(d) none.** The `coding-steering` grep hits are `datum/steering/*` — a differently-named module (`datum-coding-steering`, `steering/miner.py`) that mines evidence and validates steering docs; it does not read this file.
Verdict: **ORPHAN — and a foreign-project artifact.**
Evidence: it is a byte-level copy of the user's own global `~/.claude/rules/CODING-STEERING.md` ("WFC", `wfc helpers recall`, PY-001 toolchain rules). FLOW.md:307 records deleting *"a memory dump from another project whose GREEN rule contradicts `green_edited_tests`"* for exactly this reason. Shipping another org's house rules to every datum consumer repeats that defect.
Action: **delete.**

### `references/steering-shape.md` — 1,225 B — 2026-05-27
Purpose: *"Use a compact, machine-friendly markdown shape. ## Required sections"*
Consumers: **(d) none.**
Verdict: **ORPHAN.** Plausibly the format spec for `datum/steering/`, but nothing in that package reads it.
Action: **merge** into a docstring in `datum/steering/models.py` if it is the real shape contract; otherwise delete.

### `references/domain-wisdom.md` — 6,838 B — 2026-05-27
Purpose: *"Compressed wisdom for scalable systems. These are not rules — they are seeds. Plant them in the soil of your problem and they grow into architecture."*
Consumers: **(d) none.**
Verdict: **ORPHAN.**
Evidence: `:131` — *"**Plan (step 0.5)** | When evaluating 2-3 architectural approaches, invoke the relevant seeds"* — `skills/src/prompts/plan-approaches.md` is 807 bytes and invokes nothing. `:133` prescribes the same for Refine; `prompts/refine-*.md` do not.
Action: **delete**, or **merge** two or three seeds into `plan-approaches.md` if they earn their tokens there. Prose that instructs a phase to "invoke" it, in a file that phase never opens, is decoration.

### `references/token-efficiency.md` — 3,443 B — 2026-05-27
Purpose: *"Token cost compounds across epics. This doc describes how the skill minimizes it."*
Consumers: **(d) none.**
Verdict: **STALE.**
Evidence: none of the real token-efficiency machinery is here — the 16 KB relay budget and two-phase probe/inline `shared/context-relay.ts` (FLOW.md:13), the `head -c` capped scope reads (FLOW.md:348), the bounded `<epic>..HEAD` lane history (FLOW.md:280), or the batching of consecutive runners into one `datum-cli` call (SKILL.md:101). Those are the actual policy; this file predates all of them.
Action: **delete**; FLOW.md principle 5 is the live statement.

### `references/git-workflows.md` — 2,515 B — 2026-05-27
Purpose: *"**Goal:** Establish a robust version control foundation tailored for high-velocity, autonomous AI agent contributions in the DATUM factory."*
Consumers: **(c)** `datum/worktree_manager.py:12` — *"See: references/git-workflows.md and GitHub issue #137."* (a docstring pointer).
Verdict: **STALE.**
Evidence: `:26` — *"**Rollback:** If an AI ships a bug, the feature flag is toggled off in production. We do not use massive `git revert` commands"* — datum has no feature-flag mechanism and no production. Missing everything FLOW.md:14/195/309 says about git: scoped commits, per-lane worktrees cut from the epic branch, chained writers of a shared file, squash order equalling write order, per-worktree hook disabling (FLOW.md:310).
Action: **keep, rewrite** as the worktree/commit contract `worktree_manager.py` actually implements, or delete and repoint the docstring at `docs/FLOW.md` §3.

### `references/impact-analysis.md` — 2,166 B — 2026-05-27
Purpose: *"**Goal:** Understand exactly what will break if code is modified, mathematically calculating blast radius before any code changes are made."*
Consumers: **(d) none.** The `impact-analysis` grep hits are the GitNexus skill directory, `CLAUDE.md:45`/`AGENTS.md:135` pointing at `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` (a different file), a cost-model label (`scripts/cost-model.py:48`), and the agent label `'impact-analysis'` at `skills/src/datum-plan.ts:211`.
Verdict: **ORPHAN.**
Evidence: the `impact-analysis` agent at `datum-plan.ts:211` runs `skills/src/prompts/plan-impact.md` (1.1 KB) — it does not read this file, and `plan-impact.md` contains no GitNexus call. `:12` — *"If GitNexus reports 'Index is stale', run `npx gitnexus analyze`"* — advice for a human, duplicated at `CLAUDE.md`.
Action: **delete**; `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` is the maintained copy and `CLAUDE.md`/`AGENTS.md` already point there.

### `references/gitnexus-playbook.md` — 3,542 B — 2026-05-27
Purpose: *"GitNexus is the impact analysis and code intelligence backbone. The skill calls it at specific points; this doc defines exactly what to call and when."*
Consumers: **(d) none.**
Verdict: **DEAD — the premise is false.**
Evidence: *"The skill calls it at specific points"* — the skill calls GitNexus at **zero** points. `git grep gitnexus skills/src/` returns nothing; the only wiring is a passthrough `gitnexus_app` at `datum/cli.py:2989` and `datum/bootstrap/gitnexus_setup.py`. Every GitNexus instruction across `references/` (`00-discovery.md:27-40`, `01-refine.md:41`, `02-plan.md:64`, `02.8-deepen.md:9`, `05-validate.md:26`, `07-pr-comments.md:19`, `brief-builder.md:23-44`, `agent-contracts.md:90,183,300`, `08-closeout.md`) is unreachable for the same reason.
Action: **delete.** GitNexus is a developer tool for humans working *on* datum (`CLAUDE.md`), not a pipeline dependency — and five reference docs currently imply otherwise.

### `references/prompt-template.md` — 936 B — 2026-05-27
Purpose: *"Use this only when the user explicitly asks for a reusable downstream prompt."*
Consumers: **(d) none.**
Verdict: **ORPHAN.** No workflow ever "asks the user for a reusable downstream prompt".
Action: **delete.**

---

## (1) Ranked deletions and merges

| # | Action | Bytes | Why it ranks here |
|---|---|---|---|
| 1 | **Delete the 10 diagram/Mermaid docs** (`architecture-`, `sequence-`, `deployment-`, `activity-diagrams`, `mermaid-diagram-guide`, `diagram-legibility`, `unicode-symbols`, `cross-cutting-visual`, `troubleshooting`, `resilient-workflow`) | **178,103** | 47% of the directory, zero referrers outside each other, no test to change, no judgement call required. Largest cleanup per unit of risk in the repo. |
| 2 | **Delete the 11 act briefs** (`04-act-*` minus `04-act.md`) | **36,796** | Superseded by `skills/src/prompts/*.md` and `agents/datum-*.md`, which are the files an agent actually receives. Three of them (`green-brief`, `adversarial-brief`, `completed-with-risks`) state rules the runner does not implement — see §3. No test pins any of them. |
| 3 | **Delete 5 phase docs for phases that do not exist** — `00-discovery`, `0x-express`, `01.5-research`, `03.5-architect`, `07-pr-comments` | 16,128 | Highest *misdirection* value per byte: each names a pipeline stage a reader would look for. Ranked below 1–2 only because each requires editing `tests/test_datum_hardening.py:193-210` in the same commit. |
| 4 | **Delete the never-wired subsystem docs** — `agent-contracts`, `brief-builder`, `pipeline-dispatch`, `quality-profiles`, `recovery-modes`, `rollback`, `sagas`, `spec-drift`, `proof-of-work`, `gitnexus-playbook`, `02.3-prior-art`, `02.5-triage`, `02.8-deepen`, `token-efficiency`, `coding-steering`, `prompt-template` | 63,441 | Each describes a mechanism with no implementation (`commit-queue`, `datum diagnose`, `datum transition`, `datum rollback`, `quality.yaml`, saga compensations, GitNexus-in-pipeline). Ranked 4 because four of them (`pipeline-dispatch`, `sagas`, `recovery-modes`, `agent-contracts`) also need a same-commit fix to the code that points at them. |
| 5 | **Merge `property-categories.md` → `skills/src/prompts/properties-derive.md`**, then delete | 5,999 | The content is live and gate-enforced; the file is not read. Merging is the only change that puts the definitions in front of the deriving agent. Must add the Integration Invariants table (FLOW.md:143) while merging. |
| 6 | **Merge `current-state.md` → `prompts/closeout-synthesize.md`**, `steering-shape.md` → `datum/steering/models.py` docstring, 2–3 seeds of `domain-wisdom.md` → `plan-approaches.md`; delete the originals | 10,276 | Small, judgement-heavy, and each merge needs a human to decide what survives. |
| 7 | **Fix, do not delete: `pattern-library.md`** | 4,487 | The only file here with two real code consumers. Change `diagnose_failure.py:24` and `learn_patterns.py:23` to `skill_root() / "references" / "pattern-library.md"`. |
| 8 | **Update in place: `01-refine`, `02-plan`, `03-properties`, `05-validate`, `06-review`, `08-closeout`, `04-act`, `model-tiers`, `git-workflows`, `dream`** | 40,343 | These describe phases that exist. `05-validate.md` first (it contradicts the Act halt rule), `04-act.md` second (it is the most wrong file in the directory). |
| 9 | `impact-analysis.md` — delete | 2,166 | Duplicates `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md`, which `CLAUDE.md:45` and `AGENTS.md:135` already point at. |

Ranks 1–6 and 9 total **312,909 bytes (82% of `references/`)** proposed for deletion or merge.

## (2) Files that must be kept, with the consumer that proves it

There are exactly **two**, and neither is read as a prompt.

| File | Consumer that proves it | Nature of the tie |
|---|---|---|
| `references/model-tiers.md` | `SKILL.md:179` links it → `datum/self_check.py:103-110` regexes `references/[...].md` out of SKILL.md and appends any missing one to `missing_paths` | **`datum doctor` fails if this file is deleted without editing SKILL.md:179 in the same commit.** Update it; do not delete it alone. |
| `references/pattern-library.md` | `datum/diagnose_failure.py:101` parses its TOML blocks; `datum/learn_patterns.py:167` writes entries for it; `datum/retrospect.py:251` recommends it | The intended runtime consumer. It is currently unreachable (`:24` points at the non-existent `skills/datum-workflow/`), so **keep and repair** rather than delete. |

Everything else in `references/` is (b) pinned by name in `tests/test_datum_hardening.py:193-210`, (c) named in a docstring or a printed string, or (d) nothing at all. **No file in `references/` is read at runtime by any workflow script, prompt, or agent definition.**

## (3) Contradictions an agent could act on

1. **`04-act-green-brief.md:3` — "GREEN never sees test source" — and the whole redaction machinery around it (`:13,21,82-86,92`).** There is no redaction. `skills/src/datum-tdd-act-lane.ts:984` passes `test_signal: { exit_code, errors }` straight from the RED result; `skills/src/prompts/green.md:41` bans GREEN from *editing* tests, not reading them; `agents/datum-green.md:43` says *"you cannot see test source, only the signal"* as a claim about the packet, with no enforcement. An agent following the brief would look for `scripts/test_signal.py` and a `signal_redaction_failed` halt, find neither, and halt a lane on a mechanism that was never built. **Most actionable contradiction in the directory.**

2. **`05-validate.md:9-12` tells Validate to proceed past failed lanes** — *"If any lanes failed terminally … ask the user: Proceed with remaining lanes' output?"*. FLOW.md:12 and FLOW.md:74 make a failed/blocked/unmerged lane an unconditional halt *before* Validate, **including yolo**, precisely so nothing certifies an epic that shipped nothing. A doc offering "proceed" contradicts the pipeline's single hardest rule.

3. **`04-act.md:32,101-105` routes every stage commit through a commit queue** (`datum commit-queue`, `commit_queue.py applies patch`). Neither exists. The real model is one git worktree per lane, each stage committing directly (FLOW.md:195, :247). An agent following it would wait for a queue acknowledgement that never arrives, and FLOW.md:307 already names "a commit queue" as a mechanism from the deleted design spec — this file is the last surviving copy of that fiction.

4. **`pipeline-dispatch.md:3` — "There is no wave synchronization"** vs FLOW.md:150 *"build waves → pack into batches of ≤5"* and `datum/wave_builder.py`. Also `:18` names `scripts/pipeline_scheduler.py` (the file is `datum/pipeline_scheduler.py`).

5. **`04-act-adversarial-brief.md:3` — "The adversarial agent runs after REFACTOR marks a lane done"** vs FLOW.md:244-247, where the skeptic panel runs **between GREEN and REFACTOR**. A brief that puts an adversarial pass after the lane completes describes a stage that cannot influence anything.

6. **`04-act-completed-with-risks.md` defines a lane status that the type system rejects.** `skills/src/shared/models.ts:38`: `LaneStatus = 'completed' | 'failed' | 'skipped' | 'blocked'`. A REFACTOR returning `completed_with_risks` fails to parse.

7. **`sagas.md` prescribes compensating rollbacks per phase** vs FLOW.md:288/293 halt-and-preserve (*"Nothing destructive runs before Closeout"*). Opposite failure philosophies.

8. **`references/*.md` mandates GitNexus at seven points** (`00-discovery.md:27-40`, `01-refine.md:41`, `02-plan.md:64`, `02.8-deepen.md:9`, `05-validate.md:26`, `07-pr-comments.md:19`, `brief-builder.md:23-44`) and `gitnexus-playbook.md:1` claims *"The skill calls it at specific points"*. `git grep gitnexus skills/src/` returns nothing. Every one of those instructions is unreachable.

9. **Config format split, inside the ground-truth tier itself** — worth resolving before any reference doc is edited: `SKILL.md:44` says *"Load Config — `.datum/config.toml`, falling back to `assets/config.toml.default`"* (and `assets/config.toml.default` does exist), while `SKILL.md:89-97` and FLOW.md:99/102 say `.datum/config.json` — which is what `skills_materialize.py` writes and what `RepoConfig` reads. `model-tiers.md:15` and `quality-profiles.md:100` repeat the `.toml` form. **The `.toml` half of `SKILL.md` is the stale one**, so this is a SKILL.md bug that `references/` merely inherits; fix SKILL.md:44 first or the reference edits will be re-derived wrong.

10. **Bonus, outside `references/` but found while checking it:** `agents/datum-red.md:43` — *"APPEND new test functions to the test file — NEVER delete or replace existing tests"* — contradicts `skills/src/prompts/red.md:53-54`, which *mandates* amending stale owned assertions, and FLOW.md:328, which records the deadlock that rule caused (*"RED's rule 'keep all existing tests intact' plus GREEN's `green_edited_tests` made a lane … deadlock"*). `agents/datum-red.md` is materialised into consumer repos by `datum init` (SKILL.md:30), so this is a live regression of a closed gap, not a docs nit. Recommend a see-something issue and a fix in `agents/datum-red.md`.

## (4) Bytes shipped to consumer repos with no runtime reader

Three numbers, because the mechanisms differ and one figure would mislead:

| Vector | Bytes of `references/` | Evidence |
|---|---|---|
| **Copied into a consumer repo by `datum init`** | **0** | `datum/skills_materialize.py:22` — `SKILL_GLOB = "datum-*.js"`; `materialize_skills` (`:35`) copies only that glob into `.datum/skills`. `datum init` also copies `agents/datum-*.md` → `.claude/agents/` and hooks → `.datum/hooks/` (SKILL.md:30). **No path in `datum/bootstrap/` or `datum/cli.py` touches `references/`.** |
| **Exposed in the agent's skill tree by `datum install`** | **379,573** (the whole directory) | `datum/bootstrap/install_skill.py:51` — `link_path.symlink_to(source_root)` symlinks the **entire repo root** to `~/.claude/skills/datum` for six tools (`:10-17`). Every reference file becomes browsable skill content beside `SKILL.md`. |
| **Reachable by an agent following a documented link** | **2,912** (`model-tiers.md` alone) | `SKILL.md:179` is the only link from `SKILL.md`/`AGENTS.md`/`README.md` into `references/`. |

**So: 376,661 bytes (99.2% of `references/`) are exposed in every install with no runtime reader and no documented path to them** — and `datum install` costs nothing to run, so the exposure is universal even though the `datum init` copy is zero. Of that, **312,909 bytes are recommended for deletion or merge above**, and roughly **215,000 bytes actively misdescribe the pipeline** (the phase docs for non-existent phases, the act briefs, and the never-wired subsystem docs), which is the part that matters: a browsable 379 KB tree that contradicts FLOW.md at ten points is a larger liability than its size suggests, because Claude Code surfaces sibling files of a loaded `SKILL.md` as progressive-disclosure candidates. This is the same failure FLOW.md:307 closed for `docs/` — *"a doc that names a mechanism must name the code that enforces it"* — reproduced one directory over and, by byte count, four times larger.
