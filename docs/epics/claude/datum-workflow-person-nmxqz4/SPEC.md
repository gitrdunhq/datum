# SPEC: Workflow runner core, run datum bundles outside Claude Code

## Summary

datum's workflow bundles (`skills/datum-*.js`) run only inside Claude Code's Workflow tool, where every shell command is wrapped in an LLM call. This change adds a host-side runner (`skills/src/runtime/runner.ts`, reached through `datum workflow run`) that executes the same bundles unchanged, runs `datum-cli` batches as real subprocesses through a new `shell` seam in `runBatch`, routes every other `agent()` call through a pluggable `StageExecutor` behind per-model semaphores, records per-call metrics, and validates stage replies against their schema with one tier-up retry. Only a fake executor ships in this epic; the pi executor and HTTP client are later epics.

## Context

- `runBatch(steps, opts, deps?)` in `skills/src/shared/agents.ts` has about 80 call sites in the `datum-*.ts` bundles. It builds `batchCommandPrompt(steps)` (`skills/src/shared/batch.ts:180`), calls `agent()` (or `deps.agentFn`), parses the reply with `parseBatchResult`, and retries on refusal, corrupt script, empty reply, `batch_script_failed`, `batch_truncated`, `batch_timeout` and `batch_root_missing`/`tool_missing`. `RunBatchDeps` has only `agentFn` and `logFn`. The shell branch must be placed before the prompt and retry logic and must bypass them.
- `batchScript(steps)`, `parseBatchResult`, `BATCH_TOOL_TIMEOUT_MS` (600000) and `setBatchRoot` exist in `skills/src/shared/batch.ts`. `batchRoot` is module-private, so a `getBatchRoot()` accessor is missing and must be added.
- `datum-cli` calls that still reach `agent()` and must move onto `runBatch`: `verifyCommitIndependently` (`agents.ts:90`), the retry-guard inside `resilientAgent` (`agents.ts:172`, label `retry-guard`, model `haiku`), dep-merge (`datum-tdd-act-lane.ts:1946`), `datum-go.ts:438` (act-start), `datum-validate.ts:142`, `datum-tdd-act-setup.ts:41`, `datum-tdd-act.ts:62`, `datum-closeout.ts:54` and `:171`, `datum-tdd-act-merge.ts:57`.
- Two further routes are missed by `grep batchCommandPrompt`: `runCommandPrompt` (`skills/src/shared/boot.ts:163`, used at `datum-go.ts:183` preflight-tool-check and `datum-go.ts:214` preflight-gitignore), and `contextInlineRetryPrompt` (`skills/src/shared/context-relay.ts:221`, used via `agent()` with `'cli'` at `datum-plan.ts:82` and `:143`, `datum-properties.ts:80`, `datum-refine.ts:101`). Both carry `agentType: 'datum-cli'` when agent types are on, so the new runner would reject them by name unless they are converted.
- `skills/src/shared/sandbox.d.ts` declares `agent`, `parallel`, `pipeline`, `phase`, `log`, `workflow`, `args` and `budget` (`total`, `spent()`, `remaining()`). It has no `shell` declaration. `skills/src/shared/test-bundle.ts` is the existing helper for loading compiled bundles in tests.
- `skills/src/shared/models.ts` holds `model(tier)`, `setModelTiers`, `DEFAULT_CONFIG` and `mergeConfig`. `readRuntimeConfig` does not exist. `mergeConfig` merges only top-level keys and `models`, so a repo-level `runtime` block replaces a global one wholesale.
- `skills/src/shared/schemas.ts` has `STAGE_RESULT_SCHEMA` (required today: `success`, `tests_pass`, `committed`, `read_witness`), `REFLECT_SCHEMA` and `SKEPTIC_SCHEMA` (both already require `read_witness`). `schemas.test.ts` likely pins the required lists.
- `datum/closeout/collect_token_metrics.py` (invoked as `datum closeout-collect-token-metrics --run-id`, wrapper at `datum/cli.py:3031`) reads only a SQLite `token_metrics` table, writes `closeout-raw/token_metrics.json` and a `.collect-token-metrics.done` marker, and emits `no_state_available` when there are no rows. It has no `metrics.jsonl` reader, no cached share and no per-agent-type totals.
- `datum/cli.py` (3172 lines) uses typer sub-apps via `app.add_typer`. There is no `workflow` sub-app. `tests/test_cli_flag_contract.py` checks flags passed by workflow scripts against their targets.
- `scripts/build-workflows.sh` runs `npx tsc -p skills/tsconfig.json`, then bundles each `skills/src/datum-*.ts` with esbuild and post-processes it (hoisted `export const meta`, top-level `return`, `@generated` banner) and verifies the result. The runner needs a separate esbuild call outside that loop and outside its meta/return checks.
- `.datum/config.json` has `agent_types: false` in this repo, in which case `stageOpts` omits `agentType`. The `cli_call_bypassed_runbatch` rejection would never fire unless the runner turns agent types on.
- Symbols named in the TICKET that do not exist yet: `readRuntimeConfig`, `runBundle`, `StageExecutor`/`StageRequest`/`StageReply`, the `skills/src/runtime/` directory, the fake executor, `deps.shell` and the `shell` global, `cli_call_bypassed_runbatch`, `stage_output_invalid`, the `datum workflow run` command, `getBatchRoot`, the `metrics.jsonl` producer and reader, `skills/runtime/runner.js`, and the `runtime` config block. All are created by this change. `parseBatchResult`, `batchScript` and `BATCH_TOOL_TIMEOUT_MS` exist and are reused unchanged.

## Requirements

Where a requirement depends on an unanswered question, the provisional default is stated and the question number is given. Provisional defaults are listed in the Assumption Audit.

### R1. Shell seam in `runBatch`

- R1.1 `skills/src/shared/sandbox.d.ts` declares `shell?(script: string, opts: { cwd: string; timeoutMs: number }): Promise<{ exit_code: number; stdout: string; stderr: string }>` as an optional global. `npx tsc -p skills/tsconfig.json` exits 0.
- R1.2 `RunBatchDeps` gains an optional `shell`. When `deps.shell` or `globalThis.shell` is a function, `runBatch` calls it exactly once per attempt with `script === batchScript(steps)`, `opts.cwd === getBatchRoot()` (falling back to `args.repoRoot`, then `process.cwd()`, when the batch root is empty) and `opts.timeoutMs === 600000`. `deps.shell` takes precedence over `globalThis.shell`.
- R1.3 With a shell present, `agentFn` is called zero times, and `batchCommandPrompt` is not invoked. The stdout is passed to `parseBatchResult` and the returned `BatchResult` is the `runBatch` result. A test with a fake shell returning a 3-row JSON array asserts 3 parsed steps and zero `agentFn` calls.
- R1.4 When the shell rejects, `runBatch` returns `missing: true` with `scriptError` starting `batch_shell_threw:` followed by the error message. When the shell returns a non-zero `exit_code` and stdout that `parseBatchResult` cannot parse as steps, it returns `missing: true` with `scriptError` starting `batch_shell_exit_<exit_code>:` followed by the first 200 characters of stderr. In both cases `agentFn` is called zero times and no retry runs.
- R1.5 When neither `deps.shell` nor `globalThis.shell` is defined, `runBatch` behaves as before. The existing `agents.test.ts`, `batch.test.ts` (except the known zsh failure) and `agent-types-ordering.test.ts` retry-path tests pass, with only the source-text pins named in R2.5 edited.
- R1.6 `getBatchRoot()` is exported from `skills/src/shared/batch.ts` and returns the value last passed to `setBatchRoot`.

### R2. Every `datum-cli` call goes through `runBatch`

- R2.1 `verifyCommitIndependently`, the `resilientAgent` retry-guard and the dep-merge call at `datum-tdd-act-lane.ts:1946` call `runBatch` instead of `agent(batchCommandPrompt(...))` or `agentFn(batchCommandPrompt(...))`.
- R2.2 The direct callers in `datum-go.ts:438`, `datum-validate.ts:142`, `datum-tdd-act-setup.ts:41`, `datum-tdd-act.ts:62`, `datum-closeout.ts:54`, `datum-closeout.ts:171` and `datum-tdd-act-merge.ts:57` call `runBatch`.
- R2.3 The `runCommandPrompt` callers at `datum-go.ts:183` and `datum-go.ts:214` are converted to single-step `runBatch` calls. The `contextInlineRetryPrompt` callers at `datum-plan.ts:82`, `datum-plan.ts:143`, `datum-properties.ts:80` and `datum-refine.ts:101` are routed through `runBatch` through a retry-marker variant that preserves the retry text. Any `datum-cli` call that remains on a Claude Code path with no `shell` produces the same prompt text as before the change.
- R2.4 After the change, `grep -rn batchCommandPrompt skills/src --include=*.ts` outside `*.test.ts` lists only `skills/src/shared/batch.ts` and `skills/src/shared/agents.ts`. The same holds for `runCommandPrompt` and `contextInlineRetryPrompt` call sites outside `boot.ts`, `context-relay.ts` and `agents.ts`. Unused imports are removed so `npx tsc -p skills/tsconfig.json` exits 0.
- R2.5 The tests that pin the old form (`agents.test.ts:272`, `main-sync-steps.test.ts:233`, `agent-types-ordering.test.ts:25/63/97/114`) are updated to pin the new form. `setBatchCacheKey` and `setBatchRoot` still precede the first `runBatch` call in every bundle, and `agent-types-ordering.test.ts` passes.
- R2.6 After `bash scripts/build-workflows.sh`, the regenerated `skills/datum-*.js` files carry the `@generated` banner and `git diff --stat skills/*.js` lists only bundles whose source changed. No `.js` bundle is edited by hand.

### R3. Runner module

- R3.1 `skills/src/runtime/runner.ts` exports `runBundle(opts: { bundlePath: string; args: unknown; executor: StageExecutor; shell: ShellFn; skillsDirs: string[]; log: (line: string) => void }): Promise<unknown>`. It reads the bundle, strips the `export ` keyword from `export const meta`, wraps the body in an `AsyncFunction` so the top-level `return` works, and resolves with the returned value.
- R3.2 `runBundle` supplies every global in `sandbox.d.ts` plus `shell`. A test bundle that reads `typeof` of each of `agent`, `parallel`, `pipeline`, `phase`, `log`, `workflow`, `args`, `budget` and `shell` sees `function` for the functions and `object` for `args` and `budget`.
- R3.3 `parallel(thunks)` starts all thunks before awaiting any, returns results in input order, and maps a rejected thunk to `null`. A test with thunks `[ok, reject, ok]` returns `[x, null, y]`.
- R3.4 `pipeline` follows the semantics fixed by Q2. Provisional default: `pipeline(items, ...stages)` passes each item through the stages in order, each stage receives the previous stage's result for that one item, items run concurrently, and an item whose stage rejects yields `null` and skips its later stages. A test with 3 items and 2 stages asserts stage order per item and `null` for the failing item.
- R3.5 `phase(name)` and `log(line)` both call `opts.log` once per call. `budget.total` is `null`, `budget.spent()` equals the sum of `prompt_tokens + completion_tokens` over recorded replies, and `budget.remaining()` returns `null` while `total` is `null`.
- R3.6 `workflow({ scriptPath })` loads the file at that path. `workflow({ name })` resolves `<dir>/<name>.js` over `skillsDirs` in order, first existing file wins (`.datum/skills` before the configured `skills_dir`). A name found in no directory rejects with an error whose message is `workflow_not_found: <name>` and lists the directories searched. The child runs with the same executor and shell, and receives the child `args` given to `workflow()`.
- R3.7 Nested children share the parent's semaphore map and metrics sink per Q3 (provisional default: shared).
- R3.8 `Math.random` is not patched. The runner source contains no assignment to `Math.random`.

### R4. Stage executor interface

- R4.1 `skills/src/runtime/executor.ts` exports `StageExecutor { execute(req: StageRequest): Promise<StageReply> }`, `StageRequest { prompt: string; opts: AgentOpts; model: string; headers: Record<string, string> }` and `StageReply { text: string; usage?: { prompt_tokens: number; completion_tokens: number; cached_tokens: number }; timings?: { prefill_ms: number; decode_ms: number } }`.
- R4.2 The runner's `agent(prompt, opts)` builds a `StageRequest` whose `model` is the tier id resolved from `opts.model` through the runtime `models` map, sends it through the semaphore (R6), parses the reply text with `parseAgentJson`, and validates it (R8). When `opts.schema` is absent it returns the parsed value without validation.
- R4.3 An `agent()` call whose `opts.agentType === 'datum-cli'` rejects with an `Error` whose message begins `cli_call_bypassed_runbatch` and contains `opts.label`. The executor receives zero requests for it and no metrics line is written.
- R4.4 The rejection in R4.3 is reachable in this repo's own config: the runner activates agent types for every bundle it runs (mechanism per Q9), so `stageOpts('cli', ...)` yields `agentType: 'datum-cli'` even where `.datum/config.json` has `agent_types: false`.

### R5. Fake executor

- R5.1 `skills/src/runtime/fake-executor.ts` exports a `FakeExecutor` implementing `StageExecutor`. Constructed with an ordered script `Array<{ labelPrefix: string; reply: StageReply | ((req) => StageReply) }>` and a default reply, it answers with the first entry whose `labelPrefix` is a prefix of `req.opts.label`, otherwise the default.
- R5.2 It records every request with `startedAt` and `endedAt` timestamps in call order, exposed as `requests`.
- R5.3 `hold(labelPrefix)` makes matching requests wait until `release(labelPrefix)` is called. A test starts 3 held requests, asserts 3 recorded starts and 0 ends, releases them, and asserts 3 ends.
- R5.4 No HTTP client or network call exists under `skills/src/runtime/`. `grep -rn "fetch(\|http\|net\." skills/src/runtime --include=*.ts` outside test files and fixtures is empty.

### R6. Runtime config, tiers and concurrency

- R6.1 `readRuntimeConfig(parsedConfig)` in `skills/src/shared/models.ts` is a pure function over the parsed `.datum/config.json` object. It returns `{ kind, models: { fast, balanced, deep }, concurrency, priority, client }`. `kind` is `"fake"` or `"pi"`. An absent `priority` yields `"batch"` and an absent `client` yields `"datum"`. An absent `concurrency` entry for a model yields 1 at lookup time.
- R6.2 An unknown `kind` throws an error whose message begins `runtime_kind_unknown: ` followed by the offending value. A missing `models.fast`, `models.balanced` or `models.deep` throws `runtime_models_missing: <tier>` (see Q4). A non-integer or non-positive concurrency value throws `runtime_concurrency_invalid: <modelId>`.
- R6.3 `runBundle` feeds the `models` triple to `setModelTiers` before running the bundle.
- R6.4 The runner keeps one semaphore per model id. With `concurrency = { m1: 2 }` and 5 held requests for `m1`, the fake executor records exactly 2 in flight at any time. A model with no entry runs 1 at a time.
- R6.5 Waiting requests for one model are served in arrival order. When a request finishes and several are waiting, the earliest-arrived waiter whose `agentType` equals that of the finished request goes first; when none matches, the earliest-arrived waiter goes. A test with waiters `[A1, B1, A2]` and a finishing `A` request asserts the start order `A1, A2, B1`.
- R6.6 Every request carries headers `X-Client: <client>` and `X-Priority: <priority>`. A test with defaults asserts `X-Client: datum` and `X-Priority: batch` on every recorded request.
- R6.7 `runBundle` called without a `runtime` block behaves per Q5 (provisional default: `runBundle` receives an already-resolved runtime config from its caller and `readRuntimeConfig` never invents `models`; the CLI fails with exit 2 when the block is absent). `kind: "pi"` is rejected per Q5 (provisional default: rejected by the CLI with exit 2 and the message `runtime_kind_unavailable: pi`, since no pi executor ships here).

### R7. Per-call metrics

- R7.1 Every executed request appends one JSON line to `<repoRoot>/.datum/runs/<runId>/metrics.jsonl` with exactly the keys `ts, run_id, label, agent_type, model, prompt_tokens, completion_tokens, cached_tokens, prefill_ms, decode_ms, queue_wait_ms, wall_ms, attempt, outcome`. `outcome` is one of `ok`, `invalid`, `error`. Missing `usage` or `timings` in a reply are written as `0`.
- R7.2 `runId` is `args.runId` when it is a non-empty string; otherwise it is derived from the runner's start time as `YYYYMMDD-HHMMSS` in UTC. The directory is created when absent.
- R7.3 `queue_wait_ms` is the time from `agent()` entry to semaphore acquisition, and `wall_ms` is the time from acquisition to reply. An executor that throws writes a line with `outcome: "error"` and the call rejects with the executor's error.
- R7.4 `attempt` is numbered per Q6 (provisional default: 1 for the first call of a label, 2 for the tier-up retry; each executed request is one line).
- R7.5 `datum closeout-collect-token-metrics` (implemented in `datum/closeout/collect_token_metrics.py`) additionally reads `.datum/runs/<runId>/metrics.jsonl` and adds the keys `per_agent_type` and `cached_share` to the existing output without changing existing keys (`per_phase`, per-model totals). The exact shape is fixed by Q1. Provisional default: `per_agent_type` maps agent type to `{calls, prompt_tokens, completion_tokens, cached_tokens}`, `per_stage` maps label prefix to the same four totals, and `cached_share` maps agent type to `cached_tokens / prompt_tokens` rounded to 4 decimals, `0.0` when `prompt_tokens` is 0.
- R7.6 A missing `metrics.jsonl` yields empty `per_agent_type`, `per_stage` and `cached_share` objects and exit 0. It does not change the existing `no_state_available` status semantics, and the existing tests in `tests/test_closeout_collectors.py` and `tests/test_closeout_cli.py` pass unchanged. A malformed line makes the collector exit non-zero with a message naming the line number.

### R8. Stage output contract

- R8.1 `STAGE_RESULT_SCHEMA.required` lists `success`, `tests_pass`, `committed`, `read_witness`, `files_written` and `test_exit_code`. `REFLECT_SCHEMA.required` and `SKEPTIC_SCHEMA.required` still list `read_witness`. `schemas.test.ts` is updated to pin these lists, and the types of `files_written` (array) and `test_exit_code` (integer) are declared in `properties`.
- R8.2 The validator accepts `readonly` required arrays (the schemas are `as const`). It checks that each required key is present and that its value matches the declared `type` (`string`, `number`, `integer`, `boolean`, `array`, `object`). It reports every missing or wrongly typed field.
- R8.3 For an invalid reply the runner logs `stage_output_invalid: <label>: <missing or wrong fields>`, writes a metrics line with `outcome: "invalid"`, and retries once on the next tier up (`fast` to `balanced`, `balanced` to `deep`). The retry request's `model` differs from the first request's `model`. A `deep` miss is not retried. A second miss returns `null`.
- R8.4 Tier resolution handles the cases in Q4 (provisional default: a tier is resolved by looking up the request's model id in the `models` map; when two tiers share a model id, the highest tier carrying it is used as the current tier, and if the next tier maps to the same model id the retry is skipped and `null` is returned after logging `stage_output_invalid: <label>: no distinct higher tier`; a model id not in the `models` map, including the literal `haiku` used at some call sites, is treated as `fast`).
- R8.5 A valid reply is returned with no retry and one metrics line with `outcome: "ok"`.
- R8.6 Running `assertReadWitness` against replies on the hosted path is unchanged, and `npx vitest run skills/src` passes except the known zsh failure in `batch.test.ts`.

### R9. CLI entry

- R9.1 `datum workflow run <name> --args <file> [--config <path>]` exists in a new `workflow_app` typer sub-app registered in `datum/cli.py`. The logic lives in a new `datum/workflow_run.py`; the `cli.py` wrapper is under 15 lines.
- R9.2 The command resolves the bundle at `.datum/skills/<name>.js`, then at `<skills_dir>/<name>.js` (using `datum.skills_materialize.resolve_skills_dir`), reads the args file as JSON and the runtime config from `--config` (default `.datum/config.json`), and spawns `node skills/runtime/runner.js` with them as an argument vector (no shell string, no `shell=True`).
- R9.3 The bundle result is printed as JSON on stdout. Exit code 0 on a result, 1 on a thrown error with the message on stderr, 2 on a usage error: missing bundle, unparseable args file, missing args file, missing runtime block, or unknown `runtime.kind`. Each exit code has a pytest in `tests/` that runs the command against a stub runner.
- R9.4 `scripts/build-workflows.sh` builds `skills/src/runtime/runner.ts` to `skills/runtime/runner.js` with a second esbuild call (`--platform=node`), outside the `datum-*` loop and its meta/return checks. The output starts with the `// @generated — DO NOT EDIT. Source: skills/src/` banner, and the script's verify stage checks that banner for the runner. The compiled file is committed.
- R9.5 `tests/test_cli_flag_contract.py` passes unchanged.

### R10. End-to-end fixture

- R10.1 `skills/src/runtime/fixtures/fixture-go.js` and `fixture-child.js` exist in post-processed bundle shape (hoisted `export const meta`, top-level `return`, no imports) and between them call `phase`, `log`, `agent` with and without `schema`, `parallel` with one rejecting thunk, a `runBatch`-shaped shell call, and `workflow({ name: 'fixture-child' })`.
- R10.2 The shell call runs the command fixed by Q8 through a real subprocess shell (provisional default: a one-row batch script that runs `printf '[{"step":"echo","exit_code":0,"stdout":"fixture-shell-ok"}]'`, parsed with `parseBatchResult`). The result contains the literal `fixture-shell-ok`.
- R10.3 A vitest in `skills/src/runtime/runner.test.ts` runs `runBundle` on `fixture-go.js` with the `FakeExecutor` and asserts: the returned object equals the expected parent result with the child's result embedded; the shell stdout appears in the result; the rejected thunk's slot is `null`; `FakeExecutor.requests.map(r => r.opts.label)` equals the expected label list in order; and `metrics.jsonl` under a temp repo root has exactly one line per recorded request.
- R10.4 The same vitest file covers the negative paths: `cli_call_bypassed_runbatch`, `workflow_not_found`, a schema-invalid reply with successful tier-up, a schema-invalid reply failing twice (result `null`, two metrics lines with `invalid`), and a `deep` miss (one request only).

## Failure Modes

| Failure | Handling |
|---|---|
| `shell` rejects or times out | `runBatch` returns `missing: true`, `scriptError: batch_shell_threw: <message>`; no model call, no retry |
| Shell exits non-zero with unparseable stdout | `missing: true`, `scriptError: batch_shell_exit_<code>: <stderr head>` |
| `datum-cli` call reaches `agent()` | Rejects with `cli_call_bypassed_runbatch: <label>`; no executor call, no metrics line |
| Executor throws or times out | Metrics line with `outcome: "error"`; the call rejects with the executor's error; `parallel` maps it to `null`, a bare `agent()` call surfaces the error to the bundle |
| Reply fails `parseAgentJson` | Treated as an invalid reply (same path as a schema miss) |
| Reply fails schema validation | Logged as `stage_output_invalid`, retried once on the next tier, second miss returns `null` |
| Tiers share a model id or a tier id is missing | Per Q4 default: retry skipped with a named log line, or `runtime_models_missing` at config read |
| Nested bundle not found | `workflow_not_found: <name>` listing the directories searched |
| Unknown `runtime.kind` | `runtime_kind_unknown: <value>`; CLI exit 2 |
| `metrics.jsonl` directory not writable | The call fails with the filesystem error; no silent drop of metrics |
| `metrics.jsonl` absent at collection | Empty result, exit 0 |
| `metrics.jsonl` contains a malformed line | Collector exits non-zero naming the line number |
| Args file missing or not JSON | CLI exit 2, message on stderr |
| Bundle throws | CLI exit 1, message on stderr |
| Semaphore waiter never released (executor never settles) | Bounded by the per-request timeout supplied by the executor; the fake executor exposes `release` and fails the test on a held request at test end |

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Hosted-path compatibility | With no `shell` global and no runtime block, every `runBatch` call site produces the same prompt text as before; the existing vitest suite passes except the pre-existing zsh failure in `batch.test.ts` |
| Concurrency bound | In-flight requests per model never exceed `concurrency[model]` (default 1), asserted over 50 queued requests in a test |
| Dispatch overhead | Semaphore bookkeeping adds under 5 ms per request at 1,000 queued requests with the fake executor |
| Timeouts | Shell calls use `BATCH_TOOL_TIMEOUT_MS` (600000 ms); executor timeouts are the executor's responsibility and are documented in `executor.ts` |
| Determinism | Runner source uses no `Math.random`; fake executor replies depend only on script and label |
| Dependencies | `package.json` and `pyproject.toml` dependency lists are unchanged |
| File size | New files stay under 500 lines; `datum/cli.py` gains under 15 lines |
| Toolchain | Node and Python versions follow Q7; the CLI spawns `node` with an argument vector, no `shell=True`, no `eval`, no `os.system` |
| Privacy | `metrics.jsonl` carries no prompt text or reply text, only labels, counts and timings |
| Error format | New errors use the `code: detail` form of existing `scriptError` values |

## Out of Scope

- The pi stage executor, `tools/pi/stage.sh`, and the lane-guard extension (homelab repo slices 4 and 5).
- Any HTTP or OpenAI-compatible client; the fake executor is the only executor.
- Role prompt materialisation and the `lane-guard.json` writer (slice 6), the external-commit path in the lane script (slice 7), `datum doctor --runtime pi` (slice 10), the `datum go` launcher with entry detection and halt handling (slice 12), the Plane tracker (slice 14), and the ticket interview (slice 15).
- Any change to how bundles behave under the Claude Code Workflow tool when there is no `shell` global and no runtime block.
- Changes to `datum/local_llm.py` or `datum/agent_loop.py`.
- A replay cache keyed by prompt (slice 13).
- New runtime dependencies in `package.json` or `pyproject.toml`.
- Fixing the pre-existing vitest failure "under real zsh" in `batch.test.ts` (environment gap, no zsh on this host).
- A real `kind: "pi"` runtime: this epic only decides where it is rejected (Q5).
- Reshaping the existing `per_phase` output of the token-metrics collector.

## Open Questions

- Q1. Collector output shape: which names and nesting hold per-stage totals and cached share per agent type in `closeout-raw/token_metrics.json`? The collector is `datum/closeout/collect_token_metrics.py`; the shape in R7.5 is provisional.
- Q2. `pipeline` semantics: stage definition, one item versus whole list, result passing, per-item failure handling (R3.4).
- Q3. Do nested `workflow()` children share the parent's per-model semaphores and metrics sink (R3.7)?
- Q4. Tier-up when two tiers map to the same model id or a tier id is missing (R6.2, R8.4).
- Q5. Behaviour of `runBundle` callers with no `runtime` block, and where `kind: "pi"` is rejected (R6.7).
- Q6. Numbering of `attempt` in `metrics.jsonl` for retried calls (R7.4).
- Q7. Node version target: ticket says 22, the owner's global homelab rule says 24 LTS, and the repo declares no Node engine.
- Q8. Which shell command the fixture runs and how its stdout is parsed (R10.2).
- Q9. How the runner turns agent types on when `.datum/config.json` has `agent_types: false`, so that `cli_call_bypassed_runbatch` can fire (R4.4).

## Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | The collector to extend is `datum/closeout/collect_token_metrics.py`, reached by `datum closeout-collect-token-metrics` | Code scan shows the module and the typer wrapper at `datum/cli.py:3031` | confirmed | n/a |
| 2 | `parseBatchResult`, `batchScript` and `BATCH_TOOL_TIMEOUT_MS` exist in `skills/src/shared/batch.ts` and are reused unchanged | Verified in code scan (`batch.ts:79`, `:176`) | confirmed | n/a |
| 3 | `runBatch` has no `deps.shell` or `globalThis.shell` today and has about 80 call sites | Code scan of `agents.ts` | confirmed | n/a |
| 4 | `getBatchRoot()` does not exist and must be added | `batchRoot` is module-private in `batch.ts` | confirmed | n/a |
| 5 | The `shell` global is a Promise-returning function matching the `sandbox.d.ts` declaration, and a rejection is treated as a thrown error | Ticket R1 declares the signature; rejection handling is a design decision | decided | n/a |
| 6 | `readRuntimeConfig` is a pure parser over the parsed config object that defaults `priority` to `batch` and `client` to `datum` and throws `runtime_kind_unknown` for an unknown `kind` | Ticket R6 gives the defaults; configs are read through batch steps, not direct file reads | decided | n/a |
| 7 | The fake executor's default reply is used for any label that matches no script prefix | Ticket R5 says "then a default" | decided | n/a |
| 8 | Retry and tier-up use the `models` map of the `runtime` block for fast to balanced to deep | Ticket R6 and R8 | decided | Q4 |
| 9 | Child bundles use the same executor, shell and semaphore map as the parent | Ticket R3 says same executor and shell; sharing the semaphore map follows from per-model limits being global | decided | Q3 |
| 10 | `pipeline(items, ...stages)` passes one item at a time through the stages, items run concurrently, and a rejecting stage yields `null` for that item | Mirrors `parallel` rejection handling; ticket says only "runs items through the stages in order" | decided | Q2 |
| 11 | `runBundle` does not invent defaults for `models`; the CLI rejects a missing runtime block with exit 2; `kind: "pi"` is rejected by the CLI | No pi executor exists in this epic; fail-fast rule in project coding rules | decided | Q5 |
| 12 | `attempt` is 1 for the first request of a label and 2 for the tier-up retry | Ticket R8 allows exactly one retry | decided | Q6 |
| 13 | The collector shape in R7.5 adds `per_agent_type`, `per_stage` and `cached_share` keys and leaves `per_phase` unchanged | Scan: reshaping `per_phase` would break existing tests | decided | Q1 |
| 14 | The fixture shell step prints a fixed JSON row with `printf` and is parsed by `parseBatchResult` | Keeps the test free of repo state and of `datum` CLI availability | decided | Q8 |
| 15 | The runner activates agent types itself so the `datum-cli` guard is live in this repo | `.datum/config.json` has `agent_types: false`, which omits `agentType` | decided | Q9 |
| 16 | `runCommandPrompt` and `contextInlineRetryPrompt` call sites are in scope of R2 even though the ticket's grep misses them | They produce `datum-cli` agent calls that the runner would reject | decided | n/a |
| 17 | Node target is whatever the repo already runs (no engine declared); no new pin is added in this epic | No `.nvmrc` or `engines` field found; ticket says Node 22, owner rule says 24 | decided | Q7 |
| 18 | The literal model id `haiku` used at `agents.ts:172` and `datum-tdd-act-lane.ts:1946` is mapped to the `fast` tier | Tier-to-tier escalation cannot map a literal alias otherwise | decided | Q4 |

## Classification Metadata

```yaml
estimated_files: 45
estimated_loc: 2400
clusters_touched:
  - skills/src/shared (agents, batch, models, schemas, sandbox.d.ts, boot, context-relay)
  - skills/src/runtime (new)
  - skills/src datum-* bundles and generated skills/datum-*.js
  - datum CLI (cli.py, workflow_run.py)
  - datum/closeout (collect_token_metrics.py)
  - scripts/build-workflows.sh
  - tests (vitest and pytest)
new_public_api: true
dependency_additions: none
```
