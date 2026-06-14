// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act.ts
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

// skills/src/datum-tdd-act.ts
export const meta = {
  name: "datum-tdd-act",
  description: "Deterministic TDD Act: RED->GREEN->REFACTOR per lane with gate enforcement",
  phases: [
    { title: "Topology", detail: "parse lane-plan.json, BFS wave grouping, auto-partition into \u22645 task batches" },
    { title: "Setup", detail: "create root + per-lane git worktrees (per batch)" },
    { title: "Act", detail: "RED->verify->GREEN->verify->REFACTOR per lane, DAG-parallel (per batch)" },
    { title: "Merge", detail: "squash-merge lanes in topological order (per batch)" },
    { title: "Cleanup", detail: "remove worktrees (per batch)" },
    { title: "Docs", detail: "haiku pre-check + conditional sonnet sync (once after all batches)" },
    { title: "Triage", detail: "analyze failures, auto-file issues on the board" }
  ]
};
var a = typeof args === "string" ? JSON.parse(args) : args || {};
var lanePlanPath = a.lanePlanPath || ".datum/lane-plan.json";
var epicBranch = a.epicBranch;
var runId = a.runId;
var testCommand = a.testCommand || "uv run pytest -x -q";
var language = a.language || "python";
if (!epicBranch) throw new Error("args.epicBranch is required. If resuming, pass the original args: Workflow({scriptPath, resumeFromRunId, args: {epicBranch, runId, ...}})");
if (!runId) throw new Error("args.runId is required. If resuming, pass the original args alongside resumeFromRunId");
phase("Topology");
var planText = await agent(
  `Read ${lanePlanPath} and return its contents as raw JSON text. This is the SOLE source of truth \u2014 do NOT read tasks.json or any other file. Output ONLY the JSON, no markdown fences, no explanation.`,
  { label: "read-plan", phase: "Topology", model: "haiku" }
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
  phase("Setup");
  const setup = await workflow(
    { scriptPath: "skills/datum-tdd-act-setup.js" },
    { batchRunId, epicBranch, batchLaneIds, lanePlan, batchTag }
  );
  phase("Act");
  const act = await workflow(
    { scriptPath: "skills/datum-tdd-act-lane.js" },
    {
      batchLaneIds,
      lanePlan,
      worktreePaths: setup.worktreePaths,
      batchTag,
      cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language },
      priorFailures: failures
    }
  );
  for (const [id, r] of Object.entries(act.results || {})) {
    results[id] = r;
    if (!r || r.status !== "completed") {
      failures.push(id);
      log(`  FAILED ${id}: ${r ? `${r.stage} \u2014 ${r.error}` : "null result"}`);
    } else {
      completedLanes.push(id);
    }
  }
  log(`Act${batchTag} done: ${batchLaneIds.filter((id) => completedLanes.includes(id)).length}/${batchLaneIds.length} succeeded`);
  phase("Merge");
  await workflow(
    { scriptPath: "skills/datum-tdd-act-merge.js" },
    {
      epicBranch,
      completedIds: batchLaneIds.filter((id) => completedLanes.includes(id)),
      batchRunId,
      topoOrder: lanePlan.topological_order,
      batchTag
    }
  );
}
phase("Docs");
await workflow(
  { scriptPath: "skills/datum-tdd-act-docs.js" },
  { completedLanes, lanePlan, runId }
);
log(`
${"\u2550".repeat(60)}`);
log(`ACT COMPLETE: ${completedLanes.length}/${lanePlan.total_lanes} succeeded, ${failures.length} failed`);
if (completedLanes.length > 0) log(`  completed: [${completedLanes.join(", ")}]`);
if (failures.length > 0) {
  log(`  failed:    [${failures.join(", ")}]`);
  for (const fid of failures) {
    const r = results[fid];
    if (r) log(`    ${fid}: ${r.stage} \u2014 ${r.error}`);
  }
}
log(`${"\u2550".repeat(60)}`);
if (failures.length > 0) {
  phase("Triage");
  await workflow(
    { scriptPath: "skills/datum-tdd-act-triage.js" },
    { failures, results, lanePlan, runId, epicBranch }
  );
}
return {
  runId,
  total: lanePlan.total_lanes,
  completed: completedLanes.length,
  failed: failures.length,
  failedLanes: failures,
  completedLanes
};
