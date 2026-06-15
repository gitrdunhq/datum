// @generated — DO NOT EDIT. Source: skills/src/datum-go.ts
export const meta = {
  name: "datum-go",
  description: "Full pipeline: TICKET \u2192 SPEC \u2192 Plan \u2192 Properties \u2192 Act \u2192 Validate \u2192 Review \u2192 Closeout",
  phases: []
};

// skills/src/shared/utils.ts
function buildWaves(lanePlan) {
  const lanes = lanePlan.lanes;
  const ids = Object.keys(lanes);
  const inDeg = {};
  const adj = {};
  for (const id of ids) {
    const deps = lanes[id].depends_on || [];
    for (const dep of deps) {
      if (!lanes[dep]) {
        throw new Error(
          `Task '${id}' depends on '${dep}', which does not exist in the lane plan`
        );
      }
    }
    inDeg[id] = deps.length;
    for (const dep of deps) {
      ;
      (adj[dep] = adj[dep] || []).push(id);
    }
  }
  const waves = [];
  let queue = ids.filter((id) => inDeg[id] === 0).sort();
  while (queue.length > 0) {
    waves.push([...queue]);
    const next = [];
    for (const id of queue) {
      for (const child of adj[id] || []) {
        inDeg[child]--;
        if (inDeg[child] === 0) next.push(child);
      }
    }
    queue = next.sort();
  }
  const placed = new Set(waves.flat());
  const cyclic = ids.filter((id) => !placed.has(id));
  if (cyclic.length > 0) {
    throw new Error(
      `Cyclic dependency detected among tasks: ${cyclic.sort().join(", ")}`
    );
  }
  return waves;
}
function parseAgentJson(text, fallback) {
  if (!text || typeof text !== "string") return fallback;
  const cleaned = text.replace(/```[a-z]*\n?/g, "").trim();
  const start = cleaned.search(/[{[]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (start === -1 || end === -1) return fallback;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return fallback;
  }
}

// skills/src/shared/models.ts
var DEFAULT_TIERS = {
  fast: "haiku",
  balanced: "sonnet",
  deep: "opus"
};
var activeTiers = { ...DEFAULT_TIERS };
function setModelTiers(tiers) {
  activeTiers = { ...DEFAULT_TIERS, ...tiers };
}
function model(tier) {
  return activeTiers[tier];
}
var PHASES = ["refine", "plan", "properties", "act", "validate", "review", "closeout"];
var DEFAULT_CONFIG = {
  language: "",
  test_framework: "",
  test_command: "",
  skills_dir: ""
};
function skillPath(skillsDir, name) {
  if (skillsDir) return `${skillsDir}/${name}.js`;
  return `skills/${name}.js`;
}

// skills/src/shared/pipeline-state.ts
function parseState(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw.replace(/```[a-z]*\n?/g, "").trim());
  } catch {
    return null;
  }
}
function serializeState(state) {
  return JSON.stringify(state, null, 2);
}
function detectStartFrom(state) {
  if (!state || !state.completedPhases?.length) return null;
  const ORDER = ["refine", "plan", "properties", "act", "validate", "review", "closeout"];
  const lastCompleted = state.completedPhases[state.completedPhases.length - 1];
  const idx = ORDER.indexOf(lastCompleted);
  if (idx >= 0 && idx < ORDER.length - 1) return ORDER[idx + 1];
  return null;
}

// skills/src/prompts/util-detect-branch.md
var util_detect_branch_default = 'Run these two commands and return ONLY a JSON object with two fields:\n1. "branch": output of `git rev-parse --abbrev-ref HEAD`\n2. "timestamp": output of `date +%Y%m%d-%H%M%S`\nOutput raw JSON only. No markdown fences, no explanation.';

// skills/src/datum-go.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
function parseArgs(raw) {
  if (!raw || raw.toLowerCase() === "yolo") return { yolo: true };
  if (/^#?\d+$/.test(raw)) return { yolo: true, issueNumber: parseInt(raw.replace("#", ""), 10) };
  try {
    return JSON.parse(raw);
  } catch {
    return { yolo: true, freeText: raw };
  }
}
var a = typeof args === "string" ? parseArgs(rawArgs) : args || {};
var yolo = !!a.yolo;
var startFrom = (a.startFrom || "refine").toLowerCase();
var explicitStart = !!a.startFrom;
var route = (a.route || "feature").toLowerCase();
var activePhases = a.phases && a.phases.length > 0 ? a.phases : [...PHASES];
var startIdx = PHASES.indexOf(startFrom);
if (startIdx === -1) {
  throw new Error(`Unknown phase: ${startFrom}. Valid: ${PHASES.join(", ")}`);
}
var bootText = await agent(
  `Return a JSON object with two fields:
1. "config": contents of .datum/config.json (or {} if missing)
2. "state": contents of .datum/pipeline-state.json (or null if missing)
Output raw JSON only.`,
  { label: "read-config+state", model: model("fast") }
);
var boot = parseAgentJson(bootText, { config: {}, state: null });
var globalCfg = { ...DEFAULT_CONFIG, ...boot.config || {} };
var sk = (name) => skillPath(globalCfg.skills_dir || "", name);
if (globalCfg.models && typeof globalCfg.models === "object") {
  setModelTiers(globalCfg.models);
  log(`Model tiers: fast=${model("fast")}, balanced=${model("balanced")}, deep=${model("deep")}`);
}
var priorState = parseState(boot.state ? JSON.stringify(boot.state) : null);
var lastResult = {};
var haltedAt = "";
var completedPhases = priorState?.completedPhases ? [...priorState.completedPhases] : [];
function shouldRun(p, idx) {
  return !haltedAt && startIdx <= idx && activePhases.includes(p);
}
async function markPhaseComplete(p) {
  if (!completedPhases.includes(p)) completedPhases.push(p);
  const state = {
    branch: globalCfg.branch || "",
    runId: "",
    route,
    completedPhases,
    currentPhase: null,
    lastUpdated: ""
  };
  await agent(
    `Write this exact content to .datum/pipeline-state.json:
${serializeState(state)}
Overwrite if exists. No other output.`,
    { label: `save-state:${p}`, model: model("fast") }
  );
}
if (priorState && !explicitStart) {
  const resumeAt = detectStartFrom(priorState);
  if (resumeAt) {
    const resumeIdx = PHASES.indexOf(resumeAt);
    if (resumeIdx > startIdx) {
      log(`Resuming from ${resumeAt} (prior run completed: [${priorState.completedPhases.join(", ")}])`);
      startFrom = resumeAt;
      startIdx = resumeIdx;
    }
  }
}
log(`datum go \u2014 route: ${route}, start: ${startFrom}${yolo ? " (yolo)" : ""}`);
if (shouldRun("refine", 0)) {
  log("\u2500\u2500 Refine \u2500\u2500");
  lastResult = await workflow({ scriptPath: sk("datum-refine") }, yolo ? "yolo" : {});
  if (!yolo && !lastResult.gatePassed) {
    haltedAt = "refine";
    log(`Refine gate held: ${lastResult.gateMessage || "needs review"}. Address QUESTIONS.md, then: datum go --start-from plan`);
  } else {
    log("Refine complete");
    await markPhaseComplete("refine");
  }
}
if (shouldRun("plan", 1)) {
  log("\u2500\u2500 Plan \u2500\u2500");
  lastResult = await workflow({ scriptPath: sk("datum-plan") }, yolo ? "yolo" : {});
  if (!yolo && !lastResult.gatePassed) {
    haltedAt = "plan";
    log(`Plan gate held: ${lastResult.gateMessage || "needs approval"}. Review TASKS.md, then: datum go --start-from properties`);
  } else {
    log(`Plan complete \u2014 ${lastResult.taskCount || "?"} tasks`);
    await markPhaseComplete("plan");
  }
}
if (shouldRun("properties", 2)) {
  log("\u2500\u2500 Properties \u2500\u2500");
  lastResult = await workflow({ scriptPath: sk("datum-properties") }, yolo ? "yolo" : {});
  log("Properties complete");
  await markPhaseComplete("properties");
}
log(`[debug] shouldRun act=${shouldRun("act", 3)} startIdx=${startIdx} haltedAt=${haltedAt} activePhases=${JSON.stringify(activePhases)}`);
if (shouldRun("act", 3)) {
  log("\u2500\u2500 Act \u2500\u2500");
  const testCommand = globalCfg.test_command || DEFAULT_CONFIG.test_command;
  const language = globalCfg.language || DEFAULT_CONFIG.language;
  const branchInfo = await agent(util_detect_branch_default, { label: "act-detect", model: model("fast") });
  const info = parseAgentJson(branchInfo, { branch: "", timestamp: "" });
  const epicBranch = info.branch;
  const runId = info.timestamp;
  if (!epicBranch || !runId) throw new Error(`Failed to detect branch/timestamp: ${JSON.stringify(info)}`);
  const lanePlanPath = `docs/epics/${epicBranch}/lane-plan.json`;
  const planText = await agent(
    `Read ${lanePlanPath} and return its contents as raw JSON text. If not found, try .datum/lane-plan.json as fallback. Output ONLY the JSON, no markdown fences, no explanation.`,
    { label: "read-plan", model: model("fast") }
  );
  const lanePlan = typeof planText === "string" ? parseAgentJson(planText, null) : planText;
  if (!lanePlan || !lanePlan.lanes) throw new Error("Failed to parse lane-plan.json \u2014 agent returned unparseable output");
  const waves = buildWaves(lanePlan);
  if (waves.length === 0 || Object.keys(lanePlan.lanes || {}).length === 0) {
    throw new Error("Lane plan has 0 tasks \u2014 nothing to execute");
  }
  log(`Topology: ${lanePlan.total_lanes} lanes in ${waves.length} waves`);
  const MAX_BATCH = 5;
  const allLaneIds = lanePlan.topological_order;
  const batches = [];
  for (let i = 0; i < allLaneIds.length; i += MAX_BATCH) {
    batches.push(allLaneIds.slice(i, i + MAX_BATCH));
  }
  if (batches.length > 1) {
    log(`Auto-partitioned ${lanePlan.total_lanes} tasks into ${batches.length} batches`);
  }
  const actResults = {};
  const actFailures = [];
  const actCompleted = [];
  for (let bi = 0; bi < batches.length; bi++) {
    const batchLaneIds = batches[bi];
    const batchTag = batches.length > 1 ? ` [batch ${bi + 1}/${batches.length}]` : "";
    const batchRunId = batches.length > 1 ? `${runId}-b${bi}` : runId;
    if (batches.length > 1) log(`
=== Batch ${bi + 1}/${batches.length}: [${batchLaneIds.join(", ")}] ===`);
    for (const lid of batchLaneIds) {
      const deps = lanePlan.lanes[lid]?.depends_on || [];
      const missing = deps.filter((d) => !batchLaneIds.includes(d) && !actCompleted.includes(d) && !actFailures.includes(d));
      if (missing.length > 0) {
        actResults[lid] = { task_id: lid, status: "skipped", stage: "SKIPPED", error: `unmet cross-batch deps: [${missing.join(", ")}]` };
        log(`  SKIPPED ${lid}: deps [${missing.join(", ")}] never ran`);
      }
    }
    const runnableBatchIds = batchLaneIds.filter((id) => !actResults[id]);
    if (runnableBatchIds.length === 0) {
      log(`Batch ${bi} fully skipped \u2014 all lanes have unmet deps`);
      continue;
    }
    const setup = await workflow(
      { scriptPath: sk("datum-tdd-act-setup") },
      { batchRunId, epicBranch, batchLaneIds: runnableBatchIds, lanePlan, batchTag }
    );
    const act = await workflow(
      { scriptPath: sk("datum-tdd-act-lane") },
      {
        batchLaneIds: runnableBatchIds,
        lanePlan,
        worktreePaths: setup.worktreePaths,
        batchTag,
        cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language },
        priorFailures: actFailures,
        priorCompleted: actCompleted
      }
    );
    for (const [id, r] of Object.entries(act.results || {})) {
      actResults[id] = r;
      if (!r || r.status === "failed") {
        actFailures.push(id);
        log(`  FAILED ${id}: ${r ? `${r.stage} \u2014 ${r.error}` : "null result"}`);
      } else if (r.status === "skipped") {
        log(`  SKIPPED ${id}: ${r.error || "dependency failed"}`);
      } else {
        actCompleted.push(id);
      }
    }
    log(`Act${batchTag} done: ${batchLaneIds.filter((id) => actCompleted.includes(id)).length}/${batchLaneIds.length} succeeded`);
    await workflow(
      { scriptPath: sk("datum-tdd-act-merge") },
      {
        epicBranch,
        completedIds: batchLaneIds.filter((id) => actCompleted.includes(id)),
        batchRunId,
        topoOrder: lanePlan.topological_order,
        batchTag
      }
    );
  }
  await workflow(
    { scriptPath: sk("datum-tdd-act-docs") },
    { completedLanes: actCompleted, lanePlan, runId }
  );
  if (actFailures.length > 0) {
    await workflow(
      { scriptPath: sk("datum-tdd-act-triage") },
      { failures: actFailures, results: actResults, lanePlan, runId, epicBranch }
    );
  }
  const actSkipped = Object.keys(actResults).filter((id) => actResults[id]?.status === "skipped");
  await markPhaseComplete("act");
  log(`Act complete \u2014 ${actCompleted.length}/${lanePlan.total_lanes} succeeded, ${actFailures.length} failed, ${actSkipped.length} skipped`);
  lastResult = { completed: actCompleted.length, failed: actFailures.length, skipped: actSkipped.length, failedLanes: actFailures, skippedLanes: actSkipped };
} else if (activePhases.includes("act")) {
  log(`[warn] Act phase was in activePhases but shouldRun returned false \u2014 startIdx=${startIdx} haltedAt=${haltedAt}`);
}
if (shouldRun("validate", 4)) {
  log("\u2500\u2500 Validate \u2500\u2500");
  lastResult = await workflow({ scriptPath: sk("datum-validate") }, yolo ? "yolo" : {});
  if (!yolo && !lastResult.testsPassed) {
    haltedAt = "validate";
    log("Validate FAILED \u2014 tests are red. Pipeline halted.");
  } else {
    log("Validate complete");
    await markPhaseComplete("validate");
  }
}
if (shouldRun("review", 5)) {
  log("\u2500\u2500 Review \u2500\u2500");
  lastResult = await workflow({ scriptPath: sk("datum-review") }, yolo ? "yolo" : {});
  if (!yolo && !lastResult.canMerge) {
    haltedAt = "review";
    log(`Review: ${lastResult.criticalFindings || "?"} critical issues. Fix, then: datum go --start-from validate`);
  } else {
    log("Review complete \u2014 clear to merge");
    await markPhaseComplete("review");
  }
}
if (shouldRun("closeout", 6)) {
  log("\u2500\u2500 Closeout \u2500\u2500");
  lastResult = await workflow({ scriptPath: sk("datum-closeout") }, yolo ? "yolo" : {});
  log("Closeout complete");
  await markPhaseComplete("closeout");
}
if (haltedAt) {
  log(`
Pipeline halted at ${haltedAt}. Resume with: datum go --start-from <next-phase>`);
} else {
  log("\n" + "=".repeat(60));
  log("DATUM GO COMPLETE");
  log("=".repeat(60));
}
return {
  phase: haltedAt || "complete",
  halted: !!haltedAt,
  ...lastResult
};
