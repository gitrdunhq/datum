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
var TIER_MAP = {
  fast: "haiku",
  balanced: "sonnet",
  deep: "opus"
};
function model(tier) {
  return TIER_MAP[tier];
}
var PHASES = ["refine", "plan", "properties", "act", "validate", "review", "closeout"];

// skills/src/prompts/util-detect-branch.md
var util_detect_branch_default = 'Run these two commands and return ONLY a JSON object with two fields:\n1. "branch": output of `git rev-parse --abbrev-ref HEAD`\n2. "timestamp": output of `date +%Y%m%d-%H%M%S`\nOutput raw JSON only. No markdown fences, no explanation.';

// skills/src/datum-go.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
function parseArgs(raw) {
  if (!raw || raw.toLowerCase() === "yolo") return { yolo: true };
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid args: expected "yolo" or JSON object, got: "${raw.slice(0, 80)}"`);
  }
}
var a = typeof args === "string" ? parseArgs(rawArgs) : args || {};
var yolo = !!a.yolo;
var startFrom = (a.startFrom || "refine").toLowerCase();
var route = (a.route || "feature").toLowerCase();
var activePhases = a.phases && a.phases.length > 0 ? a.phases : [...PHASES];
var startIdx = PHASES.indexOf(startFrom);
if (startIdx === -1) {
  throw new Error(`Unknown phase: ${startFrom}. Valid: ${PHASES.join(", ")}`);
}
var lastResult = {};
var haltedAt = "";
function shouldRun(p, idx) {
  return !haltedAt && startIdx <= idx && activePhases.includes(p);
}
log(`datum go \u2014 route: ${route}, start: ${startFrom}${yolo ? " (yolo)" : ""}`);
if (shouldRun("refine", 0)) {
  log("\u2500\u2500 Refine \u2500\u2500");
  lastResult = await workflow({ scriptPath: "skills/datum-refine.js" }, yolo ? "yolo" : {});
  if (!yolo && !lastResult.gatePassed) {
    haltedAt = "refine";
    log(`Refine gate held: ${lastResult.gateMessage || "needs review"}. Address QUESTIONS.md, then: datum go --start-from plan`);
  } else {
    log("Refine complete");
  }
}
if (shouldRun("plan", 1)) {
  log("\u2500\u2500 Plan \u2500\u2500");
  lastResult = await workflow({ scriptPath: "skills/datum-plan.js" }, yolo ? "yolo" : {});
  if (!yolo && !lastResult.gatePassed) {
    haltedAt = "plan";
    log(`Plan gate held: ${lastResult.gateMessage || "needs approval"}. Review TASKS.md, then: datum go --start-from properties`);
  } else {
    log(`Plan complete \u2014 ${lastResult.taskCount || "?"} tasks`);
  }
}
if (shouldRun("properties", 2)) {
  log("\u2500\u2500 Properties \u2500\u2500");
  lastResult = await workflow({ scriptPath: "skills/datum-properties.js" }, yolo ? "yolo" : {});
  log("Properties complete");
}
if (shouldRun("act", 3)) {
  log("\u2500\u2500 Act \u2500\u2500");
  const lanePlanPath = ".datum/lane-plan.json";
  const testCommand = "uv run pytest -x -q";
  const language = "python";
  const branchInfo = await agent(util_detect_branch_default, { label: "act-detect", model: model("fast") });
  const info = parseAgentJson(branchInfo, { branch: "", timestamp: "" });
  const epicBranch = info.branch;
  const runId = info.timestamp;
  if (!epicBranch || !runId) throw new Error(`Failed to detect branch/timestamp: ${JSON.stringify(info)}`);
  const planText = await agent(
    `Read ${lanePlanPath} and return its contents as raw JSON text. Output ONLY the JSON, no markdown fences, no explanation.`,
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
    const setup = await workflow(
      { scriptPath: "skills/datum-tdd-act-setup.js" },
      { batchRunId, epicBranch, batchLaneIds, lanePlan, batchTag }
    );
    const act = await workflow(
      { scriptPath: "skills/datum-tdd-act-lane.js" },
      {
        batchLaneIds,
        lanePlan,
        worktreePaths: setup.worktreePaths,
        batchTag,
        cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language },
        priorFailures: actFailures
      }
    );
    for (const [id, r] of Object.entries(act.results || {})) {
      actResults[id] = r;
      if (!r || r.status !== "completed") {
        actFailures.push(id);
        log(`  FAILED ${id}: ${r ? `${r.stage} \u2014 ${r.error}` : "null result"}`);
      } else {
        actCompleted.push(id);
      }
    }
    log(`Act${batchTag} done: ${batchLaneIds.filter((id) => actCompleted.includes(id)).length}/${batchLaneIds.length} succeeded`);
    await workflow(
      { scriptPath: "skills/datum-tdd-act-merge.js" },
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
    { scriptPath: "skills/datum-tdd-act-docs.js" },
    { completedLanes: actCompleted, lanePlan, runId }
  );
  if (actFailures.length > 0) {
    await workflow(
      { scriptPath: "skills/datum-tdd-act-triage.js" },
      { failures: actFailures, results: actResults, lanePlan, runId, epicBranch }
    );
  }
  log(`Act complete \u2014 ${actCompleted.length}/${lanePlan.total_lanes} succeeded, ${actFailures.length} failed`);
  lastResult = { completed: actCompleted.length, failed: actFailures.length, failedLanes: actFailures };
}
if (shouldRun("validate", 4)) {
  log("\u2500\u2500 Validate \u2500\u2500");
  lastResult = await workflow({ scriptPath: "skills/datum-validate.js" }, yolo ? "yolo" : {});
  if (!yolo && !lastResult.testsPassed) {
    haltedAt = "validate";
    log("Validate FAILED \u2014 tests are red. Pipeline halted.");
  } else {
    log("Validate complete");
  }
}
if (shouldRun("review", 5)) {
  log("\u2500\u2500 Review \u2500\u2500");
  lastResult = await workflow({ scriptPath: "skills/datum-review.js" }, yolo ? "yolo" : {});
  if (!yolo && !lastResult.canMerge) {
    haltedAt = "review";
    log(`Review: ${lastResult.criticalFindings || "?"} critical issues. Fix, then: datum go --start-from validate`);
  } else {
    log("Review complete \u2014 clear to merge");
  }
}
if (shouldRun("closeout", 6)) {
  log("\u2500\u2500 Closeout \u2500\u2500");
  lastResult = await workflow({ scriptPath: "skills/datum-closeout.js" }, yolo ? "yolo" : {});
  log("Closeout complete");
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
