# Spec: datum-local M0+M1 — sibling repo scaffold + prove the local write path

**Run ID:** <!-- filled by datum -->
**Phase:** Refine
**Status:** Draft

---

## 1. Summary

Bootstrap `gitrdunhq/datum-local` as an editable-path-dependency sibling repo and prove that a local model can drive a write-test-commit loop end-to-end with zero Claude/Anthropic calls. Scope is M0 (repo scaffold, contract tests, config overlay) and M1 (bare driver executing RED-GREEN on a fixture repo via `multi_turn_phase` with `enable_write_tools = true`).

## 2. Context

datum's core (`state`, `gate`, `local_llm`, `pipeline_scheduler`, `commit_queue`, `models/schemas`, lane-tools) is harness-independent pure Python. Epic-24 built the local inference stack (oMLX, multi-turn, tool execution). The remaining gap: `enable_write_tools` has never been exercised in a live multi-turn run — the write tool scripts (`write_to_file`, `replace_file_content`, `multi_replace_file_content`) are declared in `WRITE_TOOLS` and gated by config but have **no corresponding lane-tool scripts or manifest entries** (see A3 in Assumption Audit). This epic is the proving ground.

datum's wheel (`[tool.hatch.build.targets.wheel] packages = ["datum"]`) excludes `assets/`, `references/`, `templates/`, `scripts/lane-tools/`; `path_utils.py` resolves these relative to the source tree via `skill_root()`. Only an editable install from a checkout works. datum-local imports datum via `[tool.uv.sources] datum = { path = "../datum", editable = true }`.

**Cross-repo constraint:** datum's lane sandbox confines write-tool paths to the current working directory (cwd). The deliverables for this epic (code, tests, config) live in `../datum-local`, outside the datum repo. The approach chosen (see A1) is: all datum-local scaffolding scripts and fixture content are authored as **bootstrap scripts committed to this repo** at `docs/epics/datum/epic-26/bootstrap/`, then a single documented materialization step (`bash docs/epics/datum/epic-26/bootstrap/materialize.sh`) creates the sibling repo. The M1 driver runs with cwd set to the fixture repo inside datum-local, so the lane sandbox covers it naturally.

## 3. Requirements

### R1: Repo scaffold (`../datum-local`)

**Description:** Create the datum-local sibling repository with minimal package skeleton, editable path dependency on datum, and project config.

**Acceptance criteria:**
- [ ] AC1.1: `../datum-local/pyproject.toml` exists with `[tool.uv.sources] datum = { path = "../datum", editable = true }` and `requires-python = ">=3.12"`
- [ ] AC1.2: `../datum-local/datum_local/__init__.py` exists and is importable
- [ ] AC1.3: `../datum-local/README.md` documents the editable-dependency rationale and the strictly-local architecture constraint
- [ ] AC1.4: `uv sync` in `../datum-local` succeeds and `import datum.state` works from that venv
- [ ] AC1.5: `git init` run, `.gitignore` covers `.datum/`, `__pycache__/`, `.venv/`

### R2: Bootstrap scripts (this repo)

**Description:** Author reproducible bootstrap scripts inside this repo that materialize the sibling when executed. Avoids manual instructions and keeps the source-of-truth in datum's version control.

**Acceptance criteria:**
- [ ] AC2.1: `docs/epics/datum/epic-26/bootstrap/materialize.sh` exists; running it from this repo's root creates `../datum-local/` with all scaffold files
- [ ] AC2.2: The script is idempotent — running it twice does not corrupt an existing `../datum-local/`
- [ ] AC2.3: The script exits non-zero if `../datum` (this repo) does not exist at the expected relative path

### R3: Contract-test suite

**Description:** Tests in datum-local that import datum surfaces and assert their signatures, failing loudly on upstream drift.

**Acceptance criteria:**
- [ ] AC3.1: `tests/test_contracts.py` imports `datum.state.load_state`, `datum.state.resolve_tier`, `datum.state.PHASES`
- [ ] AC3.2: `tests/test_contracts.py` imports `datum.gate` and asserts it is callable as a module (has gate check functions)
- [ ] AC3.3: `tests/test_contracts.py` imports `datum.local_llm.run_phase`, `datum.local_llm.multi_turn_phase`, `datum.local_llm.generate`, `datum.local_llm.structured`, `datum.local_llm._execute_tool`
- [ ] AC3.4: `tests/test_contracts.py` imports `datum.pipeline_scheduler`, `datum.commit_queue`
- [ ] AC3.5: `tests/test_contracts.py` imports `datum.schemas.StepPlan`, `datum.schemas.StepResult`, `datum.schemas.ToolCall`
- [ ] AC3.6: Signature assertions use `inspect.signature()` to validate parameter names and count — a renamed or removed parameter fails the test
- [ ] AC3.7: `uv run pytest tests/test_contracts.py` passes green in datum-local

### R4: Write-tool lane scripts

**Description:** Implement the three write tools (`write_to_file`, `replace_file_content`, `multi_replace_file_content`) as lane-tool scripts in this repo with manifest entries. These are currently declared in `WRITE_TOOLS` but have no backing implementation.

**Acceptance criteria:**
- [ ] AC4.1: `scripts/lane-tools/write_to_file.py` exists, accepts `{"path": str, "content": str}`, writes the file, returns confirmation JSON
- [ ] AC4.2: `scripts/lane-tools/replace_file_content.py` exists, accepts `{"path": str, "old_text": str, "new_text": str}`, performs exact replacement
- [ ] AC4.3: `scripts/lane-tools/multi_replace_file_content.py` exists, accepts `{"path": str, "replacements": [{"old_text": str, "new_text": str}]}`, performs all replacements
- [ ] AC4.4: All three have entries in `scripts/lane-tools/manifest.toml` with `write = ["."]` permission and appropriate timeouts
- [ ] AC4.5: `_execute_tool({"tool_name": "write_to_file", ...}, {"enable_write_tools": true, "allowed_tools": [...]})` succeeds end-to-end (integration test in this repo)
- [ ] AC4.6: Sandbox enforcement: paths outside `allowed_write_dirs` are rejected

### R5: Config overlay

**Description:** datum-local config enabling the local LLM stack with write tools and budget caps.

**Acceptance criteria:**
- [ ] AC5.1: `../datum-local/config.toml` enables `[multi_turn]` with `enable_tool_execution = true`, `enable_write_tools = true`
- [ ] AC5.2: `allowed_tools` includes all 9 read tools plus the 3 write tools
- [ ] AC5.3: Model tiers configured: main = `Qwen3-30B-A3B-8bit`, fast = `Llama-3.1-8B-Instruct-4bit`, oMLX endpoint = `localhost:12200`
- [ ] AC5.4: Budget caps present: `max_turns`, `timeout_s`, `max_tool_turns` all set to finite values
- [ ] AC5.5: No Claude/Anthropic model IDs appear anywhere in the config

### R6: Fixture repo

**Description:** A tiny toy Python project committed as a test fixture inside datum-local, used as the target for the M1 driver.

**Acceptance criteria:**
- [ ] AC6.1: `../datum-local/fixtures/toy-project/` is a valid Python project with at least one source file and a `tests/` directory
- [ ] AC6.2: The project has a minimal function with a known bug or missing feature that a RED-GREEN cycle can target
- [ ] AC6.3: `uv run pytest` in the fixture repo passes (baseline green before the driver modifies it)
- [ ] AC6.4: The fixture is git-initialized with an initial commit (the driver creates branches on it)

### R7: M1 driver script

**Description:** A bare driver (no orchestrator) that runs `multi_turn_phase` with tool execution to perform RED-GREEN on the fixture repo.

**Acceptance criteria:**
- [ ] AC7.1: `../datum-local/scripts/m1_driver.py` exists as a standalone script
- [ ] AC7.2: The driver calls `datum.local_llm.multi_turn_phase` with `enable_tool_execution = true` and `enable_write_tools = true` via `mt_overrides`
- [ ] AC7.3: The driver operates in two phases: (a) write a failing test (RED), run pytest to confirm failure; (b) implement the fix (GREEN), run pytest to confirm pass
- [ ] AC7.4: On success, the driver commits both the test and the fix to a branch in the fixture repo via `datum.commit_queue`
- [ ] AC7.5: The driver completes RED-GREEN on the fixture repo with zero human input in at least 4 of 5 consecutive runs
- [ ] AC7.6: `.datum/local-llm-metrics.jsonl` from M1 runs contains no Claude/Anthropic model IDs — every inference event names a local model
- [ ] AC7.7: Failure runs produce a structured JSON failure record (phase, attempts, reason, model used) — not a silent stall or bare traceback

### R8: Integration test (end-to-end)

**Description:** An automated test that exercises the full M1 flow, runnable in CI or locally.

**Acceptance criteria:**
- [ ] AC8.1: `../datum-local/tests/test_m1_e2e.py` exists and is skippable when no local model is available (`pytest.mark.skipif`)
- [ ] AC8.2: The test invokes the M1 driver against a fresh copy of the fixture repo
- [ ] AC8.3: The test asserts: fixture branch exists, test file written, source file modified, pytest passes in fixture, metrics log contains only local model IDs
- [ ] AC8.4: The test completes in under 10 minutes (timeout enforced)

## 4. Failure Modes and Handling

| Failure | Handling |
|---|---|
| `../datum` does not exist at expected relative path | `materialize.sh` exits non-zero with clear error message; contract tests skip with `pytest.importorskip` |
| oMLX server not running (localhost:12200 unreachable) | M1 driver falls back to `mlx_lm` direct loading; test marked `xfail` if neither available |
| Write tool blocked by sandbox (path escapes allowed roots) | `_execute_tool` returns error tuple; driver logs it as a structured failure, does not retry |
| Model generates invalid tool call JSON | Multi-turn loop retries with schema error injected into the retry prompt (existing behavior) |
| Model fails to produce passing code (GREEN never reached) | Driver exhausts `max_turns` / `max_tool_turns`, writes structured failure record, exits 1 |
| `uv sync` fails in datum-local (editable dep resolution) | `materialize.sh` runs `uv sync` as final step, exits non-zero on failure; user sees clear uv error |
| Contract test fails (upstream signature changed) | Test failure is the intended alarm; datum-local CI blocks until contract updated |
| commit_queue socket not available | Driver creates commits directly via `git` subprocess as fallback; logs warning |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| M1 driver wall-clock per run | < 5 minutes (single RED-GREEN on toy fixture) |
| M1 success rate | >= 4/5 consecutive runs (80%) |
| Zero Anthropic/Claude calls | Enforced by metrics assertion — any Claude model ID in `.datum/local-llm-metrics.jsonl` is a test failure |
| Write-tool scripts | Pure Python, no new external dependencies |
| Bootstrap script | POSIX sh compatible, runs on macOS and Linux |
| Fixture repo size | < 50 lines of source, < 20 lines of test |
| Config overlay | Valid TOML, parseable by `tomllib` |

## 6. Out of Scope

- Headless PipelineDriver/orchestrator (M2)
- Porting refine/plan/deepen/properties phases to local models (M3)
- Chunked review + PR publishing (M4)
- datumd FastAPI API + chat (M5-M6)
- Web chat UI, TUI v2 (M6)
- Non-editable (wheel) install support (M7)
- LocalEscalationPolicy beyond basic retry + halt (M2+)
- Changes to datum core's public API (if an upstream fix is needed, e.g. `prompt_loader.py` path resolution, it is minimal and scoped as a sub-task within this epic)
- CI/CD pipeline for datum-local (future epic)
- Multi-lane or multi-task execution (M1 tests a single task only)

## 7. Open Questions

*(none)*

## 8. Blast Radius + Impact Analysis

**datum repo (this repo):**
- `scripts/lane-tools/` — 3 new tool scripts + 3 manifest entries. No existing tool modified. Impact: additive only.
- `datum/local_llm.py` — no changes to source. The WRITE_TOOLS set and `_execute_tool` gating already exist. Impact: zero.
- `datum/lane_tools_runner.py` — no changes. Runner already dispatches any tool in the manifest. Impact: zero.
- `assets/config.toml.default` — no changes. `enable_write_tools` default remains `false`. Impact: zero.
- `pyproject.toml` — no changes. Impact: zero.

**datum-local repo (new, sibling):**
- Entirely additive — new repo, no existing code affected.
- Depends on datum surfaces at their current signatures. Drift detected by contract tests, not by silent breakage.

**Blast radius summary:** Low. The only change to the datum repo is 3 new lane-tool scripts (pure additions). datum-local is a greenfield sibling. No existing behavior modified.

## 9. Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| A1 | Sibling repo materialized via bootstrap scripts in this repo, not manual steps | Lane sandbox confines writes to cwd; bootstrap scripts committed here are the source-of-truth; `materialize.sh` creates `../datum-local/` as a one-shot idempotent step. The M1 driver sets cwd to the fixture repo so the sandbox covers writes naturally. | assumed (yolo) | Cross-repo constraint |
| A2 | Editable path dep (`[tool.uv.sources] datum = { path = "../datum", editable = true }`) works with uv for sibling layout | Confirmed by architecture investigation; `uv` supports path sources with `editable = true`. This is the only working install shape today since `path_utils.skill_root()` resolves relative to the source tree. | confirmed | n/a |
| A3 | Write-tool lane scripts do not exist yet and must be created | Verified: `WRITE_TOOLS = {"write_to_file", "replace_file_content", "multi_replace_file_content"}` defined at `local_llm.py:770-775` but no corresponding `.py` files exist in `scripts/lane-tools/` and no manifest entries. `lane_tools_runner` would reject them as `unregistered_tool`. | confirmed | n/a |
| A4 | `_execute_tool` sandbox allows `allowed_write_dirs` to extend the write boundary | Verified at `local_llm.py:813-815`: `for extra in mt_config.get("allowed_write_dirs", []): allowed_dirs.append(Path(extra).resolve())`. Config key exists and is respected. | confirmed | n/a |
| A5 | `multi_turn_phase` tool-execution mode is functional for read tools | Verified: `enable_tool_execution` gating at line 910, `max_tool_turns` at line 909, tool dispatch loop exists. Read tools have been exercised (epic-24). Write tools have not. | confirmed | n/a |
| A6 | commit_queue can be used from a sibling repo if cwd is the target project | `commit_queue.py` uses relative paths from cwd for git operations. If the M1 driver sets cwd to the fixture repo (a git repo), commit_queue should work. If socket-based mode requires the datum daemon, driver falls back to direct git subprocess. | assumed (yolo) | n/a |
| A7 | `state.py` functions (`load_state`, `resolve_tier`, `PHASES`) are importable without side effects | Verified: `load_state()` reads from `DB_FILE = Path(".datum/state.db")` which is cwd-relative. `resolve_tier()` reads config. `PHASES` is a module-level list. No import-time side effects. | confirmed | n/a |
| A8 | `schemas.StepPlan`, `StepResult`, `ToolCall` are the correct schema names for multi-turn | Verified at `datum/schemas.py:57-77`: `StepPlan`, `StepResult`, `ToolCall` all present as Pydantic BaseModel subclasses. | confirmed | n/a |
| A9 | No new external dependencies needed for M0+M1 | datum's existing deps (typer, rich, pydantic, pyyaml + memory extras) cover everything. Write-tool scripts are pure Python. datum-local adds no deps beyond datum itself for M0+M1. | assumed (yolo) | n/a |
| A10 | The fixture repo can be a git repo nested inside datum-local without submodule confusion | The fixture at `fixtures/toy-project/` is a standalone git repo created by the bootstrap script. It is `.gitignore`d in datum-local to avoid submodule issues. | assumed (yolo) | n/a |
| A11 | Model stack (Qwen3-30B-A3B + Llama-3.1-8B) is capable of generating valid tool calls for write operations | Read-tool calls work (epic-24). Write-tool calls have identical JSON schema (ToolCall model). The 80% success-rate target (4/5 runs) accounts for model variance. | assumed (yolo) | n/a |

## 10. Classification Metadata

```yaml
estimated_files: 18
estimated_loc: 650
clusters_touched: 2
new_public_api: false
dependency_additions: []
```

Breakdown:
- datum repo: 3 lane-tool scripts (~120 LOC) + 3 manifest entries (~20 LOC) + 1 integration test (~60 LOC) = ~200 LOC, 4 files modified/created
- datum-local repo (via bootstrap): pyproject.toml, __init__.py, README, config.toml, test_contracts.py, fixture project (2 files), m1_driver.py, test_m1_e2e.py, .gitignore, materialize.sh = ~14 files, ~450 LOC
- clusters: lane-tools (datum), datum-local (new)
