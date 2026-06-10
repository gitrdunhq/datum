# Implementation Plan (TASKS.md)

## Dependency Graph
```mermaid
graph TD
  task-001 --> task-002
  task-001 --> task-007
  task-003 --> task-007
  task-004 --> task-007
  task-006 --> task-007
  task-007 --> task-008
```

## task-001: Write-tool lane scripts + manifest entries (R4 partial)
Implement the three write-tool scripts (write_to_file, replace_file_content, multi_replace_file_content) as lane-tool scripts in this repo. These are declared in WRITE_TOOLS but have no backing .py scripts or manifest entries. Each script reads JSON args from stdin, performs the file operation, and returns a JSON result. Add corresponding manifest entries with write=["."] permission.

- **Acceptance Criteria**:
  - AC4.1: scripts/lane-tools/write_to_file.py exists, accepts {"path": str, "content": str}, writes the file, returns confirmation JSON
  - AC4.2: scripts/lane-tools/replace_file_content.py exists, accepts {"path": str, "old_text": str, "new_text": str}, performs exact replacement
  - AC4.3: scripts/lane-tools/multi_replace_file_content.py exists, accepts {"path": str, "replacements": [{"old_text": str, "new_text": str}]}, performs all replacements sequentially
  - AC4.4: All three have entries in scripts/lane-tools/manifest.toml with write=["."] permission and timeout_seconds set
- **Files**: scripts/lane-tools/write_to_file.py, scripts/lane-tools/replace_file_content.py, scripts/lane-tools/multi_replace_file_content.py, scripts/lane-tools/manifest.toml
- **RED Note**: Failing test: call _execute_tool with write_to_file tool_name and enable_write_tools=true — should fail because the script doesn't exist yet (unregistered_tool or FileNotFoundError). GREEN: script exists, reads args, writes file, returns success JSON. Also test sandbox rejection for paths outside allowed_write_dirs.
- **Estimated LOC**: 150

## task-002: Write-tool integration tests in datum repo (R4 complete)
Integration tests in this repo that exercise _execute_tool end-to-end with the three new write-tool scripts. Tests confirm the tool dispatch works, sandbox enforcement rejects out-of-bounds paths, and write operations produce correct file content. Uses a tmp directory (via pytest tmp_path) as the fixture.

- **Acceptance Criteria**:
  - AC4.5: _execute_tool({"tool_name": "write_to_file", ...}, {"enable_write_tools": true, "allowed_tools": [...]}) succeeds end-to-end
  - AC4.6: Sandbox enforcement: paths outside allowed_write_dirs are rejected with error message
  - Test covers all three write tools: write_to_file creates a new file, replace_file_content modifies it, multi_replace_file_content applies multiple edits
  - Test confirms write tools blocked when enable_write_tools=false
- **Files**: tests/test_write_tools.py
- **Depends on**: task-001
- **RED Note**: Failing test: write _execute_tool integration tests FIRST with assertions that write_to_file creates a file, replace_file_content modifies text, sandbox rejects escape attempts. Run pytest — tests fail because scripts didn't produce expected output (or weren't registered). Verify: deleting any write-tool script causes test failure.
- **Estimated LOC**: 120

## task-003: Bootstrap materialize.sh + scaffold templates (R1, R2)
Author the bootstrap script and template files in this repo that materialize ../datum-local when executed. The script creates the sibling repo with pyproject.toml (editable dep on ../datum), datum_local/__init__.py, README.md, .gitignore, runs uv sync, and git init. Idempotent — running twice does not corrupt an existing datum-local.

- **Acceptance Criteria**:
  - AC2.1: docs/epics/datum/epic-26/bootstrap/materialize.sh exists; running it from this repo's root creates ../datum-local/ with all scaffold files
  - AC2.2: The script is idempotent — running it twice does not corrupt an existing ../datum-local/
  - AC2.3: The script exits non-zero if ../datum (this repo) does not exist at the expected relative path
  - AC1.1: ../datum-local/pyproject.toml exists with editable path dep and requires-python >= 3.12
  - AC1.2: ../datum-local/datum_local/__init__.py exists and is importable
  - AC1.3: ../datum-local/README.md documents the editable-dependency rationale
  - AC1.4: uv sync in ../datum-local succeeds and import datum.state works from that venv
  - AC1.5: git init run, .gitignore covers .datum/, __pycache__/, .venv/
- **Files**: docs/epics/datum/epic-26/bootstrap/materialize.sh, docs/epics/datum/epic-26/bootstrap/templates/pyproject.toml, docs/epics/datum/epic-26/bootstrap/templates/init.py, docs/epics/datum/epic-26/bootstrap/templates/README.md, docs/epics/datum/epic-26/bootstrap/templates/gitignore
- **RED Note**: Failing test: run materialize.sh, assert ../datum-local/pyproject.toml exists with correct editable dep, assert uv sync exits 0, assert 'import datum.state' works from the venv. Script must be POSIX sh (no bashisms), idempotent, and exit non-zero if ../datum is missing.
- **Estimated LOC**: 120

## task-004: Config overlay template (R5)
Author the config.toml template for datum-local that enables the local LLM stack with write tools, budget caps, and model tier configuration. This is a template file in the bootstrap directory; materialize.sh copies it to ../datum-local/config.toml.

- **Acceptance Criteria**:
  - AC5.1: config.toml enables [multi_turn] with enable_tool_execution=true, enable_write_tools=true
  - AC5.2: allowed_tools includes all 7 read tools (full manifest set) plus the 3 write tools
  - AC5.3: Model tiers: main=Qwen3-30B-A3B-8bit, fast=Llama-3.1-8B-Instruct-4bit, oMLX endpoint=localhost:12200
  - AC5.4: Budget caps present: max_turns, timeout_s, max_tool_turns all set to finite values
  - AC5.5: No Claude/Anthropic model IDs appear anywhere in the config
- **Files**: docs/epics/datum/epic-26/bootstrap/templates/config.toml
- **RED Note**: Failing test: parse config.toml with tomllib, assert enable_write_tools=true, assert allowed_tools contains all 12 tools, assert no string matching 'claude' or 'anthropic' or 'sonnet' or 'opus' or 'haiku' appears, assert max_turns and timeout_s are finite integers.
- **Estimated LOC**: 50

## task-005: Contract-test suite template (R3)
Author the contract tests for datum-local that import datum surfaces and assert their signatures. These tests fail loudly on upstream drift. File is a template in the bootstrap directory; materialize.sh copies it to ../datum-local/tests/test_contracts.py.

- **Acceptance Criteria**:
  - AC3.1: Imports datum.state.load_state, datum.state.resolve_tier, datum.state.PHASES
  - AC3.2: Imports datum.gate and asserts it is callable as a module
  - AC3.3: Imports datum.local_llm.run_phase, multi_turn_phase, generate, structured, _execute_tool
  - AC3.4: Imports datum.pipeline_scheduler, datum.commit_queue
  - AC3.5: Imports datum.schemas.StepPlan, StepResult, ToolCall
  - AC3.6: Signature assertions use inspect.signature() to validate parameter names and count
  - AC3.7: uv run pytest tests/test_contracts.py passes green in datum-local
- **Files**: docs/epics/datum/epic-26/bootstrap/templates/test_contracts.py
- **RED Note**: Failing test: the contract tests themselves ARE the red test — they assert that datum's public API surface matches expected signatures. If any import fails or signature changes, the test fails. Verify by temporarily renaming a datum function — contract test must break.
- **Estimated LOC**: 90

## task-006: Fixture repo template (R6)
Create a tiny toy Python project as a test fixture for the M1 driver. The fixture has a minimal function with a known bug or missing feature that a RED-GREEN cycle can target. Committed as a template in the bootstrap directory; materialize.sh creates it as a git-initialized project at ../datum-local/fixtures/toy-project/.

- **Acceptance Criteria**:
  - AC6.1: fixtures/toy-project/ is a valid Python project with at least one source file and a tests/ directory
  - AC6.2: The project has a minimal function with a known missing feature (e.g. calculator missing multiply) for RED-GREEN targeting
  - AC6.3: uv run pytest in the fixture repo passes (baseline green before the driver modifies it)
  - AC6.4: The fixture is git-initialized with an initial commit by materialize.sh
- **Files**: docs/epics/datum/epic-26/bootstrap/templates/fixture/calculator.py, docs/epics/datum/epic-26/bootstrap/templates/fixture/test_calculator.py, docs/epics/datum/epic-26/bootstrap/templates/fixture/pyproject.toml
- **RED Note**: Failing test: run pytest in the fixture — all existing tests pass (baseline green). The fixture INTENTIONALLY lacks a multiply function — the M1 driver's job is to write the test for it (RED) then implement it (GREEN). Verify: the fixture's source file has no multiply, and no test covers it.
- **Estimated LOC**: 40

## task-007: M1 driver script template (R7)
Author the bare M1 driver script that runs multi_turn_phase with tool execution to perform RED-GREEN on the fixture repo. The driver operates in two phases: write a failing test (RED), run pytest to confirm failure; implement the fix (GREEN), run pytest to confirm pass. On success, commits both via commit_queue or git fallback. Template in bootstrap directory; materialize.sh copies to ../datum-local/scripts/m1_driver.py.

- **Acceptance Criteria**:
  - AC7.1: scripts/m1_driver.py exists as a standalone script
  - AC7.2: The driver calls datum.local_llm.multi_turn_phase with enable_tool_execution=true and enable_write_tools=true via mt_overrides
  - AC7.3: Two phases: (a) RED — write failing test, pytest confirms failure; (b) GREEN — implement fix, pytest confirms pass
  - AC7.4: On success, commits both the test and the fix to a branch in the fixture repo via datum.commit_queue or git fallback
  - AC7.7: Failure runs produce a structured JSON failure record (phase, attempts, reason, model used)
- **Files**: docs/epics/datum/epic-26/bootstrap/templates/m1_driver.py
- **Depends on**: task-001, task-003, task-004, task-006
- **RED Note**: Failing test: invoke m1_driver.py against the fixture repo — should produce a branch with a new test file and modified source file where pytest passes. The driver must handle: model not available (structured failure), write-tool sandbox (cwd-relative paths), pytest assertion in both RED and GREEN phases. AC7.5 (80% success rate) and AC7.6 (no Claude model IDs) validated by task-008.
- **Estimated LOC**: 180

## task-008: End-to-end integration test template (R8)
Automated test that exercises the full M1 flow, runnable locally. Invokes the M1 driver against a fresh copy of the fixture repo and asserts: fixture branch exists, test file written, source file modified, pytest passes in fixture, metrics log contains only local model IDs. Skippable when no local model is available.

- **Acceptance Criteria**:
  - AC8.1: tests/test_m1_e2e.py exists and is skippable when no local model is available (pytest.mark.skipif)
  - AC8.2: The test invokes the M1 driver against a fresh copy of the fixture repo
  - AC8.3: Asserts: fixture branch exists, test file written, source file modified, pytest passes in fixture, metrics log contains only local model IDs
  - AC8.4: The test completes in under 10 minutes (timeout enforced)
  - AC7.5: The driver completes RED-GREEN on the fixture in at least 4 of 5 consecutive runs (80% success rate validated here)
  - AC7.6: .datum/local-llm-metrics.jsonl from M1 runs contains no Claude/Anthropic model IDs
- **Files**: docs/epics/datum/epic-26/bootstrap/templates/test_m1_e2e.py
- **Depends on**: task-007
- **RED Note**: Failing test: test_m1_e2e.py runs the M1 driver against a fresh fixture copy. Assertions: branch created, test file exists at expected path, source file modified, pytest passes inside fixture, metrics JSONL contains zero Claude/Anthropic model references. skipif: no local model reachable at localhost:12200 and mlx_lm not importable. Timeout: 10 minutes enforced via pytest-timeout or signal.
- **Estimated LOC**: 100

## Research Findings

### task-001: Write-tool lane scripts + manifest entries

- **Arg protocol**: Lane tools receive args as `sys.argv[1]` (a JSON string). Example from `scripts/lane-tools/read_file.py:13`: `args = json.loads(sys.argv[1])`. This is how `_execute_tool` invokes them — `cmd = [sys.executable, "-m", "datum.lane_tools_runner", tool_name, json.dumps(tool_args)]` (`datum/local_llm.py:850-856`). The new write scripts must follow this exact argv[1]-JSON convention.
- **Return convention**: Lane tool scripts print their output to stdout; there is no structured JSON return from the script itself. `_execute_tool` captures stdout+stderr and returns `(str, bool)` where bool is `was_truncated`. Error paths return plain error strings (not JSON). Write scripts should print a human-readable confirmation on success and `sys.exit(1)` with an error message on failure.
- **Manifest entry shape** (`scripts/lane-tools/manifest.toml:6-13`): required fields are `path`, `description`, `permissions` (with `network`, `write`, `read` sub-keys), `timeout_seconds`, `added_in_epic`, `added_in_lane`. For write tools use `permissions = { network = false, write = ["."], read = ["."] }`.
- **Runner discovery** (`datum/lane_tools_runner.py:37-68`): `get_tool_config()` looks up `manifest["tools"][tool_name]`. If absent, exits with `{"violation": "unregistered_tool"}` on stderr and return code 2. Tool file path is `scripts/lane-tools/<config["path"]>`. Resource limits: CPU=timeout, AS=512MB, NOFILE=1000.
- **Sandbox enforcement** (`datum/local_llm.py:811-832`): `_execute_tool` checks every string arg that contains `/` or ends with a known extension against `allowed_dirs = [Path.cwd().resolve()] + allowed_write_dirs`. Sandbox check happens in `_execute_tool` before calling the runner — the scripts themselves do not need to re-check, but they should resolve paths and handle missing-file errors cleanly.
- **WRITE_TOOLS set** (`datum/local_llm.py:770-776`): exactly `{"write_to_file", "replace_file_content", "multi_replace_file_content"}`. These names must match the manifest tool keys exactly.

### task-002: Write-tool integration tests

- **Existing test pattern**: `tests/test_local_llm_hardening.py` tests `_execute_tool` indirectly via `multi_turn_phase` with heavy mocking. There is **no existing direct `_execute_tool` integration test** — task-002 will be the first.
- **Config dict shape for `_execute_tool`** (`datum/local_llm.py:795-875`): the `mt_config` dict uses keys `allowed_tools` (list), `enable_write_tools` (bool), `allowed_write_dirs` (list of path strings). Minimal config for a write-tool test: `{"allowed_tools": ["write_to_file"], "enable_write_tools": True, "allowed_write_dirs": [str(tmp_path)]}`.
- **Sandbox path**: `_execute_tool` resolves `Path.cwd().resolve()` as the primary allowed root. In tests using `tmp_path`, the cwd will be the repo root, so `tmp_path` must be passed via `allowed_write_dirs` OR the test must ensure the tmp_path is under cwd. Use `allowed_write_dirs` to be safe.
- **Invocation**: `uv run pytest` (per PY-002 in CODING-STEERING.md). No pytest.ini exists in this repo; no `pytest-timeout` in `pyproject.toml` deps — do not rely on it for these tests.

### task-003: Bootstrap materialize.sh + scaffold templates

- **pyproject.toml packaging** (`pyproject.toml:1-16`): `name = "datum"`, `version = "2.0.0"`, `requires-python = ">=3.12"`, build-backend is `hatchling`. The editable dep template for datum-local should use `dependencies = ["datum @ file:///../datum"]` (uv editable path dep syntax) or the `[tool.uv.sources]` approach with `datum = { path = "../datum", editable = true }`.
- **skill_root confirms editable install** (`datum/path_utils.py:46-47`): `skill_root()` returns `Path(__file__).resolve().parent.parent` — i.e., the repo root. This means `import datum.state` resolves correctly from any venv that has datum installed editably from the sibling path, since the package is `datum/` under the repo root.
- **DATUM_PROJECT_DIR env var**: `path_utils.project_root()` reads `os.environ.get("DATUM_PROJECT_DIR", ".")`. The m1_driver will need to set this to the fixture repo path so that `.datum/` artifacts land there, not in datum-local's own dir.

### task-004: Config overlay template

- **Full [local_llm] DEFAULTS** (`datum/local_llm.py:22-50`): `enabled`, `model`, `fast_model`, `fast_phases`, `max_tokens`, `temperature`, `context_window`, `kv_bits`, `kv_group_size`, `max_kv_size`, `repetition_ngram_size`, `repetition_max_count`, `phases`. Config is loaded from `$DATUM_PROJECT_DIR/.datum/config.toml` → `.datum/config.toml` → `assets/config.toml.default` (`datum/local_llm.py:1373-1393`). In a non-datum repo, datum-local's `.datum/config.toml` is the correct location.
- **Full [multi_turn] DEFAULTS** (`datum/local_llm.py:52-76` + `assets/config.toml.default:170-190`): adds `enable_tool_execution`, `enable_write_tools`, `max_tool_turns`, `allowed_tools`, `allowed_write_dirs` on top of the planning/voting defaults.
- **Read tool count discrepancy**: AC5.2 says "all 9 read tools" but the manifest currently has **7 tools** (`find_callers`, `filter_gitnexus_output`, `read_file`, `read_file_range`, `list_dir`, `grep_search`, `run_command`). `READ_ONLY_TOOLS` frozenset has only 5 (`datum/local_llm.py:761-769`). The config template's `allowed_tools` list should enumerate all 7 manifest tools (the 5 in READ_ONLY_TOOLS plus `find_callers` and `filter_gitnexus_output`) plus the 3 write tools = 10 total. The "9 read tools" figure in AC5.2 is incorrect — **task owner should use 7 read tools**.
- **oMLX endpoint**: configured as `omlx_url = "http://localhost:12200"` in `.datum/config.toml`. The config template should mirror this.

### task-005: Contract-test suite template

- **`datum.state.load_state`** (`datum/state.py:158-170`): `load_state() -> dict`. No parameters. Reads `.datum/state.db`.
- **`datum.state.resolve_tier`** (`datum/state.py:115-132`): `resolve_tier(phase: str, run_state: dict | None = None) -> dict`. Returns `{"phase": str, "tier": str, "model": str}`.
- **`datum.state.PHASES`** (`datum/state.py:26-38`): list of 11 phase strings.
- **`datum.local_llm.run_phase`** (`datum/local_llm.py:582-588`): `run_phase(phase: str, prompt: str, schema=None, max_tokens: int = 8192, mt_overrides: dict | None = None) -> dict`.
- **`datum.local_llm.multi_turn_phase`** (`datum/local_llm.py:878-884`): `multi_turn_phase(phase: str, prompt: str, schema=None, max_tokens: int = 8192, mt_overrides: dict | None = None) -> dict`.
- **`datum.local_llm.generate`** (`datum/local_llm.py:198-203`): `generate(prompt: str, model_id: str, max_tokens: int, temperature: float) -> dict`.
- **`datum.local_llm.structured`** (`datum/local_llm.py:329-335`): `structured(prompt: str, schema, model_id: str, max_tokens: int = 500, **kwargs) -> dict`.
- **`datum.local_llm._execute_tool`** (`datum/local_llm.py:795`): `_execute_tool(tool_call: dict, mt_config: dict) -> tuple[str, bool]`.
- **`datum.schemas.StepPlan`** (`datum/schemas.py:57-59`): fields `steps: list[StepAction]`, `rationale: str`.
- **`datum.schemas.StepResult`** (`datum/schemas.py:66-77`): fields `step_index`, `action`, `finding`, `evidence`, `recommendation`, `confidence`, `needs_more_turns`, `escalate`, `tool_call: ToolCall | None`.
- **`datum.schemas.ToolCall`** (`datum/schemas.py:62-64`): fields `tool_name: str`, `tool_args: dict`.
- **`datum.pipeline_scheduler`** and **`datum.commit_queue`** exist as importable modules. `commit_queue.apply_patch_and_commit(patch: str, message: str, run_id: str, file_set: list[str] | None = None) -> dict`.

### task-006: Fixture repo template

- **pytest invocation**: `uv run pytest` (per PY-002). No project-level conftest.py or pytest.ini in the datum repo — fixture project should include its own `pyproject.toml` with `[tool.pytest.ini_options]` if needed.
- **No special infrastructure required** — fixture is standalone; no datum imports needed at baseline.

### task-007: M1 driver script template

- **`multi_turn_phase` signature** (`datum/local_llm.py:878-884`): `multi_turn_phase(phase, prompt, schema=None, max_tokens=8192, mt_overrides=dict|None)`. Pass write-tool config via `mt_overrides={"enabled": True, "enable_tool_execution": True, "enable_write_tools": True, "allowed_tools": [...], "max_tool_turns": N}`.
- **Tool-execution trigger**: `StepResult.action == "tool_execution"` causes `_execute_tool` to be called inside the multi_turn loop (`datum/local_llm.py:1083-1121`). The model must emit `action: "tool_execution"` with a populated `tool_call` field in the `StepResult` schema for a tool call to fire.
- **commit_queue protocol** (`datum/commit_queue.py`): Unix socket at `.datum/runs/{run_id}/commit-queue.sock`. Request JSON: `{"patch": str, "commit_message": str, "file_set": list[str]}`. Response JSON: `{"ok": bool, ...}`. Requires a running server process. For the fixture repo (no datum run ID), a **direct git fallback is simpler** — just `subprocess.run(["git", "add", ...], ["git", "commit", ...])` in the fixture repo directory.
- **Metrics path** (`datum/local_llm.py:1298-1301`): `datum_dir() / "local-llm-metrics.jsonl"` where `datum_dir()` = `Path(DATUM_PROJECT_DIR) / ".datum"`. Set `DATUM_PROJECT_DIR` to the fixture repo path so metrics land in `<fixture-repo>/.datum/local-llm-metrics.jsonl`.
- **Sandbox note**: Write tools resolve paths relative to `Path.cwd().resolve()`. The driver must set `cwd` to the fixture repo root when calling `multi_turn_phase`, or pass the fixture root via `allowed_write_dirs`.

### task-008: End-to-end integration test template

- **Model availability check** (`datum/local_llm.py:103-113`): `is_available() -> bool` checks `platform.system() == "Darwin"` and `platform.machine() == "arm64"` and `import mlx_lm`. **Additionally** check `_omlx_available()` which probes `localhost:12200/health` — if oMLX is running, local inference works even without mlx_lm importable. Use both checks for the `skipif` guard.
- **pytest-timeout**: **not in pyproject.toml deps**. Use `signal.alarm(600)` or a subprocess timeout wrapper instead of `@pytest.mark.timeout`. Alternatively add `pytest-timeout` to datum-local's test deps.
- **No `pytest.ini` or `conftest.py`** exists at datum repo root — the e2e test template should be self-contained and not rely on any datum-repo-level fixtures.
