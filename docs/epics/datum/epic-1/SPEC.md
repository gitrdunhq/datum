# Spec: AIDLC-Inspired Pipeline Enhancements

**Run ID:** epic-1-20260527
**Phase:** Refine
**Status:** Draft

---

## 1. Summary

Add five structural improvements to the DATUM pipeline: an overconfidence gate that audits assumptions before Act begins, an adaptive depth classifier that scales pipeline ceremony to problem complexity, units-of-work groupings in Plan for multi-dev parallelism, a LANDSCAPE.md artifact for brownfield onboarding, and file-based QUESTIONS.md for durable Q&A that survives session boundaries.

## 2. Context

DATUM currently treats every epic identically regardless of size — a one-line typo fix gets the same 9-phase ceremony as a greenfield subsystem. The pipeline has no structural check for whether the agent validated its assumptions or just pattern-matched. With a 3-developer team across cities, there's no concept of parallel units of work. New developers have no onboarding artifact for brownfield codebases. And clarifying questions live in chat transcripts that disappear between sessions.

These gaps were identified by analyzing AWS AIDLC's core workflow and extracting the patterns that address weaknesses DATUM has but AIDLC handles.

## 3. Requirements

### R1: Overconfidence Gate

**Description:** Extend the `plan_human_approval` gate to require an assumption audit before the pipeline advances from Plan to Act. The agent must self-audit its SPEC before the gate can pass.

**Acceptance criteria:**
- [ ] AC1: SPEC.md template gains a `## Assumption Audit` section with three sub-fields: `Assumption`, `Justification`, `Status` (confirmed/guess)
- [ ] AC2: `gate_plan()` in `gate.py` checks for the `## Assumption Audit` section; gate fails if missing
- [ ] AC3: Gate fails if any assumption has `Status: guess`. Resolution mechanism: each guess-status assumption must include a `Resolves: Q<N>` reference pointing to a numbered question in QUESTIONS.md. Gate checks that the referenced question has a non-empty `[Answer]:`. No fuzzy text matching — explicit cross-references only.
- [ ] AC4: Gate emits a warning if Refine phase asked zero clarifying questions (detected by checking QUESTIONS.md for Refine-section entries)
- [ ] AC5: Refine reference doc (`01-refine.md`) updated to mandate QUESTIONS.md generation
- [ ] AC6: Plan reference doc (`02-plan.md`) updated to mandate assumption audit before gate

### R2: Adaptive Depth Classifier

**Description:** Add a `datum classify` CLI command that auto-classifies epic complexity into three tiers (Patch/Feature/System) and routes to the appropriate pipeline shape.

**Acceptance criteria:**
- [ ] AC1: New `classify` command in `datum/cli.py` that reads a structured `## Classification Metadata` block from SPEC.md and outputs `{"tier": "patch|feature|system", "signals": {...}, "pipeline_shape": "express|standard|extended"}`
- [ ] AC2: SPEC.md template gains a `## Classification Metadata` section with machine-readable fields that Refine must fill in: `estimated_files`, `estimated_loc`, `clusters_touched`, `new_public_api` (bool), `dependency_additions` (list). Classifier reads these fields, not prose.
- [ ] AC2a: Refine reference doc updated to mandate filling in Classification Metadata before the Refine gate
- [ ] AC3: Patch tier (< 50 LOC, single cluster, no new public API) routes to Express pipeline
- [ ] AC4: System tier (> 5 clusters, or new subsystem, or multi-package, or cross-cutting change) routes to Extended pipeline
- [ ] AC5: Feature tier (everything else) routes to Standard pipeline (current behavior)
- [ ] AC6: User can override classification at `plan_human_approval` gate
- [ ] AC7: SKILL.md dispatcher updated to call `datum classify` after Refine and before Plan
- [ ] AC8: `config.toml.default` gains a `[classification]` section with threshold overrides
- [ ] AC9: System tier mandates all Properties categories and architect sidecar; Patch tier skips Properties

### R3: Units of Work in Plan

**Description:** For System-tier epics, extend Plan phase to decompose tasks into parallelizable units of work with inter-unit dependency tracking.

**Acceptance criteria:**
- [ ] AC1: `tasks.json` schema extended with optional `unit` field on each task (string, unit ID)
- [ ] AC2: `tasks.json` schema extended with optional top-level `units` object: `{ "unit-id": { "name": str, "tasks": [str], "depends_on": [str] } }`
- [ ] AC3: `lane_plan.py` validates unit dependency graph is acyclic (same as task-level validation)
- [ ] AC4: `lane_plan.py` validates that all tasks reference valid unit IDs when units are present
- [ ] AC5: `TASKS.md` renderer groups tasks by unit with dependency annotations when units are present
- [ ] AC6: Plan reference doc (`02-plan.md`) updated with unit decomposition step for System-tier
- [ ] AC7: Act scheduler respects unit boundaries: a unit's tasks run in parallel, but a unit doesn't start until its dependency units complete
- [ ] AC8: Feature and Patch tiers omit units (all tasks are implicitly one unit)
- [ ] AC9: `gate_plan()` validates unit structure when present (valid IDs, acyclic, complete coverage)

### R4: LANDSCAPE.md Artifact

**Description:** During Discovery, generate a human-readable `docs/LANDSCAPE.md` that summarizes the codebase architecture for onboarding. Cache it and regenerate only when the codebase has changed significantly.

**Execution context:** LANDSCAPE.md generation is split between two contexts:
- **CLI (`datum landscape`)** generates the degraded-mode version using filesystem scanning (file tree, LOC, extensions, imports). This is deterministic and always available.
- **Agent-driven enrichment** happens during Discovery when GitNexus MCP is available. The agent queries `gitnexus_query("architecture")`, `gitnexus_query("entry points")`, and appends cluster/process data to the CLI-generated scaffold. This cannot be a CLI command because GitNexus MCP resources are only available in the agent conversation context, not to Python scripts.

**Acceptance criteria:**
- [ ] AC1: New `datum landscape` CLI command that generates the base `docs/LANDSCAPE.md` scaffold (file tree, LOC, tech stack detection, import graph)
- [ ] AC2: Base scaffold content includes: tech stack (language, frameworks, package manager, test framework), file tree summary with LOC per directory, top-level module descriptions from docstrings/READMEs
- [ ] AC3: Discovery reference doc (`00-discovery.md`) updated: after running `datum landscape`, the agent enriches the scaffold with GitNexus data (architecture clusters, entry points, execution flows, key abstractions) when GitNexus MCP is available
- [ ] AC4: When GitNexus is unavailable, the CLI scaffold stands alone as the complete LANDSCAPE.md (degraded but usable)
- [ ] AC5: CLI caches a content hash of the scanned file tree in `.datum/landscape-hash`; skips regeneration if hash matches
- [ ] AC6: `datum landscape --force` regenerates regardless of cache
- [ ] AC7: Agent enrichment appends to clearly marked sections (`<!-- gitnexus:start -->` / `<!-- gitnexus:end -->`) so re-runs replace only the enriched sections

### R5: QUESTIONS.md with [Answer]: Tags

**Description:** Replace conversational Q&A with a committed artifact. Generate QUESTIONS.md during Refine and Plan with structured questions and `[Answer]:` tags that the human fills in.

**Acceptance criteria:**
- [ ] AC1: New template at `templates/QUESTIONS.md` with the structured format (date headers, category tags, context blocks, `[Answer]:` tags)
- [ ] AC2: Refine reference doc updated: agent generates QUESTIONS.md in `docs/epics/<branch>/` with Refine-section questions
- [ ] AC3: Plan reference doc updated: agent appends Plan-section questions to existing QUESTIONS.md
- [ ] AC4: `gate_refine()` checks for unanswered `[Answer]:` entries (empty or whitespace-only after the tag); gate fails if any exist
- [ ] AC5: `gate_plan()` checks for unanswered Plan-section `[Answer]:` entries; gate fails if any exist
- [ ] AC6: QUESTIONS.md is committed after each Q&A round as a first-class artifact
- [ ] AC7: Agent can propose answers (filled in after `[Answer]:`), but human must confirm or override before gate passes
- [ ] AC8: SKILL.md updated to list QUESTIONS.md as an archived artifact

## 4. Failure Modes and Handling

| Failure | Handling |
|---|---|
| Classifier produces wrong tier | User overrides at plan_human_approval gate. Classification is advisory, gate is authoritative. |
| GitNexus unavailable during landscape generation | Fall back to degraded mode (file-system scan). Log degradation in state. Never claim "complete" landscape without GitNexus. |
| QUESTIONS.md has stale answers from a previous session | Each Q&A round gets a date header. Agent can flag answers older than the current session for re-confirmation. |
| Unit dependency graph has a cycle | `lane_plan.py` detects and halts. Same behavior as task-level cycle detection. |
| Overconfidence gate is too aggressive (blocks valid SPECs) | Thresholds are configurable in `config.toml`. Default is 3 assumptions minimum; can be set to 0 to disable. |
| System-tier classification on a Feature-tier epic | User overrides. No automated re-classification mid-pipeline. |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| `datum classify` execution time | < 2 seconds (no network calls, reads SPEC.md only) |
| `datum landscape` execution time | < 30 seconds with GitNexus, < 10 seconds degraded |
| QUESTIONS.md file size | < 50KB per epic (questions are concise) |
| Backward compatibility | Existing state.json, tasks.json, and config.toml without new fields must still work (new fields are optional with defaults) |
| Schema migration | `datum migrate` handles adding new optional fields to existing state/tasks files |

## 6. Out of Scope

- Changing the state machine phase ordering (Refine → Plan → Properties → Act sequence unchanged)
- Product pipeline changes (triage/discovery/requirements/handoff)
- AIDLC's stateless approach, single-model execution, or unstructured artifacts
- Automated unit assignment to specific developers (units are groupings, not assignments)
- LANDSCAPE.md content generation by LLM (it's a deterministic rendering of indexed data)
- Changes to the Act phase TDD contract (RED/GREEN/REFACTOR unchanged)

## 7. Open Questions

*(none — all resolved in QUESTIONS.md)*

## 8. Blast Radius + Impact Analysis

### Files modified (existing)

| File | Change | Risk |
|---|---|---|
| `datum/gate.py` | Add assumption audit check to `gate_plan()`, add QUESTIONS.md check to `gate_refine()` and `gate_plan()` | Medium — gate logic is critical path |
| `datum/cli.py` | Add `classify` and `landscape` commands | Low — additive |
| `references/00-discovery.md` | Add LANDSCAPE.md generation step | Low — additive |
| `references/01-refine.md` | Add QUESTIONS.md generation mandate | Low — additive |
| `references/02-plan.md` | Add assumption audit, units decomposition, QUESTIONS.md append | Medium — Plan is the most complex reference doc |
| `SKILL.md` | Update dispatcher, gate matrix, artifact list | Medium — primary agent instruction surface |
| `assets/config.toml.default` | Add `[classification]` section | Low — additive |

### Files created (new)

| File | Purpose |
|---|---|
| `datum/classify.py` | Complexity classifier logic (reads structured SPEC metadata) |
| `datum/landscape.py` | LANDSCAPE.md base scaffold generator (filesystem scan, LOC, tech stack) |
| `templates/QUESTIONS.md` | Question template with [Answer]: tags |
| `templates/SPEC.md` (update) | Add Classification Metadata and Assumption Audit sections |

### Modules NOT touched

- `datum/state.py` — no state machine changes
- `datum/self_check.py` — no new contract fixtures needed (yet)
- `datum/bootstrap/` — no init changes
- `references/04-act*.md` — Act phase unchanged
- `references/05-validate.md` through `08-closeout.md` — downstream phases unchanged

## Assumption Audit

| # | Assumption | Justification | Status |
|---|---|---|---|
| 1 | `tasks.json` schema can be extended without breaking existing files | The `units` and `unit` fields are optional with no defaults required. `lane_plan.py` already tolerates missing optional fields. | Confirmed — verified in gate.py line 133: `lane.get("task_complexity")` uses `.get()` pattern |
| 2 | The classifier can determine tier from SPEC.md alone without running code | SPEC.md contains estimated file count, LOC, and scope description. These are sufficient for classification. The classifier doesn't need to analyze actual code. | Confirmed — classifier is heuristic on spec content, not code analysis |
| 3 | QUESTIONS.md won't create friction that slows down trivial epics | Patch-tier epics (via Express) skip Refine entirely, so QUESTIONS.md is only generated for Feature and System tiers where clarification has high value. | Confirmed — Express pipeline bypasses Refine per `0x-express.md` |
