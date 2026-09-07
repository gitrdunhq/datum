# qwopus9b trial on datum's hard LLM phases — task-003 of state-single-source-of-truth

run_id: 20260907-trial-b0 · audit_dir: `.temp/qwopus-trial/` · endpoint: `http://192.168.0.211:8080/v1` (llama.cpp b10448-ad1de39e0 behind llama-swap) · wall for the whole trial: 35 min, model requests strictly sequential · nothing in the datum checkout, `.datum/`, `docs/epics/` or its worktrees was touched; the scratch repo is `.temp/qwopus-trial/repo`.

## 0. Headline

| Stage | Datum gates | Verdict on qwopus9b owning it |
|---|---|---|
| A. RED | attempt 1: tests written and failing, witness ok, **no commit**, `success=false`; retry: **40-turn repetition loop**, no commit, no answer | **No.** Two attempts, zero commits; the second degenerated into 22 identical Writes. |
| B. GREEN (on the real RED) | **all pass**: impl files only, 6/6 independent green, exact commit + author + trailers, witness ok, 45 s | **Yes, with the existing guards** (green verify, ownership diff) plus a stronger-tier contract lens: it dropped the try/except the AC says to preserve and nothing deterministic catches that. |
| C. Skeptic contract | broken variant CAUGHT, evidence = the failing test, both witnesses ok; truth: FRAGILE with FABRICATED witnesses (would be dropped by assertReadWitness); agent GREEN: 40-turn loop, no verdict | **Not as-is.** One of three runs is production-valid. Usable only behind a loop breaker and with the witness computed by the driver, and then as the cheap lens, not the contract lens. |
| D. plan-decompose | uncapped run HTTP 400 exceed_context_size after 22 whole-file reads, no tasks; with a 6-read cap: 12 tasks, `datum lane-plan --validate` ok and a lane plan builds, but a star DAG, a structural task owning a test file, and four SPEC requirements missing | **No.** Hosted deep stays. |
| E. refactor-check | should_refactor=false with a rubric-shaped reason, all 4 files read, 2 turns, 7 s | **Yes, as-is.** |

Rates observed today (thinking off, temp 0.2 from the launch flags): prefill 370-1740 tok/s on continuations, decode 60-110 tok/s, prefix cache 79-98% on every tool loop after the first turn. Speed is not the problem; the model stops, loops, or hallucinates a value where a frontier model runs a command.

## 1. Endpoint state

/v1/models listed qwopus9b at the first poll (no wait needed); a 5-token completion answered in 0.24 s. /running (state ready, port 5808): llm-serve -m /opt/models/Qwopus3.5-9B-Coder-MTP-Q6_K.gguf --spec-type draft-mtp --spec-draft-n-max 3 -c 65536 -fa on -ctk q4_0 -ctv q4_0 --parallel 1 --jinja --temp 0.2 --top-k 20 --top-p 0.95 --min-p 0 --slot-save-path /opt/kv-cache --metrics. Differences from the 14:04 probes: draft-n-max 3 (was 2), context 65536 (the 400 in stage D is this ceiling), temperature 0.2 pinned server-side. The trial did not override temperature; the repetition loops are consistent with near-greedy decoding. qwopus9b stayed resident; the one qwen38 run swapped the main group (first turn 37.5 s).

## 2. Test bed

Lane task-003 (behavioral, 5 ACs; files datum/report_bug.py, datum/archive.py, tests/test_report_bug_state.py, tests/test_archive_run_id.py). Lane branch datum/state-single-source-of-truth--task-003: BASE f408c15f (merge-base with the epic), real RED 366a1eed (2 new files, 6 tests), TRUTH eed713c3 (13 insertions, 13 deletions). The b2 squash 1fe4047d carried four lanes, so TRUTH is taken from the lane branch.

Scratch: git archive f408c15f into .temp/qwopus-trial/repo, git init, hooksPath /dev/null, commit base (3d0dff2). Refs: red-real (real RED on base), truth (real GREEN on top), broken (truth minus the `if state:` guard in report_bug._build_body, so the empty-state case appends "**State:** phase=None, run_id=None"; exactly one real test fails), epic-tip (SPEC.md at 81fc0757, byte-identical to BASE). Sanity: real RED tests fail 6/6 on BASE and pass 6/6 on TRUTH.

Lane spec via `datum lane-spec-export`: 3334 bytes, blob 8865d3daddae, spec_hash fnv1a64:a895f45bf4b21ee3, ac_count 5. Scratch .datum/config.json test_command = main venv python running pytest on the two lane files with PYTHONPATH = scratch.

Prompts: system = agent definition body (datum-red/green/skeptic/quality-reader; decompose none, as in production); user = agent-preamble + --- + stage template rendered with the production slot values (packet JSON, laneCtxCmd, testRunCommand with log file and TEST_EXIT, laneCommitCommand with datum author and Datum-Run/Lane/Stage/Spec trailers, `def test_` count pattern, contextSlot + contextWitnessInstruction). Tools = the agent's tool list as OpenAI functions, executed inside the scratch only, with datum's own PreToolUse hooks run as guards (lane-file-guard, protect-tests, commit-format, read-only-bash). Final answer = forced submit_answer with every schema field required (STAGE_RESULT 13, SKEPTIC 4, REFACTOR_CHECK 2, decompose {read_witness, tasks[]} with all 12 task fields). Caps: 40 turns, max_tokens 4000, socket 600 s, stage 15 min, Bash 120 s, tool output head+tail 5000 chars. enable_thinking=false on every qwopus9b call.

Deviations stated: (1) lane spec rendered DEFERRED (FILE NOT INLINED + witness) although 3334 bytes would be inlined by the 16 KiB relay; PROPERTIES.md (22.7 KB) and SPEC.md (21.1 KB) are deferred in production too. (2) Test command scoped to the lane files. (3) After RED attempt 1 invoked the live issue filer, a `gh` shim exiting 1 was put first on PATH for later runs. (4) Read returns whole files up to 24 000 chars; no tokensave/headroom tools exposed.

Gates run by the driver after each stage, mirroring postRedSteps/postGreenSteps: committed-file ownership, exact commit subject and pinned author, scripts/test-count-gate with the Python diff regex (--required 5 --base base), placeholder scan on added lines, the #499 artifact regex, independent test run (RED must fail, GREEN must pass), assertReadWitness semantics (>=7 correct leading hex), stray untracked files, and for decompose `datum lane-plan --validate` plus a full build.

## 3. Per-stage stats

| Stage | turns | prompt tok | completion tok | cached (share) | wall | retries | tool calls (errors) | outcome |
|---|---|---|---|---|---|---|---|---|
| A-red qwopus9b | 13 | 252151 | 3915 | 229067 (0.91) | 70 s | 0 | 19 (2) | submitted, not committed |
| A-red-retry | 40 | 1139606 | 33657 | 1121151 (0.98) | 437 s | 0 | 43 (2) | max_turns (loop) |
| A-red-qwen38 low | 7 | 90028 | 9409 | 70377 (0.78) | 404 s | 1 | 8 (1) | empty_reply x2 |
| B-green | 13 | 199566 | 2568 | 181960 (0.91) | 44 s | 0 | 16 (0) | submitted, all gates pass |
| C-skeptic green-agent | 40 | 800647 | 7288 | 783722 (0.98) | 111 s | 0 | 46 (0) | max_turns (loop) |
| C-skeptic truth | 4 | 55196 | 4812 | 21433 (0.39) | 82 s | 1 | 8 (0) | FRAGILE, witness fabricated |
| C-skeptic broken | 6 | 74340 | 1647 | 58741 (0.79) | 32 s | 0 | 18 (6) | FRAGILE, bug caught |
| D-decompose | 24 | 877255 | 745 | 815189 (0.93) | 96 s | 0 | 24 (0) | HTTP 400 |
| D-decompose-capped | 9 | 173769 | 3018 | 147044 (0.85) | 62 s | 0 | 9 (1) | submitted, schema valid |
| E-refactor-check | 2 | 7424 | 317 | 1740 (0.23) | 7 s | 0 | 5 (0) | submitted |

## 4. Stage detail

### A. RED (A-red/, A-red-retry/)

Gates attempt 1 -> retry (red-retry.md, reason "agent did not commit test files"):
- Writes only in owned test files: yes -> yes.
- Ran SETUP (datum skeleton then laneCtxCmd): NO -> NO (RESET and SETUP both skipped). Hooks therefore no-ops, .datum/lane-context.json never written.
- Tests fail on BASE for the right reason: 5 of 6 fail with AssertionError, 1 PASSES on BASE (test_report_bug_enrichment_no_state_db_no_raise, green-blind for AC3) -> 6 written, failing, never re-run after turn 18.
- Count gate (5 required): not evaluable, no commit -> same.
- Placeholder/artifact scan: clean -> clean, but `REPO_ROOT = Path(__file__).resolve().parent.parent.parent` + os.environ["DATUM_PROJECT_DIR"] at module top.
- Commit with the exact command: NO COMMIT -> NO COMMIT.
- read_witness: ok (8865d3daddae via git hash-object at turn 12) -> computed at turn 2, never submitted.
- Structured answer: success=false, tests_pass=false, test_exit_code=1, committed=false, commit_sha="", failure_reason="Tests are failing as expected for RED phase - the acceptance criteria are not yet implemented in the source code" -> none (max_turns).

Concrete mistakes, attempt 1: (1) inverted RED's success semantics and skipped the commit. (2) Source-text assertion, banned by red.md: `content = f.read()` / `assert ".datum/state.json" not in content`. (3) Two tests call the LIVE issue filer `report_bug_mod.report_bug(module="test_module", error="Test error", context={"extra": "data"})` and assert `result is None`; that runs `gh issue list` then `gh issue create`. No issue was created only because pytest's tmp_path has no git remote (verified: gh issue list --search test_module empty). The real RED calls the pure `_build_body`. (4) Weak assertions: `assert "run_id" in out or "State" in out`. (5) Ran pytest with -x so turns 9-10 saw only the first failure; the -v run at turn 11 revealed the passing test, which it rationalised.

Concrete mistakes, retry: (1) turns 19-40 are 22 consecutive identical Write calls of the same 3998-byte tests/test_report_bug_state.py, each preceded by "The test is failing because `report_bug` returns `None` when it can't file a GitHub issue." with no test run between; 27 000 completion tokens and 5 minutes. (2) Hand-built sqlite schema (CREATE TABLE IF NOT EXISTS kv_state) instead of save_state, pinning the store layout the epic abstracts. (3) Same live report_bug() call. (4) Never ran RESET or SETUP.

Versus the real RED (366a1eed): also 6 tests, but seeds state via save_state, deletes/overwrites .datum/state.json to prove the accessor path, calls _build_body, asserts SystemExit code 1 and the exact JSON error, no green-blind test.

Verdict: not as-is and not with a guard; two attempts, zero commits. Attempt 1 is rescuable only by a driver that commits the owned files itself when the tree is dirty only in owned files (it would then pass count-gate 5, placeholder and artifact scans).

### B. GREEN on the real RED (B-green/)

test_signal = the 6 failure summary lines. Gates: writes only in ALLOWED impl files yes; green_edited_tests no, RED commit intact; independent pytest 6 passed; commit dffb6fb "green(task-003): GREEN complete", author datum/20260907-trial-b0 <datum@local>, all four trailers; ownership diff clean; stray untracked none; witness ok (turn 12); AC1 grep zero matches; structured answer success=true tests_pass=true test_exit_code=0 committed=true commit_sha=dffb6fb9... status=ok, matches the tree; SETUP (laneCtxCmd) NOT run, hooks inert again.

Concrete mistakes (none halting): (1) `import datum.state as state_mod` inserted after the constants block in both files (archive.py line 18, report_bug.py line 23), E402. (2) Replaced the `try: ... except Exception: pass` around the state read with bare `state = state_mod.load_state(); if state:`; AC3 passes because load_state returns {} on a missing file, but SPEC Req 4 says the try/except-wrapped read is preserved, and a corrupt state.db (sqlite3.DatabaseError, not the OperationalError load_state catches) now propagates out of the bug reporter. The real GREEN kept the wrapper. (3) Left the stale message "No run_id provided and no state.json found" (allowed by AC4). The skeptic contract lens on this GREEN looped and returned nothing, so under the 2-of-3 rule the lane passes on the other two lenses.

Verdict: yes with the existing named guards (independent green verify, ownership diff, green_edited_tests) and a contract lens on a stronger tier.

### C. Skeptic contract lens (C-skeptic-*/)

Prompt: preamble + skeptic-base with lane spec and PROPERTIES.md both deferred (two witnesses) + skeptic-contract; read-only Bash hook enforced, zero blocks in all three runs.
- truth (eed713c3): witness FABRICATED: ".datum/lane-spec.json": "a895f45bf4b21ee3" is the spec_hash string copied from inside the file; PROPERTIES.md: "e7f3c2a9b1d4f8e6" matches nothing; git hash-object never run. FRAGILE / 0.85. Findings: (1) `run_id = args.run_id or args.run_id` in archive.py, severity high, a real pre-existing smell, harmless, not an AC; (2) "silent exception swallowing violates the coding rule", medium, a style complaint the unslop fence excludes and the AC requires the swallow. Turn 3 returned 4000 tokens of prose with finish_reason length; the driver forced submit next turn. Production drops this lens.
- broken: witnesses ok, ok (computed). FRAGILE / 0.95. Finding: "report_bug.py includes state-derived fields with None values when .datum/state.db is missing, violating AC..."; evidence: "test_enrichment_survives_missing_state_db fails because body contains '**State:** phase=None, run_id=None'". Caught, correctly attributed. First turn used root-relative paths (/.datum/lane-spec.json, six refused reads), recovered on turn 2. A failing lane test reported FRAGILE/medium rather than BROKEN is a calibration miss.
- green-agent (B's commit): witness computed at turn 3, never submitted. Turns 17-40: 24 identical `python3 -c "...from datum.report_bug import..."` probes, each introduced by "Let me look at the code more carefully to find actual bugs:", result None every time; max_turns. Turn 6 had demonstrated "Exception raised: Database corrupted!" and never wrote it up.

Verdict: not as-is. One of three runs production-valid, and the valid one is the easy case where a test already fails. Usable as the edge or error lens behind a loop breaker with the witness computed from the tool log; contract lens stays on qwen38 none or hosted.

### D. plan-decompose (D-decompose/, D-decompose-capped/)

Prompt: preamble + plan-decompose.md with SPEC.md deferred (contextWitnessWrapInstruction -> {read_witness, tasks}), a chosen-approach JSON written for the trial (mechanical migration, blast_radius high, 12 estimated tasks), a scan slot from git grep on BASE (7 KB), no context_files. Tools: Read, read-only Bash, Grep, Glob.

Uncapped: read SPEC.md (turn 1), computed the witness correctly (turn 2), then read state.py, spec_drift_detector, pr_comment_monitor, status_render, rollback, no_diff_guard, pipeline_scheduler, path_utils, report_bug, archive, memory/corpus_sql, datum-tui/data.py (twice), the four closeout collectors, gc, gate, migrate, pipeline_state: 22 whole-file reads at 29-33 completion tokens each, no plan, until turn 25 failed with "request (65549 tokens) exceeds the available context size (65536 tokens)". Nothing returned.

Capped (read budget 6, then the tool answers "read budget exhausted... call submit_answer now"): 12 tasks in one 2751-token answer (35 s decode). datum lane-plan --validate -> {"valid": true, "task_count": 12}; full build -> 12 lanes. Against the real tasks.json: count 12 vs 12; kinds 1 structural + 11 behavioral on both, but the 9B's structural task-001 owns tests/test_state_db.py and its AC says "tests/test_state_db.py includes a test asserting the chosen behavior", which plan-decompose.md defines as behavioral; files per task exactly 2 (module + test) for 11 tasks vs 1-6 real; dependencies a STAR (every task depends only on task-001, no ordering between migrations, no final drop-write-through task) vs the real chain (002->001, most->002, 006->003, 010->009, 012->{003,005,006,007,008,010,011}); missing Req 3 (migrate.py fate), Req 7 (datum-tui exemption), Req 9 (closeout collectors sentinel) and the final write-through drop; AC quality mixed ("pytest passes for report_bug tests"; task-009 red_note "the failing test should call load_state() and assert it returns an empty dict when no state exists", which tests the accessor, not report_bug).

Verdict: no, on both runs. The witness mechanism worked (correct hash both times).

### E. refactor-check (E-refactor-check/)

datum-quality-reader body as system; refactor-check.md with all four lane files and tellsSlot "(none)". Two turns: read all four files in one turn, then submit_answer should_refactor=false with a reason that walks the rubric. 7 s. Verdict: yes, as-is. tellsSlot was "(none)" because the tell scan errored (issue #518), which is what production gets today too.

### qwen38 comparison (A only, A-red-qwen38/)

reasoning_effort low, same prompt, max_tokens 4000. Turn 1 (37.5 s incl. swap) read the spec and computed the witness in one turn, a better start than the 9B. Turns 4 and 7 each returned finish_reason length with 4000 completion tokens and EMPTY content (163 s and 150 s): the reasoning channel consumed the whole output budget before a single tool call. Empty-reply guard retried once, second empty reply ended the stage; nothing written. With the server's --reasoning-budget 4096 and max_tokens 4000 a writer can never emit a tool call once it starts thinking, so qwen38 writers need reasoning_effort none or max_tokens >= 4096 + output; at 30-35 tok/s a 4000-token reasoning turn is 2.5 min, so the 15-min stage ceiling binds long before 40 turns. Not a like-for-like quality comparison; needs a rerun at none.

## 5. Cross-cutting

- Repetition loops in 3 of 10 runs (A-retry 22 identical Writes; C-green-agent 24 identical Bash probes; D-uncapped 22 reads to the 400). Each ran to the turn cap or context ceiling at 98% cache hit, cheap per turn, 5-7 min each. Every loop started after the model already had what it needed. Temp 0.2 from the launch flags is the plausible amplifier; research §6 suggests 0.6 for writers.
- SETUP was never run in any of four writer runs; skeleton, lane-context.json and RESET lines ignored every time, so datum's hook guards were no-ops throughout. Under mechanism A the driver must do these itself.
- Witness discipline is bimodal: seven runs computed it correctly; C-truth invented both values from file contents once in prose mode.
- The required list held: every submitted answer carried every required field (STAGE_RESULT 13/13, SKEPTIC 4/4, decompose 2/2 with 12/12 per task). Forced tool + full required list is the right default.
- Read-only enforcement held (zero hook blocks). Paths: absolute worktree paths everywhere except C-broken's first turn (root-relative); D used repo-relative correctly.

## 6. Bug found

`datum code-tells --files a b c` (codeTellSteps, lane-steps.ts:399) exits 2 because --files is a Typer list[str] option needing one flag per value; the step is tolerant, so every multi-file lane's REFACTOR pre-check runs with "(none)" tells. Filed as gitrdunhq/datum#518.

## 7. Three changes, ranked

1. Loop breaker + context budget in the local stage driver (datum local-stage, research tasks 3 and 7). Hash each tool call (name + args); on the second identical consecutive call replace the tool result with "you repeated the same call; the previous result stands, do something different or call submit_answer", on the third force tool_choice=submit_answer. Force submit when prompt_tokens passes ~45k of the 65k window; cap Reads per stage (writers 3 full files, judges by symbol). Converts three of the four hard failures (A-retry, C-green-agent, D) from "nothing returned" into an answer the deterministic gates can judge; script change, no prompt cost.
2. Make RED's setup and commit script-side and define RED success deterministically. Run datum skeleton, write lane-context.json, and (on retry) reset in the batch step BEFORE the agent so hooks are never inert; after the agent, if the tree is dirty only in owned test files and the independent run fails, the driver commits with laneCommitCommand itself and treats the stage as success regardless of the agent's success/committed booleans (the research doc already plans the commit as a follow-on batch step). Attempt 1 was a usable RED that failed only on self-report and a skipped commit. Add two cheap scans to postRedSteps: a source-text-assertion pattern (__file__ / read_text() of an impl file inside tests/, `not in content`) and a side-effect guard in the lane test environment (gh/network shim on PATH), since both attempts called the live issue filer.
3. Compute the read witness from the tool log instead of asking the model. The driver sees every Read and every git hash-object it executed; assertReadWitness for local stages should check that a Read of the path returning at least its byte count was observed (plus the hash if run), and the prompt paragraph shrinks to "read the file". C-truth's fabricated hashes become impossible and the two runs that computed the hash then never submitted stop wasting the turn. Pair with the reasoning rule qwen38 exposed: writers on qwen38 at reasoning_effort none, or max_tokens above the server's reasoning budget.

Below the top three: writer temperature 0.6 with a repeat penalty (the loops are greedy-decoding shaped); keep decompose and the contract lens hosted; run the 9B skeptic only as edge/error lenses under the 2-of-3 rule.
