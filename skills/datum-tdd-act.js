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
  skills_dir: "",
  context_files: [],
  /** #368: pass agentType on every mapped agent() call (off for runtimes without it). */
  agent_types: true,
  /** #368: written by `datum init` once the datum-* PreToolUse hooks are materialised. */
  hooks_installed: false
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
function packWaves(waves2, maxBatch, lanePlan2) {
  if (lanePlan2) {
    return packWavesSafe(waves2, maxBatch, lanePlan2);
  }
  if (waves2.length <= 2) {
    return packWavesMerging(waves2, maxBatch);
  }
  return packWavesStrict(waves2, maxBatch);
}
function packWavesSafe(waves2, maxBatch, lanePlan2) {
  const batches2 = [];
  let current = [];
  for (const wave of waves2) {
    for (const id of wave) {
      const deps = lanePlan2.lanes?.[id]?.depends_on || [];
      const blockedByCurrent = deps.some((d) => current.includes(d));
      if (current.length > 0 && (current.length >= maxBatch || blockedByCurrent)) {
        batches2.push(current);
        current = [];
      }
      current.push(id);
    }
  }
  if (current.length > 0) {
    batches2.push(current);
  }
  return batches2;
}
function packWavesMerging(waves2, maxBatch) {
  const batches2 = [];
  let current = [];
  for (const wave of waves2) {
    let idx = 0;
    while (idx < wave.length) {
      const remaining = maxBatch - current.length;
      if (remaining <= 0) {
        batches2.push(current);
        current = [];
        continue;
      }
      const take = Math.min(remaining, wave.length - idx);
      current.push(...wave.slice(idx, idx + take));
      idx += take;
    }
  }
  if (current.length > 0) {
    batches2.push(current);
  }
  return batches2;
}
function packWavesStrict(waves2, maxBatch) {
  const batches2 = [];
  for (const wave of waves2) {
    let idx = 0;
    while (idx < wave.length) {
      const take = Math.min(maxBatch, wave.length - idx);
      batches2.push(wave.slice(idx, idx + take));
      idx += take;
    }
  }
  return batches2;
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
function resolveLanePlanPath(epicDir2, agentResult) {
  const resolved = agentResult.trim();
  if (resolved === "final") return `${epicDir2}/lane-plan-final.json`;
  if (resolved === "default") return `${epicDir2}/lane-plan.json`;
  throw new Error(`No lane-plan.json found \u2014 tried: ${epicDir2}/lane-plan-final.json, ${epicDir2}/lane-plan.json`);
}
function parseAgentJson(text, fallback) {
  if (!text || typeof text !== "string") return fallback;
  const fenced = text.trim().match(/^```[a-z]*\n([\s\S]*)\n```$/);
  const cleaned = (fenced ? fenced[1] : text).trim();
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
var lane_state_read_default = 'Report which lanes of epic {{epicBranch}} already have epic-scoped completion markers.\n\nRun this exact script from the repo root and return ONLY its stdout \u2014 raw JSON, no markdown fences, no commentary. It calls `datum lane-state read` (the deterministic CLI, not hand-written file parsing) once per task id:\n\n```\nOUT=\'{}\'\nfor TID in {{taskIdsSpace}}; do\n  R=$(datum lane-state read --epic "{{epicBranch}}" --task "$TID")\n  STATUS=$(echo "$R" | jq -r \'.status // "not_found"\')\n  if [ "$STATUS" = "not_found" ]; then continue; fi\n  MC=$(echo "$R" | jq -r \'.merge_commit // ""\')\n  SHASH=$(echo "$R" | jq -r \'.spec_hash // ""\')\n  ANC=false\n  if [ -n "$MC" ] && git merge-base --is-ancestor "$MC" "{{epicBranch}}" 2>/dev/null; then\n    ANC=true\n  fi\n  OUT=$(echo "$OUT" | jq --arg tid "$TID" --arg status "$STATUS" --arg spec_hash "$SHASH" --argjson ancestor "$ANC" \\\n    \'. + {($tid): {status: $status, spec_hash: $spec_hash, ancestor: $ancestor}}\')\ndone\necho "$OUT"\n```\n\nIf no markers exist for any task id, the script prints `{}` \u2014 that is the correct output. Do not create any files or directories.\n';

// skills/src/shared/lane-steps.ts
var q = (s) => `"${s.replace(/"/g, '\\"')}"`;
function fencedScript(rendered) {
  const m = rendered.match(/```[a-z]*\n([\s\S]*?)\n```/);
  if (!m) throw new Error("template has no fenced script block");
  return m[1];
}
function actStartSteps(o) {
  const steps = [];
  if (o.branch === "init") {
    steps.push({ name: "bootstrap", command: `__boot=$(${o.initCmd || "datum init --json"}) && printf '%s' "$__boot"` });
    steps.push({ name: "branch", command: `__eb=$(printf '%s' "$__boot" | jq -r '.epicBranch // empty') && [ -n "$__eb" ] && printf '%s' "$__eb"` });
  } else if (o.branch === "detect") {
    steps.push({ name: "branch", command: `__eb=$(git rev-parse --abbrev-ref HEAD) && printf '%s' "$__eb"` });
  } else {
    steps.push({ name: "branch", command: `__eb=${q(o.branch)} && printf '%s' "$__eb"` });
  }
  steps.push({ name: "timestamp", command: "date +%Y%m%d-%H%M%S" });
  if (o.lanePlanPath) {
    steps.push({ name: "resolve", command: `__plan=${q(o.lanePlanPath)} && echo given` });
  } else {
    steps.push({
      name: "resolve",
      command: `__epic="docs/epics/$__eb"
if [ -f "$__epic/lane-plan-final.json" ]; then __plan="$__epic/lane-plan-final.json"; echo final; elif [ -f "$__epic/lane-plan.json" ]; then __plan="$__epic/lane-plan.json"; echo default; else __plan=""; echo none; fi`,
      tolerant: true
    });
  }
  steps.push({ name: "lane-state-read", command: o.laneStateReadScript.trim(), tolerant: true });
  return steps;
}
function readLanePlanPrompt(lanePlanPath2) {
  return `Read the file at "${lanePlanPath2}" and return its exact JSON contents \u2014 unmodified, unsummarised, not merged or interpreted. If the file is too large to read in one call, use the Read tool's offset parameter to read the rest and concatenate the full content before answering \u2014 never answer with a partial or reconstructed/fabricated version of the file. Output raw JSON only, no markdown fences, no explanation.`;
}

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function laneStateReadPrompt(vars) {
  return renderPrompt(lane_state_read_default, vars);
}
function laneStateReadScript(vars) {
  return fencedScript(laneStateReadPrompt(vars));
}

// skills/src/shared/batch.ts
var NAME_RE = /^[a-z][a-z0-9-]*$/;
function validateBatchSteps(steps) {
  if (steps.length === 0) throw new Error("batch: no steps");
  const seen = /* @__PURE__ */ new Set();
  for (const s of steps) {
    if (!NAME_RE.test(s.name)) throw new Error(`batch: invalid step name "${s.name}"`);
    if (seen.has(s.name)) throw new Error(`batch: duplicate step name "${s.name}"`);
    seen.add(s.name);
    if (!s.command || !s.command.trim()) throw new Error(`batch: step "${s.name}" has an empty command`);
  }
}
function batchScript(steps) {
  validateBatchSteps(steps);
  const lines = [
    "__bo=$(mktemp); __be=$(mktemp); __r='[]'",
    `__rec() { __r=$(printf '%s' "$__r" | jq -c --arg n "$1" --argjson c "$2" --rawfile o "$__bo" --rawfile e "$__be" '. + [{name:$n, exit_code:$c, stdout:$o, stderr:$e}]'); }`,
    `__end() { printf '%s\\n' "$__r"; rm -f "$__bo" "$__be"; }`
  ];
  steps.forEach((s, i) => {
    lines.push(`# step ${i + 1}/${steps.length}: ${s.name}${s.tolerant ? " (tolerant)" : ""}`);
    lines.push("{");
    lines.push(s.command.replace(/\n+$/, ""));
    lines.push(`} >"$__bo" 2>"$__be"; __c=$?`);
    lines.push(`__rec '${s.name}' "$__c"`);
    if (!s.tolerant) lines.push('if [ "$__c" -ne 0 ]; then __end; exit 0; fi');
  });
  lines.push("__end");
  return lines.join("\n") + "\n";
}
function batchCommandPrompt(steps) {
  return 'Run exactly this script with the Bash tool in ONE invocation and return only its stdout, nothing else. Do not run the steps one at a time, do not retry or "fix" a failing step, do not ask for clarification, do not message anyone, do not summarise or explain \u2014 this prompt is the whole task. The script prints one JSON array (one object per step: name, exit_code, stdout, stderr); a non-zero exit_code is data to return, not a problem to solve.\n\n' + batchScript(steps);
}
function asStepResult(x) {
  if (!x || typeof x !== "object") return null;
  const o = x;
  if (typeof o.name !== "string") return null;
  const code = typeof o.exit_code === "number" ? o.exit_code : parseInt(String(o.exit_code ?? ""), 10);
  return {
    name: o.name,
    exit_code: Number.isFinite(code) ? code : 1,
    stdout: typeof o.stdout === "string" ? o.stdout : "",
    stderr: typeof o.stderr === "string" ? o.stderr : ""
  };
}
function parseBatchResult(raw, steps) {
  const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? parseAgentJson(raw, null) : null;
  if (!Array.isArray(arr)) return { steps: [], failed: null, missing: true };
  const results2 = arr.map(asStepResult).filter((r) => r !== null);
  const tolerant = new Set(steps.filter((s) => s.tolerant).map((s) => s.name));
  const failed = results2.find((r) => r.exit_code !== 0 && !tolerant.has(r.name)) ?? null;
  return { steps: results2, failed, missing: false };
}
function stepResult(r, name) {
  return r.steps.find((s) => s.name === name) ?? null;
}
function stepStdout(r, name) {
  const s = stepResult(r, name);
  return s ? s.stdout : null;
}
function describeFailure(r, label) {
  if (r.missing) return `${label}: batch agent returned no parseable result`;
  if (!r.failed) return `${label}: ok`;
  const tail = (r.failed.stderr || r.failed.stdout).trim().split("\n").slice(-5).join("\n");
  return `${label}: step "${r.failed.name}" exited ${r.failed.exit_code}${tail ? ` \u2014 ${tail}` : ""}`;
}

// skills/src/shared/agent-types.ts
var AGENT_TYPE_TABLE = {
  red: "datum-red",
  green: "datum-green",
  refactor: "datum-refactor",
  skeptic: "datum-skeptic",
  reflect: "datum-reflect",
  docs: "datum-docs",
  reader: "datum-reader",
  cli: "datum-cli"
};
var state = { agentTypes: true, hooksInstalled: false };
function readAgentTypeConfig(cfg) {
  const o = cfg && typeof cfg === "object" ? cfg : {};
  return {
    agentTypes: o.agent_types !== false,
    hooksInstalled: o.hooks_installed === true
  };
}
function configureAgentTypes(opts) {
  if (typeof opts.agentTypes === "boolean") state.agentTypes = opts.agentTypes;
  if (typeof opts.hooksInstalled === "boolean") state.hooksInstalled = opts.hooksInstalled;
}
function stageOpts(stage, extra = {}) {
  if (!state.agentTypes) return { ...extra };
  return { ...extra, agentType: AGENT_TYPE_TABLE[stage] };
}
function agentTypeArgs() {
  return { ...state };
}

// skills/src/datum-tdd-act.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var cfgText = !a.testCommand || !a.language ? await agent(READ_CONFIG_PROMPT, stageOpts("reader", { label: "read-config", model: model("fast") })) : null;
var repoCfg = cfgText ? parseAgentJson(cfgText, { ...DEFAULT_CONFIG }) : {};
if (repoCfg.models && typeof repoCfg.models === "object") setModelTiers(repoCfg.models);
configureAgentTypes(readAgentTypeConfig(repoCfg));
var sk = (name) => skillPath(repoCfg.skills_dir || "", name);
var testCommand = a.testCommand || repoCfg.test_command || DEFAULT_CONFIG.test_command;
var language = a.language || repoCfg.language || DEFAULT_CONFIG.language;
var test_framework = a.test_framework || repoCfg.test_framework;
var epicBranch = a.epicBranch;
var runId = a.runId;
var actStart = actStartSteps({
  branch: epicBranch ? epicBranch : a.yolo ? "detect" : "",
  lanePlanPath: a.lanePlanPath || null,
  laneStateReadScript: laneStateReadScript({
    epicBranch: "$__eb",
    epicSlug: "",
    taskIdsSpace: `$(jq -r '.topological_order[]' "$__plan")`
  })
});
if (!epicBranch && !a.yolo) throw new Error('args.epicBranch is required. Pass {epicBranch, runId} or "yolo" to auto-detect.');
var actStartRaw = await agent(
  batchCommandPrompt(actStart),
  stageOpts("cli", { label: "act-start", phase: "Topology", model: model("fast") })
);
var actStartResult = parseBatchResult(actStartRaw, actStart);
epicBranch = epicBranch || (stepStdout(actStartResult, "branch") || "").trim();
runId = runId || (stepStdout(actStartResult, "timestamp") || "").trim();
if (!epicBranch) throw new Error(`args.epicBranch is required and auto-detect failed (${describeFailure(actStartResult, "act-start")}). Pass {epicBranch, runId} or "yolo" to auto-detect.`);
if (!runId) throw new Error(`args.runId is required and auto-detect failed (${describeFailure(actStartResult, "act-start")}). Pass {epicBranch, runId} or "yolo" to auto-detect.`);
var epicDir = `docs/epics/${epicBranch}`;
var lanePlanPath = a.lanePlanPath || resolveLanePlanPath(epicDir, stepStdout(actStartResult, "resolve") || "");
phase("Topology");
var lanePlanText = await agent(
  readLanePlanPrompt(lanePlanPath),
  stageOpts("reader", { label: "read-lane-plan", phase: "Topology", model: model("fast") })
);
var lanePlan = parseAgentJson(lanePlanText, null);
if (!lanePlan || !lanePlan.lanes) throw new Error(`Failed to parse ${lanePlanPath} \u2014 ${describeFailure(actStartResult, "act-start")}`);
var waves = buildWaves(lanePlan);
if (waves.length === 0 || Object.keys(lanePlan.lanes || {}).length === 0) {
  throw new Error("Lane plan has 0 tasks \u2014 nothing to execute");
}
log(`Topology: ${lanePlan.total_lanes} lanes in ${waves.length} waves`);
for (let i = 0; i < waves.length; i++) {
  log(`  Wave ${i}: [${waves[i].join(", ")}]`);
}
var slug = epicSlug(epicBranch);
var priorMarkers = parseAgentJson(stepStdout(actStartResult, "lane-state-read") || "", {});
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
var remainingWaves = waves.map((wave) => wave.filter((id) => allLaneIds.includes(id))).filter((wave) => wave.length > 0);
var batches = packWaves(remainingWaves, MAX_BATCH, lanePlan);
log(`Wave-packed ${allLaneIds.length} tasks into ${batches.length} batches`);
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
    { batchRunId, epicBranch, batchLaneIds: runnableBatchIds, lanePlan, lanePlanPath, batchTag, agentTypes: agentTypeArgs() }
  );
  log("\u2500\u2500 Act \u2500\u2500");
  const act = await workflow(
    { scriptPath: sk("datum-tdd-act-lane") },
    {
      batchLaneIds: runnableBatchIds,
      lanePlan,
      worktreePaths: setup.worktreePaths,
      batchTag,
      cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language, test_framework, yolo: !!a.yolo, agentTypes: agentTypeArgs() },
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
  const approvals = Object.values(act.results || {}).filter(
    (r) => !!r && r.status === "blocked" && r.stage === "GREEN" && Array.isArray(r.needs_write)
  );
  if (approvals.length > 0) {
    log(`
LEAD APPROVAL NEEDED${batchTag} \u2014 GREEN is blocked on files outside allowed_write_files:`);
    for (const r of approvals) {
      log(`  ${r.task_id}: needs_write=[${(r.needs_write || []).join(", ")}]`);
      log(`    ${r.error}`);
    }
    log("  To approve: add the listed paths to that lane's `files` in lane-plan.json, then re-run act (datum go --start-from act). In yolo mode, paths inside src/ are widened automatically and GREEN re-runs once.");
  }
  log("\u2500\u2500 Merge \u2500\u2500");
  const mergedIds = batchLaneIds.filter((id) => completedLanes.includes(id));
  await workflow(
    { scriptPath: sk("datum-tdd-act-merge") },
    {
      epicBranch,
      completedIds: mergedIds,
      results,
      batchRunId,
      topoOrder: lanePlan.topological_order,
      batchTag,
      agentTypes: agentTypeArgs(),
      laneState: mergedIds.length > 0 ? { epicSlug: slug, entries: mergedIds.map((id) => ({ task_id: id, spec_hash: laneSpecHash(lanePlan.lanes[id]) })) } : null
    }
  );
}
log("\u2500\u2500 Docs \u2500\u2500");
await workflow(
  { scriptPath: sk("datum-tdd-act-docs") },
  { completedLanes, lanePlan, runId, agentTypes: agentTypeArgs() }
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
    { failures, blocked: blockedLanes.map((id) => results[id]), results, lanePlan, runId, epicBranch, agentTypes: agentTypeArgs() }
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
