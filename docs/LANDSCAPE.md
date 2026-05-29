# Landscape

## Tech Stack

- **python**: datum

## File Tree

```
.DS_Store (3 LOC)
.gitignore (46 LOC)
AGENTS.md (131 LOC)
CHANGELOG.md (150 LOC)
CLAUDE.md (3 LOC)
CODEX.md (3 LOC)
COPILOT.md (3 LOC)
CURRENT_STATE.md (60 LOC)
GEMINI.md (3 LOC)
HEY_CLAUDE.md (27 LOC)
HEY_GEMINI.md (52 LOC)
KIRO.md (3 LOC)
README.md (91 LOC)
ROADMAP.md (35 LOC)
SKILL.md (190 LOC)
TASKS.md (163 LOC)
install.sh (368 LOC)
pyproject.toml (37 LOC)
tasks.json (206 LOC)
uv.lock (1163 LOC)
  c4d94163-2ad4-4a66-9869-90a162f0c137.json (14 LOC)
  settings.json (84 LOC)
    entire-search.md (25 LOC)
        SKILL.md (83 LOC)
        SKILL.md (89 LOC)
        SKILL.md (78 LOC)
        SKILL.md (64 LOC)
        SKILL.md (97 LOC)
        SKILL.md (121 LOC)
  .gitignore (5 LOC)
  settings.json (11 LOC)
    entire.log (1079 LOC)
      full.jsonl (442 LOC)
      prompt.txt (1 LOC)
      full.jsonl (5967 LOC)
      prompt.txt (263 LOC)
      full.jsonl (1521 LOC)
      prompt.txt (1 LOC)
    pre-prompt-b51a9ff8-5d2c-4458-a3a9-998d4aa59639.json (6 LOC)
  config.toml.default (222 LOC)
      green-brief.valid.json (34 LOC)
      green-continuation.valid.json (16 LOC)
      green-result.valid.json (23 LOC)
      red-brief.valid.json (24 LOC)
      red-result.valid.json (24 LOC)
      refactor-brief.valid.json (34 LOC)
      refactor-result.valid.json (33 LOC)
    pre-commit-banned-patterns.sh (27 LOC)
    pre-commit-file-size.sh (24 LOC)
    pre-commit-guard-main.py (17 LOC)
    pre-commit-lane-tools-manifest.sh (43 LOC)
    pre-commit-layer-boundary.sh (24 LOC)
    pre-commit-tdd-guard.sh (47 LOC)
    pre-commit-test-ratchet.sh (24 LOC)
    pre-tool-use-install-interceptor.sh (39 LOC)
    pre-tool-use-no-shell-llm.sh (18 LOC)
    pre-tool-use-pip-to-uv.sh (52 LOC)
    test_pre-commit-lane-tools-manifest.sh (40 LOC)
    test_pre-commit-test-ratchet.sh (65 LOC)
    test_pre-tool-use-install-interceptor.sh (48 LOC)
  __init__.py (3 LOC)
  analyze_properties.py (202 LOC)
  archive.py (107 LOC)
  artifact.py (139 LOC)
  backfill.py (44 LOC)
  classify.py (137 LOC)
  cli.py (633 LOC)
  commit_queue.py (275 LOC)
  contracts.py (155 LOC)
  dedupe.py (94 LOC)
  diagnose_failure.py (275 LOC)
  diff_normalize.py (83 LOC)
  events.py (54 LOC)
  floor.py (54 LOC)
  gate.py (683 LOC)
  knowledge_drift.py (65 LOC)
  landscape.py (313 LOC)
  lane_plan.py (406 LOC)
  lane_tools_runner.py (121 LOC)
  language_detect.py (133 LOC)
  learn_patterns.py (177 LOC)
  local_llm.py (1334 LOC)
  memory_audit.py (104 LOC)
  memory_extract.py (116 LOC)
  memory_semantic.py (265 LOC)
  migrate.py (120 LOC)
  no_diff_guard.py (130 LOC)
  path_utils.py (111 LOC)
  pipeline_scheduler.py (196 LOC)
  pr_comment_monitor.py (215 LOC)
  prompt_loader.py (94 LOC)
  remediate.py (92 LOC)
  render.py (175 LOC)
  report_bug.py (140 LOC)
  rollback.py (195 LOC)
  rules_doctor.py (116 LOC)
  schemas.py (77 LOC)
  self_check.py (128 LOC)
  skeleton_creator.py (403 LOC)
  spec_drift_detector.py (194 LOC)
  state.py (410 LOC)
  status_render.py (180 LOC)
  telemetry.py (38 LOC)
  test_ratchet.py (256 LOC)
  test_signal.py (345 LOC)
    gitnexus_setup.py (50 LOC)
    install_hooks.py (188 LOC)
    install_linter_rules.py (43 LOC)
    install_skill.py (77 LOC)
    seed_state_docs.py (251 LOC)
    setup_symlinks.py (24 LOC)
    archive.py (35 LOC)
    collate.py (72 LOC)
    collect_brief_defects.py (38 LOC)
    collect_git.py (62 LOC)
    collect_gitnexus_diff.py (58 LOC)
    collect_lane_tools.py (53 LOC)
    collect_platform.py (45 LOC)
    collect_tasks.py (60 LOC)
    collect_token_metrics.py (86 LOC)
    collect_wait_times.py (54 LOC)
    commit_closeout.py (81 LOC)
    detect_solutions.py (62 LOC)
    file_followups.py (104 LOC)
    gitnexus_reindex.py (36 LOC)
    tag_epic.py (58 LOC)
    _strict.py (71 LOC)
    _trace.py (133 LOC)
    chunker.py (131 LOC)
    embeddings.py (193 LOC)
    hrr.py (271 LOC)
    ingest.py (316 LOC)
    migrate.py (375 LOC)
    migrate_wfc.py (375 LOC)
    nugget.py (590 LOC)
    rag_engine.py (378 LOC)
    __init__.py (3 LOC)
    artifact_schema.py (28 LOC)
    brief_green_continuation_schema.py (38 LOC)
    brief_green_schema.py (54 LOC)
    brief_red_schema.py (56 LOC)
    brief_refactor_schema.py (55 LOC)
    candidate_edge_cases_schema.py (51 LOC)
    closeout_data_schema.py (91 LOC)
    environment_schema.py (82 LOC)
    executor_result_schema.py (126 LOC)
    follow_up_schema.py (45 LOC)
    lane_plan_schema.py (34 LOC)
    lane_schema.py (34 LOC)
    packet_schema.py (44 LOC)
    preflight_result_schema.py (42 LOC)
    quality_schema.py (49 LOC)
    result_adversarial_schema.py (31 LOC)
    result_green_schema.py (44 LOC)
    result_red_schema.py (44 LOC)
    result_refactor_schema.py (50 LOC)
    state_schema.py (103 LOC)
    task_schema.py (27 LOC)
    tasks_schema.py (15 LOC)
    __init__.py (0 LOC)
    file_io.py (270 LOC)
      __init__.py (94 LOC)
      config.py (46 LOC)
      context.py (60 LOC)
      decorators.py (109 LOC)
      formatters.py (138 LOC)
      sanitizer.py (68 LOC)
    __init__.py (29 LOC)
    extractor.py (391 LOC)
    miner.py (282 LOC)
    models.py (34 LOC)
    orchestrator.py (147 LOC)
    validator.py (101 LOC)
    vitest.toml (51 LOC)
    xctest.toml (50 LOC)
  README.md (23 LOC)
  app.py (250 LOC)
  data.py (138 LOC)
  test_app.py (55 LOC)
    README.md (210 LOC)
    SKILL.md (623 LOC)
    metadata.json (12 LOC)
      input-styles.md (262 LOC)
      loader.md (140 LOC)
      modules.md (522 LOC)
      server-entry-points.md (209 LOC)
      slash-commands.md (228 LOC)
      system-prompt.md (104 LOC)
      tool-display.md (321 LOC)
      tools.md (210 LOC)
      tui.md (112 LOC)
      .gitignore (5 LOC)
      package-lock.json (335 LOC)
      package.json (27 LOC)
      test-tui.md (108 LOC)
      tsconfig.json (13 LOC)
        banner.png (108 LOC)
        input-style-block.png (96 LOC)
        input-style-bordered.png (82 LOC)
        input-style-plain.png (77 LOC)
        loader-gradient.png (104 LOC)
        loader-minimal.png (140 LOC)
        loader-spinner.png (112 LOC)
        tool-display-emoji.png (216 LOC)
        tool-display-grouped.png (265 LOC)
        tool-display-minimal.png (244 LOC)
        agent.ts (91 LOC)
        banner.ts (23 LOC)
        cli.ts (355 LOC)
        commands.ts (91 LOC)
        config.ts (83 LOC)
        loader.ts (68 LOC)
        renderer.ts (246 LOC)
        screenshot-demos.ts (62 LOC)
        session.ts (50 LOC)
        terminal-bg.ts (70 LOC)
          custom.ts (13 LOC)
          file-edit.ts (46 LOC)
          file-read.ts (51 LOC)
          file-write.ts (22 LOC)
          glob.ts (29 LOC)
          grep.ts (41 LOC)
          index.ts (21 LOC)
          list-dir.ts (24 LOC)
          shell.ts (42 LOC)
  datum-workflow_01_flowchart_datum_pipeline_overv.mmd (61 LOC)
  datum-workflow_01_flowchart_datum_pipeline_overv.png (613 LOC)
  datum-workflow_02_flowchart_act_phase_detail.mmd (47 LOC)
  datum-workflow_02_flowchart_act_phase_detail.png (251 LOC)
  .DS_Store (3 LOC)
  CURRENT_STATE.md (31 LOC)
  DATUM.md (1227 LOC)
  HORIZON.md (24 LOC)
  MEMORY.md (171 LOC)
  ROADMAP.md (13 LOC)
  TASKS.md (20 LOC)
  apply-fts-patch.mjs (56 LOC)
  datum-workflow.md (178 LOC)
  field-notes-bodyman-epic-ui1-20260520.md (442 LOC)
  gitnexus-fts-fix.md (151 LOC)
    000-template.md (30 LOC)
    INVARIANTS.md (209 LOC)
        PROPERTIES.md (178 LOC)
        QUESTIONS.md (28 LOC)
        SPEC.md (166 LOC)
        TASKS.md (187 LOC)
        TICKET.md (120 LOC)
        tasks.json (206 LOC)
        RETRO.md (25 LOC)
        RETRO.md (25 LOC)
        RETRO.md (23 LOC)
        RETRO.md (24 LOC)
        RETRO.md (25 LOC)
        RETRO.md (24 LOC)
        RETRO.md (24 LOC)
        RETRO.md (38 LOC)
        QUESTIONS.md (9 LOC)
        SPEC.md (94 LOC)
        TICKET.md (35 LOC)
        QUESTIONS.md (9 LOC)
        SPEC.md (109 LOC)
        TICKET.md (13 LOC)
        RETRO.md (24 LOC)
        RETRO.md (25 LOC)
    README.md (3 LOC)
  evals.json (150 LOC)
    pipeline-enhancements.json (18 LOC)
    pipeline-enhancements.json (28 LOC)
  00-discovery.md (98 LOC)
  01-refine.md (99 LOC)
  01.5-research.md (42 LOC)
  02-plan.md (175 LOC)
  02.5-triage.md (28 LOC)
  02.8-deepen.md (31 LOC)
  03-properties.md (98 LOC)
  03.5-architect.md (46 LOC)
  04-act-adversarial-brief.md (114 LOC)
  04-act-completed-with-risks.md (101 LOC)
  04-act-edge-cases.md (18 LOC)
  04-act-go.md (86 LOC)
  04-act-green-brief.md (93 LOC)
  04-act-green-multiturn.md (128 LOC)
  04-act-python.md (71 LOC)
  04-act-red-brief.md (80 LOC)
  04-act-refactor-brief.md (95 LOC)
  04-act-skeleton-preflight.md (129 LOC)
  04-act-swift.md (96 LOC)
  04-act-typescript.md (78 LOC)
  04-act.md (123 LOC)
  05-validate.md (67 LOC)
  06-review.md (62 LOC)
  07-pr-comments.md (90 LOC)
  08-closeout.md (113 LOC)
  0x-express.md (85 LOC)
  activity-diagrams.md (478 LOC)
  agent-contracts.md (394 LOC)
  architecture-diagrams.md (1112 LOC)
  brief-builder.md (286 LOC)
  coding-steering.md (40 LOC)
  cross-cutting-visual.md (14 LOC)
  current-state.md (71 LOC)
  deployment-diagrams.md (621 LOC)
  diagram-legibility.md (347 LOC)
  domain-wisdom.md (133 LOC)
  dream.md (72 LOC)
  git-workflows.md (26 LOC)
  gitnexus-playbook.md (75 LOC)
  impact-analysis.md (40 LOC)
  mermaid-diagram-guide.md (718 LOC)
  model-tiers.md (88 LOC)
  pattern-library.md (155 LOC)
  pipeline-dispatch.md (99 LOC)
  prompt-template.md (36 LOC)
  proof-of-work.md (91 LOC)
  property-categories.md (158 LOC)
  quality-profiles.md (158 LOC)
  recovery-modes.md (115 LOC)
  resilient-workflow.md (634 LOC)
  rollback.md (93 LOC)
  sagas.md (27 LOC)
  sequence-diagrams.md (867 LOC)
  spec-drift.md (98 LOC)
  steering-shape.md (54 LOC)
  token-efficiency.md (81 LOC)
  troubleshooting.md (941 LOC)
  unicode-symbols.md (504 LOC)
  datum.py (34 LOC)
  extract_mermaid.py (350 LOC)
  mermaid_to_image.py (353 LOC)
  resilient_diagram.py (682 LOC)
  transcript-demo.html (4128 LOC)
  transcript_to_html.py (176 LOC)
    README.md (30 LOC)
    filter_gitnexus_output.py (67 LOC)
    find_callers.py (64 LOC)
    grep_search.py (69 LOC)
    list_dir.py (35 LOC)
    manifest.toml (69 LOC)
    read_file.py (36 LOC)
    read_file_range.py (50 LOC)
    run_command.py (45 LOC)
    SKILL.md (290 LOC)
      evals.json (40 LOC)
  000-madr-template.md (30 LOC)
  CURRENT_STATE.md (22 LOC)
  PROPERTIES.md (91 LOC)
  QUESTIONS.md (35 LOC)
  ROADMAP.md (19 LOC)
  SPEC.md (82 LOC)
  TASKS.md (54 LOC)
  api-design-template.md (556 LOC)
  architecture-design-template.md (411 LOC)
  database-design-template.md (610 LOC)
  environment.yaml (30 LOC)
  feature-design-template.md (574 LOC)
  quality.yaml (61 LOC)
  system-design-template.md (735 LOC)
  test_classify.py (180 LOC)
  test_datum_hardening.py (267 LOC)
  test_gate_enhancements.py (144 LOC)
  test_landscape.py (184 LOC)
  test_units.py (283 LOC)
      MyViewTests.swift (19 LOC)
```

### LOC by Directory

| Directory | LOC |
|-----------|-----|
| (root) | 2737 |
| .antigravitycli | 14 |
| .claude | 641 |
| .claude/agents | 25 |
| .claude/skills | 532 |
| .claude/skills/gitnexus | 532 |
| .claude/skills/gitnexus/gitnexus-cli | 83 |
| .claude/skills/gitnexus/gitnexus-debugging | 89 |
| .claude/skills/gitnexus/gitnexus-exploring | 78 |
| .claude/skills/gitnexus/gitnexus-guide | 64 |
| .claude/skills/gitnexus/gitnexus-impact-analysis | 97 |
| .claude/skills/gitnexus/gitnexus-refactoring | 121 |
| .entire | 9296 |
| .entire/logs | 1079 |
| .entire/metadata | 8195 |
| .entire/metadata/011f10ba-5a33-4f7f-862c-775f46aa941d | 443 |
| .entire/metadata/22c7ee55-dd95-47c2-898e-eb1751fa8a69 | 6230 |
| .entire/metadata/b51a9ff8-5d2c-4458-a3a9-998d4aa59639 | 1522 |
| .entire/tmp | 6 |
| assets | 878 |
| assets/fixtures | 188 |
| assets/fixtures/contracts | 188 |
| assets/hooks | 468 |
| datum | 16973 |
| datum-tui | 6779 |
| datum-tui/reference-openrouter | 6313 |
| datum-tui/reference-openrouter/references | 2108 |
| datum-tui/reference-openrouter/sample | 3360 |
| datum-tui/reference-openrouter/sample/screenshots | 1444 |
| datum-tui/reference-openrouter/sample/src | 1428 |
| datum-tui/reference-openrouter/sample/src/tools | 289 |
| datum/bootstrap | 633 |
| datum/closeout | 904 |
| datum/memory | 2833 |
| datum/models | 1146 |
| datum/shared | 785 |
| datum/shared/logging | 515 |
| datum/steering | 984 |
| datum/test_ratchet | 101 |
| diagrams | 972 |
| docs | 3969 |
| docs/adr | 30 |
| docs/architecture | 209 |
| docs/epics | 1411 |
| docs/epics/datum | 1411 |
| docs/epics/datum-epic-1 | 0 |
| docs/epics/datum/epic-1 | 885 |
| docs/epics/datum/epic-10 | 25 |
| docs/epics/datum/epic-11 | 25 |
| docs/epics/datum/epic-12 | 23 |
| docs/epics/datum/epic-13 | 24 |
| docs/epics/datum/epic-14 | 25 |
| docs/epics/datum/epic-15 | 24 |
| docs/epics/datum/epic-16 | 24 |
| docs/epics/datum/epic-17 | 38 |
| docs/epics/datum/epic-2 | 138 |
| docs/epics/datum/epic-7 | 131 |
| docs/epics/datum/epic-8 | 24 |
| docs/epics/datum/epic-9 | 25 |
| docs/practice | 3 |
| evals | 150 |
| observability | 46 |
| observability/alerts | 18 |
| observability/metrics | 28 |
| references | 10872 |
| scripts | 6188 |
| scripts/lane-tools | 465 |
| skills | 330 |
| skills/gitnexus-bug-hunt | 330 |
| skills/gitnexus-bug-hunt/evals | 40 |
| templates | 3310 |
| tests | 1077 |
| tests/Unit | 19 |
| tests/Unit/src | 19 |

## Module Docstrings

- **datum**: DATUM V2 Python Module
- **datum/shared/logging**: Centralized logging infrastructure for WFC.

This module provides structured logging with:
- Secret sanitization
- JSON and console formatters
- Request/session ID tracking
- Performance timing decorators
- Environment-based configuration
- **datum/steering**: datum-coding-steering - Evidence mining and steering-doc validation helpers.

## GitNexus Enrichment

<!-- gitnexus:start -->
<!-- gitnexus:end -->
