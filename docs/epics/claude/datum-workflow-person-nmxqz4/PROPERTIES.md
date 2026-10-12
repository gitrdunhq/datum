# PROPERTIES: Workflow runner core, run datum bundles outside Claude Code

Derived from SPEC.md (R1 to R10, Failure Modes, NFRs), TASKS.md (DAT-1 to DAT-20) and the answered QUESTIONS.md (Q1 to Q9). Property IDs are `PROPERTY(<CATEGORY>-NNN)`. Every predicate is testable by vitest (`skills/src`) or pytest (`tests/`). Provisional defaults in SPEC.md are replaced by the Refine answers in QUESTIONS.md.

## Reconciliations and flags

These points differ between SPEC.md, TASKS.md and the answered questions. The properties below follow the QUESTIONS.md answer in each case; the task text must be reconciled before GREEN.

- Q4(c) versus DAT-14 and SPEC R8.4: Q4(c) maps literal `haiku`/`sonnet`/`opus` to `fast`/`balanced`/`deep` and fails every other id outside the models map with `runtime_model_unknown: <id>`. SPEC R8.4 and the DAT-14 acceptance criteria say such ids are treated as `fast`. Properties SAFETY-011 and INVARIANT-035 follow Q4(c). DAT-14, DAT-2 and DAT-3 (which pass the literal `haiku`) are affected.
- Q5 error names: the parser throws `runtime_block_missing` (DAT-10) while the CLI exits 2 with `runtime_config_missing` (Q5, DAT-19). They are two layers and stay distinct (BOUNDARY-004).
- Q9 mechanism: Q9 says the runner injects `agent_types: true` into the config and args each bundle reads. TASKS research shows `datum-go` ignores `args.agentTypes` and reads the config through the boot batch, so DAT-16 uses a `globalThis.datumRuntime = { agentTypes: true }` override honoured by `readAgentTypeConfig` and `configureAgentTypes`. The observable behaviour is identical (every bundle, nested children included, yields `agentType: 'datum-cli'` for `stageOpts('cli')`; `hooks_installed` unchanged), and the properties assert behaviour, not the mechanism.
- Q9 grep extension: the R2 acceptance grep covers `runCommandPrompt|contextInlineRetryPrompt|batchCommandPrompt` outside `shared/batch.ts`, `shared/agents.ts` and tests (INVARIANT-014). SPEC R2.4 lets `boot.ts`, `context-relay.ts` and `agents.ts` keep the definitions of the other two names; DAT-9 additionally removes `contextInlineRetryPrompt` entirely.
- DAT-17 shell timeout: the acceptance criterion says a script over `timeoutMs` rejects with 'timeout'; the research note suggests resolving with `exit_code: 124`. LIVENESS-007 accepts either as long as the failure text names the timeout and `runBatch` maps it to a named `scriptError`.
- DAT-17 fixture and Q8: the fixture may not import `batchScript` or `parseBatchResult`, so the test computes `batchScript(steps)` for a one-step `echo fixture-shell-ok` batch and passes it through `args`; the fixture parses the row with `JSON.parse`. The environment needs `bash`, `git` and `jq` on PATH (the batch wrapper fails with `batch_tool_missing` otherwise).
- DAT-13 unwritable directory: `chmod 0o500` does not block root, so the test either skips under root or simulates the failure with a file where the directory should be (SAFETY-015).
- DAT-20 jsonl-only runs: Q1 says the collector reads both sources. SPEC R7.5 keeps existing keys unchanged, so `total_*`, `per_phase` and per-model totals stay SQLite-derived; the jsonl-only case must be pinned by a test. Both the collected and the `no_state_available` outputs must carry the three new keys (BOUNDARY-014).
- DAT-3 behaviour change: dropping `resilientAgent` around the dep-merge call removes its retry on a thrown or null `agent()` result. SAFETY-023 requires the behaviour to be explicit and pinned.
- DAT-7 and DAT-8 model change: `runBatch` re-routes scripts over `LARGE_BATCH_BYTES` to the balanced model, which the old direct `agent()` call did not do. COMPATIBILITY-003 requires the outcome to be pinned.
- Task coverage: every task DAT-1 to DAT-20 has at least one property. No task is flagged as untestable.

## Property List

### SAFETY

PROPERTY(SAFETY-001): With a shell present (deps.shell or globalThis.shell), runBatch calls agentFn 0 times and never builds batchCommandPrompt; a 3-row JSON array on stdout yields exactly 3 parsed steps.
PROPERTY(SAFETY-002): A shell that rejects with Error('boom') makes runBatch return missing:true with scriptError starting 'batch_shell_threw: boom'; the shell is called exactly once (no retry) and agentFn 0 times.
PROPERTY(SAFETY-003): A shell returning exit_code 3, unparseable stdout and 500 chars of stderr makes runBatch return missing:true with scriptError exactly 'batch_shell_exit_3: ' + first 200 chars of stderr; agentFn 0 times and the shell is called once.
PROPERTY(SAFETY-004): In shell mode runBatch never retries: an exit-0 unparseable or empty stdout, and a successful exit whose rows contain a __script batch_root_missing or batch_tool_missing row, return the parsed missing result with the shell called exactly once (pinned by test).
PROPERTY(SAFETY-005): agent() with opts.agentType === 'datum-cli' rejects with an Error whose message starts 'cli_call_bypassed_runbatch' and contains opts.label; the executor receives 0 requests and 0 metrics lines are written for it.
PROPERTY(SAFETY-006): The datum-cli guard runs before the semaphore is touched: after a rejected datum-cli call the model's semaphore has no held slot and no queued waiter.
PROPERTY(SAFETY-007): workflow({ name }) with the name in no searched directory rejects with an Error whose message starts 'workflow_not_found: <name>' and contains every searched directory; no executor request and no metrics line results.
PROPERTY(SAFETY-008): A schema-invalid reply on the deep tier is never retried: exactly one request is recorded and agent() returns null.
PROPERTY(SAFETY-009): A tier-up retry request never uses the same model id as the request it replaces; when the next tier resolves to the same model id the retry is skipped and agent() returns null.
PROPERTY(SAFETY-010): A second schema-invalid (or unparseable) reply after the tier-up retry returns null; there is no third request.
PROPERTY(SAFETY-011): A literal model id that is not a tier id, not in the models map and not haiku/sonnet/opus fails by name 'runtime_model_unknown: <id>' (Q4c); no silent fallback to fast or to the next defined tier.
PROPERTY(SAFETY-012): readRuntimeConfig throws instead of inventing values: unknown kind gives 'runtime_kind_unknown: <v>', a missing tier gives 'runtime_models_missing: <tier>', a bad concurrency gives 'runtime_concurrency_invalid: <modelId>', no runtime block gives 'runtime_block_missing'.
PROPERTY(SAFETY-013): A throwing executor always releases its semaphore slot (try/finally): after an executor throws on concurrency 1, the next queued request for that model starts.
PROPERTY(SAFETY-014): An executor that throws Error('down') produces one metrics line with outcome 'error' and agent() rejects with that same error ('down').
PROPERTY(SAFETY-015): An unwritable metrics directory makes agent() reject with the filesystem error; metrics are never silently dropped (test skips or simulates the failure when running as root).
PROPERTY(SAFETY-016): runBundle removes globalThis.datumRuntime when the bundle settles, on resolve and on reject, and restores the previous value (not delete) when re-entered by a nested bundle.
PROPERTY(SAFETY-017): The runner source (skills/src/runtime) contains no assignment to Math.random and no call to it.
PROPERTY(SAFETY-018): a grep over skills/src/runtime/*.ts for the tokens fetch(, http and net. excluding tests and fixtures is empty, including shell.ts and the runner main added in DAT-18.
PROPERTY(SAFETY-019): Every exit-2 cause (bundle not found in either directory, args file missing, args file not JSON, no runtime block 'runtime_config_missing', unknown kind, kind pi 'runtime_kind_unavailable: pi') is detected in Python before node is spawned: the stub runner is invoked 0 times.
PROPERTY(SAFETY-020): A missing node binary (FileNotFoundError) yields exit 1 with a named message on stderr, not exit 0 and not exit 2.
PROPERTY(SAFETY-021): A malformed metrics.jsonl line makes the collector exit non-zero with a message containing 'line N' (1-based), and neither closeout-raw/token_metrics.json nor the .collect-token-metrics.done marker is written by that run.
PROPERTY(SAFETY-022): A preflight step with a non-zero exit_code still produces the same halt and the same log message as before the conversion (the gitignore-check step is tolerant so its JSON stdout is still read).
PROPERTY(SAFETY-023): The dep-merge conversion does not make a thrown or null agent result silently pass: the dep-merge call either surfaces the error or returns a missing BatchResult, and the choice is pinned by a test.

### LIVENESS

PROPERTY(LIVENESS-001): runBundle resolves with the bundle's top-level return value for a bundle containing 'export const meta = {...}' and a top-level 'return 42'.
PROPERTY(LIVENESS-002): parallel([ok1, reject, ok2]) starts all three thunks before awaiting any (a synchronously throwing thunk also maps to null) and resolves to [x, null, y].
PROPERTY(LIVENESS-003): pipeline(items, ...stages) settles for every item with its final value or null; a rejecting stage never aborts the other items (Q2).
PROPERTY(LIVENESS-004): With concurrency { m1: 2 } and 5 held requests for m1, all 5 eventually finish once released, 2 in flight at a time.
PROPERTY(LIVENESS-005): A schema-invalid fast-tier reply followed by a valid balanced-tier reply makes agent() resolve with the valid parsed value after exactly two requests.
PROPERTY(LIVENESS-006): After DAT-15, workflow() no longer rejects with 'workflow_not_implemented'; a resolvable child runs and its return value resolves the parent's await.
PROPERTY(LIVENESS-007): nodeShell kills a script that exceeds timeoutMs and settles within a bounded time, surfacing a failure whose text contains 'timeout' (rejection or exit_code 124 with a stderr naming the timeout; runBatch maps either to a named scriptError).
PROPERTY(LIVENESS-008): main(argv, io) on a bundle returning { ok: 1 } writes exactly '{"ok":1}' to stdout and returns exit code 0.
PROPERTY(LIVENESS-009): With a stub runner printing '{"r":1}', 'datum workflow run fixture --args a.json' prints {"r":1} on stdout and exits 0.
PROPERTY(LIVENESS-010): Given a valid metrics.jsonl, the collector exits 0 and writes per_agent_type, per_stage and cached_share to closeout-raw/token_metrics.json and the done marker.

### INVARIANT

PROPERTY(INVARIANT-001): runBatch calls the shell exactly once per attempt with script === batchScript(steps), opts.cwd === getBatchRoot() and opts.timeoutMs === 600000.
PROPERTY(INVARIANT-002): getBatchRoot() returns the value last passed to setBatchRoot ('/x/repo' after setBatchRoot('/x/repo')).
PROPERTY(INVARIANT-003): sandbox.d.ts declares the optional global shell?(script, { cwd, timeoutMs }) returning Promise<{ exit_code, stdout, stderr }> and 'npx tsc -p skills/tsconfig.json' exits 0 after every task that edits skills/src.
PROPERTY(INVARIANT-004): readRuntimeConfig({ runtime: { kind: 'fake', models: { fast: 'f', balanced: 'b', deep: 'd' } } }) returns exactly { kind: 'fake', models, concurrency: {}, priority: 'batch', client: 'datum' }; explicit priority 'interactive' and client 'x' are returned unchanged.
PROPERTY(INVARIANT-005): concurrencyFor(rc, id) returns the configured positive integer for a listed model and 1 for an unlisted model, without mutating rc.
PROPERTY(INVARIANT-006): verifyCommitIndependently and the resilientAgent retry-guard call runBatch (the source slice of verifyCommitIndependently contains 'runBatch(' and no 'batchCommandPrompt('); the guard keeps label 'retry-guard' and model 'haiku' and passes { agentFn, logFn }.
PROPERTY(INVARIANT-007): CONTEXT_INLINE_RETRY_MARKER equals the exact string "# attempt 2 of 2 — the previous runner returned one of these files with bytes missing; copy the script's output verbatim, every byte", and contextInlineRetryPrompt is rebuilt on it.
PROPERTY(INVARIANT-008): datum-tdd-act-lane.ts dispatches 'runBatch(depMergeStepList' with label `dep-merge:${taskId}` and model 'haiku', returns a BatchResult directly (no second parseBatchResult), and contains no batchCommandPrompt( call or import.
PROPERTY(INVARIANT-009): datum-go.ts contains no batchCommandPrompt( or runCommandPrompt( call or import; act-start is 'runBatch(actStart' with its original label; preflight-tool-check and preflight-gitignore are runBatch calls over one-element BatchStep arrays whose command string is the one runCommandPrompt received before.
PROPERTY(INVARIANT-010): datum-tdd-act.ts, datum-tdd-act-setup.ts and datum-tdd-act-merge.ts dispatch runBatch(actStart / runBatch(steps with their original labels and contain no batchCommandPrompt( call or import; datum-tdd-act-docs.ts no longer imports it.
PROPERTY(INVARIANT-011): datum-validate.ts dispatches runBatch(verifySteps and datum-closeout.ts dispatches runBatch(collectSteps and runBatch(archiveSteps; none of datum-validate.ts, datum-closeout.ts, datum-review.ts references batchCommandPrompt.
PROPERTY(INVARIANT-012): datum-plan.ts has no contextInlineRetryPrompt( call or import; both retry sites call runBatch with label 'read-context-files:retry', model model('fast'), retryMarker CONTEXT_INLINE_RETRY_MARKER, the :82 site keeping bootstrapOpts('cli') and the :143 site stageOpts('cli'), and the result still feeds mergeRelayRetry.
PROPERTY(INVARIANT-013): datum-properties.ts and datum-refine.ts have no contextInlineRetryPrompt( call or import; each calls runBatch(inlineSteps, ...) with label 'read-context-files:retry', model model('fast') and CONTEXT_INLINE_RETRY_MARKER and still merges with mergeRelayRetry.
PROPERTY(INVARIANT-014): A recursive scan of non-test skills/src/**/*.ts finds batchCommandPrompt only in shared/batch.ts and shared/agents.ts, runCommandPrompt only in boot.ts, context-relay.ts and agents.ts, and contextInlineRetryPrompt nowhere (comments included); tracker.ts no longer imports batchCommandPrompt.
PROPERTY(INVARIANT-015): context-relay.ts still exports CONTEXT_INLINE_RETRY_MARKER and the rewritten context-relay.test.ts case asserts the marker text; agent-types-ordering.test.ts pins runBatch( as the first batch dispatch with no batchCommandPrompt fallback.
PROPERTY(INVARIANT-016): Inside a bundle typeof agent, parallel, pipeline, phase, log, workflow and shell is 'function' and typeof args and budget is 'object'.
PROPERTY(INVARIANT-017): phase('p') and log('l') each call opts.log exactly once per call; budget.total === null, budget.remaining() === null while total is null.
PROPERTY(INVARIANT-018): budget.spent() equals the sum of prompt_tokens + completion_tokens over all recorded replies (0 when usage is absent).
PROPERTY(INVARIANT-019): agent(prompt, { model: 'fast-id', label: 'x' }) sends a StageRequest with model equal to the resolved tier id, the prompt unchanged and opts.label 'x', and returns parseAgentJson(reply.text); without opts.schema the parsed value is returned unvalidated.
PROPERTY(INVARIANT-020): runBundle feeds the runtime models triple to setModelTiers before the bundle runs.
PROPERTY(INVARIANT-021): FakeExecutor answers with the first script entry whose labelPrefix prefixes req.opts.label, else the default reply, and records every request in call order with startedAt <= endedAt.
PROPERTY(INVARIANT-022): FakeExecutor.hold('h') followed by 3 'h...' requests shows 3 recorded starts and 0 ends; release('h') then shows 3 ends.
PROPERTY(INVARIANT-023): Only a leading 'export ' on 'export const meta' is stripped (anchored regex); a string literal elsewhere in the bundle containing 'export const meta' is left intact.
PROPERTY(INVARIANT-024): In-flight requests per model never exceed concurrency[model] (default 1), asserted over 50 queued requests via FakeExecutor timestamps.
PROPERTY(INVARIANT-025): The semaphore key is the resolved model id, so two tiers that share a model id share one semaphore.
PROPERTY(INVARIANT-026): Every recorded StageRequest carries headers X-Client: <client> and X-Priority: <priority> (defaults 'datum' and 'batch'), including tier-up retries.
PROPERTY(INVARIANT-027): Every executed request appends exactly one JSON line whose keys are exactly ts, run_id, label, agent_type, model, prompt_tokens, completion_tokens, cached_tokens, prefill_ms, decode_ms, queue_wait_ms, wall_ms, attempt, outcome in that order; outcome is one of ok, invalid, error.
PROPERTY(INVARIANT-028): A reply with no usage and no timings writes 0 for prompt_tokens, completion_tokens, cached_tokens, prefill_ms and decode_ms.
PROPERTY(INVARIANT-029): deriveRunId(new Date(Date.UTC(2026,9,12,5,7,9))) === '20261012-050709'; the runs directory is created when absent.
PROPERTY(INVARIANT-030): attempt is numbered per label within the run: 1 for the first request of a label, 2 for the tier-up retry, kept in shared run state (Q6).
PROPERTY(INVARIANT-031): Fifty concurrent requests produce fifty complete, individually parseable JSON lines (synchronous append, no interleaving).
PROPERTY(INVARIANT-032): STAGE_RESULT_SCHEMA.required equals ['success','tests_pass','committed','read_witness','files_written','test_exit_code'], properties.files_written.type === 'array' and properties.test_exit_code.type === 'integer'; REFLECT_SCHEMA.required and SKEPTIC_SCHEMA.required still include read_witness.
PROPERTY(INVARIANT-033): validateAgainstSchema accepts readonly required arrays, reports every missing and every wrongly typed field, checks string, number, integer, boolean, array and object, rejects null for object, rejects 1.5 and '0' for integer, and accepts unknown type keywords.
PROPERTY(INVARIANT-034): A valid reply returns with no retry and exactly one metrics line with outcome 'ok' and attempt 1.
PROPERTY(INVARIANT-035): Current tier is resolved by looking up the request's model id: haiku/sonnet/opus map to fast/balanced/deep (Q4c); when tiers share an id the highest tier carrying it is current.
PROPERTY(INVARIANT-036): workflow({ scriptPath: p }) loads p regardless of skillsDirs; the child's return value resolves the parent's await.
PROPERTY(INVARIANT-037): workflow({ name }) resolves <dir>/<name>.js over skillsDirs in order and the first existing file wins.
PROPERTY(INVARIANT-038): With globalThis.datumRuntime = { agentTypes: true }, readAgentTypeConfig({ agent_types: false }).agentTypes === true and, after configureAgentTypes, stageOpts('cli', { label: 'x' }).agentType === 'datum-cli'.
PROPERTY(INVARIANT-039): fixture-go.js and fixture-child.js start with 'export const meta', use a top-level return, contain no import, and contain no literal 'datum ...' command string or banned prompt-helper name.
PROPERTY(INVARIANT-040): runBundle on fixture-go.js with FakeExecutor and nodeShell returns an object deep-equal to the expected parent result with the child result embedded, the literal 'fixture-shell-ok' from the shell step and null in the rejected thunk's slot.
PROPERTY(INVARIANT-041): FakeExecutor.requests.map(r => r.opts.label) equals the expected ordered label list and metrics.jsonl under the temp repo root has exactly one line per recorded request.
PROPERTY(INVARIANT-042): nodeShell('printf ok', { cwd, timeoutMs: 5000 }) resolves { exit_code: 0, stdout: 'ok', stderr: '' }.
PROPERTY(INVARIANT-043): bash scripts/build-workflows.sh produces skills/runtime/runner.js whose first line starts with '// @generated — DO NOT EDIT. Source: skills/src/', and the script's verify stage fails if that banner is missing; runner.js does not start with 'export const meta'.
PROPERTY(INVARIANT-044): The datum-* loop's meta/return post-processing and verify greps are not applied to runner.js (the runner bundle is built by a second esbuild call with --platform=node).
PROPERTY(INVARIANT-045): The workflow sub-app is registered in datum/cli.py with a wrapper under 15 lines and the logic in datum/workflow_run.py.
PROPERTY(INVARIANT-046): For metrics lines datum-red (prompt 100, completion 10, cached 40) and datum-green (prompt 0): per_agent_type['datum-red'] == {calls:1, prompt_tokens:100, completion_tokens:10, cached_tokens:40}, per_stage keys are label prefixes before the first ':', cached_share['datum-red'] == 0.4 and cached_share['datum-green'] == 0.0.
PROPERTY(INVARIANT-047): Lines with outcome 'invalid' or 'error' still count as calls and tokens; cached_share is computed from summed tokens, not a mean of per-call ratios.

### BOUNDARY

PROPERTY(BOUNDARY-001): concurrency values 0, 1.5, -2, '2', NaN and null each throw 'runtime_concurrency_invalid: <modelId>'; 1 and any larger integer are accepted.
PROPERTY(BOUNDARY-002): kind 'fake' and 'pi' are accepted by readRuntimeConfig; any other kind throws 'runtime_kind_unknown: <value>'; the parser never rejects 'pi'.
PROPERTY(BOUNDARY-003): A missing models.fast, models.balanced or models.deep throws 'runtime_models_missing: <tier>', checked in the order fast, balanced, deep.
PROPERTY(BOUNDARY-004): No runtime block is 'runtime_block_missing' from readRuntimeConfig and 'runtime_config_missing' (exit 2) from the CLI; the two names stay distinct.
PROPERTY(BOUNDARY-005): A stderr of 500 characters is truncated to exactly 200 characters in scriptError; a stderr shorter than 200 characters is included whole.
PROPERTY(BOUNDARY-006): With an empty batch root opts.cwd falls back to args.repoRoot (guarded by typeof args and a string check, so a string args or an undefined args does not throw), then to process.cwd().
PROPERTY(BOUNDARY-007): deps.shell takes precedence over globalThis.shell; when both are set only deps.shell is called.
PROPERTY(BOUNDARY-008): runId is args.runId only when it is a non-empty string; an empty string, a number or a missing value falls back to the derived YYYYMMDD-HHMMSS UTC id.
PROPERTY(BOUNDARY-009): Tier boundaries: fast retries on balanced, balanced retries on deep, deep never retries.
PROPERTY(BOUNDARY-010): With skillsDirs [dirA, dirB] both containing child.js, workflow({ name: 'child' }) runs dirA/child.js; a name present only in dirB runs dirB/child.js.
PROPERTY(BOUNDARY-011): Bundle lookup prefers .datum/skills/<name>.js over <skills_dir>/<name>.js; a name in neither is exit 2.
PROPERTY(BOUNDARY-012): A missing args file and a non-JSON args file each exit 2 with a message on stderr; an args file holding valid JSON of any type is passed through.
PROPERTY(BOUNDARY-013): prompt_tokens 0 gives cached_share 0.0; other shares are rounded to 4 decimals (40/100 gives 0.4).
PROPERTY(BOUNDARY-014): A missing metrics.jsonl gives per_agent_type == {}, per_stage == {} and cached_share == {} with exit 0, in both the collected and the no_state_available outputs.
PROPERTY(BOUNDARY-015): A datum-cli call with no label still rejects with a stable message ('cli_call_bypassed_runbatch: (no label)').

### IDEMPOTENT

PROPERTY(IDEMPOTENT-001): readRuntimeConfig and concurrencyFor are pure: calling them twice with the same input returns deep-equal results and never mutates the input object.
PROPERTY(IDEMPOTENT-002): Creating the runs directory is idempotent: mkdir recursive on an existing directory does not fail or truncate an existing metrics.jsonl.
PROPERTY(IDEMPOTENT-003): Running runBundle twice sequentially in one process gives independent results and leaves no residual globalThis.datumRuntime or agent-type state after either run.
PROPERTY(IDEMPOTENT-004): Running bash scripts/build-workflows.sh twice yields byte-identical skills/runtime/runner.js and datum-*.js bundles, and git diff --stat lists only bundles whose source changed.
PROPERTY(IDEMPOTENT-005): After all conversions, regenerated skills/datum-*.js carry the @generated banner, are produced only by the build script and none is edited by hand.
PROPERTY(IDEMPOTENT-006): Re-running the collector after a successful run is short-circuited by the .collect-token-metrics.done marker and leaves the output unchanged; the marker is written only at the end of a successful run.
PROPERTY(IDEMPOTENT-007): Calling runBatch with the same steps and a deterministic fake shell twice returns deep-equal BatchResults and each call invokes the shell exactly once.

### ORDERING

PROPERTY(ORDERING-001): parallel returns results in input order regardless of completion order.
PROPERTY(ORDERING-002): pipeline passes each item through the stages in order, each stage receiving the previous stage's result for that item, and skips later stages for an item whose stage rejected.
PROPERTY(ORDERING-003): With waiters [A1, B1, A2] and a finishing agentType A request, start order is A1, A2, B1; with no waiter of the finished agentType the earliest-arrived waiter starts next.
PROPERTY(ORDERING-004): The slot is handed directly to the chosen waiter (no decrement then increment), so a new arrival cannot steal it between release and waiter wake-up.
PROPERTY(ORDERING-005): In every datum-*.ts bundle setBatchCacheKey( and setBatchRoot( precede the first runBatch( call.
PROPERTY(ORDERING-006): Conversion order: retryMarker and CONTEXT_INLINE_RETRY_MARKER exist (DAT-2) before DAT-7 and DAT-8 use them, and contextInlineRetryPrompt is removed (DAT-9) only after DAT-7 and DAT-8 have no callers.
PROPERTY(ORDERING-007): The agent() datum-cli guard is only live once DAT-9's scan passes: no datum-*.ts source reaches agent() with a datum-cli stage kind.
PROPERTY(ORDERING-008): For a tier-up the 'invalid' metrics line (attempt 1) is written before the retry request starts, and the retry's line has attempt 2.
PROPERTY(ORDERING-009): Directory search order is .datum/skills first, then the configured skills_dir, both in runBundle's skillsDirs and in the Python bundle lookup.
PROPERTY(ORDERING-010): FakeExecutor.requests are in call order with startedAt non-decreasing across requests that start sequentially.
PROPERTY(ORDERING-011): Within runBatch the shell branch runs before batchCommandPrompt, the LARGE_BATCH_BYTES model re-route and the retry chain: with a shell present none of those runs.

### ISOLATION

PROPERTY(ISOLATION-001): Nested children share the parent's semaphore map, metrics sink and run id (Q3): with concurrency { m1: 1 } a parent request and a child request on m1 never overlap, and child requests are appended to the same metrics.jsonl.
PROPERTY(ISOLATION-002): The child's args global is exactly the object passed to workflow(); parent args do not leak in and a child args.runId does not fork the metrics file.
PROPERTY(ISOLATION-003): Without the override, readAgentTypeConfig({ agent_types: false }).agentTypes === false (hosted path unchanged) and the existing agent-types.test.ts passes.
PROPERTY(ISOLATION-004): The override forces agentTypes only; hooks_installed and deterministicChecks() are unchanged from the configured value.
PROPERTY(ISOLATION-005): The runner's stdout carries only the JSON result; log output (phase and log lines) goes to stderr so 'datum workflow run' can parse stdout.
PROPERTY(ISOLATION-006): FakeExecutor replies depend only on the script and the request label; two identical runs return identical replies.
PROPERTY(ISOLATION-007): Semaphore state is per runBundle run: two sequential runs with different concurrency maps do not share waiters or in-flight counts.
PROPERTY(ISOLATION-008): Tests that install globalThis.shell remove it afterwards (afterEach/finally) so the hosted-path no-shell tests are unaffected by test order.

### SECURITY

PROPERTY(SECURITY-001): Subprocesses are spawned with an argument vector only: nodeShell uses spawn('bash', ['-c', script]) and datum/workflow_run.py uses subprocess with a list argv; no shell=True, os.system or eval appears in new code, and the Python spawn has an explicit timeout.
PROPERTY(SECURITY-002): metrics.jsonl contains only labels, counts and timings: neither the prompt text nor the reply text appears anywhere in the file.
PROPERTY(SECURITY-003): No HTTP client or network call exists in skills/src/runtime; the only executor shipped is FakeExecutor.
PROPERTY(SECURITY-004): kind 'pi' fails closed: the CLI exits 2 with 'runtime_kind_unavailable: pi' and never starts a runner or falls back to kind 'fake'.
PROPERTY(SECURITY-005): Shell commands for datum-cli steps run only through the shell seam: any attempt to route one through an LLM agent() call is rejected by name before reaching the executor.
PROPERTY(SECURITY-006): The shell call timeout is always BATCH_TOOL_TIMEOUT_MS (600000) so an unbounded subprocess cannot be started through runBatch.

### PERFORMANCE

PROPERTY(PERFORMANCE-001): Semaphore bookkeeping for 1,000 queued requests against FakeExecutor has mean overhead under 5 ms per request.
PROPERTY(PERFORMANCE-002): runBatch passes timeoutMs 600000 to the shell and nodeShell enforces whatever timeoutMs it receives (a 5000 ms limit kills a longer script).
PROPERTY(PERFORMANCE-003): Every new file under skills/src/runtime stays under 500 lines (runner.ts, which several tasks extend, is checked after the last of them).
PROPERTY(PERFORMANCE-004): The datum/cli.py addition is under 15 lines.
PROPERTY(PERFORMANCE-005): The collector streams metrics.jsonl line by line and its cost is linear in the number of lines (no per-line file rewrite).

### OBSERVABILITY

PROPERTY(OBSERVABILITY-001): An invalid reply logs through opts.log exactly 'stage_output_invalid: <label>: <missing or wrong fields>' once per invalid reply and writes a metrics line with outcome 'invalid'.
PROPERTY(OBSERVABILITY-002): When no distinct higher tier exists the log line is 'stage_output_invalid: <label>: no distinct higher tier' and one 'invalid' line is written.
PROPERTY(OBSERVABILITY-003): queue_wait_ms is greater than 0 for a request held behind another on concurrency 1, and wall_ms is measured from semaphore acquisition to reply.
PROPERTY(OBSERVABILITY-004): An executor error writes a metrics line with outcome 'error'.
PROPERTY(OBSERVABILITY-005): Every new error follows the 'code: detail' form (batch_shell_threw, batch_shell_exit_<code>, runtime_kind_unknown, runtime_models_missing, runtime_concurrency_invalid, runtime_model_unknown, workflow_not_found, cli_call_bypassed_runbatch, runtime_kind_unavailable, runtime_config_missing).
PROPERTY(OBSERVABILITY-006): A bundle that throws Error('bad') makes main return 1 with 'bad' on stderr and the CLI exit 1 passing 'bad' through on stderr.
PROPERTY(OBSERVABILITY-007): per_agent_type and per_stage report calls, prompt_tokens, completion_tokens and cached_tokens so cached share per agent type can be audited from token_metrics.json.
PROPERTY(OBSERVABILITY-008): The cli_call_bypassed_runbatch message contains the offending label so the leaking call site is identifiable.

### COMPATIBILITY

PROPERTY(COMPATIBILITY-001): With no deps.shell and no globalThis.shell, runBatch sends agentFn the same prompt text as before (batchCommandPrompt(steps)), and the existing agents.test.ts retry-path tests pass with only the named source-text pins edited.
PROPERTY(COMPATIBILITY-002): runBatch(steps, { retryMarker: CONTEXT_INLINE_RETRY_MARKER }) without a shell sends a prompt byte-equal to the pre-change contextInlineRetryPrompt(steps); with a shell present retryMarker is ignored, and retryMarker is stripped from the opts passed to agentFn.
PROPERTY(COMPATIBILITY-003): Hosted-path model for the read-context-files:retry call is decided explicitly: scripts over LARGE_BATCH_BYTES are re-routed by runBatch to balanced, and that change (or an explicit model('balanced')) is pinned by a test rather than occurring silently.
PROPERTY(COMPATIBILITY-004): The existing datum-tdd-act-lane test.ts, calls.test.ts and integration.test.ts pass after the dep-merge conversion, and describeFailure/stepResult handling of the dep-merge result is unchanged.
PROPERTY(COMPATIBILITY-005): The existing datum-go.test.ts, datum-tdd-act.test.ts, datum-tdd-act-merge.test.ts, datum-validate.test.ts and datum-closeout.test.ts pass after conversion, with main-sync-steps.test.ts updated to forbid any batchCommandPrompt( call in datum-validate.ts.
PROPERTY(COMPATIBILITY-006): The renamed pins in datum-plan.test.ts, datum-properties.test.ts and datum-refine.test.ts pass against the new runBatch form and fail against the old source.
PROPERTY(COMPATIBILITY-007): 'npx vitest run skills/src' passes except the known zsh failure in batch.test.ts, including lane tests that use STAGE_RESULT_SCHEMA with the two new required fields.
PROPERTY(COMPATIBILITY-008): assertReadWitness behaviour on the hosted path is unchanged and schemas.test.ts still pins read_witness on exactly the three schemas.
PROPERTY(COMPATIBILITY-009): Hosted behaviour of stageOpts, readAgentTypeConfig and configureAgentTypes without globalThis.datumRuntime is unchanged.
PROPERTY(COMPATIBILITY-010): Existing datum-*.js bundles are byte-identical apart from changes in their own sources after the second esbuild call is added; package.json dependencies are unchanged.
PROPERTY(COMPATIBILITY-011): tests/test_cli_flag_contract.py passes unchanged, and pyproject.toml dependencies are unchanged.
PROPERTY(COMPATIBILITY-012): Existing keys per_phase, per-model totals and the no_state_available status are unchanged, and tests/test_closeout_collectors.py and tests/test_closeout_cli.py pass unchanged.
PROPERTY(COMPATIBILITY-013): No new runtime dependency is added for the subprocess shell or fixtures (node:child_process only).

## Traceability Table

| Property ID | Category | Predicate | Task IDs |
|---|---|---|---|
| SAFETY-001 | SAFETY | With a shell present (deps.shell or globalThis.shell), runBatch calls agentFn 0 times and never builds batchCommandPrompt; a 3-row JSON array on stdout yields exactly 3 parsed steps. | DAT-1 |
| SAFETY-002 | SAFETY | A shell that rejects with Error('boom') makes runBatch return missing:true with scriptError starting 'batch_shell_threw: boom'; the shell is called exactly once (no retry) and agentFn 0 times. | DAT-1 |
| SAFETY-003 | SAFETY | A shell returning exit_code 3, unparseable stdout and 500 chars of stderr makes runBatch return missing:true with scriptError exactly 'batch_shell_exit_3: ' + first 200 chars of stderr; agentFn 0 times and the shell is called once. | DAT-1 |
| SAFETY-004 | SAFETY | In shell mode runBatch never retries: an exit-0 unparseable or empty stdout, and a successful exit whose rows contain a __script batch_root_missing or batch_tool_missing row, return the parsed missing result with the shell called exactly once (pinned by test). | DAT-1 |
| SAFETY-005 | SAFETY | agent() with opts.agentType === 'datum-cli' rejects with an Error whose message starts 'cli_call_bypassed_runbatch' and contains opts.label; the executor receives 0 requests and 0 metrics lines are written for it. | DAT-16, DAT-17 |
| SAFETY-006 | SAFETY | The datum-cli guard runs before the semaphore is touched: after a rejected datum-cli call the model's semaphore has no held slot and no queued waiter. | DAT-16 |
| SAFETY-007 | SAFETY | workflow({ name }) with the name in no searched directory rejects with an Error whose message starts 'workflow_not_found: <name>' and contains every searched directory; no executor request and no metrics line results. | DAT-15, DAT-17 |
| SAFETY-008 | SAFETY | A schema-invalid reply on the deep tier is never retried: exactly one request is recorded and agent() returns null. | DAT-14, DAT-17 |
| SAFETY-009 | SAFETY | A tier-up retry request never uses the same model id as the request it replaces; when the next tier resolves to the same model id the retry is skipped and agent() returns null. | DAT-14 |
| SAFETY-010 | SAFETY | A second schema-invalid (or unparseable) reply after the tier-up retry returns null; there is no third request. | DAT-14 |
| SAFETY-011 | SAFETY | A literal model id that is not a tier id, not in the models map and not haiku/sonnet/opus fails by name 'runtime_model_unknown: <id>' (Q4c); no silent fallback to fast or to the next defined tier. | DAT-10, DAT-14 |
| SAFETY-012 | SAFETY | readRuntimeConfig throws instead of inventing values: unknown kind gives 'runtime_kind_unknown: <v>', a missing tier gives 'runtime_models_missing: <tier>', a bad concurrency gives 'runtime_concurrency_invalid: <modelId>', no runtime block gives 'runtime_block_missing'. | DAT-10 |
| SAFETY-013 | SAFETY | A throwing executor always releases its semaphore slot (try/finally): after an executor throws on concurrency 1, the next queued request for that model starts. | DAT-12, DAT-13 |
| SAFETY-014 | SAFETY | An executor that throws Error('down') produces one metrics line with outcome 'error' and agent() rejects with that same error ('down'). | DAT-13 |
| SAFETY-015 | SAFETY | An unwritable metrics directory makes agent() reject with the filesystem error; metrics are never silently dropped (test skips or simulates the failure when running as root). | DAT-13 |
| SAFETY-016 | SAFETY | runBundle removes globalThis.datumRuntime when the bundle settles, on resolve and on reject, and restores the previous value (not delete) when re-entered by a nested bundle. | DAT-16 |
| SAFETY-017 | SAFETY | The runner source (skills/src/runtime) contains no assignment to Math.random and no call to it. | DAT-11 |
| SAFETY-018 | SAFETY | a grep over skills/src/runtime/*.ts for the tokens fetch(, http and net. excluding tests and fixtures is empty, including shell.ts and the runner main added in DAT-18. | DAT-11, DAT-17, DAT-18 |
| SAFETY-019 | SAFETY | Every exit-2 cause (bundle not found in either directory, args file missing, args file not JSON, no runtime block 'runtime_config_missing', unknown kind, kind pi 'runtime_kind_unavailable: pi') is detected in Python before node is spawned: the stub runner is invoked 0 times. | DAT-19 |
| SAFETY-020 | SAFETY | A missing node binary (FileNotFoundError) yields exit 1 with a named message on stderr, not exit 0 and not exit 2. | DAT-19 |
| SAFETY-021 | SAFETY | A malformed metrics.jsonl line makes the collector exit non-zero with a message containing 'line N' (1-based), and neither closeout-raw/token_metrics.json nor the .collect-token-metrics.done marker is written by that run. | DAT-20 |
| SAFETY-022 | SAFETY | A preflight step with a non-zero exit_code still produces the same halt and the same log message as before the conversion (the gitignore-check step is tolerant so its JSON stdout is still read). | DAT-4 |
| SAFETY-023 | SAFETY | The dep-merge conversion does not make a thrown or null agent result silently pass: the dep-merge call either surfaces the error or returns a missing BatchResult, and the choice is pinned by a test. | DAT-3 |
| LIVENESS-001 | LIVENESS | runBundle resolves with the bundle's top-level return value for a bundle containing 'export const meta = {...}' and a top-level 'return 42'. | DAT-11, DAT-17 |
| LIVENESS-002 | LIVENESS | parallel([ok1, reject, ok2]) starts all three thunks before awaiting any (a synchronously throwing thunk also maps to null) and resolves to [x, null, y]. | DAT-11 |
| LIVENESS-003 | LIVENESS | pipeline(items, ...stages) settles for every item with its final value or null; a rejecting stage never aborts the other items (Q2). | DAT-11 |
| LIVENESS-004 | LIVENESS | With concurrency { m1: 2 } and 5 held requests for m1, all 5 eventually finish once released, 2 in flight at a time. | DAT-12 |
| LIVENESS-005 | LIVENESS | A schema-invalid fast-tier reply followed by a valid balanced-tier reply makes agent() resolve with the valid parsed value after exactly two requests. | DAT-14, DAT-17 |
| LIVENESS-006 | LIVENESS | After DAT-15, workflow() no longer rejects with 'workflow_not_implemented'; a resolvable child runs and its return value resolves the parent's await. | DAT-15 |
| LIVENESS-007 | LIVENESS | nodeShell kills a script that exceeds timeoutMs and settles within a bounded time, surfacing a failure whose text contains 'timeout' (rejection or exit_code 124 with a stderr naming the timeout; runBatch maps either to a named scriptError). | DAT-17 |
| LIVENESS-008 | LIVENESS | main(argv, io) on a bundle returning { ok: 1 } writes exactly '{"ok":1}' to stdout and returns exit code 0. | DAT-18 |
| LIVENESS-009 | LIVENESS | With a stub runner printing '{"r":1}', 'datum workflow run fixture --args a.json' prints {"r":1} on stdout and exits 0. | DAT-19 |
| LIVENESS-010 | LIVENESS | Given a valid metrics.jsonl, the collector exits 0 and writes per_agent_type, per_stage and cached_share to closeout-raw/token_metrics.json and the done marker. | DAT-20 |
| INVARIANT-001 | INVARIANT | runBatch calls the shell exactly once per attempt with script === batchScript(steps), opts.cwd === getBatchRoot() and opts.timeoutMs === 600000. | DAT-1 |
| INVARIANT-002 | INVARIANT | getBatchRoot() returns the value last passed to setBatchRoot ('/x/repo' after setBatchRoot('/x/repo')). | DAT-1 |
| INVARIANT-003 | INVARIANT | sandbox.d.ts declares the optional global shell?(script, { cwd, timeoutMs }) returning Promise<{ exit_code, stdout, stderr }> and 'npx tsc -p skills/tsconfig.json' exits 0 after every task that edits skills/src. | DAT-1 |
| INVARIANT-004 | INVARIANT | readRuntimeConfig({ runtime: { kind: 'fake', models: { fast: 'f', balanced: 'b', deep: 'd' } } }) returns exactly { kind: 'fake', models, concurrency: {}, priority: 'batch', client: 'datum' }; explicit priority 'interactive' and client 'x' are returned unchanged. | DAT-10 |
| INVARIANT-005 | INVARIANT | concurrencyFor(rc, id) returns the configured positive integer for a listed model and 1 for an unlisted model, without mutating rc. | DAT-10 |
| INVARIANT-006 | INVARIANT | verifyCommitIndependently and the resilientAgent retry-guard call runBatch (the source slice of verifyCommitIndependently contains 'runBatch(' and no 'batchCommandPrompt('); the guard keeps label 'retry-guard' and model 'haiku' and passes { agentFn, logFn }. | DAT-2 |
| INVARIANT-007 | INVARIANT | CONTEXT_INLINE_RETRY_MARKER equals the exact string "# attempt 2 of 2 — the previous runner returned one of these files with bytes missing; copy the script's output verbatim, every byte", and contextInlineRetryPrompt is rebuilt on it. | DAT-2 |
| INVARIANT-008 | INVARIANT | datum-tdd-act-lane.ts dispatches 'runBatch(depMergeStepList' with label `dep-merge:${taskId}` and model 'haiku', returns a BatchResult directly (no second parseBatchResult), and contains no batchCommandPrompt( call or import. | DAT-3 |
| INVARIANT-009 | INVARIANT | datum-go.ts contains no batchCommandPrompt( or runCommandPrompt( call or import; act-start is 'runBatch(actStart' with its original label; preflight-tool-check and preflight-gitignore are runBatch calls over one-element BatchStep arrays whose command string is the one runCommandPrompt received before. | DAT-4 |
| INVARIANT-010 | INVARIANT | datum-tdd-act.ts, datum-tdd-act-setup.ts and datum-tdd-act-merge.ts dispatch runBatch(actStart / runBatch(steps with their original labels and contain no batchCommandPrompt( call or import; datum-tdd-act-docs.ts no longer imports it. | DAT-5 |
| INVARIANT-011 | INVARIANT | datum-validate.ts dispatches runBatch(verifySteps and datum-closeout.ts dispatches runBatch(collectSteps and runBatch(archiveSteps; none of datum-validate.ts, datum-closeout.ts, datum-review.ts references batchCommandPrompt. | DAT-6 |
| INVARIANT-012 | INVARIANT | datum-plan.ts has no contextInlineRetryPrompt( call or import; both retry sites call runBatch with label 'read-context-files:retry', model model('fast'), retryMarker CONTEXT_INLINE_RETRY_MARKER, the :82 site keeping bootstrapOpts('cli') and the :143 site stageOpts('cli'), and the result still feeds mergeRelayRetry. | DAT-7 |
| INVARIANT-013 | INVARIANT | datum-properties.ts and datum-refine.ts have no contextInlineRetryPrompt( call or import; each calls runBatch(inlineSteps, ...) with label 'read-context-files:retry', model model('fast') and CONTEXT_INLINE_RETRY_MARKER and still merges with mergeRelayRetry. | DAT-8 |
| INVARIANT-014 | INVARIANT | A recursive scan of non-test skills/src/**/*.ts finds batchCommandPrompt only in shared/batch.ts and shared/agents.ts, runCommandPrompt only in boot.ts, context-relay.ts and agents.ts, and contextInlineRetryPrompt nowhere (comments included); tracker.ts no longer imports batchCommandPrompt. | DAT-9 |
| INVARIANT-015 | INVARIANT | context-relay.ts still exports CONTEXT_INLINE_RETRY_MARKER and the rewritten context-relay.test.ts case asserts the marker text; agent-types-ordering.test.ts pins runBatch( as the first batch dispatch with no batchCommandPrompt fallback. | DAT-9 |
| INVARIANT-016 | INVARIANT | Inside a bundle typeof agent, parallel, pipeline, phase, log, workflow and shell is 'function' and typeof args and budget is 'object'. | DAT-11 |
| INVARIANT-017 | INVARIANT | phase('p') and log('l') each call opts.log exactly once per call; budget.total === null, budget.remaining() === null while total is null. | DAT-11 |
| INVARIANT-018 | INVARIANT | budget.spent() equals the sum of prompt_tokens + completion_tokens over all recorded replies (0 when usage is absent). | DAT-11, DAT-13 |
| INVARIANT-019 | INVARIANT | agent(prompt, { model: 'fast-id', label: 'x' }) sends a StageRequest with model equal to the resolved tier id, the prompt unchanged and opts.label 'x', and returns parseAgentJson(reply.text); without opts.schema the parsed value is returned unvalidated. | DAT-11 |
| INVARIANT-020 | INVARIANT | runBundle feeds the runtime models triple to setModelTiers before the bundle runs. | DAT-11 |
| INVARIANT-021 | INVARIANT | FakeExecutor answers with the first script entry whose labelPrefix prefixes req.opts.label, else the default reply, and records every request in call order with startedAt <= endedAt. | DAT-11 |
| INVARIANT-022 | INVARIANT | FakeExecutor.hold('h') followed by 3 'h...' requests shows 3 recorded starts and 0 ends; release('h') then shows 3 ends. | DAT-11 |
| INVARIANT-023 | INVARIANT | Only a leading 'export ' on 'export const meta' is stripped (anchored regex); a string literal elsewhere in the bundle containing 'export const meta' is left intact. | DAT-11 |
| INVARIANT-024 | INVARIANT | In-flight requests per model never exceed concurrency[model] (default 1), asserted over 50 queued requests via FakeExecutor timestamps. | DAT-12 |
| INVARIANT-025 | INVARIANT | The semaphore key is the resolved model id, so two tiers that share a model id share one semaphore. | DAT-12 |
| INVARIANT-026 | INVARIANT | Every recorded StageRequest carries headers X-Client: <client> and X-Priority: <priority> (defaults 'datum' and 'batch'), including tier-up retries. | DAT-12 |
| INVARIANT-027 | INVARIANT | Every executed request appends exactly one JSON line whose keys are exactly ts, run_id, label, agent_type, model, prompt_tokens, completion_tokens, cached_tokens, prefill_ms, decode_ms, queue_wait_ms, wall_ms, attempt, outcome in that order; outcome is one of ok, invalid, error. | DAT-13 |
| INVARIANT-028 | INVARIANT | A reply with no usage and no timings writes 0 for prompt_tokens, completion_tokens, cached_tokens, prefill_ms and decode_ms. | DAT-13 |
| INVARIANT-029 | INVARIANT | deriveRunId(new Date(Date.UTC(2026,9,12,5,7,9))) === '20261012-050709'; the runs directory is created when absent. | DAT-13 |
| INVARIANT-030 | INVARIANT | attempt is numbered per label within the run: 1 for the first request of a label, 2 for the tier-up retry, kept in shared run state (Q6). | DAT-13, DAT-14 |
| INVARIANT-031 | INVARIANT | Fifty concurrent requests produce fifty complete, individually parseable JSON lines (synchronous append, no interleaving). | DAT-13 |
| INVARIANT-032 | INVARIANT | STAGE_RESULT_SCHEMA.required equals ['success','tests_pass','committed','read_witness','files_written','test_exit_code'], properties.files_written.type === 'array' and properties.test_exit_code.type === 'integer'; REFLECT_SCHEMA.required and SKEPTIC_SCHEMA.required still include read_witness. | DAT-14 |
| INVARIANT-033 | INVARIANT | validateAgainstSchema accepts readonly required arrays, reports every missing and every wrongly typed field, checks string, number, integer, boolean, array and object, rejects null for object, rejects 1.5 and '0' for integer, and accepts unknown type keywords. | DAT-14 |
| INVARIANT-034 | INVARIANT | A valid reply returns with no retry and exactly one metrics line with outcome 'ok' and attempt 1. | DAT-14 |
| INVARIANT-035 | INVARIANT | Current tier is resolved by looking up the request's model id: haiku/sonnet/opus map to fast/balanced/deep (Q4c); when tiers share an id the highest tier carrying it is current. | DAT-14 |
| INVARIANT-036 | INVARIANT | workflow({ scriptPath: p }) loads p regardless of skillsDirs; the child's return value resolves the parent's await. | DAT-15 |
| INVARIANT-037 | INVARIANT | workflow({ name }) resolves <dir>/<name>.js over skillsDirs in order and the first existing file wins. | DAT-15 |
| INVARIANT-038 | INVARIANT | With globalThis.datumRuntime = { agentTypes: true }, readAgentTypeConfig({ agent_types: false }).agentTypes === true and, after configureAgentTypes, stageOpts('cli', { label: 'x' }).agentType === 'datum-cli'. | DAT-16 |
| INVARIANT-039 | INVARIANT | fixture-go.js and fixture-child.js start with 'export const meta', use a top-level return, contain no import, and contain no literal 'datum ...' command string or banned prompt-helper name. | DAT-17 |
| INVARIANT-040 | INVARIANT | runBundle on fixture-go.js with FakeExecutor and nodeShell returns an object deep-equal to the expected parent result with the child result embedded, the literal 'fixture-shell-ok' from the shell step and null in the rejected thunk's slot. | DAT-17 |
| INVARIANT-041 | INVARIANT | FakeExecutor.requests.map(r => r.opts.label) equals the expected ordered label list and metrics.jsonl under the temp repo root has exactly one line per recorded request. | DAT-17 |
| INVARIANT-042 | INVARIANT | nodeShell('printf ok', { cwd, timeoutMs: 5000 }) resolves { exit_code: 0, stdout: 'ok', stderr: '' }. | DAT-17 |
| INVARIANT-043 | INVARIANT | bash scripts/build-workflows.sh produces skills/runtime/runner.js whose first line starts with '// @generated — DO NOT EDIT. Source: skills/src/', and the script's verify stage fails if that banner is missing; runner.js does not start with 'export const meta'. | DAT-18 |
| INVARIANT-044 | INVARIANT | The datum-* loop's meta/return post-processing and verify greps are not applied to runner.js (the runner bundle is built by a second esbuild call with --platform=node). | DAT-18 |
| INVARIANT-045 | INVARIANT | The workflow sub-app is registered in datum/cli.py with a wrapper under 15 lines and the logic in datum/workflow_run.py. | DAT-19 |
| INVARIANT-046 | INVARIANT | For metrics lines datum-red (prompt 100, completion 10, cached 40) and datum-green (prompt 0): per_agent_type['datum-red'] == {calls:1, prompt_tokens:100, completion_tokens:10, cached_tokens:40}, per_stage keys are label prefixes before the first ':', cached_share['datum-red'] == 0.4 and cached_share['datum-green'] == 0.0. | DAT-20 |
| INVARIANT-047 | INVARIANT | Lines with outcome 'invalid' or 'error' still count as calls and tokens; cached_share is computed from summed tokens, not a mean of per-call ratios. | DAT-20 |
| BOUNDARY-001 | BOUNDARY | concurrency values 0, 1.5, -2, '2', NaN and null each throw 'runtime_concurrency_invalid: <modelId>'; 1 and any larger integer are accepted. | DAT-10 |
| BOUNDARY-002 | BOUNDARY | kind 'fake' and 'pi' are accepted by readRuntimeConfig; any other kind throws 'runtime_kind_unknown: <value>'; the parser never rejects 'pi'. | DAT-10 |
| BOUNDARY-003 | BOUNDARY | A missing models.fast, models.balanced or models.deep throws 'runtime_models_missing: <tier>', checked in the order fast, balanced, deep. | DAT-10 |
| BOUNDARY-004 | BOUNDARY | No runtime block is 'runtime_block_missing' from readRuntimeConfig and 'runtime_config_missing' (exit 2) from the CLI; the two names stay distinct. | DAT-10, DAT-19 |
| BOUNDARY-005 | BOUNDARY | A stderr of 500 characters is truncated to exactly 200 characters in scriptError; a stderr shorter than 200 characters is included whole. | DAT-1 |
| BOUNDARY-006 | BOUNDARY | With an empty batch root opts.cwd falls back to args.repoRoot (guarded by typeof args and a string check, so a string args or an undefined args does not throw), then to process.cwd(). | DAT-1 |
| BOUNDARY-007 | BOUNDARY | deps.shell takes precedence over globalThis.shell; when both are set only deps.shell is called. | DAT-1 |
| BOUNDARY-008 | BOUNDARY | runId is args.runId only when it is a non-empty string; an empty string, a number or a missing value falls back to the derived YYYYMMDD-HHMMSS UTC id. | DAT-13 |
| BOUNDARY-009 | BOUNDARY | Tier boundaries: fast retries on balanced, balanced retries on deep, deep never retries. | DAT-14 |
| BOUNDARY-010 | BOUNDARY | With skillsDirs [dirA, dirB] both containing child.js, workflow({ name: 'child' }) runs dirA/child.js; a name present only in dirB runs dirB/child.js. | DAT-15 |
| BOUNDARY-011 | BOUNDARY | Bundle lookup prefers .datum/skills/<name>.js over <skills_dir>/<name>.js; a name in neither is exit 2. | DAT-19 |
| BOUNDARY-012 | BOUNDARY | A missing args file and a non-JSON args file each exit 2 with a message on stderr; an args file holding valid JSON of any type is passed through. | DAT-19 |
| BOUNDARY-013 | BOUNDARY | prompt_tokens 0 gives cached_share 0.0; other shares are rounded to 4 decimals (40/100 gives 0.4). | DAT-20 |
| BOUNDARY-014 | BOUNDARY | A missing metrics.jsonl gives per_agent_type == {}, per_stage == {} and cached_share == {} with exit 0, in both the collected and the no_state_available outputs. | DAT-20 |
| BOUNDARY-015 | BOUNDARY | A datum-cli call with no label still rejects with a stable message ('cli_call_bypassed_runbatch: (no label)'). | DAT-16 |
| IDEMPOTENT-001 | IDEMPOTENT | readRuntimeConfig and concurrencyFor are pure: calling them twice with the same input returns deep-equal results and never mutates the input object. | DAT-10 |
| IDEMPOTENT-002 | IDEMPOTENT | Creating the runs directory is idempotent: mkdir recursive on an existing directory does not fail or truncate an existing metrics.jsonl. | DAT-13 |
| IDEMPOTENT-003 | IDEMPOTENT | Running runBundle twice sequentially in one process gives independent results and leaves no residual globalThis.datumRuntime or agent-type state after either run. | DAT-16 |
| IDEMPOTENT-004 | IDEMPOTENT | Running bash scripts/build-workflows.sh twice yields byte-identical skills/runtime/runner.js and datum-*.js bundles, and git diff --stat lists only bundles whose source changed. | DAT-18 |
| IDEMPOTENT-005 | IDEMPOTENT | After all conversions, regenerated skills/datum-*.js carry the @generated banner, are produced only by the build script and none is edited by hand. | DAT-9 |
| IDEMPOTENT-006 | IDEMPOTENT | Re-running the collector after a successful run is short-circuited by the .collect-token-metrics.done marker and leaves the output unchanged; the marker is written only at the end of a successful run. | DAT-20 |
| IDEMPOTENT-007 | IDEMPOTENT | Calling runBatch with the same steps and a deterministic fake shell twice returns deep-equal BatchResults and each call invokes the shell exactly once. | DAT-1 |
| ORDERING-001 | ORDERING | parallel returns results in input order regardless of completion order. | DAT-11 |
| ORDERING-002 | ORDERING | pipeline passes each item through the stages in order, each stage receiving the previous stage's result for that item, and skips later stages for an item whose stage rejected. | DAT-11 |
| ORDERING-003 | ORDERING | With waiters [A1, B1, A2] and a finishing agentType A request, start order is A1, A2, B1; with no waiter of the finished agentType the earliest-arrived waiter starts next. | DAT-12 |
| ORDERING-004 | ORDERING | The slot is handed directly to the chosen waiter (no decrement then increment), so a new arrival cannot steal it between release and waiter wake-up. | DAT-12 |
| ORDERING-005 | ORDERING | In every datum-*.ts bundle setBatchCacheKey( and setBatchRoot( precede the first runBatch( call. | DAT-4, DAT-5, DAT-6, DAT-7, DAT-8, DAT-9 |
| ORDERING-006 | ORDERING | Conversion order: retryMarker and CONTEXT_INLINE_RETRY_MARKER exist (DAT-2) before DAT-7 and DAT-8 use them, and contextInlineRetryPrompt is removed (DAT-9) only after DAT-7 and DAT-8 have no callers. | DAT-2, DAT-7, DAT-8, DAT-9 |
| ORDERING-007 | ORDERING | The agent() datum-cli guard is only live once DAT-9's scan passes: no datum-*.ts source reaches agent() with a datum-cli stage kind. | DAT-9, DAT-16 |
| ORDERING-008 | ORDERING | For a tier-up the 'invalid' metrics line (attempt 1) is written before the retry request starts, and the retry's line has attempt 2. | DAT-14 |
| ORDERING-009 | ORDERING | Directory search order is .datum/skills first, then the configured skills_dir, both in runBundle's skillsDirs and in the Python bundle lookup. | DAT-15, DAT-19 |
| ORDERING-010 | ORDERING | FakeExecutor.requests are in call order with startedAt non-decreasing across requests that start sequentially. | DAT-11 |
| ORDERING-011 | ORDERING | Within runBatch the shell branch runs before batchCommandPrompt, the LARGE_BATCH_BYTES model re-route and the retry chain: with a shell present none of those runs. | DAT-1 |
| ISOLATION-001 | ISOLATION | Nested children share the parent's semaphore map, metrics sink and run id (Q3): with concurrency { m1: 1 } a parent request and a child request on m1 never overlap, and child requests are appended to the same metrics.jsonl. | DAT-15 |
| ISOLATION-002 | ISOLATION | The child's args global is exactly the object passed to workflow(); parent args do not leak in and a child args.runId does not fork the metrics file. | DAT-15 |
| ISOLATION-003 | ISOLATION | Without the override, readAgentTypeConfig({ agent_types: false }).agentTypes === false (hosted path unchanged) and the existing agent-types.test.ts passes. | DAT-16 |
| ISOLATION-004 | ISOLATION | The override forces agentTypes only; hooks_installed and deterministicChecks() are unchanged from the configured value. | DAT-16 |
| ISOLATION-005 | ISOLATION | The runner's stdout carries only the JSON result; log output (phase and log lines) goes to stderr so 'datum workflow run' can parse stdout. | DAT-18 |
| ISOLATION-006 | ISOLATION | FakeExecutor replies depend only on the script and the request label; two identical runs return identical replies. | DAT-11 |
| ISOLATION-007 | ISOLATION | Semaphore state is per runBundle run: two sequential runs with different concurrency maps do not share waiters or in-flight counts. | DAT-12 |
| ISOLATION-008 | ISOLATION | Tests that install globalThis.shell remove it afterwards (afterEach/finally) so the hosted-path no-shell tests are unaffected by test order. | DAT-1, DAT-2 |
| SECURITY-001 | SECURITY | Subprocesses are spawned with an argument vector only: nodeShell uses spawn('bash', ['-c', script]) and datum/workflow_run.py uses subprocess with a list argv; no shell=True, os.system or eval appears in new code, and the Python spawn has an explicit timeout. | DAT-17, DAT-19 |
| SECURITY-002 | SECURITY | metrics.jsonl contains only labels, counts and timings: neither the prompt text nor the reply text appears anywhere in the file. | DAT-13 |
| SECURITY-003 | SECURITY | No HTTP client or network call exists in skills/src/runtime; the only executor shipped is FakeExecutor. | DAT-11 |
| SECURITY-004 | SECURITY | kind 'pi' fails closed: the CLI exits 2 with 'runtime_kind_unavailable: pi' and never starts a runner or falls back to kind 'fake'. | DAT-19 |
| SECURITY-005 | SECURITY | Shell commands for datum-cli steps run only through the shell seam: any attempt to route one through an LLM agent() call is rejected by name before reaching the executor. | DAT-16 |
| SECURITY-006 | SECURITY | The shell call timeout is always BATCH_TOOL_TIMEOUT_MS (600000) so an unbounded subprocess cannot be started through runBatch. | DAT-1 |
| PERFORMANCE-001 | PERFORMANCE | Semaphore bookkeeping for 1,000 queued requests against FakeExecutor has mean overhead under 5 ms per request. | DAT-12 |
| PERFORMANCE-002 | PERFORMANCE | runBatch passes timeoutMs 600000 to the shell and nodeShell enforces whatever timeoutMs it receives (a 5000 ms limit kills a longer script). | DAT-1, DAT-17 |
| PERFORMANCE-003 | PERFORMANCE | Every new file under skills/src/runtime stays under 500 lines (runner.ts, which several tasks extend, is checked after the last of them). | DAT-11, DAT-12, DAT-13, DAT-14, DAT-15, DAT-16, DAT-17 |
| PERFORMANCE-004 | PERFORMANCE | The datum/cli.py addition is under 15 lines. | DAT-19 |
| PERFORMANCE-005 | PERFORMANCE | The collector streams metrics.jsonl line by line and its cost is linear in the number of lines (no per-line file rewrite). | DAT-20 |
| OBSERVABILITY-001 | OBSERVABILITY | An invalid reply logs through opts.log exactly 'stage_output_invalid: <label>: <missing or wrong fields>' once per invalid reply and writes a metrics line with outcome 'invalid'. | DAT-14 |
| OBSERVABILITY-002 | OBSERVABILITY | When no distinct higher tier exists the log line is 'stage_output_invalid: <label>: no distinct higher tier' and one 'invalid' line is written. | DAT-14 |
| OBSERVABILITY-003 | OBSERVABILITY | queue_wait_ms is greater than 0 for a request held behind another on concurrency 1, and wall_ms is measured from semaphore acquisition to reply. | DAT-13 |
| OBSERVABILITY-004 | OBSERVABILITY | An executor error writes a metrics line with outcome 'error'. | DAT-13 |
| OBSERVABILITY-005 | OBSERVABILITY | Every new error follows the 'code: detail' form (batch_shell_threw, batch_shell_exit_<code>, runtime_kind_unknown, runtime_models_missing, runtime_concurrency_invalid, runtime_model_unknown, workflow_not_found, cli_call_bypassed_runbatch, runtime_kind_unavailable, runtime_config_missing). | DAT-1, DAT-10, DAT-14, DAT-15, DAT-16, DAT-19 |
| OBSERVABILITY-006 | OBSERVABILITY | A bundle that throws Error('bad') makes main return 1 with 'bad' on stderr and the CLI exit 1 passing 'bad' through on stderr. | DAT-18, DAT-19 |
| OBSERVABILITY-007 | OBSERVABILITY | per_agent_type and per_stage report calls, prompt_tokens, completion_tokens and cached_tokens so cached share per agent type can be audited from token_metrics.json. | DAT-20 |
| OBSERVABILITY-008 | OBSERVABILITY | The cli_call_bypassed_runbatch message contains the offending label so the leaking call site is identifiable. | DAT-16 |
| COMPATIBILITY-001 | COMPATIBILITY | With no deps.shell and no globalThis.shell, runBatch sends agentFn the same prompt text as before (batchCommandPrompt(steps)), and the existing agents.test.ts retry-path tests pass with only the named source-text pins edited. | DAT-1, DAT-2 |
| COMPATIBILITY-002 | COMPATIBILITY | runBatch(steps, { retryMarker: CONTEXT_INLINE_RETRY_MARKER }) without a shell sends a prompt byte-equal to the pre-change contextInlineRetryPrompt(steps); with a shell present retryMarker is ignored, and retryMarker is stripped from the opts passed to agentFn. | DAT-2, DAT-7, DAT-8 |
| COMPATIBILITY-003 | COMPATIBILITY | Hosted-path model for the read-context-files:retry call is decided explicitly: scripts over LARGE_BATCH_BYTES are re-routed by runBatch to balanced, and that change (or an explicit model('balanced')) is pinned by a test rather than occurring silently. | DAT-7, DAT-8 |
| COMPATIBILITY-004 | COMPATIBILITY | The existing datum-tdd-act-lane test.ts, calls.test.ts and integration.test.ts pass after the dep-merge conversion, and describeFailure/stepResult handling of the dep-merge result is unchanged. | DAT-3 |
| COMPATIBILITY-005 | COMPATIBILITY | The existing datum-go.test.ts, datum-tdd-act.test.ts, datum-tdd-act-merge.test.ts, datum-validate.test.ts and datum-closeout.test.ts pass after conversion, with main-sync-steps.test.ts updated to forbid any batchCommandPrompt( call in datum-validate.ts. | DAT-4, DAT-5, DAT-6 |
| COMPATIBILITY-006 | COMPATIBILITY | The renamed pins in datum-plan.test.ts, datum-properties.test.ts and datum-refine.test.ts pass against the new runBatch form and fail against the old source. | DAT-7, DAT-8 |
| COMPATIBILITY-007 | COMPATIBILITY | 'npx vitest run skills/src' passes except the known zsh failure in batch.test.ts, including lane tests that use STAGE_RESULT_SCHEMA with the two new required fields. | DAT-9, DAT-14 |
| COMPATIBILITY-008 | COMPATIBILITY | assertReadWitness behaviour on the hosted path is unchanged and schemas.test.ts still pins read_witness on exactly the three schemas. | DAT-14 |
| COMPATIBILITY-009 | COMPATIBILITY | Hosted behaviour of stageOpts, readAgentTypeConfig and configureAgentTypes without globalThis.datumRuntime is unchanged. | DAT-16 |
| COMPATIBILITY-010 | COMPATIBILITY | Existing datum-*.js bundles are byte-identical apart from changes in their own sources after the second esbuild call is added; package.json dependencies are unchanged. | DAT-18 |
| COMPATIBILITY-011 | COMPATIBILITY | tests/test_cli_flag_contract.py passes unchanged, and pyproject.toml dependencies are unchanged. | DAT-19, DAT-20 |
| COMPATIBILITY-012 | COMPATIBILITY | Existing keys per_phase, per-model totals and the no_state_available status are unchanged, and tests/test_closeout_collectors.py and tests/test_closeout_cli.py pass unchanged. | DAT-20 |
| COMPATIBILITY-013 | COMPATIBILITY | No new runtime dependency is added for the subprocess shell or fixtures (node:child_process only). | DAT-17 |

## Per-Task Property Assignments

### DAT-1: Shell seam in runBatch plus getBatchRoot accessor

17 properties: SAFETY-001, SAFETY-002, SAFETY-003, SAFETY-004, INVARIANT-001, INVARIANT-002, INVARIANT-003, BOUNDARY-005, BOUNDARY-006, BOUNDARY-007, IDEMPOTENT-007, ORDERING-011, ISOLATION-008, SECURITY-006, PERFORMANCE-002, OBSERVABILITY-005, COMPATIBILITY-001

### DAT-2: verifyCommitIndependently and retry-guard through runBatch, retry-marker option

6 properties: INVARIANT-006, INVARIANT-007, ORDERING-006, ISOLATION-008, COMPATIBILITY-001, COMPATIBILITY-002

### DAT-3: Lane dep-merge through runBatch

3 properties: SAFETY-023, INVARIANT-008, COMPATIBILITY-004

### DAT-4: datum-go act-start and preflight checks through runBatch

4 properties: SAFETY-022, INVARIANT-009, ORDERING-005, COMPATIBILITY-005

### DAT-5: datum-tdd-act, setup and merge datum-cli calls through runBatch

3 properties: INVARIANT-010, ORDERING-005, COMPATIBILITY-005

### DAT-6: datum-validate and datum-closeout datum-cli calls through runBatch

3 properties: INVARIANT-011, ORDERING-005, COMPATIBILITY-005

### DAT-7: datum-plan context-inline retries through runBatch with retry marker

6 properties: INVARIANT-012, ORDERING-005, ORDERING-006, COMPATIBILITY-002, COMPATIBILITY-003, COMPATIBILITY-006

### DAT-8: datum-properties and datum-refine context-inline retries through runBatch

6 properties: INVARIANT-013, ORDERING-005, ORDERING-006, COMPATIBILITY-002, COMPATIBILITY-003, COMPATIBILITY-006

### DAT-9: Repo-wide guard: batchCommandPrompt only in batch.ts and agents.ts

7 properties: INVARIANT-014, INVARIANT-015, IDEMPOTENT-005, ORDERING-005, ORDERING-006, ORDERING-007, COMPATIBILITY-007

### DAT-10: readRuntimeConfig pure parser in models.ts

10 properties: SAFETY-011, SAFETY-012, INVARIANT-004, INVARIANT-005, BOUNDARY-001, BOUNDARY-002, BOUNDARY-003, BOUNDARY-004, IDEMPOTENT-001, OBSERVABILITY-005

### DAT-11: runBundle core with StageExecutor interface and FakeExecutor

19 properties: SAFETY-017, SAFETY-018, LIVENESS-001, LIVENESS-002, LIVENESS-003, INVARIANT-016, INVARIANT-017, INVARIANT-018, INVARIANT-019, INVARIANT-020, INVARIANT-021, INVARIANT-022, INVARIANT-023, ORDERING-001, ORDERING-002, ORDERING-010, ISOLATION-006, SECURITY-003, PERFORMANCE-003

### DAT-12: Per-model semaphores with agentType affinity and client/priority headers

10 properties: SAFETY-013, LIVENESS-004, INVARIANT-024, INVARIANT-025, INVARIANT-026, ORDERING-003, ORDERING-004, ISOLATION-007, PERFORMANCE-001, PERFORMANCE-003

### DAT-13: Per-call metrics.jsonl sink

15 properties: SAFETY-013, SAFETY-014, SAFETY-015, INVARIANT-018, INVARIANT-027, INVARIANT-028, INVARIANT-029, INVARIANT-030, INVARIANT-031, BOUNDARY-008, IDEMPOTENT-002, SECURITY-002, PERFORMANCE-003, OBSERVABILITY-003, OBSERVABILITY-004

### DAT-14: Stage output schema validation with one tier-up retry

18 properties: SAFETY-008, SAFETY-009, SAFETY-010, SAFETY-011, LIVENESS-005, INVARIANT-030, INVARIANT-032, INVARIANT-033, INVARIANT-034, INVARIANT-035, BOUNDARY-009, ORDERING-008, PERFORMANCE-003, OBSERVABILITY-001, OBSERVABILITY-002, OBSERVABILITY-005, COMPATIBILITY-007, COMPATIBILITY-008

### DAT-15: Nested workflow() resolution sharing executor, shell, semaphores and metrics

10 properties: SAFETY-007, LIVENESS-006, INVARIANT-036, INVARIANT-037, BOUNDARY-010, ORDERING-009, ISOLATION-001, ISOLATION-002, PERFORMANCE-003, OBSERVABILITY-005

### DAT-16: Reject datum-cli agent() calls and force agent types on

14 properties: SAFETY-005, SAFETY-006, SAFETY-016, INVARIANT-038, BOUNDARY-015, IDEMPOTENT-003, ORDERING-007, ISOLATION-003, ISOLATION-004, SECURITY-005, PERFORMANCE-003, OBSERVABILITY-005, OBSERVABILITY-008, COMPATIBILITY-009

### DAT-17: Real subprocess shell and end-to-end fixture bundles

15 properties: SAFETY-005, SAFETY-007, SAFETY-008, SAFETY-018, LIVENESS-001, LIVENESS-005, LIVENESS-007, INVARIANT-039, INVARIANT-040, INVARIANT-041, INVARIANT-042, SECURITY-001, PERFORMANCE-002, PERFORMANCE-003, COMPATIBILITY-013

### DAT-18: Node entry for runner and second esbuild call in build-workflows.sh

8 properties: SAFETY-018, LIVENESS-008, INVARIANT-043, INVARIANT-044, IDEMPOTENT-004, ISOLATION-005, OBSERVABILITY-006, COMPATIBILITY-010

### DAT-19: datum workflow run command

14 properties: SAFETY-019, SAFETY-020, LIVENESS-009, INVARIANT-045, BOUNDARY-004, BOUNDARY-011, BOUNDARY-012, ORDERING-009, SECURITY-001, SECURITY-004, PERFORMANCE-004, OBSERVABILITY-005, OBSERVABILITY-006, COMPATIBILITY-011

### DAT-20: Collector reads metrics.jsonl for per-agent-type, per-stage and cached-share totals

11 properties: SAFETY-021, LIVENESS-010, INVARIANT-046, INVARIANT-047, BOUNDARY-013, BOUNDARY-014, IDEMPOTENT-006, PERFORMANCE-005, OBSERVABILITY-007, COMPATIBILITY-011, COMPATIBILITY-012

## Requirement Coverage

| Requirement | Property IDs |
|---|---|
| R1.1 | INVARIANT-003 |
| R1.2 | INVARIANT-001, BOUNDARY-006, BOUNDARY-007, ORDERING-011, ISOLATION-008, SECURITY-006 |
| R1.3 | SAFETY-001, IDEMPOTENT-007 |
| R1.4 | SAFETY-001, SAFETY-002, SAFETY-003, SAFETY-004, BOUNDARY-005 |
| R1.5 | COMPATIBILITY-001 |
| R1.6 | INVARIANT-002 |
| R2.1 | SAFETY-023, INVARIANT-006, INVARIANT-008, COMPATIBILITY-004 |
| R2.2 | INVARIANT-009, INVARIANT-010, INVARIANT-011, COMPATIBILITY-005 |
| R2.3 | SAFETY-022, INVARIANT-009, INVARIANT-012, INVARIANT-013, ORDERING-006, COMPATIBILITY-001, COMPATIBILITY-002, COMPATIBILITY-003 |
| R2.4 | INVARIANT-014 |
| R2.5 | INVARIANT-007, INVARIANT-015, ORDERING-005, COMPATIBILITY-006 |
| R2.6 | IDEMPOTENT-004, IDEMPOTENT-005, COMPATIBILITY-010 |
| R3.1 | LIVENESS-001, INVARIANT-023 |
| R3.2 | INVARIANT-016 |
| R3.3 | LIVENESS-002, ORDERING-001 |
| R3.4 | LIVENESS-003, ORDERING-002 |
| R3.5 | INVARIANT-017, INVARIANT-018 |
| R3.6 | SAFETY-007, LIVENESS-006, INVARIANT-036, INVARIANT-037, BOUNDARY-010, ORDERING-009, ISOLATION-002 |
| R3.7 | ISOLATION-001 |
| R3.8 | SAFETY-017 |
| R4.1 | INVARIANT-019 |
| R4.2 | INVARIANT-019 |
| R4.3 | SAFETY-005, SAFETY-006, BOUNDARY-015, SECURITY-005, OBSERVABILITY-008 |
| R4.4 | SAFETY-016, INVARIANT-038, IDEMPOTENT-003, ORDERING-007, ISOLATION-003, ISOLATION-004, COMPATIBILITY-009 |
| R5.1 | INVARIANT-021 |
| R5.2 | INVARIANT-021, ORDERING-010 |
| R5.3 | INVARIANT-022 |
| R5.4 | SAFETY-018, SECURITY-003 |
| R6.1 | INVARIANT-004, INVARIANT-005, IDEMPOTENT-001 |
| R6.2 | SAFETY-011, SAFETY-012, BOUNDARY-001, BOUNDARY-002, BOUNDARY-003 |
| R6.3 | INVARIANT-020 |
| R6.4 | SAFETY-013, LIVENESS-004, INVARIANT-024, INVARIANT-025, ISOLATION-007 |
| R6.5 | ORDERING-003, ORDERING-004 |
| R6.6 | INVARIANT-026 |
| R6.7 | BOUNDARY-004, SECURITY-004 |
| R7.1 | SAFETY-015, INVARIANT-018, INVARIANT-027, INVARIANT-028, INVARIANT-031 |
| R7.2 | INVARIANT-029, BOUNDARY-008, IDEMPOTENT-002 |
| R7.3 | SAFETY-014, OBSERVABILITY-003, OBSERVABILITY-004 |
| R7.4 | INVARIANT-030 |
| R7.5 | LIVENESS-010, INVARIANT-046, INVARIANT-047, BOUNDARY-013, PERFORMANCE-005, OBSERVABILITY-007 |
| R7.6 | SAFETY-021, BOUNDARY-014, IDEMPOTENT-006, COMPATIBILITY-012 |
| R8.1 | INVARIANT-032 |
| R8.2 | INVARIANT-033 |
| R8.3 | SAFETY-008, SAFETY-009, SAFETY-010, LIVENESS-005, BOUNDARY-009, ORDERING-008, OBSERVABILITY-001 |
| R8.4 | SAFETY-009, SAFETY-011, INVARIANT-035, OBSERVABILITY-002 |
| R8.5 | INVARIANT-034 |
| R8.6 | COMPATIBILITY-007, COMPATIBILITY-008 |
| R9.1 | INVARIANT-045 |
| R9.2 | BOUNDARY-011, ORDERING-009 |
| R9.3 | SAFETY-019, SAFETY-020, LIVENESS-008, LIVENESS-009, BOUNDARY-012, ISOLATION-005, OBSERVABILITY-006 |
| R9.4 | INVARIANT-043, INVARIANT-044, IDEMPOTENT-004 |
| R9.5 | COMPATIBILITY-011 |
| R10.1 | INVARIANT-039 |
| R10.2 | LIVENESS-007, INVARIANT-042 |
| R10.3 | INVARIANT-040, INVARIANT-041 |
| R10.4 | SAFETY-005, SAFETY-007, SAFETY-008, LIVENESS-005 |
| Concurrency NFR | INVARIANT-024 |
| Dependencies NFR | COMPATIBILITY-013 |
| Determinism NFR | ISOLATION-006 |
| Dispatch NFR | PERFORMANCE-001 |
| Error format NFR | OBSERVABILITY-005 |
| File size NFR | PERFORMANCE-003, PERFORMANCE-004 |
| Privacy NFR | SECURITY-002 |
| Timeouts NFR | PERFORMANCE-002 |
| Toolchain NFR | SECURITY-001 |

## Integration Invariants

| ID | Invariant | Covers | Source |
|---|---|---|---|
| INT-01 | With globalThis.shell installed, every converted datum-cli call site (verify-commit, retry-guard, dep-merge, act-start, preflight checks, verifySteps, collectSteps, archiveSteps, tdd-act/setup/merge steps, read-context-files:retry) reaches the shell with script === batchScript(steps) and agent() is called 0 times, so the cli_call_bypassed_runbatch guard never fires for a converted bundle. | DAT-1, DAT-2, DAT-3, DAT-4, DAT-5, DAT-6, DAT-7, DAT-8, DAT-9, DAT-16 | spec:R2 |
| INT-02 | With no shell and no runtime block, every converted call site sends agentFn exactly the prompt text the pre-change code sent: batchCommandPrompt(steps), and for the four context-inline retries batchCommandPrompt(steps) plus the CONTEXT_INLINE_RETRY_MARKER suffix equal to the old contextInlineRetryPrompt(steps). | DAT-1, DAT-2, DAT-7, DAT-8, DAT-9 | spec:R1.5 |
| INT-03 | In every datum-*.ts bundle setBatchCacheKey( and setBatchRoot( precede the first runBatch( call, and the DAT-9 scan plus agent-types-ordering.test.ts pass for all bundles after DAT-4 to DAT-8 conversions. | DAT-4, DAT-5, DAT-6, DAT-7, DAT-8, DAT-9 | spec:R2.5 |
| INT-04 | For any run of runBundle the number of lines in <repoRoot>/.datum/runs/<runId>/metrics.jsonl equals FakeExecutor.requests.length, counting semaphore-queued requests, tier-up retries and nested-child requests; rejected datum-cli calls and workflow_not_found write neither a request nor a line. | DAT-12, DAT-13, DAT-14, DAT-15, DAT-16, DAT-17 | spec:R7.1 |
| INT-05 | A tier-up retry resolves its model from the readRuntimeConfig models triple fed to setModelTiers, acquires the semaphore keyed by the retry model id, carries the same X-Client and X-Priority headers, and is recorded as attempt 2 after the attempt 1 'invalid' line. | DAT-10, DAT-11, DAT-12, DAT-13, DAT-14 | spec:R8.3 |
| INT-06 | A tier-up retry releases the first request's semaphore slot before waiting for the retry model's slot, so with concurrency 1 on each of two distinct tier models no deadlock occurs and in-flight per model never exceeds its limit. | DAT-12, DAT-14 | spec:R6.4 |
| INT-07 | The argv contract between the Python launcher and the Node entry matches: datum workflow run spawns node skills/runtime/runner.js with --bundle, --args, --config, --repo-root and repeatable --skills-dir, and runner main accepts exactly those; the Python pre-checks mirror readRuntimeConfig errors. | DAT-10, DAT-18, DAT-19 | spec:R9.2 |
| INT-08 | The metrics.jsonl key set written by the runner (DAT-13) is exactly the key set the collector parses (DAT-20): a file produced by the runner with a mix of ok, invalid and error lines is accepted by the collector without a malformed-line error, and run_id equals the --run-id the closeout batch passes. | DAT-13, DAT-20 | spec:R7.5 |
| INT-09 | The end-to-end fixture exercises phase, log, agent with and without schema, parallel with a rejecting thunk, the shell seam, a nested workflow, semaphores and metrics together: labels, result object and metrics line count match one scripted FakeExecutor run. | DAT-11, DAT-12, DAT-13, DAT-14, DAT-15, DAT-16, DAT-17 | spec:R10.3 |
| INT-10 | Running bash scripts/build-workflows.sh after the conversions regenerates only the datum-*.js bundles whose source changed, leaves the others byte-identical, and builds skills/runtime/runner.js with the @generated banner without the meta/return checks; the built runner loads the regenerated bundles. | DAT-9, DAT-18 | spec:R2.6 |
| INT-11 | Adding files_written and test_exit_code to STAGE_RESULT_SCHEMA.required does not break lane tests that use the schema or hosted assertReadWitness, and the runner validator (DAT-14) enforces the same six-field required list that schemas.test.ts pins. | DAT-3, DAT-9, DAT-14 | spec:R8.6 |
| INT-12 | Every agent_type value the runner writes to metrics.jsonl (the datum-* names produced by stageOpts) appears as a key in both per_agent_type and cached_share of the collector output, and the sum of per_agent_type calls equals the number of metrics.jsonl lines. | DAT-13, DAT-16, DAT-20 | spec:R7.5 |
| INT-Q1 | token_metrics.json keeps per_phase and per-model totals unchanged and adds per_agent_type and per_stage (each {calls, prompt_tokens, completion_tokens, cached_tokens}; per_stage keyed by the label prefix before the first ':') and a top-level cached_share map (cached_tokens / prompt_tokens, 4 decimals, 0.0 when prompt_tokens is 0), built from SQLite token_metrics rows plus .datum/runs/<run_id>/metrics.jsonl; a missing metrics.jsonl contributes no rows and is not an error. | DAT-13, DAT-20 | question:Q1 |
| INT-Q2 | pipeline(items, ...stages) runs each item through all stages in order with the previous result as input, items concurrently, a rejecting stage yields null and skips that item's later stages, and no failure aborts the pipeline; pipeline.max_concurrent does not apply, so the only concurrency bound on agent() calls made inside stages is the per-model semaphore. | DAT-11, DAT-12 | question:Q2 |
| INT-Q3 | Nested workflow() children share the parent's semaphore map, metrics sink and run id: with concurrency { m1: 1 } parent and child requests on m1 never overlap, child requests append to the parent's metrics.jsonl, and the concurrency bound holds across the whole run. | DAT-12, DAT-13, DAT-15 | question:Q3 |
| INT-Q4 | Tier resolution is consistent from config to retry: a missing models tier is runtime_models_missing at readRuntimeConfig; literals haiku/sonnet/opus resolve to fast/balanced/deep (including the haiku used by retry-guard and dep-merge); any other id outside the map fails with runtime_model_unknown: <id>; when the next tier resolves to the same model id the retry is skipped, 'stage_output_invalid: <label>: no distinct higher tier' is logged and null is returned; there is no fallback to the next defined tier. | DAT-2, DAT-3, DAT-10, DAT-14 | question:Q4 |
| INT-Q5 | readRuntimeConfig never invents model ids and accepts kind 'pi'; runBundle takes an already-resolved executor and never reads kind; datum workflow run exits 2 with runtime_config_missing when no runtime block exists and with runtime_kind_unavailable: pi for kind 'pi'; priority and client default to batch and datum when only those keys are absent; there is no fallback to kind 'fake'. | DAT-10, DAT-18, DAT-19 | question:Q5 |
| INT-Q6 | metrics.jsonl has one line per executed request; attempt is 1 for the first request of a label and 2 for the tier-up retry, numbered per label within the run (shared run state, including children); the first line of an invalid reply has outcome 'invalid' and the retry line has ok, invalid or error; the collector counts each line as one call. | DAT-13, DAT-14, DAT-20 | question:Q6 |
| INT-Q7 | No Node pin is added: package.json gains no engines field, no .nvmrc is created, and the runner, shell and CLI code use only Node APIs present in both Node 22 and Node 24 (node:fs, node:path, node:child_process, performance); dependency lists in package.json and pyproject.toml are unchanged. | DAT-17, DAT-18, DAT-19 | question:Q7 |
| INT-Q8 | The fixture's shell work is the real batchScript(steps) for a one-step batch with command 'echo fixture-shell-ok', executed through the real shell global (bash -c subprocess wrapper from nodeShell) and parsed with parseBatchResult; the step's stdout is the literal 'fixture-shell-ok' with exit_code 0; the test needs no datum CLI and no repo state. | DAT-1, DAT-17 | question:Q8 |
| INT-Q9 | The runner forces agent types on for every bundle it runs, nested children included, so each stageOpts('cli', ...) call yields agentType 'datum-cli' even with agent_types false in .datum/config.json; hooks_installed stays as configured; the cli_call_bypassed_runbatch guard keys on opts.agentType === 'datum-cli'; and because the runCommandPrompt and contextInlineRetryPrompt callers are converted too, the extended grep for the three names runCommandPrompt, contextInlineRetryPrompt and batchCommandPrompt finds no call site outside shared/batch.ts, shared/agents.ts and tests, so no converted bundle trips the guard. | DAT-4, DAT-7, DAT-8, DAT-9, DAT-16 | question:Q9 |
