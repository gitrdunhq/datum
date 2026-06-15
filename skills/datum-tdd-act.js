// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act.ts
export const meta = {
  name: "datum-tdd-act",
  description: "Deterministic TDD Act: RED->GREEN->REFACTOR per lane with gate enforcement",
  phases: []
};

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
var DEFAULT_CONFIG = {
  language: "",
  test_framework: "",
  test_command: "",
  skills_dir: ""
};
var READ_CONFIG_PROMPT = `Read TWO config files and merge them (global defaults, repo overrides):
1. Global: ~/.datum/config.json (may not exist \u2014 skip if missing)
2. Repo: .datum/config.json (required \u2014 if missing, return {"error": "missing .datum/config.json \u2014 run datum init first"})
Merge: start with global, overlay repo on top (repo wins on conflict). For nested objects like "models", merge keys (repo overrides individual tiers).
Return the merged JSON. Output raw JSON only.`;
function skillPath(skillsDir, name) {
  if (skillsDir) return `${skillsDir}/${name}.js`;
  return `skills/${name}.js`;
}

// skills/src/shared/utils.ts
function buildWaves(lanePlan2) {
  const lanes = lanePlan2.lanes;
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
  const waves2 = [];
  let queue = ids.filter((id) => inDeg[id] === 0).sort();
  while (queue.length > 0) {
    waves2.push([...queue]);
    const next = [];
    for (const id of queue) {
      for (const child of adj[id] || []) {
        inDeg[child]--;
        if (inDeg[child] === 0) next.push(child);
      }
    }
    queue = next.sort();
  }
  const placed = new Set(waves2.flat());
  const cyclic = ids.filter((id) => !placed.has(id));
  if (cyclic.length > 0) {
    throw new Error(
      `Cyclic dependency detected among tasks: ${cyclic.sort().join(", ")}`
    );
  }
  return waves2;
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

// skills/src/prompts/util-detect-branch.md
var util_detect_branch_default = 'Run these two commands and return ONLY a JSON object with two fields:\n1. "branch": output of `git rev-parse --abbrev-ref HEAD`\n2. "timestamp": output of `date +%Y%m%d-%H%M%S`\nOutput raw JSON only. No markdown fences, no explanation.';

// skills/src/datum-tdd-act.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var cfgText = !a.testCommand || !a.language ? await agent(READ_CONFIG_PROMPT, { label: "read-config", model: model("fast") }) : null;
var repoCfg = cfgText ? parseAgentJson(cfgText, { ...DEFAULT_CONFIG }) : {};
if (repoCfg.models && typeof repoCfg.models === "object") setModelTiers(repoCfg.models);
var sk = (name) => skillPath(repoCfg.skills_dir || "", name);
var testCommand = a.testCommand || repoCfg.test_command || DEFAULT_CONFIG.test_command;
var language = a.language || repoCfg.language || DEFAULT_CONFIG.language;
var test_framework = a.test_framework || repoCfg.test_framework;
var epicBranch = a.epicBranch;
var runId = a.runId;
var branchInfo = a.yolo ? await agent(util_detect_branch_default, { label: "yolo-detect", model: model("fast") }) : null;
if (branchInfo) {
  const info = parseAgentJson(branchInfo, { branch: "", timestamp: "" });
  epicBranch = epicBranch || info.branch;
  runId = runId || info.timestamp;
}
if (!epicBranch) throw new Error('args.epicBranch is required. Pass {epicBranch, runId} or "yolo" to auto-detect.');
if (!runId) throw new Error('args.runId is required. Pass {epicBranch, runId} or "yolo" to auto-detect.');
var lanePlanPath = a.lanePlanPath || `docs/epics/${epicBranch}/lane-plan.json`;
phase("Topology");
var planText = await agent(
  `Read ${lanePlanPath} and return its contents as raw JSON text. This is the SOLE source of truth \u2014 do NOT read tasks.json or any other file. Output ONLY the JSON, no markdown fences, no explanation.`,
  { label: "read-plan", phase: "Topology", model: model("fast") }
);
var lanePlan = typeof planText === "string" ? JSON.parse(planText.replace(/```[a-z]*\n?/g, "").trim()) : planText;
var waves = buildWaves(lanePlan);
if (waves.length === 0 || Object.keys(lanePlan.lanes || {}).length === 0) {
  throw new Error("Lane plan has 0 tasks \u2014 nothing to execute");
}
log(`Topology: ${lanePlan.total_lanes} lanes in ${waves.length} waves`);
for (let i = 0; i < waves.length; i++) {
  log(`  Wave ${i}: [${waves[i].join(", ")}]`);
}
var MAX_BATCH = 5;
var allLaneIds = lanePlan.topological_order;
var batches = [];
for (let i = 0; i < allLaneIds.length; i += MAX_BATCH) {
  batches.push(allLaneIds.slice(i, i + MAX_BATCH));
}
if (batches.length > 1) {
  log(`Auto-partitioned ${lanePlan.total_lanes} tasks into ${batches.length} batches (max ${MAX_BATCH}/batch)`);
  for (let b = 0; b < batches.length; b++) {
    log(`  Batch ${b}: [${batches[b].join(", ")}]`);
  }
}
var results = {};
var failures = [];
var completedLanes = [];
for (let bi = 0; bi < batches.length; bi++) {
  const batchLaneIds = batches[bi];
  const batchTag = batches.length > 1 ? ` [batch ${bi + 1}/${batches.length}]` : "";
  const batchRunId = batches.length > 1 ? `${runId}-b${bi}` : runId;
  if (batches.length > 1) log(`
${"=".repeat(60)}
=== Batch ${bi + 1}/${batches.length}: [${batchLaneIds.join(", ")}] ===
${"=".repeat(60)}`);
  for (const lid of batchLaneIds) {
    const deps = lanePlan.lanes[lid]?.depends_on || [];
    const missing = deps.filter((d) => !batchLaneIds.includes(d) && !completedLanes.includes(d) && !failures.includes(d));
    if (missing.length > 0) {
      results[lid] = { task_id: lid, status: "skipped", stage: "SKIPPED", error: `unmet cross-batch deps: [${missing.join(", ")}]` };
      log(`  SKIPPED ${lid}: deps [${missing.join(", ")}] never ran`);
    }
  }
  const runnableBatchIds = batchLaneIds.filter((id) => !results[id]);
  if (runnableBatchIds.length === 0) {
    log(`Batch ${bi} fully skipped \u2014 all lanes have unmet deps`);
    continue;
  }
  log("\u2500\u2500 Setup \u2500\u2500");
  const setup = await workflow(
    { scriptPath: sk("datum-tdd-act-setup") },
    { batchRunId, epicBranch, batchLaneIds: runnableBatchIds, lanePlan, batchTag }
  );
  log("\u2500\u2500 Act \u2500\u2500");
  const act = await workflow(
    { scriptPath: sk("datum-tdd-act-lane") },
    {
      batchLaneIds: runnableBatchIds,
      lanePlan,
      worktreePaths: setup.worktreePaths,
      batchTag,
      cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language, test_framework },
      priorFailures: failures,
      priorCompleted: completedLanes
    }
  );
  for (const [id, r] of Object.entries(act.results || {})) {
    results[id] = r;
    if (!r || r.status === "failed") {
      failures.push(id);
      log(`  FAILED ${id}: ${r ? `${r.stage} \u2014 ${r.error}` : "null result"}`);
    } else if (r.status === "skipped") {
      log(`  SKIPPED ${id}: ${r.error || "dependency failed"}`);
    } else {
      completedLanes.push(id);
    }
  }
  log(`Act${batchTag} done: ${batchLaneIds.filter((id) => completedLanes.includes(id)).length}/${batchLaneIds.length} succeeded`);
  log("\u2500\u2500 Merge \u2500\u2500");
  await workflow(
    { scriptPath: sk("datum-tdd-act-merge") },
    {
      epicBranch,
      completedIds: batchLaneIds.filter((id) => completedLanes.includes(id)),
      batchRunId,
      topoOrder: lanePlan.topological_order,
      batchTag
    }
  );
}
log("\u2500\u2500 Docs \u2500\u2500");
await workflow(
  { scriptPath: sk("datum-tdd-act-docs") },
  { completedLanes, lanePlan, runId }
);
var skippedLanes = Object.keys(results).filter((id) => results[id]?.status === "skipped");
log(`
${"\u2550".repeat(60)}`);
log(`ACT COMPLETE: ${completedLanes.length}/${lanePlan.total_lanes} succeeded, ${failures.length} failed, ${skippedLanes.length} skipped`);
if (completedLanes.length > 0) log(`  completed: [${completedLanes.join(", ")}]`);
if (failures.length > 0) {
  log(`  failed:    [${failures.join(", ")}]`);
  for (const fid of failures) {
    const r = results[fid];
    if (r) log(`    ${fid}: ${r.stage} \u2014 ${r.error}`);
  }
}
if (skippedLanes.length > 0) log(`  skipped:   [${skippedLanes.join(", ")}]`);
log(`${"\u2550".repeat(60)}`);
if (failures.length > 0) {
  log("\u2500\u2500 Triage \u2500\u2500");
  await workflow(
    { scriptPath: sk("datum-tdd-act-triage") },
    { failures, results, lanePlan, runId, epicBranch }
  );
}
return {
  runId,
  total: lanePlan.total_lanes,
  completed: completedLanes.length,
  failed: failures.length,
  skipped: skippedLanes.length,
  failedLanes: failures,
  skippedLanes,
  completedLanes
};
