## Refine — 2026-06-15

### Q1: [Architecture] Lane-state path: `.datum/runs/<runId>/lane-state/` or `.datum/lane-state/`?

> The PLAN.md header for task-2 says "Track completed lanes in `.datum/lane-state/<id>.json`", but TASKS.md research findings (line 182) and the lane-plan.json acceptance criteria (line 67) both specify `.datum/runs/<runId>/lane-state/<laneId>.json`. The SPEC assumes TASKS.md wins (run-scoped path), but if the intent is a global lane-state store (not per-run), the path and the "fresh run executes all lanes" behavior AC would need to be revised.
>
> I'm assuming the per-run path `.datum/runs/<runId>/lane-state/<laneId>.json` is correct — is that right, or should it be a global `.datum/lane-state/<id>.json` that persists across runs?

[Answer]:

---

### Q2: [Architecture] Is `lane-plan.json` the single source of truth, or do TASKS.md / PLAN.md have authoritative fields?

> The pipeline tooling reads `lane-plan.json` directly to drive execution. TASKS.md and PLAN.md are maintained by humans and may drift. When there is a conflict between them (e.g., task-5 RED note wording, file lists), the SPEC resolves in favor of `lane-plan.json`. If TASKS.md is ever intended to be the authority that updates `lane-plan.json` (not the other way around), a sync step is needed.
>
> I'm assuming `lane-plan.json` is the pipeline source of truth and TASKS.md is secondary human documentation — is that right?

[Answer]:

---

### Q3: [Scope] task-4 (TASKS.md rebuild) vs task-6 (lane-plan.json rebuild) — are these intentionally two separate rebuild steps?

> Both task-4 and task-6 run `bash scripts/build-workflows.sh` and produce `skills/datum-go.js` + `skills/datum-tdd-act-lane.js`. Someone reading the task list without the DAG context could mistake them for duplicates. The distinction is that task-4 is Wave 1 (rebuilds after task-1 and task-2 only) while task-6 is Wave 2 (rebuilds after task-4 and captures G6 fixes too). However, `lane-plan.json` lists task-6 as depending on task-1, task-2, and task-4 — making task-4 a prerequisite rebuild that feeds task-6's final rebuild.
>
> I'm assuming both are intentional and that task-4 is a Wave 1 intermediate build used to verify task-1 and task-2 in isolation before the Wave 2 task-6 final build — is that right, or should task-4 be removed and task-6 made the sole build step?

[Answer]:

---

### Q4: [Architecture] task-9 module split target paths: underscores (`datum-tdd-act-lane_red_prompts.ts`) or slashes (`datum-tdd-act-lane/red-prompts.ts`)?

> `lane-plan.json` `file_ownership` map uses underscore notation (`skills/src/datum-tdd-act-lane_red_prompts.ts`) which would place the files flat in `skills/src/` rather than in a subdirectory. TASKS.md (lines 135–152) and the SPEC consistently describe the slash/directory layout (`skills/src/datum-tdd-act-lane/red-prompts.ts`). These produce very different filesystem structures — the underscore form is flat files, the slash form is a new subdirectory.
>
> I'm assuming TASKS.md is correct and the target is a new `skills/src/datum-tdd-act-lane/` directory with files like `red-prompts.ts`, `count-gate.ts`, etc. — is that right, or should the files stay flat in `skills/src/` with underscore-separated names?

[Answer]:
