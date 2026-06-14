# datum — Current State

**Branch:** `main` | **Last updated:** 2026-06-13 | **Tests:** 1260 passing, 9 expected failures (stale dogfood artifacts)

---

## Shipped

### TDD Workflow Pipeline (2026-06-08 — 2026-06-13)

Deterministic Act phase orchestration — a JS workflow script (`datum-tdd-act.js`) that reads `lane-plan.json` and runs RED->GREEN->REFACTOR per lane with enforced gates.

- 7 custom agent types (datum-cli, datum-reader, datum-red, datum-green, datum-refactor, datum-skeptic, datum-reflect, datum-docs)
- 4 enforcement hooks (protect-tests, lane-file-guard, commit-format, test-ratchet)
- 3-lens adversarial skeptic panel with consensus filtering
- Retry ladder: RED and GREEN get 2 attempts, GREEN escalates sonnet->opus on retry
- Self-reflection scoring: haiku scores RED test quality 0-10, gates GREEN
- Root worktree isolation for parallel workflow safety
- Auto-triage: failures analyzed and filed as GitHub issues
- Per-lane test commands derived from lane's own test files
- `datum-tdd` skill: feature description -> lane plan -> branch -> workflow launch
- Worktree manager with `--` branch separator (not `/`)

### Prior Sessions (Epics 1-23, PRs #25-#41)

23 epics shipped. Local LLM pipeline (MLX Gemma/Qwen3), grammar-constrained output, multi-turn, self-healing (`datum bugfile`), semantic memory (`datum dream`), TUI dashboard, full installer with 5-tool registry.

---

## In Flight

- **Opus pipeline audit** (COMPLETE): 11 recommendations for decomposition quality and cost optimization. 4 must-do, 4 high-priority, 3 nice-to-have. Key finding: implementation stubs for GREEN reduce opus escalation from ~40% to ~10%.
- **dogfood-v14** — successful TDD run (WaveResult.to_dict/from_dict/flatten), code on main
- 2 commits ahead of origin/main (GREEN model escalation + skeleton preflight context)

---

## What's Next

### Audit Priority 1 (must-do)

1. **E1**: Create implementation stubs in skeleton_creator.py so GREEN fills in bodies instead of writing from scratch
2. **E2**: Eliminate read-preflight agent call (pure waste — haiku agent running `cat`)
3. **E3**: Update datum-green.md to reference red_note in the packet
4. **E4**: Fix skeleton template NotImplementedError -> assert False (contradicts pipeline rules)

### Audit Priority 2 (high impact)

5. **E5**: Demote skeptic edge+error lenses to haiku (keep contract at sonnet)
6. **E6**: Demote triage agent to haiku
7. **E7**: Add estimated_impl_lines to lane plan schema
8. **E8**: Add contract_summary to GREEN packet

### Features

- **Issue #140**: datum-tdd skill structured args (`build_tdd_args()` module)
- **Issue #134**: 3-round adversarial review pipeline
- **Web dashboard**: Python server on port 10001 for inflight workflow progress
- **Issue #139**: wave_builder cycle detection (code exists, issue open)

---

## Backlog

- #132: act agent scope violations (blocking parallel lanes)
- #131: SourceKit false positives on subpackage tests
- #130: wrong test framework detection (Testing vs XCTest)
- #128: Package.swift target membership context for imports
- Headless orchestrator for datum-local variant
- anthropics/claude-code#68288: agentType + schema StructuredOutput incompatibility

---

## Architecture

- CLI wrapper at `~/.local/bin/datum`, all docs say `datum <command>`
- Local LLM: Qwen3-30B-A3B-Instruct-2507-4bit-DWQ (think) + gemma-4-E4B-it-qat-4bit (decide) on /Volumes/Extra/mlx-models
- TDD model tiers: haiku (mechanical), sonnet (reasoning), sonnet->opus escalation (GREEN retry)
- Per-lane economics: 6 sonnet + 9 haiku = ~9 sonnet-equivalent per lane (happy path)
- Each workflow-subagent carries ~76K system prompt overhead
