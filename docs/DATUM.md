# DATUM — Agentic Software Delivery & TDD

**Status:** Revision 5 (LEAN + Axiomatic Integration).
**Scope:** One epic. Build a portable Agent Skill that automates the full Refine → Plan → Properties → Act → Validate → Review → PR Comments → Closeout workflow.

**Set the reference. Then cut.**

-----

## 1. Purpose

DATUM is a software delivery methodology for agent-powered teams. In CNC machining, the datum is the fixed reference point — every measurement, every cut, and every inspection is relative to it. In this system, the **Spec is the Datum**.

**Set the reference. Then cut.**

The DATUM lifecycle operationalizes this philosophy through five stages:

*   **D — Define:** (Discovery & Refine) Set the reference. Translate business intent into a machine-verifiable Spec (The Datum).
*   **A — Architect:** (Plan) Map the blast radius and build the pipeline. Apply **Heijunka** load leveling and **SMED** brief caching.
*   **T — Test-Drive:** (Properties & Act) The production run. Pipelined three-agent TDD (RED/GREEN/REFACTOR) with the **Test Ratchet** (Poka-yoke).
*   **U — Unify:** (Validate, Review, PR) Verify against the reference. Surface high-friction **Gemba Verdicts** for human accountability.
*   **M — Measure:** (Closeout) Continuous improvement (**Kaizen**). Value Stream Mapping to identify bottlenecks and capture **Domain Wisdom**.

This skill operationalizes the DATUM philosophy by enforcing deterministic gates, GitNexus-backed impact analysis, and LEAN-inspired production efficiency. It treats tokens as raw materials and agents as a high-precision production line, ensuring that every line of code shipped is verifiable against the original reference.

-----

## 2. The Axioms of DATUM

DATUM is built on five core axioms that define the shift from human-centric to agentic software engineering:

1.  **Coding is no longer the bottleneck.** AI has effectively reduced the cost of code generation to near zero. The bottleneck has moved upstream (specification) and downstream (verification).
2.  **The Spec is the Datum.** Without a fixed reference point, agentic output is a "hallucinated drift." Every line of code must be a measurement relative to the spec.
3.  **Accountability Asymmetry.** Intelligence scales infinitely; accountability does not. AI can generate 10,000 PRs, but a human must still own the production incident. Governance must be structural, not supervisory.
4.  **The 2.5x Multiplier.** AI-assisted code generation takes ~1 unit of time, but hardening, testing, and integration take ~1.5 units. Total effort = 2.5x the generation time.
5.  **Set the reference. Then cut.** Never allow an agent to "guess" intent. If the spec is ambiguous, the line stops (The Spec-Break Rule).

-----

## 3. The Economics of DATUM

The "Capacity Trap" of AI adoption is that freed hours do not automatically become growth. DATUM redeploys the "AI Surplus" into high-integrity activities:

*   **Upstream:** Investing in deeper specification and property-based definitions.
*   **Downstream:** Investing in rigorous automated verification and "Shine" steps.
*   **Horizontal:** Building reusable "Lane Tools" to lower the cost of future work.

-----

## 4. Scope

### In scope

- Full 9-phase cycle: Discovery → Refine → Plan → Properties → Act → Validate → Review → PR Comments → Closeout
- One entry-point skill (`datum`) with phase playbooks loaded on demand via progressive disclosure
- Deterministic gates per phase with LLM-judged “input sufficient to skip” logic
- `--yolo` mode that bypasses optional gates but halts on hard stops
- State file (`.datum/state.json`) for phase tracking, RUN_ID, model log, per-lane progress, replay
- Per-RUN_ID archival of all artifacts under `.datum/runs/<RUN_ID>/`
- Three-agent ACT contract (RED / GREEN / REFACTOR) with context-isolation rules
- Pipelined lane dispatch (per-task lanes flow independently, capped at 7 concurrent agents)
- File-ownership conflict gating, dependency-DAG ordering, atomic per-task commits
- 3x retry loop per stage with model-tier escalation and known-failure-mode auto-recovery
- Full Git lifecycle: branch from main → commit-per-stage → PR → push fixes → tag → merge
- GitNexus integration as the impact-analysis and reindexing backbone
- Bootstrap of missing infrastructure (hooks, linters, CURRENT_STATE.md, ROADMAP.md, GitNexus index) behind a single human gate
- Token-efficiency agency for agents: write helper tooling, extract reusable scripts, prefer structured tools over scans
- Agentskills.io-conformant package layout for cross-tool portability
- Slash command registration where supported (Claude Code, Codex, etc.) plus phrase-based fallback for tools without slash commands
- Config file at repo root (`.datum/config.toml`) for model tier overrides, gate policy, and skill version pinning
- Skill version migration (`datum migrate`)

### Out of scope

- Inventing new workflow phases beyond the documented 9
- Replacing GitNexus, the linter, the formatter, or the test runner — the skill orchestrates them
- Cross-repo orchestration (single-repo per invocation)
- Knowledge graph storage outside GitNexus
- Non-Git VCS support

-----

## 3. Public interface

### 3.1 Invocation surface

|Surface            |Where it works                                       |Behavior                                                                                                                  |
|-------------------|-----------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|
|`/datum <subcommand>`|Tools with slash-command support (Claude Code, Codex)|Direct subcommand dispatch                                                                                                |
|Phrase trigger     |Any tool that loads `SKILL.md` per agentskills.io    |“datum go”, “datum refine”, “datum yolo”, etc. activate the skill                                                               |
|Auto-suggest       |Any tool with skill discovery                        |Skill self-activates when it detects a `TICKET.md`, `SPEC.md`, or `TASKS.md` in the working directory and offers to resume|

### 3.2 Subcommands

|Subcommand   |Action                                                                             |
|-------------|-----------------------------------------------------------------------------------|
|`datum go`     |Run from current phase (detected from artifacts) through to merge, halting at gates|
|`datum yolo`   |Same as `go` but skip all optional gates; halt only on hard stops                  |
|`datum <phase>`|Run a single phase end-to-end (e.g., `datum refine`, `datum plan`, `datum act`)          |
|`datum resume` |Resume from `.datum/state.json` after interruption                                   |
|`datum status` |Print current phase, RUN_ID, per-lane progress, last failure if any                |
|`datum init`   |Bootstrap hooks, linter, GitNexus, CURRENT_STATE.md, ROADMAP.md (human-gated)      |
|`datum migrate`|Upgrade state and artifact schemas across skill versions                           |
|`datum archive`|Force-archive current RUN_ID without proceeding                                    |
|`datum reset`  |Discard current RUN_ID state (with confirmation)                                   |

### 3.3 Inputs

The skill accepts as input any of:

- A path to `TICKET.md` (Refine entry point)
- An existing `SPEC.md` (Plan entry point)
- An existing `TASKS.md` + `PROPERTIES.md` (Act entry point)
- An open PR URL (PR Comments entry point)
- Nothing — skill reads `.datum/state.json` to resume

The skill detects the correct entry point from artifacts present.

### 3.4 Outputs

Per DATUM cycle, the skill produces and archives under `.datum/runs/<RUN_ID>/`. Artifacts are listed in dependency order: each depends only on artifacts earlier in the list.

**Pre-merge artifacts (produced by phases 1–7):**

- `SPEC.md` — refined requirements
- `TASKS.md` — implementation plan, topologically sorted, machine-readable
- `PROPERTIES.md` — 11-category invariants with traceability table
- `lane-plan.json` — DAG of lanes with file-ownership conflict edges and dependency edges
- `review-packets/` — per-domain review JSON packets
- `REVIEW-REPORT.md` — rendered from review packets
- `triage.json` — PR comment triage verdicts
- `brief-defects.json` — RED briefs that missed ACs (surfaced by REFACTOR), accumulated during ACT
- `lane-tools-added.json` — helper scripts added during this epic, accumulated during ACT

**Closeout artifacts (produced by phase 8, after merge):**

- `closeout-data.json` — collated data, sole input to synthesis stage (schema in section 4.9)
- `wait-time-metrics.json` — lead-time analysis (Wait vs. Work time) for all lanes
- `CURRENT_STATE.md` — updated project state post-epic
- `ROADMAP.md` — updated (epic moved to Completed; downstream dependencies recalculated)
- `CHANGELOG.md` — updated with epic entries
- `RETRO.md` — retro report grounded in `closeout-data.json`
- `solutions/<slug>.md` — one per detected solved problem
- `follow-ups.json` — gaps found during closeout, triaged by severity, ready for issue tracker filing
- `token-metrics.json` — total token cost, per-phase and per-stage breakdown
- Git tag `closeout-epic-<N>-<YYYYMMDD>` on the merge commit
- Filed issues in the configured issue tracker (or `follow-ups.json` retained as manifest if no tracker configured)
- GitNexus reindex (async, captured as `gitnexus-reindex.log`)

-----

## 4. Architecture

### 4.1 Package layout (agentskills.io conformant)

```
datum/
├── SKILL.md                   YAML frontmatter + body, <500 lines
├── references/
│   ├── 00-discovery.md
│   ├── 01-refine.md
│   ├── 02-plan.md
│   ├── 03-properties.md
│   ├── 04-act.md
│   ├── 04-act-red-brief.md     Brief schema and rules for RED agents
│   ├── 04-act-green-brief.md   Brief schema and rules for GREEN agents (context isolation)
│   ├── 04-act-refactor-brief.md  Brief schema and rules for REFACTOR agents
│   ├── 04-act-swift.md          Language-specific overrides, auto-selected
│   ├── 04-act-typescript.md
│   ├── 04-act-go.md
│   ├── 04-act-python.md
│   ├── 05-validate.md
│   ├── 06-review.md
│   ├── 07-pr-comments.md
│   ├── 08-closeout.md
│   ├── property-categories.md
│   ├── model-tiers.md
│   ├── pipeline-dispatch.md
│   ├── token-efficiency.md
│   ├── lane-tooling-protocol.md
│   ├── gitnexus-playbook.md
│   └── recovery-modes.md
├── scripts/
│   ├── state.py
│   ├── gate.py
│   ├── archive.py
│   ├── lane_plan.py           Builds DAG from TASKS.md; outputs lane-plan.json
│   ├── pipeline_scheduler.py  Runs lanes, enforces concurrency cap and conflict gates
│   ├── commit_queue.py        Serializes commits to work branch via advisory lock
│   ├── diff_normalize.py      Tool-adapter outputs → unified diff for commit queue
│   ├── test_signal.py         Redacts test runner output for GREEN; fail-closed
│   ├── test_signal_self_test.py   Canary self-test for redactor; runs on every test_signal commit
│   ├── test_ratchet.py        Pre-commit hook; deterministic test-strengthening enforcement
│   ├── test_ratchet/
│   │   ├── xctest.toml        Strict-to-loose assertion pattern list
│   │   └── vitest.toml
│   ├── diagnose_failure.py    Classifies failures as ENVIRONMENTAL / REASONING / UNKNOWN
│   ├── lane-tools-runner.py   Sandbox subprocess wrapper for lane-tools
│   ├── collate.py
│   ├── render.py
│   ├── language_detect.py
│   ├── bootstrap/
│   │   ├── install_hooks.py
│   │   ├── install_linter_rules.py
│   │   ├── seed_state_docs.py
│   │   └── gitnexus_setup.py
│   ├── lane-tools/            Helper scripts added by agents during epic execution
│   │   ├── README.md          Agents read this to know what tools already exist
│   │   └── manifest.toml      Declares permissions and timeouts for each tool (4.5.5)
│   └── closeout/
│       ├── collect_git.py
│       ├── collect_tasks.py
│       ├── collect_platform.py
│       ├── collect_lane_tools.py
│       ├── collect_brief_defects.py
│       ├── collect_token_metrics.py
│       ├── collect_gitnexus_diff.py
│       ├── detect_solutions.py
│       ├── collate.py
│       ├── commit_closeout.py
│       ├── tag_epic.py
│       ├── file_followups.py
│       ├── gitnexus_reindex.py
│       └── archive.py
└── assets/
    ├── templates/
    │   ├── SPEC.md
    │   ├── TASKS.md
    │   ├── PROPERTIES.md
    │   ├── CURRENT_STATE.md
    │   └── ROADMAP.md
    ├── schemas/
    │   ├── task.schema.json
    │   ├── property.schema.json
    │   ├── finding.schema.json
    │   ├── packet.schema.json
    │   ├── lane.schema.json
    │   ├── brief-red.schema.json
    │   ├── brief-green.schema.json
    │   ├── brief-refactor.schema.json
    │   ├── closeout-data.schema.json
    │   ├── follow-up.schema.json
    │   └── state.schema.json
    ├── config.toml.default
    └── hooks/
        ├── pre-commit-layer-boundary.sh
        ├── pre-commit-file-size.sh
        ├── pre-commit-tdd-guard.sh
        ├── pre-commit-banned-patterns.sh
        ├── pre-commit-test-ratchet.sh           Wraps test_ratchet.py
        ├── pre-commit-lane-tools-manifest.sh    Enforces manifest entry for lane-tools
        └── pre-tool-use-install-interceptor.sh  Blocks pip/npm/etc. install commands
```

### 4.2 Phase model

Each phase is a reference markdown file (`references/NN-phase.md`) loaded on demand by the orchestrator. The orchestrator (`SKILL.md` body) is a thin dispatcher that:

1. Reads `.datum/state.json`
1. Determines current phase from artifacts and state
1. Loads the relevant reference doc
1. Loads any language-specific override (`04-act-<lang>.md`)
1. Loads `gitnexus-playbook.md` if any GitNexus call is required this phase
1. For ACT, loads the three brief specs and `pipeline-dispatch.md`
1. Executes the phase per the playbook
1. Runs the gate validator script
1. Updates state, archives artifacts, transitions to next phase

### 4.3 State file (`.datum/state.json`)

Schema (informal):

```
{
  "run_id": "epic-N-YYYYMMDD-hhmmss",
  "skill_version": "1.0.0",
  "current_phase": "act",
  "phases": {
    "refine":     { "status": "completed", "model": "opus-4.7",   "artifact": "SPEC.md",       "completed_at": "..." },
    "plan":       { "status": "completed", "model": "opus-4.7",   "artifact": "TASKS.md",      "completed_at": "..." },
    "properties": { "status": "completed", "model": "opus-4.7",   "artifact": "PROPERTIES.md", "completed_at": "..." },
    "act":        { "status": "in_progress", "model": "sonnet-4.6", "started_at": "..." }
  },
  "lanes": {
    "task-001": {
      "stage": "REFACTOR",
      "stages": {
        "RED":      { "status": "committed", "agent": "...", "retries": 0, "commit_sha": "..." },
        "GREEN":    { "status": "committed", "agent": "...", "retries": 1, "commit_sha": "..." },
        "REFACTOR": { "status": "in_progress", "agent": "...", "retries": 0 }
      },
      "files_touched": ["Sources/Domain/X.swift", "Tests/Unit/Domain/XTests.swift"],
      "depends_on": []
    },
    "task-002": {
      "stage": "GREEN",
      "stages": {
        "RED":   { "status": "committed", "retries": 0, "commit_sha": "..." },
        "GREEN": { "status": "in_progress", "retries": 0 }
      },
      "files_touched": ["Sources/Domain/Y.swift", "Tests/Unit/Domain/YTests.swift"],
      "depends_on": []
    },
    "task-003": {
      "stage": "queued",
      "blocked_on_dependency": ["task-001"],
      "blocked_on_file_conflict": null
    },
    "task-004": {
      "stage": "queued",
      "blocked_on_dependency": [],
      "blocked_on_file_conflict": "Storage.swift -> task-002"
    }
  },
  "in_flight_count": 2,
  "in_flight_cap": 7,
  "git": {
    "base_branch": "main",
    "work_branch": "datum/epic-N",
    "head_sha": "..."
  },
  "brief_defects": [],
  "lane_tools_added": [],
  "gemba_verdicts": [],
  "wait_times": {
    "task-001": { "queued_at": "...", "started_at": "...", "completed_at": "..." }
  },
  "config_hash": "sha256:...",
  "gitnexus_index_sha": "..."
}
```

### 4.4 Config file (`.datum/config.toml`)

```toml
[skill]
version = "1.0.0"

[models]
reasoning = "opus-4.7"
standard  = "sonnet-4.6"
fast      = "haiku-4.5"

# Per-phase overrides
[models.phases]
refine     = "reasoning"
plan       = "reasoning"
properties = "reasoning"
act_red    = "standard"
act_green  = "standard"
act_refactor = "standard"   # may escalate to reasoning on integration tasks
validate   = "standard"
review     = "standard"
pr_comments_triage = "reasoning"
pr_comments_fix    = "standard"
closeout_synthesis = "reasoning"
source_inspection  = "fast"

[gates]
# "required" | "skippable_if_complete" | "skipped"
refine_human_review     = "skippable_if_complete"
plan_human_approval     = "required"
properties_human_review = "skippable_if_complete"
validate_human_review   = "skippable_if_complete"
triage_human_approval   = "required"
merge_human_approval    = "required"

[yolo]
# Even in yolo, these hard stops cannot be bypassed.
# Hard stops are enforced by the hook layer (section 4.4.1), not by agent compliance.
hard_stops = [
  "tests_red_after_3x_retry",
  "hook_blocked_write",
  "merge_conflict",
  "git_push_rejected",
  "schema_validation_failed",
  "gitnexus_high_risk_unconfirmed",
  "gitnexus_unavailable_high_change_volume",
  "external_dependency_install_proposed",
  "test_ratchet_violation",
  "lane_tool_sandbox_violation",
]

[pipeline]
max_concurrent = 7
green_blindness_strict = true   # GREEN agents never see test source; only assertion text
refactor_batched = false         # If true, REFACTOR sweeps a separate stage across all lanes

[pipeline.load_leveling]
# Heijunka: prevent overburdening expensive tiers or the commit queue
max_reasoning_tier_concurrent = 2
max_standard_tier_concurrent = 5
balancing_strategy = "weighted_round_robin"

[pipeline.hygiene]
# 5S: Workspace hygiene rules
require_shine_step = true
delete_tmp_on_success = true
check_unused_imports = true
standardize_lane_tools = true

[git]
branch_prefix = "datum/"
tag_format    = "closeout-epic-{N}-{YYYYMMDD}"
commit_per    = "stage"  # one commit per stage per task: RED, GREEN, REFACTOR each commit independently

[gitnexus]
enabled = true
reindex_on_closeout = true
impact_required_phases = ["plan", "act", "validate", "review"]
risk_threshold_yolo_halt = "high"

[token_efficiency]
agent_tooling_agency = true
lane_tools_dir = "scripts/lane-tools/"
require_tool_description = true     # New helper must include README entry
prefer_structured_tools_over_scan = true   # Agents must prefer GitNexus/AST over grep
tooling_commits_count_against_retry = false

[tools]
# Adapters for each tool's subagent primitive
claude_code = { subagent = "Task", slash = true }
codex       = { subagent = "task",  slash = true }
opencode    = { subagent = "agent", slash = false }
kiro        = { subagent = "spawn", slash = false }
gemini_cli  = { subagent = "subagent", slash = false }
```

### 4.4.1 Pre-execution interception

Listing a hard stop in `config.toml` is only meaningful if the skill can actually prevent the prohibited action. Hard stops are enforced at two layers:

**Hook layer (preferred).** For tools that support PreToolUse hooks (Claude Code, etc.), the skill installs a hook that intercepts shell commands matching install patterns:

```
pip install        npm install        npm i        pnpm add        yarn add
apt-get install    brew install       cargo add    go get          gem install
gh extension install                  conda install                poetry add
```

The hook returns exit code 2 with a diagnostic, blocking the command. The orchestrator surfaces the request to the user via gate. On approval, the orchestrator runs the install itself (outside the hook), then resumes the lane.

**Subprocess wrapper layer (fallback).** For tools without PreToolUse hooks, each lane runs in a subprocess whose `PATH` prefixes a wrapper directory. The wrappers shadow install commands and require a runtime approval token (read from `.datum/runs/<RUN_ID>/.install-approved-<hash>`). Without the token, the wrapper exits with the same diagnostic as the hook.

This is also the enforcement layer for:

- Lane-tool sandboxing (section 5.5)
- Test-ratchet violations (section 4.6.4)
- File writes outside the lane’s declared file set
- Network access from lane-tools that don’t declare network permission

Hard stops are facts, not policies. The list in `[yolo].hard_stops` is the authoritative set; the hook/wrapper layer is generated from it on `datum init`.

### 4.5 GitNexus integration

GitNexus is a first-class dependency. The skill calls GitNexus MCP tools at these points:

|Phase                |GitNexus call                                |Why                                                |
|---------------------|---------------------------------------------|---------------------------------------------------|
|Bootstrap            |`gitnexus setup`, `gitnexus analyze --skills`|One-time per repo                                  |
|Discovery            |`query`, `list_repos`                        |Architecture survey                                |
|Refine               |`context` on symbols mentioned in TICKET.md  |Verify ticket assumptions hold                     |
|Plan                 |`impact` on each proposed change site        |Inform lane file-ownership grouping by blast radius|
|Plan                 |`cypher` for custom dependency traversals    |When `impact` is insufficient                      |
|Properties           |`context` for derivation of invariants       |What currently calls this; what must remain true   |
|Act (lane pre-flight)|`detect_changes` on planned diff             |Pre-flight risk gate                               |
|Act (rename tasks)   |`rename`                                     |Coordinated multi-file symbol rename               |
|Validate             |`detect_changes` on full PR diff             |Risk-scored validation                             |
|Review               |`impact` per finding                         |Confirm severity matches blast radius              |
|PR Comments          |`context` on each commented file             |Inform triage                                      |
|Closeout             |`gitnexus analyze`                           |Reindex with post-epic state                       |

**Degraded mode.** If GitNexus is unavailable (no MCP support in the active tool, or `gitnexus analyze` has not been run), the skill enters degraded mode:

- The hard stop `gitnexus_high_risk_unconfirmed` is replaced by `gitnexus_unavailable_high_change_volume`. This is a heuristic threshold based on file count and LOC delta, not a real impact analysis. It is intentionally conservative.
- Any change exceeding the heuristic threshold escalates to human approval, including under `yolo`. Yolo does not bypass risk gates in degraded mode — degraded mode is the gate.
- The skill does not claim “low risk” in degraded mode. It claims “risk unknown, below volume threshold” or “risk unknown, above volume threshold.”
- Grep and AST tools are used for lookups (find callers, locate symbols), but never for risk assessment. Risk assessment requires the structured impact graph or human judgment.
- Degradation is logged to `.datum/state.json` with timestamp and reason; surfaced in Closeout retro.

This eliminates the contradiction in revision 3 where degradation simultaneously allowed grep-as-fallback and listed `gitnexus_high_risk_unconfirmed` as a yolo hard stop. The two are reconciled: degraded mode replaces the gate with a stricter one.

### 4.6 ACT phase — three-agent contract

Each task has its own lane. A lane runs three agents in strict sequence: RED → verify red → GREEN → verify green → REFACTOR → verify final. The three agents have different context disclosure rules to preserve the epistemic value of test-first development.

#### 4.6.1 RED agent

**Inputs (sees):**

- SPEC.md
- PROPERTIES.md (the properties this task must prove)
- TASKS.md task entry (AC, files, RED note)
- GitNexus `context` for relevant symbols
- `scripts/lane-tools/` README
- Signature stubs from lanes this task depends on (see Stub Protocol below)

**Forbidden (does not see):**

- Implementation code being added in this task
- Other tasks’ GREEN outputs in flight

**Output:**

- Failing test files only. No implementation.
- A signature stub file for any new types/methods this task introduces, committed before the failing test (see Stub Protocol).
- Confirms test fails for the right reason (assertion text matches the property under test).
- Commits the failing test.

**Done condition:** test runner returns red AND the failure message references the property under test.

**Stub Protocol (resolves DAG bottleneck for signature dependencies):**

Many lane dependencies are on *signatures* (the type exists, the method is callable), not on *behavior*. Without stubs, Lane D’s RED can’t run until Lane A’s GREEN commits, because D’s test won’t compile against a nonexistent type. With stubs, the dependency collapses to a much shorter wait.

Each RED agent emits two commits:

1. **Stub commit** — signature-only declaration of any new public types/methods this task introduces. Method bodies are `fatalError("not implemented")` (Swift) / `throw new Error("not implemented")` (TS) / equivalent. No logic.
1. **Test commit** — the failing test, written against the stubbed signature.

Dependent lanes can start their RED as soon as the upstream lane’s **stub commit** lands, not the GREEN commit. The dependency DAG splits into two layers:

- *Signature dependency* — satisfied by stub commit. Dependent RED can start.
- *Behavior dependency* — satisfied by GREEN commit. Dependent GREEN must wait for upstream GREEN.

For most lanes, signature dependency is the binding constraint. The concurrency cap is now meaningful again.

State file gains a sub-stage marker:

```
"task-001": {
  "stage": "RED",
  "sub_stage": "stub_committed",   // or "test_committed", "verified_red"
  ...
}
```

The stub-first protocol is mandatory for tasks that introduce new public types or methods. Pure-internal tasks (no new external surface) skip the stub commit.

#### 4.6.2 GREEN agent

**Inputs (sees):**

- SPEC.md
- PROPERTIES.md
- TASKS.md task entry (AC, files)
- GitNexus `context` for relevant symbols
- `scripts/lane-tools/` README
- Pass/fail signal from the test runner
- **Redacted failure signal** extracted by `scripts/test_signal.py`. Contents:
  - For assertion failures: assertion message text (the human-readable failure), expected vs actual values if the runner emits them as discrete fields, the property ID under test
  - For compile/type errors: error kind (e.g., `undeclared identifier`, `type mismatch`, `missing argument label`), symbol name involved, error code, file and line number — **never** the test source line content itself
  - For runtime errors before assertion: exception type, exception message, stack trace with test file frames preserved as file:line only (no source code from those lines)

**Forbidden (does not see):**

- Test source code
- Test names
- The RED agent’s brief or commit message
- Any file in the test directory at read time (enforced by lane sandbox permissions)

**Output:**

- Implementation files only. No test edits.
- Minimum code to pass.
- Commits the implementation.

**Done condition:** test runner returns green.

**Failure handling:** when GREEN’s code doesn’t pass, a *new* GREEN agent is spawned with the same brief plus accumulated redacted failure signal. Same-agent retry is forbidden — fresh context per attempt. On retry 2, the new agent uses the Reasoning tier.

**Compile-error special case:** if the test fails to compile because GREEN has not yet declared a required type or method, the redacted signal includes the missing symbol name and the expected signature (extracted from the compiler error, not from the test source). This is the minimum information GREEN needs to make progress without seeing the test logic.

**Fail-closed semantics:** if `test_signal.py` cannot cleanly redact the failure output (parser hits an unknown framework, or output format changed), GREEN receives a `signal_redaction_failed` flag, no failure detail, and the lane halts. This is correct behavior — better to halt than risk leaking test source into the GREEN context.

#### 4.6.3 REFACTOR agent

**Inputs (sees):**

- Everything: SPEC, PROPERTIES, AC, the implementation, the test source, the test results, GitNexus impact data
- `scripts/lane-tools/`

**Allowed actions:**

- Modify implementation to fully meet SPEC and AC (not just minimum)
- Add error handling, edge case coverage, observability per SPEC
- Refactor for clarity, layering, performance per the project’s design principles
- Extract or use lane-tools helpers

**Forbidden actions:**

- Relax or remove tests. Tests are a one-way ratchet — REFACTOR may make them stricter (rare), never weaker.
- Add new tests. If REFACTOR finds a missing AC, it fails the task back; the orchestrator spawns a new RED-GREEN cycle and logs the gap to `brief-defects.json`.
- Introduce new external dependencies without surfacing to user.

**Output:**

- Refined implementation. Optionally lane-tools additions.
- **Gemba Verdict:** A concise report of the hardest technical decision made, surfaced to the human reviewer during the gate.
- **5S Shine:** Verification that all temporary artifacts (logs, `.tmp` files) are removed and the workspace is standardized before commit.
- Commits the refinement.

**Done condition:** all tests green, all hooks pass, linter clean, formatter clean, AC checklist satisfied, 5S hygiene check complete.

#### 4.6.4 Test ratchet enforcement

REFACTOR’s prohibition on relaxing tests cannot rely on LLM self-policing. Enforcement is deterministic and runs pre-commit on every REFACTOR commit.

`scripts/test_ratchet.py` runs as a pre-commit hook on commits that touch test files. It diffs the test files in the staging area against the same files at the prior commit and rejects the commit if any of the following are detected:

1. **Removed test.** A `@Test`, `func test...`, `it(...)`, `def test_...`, `func Test...` declaration present in the prior commit is absent in the new commit, and not present elsewhere in the test suite.
1. **Deleted assertion.** Lines matching the framework’s assertion patterns (`#expect`, `XCTAssert*`, `expect(...).to*`, `assert*`, etc.) present in the prior commit are absent in the new commit.
1. **Weakened assertion.** Heuristic patterns: `expect(x).toEqual(y)` → `expect(x).toBeDefined()`, `XCTAssertEqual(a, b)` → `XCTAssertNotNil(a)`, `assertThat(x).isEqualTo(y)` → `assertThat(x).isNotNull()`. The ratchet maintains a per-framework list of strict-to-loose pairs and flags any diff that walks down the list.
1. **Renamed-to-disable.** A test renamed with a prefix matching the framework’s skip pattern (`xtest_`, `xit`, `@Disabled`, `t.Skip()`, etc.) without a referenced follow-up issue in the commit message.

The ratchet returns exit 2 with a diagnostic listing the violation. The orchestrator surfaces it; REFACTOR retries with the violation in its brief.

These are heuristics — they catch the common cases, not every conceivable test-weakening pattern. The remaining gap is documented as a known limitation. A sophisticated agent could still defeat them, but the heuristics make accidental weakening (the actual common failure mode) detectable.

The ratchet is per-framework. Each framework’s pattern set lives in `scripts/test_ratchet/<framework>.toml`. v1 ships XCTest and Vitest/Jest patterns; other frameworks contribute their own.

#### 4.6.5 `test_signal.py` specification

`test_signal.py` is the chokepoint that preserves GREEN blindness. It is a v1 deliverable, not a Plan-phase question.

**Inputs:** raw output from a test runner (structured JSON where available, parsed text where not), the test framework name.

**Outputs:** a `TestSignal` JSON object:

```
{
  "status": "pass" | "fail" | "compile_error" | "runtime_error" | "redaction_failed",
  "assertion_failures": [
    {
      "property_id": "SAFE-001",          // extracted from test attribute or name suffix
      "assertion_message": "...",          // the runner's human-readable message
      "expected": "...",                   // discrete field if runner provides it
      "actual": "..."                      // discrete field if runner provides it
    }
  ],
  "compile_errors": [
    {
      "kind": "undeclared_identifier",     // canonical kind name
      "symbol": "RecordingMetadata",
      "expected_signature": "...",         // if compiler emits it
      "error_code": "E0425",
      "file": "Tests/Unit/Foo.swift",
      "line": 42
      // never: source line content from that file
    }
  ],
  "runtime_errors": [
    {
      "exception_type": "...",
      "message": "...",
      "frames": [ { "file": "...", "line": 42 } ]   // file:line only, no source content
    }
  ]
}
```

**Framework parsers (v1):**

- **XCTest** — parses `xcodebuild test` JSON output via `xcresulttool`, or `swift test --enable-experimental-swift-testing` JSON output for Swift Testing
- **Vitest/Jest** — parses `--reporter=json` output

**Fail-closed behavior:** if the parser encounters an unknown framework, an unrecognized output format, or a malformed input, it returns `{"status": "redaction_failed", ...}` with no failure detail. The lane halts. The orchestrator surfaces “test_signal.py could not safely redact output for framework X — extend the parser or run with framework support.”

**Source content invariant:** the redactor never copies bytes from any file under the test directory into its output. This is enforced by a self-test in `test_signal.py` that fuzzes the parser against test files containing canary strings and asserts the canaries never appear in any output. The self-test runs on every commit to `test_signal.py` itself.

**Other frameworks** (pytest, go test, etc.) are explicit v1 gaps. Adding a framework parser is a small, well-scoped contribution. Until added, the skill refuses to run in ACT for repos using unsupported frameworks rather than risk leakage.

### 4.7 Pipeline dispatch

Replaces the wave model from revision 1.

#### 4.7.1 Lane model

Each task is one lane. A lane runs RED → GREEN → REFACTOR sequentially. Lanes do not synchronize with each other at stage boundaries — Lane A’s GREEN can run while Lane B is still in RED.

```
Time →

Lane A:  RED ─→ verify ─→ GREEN ─→ verify ─→ REFACTOR ─→ done
Lane B:        RED ────→ verify ─→ GREEN ─────→ verify ─→ REFACTOR ─→ done
Lane C:              RED ─────→ verify ─→ GREEN ─→ ...
Lane D:                     queued (blocked on Lane A dependency)
```

#### 4.7.2 Constraints

The scheduler enforces:

1. **Within-lane sequencing.** RED → GREEN → REFACTOR is strict. GREEN does not start until RED has committed. REFACTOR does not start until GREEN has committed and the test runner is green.
1. **Dependency DAG.** Lanes whose tasks depend on types or modules from other tasks wait until those tasks’ GREEN commits land. `lane_plan.py` builds this DAG from TASKS.md.
1. **File-ownership conflict gating.** Two lanes whose stages would write to the same file cannot be in their write stages simultaneously. The scheduler holds a lane at the stage boundary if its next stage would conflict with another lane’s in-flight write. (Reads do not conflict.)
4. **Concurrency cap.** At most 7 agents in flight across all lanes and stages combined. The 8th lane waits.
5. **Model-tier load leveling (Heijunka).** The scheduler prevents token budget spikes by capping concurrent Reasoning-tier agents (default 2) and Standard-tier agents (default 5).
6. **Commit serialization.** Commits to the shared work branch are serialized by an explicit commit queue, not by hope. See section 4.7.5.
7. **Diff protocol uniformity.** All lane outputs are normalized to unified diff before commit, regardless of which tool’s edit primitive produced them. See section 4.7.6.

#### 4.7.3 Lane failure

A lane that exhausts its 3x retry budget (per stage) halts only itself. Other lanes continue. The orchestrator collects a diagnostic packet for the failed lane and surfaces it at the next sync point (or sooner if it blocks dependent lanes).

#### 4.7.4 Sync point

The pipeline ends when all lanes complete or fail terminally. That is the natural sync point for Validate. Validate runs against the integrated result of all completed lanes, not per-lane.

```
Pipeline:        Lanes streaming, ≤7 concurrent
                            ↓
Sync barrier:    All lanes done
                            ↓
Validate → Review → PR Comments → Closeout
```

#### 4.7.5 Commit queue

Git does not allow concurrent writes to a branch. The pipeline scheduler must serialize commits explicitly, not assume they “just work” because file sets don’t overlap.

Architecture:

```
Lane agent finishes stage
    ↓
Lane emits commit-ready signal with:
  - lane_id, stage (RED|stub|test|GREEN|REFACTOR)
  - patch (unified diff format, see 4.7.6)
  - intended commit message
  - file set touched
    ↓
Commit queue (single writer):
  - acquires advisory lock on .datum/locks/branch.lock
  - fetches latest HEAD
  - applies patch via `git apply --3way`
  - on success: runs pre-commit hooks (ratchet, layer boundary, etc.)
  - on success: creates commit, updates HEAD
  - releases lock
  - signals lane that commit succeeded with new SHA
    ↓
Lane proceeds to next stage
```

The queue is FIFO by stage completion time. A lane whose patch fails to apply (because an earlier commit changed an overlapping line — this can only happen if file-ownership gating had a bug) is sent back to the agent with the conflict diagnostic; agent re-runs with current HEAD as context. This is treated as an environmental failure (section 4.8), not an agent failure.

The commit queue is a small Python process spawned at pipeline start and shut down at pipeline end. It maintains an in-memory queue and the advisory lock. Lane agents communicate with it via a Unix socket or named pipe (configurable; defaults to socket at `.datum/runs/<RUN_ID>/commit-queue.sock`).

#### 4.7.6 Diff application protocol

Different agentic tools have different file-edit primitives. Some emit search/replace blocks, some write whole files, some emit structured edit operations. The pipeline scheduler cannot accept this variety directly.

Protocol: all lane agents produce a **unified diff** as their final output for the commit queue. Each tool adapter (section 4.4 `[tools]`) is responsible for translating from the tool’s native edit primitive to unified diff *before* the patch reaches the commit queue.

- **Claude Code, Codex** — agents already produce diffs natively or via str_replace; adapter wraps str_replace outputs into unified diff
- **opencode, Kiro, Gemini CLI** — adapter captures the agent’s write operations against a scratch directory, then `diff -u`s the scratch against the original

The commit queue applies all diffs via `git apply --3way --whitespace=fix`. This is uniform regardless of source tool. If a diff fails to apply, the diagnostic is identical across tools.

This also gives a single audit point: every change that lands in main passes through a unified-diff inspection by the orchestrator, and the diff is archived in the RUN_ID directory for replay.

### 4.8 Failure recovery

3x retry loop per stage per lane. Every failure is first classified by `scripts/diagnose_failure.py` to distinguish *environmental causes* (where escalating the model wastes tokens because the bug is not in agent reasoning) from *reasoning causes* (where escalation is appropriate).

**Diagnosis-first protocol:**

```
Lane stage fails
    ↓
diagnose_failure.py runs:
  - Inspect build/test/runtime logs against known environmental patterns
  - Check git tree state, GitNexus index freshness, dependency DAG satisfaction
  - Check for missing files, missing types, dirty working tree
    ↓
Diagnosis result:
  - ENVIRONMENTAL  → fix in place at same model tier; retry counter NOT incremented
  - REASONING      → enter retry ladder (below); increment counter
  - UNKNOWN        → enter retry ladder conservatively; log as new pattern to learn
```

**Retry ladder (only when diagnosis says reasoning was the issue):**

|Attempt|Action                                                                                   |
|-------|-----------------------------------------------------------------------------------------|
|1      |Retry with same brief, new agent (no same-agent retry for GREEN)                         |
|2      |Escalate model tier (Standard → Reasoning); rewrite brief with diagnostics from attempt 1|
|3      |Final attempt at Reasoning tier with verbose mode and explicit failure context           |
|Post-3x|Halt lane; surface to user with diagnostic packet                                        |

**Known environmental causes (fix-in-place, no retry counter increment):**

- **Stale file path in brief** → re-resolve via GitNexus `context`, rewrite brief
- **Stub not yet committed for upstream signature dependency** → wait, re-dispatch when stub lands
- **Lint auto-fixable** → run linter `--fix`, re-verify
- **Format mismatch** → run formatter, re-verify
- **Stale GitNexus index** → reindex, retry
- **Subagent timeout** → re-dispatch single agent
- **Missing lane-tools helper exists for this work** → agent reaches for it; not a failure
- **Dirty working tree from prior crashed agent** → `git stash` or `git restore`, retry
- **Test ratchet violation on accidental edit** → revert non-test changes, retry
- **Patch failed to apply (overlapping commit)** → fetch HEAD, rebase agent context, retry

**Known reasoning causes (do enter the ladder):**

- Agent produced syntactically valid but semantically wrong code
- Agent missed an AC explicitly listed in the brief
- Agent failed to use an available lane-tool that the brief named
- Test passes but with logic that’s clearly aimed at a different interpretation of the spec

**Hard-stop causes (no retry, surface immediately):**

- Hook blocked write — layer boundary or banned pattern
- Test ratchet violation that appears intentional (not a stray edit)
- Lane-tool sandbox violation
- External dependency install attempt

**Flaky test handling.** When a test passes on re-run but failed in initial verification, the test is classified flaky. The skill:

1. Re-runs the test 3 times total. If 2 of 3 pass, treat as flaky. If fewer than 2 pass, treat as legitimate failure.
1. Adds the framework’s flaky/skip annotation to the test (`@FlakyTest` / `it.skip` / `t.Skip` / etc.) with a `// FLAKY: epic-N RUN_ID` comment.
1. Excludes the flaky test from the green-gate for the remainder of this epic.
1. Logs the test to `follow-ups.json` as a high-severity entry with category `flaky_test`.
1. Lane proceeds.

Flakies are surfaced in the Closeout retro and must be triaged before the next epic starts. The skill refuses to start a new epic in a repo with more than N pending flakies (configurable, default 3).

### 4.9 Closeout architecture

Closeout is a distinct phase with its own contract, not a postscript to merge. The user’s Development Cycle doc treats closeout as load-bearing — it produces the artifacts that seed the next epic — and the skill must match that weight.

#### 4.9.1 Trigger

Closeout runs automatically after a successful merge to main. The merge commit SHA is captured from the PR Comments phase and passed to Closeout as input.

Closeout can also be invoked explicitly:

- `datum closeout` — run closeout for the most recent epic from `.datum/state.json`
- `datum closeout <run_id>` — run closeout for a specific past RUN_ID
- `datum closeout --resume <run_id>` — resume an interrupted closeout (idempotent per step)
- `datum closeout --synth-only <run_id>` — re-run synthesis from existing `closeout-data.json` without re-collecting

#### 4.9.2 Three-stage architecture

Closeout is divided into stages with strict ownership boundaries. No LLM call happens in stage 1 or stage 3. All LLM judgment is concentrated in stage 2 and reads exactly one file.

**Stage 1 — Data collection (scripts only, no LLM):**

|Script                    |Output                                                                                                                                       |
|--------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|
|`collect_git.py`          |This epic’s commits, diffs, files touched, LOC shipped, per-stage commit counts (RED/GREEN/REFACTOR), commit timing                          |
|`collect_tasks.py`        |Task completion status from `.datum/state.json`, say:do ratio (TASKS.md entries vs lanes completed), per-stage retry counts, lane failure modes|
|`collect_platform.py`     |PR metadata, review comments resolved, issues referenced in commits, branch protection events                                                |
|`collect_lane_tools.py`   |Helpers added to `scripts/lane-tools/` during this epic with descriptions                                                                    |
|`collect_brief_defects.py`|Aggregated `brief-defects.json` entries (missing ACs caught by REFACTOR)                                                                     |
|`collect_token_metrics.py`|Per-phase and per-stage token counts from `.datum/state.json` model log                                                                        |
|`collect_gitnexus_diff.py`|Pre-epic vs post-epic GitNexus impact graph diff                                                                                             |
|`detect_solutions.py`     |Pattern recognition over diffs to identify solved problems                                                                                   |
|`collate.py`              |Combines all collector outputs into single `closeout-data.json`                                                                              |

Each collector writes its raw output to `.datum/runs/<RUN_ID>/closeout-raw/` and a success marker (`.collect-<name>.done`) on completion. Re-running Closeout skips collectors whose marker exists, unless `--force` is passed.

**Stage 2 — Synthesis (LLM, Reasoning tier):**

The synthesis agent’s primary input is `closeout-data.json`. Every factual claim in every artifact must be grounded in that file. The agent produces, in order:

1. `CURRENT_STATE.md` (full rewrite) — project state post-epic
1. `ROADMAP.md` (full rewrite) — epic moved to Completed, downstream dependencies recalculated
1. `CHANGELOG.md` (append) — what shipped, key numbers, breaking changes flagged
1. `RETRO.md` (new) — metrics, observations, deferred items, brief-defects summary, lane-tools summary, token cost trend vs prior epics
1. `solutions/<slug>.md` (one per detected solved problem) — pattern, context, applicability
1. `follow-ups.json` (machine-readable) — gaps found during closeout, each entry: `{title, body, severity, suggested_labels, source}`

Synthesis order matters because later artifacts cite earlier ones (RETRO references CHANGELOG numbers; follow-ups reference solutions). The synthesis agent works through them sequentially in one session.

**Resumption protocol.** If synthesis fails partway through the list, completed artifacts are preserved on disk. On `datum closeout --resume`:

1. The agent reads `closeout-data.json` as primary input
1. The agent also reads all previously-written artifacts from `.datum/runs/<RUN_ID>/synthesis/` as **context** (not as data to re-synthesize) — this gives the agent the cross-references it needs to keep ROADMAP consistent with the already-written CURRENT_STATE
1. The agent resumes at the first unwritten artifact in the order
1. The brief explicitly states: “Artifacts 1, 2 already exist. Do not regenerate. Read them as context. Begin with artifact 3.”

This trades a small token cost on resume for cross-artifact consistency. Resume is the rare path; the cost is acceptable. The alternative (re-synthesizing from scratch) breaks idempotence and risks divergent outputs.

If a previously-written artifact is stale (e.g., the user edited it manually between the crash and the resume), the resume agent is instructed to treat the on-disk version as authoritative and align downstream artifacts to it, not to “correct” it back to what it would have written.

**Stage 3 — Side effects (scripts only, after synthesis verified):**

|Step                                                        |Script               |Idempotence                                                                                         |
|------------------------------------------------------------|---------------------|----------------------------------------------------------------------------------------------------|
|Commit synthesis artifacts to main                          |`commit_closeout.py` |Skips if commit with closeout trailer already exists                                                |
|Apply git tag `closeout-epic-<N>-<YYYYMMDD>` on merge commit|`tag_epic.py`        |Skips if tag exists; never overwrites                                                               |
|File follow-up issues to configured tracker                 |`file_followups.py`  |Each entry in `follow-ups.json` has a `dedup_key`; tracker queried for existing issues before filing|
|Trigger GitNexus reindex                                    |`gitnexus_reindex.py`|Async; non-blocking; logged to `gitnexus-reindex.log`                                               |
|Archive RUN_ID directory                                    |`archive.py`         |Copies `.datum/state.json` to `.datum/runs/<RUN_ID>/state.json`, clears live state                      |

Each side-effect step writes its own success marker. Failures in stage 3 do not unship the epic.

#### 4.9.3 `closeout-data.json` schema

This file is the determinism boundary. Schema lives in `assets/schemas/closeout-data.schema.json`. Top-level keys:

```
{
  "run_id":          "epic-N-YYYYMMDD-hhmmss",
  "epic_number":     N,
  "merge_sha":       "...",
  "merge_timestamp": "...",
  "git":             { commits, diffs, files_touched, loc_shipped, ... },
  "tasks":           { total, completed, say_do_ratio, per_stage_retries, ... },
  "lanes":           [ { task_id, stages, final_status, retries, ... } ],
  "platform":        { pr_url, pr_number, review_comments, closed_issues, ... },
  "lane_tools":      [ { path, description, added_in_lane, ... } ],
  "brief_defects":   [ { task_id, missing_ac, surfaced_by_stage, ... } ],
  "solutions":       [ { slug, pattern, evidence, ... } ],
  "token_metrics":   { total, per_phase, per_stage, per_lane, vs_prior_epic },
  "gitnexus_diff":   { pre_impact_summary, post_impact_summary, blast_radius_delta }
}
```

#### 4.9.4 Idempotence

Every step in every stage writes a marker file. `datum closeout --resume <run_id>` walks the stage list, skips steps with markers, runs the rest. Closeout can be interrupted and resumed indefinitely without data corruption.

The merge has already shipped. Closeout interruption is a documentation and metadata problem, never a correctness problem for the code in main.

#### 4.9.5 Failure isolation

**Closeout failure does not block the next epic.** If Closeout halts on any error, `.datum/state.json` is updated to `closeout_pending` for the current RUN_ID and the next `datum go` is permitted to start a new epic. Pending closeouts accumulate as a list; `datum status` shows them; `datum closeout --resume <run_id>` clears them.

The rationale: the epic is already merged. Production is unaffected. Forcing closeout completion before the next epic blocks real work on a documentation step.

#### 4.9.6 Metrics capture (Value Stream Mapping)

Closeout produces `token-metrics.json` and `wait-time-metrics.json` with:

- Total tokens for the epic (input + output)
- Per-phase breakdown (Refine, Plan, Properties, ACT, Validate, Review, PR Comments, Closeout itself)
- Per-stage breakdown within ACT (RED, GREEN, REFACTOR)
- Per-lane breakdown (which tasks were token-expensive)
- **Wait Time vs. Work Time:** Lead-time analysis for every lane, identifying bottlenecks in the dependency DAG or file-ownership conflicts.
- Comparison to the prior epic in the same repo: total delta, per-LOC delta
- Lane-tools helpers used during this epic vs added during this epic — tracks ROI

This feeds success criterion #12 (token cost per LOC trending down across epics) and the new Lead Time optimization goal.

#### 4.9.7 Closeout-specific failure surface

Findings that emerge only at Closeout, surfaced in RETRO.md and as follow-ups:

- Detected solved problem with no test coverage (regression hole)
- Brief defects above a configured threshold (Plan phase quality regression)
- Lane-tools added without descriptions (config gate bug — shouldn’t have been allowed)
- Token cost per LOC up vs prior epic (efficiency regression)
- GitNexus impact diff shows blast radius bigger than predicted in Plan
- say:do ratio below threshold (tasks were silently abandoned mid-pipeline)

These don’t fail Closeout — they’re surfaced as observations and follow-ups for the next epic’s Plan phase to consume.

#### 4.9.8 Ordering against PR Comments and merge

The ordering is fixed:

```
ACT done → Validate green → Review done → PR opened → PR Comments triage → PR Comments fixes → PR merged → Closeout starts
```

Closeout never runs against an unmerged PR. The merge commit SHA is the input. Tag-then-merge is forbidden; the tag is applied to the merge commit after merge.

-----

## 5. Token efficiency and agent tooling agency

This is a first-class constraint, not an aside. The skill is designed for many epics over time; per-epic token cost compounds.

### 5.1 Principle

Agents do not just do the task. They notice when the task is being done expensively and have agency to write tooling that makes subsequent work cheaper. Tooling commits do not count against retry budgets.

### 5.2 What this looks like in practice

- **Prefer structured tools over scans.** If an agent needs callers of a symbol, it uses GitNexus `impact` or `context`. It does not grep + read N files. If GitNexus is unavailable, the agent writes a small AST-based finder and commits it to `lane-tools/` for the next agent.
- **Brief Caching (SMED):** Setup reduction via shared context packets. If multiple lanes are working in the same module or referencing the same SPEC sections, the orchestrator pre-extracts a shared `common-context.md` once. Agents read this cached packet instead of re-reading raw source files, reducing token "setup" waste.
- **Pre-extract shared context.** If the orchestrator sees that every lane in a pipeline will need the same SPEC sections, it pre-extracts them into a single `lane-context.md` once. Lanes read the extract, not the full SPEC.
- **Refuse LLM work that is script work.** An agent asked to validate a packet against `finding.schema.json` runs the validator script. It does not match strings against regex in tokens.
- **Extract repeated assertion patterns.** When three lanes need the same property helper (the doc’s three-duplication rule applies to test helpers), the third lane is empowered to extract it to a shared helper module.
- **Filter verbose tool output.** Agents wrap noisy tools with `jq`-style filters to drop fields they do not need. Wrappers go in `lane-tools/`.
- **Drop stale context.** Briefs include “you may stop tracking X once Y is done” guidance. Agents shrink their working set as a task progresses.

### 5.3 Tooling agency rules

- **Tooling additions do not count against retry budgets.** An agent that writes a helper and then completes its task did not fail; it improved the pipeline.
- **Tooling lives in `scripts/lane-tools/`.** Agents discover existing tools by reading `scripts/lane-tools/README.md`, which is updated automatically when new tools are added.
- **Every tooling addition includes a description.** Script with no description is invisible to the next agent. The `require_tool_description = true` config gate enforces this.
- **Tooling cannot circumvent gates.** No script may auto-resolve PR threads, auto-approve a plan, or bypass a triage step. The license applies to retrieval, transformation, and validation — not to judgment or approval.
- **Tooling cannot introduce external dependencies silently.** `pip install`, `npm install`, `apt-get` of a new package surfaces to user via a gate. Stdlib-only or already-installed-only is the silent default.
- **Tooling is auditable.** Closeout captures all lane-tools added this epic in `lane-tools-added.json` for the retro.

### 5.4 Phase-specific token efficiency notes

- **Discovery and Refine** have license to run `gitnexus analyze` if the index is missing, rather than burning tokens on manual code archaeology.
- **Plan** prefers `gitnexus impact` over reading every potentially-affected file.
- **ACT** GREEN agents receive only assertion text, not test bodies — both for the blindness property and for token cost.
- **Review** packets are agent-filled JSON; the renderer is a script, never an LLM.
- **Closeout** synthesis reads one collated JSON file, not 20 source documents.

### 5.5 Lane-tools sandboxing

Granting agents agency to author and execute helper scripts is a security surface. A hallucinated recursive script, an infinite loop, or a script that writes outside its intended scope would compromise the pipeline or the host. The sandbox makes the agency safe.

Every script under `scripts/lane-tools/` is registered in a manifest:

```toml
# scripts/lane-tools/manifest.toml

[tools.find_callers]
path = "find_callers.py"
description = "AST-based caller finder; replaces grep+read for impact lookups."
permissions = { network = false, write = ["/tmp/lane-tools-out"], read = ["src/", "tests/"] }
timeout_seconds = 30
added_in_epic = 1
added_in_lane = "task-003"

[tools.filter_gitnexus_output]
path = "filter_gitnexus_output.py"
description = "Reduces gitnexus impact output to {file, line, confidence} fields."
permissions = { network = false, write = [], read = [] }   # stdin/stdout only
timeout_seconds = 5
added_in_epic = 1
added_in_lane = "task-007"
```

**Runtime enforcement.**

- Lane-tools execute in a subprocess spawned by the orchestrator, never inline in the agent’s tool context
- The subprocess is launched with a wrapper (`scripts/lane-tools-runner.py`) that:
  - Sets `ulimit` (CPU time, memory, file descriptors)
  - Applies the timeout from the manifest (default 60s if unspecified)
  - Uses an allowlist for filesystem read access (read-only bind mounts on Linux when available, fall back to a chroot-style working directory)
  - Uses an allowlist for filesystem write access
  - Blocks network by default (Linux: unshare net namespace; macOS: pf rules or skip network blocking with logged warning if unavailable)
  - Kills the subprocess on timeout and returns a sandbox-violation diagnostic
- A tool with `network = true` requires `datum init` confirmation when first added, not silent acceptance

**Manifest enforcement.** The pre-commit hook `pre-commit-lane-tools-manifest.sh` rejects commits that add files to `scripts/lane-tools/` without a corresponding manifest entry. This makes `require_tool_description = true` actually enforceable.

**Sandbox violation handling.** When a lane-tool exceeds its timeout, writes outside its allowed paths, or attempts disallowed network access, the runner kills it, logs `lane_tool_sandbox_violation`, and the calling lane fails the stage. The violating tool is auto-disabled until reviewed. This is a hard stop in yolo mode.

**Scope limit.** Lane-tools are not allowed to:

- Spawn other lane-tools (no recursion)
- Invoke the agentic CLI tools (no LLM calls from within sandbox)
- Modify files in `.git/`, `.datum/`, `scripts/` (other than reading)
- Hold locks longer than their timeout

If a lane needs a capability the sandbox doesn’t allow, it surfaces a request to user rather than circumventing.

-----

## 6. Failure modes and surface behavior

|Failure                                                                    |Where                                 |Surface                                                                                                      |
|---------------------------------------------------------------------------|--------------------------------------|-------------------------------------------------------------------------------------------------------------|
|TICKET.md references nonexistent code                                      |Refine                                |Skill asks user clarifying question, halts                                                                   |
|SPEC.md missing boundary/failure-mode answers                              |Plan gate                             |LLM judge marks insufficient; gate held                                                                      |
|TASKS.md not topo-sorted                                                   |Plan validator                        |Script exit 1; skill rewrites or asks                                                                        |
|TASKS.md missing RED note per task                                         |Plan validator                        |Script exit 1; skill rewrites                                                                                |
|PROPERTIES.md missing category coverage                                    |Properties gate                       |LLM judge marks gap; skill proposes additions                                                                |
|Lane file-set overlap with concurrent lane                                 |Pipeline scheduler                    |Hold at stage boundary; wait for conflict to clear                                                           |
|RED test fails for the wrong reason                                        |Act RED verify                        |Retry RED with stricter brief                                                                                |
|GREEN cannot pass after 3x                                                 |Act GREEN                             |Halt lane; surface diagnostic packet                                                                         |
|GREEN sees test source somehow                                             |Act invariant                         |Hard fail; investigate test_signal.py; releases the test_signal canary self-test                             |
|REFACTOR proposes test relaxation                                          |Act invariant                         |Caught by `test_ratchet.py` pre-commit hook (4.6.4); commit blocked; REFACTOR retried with violation in brief|
|REFACTOR finds missing AC                                                  |Act REFACTOR                          |Fail back to new RED-GREEN cycle; log brief defect                                                           |
|Hook blocks write                                                          |Act/Validate                          |Halt; surface; hook block is never auto-bypassed                                                             |
|Lane patch fails to apply at commit queue                                  |Pipeline commit queue                 |Treated as environmental failure (4.8); agent re-runs with current HEAD context; no retry counter increment  |
|Lane-tool sandbox violation (timeout, disallowed write, disallowed network)|Lane-tools runner                     |Hard stop; tool auto-disabled until reviewed; lane fails stage                                               |
|Lane-tool added without manifest entry                                     |Pre-commit hook                       |Commit blocked; agent must add manifest entry                                                                |
|Diagnose-failure classifies cause as ENVIRONMENTAL                         |Any agent failure                     |Fix in place at same tier; retry counter NOT incremented                                                     |
|Diagnose-failure classifies cause as UNKNOWN                               |Any agent failure                     |Enter retry ladder conservatively; log new pattern for future classification                                 |
|GitNexus unavailable + change volume above threshold                       |Pipeline pre-flight                   |Escalate to human approval; yolo does not bypass                                                             |
|GitNexus unavailable + change volume below threshold                       |Pipeline pre-flight                   |Proceed with logged “risk unknown” annotation                                                                |
|External dependency install attempted via shell                            |Pre-tool-use hook / subprocess wrapper|Intercepted before execution; surfaced to user; never silent                                                 |
|Test framework not supported by test_signal.py                             |Pipeline pre-flight                   |Skill refuses to enter ACT; lists missing framework parser                                                   |
|test_signal.py redaction parser hits malformed output                      |Test verify                           |Returns `redaction_failed`; lane halts; user can extend parser or skip lane                                  |
|Flaky test detected (passes 2 of 3 re-runs)                                |Test verify                           |Annotated as flaky, excluded from green-gate, logged to follow-ups, lane proceeds                            |
|Pending flakies above threshold at start of new epic                       |datum go pre-flight                     |Skill refuses to start; user must triage                                                                     |
|Linter introduces new rule violations on existing code                     |Validate                              |Skill fixes scoped to current epic only                                                                      |
|Review packet schema drift                                                 |Review collation                      |Normalizer maps to canonical; log drift event                                                                |
|PR comment triage produces ambiguous verdict                               |PR Comments                           |LLM re-runs with more context; if still ambiguous, surface                                                   |
|Merge conflict                                                             |Merge                                 |Halt; never auto-resolve                                                                                     |
|Git push rejected                                                          |Merge                                 |Halt; surface (likely branch protection or stale base)                                                       |
|GitNexus reindex fails at closeout                                         |Closeout                              |Closeout completes; reindex retried with backoff; logged                                                     |
|Agent proposes external dependency install                                 |Any phase                             |Halt; gate to user; never silent (enforced by 4.4.1)                                                         |
|Closeout collector script crashes                                          |Closeout stage 1                      |Marker not written; `datum closeout --resume` retries that collector                                           |
|Synthesis cites claim not in `closeout-data.json`                          |Closeout stage 2                      |Validator catches unsupported claim; agent regenerates with stricter brief                                   |
|Synthesis interrupted partway through artifact list                        |Closeout stage 2                      |Completed artifacts preserved; resume picks up at next unwritten artifact                                    |
|Git tag application fails                                                  |Closeout stage 3                      |Logged; retried; never blocks next epic                                                                      |
|Follow-up issue filing fails (auth, rate limit, no tracker)                |Closeout stage 3                      |`follow-ups.json` retained as manifest; logged; never blocks next epic                                       |
|GitNexus reindex fails                                                     |Closeout stage 3                      |Async; retried with backoff; never blocks next epic                                                          |
|say:do ratio below configured threshold                                    |Closeout retro                        |Surfaced as observation in RETRO.md and as follow-up; not a closeout failure                                 |
|Token cost per LOC up vs prior epic                                        |Closeout retro                        |Surfaced as observation in RETRO.md; not a closeout failure                                                  |
|Blast radius bigger than Plan predicted                                    |Closeout retro                        |Surfaced as observation; informs next Plan phase                                                             |
|Detected solved problem with no test coverage                              |Closeout retro                        |Surfaced as high-severity follow-up; potential regression hole                                               |

-----

## 7. Constraints

### 7.1 Determinism boundary

Scripts own: artifact naming, file routing, schema validation, metrics aggregation, RUN_ID stamping, commit, push, render, dispatch, test signal extraction. LLM owns: ambiguity resolution, triage verdicts, synthesis, property authoring, brief writing.

**No LLM writes a final human-readable report directly.** Every rendered artifact is produced by a script reading typed JSON.

### 7.2 Cross-tool portability

`SKILL.md` and `references/*.md` are tool-agnostic. Tool-specific adapters live in `config.toml.default` under `[tools]`. Tools without parallel subagent primitives fall back to sequential lane execution and log the degradation. GitNexus availability is detected per-tool; falls back to grep + AST tools with logged confidence reduction.

### 7.3 Skill size limits

Per agentskills.io best practice, `SKILL.md` stays under 500 lines. All phase-specific detail is in `references/`, loaded on demand.

### 7.4 Idempotence

`datum resume` and `datum <phase>` are idempotent. Re-running a completed phase reads the existing artifact, validates it against the gate, and skips re-generation unless the artifact is stale or `--force` is passed.

### 7.5 Privacy

`.datum/` is gitignored except for artifacts the user explicitly commits (SPEC.md, TASKS.md, PROPERTIES.md, CHANGELOG.md, CURRENT_STATE.md, ROADMAP.md, RETRO.md, solutions/). RUN_ID archives stay local.

### 7.6 No standard ports

Any local services the skill spins up (none currently planned) must use non-standard high ports per user preference.

### 7.7 Token efficiency

Agents have agency to write tooling that reduces token cost. Per section 5. Tooling commits do not count against retry budgets. Tooling cannot circumvent gates, introduce external dependencies silently, or replace judgment work with scripts. The orchestrator monitors `scripts/lane-tools/` and incorporates new helpers into briefs for subsequent lanes.

### 7.8 Context isolation

GREEN agents must not see test source code. This is enforced by `test_signal.py` which redacts test runner output to assertion text, compile error metadata, and runtime error metadata only — never source line content. A bug in test_signal.py that leaks test source is a release blocker. The redactor includes a self-test (canary strings in fixture test files) that runs on every commit to test_signal.py.

### 7.9 Sandbox isolation

Lane-tools execute in a subprocess with declared permissions (filesystem read/write allowlists, network blocked by default, CPU/memory/time limits). Permissions are declared in `scripts/lane-tools/manifest.toml` and enforced at runtime by `scripts/lane-tools-runner.py`. Sandbox violations are hard stops.

### 7.10 Enforcement, not policy

Every constraint listed as a “hard stop” or “invariant” in this document must have a corresponding deterministic enforcement mechanism (hook, script, sandbox). Constraints that rely on LLM compliance only are not constraints; they are aspirations. The two columns of section 6 (failure mode → surface behavior) must each have an identifiable enforcement point in the codebase.

### 7.11 Diff-application uniformity

All lane outputs reach the commit queue as unified diffs, regardless of source tool. Tool adapters perform the translation. The commit queue applies via `git apply --3way`. This is the single audit point for changes landing in main.

-----

## 8. Success criteria

1. `datum init` on a fresh repo bootstraps hooks, linter rules, GitNexus index, CURRENT_STATE.md, ROADMAP.md after a single human approval.
1. `datum go` on a repo with only a `TICKET.md` runs the full cycle through merge, halting only at configured gates and producing every artifact in section 3.4.
1. `datum yolo` on the same input completes without prompts unless a hard stop fires.
1. `datum resume` after a forced interruption (kill -9) restores phase and per-lane state and continues without re-generating completed artifacts.
1. Pipeline dispatch produces zero same-file write conflicts across an 87-task epic with concurrent lanes.
1. GREEN agents never receive test source code, verified by audit of `test_signal.py` output on at least 50 lane runs.
1. The 3x retry ladder recovers from at least 80% of injected failures (stale path, flaky test, lint violation) without surfacing to the user.
1. The same `SKILL.md` package runs in Claude Code, Codex, opencode, Kiro, and Gemini CLI. Tools without slash-command support invoke via phrase trigger.
1. GitNexus impact analysis halts a yolo run when blast radius exceeds the configured threshold.
1. Closeout produces a retro grounded in `closeout-data.json` with zero unsupported claims, including a brief-defects summary, lane-tools-added summary, and token cost trend.
1. Closeout is idempotent: interrupting Closeout at any stage and resuming with `datum closeout --resume` produces identical final artifacts.
1. A failed Closeout does not block the next `datum go`. Pending closeouts accumulate and are visible in `datum status`.
1. `datum migrate` upgrades a v1.0.0 state file to v1.1.0 schema without data loss.
1. Token cost per epic, measured as total tokens across all LLM calls divided by lines of code shipped, decreases over time as `lane-tools/` accumulates reusable helpers. Baseline measured on epic 1; expect ≥20% reduction by epic 5 in the same repo.
1. Git tag is applied to the merge commit, never to a pre-merge commit. Tag-then-merge is rejected by the skill.
1. The commit queue serializes lane commits with zero data corruption across an 87-task epic with all 7 lanes finishing concurrently. Audit log shows every commit’s pre-apply HEAD and post-apply HEAD form a linear chain.
1. test_signal.py self-test (canary fixture) passes on every commit to test_signal.py and on every supported framework (XCTest, Vitest/Jest at v1). Canary strings in fixture test files never appear in any redactor output.
1. test_ratchet.py rejects every attempt to delete, weaken, or skip-rename a test in pre-commit, across a fixture suite of 30 violating diffs (10 per category).
1. Lane-tools sandbox: a deliberately misbehaving lane-tool (infinite loop, write outside allowed paths, network call) is killed within its timeout, generates a sandbox-violation diagnostic, and does not corrupt repo state.
1. Pre-execution interception: a lane agent that runs `pip install foo` or equivalent triggers the install-interceptor hook, halts before installation, and surfaces the request. Tested on each supported tool.
1. Stub Protocol: an epic with 5 sequentially-dependent tasks (Lane A → B → C → D → E) sees Lanes B-E enter their RED stages within seconds of Lane A’s stub commit, not waiting for Lane A’s GREEN.
1. Diagnose-failure correctly classifies 90%+ of injected environmental failures (stale path, missing stub, dirty tree, stale index) as ENVIRONMENTAL, fixing in place without consuming retry budget.
23. GitNexus degraded mode: with `gitnexus` MCP disabled, a high-volume change escalates to human approval under yolo. The skill never claims “low risk” without GitNexus data.
24. **Heijunka (Load Leveling):** Pipeline scheduler correctly enforces tier-based caps, preventing >2 Reasoning agents or >5 Standard agents in flight concurrently.
25. **Value Stream Mapping:** Closeout produces a `wait-time-metrics.json` that identifies the longest-waiting lane and its primary bottleneck (dependency or file conflict).
26. **SMED:** Concurrent lanes in the same domain share a `common-context.md` packet, verified by audit of brief sizes vs. raw source size.
27. **5S Hygiene:** REFACTOR commits are rejected if temporary files or unused imports remain, verified by pre-commit hygiene checks.
28. **Gemba Verdicts:** Every REFACTOR result includes a `gemba_verdict` with a non-zero `friction_score` for tasks requiring significant architectural trade-offs.

-----

## 9. Open questions for PLAN.md

These are deliberately left for the Plan phase rather than decided here:

1. Exact subagent primitive names per tool (verify against current Codex, opencode, Kiro, Gemini CLI docs)
1. Whether GitNexus MCP server is invoked via the skill’s adapter layer or assumed pre-configured globally
1. How to detect “language” for `04-act-<lang>.md` selection (file extensions, `package.json`, `Cargo.toml`, etc. — pick a single deterministic rule)
1. Whether `datum init` should also install GitNexus itself (`npm install -g gitnexus`) or assume the user has it
1. Skill version pinning mechanism — semver in frontmatter, lock file, or both
1. Whether commit messages are LLM-authored or generated from TASKS.md task descriptions (conventional commits format either way)
1. How to handle the case where the user’s existing CLAUDE.md / AGENTS.md conflicts with the skill’s expected conventions
1. Test framework auto-detection vs. config-declared
1. ~Exact assertion-text extraction strategy~ **Resolved in section 4.6.5.** Open follow-up: which additional frameworks (pytest, go test, JUnit, RSpec, etc.) to ship in v1.1.
1. Whether REFACTOR runs per-lane in line or batched as a final sweep across all lanes (`refactor_batched` config). Pure-lane is simpler; batched lets REFACTOR see integration. Plan must pick.
1. Cap on lane-tools additions per epic to prevent runaway tooling sprawl
1. Whether brief-defects feed back into Plan phase improvements automatically (e.g., next epic’s Plan agent reads `brief-defects.json` from prior epics)
1. Issue tracker auto-detection for `file_followups.py` (GitHub, GitLab, Jira, Linear) — config-declared or detected from repo remotes
1. Whether `closeout-data.json` should be committed to main alongside synthesis artifacts, or kept local only (it contains rich metadata that could leak internal details)
1. Token-metrics storage location — `.datum/runs/<RUN_ID>/token-metrics.json` is per-epic; a rolling aggregate across epics for the trend would need `.datum/token-metrics-history.json` or similar
1. Solutions detection heuristics — `detect_solutions.py` is the fuzziest of the collectors; needs concrete patterns to look for (e.g., “added a new layer protocol implementation” → solution; “fixed a typo” → not a solution)
1. Whether RETRO.md is committed to main or kept in the RUN_ID archive only — affects whether retros become a searchable history in the repo
1. Sandbox enforcement on macOS — Linux has unshare/namespaces; macOS lacks equivalents. Decide between (a) require Linux container for sandbox (Docker), (b) accept reduced sandbox on macOS with logged warnings, (c) require sandboxed-exec profiles per tool
1. Test ratchet pattern lists per framework — the v1 lists for XCTest and Vitest/Jest need a concrete starting set of strict-to-loose pairs and skip-rename patterns
1. Commit queue transport — Unix socket vs named pipe vs file lock + polling. Cross-platform implications (Windows is not a target but contributors may run it)
1. Diagnose-failure pattern library — what known environmental patterns ship in v1 vs accumulate from operation
1. Whether the stub commit and the test commit can be combined into one commit when the lane has no downstream dependencies — minor optimization
1. Lane-tool sharing across repos — a helper written for repo A might be useful in repo B. Out of v1 scope; flag for v2 consideration

-----

## 10. Reference dependencies

- Agent Skills Specification: https://agentskills.io/specification
- GitNexus: https://github.com/abhigyanpatwari/GitNexus (MCP-native, 7 tools, 4 skills, hooks)
- Existing user SAM system (sam:architecture, sam:isthissmart, sam:gitwork, sam:safeclaude) — may be consulted by DATUM phases where overlap exists; not a hard dependency
- Existing user Development Cycle document (provided as input to this brainstorm) — canonical source for phase definitions
- Existing user Design Principles document — canonical source for architectural constraints the skill enforces via hooks