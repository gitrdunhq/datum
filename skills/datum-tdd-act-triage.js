// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-triage.ts
export const meta = {
  name: "datum-tdd-act-triage",
  description: "Categorize TDD failures and auto-file GitHub issues",
  phases: [{ title: "Triage" }]
};

// skills/src/shared/models.ts
var DEFAULT_TIERS = {
  fast: "haiku",
  balanced: "sonnet",
  deep: "opus"
};
var activeTiers = { ...DEFAULT_TIERS };
function model(tier) {
  return activeTiers[tier];
}

// skills/src/shared/schemas.ts
var TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    issues: { type: "array", items: {
      type: "object",
      properties: {
        title: { type: "string" },
        category: { type: "string", enum: ["workflow-bug", "lane-plan", "agent-behavior", "infrastructure", "test-quality"] },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        body: { type: "string" },
        lane: { type: "string" },
        stage: { type: "string" }
      },
      required: ["title", "category", "body"]
    } }
  },
  required: ["issues"]
};

// skills/src/shared/utils.ts
function groupBlockedByRoot(lanePlan, failures, blockedIds) {
  const failedSet = new Set(failures);
  const groups = {};
  for (const f of failures) groups[f] = /* @__PURE__ */ new Set();
  for (const bid of blockedIds) {
    const seen = /* @__PURE__ */ new Set();
    const queue = [...lanePlan.lanes[bid]?.depends_on || []];
    const roots = /* @__PURE__ */ new Set();
    while (queue.length > 0) {
      const cur = queue.shift();
      if (seen.has(cur)) continue;
      seen.add(cur);
      if (failedSet.has(cur)) {
        roots.add(cur);
        continue;
      }
      queue.push(...lanePlan.lanes[cur]?.depends_on || []);
    }
    for (const r of roots) {
      if (!groups[r]) groups[r] = /* @__PURE__ */ new Set();
      groups[r].add(bid);
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(groups)) out[k] = [...v].sort();
  return out;
}

// skills/src/shared/agent-types.ts
var state = { agentTypes: true, hooksInstalled: false };
var configured = false;
function configureAgentTypes(opts) {
  if (typeof opts.agentTypes === "boolean") state.agentTypes = opts.agentTypes;
  if (typeof opts.hooksInstalled === "boolean") state.hooksInstalled = opts.hooksInstalled;
  configured = true;
}

// skills/src/shared/triage-classify.ts
var PREFIX_RULES = [
  // ── infrastructure: git/tooling/relay/gate plumbing the pipeline itself runs ──
  {
    test: /\bgreen_edited_tests\b/,
    category: "agent_behavior",
    reason: "green_edited_tests: the GREEN agent modified the lane's own test files (or rewrote the RED commit) \u2014 a stage discipline violation by the agent, retried once from the RED commit with the hint; the lane failed only if it did it again."
  },
  {
    test: /\brunner_permission_denied\b/,
    category: "infrastructure",
    reason: "runner_permission_denied: the host permission classifier refused the datum-cli runner's batch (typically git reset --hard / clean -fd inside datum's own scratch worktree) and it replied in prose. Fix is an allow-rule for those commands on the .datum/worktrees path, not a code or plan change."
  },
  {
    test: /\blane_intake_failed\b/,
    category: "infrastructure",
    reason: "lane_intake_failed: the intake batch step (git/tooling) did not return a result \u2014 not a code or plan defect."
  },
  {
    test: /\bcount_gate_no_output\b/,
    category: "infrastructure",
    reason: "count_gate_no_output: the test-count-gate tool produced no parseable JSON \u2014 a tooling failure, not evidence about the tests it was supposed to count."
  },
  {
    test: /\bcount_gate_failed\b/,
    category: "infrastructure",
    reason: "count_gate_failed: the test-count-gate tool itself failed to run/produce JSON \u2014 tooling, not lane content."
  },
  {
    test: /\bmerge_failed\b|\bdep_merge_failed\b/,
    category: "infrastructure",
    reason: "merge_failed (incl. dep_merge_failed): git merge/squash mechanics failed \u2014 infrastructure, not the lane's code."
  },
  {
    test: /\bownership_check_failed\b/,
    category: "infrastructure",
    reason: "ownership_check_failed: the ownership-diff step itself did not run or returned no result \u2014 distinct from an actual violation (file_ownership_violation), which is agent behavior."
  },
  {
    test: /\bvalidate_run_failed\b/,
    category: "infrastructure",
    reason: "validate_run_failed: the independent test-verify run at the Validate stage did not execute \u2014 a runner/tooling failure."
  },
  {
    test: /\blane_plan_relay_mismatch\b/,
    category: "infrastructure",
    reason: "lane_plan_relay_mismatch: the relayed lane plan shape differs from the file on disk \u2014 a pipeline plumbing bug, not a plan-quality problem."
  },
  {
    test: /\bcontext_relay_mismatch\b/,
    category: "infrastructure",
    reason: "context_relay_mismatch: a context file/byte-count relay between agents failed \u2014 pipeline plumbing."
  },
  {
    test: /no worktree path/,
    category: "infrastructure",
    reason: "no worktree path: setup never produced an isolated worktree for the lane \u2014 infrastructure, and specifically why lane files must never be looked for in the ROOT checkout (#387)."
  },
  {
    test: /\bgreen_no_result\b/,
    category: "infrastructure",
    reason: `green_no_result: the GREEN agent returned nothing at all (maxTurns cap in agents/datum-green.md, an API error, or a skip) \u2014 a capacity/infra failure like lane_intake_failed's "no result", not a claim about what the agent did with the code.`
  },
  {
    test: /\bred_no_result\b/,
    category: "infrastructure",
    reason: "red_no_result: the RED agent returned nothing at all (maxTurns cap in agents/datum-red.md, an API error, or a skip) \u2014 same capacity/infra bucket as green_no_result, not agent behavior about the tests."
  },
  {
    test: /\brefactor_no_result\b/,
    category: "infrastructure",
    reason: "refactor_no_result: the REFACTOR agent returned nothing at all (maxTurns cap in agents/datum-refactor.md, an API error, or a skip) \u2014 same capacity/infra bucket as green_no_result/red_no_result."
  },
  {
    test: /\bagent_types_unconfigured\b/,
    category: "infrastructure",
    reason: "agent_types_unconfigured: stageOpts() was called before configureAgentTypes() \u2014 a pipeline wiring/ordering bug, not anything the lane's agents did."
  },
  // ── lane_plan: the plan itself asked for something contradictory/impossible ──
  {
    test: /\bcontract_conflict\b/,
    category: "lane_plan",
    reason: "contract_conflict: preflight found the lane's acceptance criteria conflict with an existing contract \u2014 a plan defect."
  },
  {
    test: /\bscope_gap\b/,
    category: "lane_plan",
    reason: "scope_gap: the lane plan's declared files/scope do not cover what the acceptance criteria require \u2014 a plan defect."
  },
  {
    test: /\bno_test_files\b/,
    category: "lane_plan",
    reason: "no_test_files: classifyFiles found no test files for the lane at all \u2014 the lane plan did not assign any, not something the RED agent could have fixed."
  },
  // ── agent_behavior: the agent actively violated a hard rule ──
  {
    test: /\bplaceholder_assertions\b/,
    category: "agent_behavior",
    reason: "placeholder_assertions: the RED agent committed placeholder/pass-only assertions instead of real tests."
  },
  {
    test: /\bno_new_test_functions_committed\b/,
    category: "agent_behavior",
    reason: "no_new_test_functions_committed: the RED agent did not actually add the required new test functions."
  },
  {
    test: /\bno_new_tests_written\b/,
    category: "agent_behavior",
    reason: "no_new_tests_written: the lane runner's post-RED count from the epic merge-base (after a7abd94) found no new test functions \u2014 same agent-behavior signal as no_new_test_functions_committed, just measured from a different baseline."
  },
  {
    test: /\bcontext_read_unverified\b/,
    category: "agent_behavior",
    reason: "context_read_unverified: assertReadWitness found the agent did not evidence reading a deferred large file it was required to read before acting \u2014 the agent skipped a required step, not a pipeline bug."
  },
  {
    test: /\bagent_output_unparseable\b/,
    category: "agent_behavior",
    reason: "agent_output_unparseable: parseAgentJsonStrict found the agent returned no parseable JSON at all \u2014 an agent output-format failure, not tooling (contrast with count_gate_no_output, where the *tool* being called is what failed)."
  },
  {
    test: /\bgreen_blindness_violation\b/,
    category: "agent_behavior",
    reason: "green_blindness_violation: the GREEN agent read RED's test file contents when it should not have."
  },
  {
    test: /\bfile_ownership_violation\b/,
    category: "agent_behavior",
    reason: "file_ownership_violation: the agent wrote outside its allowed file set \u2014 a real, confirmed violation (vs. ownership_check_failed, which is the check tool itself failing)."
  },
  // ── test_quality vs agent_behavior for *_verify_failed / skeptic_broken:
  // both are plausible. Classified as agent_behavior here because in every
  // case the *implementing* agent (GREEN/REFACTOR) is the one whose claimed
  // result (tests_pass / "verified") disagrees with an independent re-run or
  // an adversarial read — i.e. the agent's own output is what's wrong, not a
  // pre-existing weak test the RED agent wrote (that case is covered
  // separately by placeholder_assertions / low reflect scores upstream).
  {
    test: /\bskeptic_broken\b/,
    category: "agent_behavior",
    reason: "skeptic_broken: adversarial read-only review found confirmed bugs in the GREEN implementation that survived a retry."
  },
  {
    test: /\bgreen_verify_failed\b/,
    category: "agent_behavior",
    reason: "green_verify_failed: independent test-verify disagreed with the GREEN agent's self-reported tests_pass."
  },
  {
    test: /\brefactor_verify_failed\b/,
    category: "agent_behavior",
    reason: "refactor_verify_failed: independent test-verify after REFACTOR disagreed with the agent's self-reported result."
  },
  {
    test: /\brefactor_failed\b/,
    category: "agent_behavior",
    reason: `refactor_failed: the REFACTOR agent itself reported a real failure_reason (not "nothing to change"). agent_behavior, not infrastructure: by the time REFACTOR is dispatched the runner has already independently verified the suite is green at the lane's HEAD (the intake-verify gate, #331) \u2014 a suite that was already red would have been caught upstream as green_stale/lane_intake_failed before REFACTOR ever ran, so a failure here is about what the REFACTOR agent did, not stale pipeline state.`
  }
];
function classifyLaneError(error, stage) {
  if (stage === "SKIPPED" || /^blocked[:\s]/.test(error || "")) {
    return {
      category: "dependency",
      confidence: "deterministic",
      reason: 'stage=SKIPPED or a "blocked: ..." error \u2014 this lane never ran; it is a consequence of an upstream root failure, not an independent bug.'
    };
  }
  const text = error || "";
  for (const rule of PREFIX_RULES) {
    if (rule.test.test(text)) {
      return { category: rule.category, confidence: "deterministic", reason: rule.reason };
    }
  }
  return {
    category: "unknown",
    confidence: "heuristic",
    reason: "No known machine-generated prefix matched \u2014 the LLM must actually reason about this failure from the raw error text."
  };
}
var DESTINATION_BY_CATEGORY = {
  // datum's own pipeline/tooling categories — the lane never got a fair run.
  infrastructure: "datum",
  workflow_bug: "datum",
  // The lane's work or the consumer repo's code is what's actually wrong —
  // never datum's tracker. Includes lane_plan (contract_conflict, scope_gap:
  // the plan asked for something the lane's own scope/contracts don't
  // support), agent_behavior (skeptic_broken, green_verify_failed,
  // placeholder_assertions, etc.: a real finding about the implementation or
  // tests the lane produced), and test_quality (weak/wrong assertions).
  lane_plan: "consumer",
  agent_behavior: "consumer",
  test_quality: "consumer",
  // No known pipeline prefix matched — never assume datum is at fault
  // without positive evidence; treat as a consumer-code finding to log, not
  // as a reason to file against datum.
  unknown: "consumer",
  // Already-skipped consequence of an upstream root failure — never filed
  // anywhere on its own.
  dependency: "none"
};
function triageDestination(classification, _error) {
  return DESTINATION_BY_CATEGORY[classification.category];
}

// skills/src/datum-tdd-act-triage.ts
var CATEGORY_LABEL = {
  infrastructure: "infrastructure",
  workflow_bug: "workflow-bug",
  lane_plan: "lane-plan",
  agent_behavior: "agent-behavior",
  test_quality: "test-quality"
};
var LABEL_TO_CATEGORY = {
  infrastructure: "infrastructure",
  "workflow-bug": "workflow_bug",
  "lane-plan": "lane_plan",
  "agent-behavior": "agent_behavior",
  "test-quality": "test_quality"
};
var a = args;
configureAgentTypes(a.agentTypes || {});
phase("Triage");
var filed = 0;
var consumer_findings = 0;
var skipped = 0;
if (a.failures.length === 0) {
  log("[triage] All lanes succeeded \u2014 no issues to file");
} else {
  const blockedIds = (a.blocked || []).map((r) => r.task_id);
  const groups = groupBlockedByRoot(a.lanePlan, a.failures, blockedIds);
  const classifications = {};
  for (const fid of a.failures) {
    const r = a.results[fid];
    classifications[fid] = classifyLaneError(r?.error, r?.stage);
  }
  const dependencyFailures = a.failures.filter((fid) => classifications[fid].category === "dependency");
  const triageableFailures = a.failures.filter((fid) => classifications[fid].category !== "dependency");
  if (dependencyFailures.length > 0) {
    log(`[triage] Skipping ${dependencyFailures.length} dependency failure(s) (consequences of an upstream root, already grouped): [${dependencyFailures.join(", ")}]`);
  }
  if (triageableFailures.length === 0) {
    log("[triage] All failures were dependency consequences \u2014 no root causes to file");
  } else {
    const failureDetails = triageableFailures.map((fid) => {
      const r = a.results[fid];
      const lane = a.lanePlan.lanes[fid];
      const descendants = groups[fid] || [];
      const chainNote = descendants.length > 0 ? ` \u2014 blocks ${descendants.length} dependent lane(s): [${descendants.join(", ")}] (do not diagnose these separately; they are consequences of this root failure)` : "";
      const cls = classifications[fid];
      const worktreePath = r?.worktree_path;
      const evidence = `[evidence: stage=${r?.stage || "UNKNOWN"}${worktreePath ? `, worktree=${worktreePath}` : ""}]`;
      const categoryNote = cls.confidence === "deterministic" ? ` CATEGORY ALREADY DETERMINED: ${cls.category} (${cls.reason}) \u2014 do not reclassify this lane; explain the failure and propose a fix within that category.` : "";
      return `Lane ${fid} ("${lane?.title || "unknown"}"): failed at ${r?.stage || "UNKNOWN"} \u2014 ${r?.error || "null result"}${chainNote} ${evidence}${categoryNote}`;
    }).join("\n");
    const triage = await agent(
      `Analyze these TDD workflow failures and categorize each one.

Run ID: ${a.runId}
Epic branch: ${a.epicBranch}
IMPORTANT \u2014 each lane's work lives on its own branch (\`${a.epicBranch}--<task_id>\`) inside its own isolated git worktree, NEVER in the ROOT checkout. Never inspect the ROOT checkout to diagnose a lane's files or claim a lane's changes are missing/wrong \u2014 a prior issue (#387) confidently blamed the RED agent for skeleton stubs that were actually left in the ROOT checkout, not the lane's own worktree/branch.

Failed lanes (each root failure lists the dependent lanes it transitively blocked \u2014 treat each root + its blocked descendants as ONE group, not N independent failures). Some lanes already have a category the pipeline itself determined from a machine-readable error prefix it produced \u2014 for those, use exactly that category; your job is only to explain the failure and propose a fix within it, not to re-derive or second-guess the category:
${failureDetails}

For any lane WITHOUT a predetermined category, determine:
- Is this a WORKFLOW BUG (datum-tdd-act.js logic error)?
- Is this a LANE PLAN issue (bad ACs, wrong files, missing deps)?
- Is this an AGENT BEHAVIOR issue (agent didn't follow instructions)?
- Is this INFRASTRUCTURE (git, build tools, test runner, CWD issues)?
- Is this TEST QUALITY (tests too weak, wrong assertions)?

For each issue, write a GitHub issue title starting with [datum-bug] and a body with:
- What happened (the error)
- Why it happened (root cause analysis)
- Suggested fix
- The lane, stage, and run ID for traceability`,
      { label: "triage", phase: "Triage", model: model("balanced"), schema: TRIAGE_SCHEMA }
    );
    if (triage?.issues?.length) {
      for (const issue of triage.issues) {
        if (issue.severity === "low") {
          log(`[triage] Skipping low-severity: ${issue.title}`);
          skipped++;
          continue;
        }
        let cls = null;
        if (issue.lane) cls = classifications[issue.lane];
        const category = cls && cls.confidence === "deterministic" ? CATEGORY_LABEL[cls.category] : issue.category;
        const effectiveClassification = cls && cls.confidence === "deterministic" ? cls : { category: LABEL_TO_CATEGORY[issue.category] || "unknown", confidence: "heuristic", reason: "derived from the LLM-assigned category label; no deterministic pipeline prefix matched this lane" };
        const destination = triageDestination(effectiveClassification, issue.body);
        if (destination === "consumer") {
          log(`[triage] consumer-code finding for ${issue.lane || "unknown"} (${category}): not filed to datum's tracker \u2014 ${issue.body.slice(0, 160)}`);
          consumer_findings++;
          continue;
        }
        if (destination === "none") {
          log(`[triage] Skipping (dependency): ${issue.title}`);
          skipped++;
          continue;
        }
        const labels = `datum-bug,${category}`;
        const safeTitle = issue.title.slice(0, 80).replace(/'/g, "'\\''");
        const safeSearch = issue.title.slice(0, 50).replace(/'/g, "'\\''");
        const safeBody = issue.body.replace(/'/g, "'\\''");
        const fileResult = await agent(
          `unset GITHUB_TOKEN && gh issue list --repo gitrdunhq/datum --state open --search '${safeSearch}' --json number,title --limit 3 | head -5
If no duplicate exists, create the issue:
unset GITHUB_TOKEN && gh issue create --repo gitrdunhq/datum --title '${safeTitle}' --label '${labels}' --body '${safeBody}'
If a duplicate exists, skip and say "duplicate found".`,
          { label: `file-issue:${issue.lane || "global"}`, phase: "Triage", model: model("fast") }
        );
        if (!(fileResult || "").toLowerCase().includes("duplicate")) {
          log(`[triage] Filed: ${issue.title} [${category}/${issue.severity}]`);
          filed++;
        } else {
          log(`[triage] Duplicate found, skipped: ${issue.title}`);
          skipped++;
        }
      }
    } else {
      log("[triage] No actionable issues identified");
    }
  }
}
return { filed, consumer_findings, skipped };
