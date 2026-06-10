# Properties: datum-local M0+M1 -- sibling repo scaffold + prove the local write path

**Run ID:** epic-26
**Phase:** Properties

---

## Property Definitions

### Safety

| ID | Predicate | Tasks |
|---|---|---|
| SAFE-001 | Write-tool lane scripts NEVER write to a path that resolves outside `allowed_write_dirs` or `Path.cwd()` -- `_execute_tool` rejects the call with an error string before the runner is invoked | task-001, task-002 |
| SAFE-002 | `materialize.sh` NEVER overwrites an existing file in `../datum-local/` when the target already exists with non-zero size -- existing scaffold files are preserved, not clobbered | task-003 |
| SAFE-003 | `replace_file_content.py` NEVER silently succeeds when `old_text` is not found in the target file -- it exits non-zero with an error message | task-001, task-002 |
| SAFE-004 | The M1 driver NEVER stalls indefinitely -- `max_turns` and `timeout_s` budget caps from config.toml enforce termination | task-007 |
| SAFE-005 | Write-tool scripts NEVER follow symlinks that escape `allowed_write_dirs` -- `Path.resolve()` is applied before any write operation | task-001, task-002 |

### Liveness

| ID | Predicate | Tasks |
|---|---|---|
| LIVE-001 | Once `materialize.sh` is invoked from the datum repo root, `../datum-local/` ALWAYS exists with all scaffold files within 60 seconds | task-003 |
| LIVE-002 | Once `uv sync` completes in datum-local, `import datum.state` ALWAYS succeeds from that venv | task-003, task-005 |
| LIVE-003 | Once the M1 driver is invoked with a reachable local model, RED-GREEN ALWAYS completes (pass or structured failure record) within 5 minutes | task-007 |
| LIVE-004 | Once `_execute_tool` is called with a registered write tool and valid args, the tool ALWAYS returns a result tuple `(str, bool)` within `timeout_seconds` from the manifest | task-001, task-002 |
| LIVE-005 | Once the e2e test starts against a fresh fixture copy, it ALWAYS terminates (pass, fail, or skip) within 10 minutes | task-008 |

### Invariant

| ID | Predicate | Tasks |
|---|---|---|
| INV-001 | `config.toml` parsed by `tomllib` ALWAYS produces a valid dict with keys `[local_llm]`, `[multi_turn]`, and no key contains a value matching the regex `(?i)(claude\|anthropic\|sonnet\|opus\|haiku)` | task-004 |
| INV-002 | The fixture repo's baseline pytest suite ALWAYS passes before the M1 driver modifies any files | task-006 |
| INV-003 | After a successful M1 GREEN phase, `uv run pytest` in the fixture repo ALWAYS exits 0 | task-007, task-008 |
| INV-004 | `write_to_file.py` output on success ALWAYS contains the written file path and byte count as confirmation | task-001 |
| INV-005 | Every entry in `.datum/local-llm-metrics.jsonl` produced by M1 runs ALWAYS has a `model` field naming a local model (never a Claude/Anthropic model ID) | task-007, task-008 |

### Boundary

| ID | Predicate | Tasks |
|---|---|---|
| BOUND-001 | `write_to_file` with an empty string `content` MUST create an empty file (0 bytes), not error | task-001, task-002 |
| BOUND-002 | `replace_file_content` with `old_text` == `new_text` MUST succeed as a no-op (file unchanged) | task-001, task-002 |
| BOUND-003 | `multi_replace_file_content` with an empty `replacements` list MUST succeed as a no-op | task-001, task-002 |
| BOUND-004 | `multi_replace_file_content` with a `replacements` list where a later replacement depends on an earlier one MUST apply them sequentially (order-sensitive) | task-001, task-002 |
| BOUND-005 | `max_turns` set to 1 in config.toml MUST cause the M1 driver to exhaust budget after one turn and produce a structured failure record | task-007 |
| BOUND-006 | Fixture repo source file MUST be < 50 lines; fixture test file MUST be < 20 lines | task-006 |

### Idempotent

| ID | Predicate | Tasks |
|---|---|---|
| IDEM-001 | Running `materialize.sh` twice from the datum repo root produces the same `../datum-local/` directory state as running it once -- no duplicate files, no corrupted content | task-003 |
| IDEM-002 | Running `write_to_file` twice with identical `path` and `content` produces the same file state as running it once | task-001, task-002 |
| IDEM-003 | Running `uv sync` twice in datum-local produces the same venv state -- no extra packages, no broken links | task-003 |
| IDEM-004 | Running the contract test suite twice in succession produces the same pass/fail result | task-005 |

### Ordering

| ID | Predicate | Tasks |
|---|---|---|
| ORD-001 | `materialize.sh` MUST complete before any datum-local test can run -- contract tests, M1 driver, and e2e test all depend on the materialized scaffold | task-003 |
| ORD-002 | The M1 driver MUST execute RED phase (write failing test, confirm pytest failure) before GREEN phase (implement fix, confirm pytest pass) -- phases are never reordered or parallelized | task-007 |
| ORD-003 | Write-tool manifest entries MUST exist before `_execute_tool` can dispatch to them -- `lane_tools_runner` rejects unregistered tools with exit code 2 | task-001, task-002 |
| ORD-004 | `multi_replace_file_content` MUST apply replacements in list order (index 0 first, then 1, etc.) -- later replacements operate on the result of earlier ones | task-001 |

### Isolation

| ID | Predicate | Tasks |
|---|---|---|
| ISOL-001 | Config overlay in datum-local MUST NOT contain any Claude/Anthropic model IDs -- the strictly-local guarantee means no cloud LLM provider identifiers leak into any config value | task-004 |
| ISOL-002 | Write-tool sandbox MUST NOT allow datum-local's M1 driver to write files outside the fixture repo root when `allowed_write_dirs` is set to the fixture path | task-001, task-002, task-007 |
| ISOL-003 | Contract tests MUST NOT depend on a running oMLX server or any local model -- they test import signatures only, not inference | task-005 |
| ISOL-004 | The fixture repo's `.git` directory MUST NOT be a submodule of datum-local -- it is a standalone git repo, `.gitignore`d by datum-local | task-006 |
| ISOL-005 | Metrics written to `.datum/local-llm-metrics.jsonl` by the M1 driver MUST land in the fixture repo's `.datum/` directory (via `DATUM_PROJECT_DIR`), not in datum-local's root or this repo | task-007, task-008 |

### Performance

| ID | Predicate | Tasks |
|---|---|---|
| PERF-001 | A single M1 RED-GREEN run on the toy fixture MUST complete in under 5 minutes wall-clock time | task-007, task-008 |
| PERF-002 | `write_to_file` for a file under 10KB MUST complete in under 2 seconds | task-001, task-002 |
| PERF-003 | `replace_file_content` on a file under 10KB MUST complete in under 2 seconds | task-001, task-002 |
| PERF-004 | `materialize.sh` MUST complete the full scaffold creation (excluding `uv sync`) in under 10 seconds | task-003 |
| PERF-005 | The e2e test (`test_m1_e2e.py`) MUST enforce a 10-minute timeout and terminate if exceeded | task-008 |

### Security

| ID | Predicate | Tasks |
|---|---|---|
| SEC-001 | No Claude, Anthropic, Sonnet, Opus, or Haiku model identifier MUST appear anywhere in datum-local's `config.toml`, `m1_driver.py`, or any generated metrics file -- the strictly-local guarantee is a security/isolation boundary preventing accidental cloud API calls | task-004, task-007, task-008 |
| SEC-002 | Write-tool lane scripts MUST NOT execute arbitrary shell commands -- they perform only file I/O operations (open/read/write), never `subprocess`, `os.system`, or `eval` | task-001 |
| SEC-003 | `materialize.sh` MUST NOT fetch dependencies from the network during scaffold creation -- `uv sync` is the only network-capable step and it uses the standard PyPI index | task-003 |

### Observability

| ID | Predicate | Tasks |
|---|---|---|
| OBS-001 | Every M1 driver run MUST append at least one entry to `.datum/local-llm-metrics.jsonl` with fields: `timestamp`, `phase`, `model`, `tokens_used`, `duration_ms` | task-007, task-008 |
| OBS-002 | M1 driver failure runs MUST produce a structured JSON failure record with fields: `phase` (RED or GREEN), `attempts`, `reason`, `model`, `timestamp` -- not a bare traceback or silent stall | task-007 |
| OBS-003 | Write-tool invocations MUST be logged by `_execute_tool` with fields: `tool_name`, `exit_code`, `duration_ms`, `was_truncated` in the multi-turn trace | task-001, task-002 |
| OBS-004 | The e2e test MUST assert that `.datum/local-llm-metrics.jsonl` exists after a successful M1 run and contains >= 1 entry | task-008 |

### Compatibility

| ID | Predicate | Tasks |
|---|---|---|
| COMPAT-001 | Existing read-only lane tools (`read_file`, `grep_search`, `list_dir`, `read_file_range`, `run_command`, `find_callers`, `filter_gitnexus_output`) MUST remain unchanged in the manifest -- no existing tool entry is modified | task-001 |
| COMPAT-002 | `_execute_tool` with `enable_write_tools = false` MUST reject write-tool calls with an error string, preserving the existing default-deny behavior | task-002 |
| COMPAT-003 | `assets/config.toml.default` MUST NOT be modified -- `enable_write_tools` default remains `false` in the datum repo | task-004 |
| COMPAT-004 | Contract tests MUST use `inspect.signature()` to validate parameter names and count -- a renamed or removed parameter in datum's public API fails the test immediately | task-005 |
| COMPAT-005 | The editable path dependency (`datum = { path = "../datum", editable = true }`) MUST work with the current `path_utils.skill_root()` resolution -- `skill_root()` returns `Path(__file__).resolve().parent.parent` which is the datum repo root regardless of install location | task-003, task-005 |

---

## Traceability Table

| Property ID | Category | Predicate (short) | Task IDs |
|---|---|---|---|
| SAFE-001 | SAFETY | Write tools never escape sandbox | task-001, task-002 |
| SAFE-002 | SAFETY | materialize.sh never clobbers existing files | task-003 |
| SAFE-003 | SAFETY | replace_file_content never silently fails on missing old_text | task-001, task-002 |
| SAFE-004 | SAFETY | M1 driver never stalls (budget caps enforce termination) | task-007 |
| SAFE-005 | SAFETY | Write tools never follow symlinks escaping sandbox | task-001, task-002 |
| LIVE-001 | LIVENESS | materialize.sh always creates scaffold within 60s | task-003 |
| LIVE-002 | LIVENESS | import datum.state always works after uv sync | task-003, task-005 |
| LIVE-003 | LIVENESS | M1 RED-GREEN always completes or fails within 5 min | task-007 |
| LIVE-004 | LIVENESS | _execute_tool always returns result within timeout | task-001, task-002 |
| LIVE-005 | LIVENESS | e2e test always terminates within 10 min | task-008 |
| INV-001 | INVARIANT | config.toml valid dict, no cloud model IDs | task-004 |
| INV-002 | INVARIANT | Fixture baseline pytest always green | task-006 |
| INV-003 | INVARIANT | Post-GREEN fixture pytest always exits 0 | task-007, task-008 |
| INV-004 | INVARIANT | write_to_file confirms path + byte count | task-001 |
| INV-005 | INVARIANT | Metrics always name local models only | task-007, task-008 |
| BOUND-001 | BOUNDARY | write_to_file empty content creates 0-byte file | task-001, task-002 |
| BOUND-002 | BOUNDARY | replace same text = no-op success | task-001, task-002 |
| BOUND-003 | BOUNDARY | multi_replace empty list = no-op success | task-001, task-002 |
| BOUND-004 | BOUNDARY | multi_replace sequential order-sensitive | task-001, task-002 |
| BOUND-005 | BOUNDARY | max_turns=1 exhausts budget, structured failure | task-007 |
| BOUND-006 | BOUNDARY | Fixture source < 50 lines, test < 20 lines | task-006 |
| IDEM-001 | IDEMPOTENT | materialize.sh twice = same state | task-003 |
| IDEM-002 | IDEMPOTENT | write_to_file twice = same file | task-001, task-002 |
| IDEM-003 | IDEMPOTENT | uv sync twice = same venv | task-003 |
| IDEM-004 | IDEMPOTENT | Contract tests twice = same result | task-005 |
| ORD-001 | ORDERING | materialize.sh before any datum-local test | task-003 |
| ORD-002 | ORDERING | RED before GREEN, never reordered | task-007 |
| ORD-003 | ORDERING | Manifest entries before tool dispatch | task-001, task-002 |
| ORD-004 | ORDERING | multi_replace applies in list order | task-001 |
| ISOL-001 | ISOLATION | Config has zero cloud model IDs (strictly-local) | task-004 |
| ISOL-002 | ISOLATION | Write sandbox confines to fixture root | task-001, task-002, task-007 |
| ISOL-003 | ISOLATION | Contract tests independent of running model | task-005 |
| ISOL-004 | ISOLATION | Fixture .git is standalone, not submodule | task-006 |
| ISOL-005 | ISOLATION | Metrics land in fixture .datum/, not parent | task-007, task-008 |
| PERF-001 | PERFORMANCE | M1 RED-GREEN < 5 min wall-clock | task-007, task-008 |
| PERF-002 | PERFORMANCE | write_to_file < 2s for < 10KB | task-001, task-002 |
| PERF-003 | PERFORMANCE | replace_file_content < 2s for < 10KB | task-001, task-002 |
| PERF-004 | PERFORMANCE | materialize.sh scaffold < 10s (excl. uv sync) | task-003 |
| PERF-005 | PERFORMANCE | e2e test enforces 10-min timeout | task-008 |
| SEC-001 | SECURITY | No cloud model IDs anywhere in datum-local | task-004, task-007, task-008 |
| SEC-002 | SECURITY | Write tools: no subprocess/eval/os.system | task-001 |
| SEC-003 | SECURITY | materialize.sh no network (except uv sync) | task-003 |
| OBS-001 | OBSERVABILITY | Metrics JSONL has timestamp/phase/model/tokens/duration | task-007, task-008 |
| OBS-002 | OBSERVABILITY | Failure runs produce structured JSON record | task-007 |
| OBS-003 | OBSERVABILITY | Write-tool calls logged in multi-turn trace | task-001, task-002 |
| OBS-004 | OBSERVABILITY | e2e asserts metrics file exists with entries | task-008 |
| COMPAT-001 | COMPATIBILITY | Existing read tools unchanged in manifest | task-001 |
| COMPAT-002 | COMPATIBILITY | enable_write_tools=false still rejects writes | task-002 |
| COMPAT-003 | COMPATIBILITY | config.toml.default not modified | task-004 |
| COMPAT-004 | COMPATIBILITY | Contract tests use inspect.signature() | task-005 |
| COMPAT-005 | COMPATIBILITY | Editable dep works with skill_root() | task-003, task-005 |

---

## Per-Task Property Assignment

### task-001: Write-tool lane scripts + manifest entries
Properties to prove: SAFE-001, SAFE-003, SAFE-005, LIVE-004, INV-004, BOUND-001, BOUND-002, BOUND-003, BOUND-004, IDEM-002, ORD-003, ORD-004, ISOL-002, PERF-002, PERF-003, SEC-002, OBS-003, COMPAT-001

### task-002: Write-tool integration tests in datum repo
Properties to prove: SAFE-001, SAFE-003, SAFE-005, LIVE-004, BOUND-001, BOUND-002, BOUND-003, BOUND-004, IDEM-002, ORD-003, ISOL-002, PERF-002, PERF-003, OBS-003, COMPAT-002

### task-003: Bootstrap materialize.sh + scaffold templates
Properties to prove: SAFE-002, LIVE-001, LIVE-002, IDEM-001, IDEM-003, ORD-001, PERF-004, SEC-003, COMPAT-005

### task-004: Config overlay template
Properties to prove: INV-001, ISOL-001, SEC-001, COMPAT-003

### task-005: Contract-test suite template
Properties to prove: LIVE-002, IDEM-004, ISOL-003, COMPAT-004, COMPAT-005

### task-006: Fixture repo template
Properties to prove: INV-002, BOUND-006, ISOL-004

### task-007: M1 driver script template
Properties to prove: SAFE-004, LIVE-003, INV-003, INV-005, BOUND-005, ORD-002, ISOL-002, ISOL-005, PERF-001, SEC-001, OBS-001, OBS-002

### task-008: End-to-end integration test template
Properties to prove: LIVE-005, INV-003, INV-005, ISOL-005, PERF-001, PERF-005, SEC-001, OBS-001, OBS-004
