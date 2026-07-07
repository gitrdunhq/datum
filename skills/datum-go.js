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
function resolveLanePlanPrompt(epicDir) {
  return `[${epicDir}]
ls "${epicDir}/lane-plan-final.json" 2>/dev/null && echo "final" || echo "default"
Return ONLY: "final" if lane-plan-final.json exists, "default" if only lane-plan.json exists, or "none" if neither exists.`;
}
function resolveLanePlanPath(epicDir, agentResult) {
  const resolved = agentResult.trim();
  if (resolved === "final") return `${epicDir}/lane-plan-final.json`;
  if (resolved === "default") return `${epicDir}/lane-plan.json`;
  throw new Error(`No lane-plan.json found \u2014 tried: ${epicDir}/lane-plan-final.json, ${epicDir}/lane-plan.json`);
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
  const skeletonDir = `docs/epics/${epicBranch}/skeletons`;
  const epicDir = `docs/epics/${epicBranch}`;
  const resolveText = await agent(
    resolveLanePlanPrompt(epicDir),
    { label: "resolve-lane-plan", phase: "Act", model: model("fast") }
  );
  const lanePlanPath = resolveLanePlanPath(epicDir, resolveText);
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
  const slug = epicSlug(epicBranch);
  const markerText = await agent(
    laneStateReadPrompt({ epicBranch, epicSlug: slug }),
    { label: "lane-state-read", phase: "Act", model: model("fast") }
  );
  const priorMarkers = parseAgentJson(markerText, {});
  const alreadyMerged = lanePlan.topological_order.filter((id) => {
    const m = priorMarkers[id];
    return !!m && m.status === "completed" && m.ancestor === true && m.spec_hash === laneSpecHash(lanePlan.lanes[id] || {});
  });
  const actResults = {};
  const actFailures = [];
  const actCompleted = [];
  for (const id of alreadyMerged) {
    actResults[id] = { task_id: id, status: "completed" };
    actCompleted.push(id);
  }
  if (alreadyMerged.length > 0) {
    log(`Epic-scoped state: ${alreadyMerged.length} lane(s) already merged, skipping: [${alreadyMerged.join(", ")}]`);
  }
  const MAX_BATCH = 5;
  const allLaneIds = lanePlan.topological_order.filter((id) => !alreadyMerged.includes(id));
  const batches = [];
  for (let i = 0; i < allLaneIds.length; i += MAX_BATCH) {
    batches.push(allLaneIds.slice(i, i + MAX_BATCH));
  }
  if (batches.length > 1) {
    log(`Auto-partitioned ${allLaneIds.length} tasks into ${batches.length} batches`);
  }
  for (let bi = 0; bi < batches.length; bi++) {
    const batchLaneIds = batches[bi];
    const batchTag = batches.length > 1 ? ` [batch ${bi + 1}/${batches.length}]` : "";
    const batchRunId = batches.length > 1 ? `${runId}-b${bi}` : runId;
    if (batches.length > 1) log(`
=== Batch ${bi + 1}/${batches.length}: [${batchLaneIds.join(", ")}] ===`);
    for (const lid of batchLaneIds) {
      const deps = lanePlan.lanes[lid]?.depends_on || [];
      const unmet = deps.filter((d) => !batchLaneIds.includes(d) && !actCompleted.includes(d));
      if (unmet.length === 0) continue;
      const failedDeps = unmet.filter((d) => actFailures.includes(d) || actResults[d]?.status === "blocked");
      const neverRan = unmet.filter((d) => !failedDeps.includes(d));
      const rootCauses = failedDeps.map((d) => `${d}@${actResults[d]?.stage || "?"}`);
      const detail = [
        rootCauses.length > 0 ? `dep(s) failed/blocked: [${rootCauses.join(", ")}]` : "",
        neverRan.length > 0 ? `dep(s) never ran: [${neverRan.join(", ")}]` : ""
      ].filter(Boolean).join("; ");
      actResults[lid] = { task_id: lid, status: "blocked", stage: "SKIPPED", error: `blocked \u2014 ${detail}` };
      log(`  BLOCKED ${lid}: ${detail}`);
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
        cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language, skeletonDir },
        priorFailures: actFailures,
        priorCompleted: actCompleted
      }
    );
    for (const [id, r] of Object.entries(act.results || {})) {
      actResults[id] = r;
      if (!r || r.status === "failed") {
        actFailures.push(id);
        log(`  FAILED ${id}: ${r ? `${r.stage} \u2014 ${r.error}` : "null result"}`);
      } else if (r.status === "skipped" || r.status === "blocked") {
        log(`  ${r.status.toUpperCase()} ${id}: ${r.error || "dependency failed"}`);
      } else {
        actCompleted.push(id);
      }
    }
    log(`Act${batchTag} done: ${batchLaneIds.filter((id) => actCompleted.includes(id)).length}/${batchLaneIds.length} succeeded`);
    const mergedIds = batchLaneIds.filter((id) => actCompleted.includes(id));
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
  const actBlocked = Object.keys(actResults).filter((id) => actResults[id]?.status === "blocked");
  await markPhaseComplete("act");
  log(`Act complete \u2014 ${actCompleted.length}/${lanePlan.total_lanes} succeeded, ${actFailures.length} failed, ${actSkipped.length} skipped, ${actBlocked.length} blocked`);
  lastResult = { completed: actCompleted.length, failed: actFailures.length, skipped: actSkipped.length, blocked: actBlocked.length, failedLanes: actFailures, skippedLanes: actSkipped, blockedLanes: actBlocked };
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
