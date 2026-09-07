# Landscape

## Tech Stack

- **python**: datum
- **node/javascript**: datum

## File Tree

```
.caliper.yaml (31 LOC)
.caliper/
  code_graph.sqlite (42970 LOC)
.caliperignore (8 LOC)
.claude/
  skills/
    gitnexus/
      gitnexus-cli/
        SKILL.md (83 LOC)
      gitnexus-debugging/
        SKILL.md (89 LOC)
      gitnexus-exploring/
        SKILL.md (78 LOC)
      gitnexus-guide/
        SKILL.md (64 LOC)
      gitnexus-impact-analysis/
        SKILL.md (97 LOC)
      gitnexus-refactoring/
        SKILL.md (121 LOC)
.entire/
  .gitignore (5 LOC)
  settings.json (11 LOC)
.gitignore (50 LOC)
.opencode/
  plugins/
    datum.ts (548 LOC)
  tsconfig.json (12 LOC)
.serena/
  .gitignore (2 LOC)
  project.yml (160 LOC)
AGENTS.md (141 LOC)
CHANGELOG.md (480 LOC)
CLAUDE.md (51 LOC)
CODEX.md (3 LOC)
COPILOT.md (3 LOC)
CURRENT_STATE.md (118 LOC)
GEMINI.md (3 LOC)
KIRO.md (3 LOC)
README.md (91 LOC)
ROADMAP.md (29 LOC)
SKILL.md (182 LOC)
agents/
  datum-cli.md (21 LOC)
  datum-docs.md (48 LOC)
  datum-green.md (52 LOC)
  datum-quality-reader.md (17 LOC)
  datum-reader.md (19 LOC)
  datum-red.md (69 LOC)
  datum-refactor.md (56 LOC)
  datum-reflect.md (29 LOC)
  datum-skeptic.md (40 LOC)
assets/
  config.toml.default (225 LOC)
  fixtures/
    contracts/
      green-brief.valid.json (34 LOC)
      green-continuation.valid.json (16 LOC)
      green-result.valid.json (23 LOC)
      red-brief.valid.json (24 LOC)
      red-result.valid.json (24 LOC)
      refactor-brief.valid.json (34 LOC)
      refactor-result.valid.json (33 LOC)
  hooks/
    post-tool-use-test-ratchet-live.sh (46 LOC)
    pre-commit-banned-patterns.sh (27 LOC)
    pre-commit-file-size.sh (24 LOC)
    pre-commit-guard-main.py (17 LOC)
    pre-commit-lane-tools-manifest.sh (43 LOC)
    pre-commit-layer-boundary.sh (24 LOC)
    pre-commit-tdd-guard.sh (47 LOC)
    pre-commit-test-ratchet.sh (24 LOC)
    pre-tool-use-commit-format.sh (51 LOC)
    pre-tool-use-install-interceptor.sh (43 LOC)
    pre-tool-use-lane-file-guard.sh (67 LOC)
    pre-tool-use-no-shell-llm.sh (22 LOC)
    pre-tool-use-pip-to-uv.sh (56 LOC)
    pre-tool-use-protect-tests.sh (59 LOC)
    test_pre-commit-lane-tools-manifest.sh (40 LOC)
    test_pre-commit-test-ratchet.sh (65 LOC)
    test_pre-tool-use-install-interceptor.sh (48 LOC)
  schemas/
    task.schema.json (40 LOC)
    tasks.schema.json (9 LOC)
    unified.schema.json (20 LOC)
datum-tui/
  README.md (23 LOC)
  app.py (250 LOC)
  data.py (138 LOC)
  reference-openrouter/
    README.md (210 LOC)
    SKILL.md (623 LOC)
    metadata.json (12 LOC)
    references/
      input-styles.md (262 LOC)
      loader.md (140 LOC)
      modules.md (522 LOC)
      server-entry-points.md (209 LOC)
      slash-commands.md (228 LOC)
      system-prompt.md (104 LOC)
      tool-display.md (321 LOC)
      tools.md (210 LOC)
      tui.md (112 LOC)
    sample/
      .gitignore (5 LOC)
      package-lock.json (760 LOC)
      package.json (27 LOC)
      screenshots/
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
      src/
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
        tools/
          custom.ts (13 LOC)
          file-edit.ts (46 LOC)
          file-read.ts (51 LOC)
          file-write.ts (22 LOC)
          glob.ts (29 LOC)
          grep.ts (41 LOC)
          index.ts (21 LOC)
          list-dir.ts (24 LOC)
          shell.ts (42 LOC)
      test-tui.md (108 LOC)
      tsconfig.json (13 LOC)
  test_app.py (55 LOC)
datum/
  __init__.py (3 LOC)
  agent_loop.py (2101 LOC)
  agents_materialize.py (295 LOC)
  archive.py (107 LOC)
  artifact.py (136 LOC)
  artifact_score.py (364 LOC)
  assets/
    evaluator_examples.toml (48 LOC)
    schemas/
      task.schema.json (40 LOC)
      tasks.schema.json (9 LOC)
      unified.schema.json (20 LOC)
  bootstrap/
    gitnexus_setup.py (50 LOC)
    install_hooks.py (191 LOC)
    install_linter_rules.py (43 LOC)
    install_skill.py (77 LOC)
    seed_state_docs.py (195 LOC)
    setup_symlinks.py (23 LOC)
  budget.py (147 LOC)
  caliper_blast_radius.py (109 LOC)
  classify.py (137 LOC)
  cli.py (3090 LOC)
  closeout/
    archive.py (39 LOC)
    collate.py (150 LOC)
    collect_brief_defects.py (34 LOC)
    collect_git.py (86 LOC)
    collect_gitnexus_diff.py (54 LOC)
    collect_lane_tools.py (50 LOC)
    collect_platform.py (41 LOC)
    collect_tasks.py (180 LOC)
    collect_token_metrics.py (121 LOC)
    collect_wait_times.py (54 LOC)
    commit_closeout.py (195 LOC)
    detect_solutions.py (74 LOC)
    file_followups.py (155 LOC)
    gitnexus_reindex.py (92 LOC)
    tag_epic.py (58 LOC)
  closeout_cmd.py (269 LOC)
  code_tells.py (112 LOC)
  command_guard.py (103 LOC)
  config_fingerprint.py (66 LOC)
  context_skeleton.py (293 LOC)
  contract_preflight.py (336 LOC)
  contracts.py (178 LOC)
  detect.py (216 LOC)
  diagnose_failure.py (307 LOC)
  diff_normalize.py (83 LOC)
  failure_layer.py (179 LOC)
  floor.py (54 LOC)
  gate.py (1723 LOC)
  gc.py (368 LOC)
  github_issues.py (447 LOC)
  gitignore_check.py (79 LOC)
  integration_invariants.py (206 LOC)
  knowledge_drift.py (65 LOC)
  landscape.py (334 LOC)
  lane_cleanup.py (65 LOC)
  lane_hash.py (80 LOC)
  lane_plan.py (853 LOC)
  lane_plan_digest.py (100 LOC)
  lane_spec_export.py (208 LOC)
  lane_tools_runner.py (125 LOC)
  language_detect.py (133 LOC)
  learn_patterns.py (177 LOC)
  local_llm.py (2040 LOC)
  memory/
    _strict.py (71 LOC)
    _trace.py (134 LOC)
    chunker.py (131 LOC)
    corpus_sql.py (512 LOC)
    embeddings.py (209 LOC)
    generic_chunker.py (240 LOC)
    hrr.py (271 LOC)
    ingest.py (317 LOC)
    ledger.py (138 LOC)
    nugget.py (590 LOC)
    rag_engine.py (339 LOC)
    retrieve.py (438 LOC)
    vector_store.py (393 LOC)
  memory_audit.py (107 LOC)
  memory_extract.py (144 LOC)
  memory_semantic.py (265 LOC)
  migrate.py (134 LOC)
  models/
    __init__.py (3 LOC)
    artifact_schema.py (28 LOC)
    brief_green_continuation_schema.py (38 LOC)
    brief_green_schema.py (54 LOC)
    brief_red_schema.py (56 LOC)
    brief_refactor_schema.py (55 LOC)
    candidate_edge_cases_schema.py (51 LOC)
    closeout_data_schema.py (111 LOC)
    environment_schema.py (82 LOC)
    executor_result_schema.py (126 LOC)
    follow_up_schema.py (45 LOC)
    lane_plan_schema.py (38 LOC)
    lane_schema.py (34 LOC)
    packet_schema.py (44 LOC)
    preflight_result_schema.py (46 LOC)
    quality_schema.py (49 LOC)
    result_adversarial_schema.py (31 LOC)
    result_green_schema.py (44 LOC)
    result_red_schema.py (44 LOC)
    result_refactor_schema.py (50 LOC)
    state_schema.py (103 LOC)
    task_schema.py (30 LOC)
    tasks_schema.py (15 LOC)
    triage_decision_schema.py (10 LOC)
    walkthrough_schema.py (11 LOC)
  no_diff_guard.py (130 LOC)
  path_utils.py (111 LOC)
  permissions.py (37 LOC)
  pipeline_scheduler.py (187 LOC)
  pipeline_state.py (221 LOC)
  pr_comment_monitor.py (228 LOC)
  prompt_loader.py (94 LOC)
  prompt_sanitizer.py (205 LOC)
  remediate.py (93 LOC)
  render.py (247 LOC)
  report_bug.py (140 LOC)
  retrospect.py (369 LOC)
  rollback.py (195 LOC)
  rules_doctor.py (116 LOC)
  schemas.py (280 LOC)
  self_check.py (150 LOC)
  shared/
    __init__.py (0 LOC)
    file_io.py (270 LOC)
    logging/
      __init__.py (94 LOC)
      config.py (46 LOC)
      context.py (60 LOC)
      decorators.py (110 LOC)
      formatters.py (138 LOC)
      sanitizer.py (68 LOC)
  skeleton.py (180 LOC)
  skeleton_creator.py (879 LOC)
  skills_materialize.py (110 LOC)
  slug.py (29 LOC)
  spec_drift_detector.py (194 LOC)
  state.py (613 LOC)
  status_render.py (204 LOC)
  steering/
    __init__.py (29 LOC)
    extractor.py (391 LOC)
    miner.py (282 LOC)
    models.py (34 LOC)
    orchestrator.py (147 LOC)
    validator.py (101 LOC)
  structural_fingerprint.py (76 LOC)
  tdd_args.py (162 LOC)
  tdd_driver.py (137 LOC)
  test_ratchet.py (256 LOC)
  test_ratchet/
    vitest.toml (51 LOC)
    xctest.toml (50 LOC)
  test_signal.py (342 LOC)
  todos.py (45 LOC)
  tool_risk.py (101 LOC)
  walkthrough.py (141 LOC)
  wave_builder.py (213 LOC)
  workflow_dashboard.py (100 LOC)
  worktree_manager.py (1001 LOC)
diagrams/
  datum-workflow_01_flowchart_datum_pipeline_overv.mmd (61 LOC)
  datum-workflow_01_flowchart_datum_pipeline_overv.png (613 LOC)
  datum-workflow_02_flowchart_act_phase_detail.mmd (47 LOC)
  datum-workflow_02_flowchart_act_phase_detail.png (251 LOC)
docs/
  FLOW.md (432 LOC)
  HORIZON.md (24 LOC)
  LANDSCAPE.md (1161 LOC)
  adr/
    000-template.md (30 LOC)
  archive/
    field-notes-bodyman-epic-ui1-20260520.md (444 LOC)
  datum-pipeline-overview.md (114 LOC)
  diagrams/
    README.md (12 LOC)
    flow-lane-sequence.png (1219 LOC)
    flow-lane-states.png (367 LOC)
    flow-pipeline.png (838 LOC)
    flow-propose-verify.png (143 LOC)
  epics/
    WALKTHROUGH-session-20260528.md (83 LOC)
    claude/
      agentic-lang-pipeline-8dqtgr/
        RETRO.md (26 LOC)
        WALKTHROUGH.md (9 LOC)
    datum/
      bug-squash-167-act/
        RETRO.md (123 LOC)
        REVIEW-REPORT.md (8 LOC)
        SPEC.md (208 LOC)
        TASKS.md (135 LOC)
        TICKET.md (8 LOC)
        follow-ups.json (104 LOC)
        lane-plan.json (158 LOC)
        tasks.json (1 LOC)
      bug-squash-167/
        PROPERTIES.md (357 LOC)
        QUESTIONS.md (51 LOC)
        RETRO.md (101 LOC)
        REVIEW-REPORT.md (8 LOC)
        SPEC.md (208 LOC)
        TASKS.md (135 LOC)
        TICKET.md (30 LOC)
        lane-plan.json (158 LOC)
        routing.json (8 LOC)
        tasks.json (1 LOC)
      bug-squash-281/
        QUESTIONS.md (21 LOC)
        RETRO.md (26 LOC)
        SPEC.md (145 LOC)
        TASKS.md (85 LOC)
        TICKET.md (45 LOC)
        WALKTHROUGH.md (9 LOC)
        lane-plan.json (170 LOC)
        skeletons/
          batch-summary.json (33 LOC)
          preflight-task-001.json (83 LOC)
          preflight-task-002.json (95 LOC)
          preflight-task-003.json (95 LOC)
          preflight-task-004.json (71 LOC)
          preflight-task-005.json (71 LOC)
        tasks.json (1 LOC)
      bug-squash-g567/
        QUESTIONS.md (39 LOC)
        SPEC.md (258 LOC)
      bug-squash-round-2/
        PROPERTIES.md (318 LOC)
        QUESTIONS.md (31 LOC)
        RETRO.md (59 LOC)
        REVIEW-REPORT.md (17 LOC)
        SPEC.md (153 LOC)
        TASKS.md (169 LOC)
        TICKET.md (27 LOC)
        WALKTHROUGH.md (9 LOC)
        lane-plan.json (251 LOC)
        skeletons/
          batch-summary.json (58 LOC)
          preflight-adopt-existing-feature-branch.json (63 LOC)
          preflight-cleanup-orphaned-zero-commit-lane-branches.json (49 LOC)
          preflight-fail-loud-walkthrough.json (50 LOC)
          preflight-filter-transcript-noise-memory-extract.json (49 LOC)
          preflight-git-fallback-retro-delivery.json (49 LOC)
          preflight-guard-duplicate-local-llm-toml.json (49 LOC)
          preflight-path-boundary-file-ownership.json (62 LOC)
          preflight-recognize-bug-squash-branch-slug.json (61 LOC)
          preflight-relax-test-artifact-convention.json (49 LOC)
          preflight-validate-testcommand-before-dispatch.json (63 LOC)
        tasks.json (1 LOC)
      consumer-first-build-order/
        PROPERTIES.md (215 LOC)
        QUESTIONS.md (26 LOC)
        RETRO.md (84 LOC)
        REVIEW-REPORT.md (15 LOC)
        SPEC.md (122 LOC)
        TASKS.md (72 LOC)
        TICKET.md (21 LOC)
        WALKTHROUGH.md (178 LOC)
        lane-plan.json (140 LOC)
        skeletons/
          batch-summary.json (33 LOC)
          preflight-add-context-files-config-default.json (49 LOC)
          preflight-add-cycle-detection.json (59 LOC)
          preflight-add-upstream-source-context.json (74 LOC)
          preflight-datum-plan-buildorder-and-context.json (86 LOC)
          preflight-wire-lane-upstream-injection.json (49 LOC)
        tasks.json (1 LOC)
      epic-1/
        PROPERTIES.md (178 LOC)
        QUESTIONS.md (28 LOC)
        SPEC.md (166 LOC)
        TASKS.md (187 LOC)
        TICKET.md (120 LOC)
        tasks.json (206 LOC)
      epic-10/
        RETRO.md (25 LOC)
      epic-11/
        RETRO.md (25 LOC)
      epic-12/
        RETRO.md (23 LOC)
      epic-13/
        RETRO.md (24 LOC)
      epic-14/
        RETRO.md (25 LOC)
      epic-15/
        RETRO.md (24 LOC)
      epic-16/
        RETRO.md (24 LOC)
      epic-17/
        RETRO.md (38 LOC)
      epic-19/
        QUESTIONS.md (13 LOC)
        SPEC.md (107 LOC)
        TASKS.md (95 LOC)
        TICKET.md (22 LOC)
        tasks.json (92 LOC)
      epic-2/
        QUESTIONS.md (9 LOC)
        SPEC.md (94 LOC)
        TICKET.md (35 LOC)
      epic-20/
        QUESTIONS.md (5 LOC)
        SPEC.md (131 LOC)
        TASKS.md (69 LOC)
        TICKET.md (32 LOC)
        tasks.json (43 LOC)
      epic-21/
        QUESTIONS.md (5 LOC)
        SPEC.md (86 LOC)
        TICKET.md (12 LOC)
      epic-22/
        QUESTIONS.md (5 LOC)
        SPEC.md (96 LOC)
        TICKET.md (16 LOC)
      epic-24/
        TICKET.md (17 LOC)
      epic-25/
        RETRO.md (26 LOC)
        WALKTHROUGH.md (9 LOC)
      epic-26/
        PROPERTIES.md (200 LOC)
        QUESTIONS.md (44 LOC)
        SPEC.md (198 LOC)
        TASKS.md (187 LOC)
        TICKET.md (41 LOC)
        bootstrap/
          materialize.sh (193 LOC)
          templates/
            README.md (71 LOC)
            config.toml (128 LOC)
            fixture/
              calculator.py (13 LOC)
              conftest.py (3 LOC)
              pyproject.toml (7 LOC)
              test_calculator.py (11 LOC)
              uv.lock (8 LOC)
            gitignore (16 LOC)
            init.py (13 LOC)
            m1_driver.py (360 LOC)
            pyproject.toml (18 LOC)
            test_contracts.py (321 LOC)
            test_m1_e2e.py (319 LOC)
        tasks.json (174 LOC)
      epic-7/
        QUESTIONS.md (9 LOC)
        SPEC.md (109 LOC)
        TICKET.md (13 LOC)
      epic-8/
        RETRO.md (24 LOC)
      epic-9/
        RETRO.md (25 LOC)
      fail-fast-validation/
        PROPERTIES.md (309 LOC)
        QUESTIONS.md (37 LOC)
        RETRO.md (81 LOC)
        REVIEW-REPORT.md (26 LOC)
        SPEC.md (172 LOC)
        TASKS.md (54 LOC)
        TICKET.md (24 LOC)
        lane-plan.json (99 LOC)
        tasks.json (1 LOC)
      gh-issues-as-source-of-truth/
        PROPERTIES.md (347 LOC)
        QUESTIONS.md (89 LOC)
        SPEC.md (229 LOC)
        TASKS.md (96 LOC)
        TICKET.md (20 LOC)
        lane-plan.json (172 LOC)
        tasks.json (1 LOC)
      hermetic-test-git-fixtures/
        QUESTIONS.md (16 LOC)
        SPEC.md (99 LOC)
        TICKET.md (59 LOC)
      integration-lanes-2/
        PROPERTIES.md (179 LOC)
        QUESTIONS.md (43 LOC)
        SPEC.md (147 LOC)
        TASKS.md (72 LOC)
        TICKET.md (36 LOC)
        lane-plan.json (249 LOC)
        skeletons/
          batch-summary.json (28 LOC)
          preflight-task-001.json (74 LOC)
          preflight-task-002.json (137 LOC)
          preflight-task-003.json (75 LOC)
          preflight-task-004.json (75 LOC)
        tasks.json (1 LOC)
      integration-lanes/
        PROPERTIES.md (161 LOC)
        QUESTIONS.md (30 LOC)
        RETRO.md (86 LOC)
        REVIEW-REPORT.md (17 LOC)
        REVIEW-RESPONSE.md (5 LOC)
        SPEC.md (172 LOC)
        TASKS.md (220 LOC)
        TICKET.md (40 LOC)
        lane-plan.json (282 LOC)
        skeletons/
          batch-summary.json (53 LOC)
          preflight-task-001.json (106 LOC)
          preflight-task-002.json (110 LOC)
          preflight-task-003.json (74 LOC)
          preflight-task-004.json (118 LOC)
          preflight-task-005.json (110 LOC)
          preflight-task-006.json (98 LOC)
          preflight-task-007.json (86 LOC)
          preflight-task-008.json (98 LOC)
          preflight-task-009.json (76 LOC)
        tasks.json (1 LOC)
      state-single-source-of-truth/
        TICKET.md (85 LOC)
    main/
      RETRO.md (88 LOC)
      REVIEW-REPORT.md (31 LOC)
  practice/
    README.md (3 LOC)
  research/
    claude-skills-audit-20260906-130507.json (565 LOC)
    claude-skills-audit-20260906-130507.md (671 LOC)
    docs-audit-20260906-152916.md (291 LOC)
    prompts-audit-20260906-213201.md (887 LOC)
    references-audit-20260906-164303.md (417 LOC)
evals/
  evals.json (150 LOC)
install.sh (403 LOC)
observability/
  alerts/
    epic26-local-write-path.json (46 LOC)
    pipeline-enhancements.json (18 LOC)
  dashboards/
    epic26-local-write-path.json (81 LOC)
  metrics/
    epic26-local-write-path.json (68 LOC)
    pipeline-enhancements.json (28 LOC)
package-lock.json (1699 LOC)
package.json (22 LOC)
policies/
  semgrep/
    README (3 LOC)
    assert-for-validation.yaml (30 LOC)
    bool-comparison.yaml (27 LOC)
    boolean-flag-argument-call.yaml (22 LOC)
    command-injection.yaml (54 LOC)
    dead-code-after-return-js.yaml (32 LOC)
    dead-code-after-return.yaml (44 LOC)
    dispatch-conditionals-should-be-table.yaml (26 LOC)
    enterprise-class-name.yaml (30 LOC)
    event-type-string-consistency.yaml (23 LOC)
    git-head-tilde-without-fallback.yaml (24 LOC)
    global-mutable-state.yaml (35 LOC)
    hardcoded-credentials.yaml (82 LOC)
    insecure-tls-config.yaml (42 LOC)
    jwt-verification-bypass.yaml (47 LOC)
    legacy-branch-pileup.yaml (28 LOC)
    long-if-elif-chain-js.yaml (25 LOC)
    long-if-elif-chain.yaml (30 LOC)
    long-parameter-list-java.yaml (20 LOC)
    long-parameter-list-js.yaml (20 LOC)
    long-parameter-list.yaml (20 LOC)
    magic-number.yaml (35 LOC)
    missing-oserror-on-file-open.yaml (56 LOC)
    mutable-default-argument.yaml (26 LOC)
    no-root-access-keys.yaml (45 LOC)
    none-comparison-equality.yaml (25 LOC)
    path-traversal.yaml (60 LOC)
    retry-loop-without-error-contract.yaml (32 LOC)
    sbom-from-environment.yaml (26 LOC)
    sleep-based-synchronization.yaml (24 LOC)
    sql-injection.yaml (49 LOC)
    ssrf-prevention.yaml (60 LOC)
    subprocess-f-string-sql.yaml (34 LOC)
    substring-match-without-word-boundary.yaml (24 LOC)
    unsafe-deserialization.yaml (48 LOC)
    unvalidated-path-construction.yaml (40 LOC)
    verify-gate-fails-open.yaml (41 LOC)
    weak-crypto-algorithms.yaml (53 LOC)
    wildcard-import-js.yaml (21 LOC)
    wildcard-import.yaml (21 LOC)
    xss-prevention.yaml (54 LOC)
    xxe-prevention.yaml (46 LOC)
pyproject.toml (75 LOC)
references/
  00-discovery.md (98 LOC)
  01-refine.md (109 LOC)
  01.5-research.md (42 LOC)
  02-plan.md (179 LOC)
  02.3-prior-art.md (228 LOC)
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
  04-act-swift.md (100 LOC)
  04-act-typescript.md (78 LOC)
  04-act.md (123 LOC)
  05-validate.md (67 LOC)
  06-review.md (62 LOC)
  07-pr-comments.md (92 LOC)
  08-closeout.md (113 LOC)
  0x-express.md (85 LOC)
  activity-diagrams.md (478 LOC)
  agent-contracts.md (394 LOC)
  architecture-diagrams.md (1112 LOC)
  brief-builder.md (301 LOC)
  coding-steering.md (40 LOC)
  cross-cutting-visual.md (14 LOC)
  current-state.md (71 LOC)
  deployment-diagrams.md (621 LOC)
  diagram-legibility.md (347 LOC)
  domain-wisdom.md (133 LOC)
  dream.md (76 LOC)
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
scripts/
  build-workflows.sh (117 LOC)
  cost-model.py (265 LOC)
  datum.py (44 LOC)
  extract_mermaid.py (351 LOC)
  hook-file-ownership.sh (64 LOC)
  lane-tools/
    README.md (64 LOC)
    corpus_sql.py (54 LOC)
    filter_gitnexus_output.py (67 LOC)
    find_callers.py (64 LOC)
    grep_search.py (65 LOC)
    list_dir.py (35 LOC)
    manifest.toml (117 LOC)
    multi_replace_file_content.py (92 LOC)
    read_file.py (36 LOC)
    read_file_range.py (50 LOC)
    read_todos.py (27 LOC)
    replace_file_content.py (73 LOC)
    run_command.py (78 LOC)
    write_to_file.py (55 LOC)
    write_todos.py (57 LOC)
  mermaid_to_image.py (353 LOC)
  preflight-tool-check.sh (35 LOC)
  render_skills_audit.py (125 LOC)
  resilient_diagram.py (682 LOC)
  test-count-gate (107 LOC)
  test-ts.sh (16 LOC)
  transcript_to_html.py (176 LOC)
  workflow-dashboard.py (716 LOC)
skills/
  datum-awake.js (525 LOC)
  datum-closeout.js (688 LOC)
  datum-go.js (1300 LOC)
  datum-plan.js (1224 LOC)
  datum-properties.js (824 LOC)
  datum-refine.js (973 LOC)
  datum-review.js (718 LOC)
  datum-tdd-act-docs.js (618 LOC)
  datum-tdd-act-lane.js (2592 LOC)
  datum-tdd-act-merge.js (495 LOC)
  datum-tdd-act-setup.js (422 LOC)
  datum-tdd-act-triage.js (438 LOC)
  datum-tdd-act.js (963 LOC)
  datum-tdd/
    SKILL.md (148 LOC)
  datum-validate.js (756 LOC)
  gitnexus-bug-hunt/
    SKILL.md (290 LOC)
    evals/
      evals.json (40 LOC)
  src/
    agent-types-wiring.test.ts (154 LOC)
    datum-awake.test.ts (55 LOC)
    datum-awake.ts (99 LOC)
    datum-closeout.test.ts (212 LOC)
    datum-closeout.ts (220 LOC)
    datum-go.test.ts (849 LOC)
    datum-go.ts (799 LOC)
    datum-plan.test.ts (604 LOC)
    datum-plan.ts (402 LOC)
    datum-properties.test.ts (236 LOC)
    datum-properties.ts (175 LOC)
    datum-refine.test.ts (253 LOC)
    datum-refine.ts (348 LOC)
    datum-review.test.ts (291 LOC)
    datum-review.ts (219 LOC)
    datum-tdd-act-docs.test.ts (81 LOC)
    datum-tdd-act-docs.ts (93 LOC)
    datum-tdd-act-lane.calls.test.ts (867 LOC)
    datum-tdd-act-lane.test.ts (983 LOC)
    datum-tdd-act-lane.ts (1740 LOC)
    datum-tdd-act-merge.test.ts (55 LOC)
    datum-tdd-act-merge.ts (122 LOC)
    datum-tdd-act-setup.ts (77 LOC)
    datum-tdd-act-triage.test.ts (121 LOC)
    datum-tdd-act-triage.ts (171 LOC)
    datum-tdd-act.test.ts (207 LOC)
    datum-tdd-act.ts (379 LOC)
    datum-validate.test.ts (239 LOC)
    datum-validate.ts (165 LOC)
    prompts-audit.test.ts (226 LOC)
    prompts-code-tells.test.ts (52 LOC)
    prompts-owned-tests.test.ts (41 LOC)
    prompts.test.ts (50 LOC)
    prompts/
      agent-preamble.md (29 LOC)
      awake-distill.md (41 LOC)
      awake-scan.md (63 LOC)
      closeout-synthesize.md (29 LOC)
      docs-check.md (14 LOC)
      docs-sync.md (17 LOC)
      green-retry.md (26 LOC)
      green.md (37 LOC)
      lane-state-read.md (23 LOC)
      lane-state-write.md (17 LOC)
      plan-approaches.md (32 LOC)
      plan-decompose.md (72 LOC)
      plan-deepen.md (33 LOC)
      plan-impact.md (33 LOC)
      plan-triage.md (22 LOC)
      properties-derive.md (38 LOC)
      red-retry.md (26 LOC)
      red.md (66 LOC)
      refactor-check.md (22 LOC)
      refactor.md (26 LOC)
      refine-classify.md (23 LOC)
      refine-questions.md (41 LOC)
      refine-scan.md (46 LOC)
      refine-spec.md (35 LOC)
      refine-triage.md (32 LOC)
      reflect.md (26 LOC)
      review-correctness-spec-verify.md (84 LOC)
      review-domain.md (42 LOC)
      skeptic-base.md (22 LOC)
      skeptic-contract.md (6 LOC)
      skeptic-edge.md (5 LOC)
      skeptic-error.md (5 LOC)
      validate-check.md (26 LOC)
    shared/
      agent-types-ordering.test.ts (121 LOC)
      agent-types.test.ts (150 LOC)
      agent-types.ts (120 LOC)
      agents.test.ts (404 LOC)
      agents.ts (240 LOC)
      base64.test.ts (70 LOC)
      base64.ts (58 LOC)
      batch.test.ts (417 LOC)
      batch.ts (275 LOC)
      boot.test.ts (253 LOC)
      boot.ts (205 LOC)
      commit-steps.test.ts (262 LOC)
      commit-steps.ts (170 LOC)
      config-steps.test.ts (103 LOC)
      config-steps.ts (50 LOC)
      context-relay.test.ts (556 LOC)
      context-relay.ts (413 LOC)
      gate.test.ts (61 LOC)
      gate.ts (57 LOC)
      lane-steps.test.ts (1697 LOC)
      lane-steps.ts (1112 LOC)
      main-sync-steps.test.ts (244 LOC)
      main-sync-steps.ts (117 LOC)
      models.test.ts (75 LOC)
      models.ts (93 LOC)
      pipeline-state.test.ts (109 LOC)
      pipeline-state.ts (118 LOC)
      plan-steps.test.ts (141 LOC)
      plan-steps.ts (81 LOC)
      prompts.ts (149 LOC)
      questions-steps.test.ts (82 LOC)
      questions-steps.ts (73 LOC)
      review-keys.ts (22 LOC)
      routing-steps.test.ts (81 LOC)
      routing-steps.ts (40 LOC)
      sandbox.d.ts (29 LOC)
      schemas.ts (136 LOC)
      sha1.test.ts (75 LOC)
      sha1.ts (92 LOC)
      tracker.test.ts (110 LOC)
      tracker.ts (131 LOC)
      triage-classify.test.ts (340 LOC)
      triage-classify.ts (324 LOC)
      types.ts (362 LOC)
      utf8.test.ts (123 LOC)
      utf8.ts (89 LOC)
      utils.test.ts (1341 LOC)
      utils.ts (1157 LOC)
      validate-steps.test.ts (40 LOC)
      validate-steps.ts (31 LOC)
      verdicts.property.test.ts (187 LOC)
      write-steps.test.ts (99 LOC)
      write-steps.ts (95 LOC)
  tsconfig.json (15 LOC)
specs/
  stable-epic-identity.md (45 LOC)
templates/
  000-madr-template.md (30 LOC)
  AGENTS.md (4 LOC)
  AGENTS_LOCAL_LLM.md (58 LOC)
  CURRENT_STATE.md (22 LOC)
  PRACTICE_LEDGER.md (3 LOC)
  PROPERTIES.md (91 LOC)
  QUESTIONS.md (35 LOC)
  ROADMAP.md (19 LOC)
  SPEC.md (82 LOC)
  TASKS.md (54 LOC)
  TICKET.md (35 LOC)
  TOOL_REDIRECT.md (3 LOC)
  WALKTHROUGH.md (21 LOC)
  api-design-template.md (556 LOC)
  architecture-design-template.md (411 LOC)
  database-design-template.md (610 LOC)
  environment.yaml (30 LOC)
  feature-design-template.md (574 LOC)
  quality.yaml (61 LOC)
  system-design-template.md (735 LOC)
test_local_planning.py (29 LOC)
tests/
  Unit/
    src/
      MyViewTests.swift (19 LOC)
  conftest.py (128 LOC)
  fixtures/
    corpus/
      lane-plan.json (11 LOC)
      state.json (15 LOC)
      tdd-failure.json (7 LOC)
      transcripts/
        20260101T000000Z-act_red.jsonl (3 LOC)
    lane_spec_hash_vectors.json (82 LOC)
  test_agent_definitions.py (150 LOC)
  test_agent_loop.py (3691 LOC)
  test_agent_types_drift.py (98 LOC)
  test_agents_materialize.py (549 LOC)
  test_artifact_score.py (364 LOC)
  test_budget.py (185 LOC)
  test_caliper_blast_radius.py (271 LOC)
  test_classify.py (186 LOC)
  test_classify_cli.py (73 LOC)
  test_cli_flag_contract.py (132 LOC)
  test_cli_init.py (431 LOC)
  test_cli_json_output.py (102 LOC)
  test_closeout_cli.py (78 LOC)
  test_closeout_cmd.py (184 LOC)
  test_closeout_collate.py (257 LOC)
  test_closeout_collectors.py (1159 LOC)
  test_closeout_followups.py (130 LOC)
  test_closeout_scripts.py (1112 LOC)
  test_code_tells.py (166 LOC)
  test_command_guard.py (144 LOC)
  test_config_fingerprint.py (183 LOC)
  test_context_skeleton.py (353 LOC)
  test_contract_preflight.py (247 LOC)
  test_contract_preflight_cli.py (25 LOC)
  test_contracts.py (61 LOC)
  test_contracts_validate_value.py (358 LOC)
  test_corpus_sql.py (654 LOC)
  test_datum_hardening.py (275 LOC)
  test_detect_characterization.py (702 LOC)
  test_diagnose_failure.py (96 LOC)
  test_epic26_config_overlay.py (274 LOC)
  test_epic26_contract_template.py (403 LOC)
  test_epic26_e2e_template.py (154 LOC)
  test_epic26_fixture.py (191 LOC)
  test_epic26_m1_driver.py (153 LOC)
  test_epic26_materialize.py (569 LOC)
  test_epic26_write_tool_scripts.py (700 LOC)
  test_failure_layer.py (261 LOC)
  test_file_followups.py (128 LOC)
  test_floor_cli.py (36 LOC)
  test_gate_banned_terms.py (65 LOC)
  test_gate_enhancements.py (360 LOC)
  test_gate_fixes.py (26 LOC)
  test_gate_open_questions.py (85 LOC)
  test_gate_plan.py (367 LOC)
  test_gate_plan_integration_lanes.py (571 LOC)
  test_gate_plan_transitive_deps.py (106 LOC)
  test_gate_plan_zero_lanes.py (23 LOC)
  test_gate_prior_art_tasks_path.py (83 LOC)
  test_gate_properties.py (100 LOC)
  test_gate_properties_integration.py (391 LOC)
  test_gate_resolve_artifact.py (295 LOC)
  test_gate_review.py (526 LOC)
  test_gate_validate.py (64 LOC)
  test_gc.py (467 LOC)
  test_github_issues.py (154 LOC)
  test_gitignore_check.py (121 LOC)
  test_integration_invariants_frontier.py (216 LOC)
  test_integration_invariants_parse.py (139 LOC)
  test_landscape.py (235 LOC)
  test_lane_cleanup.py (93 LOC)
  test_lane_hash.py (55 LOC)
  test_lane_plan_conflicts.py (251 LOC)
  test_lane_plan_digest.py (156 LOC)
  test_lane_plan_digest_expect_tests_pass.py (90 LOC)
  test_lane_plan_from_epic_cli.py (114 LOC)
  test_lane_plan_generated_files.py (91 LOC)
  test_lane_plan_integration_lanes.py (272 LOC)
  test_lane_plan_kind.py (47 LOC)
  test_lane_plan_schema_int_ids.py (130 LOC)
  test_lane_plan_spm_test_command.py (125 LOC)
  test_lane_plan_test_command.py (171 LOC)
  test_lane_run_command.py (131 LOC)
  test_lane_spec_export.py (264 LOC)
  test_lane_spec_export_integration.py (152 LOC)
  test_lane_spec_export_integration_fields.py (41 LOC)
  test_lane_state_cli.py (649 LOC)
  test_lane_state_markers.py (719 LOC)
  test_lane_tools_grep.py (76 LOC)
  test_local_llm_config_dup.py (124 LOC)
  test_local_llm_hardening.py (1263 LOC)
  test_local_llm_mlx_compat.py (29 LOC)
  test_make_function_name.py (42 LOC)
  test_memory_embeddings.py (245 LOC)
  test_memory_extract.py (72 LOC)
  test_memory_ingest.py (287 LOC)
  test_memory_ledger_chunker.py (354 LOC)
  test_memory_rag_engine.py (395 LOC)
  test_memory_reindex_cli.py (94 LOC)
  test_memory_retrieve.py (581 LOC)
  test_memory_vector_store.py (314 LOC)
  test_model_tiers.py (127 LOC)
  test_mypy_precheck.py (21 LOC)
  test_no_syspath_pollution.py (83 LOC)
  test_no_syspath_pollution_bootstrap.py (98 LOC)
  test_omlx_backend.py (227 LOC)
  test_permissions_snippet.py (42 LOC)
  test_pipeline_state.py (498 LOC)
  test_pr_comment_monitor.py (38 LOC)
  test_prompt_sanitizer.py (301 LOC)
  test_python_core_review.py (112 LOC)
  test_render.py (96 LOC)
  test_retrospect.py (744 LOC)
  test_ruff_precheck.py (21 LOC)
  test_schemas_truncate.py (173 LOC)
  test_skeleton_append.py (85 LOC)
  test_skeleton_creator.py (773 LOC)
  test_skeleton_integration_lane.py (284 LOC)
  test_skeleton_naming.py (46 LOC)
  test_skeleton_test_convention.py (64 LOC)
  test_skill_bundles_have_consumers.py (47 LOC)
  test_skills_materialize.py (244 LOC)
  test_slug.py (64 LOC)
  test_soft_constraint_repair.py (283 LOC)
  test_state_db.py (216 LOC)
  test_structural_fingerprint.py (89 LOC)
  test_task_slug.py (120 LOC)
  test_tdd_args.py (27 LOC)
  test_tdd_args_cli.py (150 LOC)
  test_tdd_cli_commands.py (71 LOC)
  test_tdd_driver.py (170 LOC)
  test_ticket_from_issue_cli.py (114 LOC)
  test_todo_tools.py (289 LOC)
  test_todos.py (80 LOC)
  test_tool_risk.py (170 LOC)
  test_triage_schema.py (25 LOC)
  test_units.py (283 LOC)
  test_walkthrough.py (147 LOC)
  test_wave_builder.py (508 LOC)
  test_workflow_dashboard.py (331 LOC)
  test_worktree_manager.py (1471 LOC)
  test_worktrees_list_cli.py (79 LOC)
  test_write_tools.py (714 LOC)
  ts/
    utils.test.mjs (59 LOC)
tic-tac-toe-css/
  index.html (94 LOC)
  style.css (392 LOC)
uv.lock (1504 LOC)
vitest.config.ts (10 LOC)
```

### LOC by Directory

| Directory | LOC |
|-----------|-----|
| (root) | 4935 |
| .caliper | 42970 |
| .claude | 532 |
| .claude/skills | 532 |
| .claude/skills/gitnexus | 532 |
| .claude/skills/gitnexus/gitnexus-cli | 83 |
| .claude/skills/gitnexus/gitnexus-debugging | 89 |
| .claude/skills/gitnexus/gitnexus-exploring | 78 |
| .claude/skills/gitnexus/gitnexus-guide | 64 |
| .claude/skills/gitnexus/gitnexus-impact-analysis | 97 |
| .claude/skills/gitnexus/gitnexus-refactoring | 121 |
| .entire | 16 |
| .opencode | 560 |
| .opencode/plugins | 548 |
| .serena | 162 |
| agents | 351 |
| assets | 1185 |
| assets/fixtures | 188 |
| assets/fixtures/contracts | 188 |
| assets/hooks | 703 |
| assets/schemas | 69 |
| datum | 32855 |
| datum-tui | 7204 |
| datum-tui/reference-openrouter | 6738 |
| datum-tui/reference-openrouter/references | 2108 |
| datum-tui/reference-openrouter/sample | 3785 |
| datum-tui/reference-openrouter/sample/screenshots | 1444 |
| datum-tui/reference-openrouter/sample/src | 1428 |
| datum-tui/reference-openrouter/sample/src/tools | 289 |
| datum/assets | 117 |
| datum/assets/schemas | 69 |
| datum/bootstrap | 579 |
| datum/closeout | 1383 |
| datum/memory | 3783 |
| datum/models | 1198 |
| datum/shared | 786 |
| datum/shared/logging | 516 |
| datum/steering | 984 |
| datum/test_ratchet | 101 |
| diagrams | 972 |
| docs | 23457 |
| docs/adr | 30 |
| docs/archive | 444 |
| docs/diagrams | 2579 |
| docs/epics | 15839 |
| docs/epics/claude | 35 |
| docs/epics/claude/agentic-lang-pipeline-8dqtgr | 35 |
| docs/epics/datum | 15602 |
| docs/epics/datum/bug-squash-167 | 1057 |
| docs/epics/datum/bug-squash-167-act | 745 |
| docs/epics/datum/bug-squash-281 | 950 |
| docs/epics/datum/bug-squash-281/skeletons | 448 |
| docs/epics/datum/bug-squash-g567 | 297 |
| docs/epics/datum/bug-squash-round-2 | 1637 |
| docs/epics/datum/bug-squash-round-2/skeletons | 602 |
| docs/epics/datum/consumer-first-build-order | 1224 |
| docs/epics/datum/consumer-first-build-order/skeletons | 350 |
| docs/epics/datum/epic-1 | 885 |
| docs/epics/datum/epic-10 | 25 |
| docs/epics/datum/epic-11 | 25 |
| docs/epics/datum/epic-12 | 23 |
| docs/epics/datum/epic-13 | 24 |
| docs/epics/datum/epic-14 | 25 |
| docs/epics/datum/epic-15 | 24 |
| docs/epics/datum/epic-16 | 24 |
| docs/epics/datum/epic-17 | 38 |
| docs/epics/datum/epic-19 | 329 |
| docs/epics/datum/epic-2 | 138 |
| docs/epics/datum/epic-20 | 280 |
| docs/epics/datum/epic-21 | 103 |
| docs/epics/datum/epic-22 | 117 |
| docs/epics/datum/epic-24 | 17 |
| docs/epics/datum/epic-25 | 35 |
| docs/epics/datum/epic-26 | 2325 |
| docs/epics/datum/epic-26/bootstrap | 1481 |
| docs/epics/datum/epic-26/bootstrap/templates | 1288 |
| docs/epics/datum/epic-26/bootstrap/templates/fixture | 42 |
| docs/epics/datum/epic-7 | 131 |
| docs/epics/datum/epic-8 | 24 |
| docs/epics/datum/epic-9 | 25 |
| docs/epics/datum/fail-fast-validation | 803 |
| docs/epics/datum/gh-issues-as-source-of-truth | 954 |
| docs/epics/datum/hermetic-test-git-fixtures | 174 |
| docs/epics/datum/integration-lanes | 1943 |
| docs/epics/datum/integration-lanes-2 | 1116 |
| docs/epics/datum/integration-lanes-2/skeletons | 389 |
| docs/epics/datum/integration-lanes/skeletons | 929 |
| docs/epics/datum/state-single-source-of-truth | 85 |
| docs/epics/main | 119 |
| docs/practice | 3 |
| docs/research | 2831 |
| evals | 150 |
| observability | 241 |
| observability/alerts | 64 |
| observability/dashboards | 81 |
| observability/metrics | 96 |
| policies | 1484 |
| policies/semgrep | 1484 |
| references | 11139 |
| scripts | 3985 |
| scripts/lane-tools | 934 |
| skills | 37653 |
| skills/datum-tdd | 148 |
| skills/gitnexus-bug-hunt | 330 |
| skills/gitnexus-bug-hunt/evals | 40 |
| skills/src | 24624 |
| skills/src/prompts | 1059 |
| skills/src/shared | 12980 |
| specs | 45 |
| templates | 3434 |
| tests | 36955 |
| tests/Unit | 19 |
| tests/Unit/src | 19 |
| tests/fixtures | 118 |
| tests/fixtures/corpus | 36 |
| tests/fixtures/corpus/transcripts | 3 |
| tests/ts | 59 |
| tic-tac-toe-css | 486 |

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
