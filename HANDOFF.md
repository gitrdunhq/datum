# Handoff: workflow runner core, and getting datum onto pi

Written 2026-10-12 at the merge of PR #578 (branch `claude/datum-workflow-person-nmxqz4`). Audience: whoever picks this up on the host, human or agent. Plan and tracking live in the homelab repo: `docs/plans/datum-on-pi.md`, Plane LLM-306 (slices LLM-307 to LLM-344, slice 21 = LLM-363/364, milestone LLM-362). Benchmark of the run that built this: homelab `docs/research/datum-dogfood-20261012-120800.md`.

## 1. State in one paragraph

The runner core is merged: datum can run a workflow bundle outside Claude Code (`datum workflow run`), shell batches run as subprocesses when a `shell` global exists, models are routed by tier with per-model concurrency, every call is logged to `metrics.jsonl`, and stage output is schema-checked with a one-tier-up retry. **Datum does not run on pi yet.** The runner ships only a fake executor, and `runtime.kind: "pi"` is refused (`runtime_kind_unavailable`). Section 5 lists what is missing, in order. Tests at merge: pytest 2810 passed, 0 failed (12 skipped, 3 xfailed); vitest 1638 of 1638; `tsc` clean. The repo has no CI, so these numbers are only as current as the last local run.

## 2. What landed

| Area | What | Where |
|---|---|---|
| Shell seam | `runBatch` runs a batch as one bash subprocess when `globalThis.shell` (or `deps.shell`) is set; with no shell the hosted path sends the same prompts as before. All direct cli `agent()` calls moved onto `runBatch` | `skills/src/shared/agents.ts`, `batch.ts`, every `skills/src/datum-*.ts` |
| Runner | `runBundle` evaluates a bundle with the sandbox globals (`agent`, `parallel`, `pipeline`, `phase`, `log`, `workflow`, `shell`, `args`, `budget`), nested `workflow()`, globals saved and restored per run | `skills/src/runtime/runner.ts`, compiled to `skills/runtime/runner.js` |
| CLI | `datum workflow run <name> --args <file> [--config <file>]`: validates config and args, finds the bundle (`.datum/skills` first, warns `workflow_bundle_shadowed`), spawns `node skills/runtime/runner.js` | `datum/workflow_run.py`, `datum/cli.py` |
| Routing | `runtime` block in `.datum/config.json`: `kind`, `models.{fast,balanced,deep}`, `concurrency` (per model id, default 1; key `shell` bounds shell batches), `priority`, `client`. Kind-grouped FIFO semaphores; `X-Client` / `X-Priority` headers | `skills/src/shared/models.ts`, `skills/src/runtime/semaphore.ts` |
| Metrics | One JSON line per executed call in `.datum/runs/<run>/metrics.jsonl` (tokens, cached tokens, prefill, decode, queue wait, wall, attempt, outcome `ok`/`invalid`/`error`) | `skills/src/runtime/metrics.ts` |
| Output contract | Stage replies validated against the stage schema; `stage_output_invalid` retried once on the next tier up, never the same model | `runner.ts`, `skills/src/runtime/validate.ts`, `shared/schemas.ts` |
| Limits | Run ids are one plain path segment (`run_id_invalid`, runner and all closeout collectors); workflow names are bare names (`workflow_name_invalid`); `nodeShell` kills a script past 16 Mi characters of stdout and keeps a 64 Ki stderr tail | `metrics.ts`, `datum/run_ids.py`, `runtime/shell.ts` |
| Planner | `datum lane-plan` finds existing tests that read a lane file's source text (`source_pins`), adds unowned ones to the lane, warns otherwise | `datum/lane_plan.py` |
| Merge | Opt-in `regenerate_command` runs after a batch's lanes land and folds generated files into the merge commit | `datum/worktree_manager.py` |
| Act start | Refuses a plan missing PROPERTIES.md's integration lanes (`integration_lanes_unscheduled`) | `datum/lane_plan_digest.py` |
| Closeout | `datum metrics import-workflow --run-id <run> <wf_dir>...` turns hosted Workflow transcripts into `metrics.jsonl`; plan amendments count as brief defects | `datum/workflow_metrics.py`, `datum/closeout/` |
| Dogfood fixes | GNU sed, preflight cwd and pipefail, gate false positives, `--renumber`, `agent_types_disabled`, digest relay retry, refusal rows, prose retry for read-only batches, lint fix paths, review-report pipes, hermetic tests | see `git log` on the branch; each commit names its defect |

Review: all 22 findings of the epic review have a recorded decision in `docs/epics/claude/datum-workflow-person-nmxqz4/REVIEW-RESPONSE.md`. Closeout ran (archive commit `5c877b2`).

## 3. How to work on datum locally (host)

### 3.1 Setup, once per checkout

```bash
git clone git@github.com:gitrdunhq/datum.git && cd datum
uv sync --extra rag                # the rag extra is imported by the test suite
pnpm install --frozen-lockfile                           # Node >= 22; .nvmrc pins 24
uv run datum init                  # writes .datum/config.json, agents, hooks
uv run datum permissions-snippet   # merge the output into .claude/settings.local.json BEFORE starting a Claude Code session
pnpm dlx gitnexus analyze              # CLAUDE.md expects the GitNexus index
```

Add to `.datum/config.json` (gitignored, local):

```json
{
  "task_id_prefix": "DAT",
  "worktree_sync_args": { "uv": ["--frozen", "--extra", "rag"] },
  "regenerate_command": "bash scripts/build-workflows.sh"
}
```

`regenerate_command` matters for datum itself: lanes edit `skills/src/*.ts` and never the generated `skills/*.js`, so without it the next phase runs stale bundles.

### 3.2 Every change

- Edit TypeScript in `skills/src/`, never `skills/*.js` (they carry `// @generated`). Rebuild: `bash scripts/build-workflows.sh` (about 15 s; verifies outputs).
- Checks before a push: `uv run pytest -q` (about 3 min), `pnpm exec vitest run`, `pnpm exec tsc -p skills/tsconfig.json`, `uv run ruff check <changed files>` and `uv run ruff format --check <changed files>`. Run ruff format on the files you touched only; the repo is not fully formatted and a whole-file reformat buries the diff.
- Test first. Source-pin tests (tests that read a `.ts` file and assert on its text) exist all over `skills/src/*.test.ts`; `datum lane-plan` now lists them per lane as `source_pins`. Update a pin in the same change that moves the text it pins.
- Commit subjects are conventional (`type(scope): subject`).

### 3.3 Running datum on itself in Claude Code (hosted path, works today)

Start the Claude Code session **inside the datum checkout** after `datum init` and the permissions snippet. In the dogfood run the session started one directory up, so agent types, PreToolUse hooks and permission rules never loaded; most runner refusals and the stray-file incident came from that. If you must run without agent types, set `"agent_types_disabled": true` in `.datum/config.json`.

```
FP=$(uv run datum config-fingerprint)
Workflow({ scriptPath: "<repo>/skills/datum-go.js", args: { yolo: true, configFingerprint: "<FP>", repoRoot: "<repo>" } })
```

- Recompute the fingerprint on every launch; a stale one replays cached failures.
- Gates: `datum gate <phase>`; a human approval is `datum gate <phase> --approve`; a reasoned accept of a review finding is `datum review-accept <ID|key> --reason "..."`. The auto-mode classifier refuses an agent approving its own review gate; the owner runs that one.
- The base test suite must be green before Act, or every lane inherits the failures.
- Before Closeout on the hosted path: `uv run datum metrics import-workflow --run-id <closeout run id> ~/.claude/projects/<project>/<session>/subagents/workflows/wf_*` so the closeout counts tokens.

### 3.4 Running a bundle through the runner (no Claude Code)

```bash
# .datum/config.json needs a runtime block:
#   "runtime": { "kind": "fake", "models": { "fast": "f", "balanced": "b", "deep": "d" } }
echo '{ "runId": "local-1", "repoRoot": "'"$PWD"'" }' > .temp-args.json
uv run datum workflow run <bundle-name> --args .temp-args.json [--config .datum/config.json]
```

The bundle is found by name in `.datum/skills/` first, then the configured skills dir. With `kind: "fake"` every model call returns `{}`, so a real phase bundle runs its shell batches for real (a `datum-validate` run executes the test suite) and then stops on empty model replies; it exercises orchestration, shell batches and metrics only. The smallest end-to-end examples are the runner tests, which drive `skills/src/runtime/fixtures/fixture-go.js` and `fixture-child.js` (`pnpm exec vitest run skills/src/runtime`). Exit codes: 0 ok, 1 runner failed (stderr has the error), 2 usage error (nothing spawned).

## 4. Known gaps carried out of this epic

| Gap | Effect | Action |
|---|---|---|
| The epic's 19 integration-invariant lanes were never built (Properties' scheduling step was skipped by a resume; fixed for the future in `5db34d5`) | PROPERTIES.md's integration invariants for this epic are not verified by dedicated tests | Schedule them: `uv run datum lane-plan --input docs/epics/claude/datum-workflow-person-nmxqz4/tasks.json --output docs/epics/claude/datum-workflow-person-nmxqz4/lane-plan.json --md-output docs/epics/claude/datum-workflow-person-nmxqz4/TASKS.md --properties docs/epics/claude/datum-workflow-person-nmxqz4/PROPERTIES.md`, commit, `datum gate plan`, run Act for them |
| No CI on gitrdunhq/datum | Nothing re-runs the suites on a push | Run section 3.2's checks by hand, or add a workflow |
| `source_pins` is noisy | Audit-style tests that read many sources produce warnings (12 on this epic) | Tune the detector if it gets in the way; warnings never block |
| Shell batches default to one at a time (`concurrency.shell` = 1) | Parallel lanes queue their test runs | Raise `runtime.concurrency.shell` once the host's CPU budget is known |
| `read-context-files` labels reused in datum-plan.ts (COV-6, predates the epic) | Two batches share labels in logs and metrics | Rename when touching that file |
| `PERF-003`: metrics lines are appended synchronously | Negligible against model latency | Revisit only if a profile shows stalls |

## 5. What datum needs to run on pi

Critical path, in order (LLM-362 tracks it). Item numbers are Plane ids under LLM-306.

| Step | Item | Repo | What |
|---|---|---|---|
| M0 | LLM-307 (slice 0) | homelab | Probe on the live models: Ornith 9B aggregate tokens/s and cached share at 1, 2, 4 concurrent; pi `--print` returns a parseable final JSON block 10 of 10; `--system-prompt <file>` works; container spawn time; what usage and timings pi exposes |
| M1 | LLM-314/315 (slice 4) | homelab | `tools/pi/stage.sh <worktree> <stage.json>`: one pi `--print` run in `pi-sandbox:local` on the firewalled `pi-board` network (same startup check as `run.sh --board`), venv interpreter mounted read-only from `.venv/pyvenv.cfg`, prompt from a file, writes `reply.json`, exit 0/2/3/4 |
| M1 | LLM-316/317 (slice 5) | homelab | `tools/pi/extensions/lane-guard/`: blocks writes outside `allowed_write_files`, all writes when `read_only` |
| M1 | LLM-318/319 (slice 6) | datum | `datum init --runtime pi` writes `.datum/roles/<kind>.md` from `agents/datum-*.md` without frontmatter, hooks and the commit instruction; the runner writes `lane-guard.json` per stage |
| M1 | **LLM-363/364 (slice 21)** | datum | `PiStageExecutor` in `skills/src/runtime/pi-executor.ts`, selected in `executors.ts` for `kind: "pi"`. Contract (pinned in LLM-363): config `stage_script` (required), `stage_timeout_s` (default 900), `commits_external`; per call a stage dir under `.datum/runs/<run>/stages/` with `prompt.md` and `stage.json` (`model`, `role` = agentType minus `datum-`, `read_only`, `headers`, `timeout_s`, ...); host worktree path rewritten to `/work` in the prompt; spawn `bash <stage_script> <worktree> <stage.json>` with a process-group kill; exits map to `stage_usage_error`, `stage_guard_blocked`, `stage_timeout`, `stage_failed`; reply `{ text, usage?, timings? }` feeds metrics. Remove `pi` from `unavailable` in `assets/runtime-kinds.json` |
| M1 | LLM-324 (slice 9) | both | First real stage: one lane's reflect plus the three skeptic lenses on Ornith 4-wide, against a hosted run of the same commit |
| M2 | LLM-320/321 (slice 7) | datum | `commits_external`: the pi image has no git, so the lane script commits a writing stage's allowed files (`commitFilesSteps`) and fails the lane on a forbidden change |
| M2 | LLM-325/326 (slice 10) | datum | `datum doctor --runtime pi` runs `test_command` once in the sandbox; offline forms only (`.venv/bin/python -m pytest`, not `uv run`) |
| M2 | LLM-335/336 (slice 16) | datum | Prompt layering: `wt` rendered as `/work` (replaces slice 21's string rewrite), prefix-stability tests |
| M3 | LLM-328/329 (slice 12) | datum | `datum go` launcher: branch guard, doctor, entry detection, fingerprint, args file, runner launch, halt handling, so no Claude Code session is needed |
| M3 | LLM-327 (slice 11) | both | Benchmark epic, 3 to 5 lanes, local only; owner decides which stages stay hosted |

### 5.1 Things in datum that will break under pi, beyond the slices

These were found while reading the code for the handoff; none has a Plane item yet. File them under LLM-306 when work starts.

1. **Read witnesses need git.** `agents/datum-red.md`, `datum-green.md`, `datum-reflect.md` and `datum-skeptic.md` tell the model to run `git hash-object <path>` and return the first 12 hex characters in `read_witness`; `STAGE_RESULT_SCHEMA` requires the field and the lane rejects a result without it. The pi image has no git. Options: a `git-hash-object` shim in the image (Python: `sha1(b"blob %d\0" % len(data) + data)`), or the role prompts (slice 6) give the Python one-liner. Pick one before slice 9, or every judge reply is rejected.
2. **Writers are told to commit.** The same agent files say to commit; `STAGE_RESULT_SCHEMA.committed` is required. Slice 6 must replace the instruction and slice 7 must make the lane script accept `committed: false` when `commits_external` is set.
3. **Agent types are forced on under the runner.** `globalThis.datumRuntime = { agentTypes: true }`, so every model call carries an agentType. Slice 21 maps it to a role; a call without one is an error by design.
4. **Readers still go to a model.** The plan (3.1) says `agent(kind=reader)` should read the file locally; nothing implements that. Today a `datum-reader` call becomes a pi stage on the fast tier. Cheap, but avoidable.
5. **Context budget.** Ornith 9B has 32K context. GREEN prompts on large lanes can exceed it; the ladder escalates to Ornith 35B and Qwen3.8, which have one slot each and will become the queue.
6. **Claude Code tool names.** `agents/datum-reader.md` says "the Read tool" and `agents/datum-cli.md` "the Bash tool". `datum-cli` never reaches pi (shell batches), but `datum-reader` does (item 4); its role prompt in slice 6 should use pi's tool names. The stage prompts in `skills/src/prompts/` name no tools.

### 5.2 Owner decisions still open (plan section 7)

Ornith concurrency (4, or the slice 0 number); whether a hosted tier sits above `deep` for plan decompose; `pipeline.max_concurrent` on the host (4 suggested); raising Ornith `--cache-ram` (production change, `llm:*` lease).

## 6. Where to look

| Need | Path |
|---|---|
| Executor interface | `skills/src/runtime/executor.ts`, `executors.ts`, `fake-executor.ts` |
| Runner entry and globals | `skills/src/runtime/runner.ts` (`runBundle`, `main`) |
| Shell batches | `skills/src/shared/agents.ts` (`runBatch`, `runBatchViaShell`), `skills/src/runtime/shell.ts` |
| Tiers, runtime config | `skills/src/shared/models.ts`, `assets/runtime-kinds.json` |
| Stage schemas | `skills/src/shared/schemas.ts` |
| Agent type table, read-only stages | `skills/src/shared/agent-types.ts` |
| Role sources for pi | `agents/datum-*.md` |
| Python CLI for the runner | `datum/workflow_run.py`, `datum/cli.py` (`workflow`, `metrics` sub-apps) |
| This epic's artifacts | `docs/epics/claude/datum-workflow-person-nmxqz4/` (SPEC, TASKS, PROPERTIES, REVIEW-REPORT, REVIEW-RESPONSE, RETRO) |
| Runtime docs | `SKILL.md` (config table), `docs/FLOW.md` ("Shell seam and the bundle runner"), `references/08-closeout.md` |
