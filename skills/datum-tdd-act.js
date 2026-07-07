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
function epicSlug(branch) {
  return branch.replace(/[^A-Za-z0-9._-]/g, "-");
}
function fnv1a64(input) {
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = hash * PRIME & MASK;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
function laneSpecHash(lane) {
  const spec = {
    files: lane.files || [],
    acceptance_criteria: lane.acceptance_criteria || [],
    depends_on: lane.depends_on || []
  };
  return fnv1a64(JSON.stringify(spec));
}
function resolveLanePlanPrompt(epicDir2) {
  return `[${epicDir2}]
ls "${epicDir2}/lane-plan-final.json" 2>/dev/null && echo "final" || echo "default"
Return ONLY: "final" if lane-plan-final.json exists, "default" if only lane-plan.json exists, or "none" if neither exists.`;
}
function resolveLanePlanPath(epicDir2, agentResult) {
  const resolved = agentResult.trim();
  if (resolved === "final") return `${epicDir2}/lane-plan-final.json`;
  if (resolved === "default") return `${epicDir2}/lane-plan.json`;
  throw new Error(`No lane-plan.json found \u2014 tried: ${epicDir2}/lane-plan-final.json, ${epicDir2}/lane-plan.json`);
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
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
}

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- Test command comes from `.datum/config.json` `test_command` field \u2014 read it, don't guess\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500-line file cap \u2014 split via functional seams\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (from `.datum/config.json`)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Full Context\n- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and patterns\n";

// skills/src/prompts/lane-state-read.md
var lane_state_read_default = "Report which lanes of epic {{epicBranch}} already have epic-scoped completion markers.\n\nRun this exact script from the repo root and return ONLY its stdout \u2014 raw JSON, no markdown fences, no commentary:\n\n```\npython3 - <<'PYEOF'\nimport json, glob, os, subprocess\nout = {}\nfor f in sorted(glob.glob('.datum/epics/{{epicSlug}}/lane-state/*.json')):\n    try:\n        d = json.load(open(f))\n    except Exception:\n        continue\n    mc = d.get('merge_commit', '')\n    anc = False\n    if mc:\n        anc = subprocess.run(['git', 'merge-base', '--is-ancestor', mc, '{{epicBranch}}'],\n                             capture_output=True).returncode == 0\n    tid = d.get('task_id') or os.path.basename(f)[:-5]\n    out[tid] = {'status': d.get('status', ''), 'spec_hash': d.get('spec_hash', ''), 'ancestor': anc}\nprint(json.dumps(out))\nPYEOF\n```\n\nIf the lane-state directory does not exist, the script prints `{}` \u2014 that is the correct output. Do not create any files or directories.\n";

// skills/src/prompts/lane-state-write.md
var lane_state_write_default = "Record epic-scoped completion markers for lanes just squash-merged into {{epicBranch}}.\n\nRun this exact script from the repo root and return ONLY the word DONE:\n\n```\npython3 - <<'PYEOF'\nimport json, os, subprocess, datetime\nentries = json.loads('''{{entriesJson}}''')\nmerge_commit = subprocess.check_output(['git', 'rev-parse', '{{epicBranch}}']).decode().strip()\nts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')\nd = '.datum/epics/{{epicSlug}}/lane-state'\nos.makedirs(d, exist_ok=True)\nfor e in entries:\n    marker = {\n        'schema_version': '1.0',\n        'task_id': e['task_id'],\n        'status': 'completed',\n        'epic_branch': '{{epicBranch}}',\n        'merge_commit': merge_commit,\n        'spec_hash': e['spec_hash'],\n        'run_id': '{{runId}}',\n        'completed_at': ts,\n    }\n    with open(os.path.join(d, e['task_id'] + '.json'), 'w') as fh:\n        json.dump(marker, fh, indent=2)\n        fh.write('\\n')\nprint('DONE')\nPYEOF\n```\n\nDo not commit these files; they are local scheduler state.\n";

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function laneStateReadPrompt(vars) {
  return renderPrompt(lane_state_read_default, vars);
}
function laneStateWritePrompt(vars) {
  return renderPrompt(lane_state_write_default, vars);
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
var epicDir = `docs/epics/${epicBranch}`;
var lanePlanPath = a.lanePlanPath || "";
if (!lanePlanPath) {
  const resolveText = await agent(
    resolveLanePlanPrompt(epicDir),
    { label: "resolve-lane-plan", phase: "Topology", model: model("fast") }
  );
  lanePlanPath = resolveLanePlanPath(epicDir, resolveText);
}
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
var slug = epicSlug(epicBranch);
var markerText = await agent(
  laneStateReadPrompt({ epicBranch, epicSlug: slug }),
  { label: "lane-state-read", phase: "Topology", model: model("fast") }
);
var priorMarkers = parseAgentJson(markerText, {});
var alreadyMerged = lanePlan.topological_order.filter((id) => {
  const m = priorMarkers[id];
  return !!m && m.status === "completed" && m.ancestor === true && m.spec_hash === laneSpecHash(lanePlan.lanes[id] || {});
});
var results = {};
var failures = [];
var completedLanes = [];
for (const id of alreadyMerged) {
  results[id] = { task_id: id, status: "completed" };
  completedLanes.push(id);
}
if (alreadyMerged.length > 0) {
  log(`Epic-scoped state: ${alreadyMerged.length} lane(s) already merged, skipping: [${alreadyMerged.join(", ")}]`);
}
var MAX_BATCH = 5;
var allLaneIds = lanePlan.topological_order.filter((id) => !alreadyMerged.includes(id));
var batches = [];
for (let i = 0; i < allLaneIds.length; i += MAX_BATCH) {
  batches.push(allLaneIds.slice(i, i + MAX_BATCH));
}
if (batches.length > 1) {
  log(`Auto-partitioned ${allLaneIds.length} tasks into ${batches.length} batches (max ${MAX_BATCH}/batch)`);
  for (let b = 0; b < batches.length; b++) {
    log(`  Batch ${b}: [${batches[b].join(", ")}]`);
  }
}
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
    const unmet = deps.filter((d) => !batchLaneIds.includes(d) && !completedLanes.includes(d));
    if (unmet.length === 0) continue;
    const failedDeps = unmet.filter((d) => failures.includes(d) || results[d]?.status === "blocked");
    const neverRan = unmet.filter((d) => !failedDeps.includes(d));
    const rootCauses = failedDeps.map((d) => `${d}@${results[d]?.stage || "?"}`);
    const detail = [
      rootCauses.length > 0 ? `dep(s) failed/blocked: [${rootCauses.join(", ")}]` : "",
      neverRan.length > 0 ? `dep(s) never ran: [${neverRan.join(", ")}]` : ""
    ].filter(Boolean).join("; ");
    results[lid] = { task_id: lid, status: "blocked", stage: "SKIPPED", error: `blocked \u2014 ${detail}` };
    log(`  BLOCKED ${lid}: ${detail}`);
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
    } else if (r.status === "skipped" || r.status === "blocked") {
      log(`  ${r.status.toUpperCase()} ${id}: ${r.error || "dependency failed"}`);
    } else {
      completedLanes.push(id);
    }
  }
  log(`Act${batchTag} done: ${batchLaneIds.filter((id) => completedLanes.includes(id)).length}/${batchLaneIds.length} succeeded`);
  log("\u2500\u2500 Merge \u2500\u2500");
  const mergedIds = batchLaneIds.filter((id) => completedLanes.includes(id));
  await workflow(
    { scriptPath: sk("datum-tdd-act-merge") },
    {
      epicBranch,
      completedIds: mergedIds,
      batchRunId,
      topoOrder: lanePlan.topological_order,
      batchTag
    }
  );
  if (mergedIds.length > 0) {
    const entriesJson = JSON.stringify(mergedIds.map((id) => ({ task_id: id, spec_hash: laneSpecHash(lanePlan.lanes[id]) })));
    await agent(
      laneStateWritePrompt({ epicBranch, epicSlug: slug, runId: batchRunId, entriesJson }),
      { label: `lane-state-write${batchTag}`, phase: "Act", model: model("fast") }
    );
  }
}
log("\u2500\u2500 Docs \u2500\u2500");
await workflow(
  { scriptPath: sk("datum-tdd-act-docs") },
  { completedLanes, lanePlan, runId }
);
var skippedLanes = Object.keys(results).filter((id) => results[id]?.status === "skipped");
var blockedLanes = Object.keys(results).filter((id) => results[id]?.status === "blocked");
log(`
${"\u2550".repeat(60)}`);
log(`ACT COMPLETE: ${completedLanes.length}/${lanePlan.total_lanes} succeeded, ${failures.length} failed, ${skippedLanes.length} skipped, ${blockedLanes.length} blocked`);
if (completedLanes.length > 0) log(`  completed: [${completedLanes.join(", ")}]`);
if (failures.length > 0) {
  log(`  failed:    [${failures.join(", ")}]`);
  for (const fid of failures) {
    const r = results[fid];
    if (r) log(`    ${fid}: ${r.stage} \u2014 ${r.error}`);
  }
}
if (skippedLanes.length > 0) log(`  skipped:   [${skippedLanes.join(", ")}]`);
if (blockedLanes.length > 0) {
  log(`  blocked:   [${blockedLanes.join(", ")}]`);
  for (const bid of blockedLanes) {
    const r = results[bid];
    if (r) log(`    ${bid}: ${r.error}`);
  }
}
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
  blocked: blockedLanes.length,
  failedLanes: failures,
  skippedLanes,
  blockedLanes,
  completedLanes
};
