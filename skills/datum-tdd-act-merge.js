// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-merge.ts
export const meta = {
  name: "datum-tdd-act-merge",
  description: "Squash-merge completed lanes in topological order, then cleanup worktrees",
  phases: [{ title: "Merge" }, { title: "Cleanup" }]
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

// skills/src/shared/utils.ts
function filterGreenLanes(completedIds, results) {
  const greenIds2 = completedIds.filter((id) => results?.[id]?.stage !== "RED");
  const redOnlyIds2 = completedIds.filter((id) => results?.[id]?.stage === "RED");
  return { greenIds: greenIds2, redOnlyIds: redOnlyIds2 };
}
function findMatchingBracketEnd(text, start) {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function scanForAgentJson(text) {
  if (!text || typeof text !== "string") return { found: false };
  const fenced = text.trim().match(/^```[a-z]*\n([\s\S]*)\n```$/);
  const cleaned2 = (fenced ? fenced[1] : text).trim();
  try {
    return { found: true, value: JSON.parse(cleaned2) };
  } catch {
  }
  const openRe = /[{[]/g;
  let match;
  let best;
  let found = false;
  while ((match = openRe.exec(cleaned2)) !== null) {
    const start = match.index;
    const end = findMatchingBracketEnd(cleaned2, start);
    if (end === -1) continue;
    try {
      best = JSON.parse(cleaned2.slice(start, end + 1));
      found = true;
      openRe.lastIndex = end + 1;
    } catch {
      openRe.lastIndex = start + 1;
    }
  }
  return found ? { found: true, value: best } : { found: false };
}
function parseAgentJson(text, fallback) {
  const r = scanForAgentJson(text);
  return r.found ? r.value : fallback;
}
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
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
var configured = false;
function configureAgentTypes(opts) {
  if (typeof opts.agentTypes === "boolean") state.agentTypes = opts.agentTypes;
  if (typeof opts.hooksInstalled === "boolean") state.hooksInstalled = opts.hooksInstalled;
  configured = true;
}
function stageOpts(stage, extra = {}) {
  if (!configured) {
    throw new Error(
      `agent_types_unconfigured: stageOpts('${stage}'${extra.label ? `, ${extra.label}` : ""}) called before configureAgentTypes() \u2014 configure from args/config first, or use bootstrapOpts() for the read that has to precede configuration`
    );
  }
  if (!state.agentTypes) return { ...extra };
  return { ...extra, agentType: AGENT_TYPE_TABLE[stage] };
}

// skills/src/shared/batch.ts
var NAME_RE = /^[a-z][a-z0-9-]*$/;
function validateBatchSteps(steps2) {
  if (steps2.length === 0) throw new Error("batch: no steps");
  const seen = /* @__PURE__ */ new Set();
  for (const s of steps2) {
    if (!NAME_RE.test(s.name)) throw new Error(`batch: invalid step name "${s.name}"`);
    if (seen.has(s.name)) throw new Error(`batch: duplicate step name "${s.name}"`);
    seen.add(s.name);
    if (!s.command || !s.command.trim()) throw new Error(`batch: step "${s.name}" has an empty command`);
  }
}
function batchScript(steps2) {
  validateBatchSteps(steps2);
  const lines = [
    "__bo=$(mktemp); __be=$(mktemp); __r='[]'",
    `__rec() { __r=$(printf '%s' "$__r" | jq -c --arg n "$1" --argjson c "$2" --rawfile o "$__bo" --rawfile e "$__be" '. + [{name:$n, exit_code:$c, stdout:$o, stderr:$e}]'); }`,
    `__end() { printf '%s\\n' "$__r"; rm -f "$__bo" "$__be"; }`
  ];
  steps2.forEach((s, i) => {
    lines.push(`# step ${i + 1}/${steps2.length}: ${s.name}${s.tolerant ? " (tolerant)" : ""}`);
    lines.push("{");
    lines.push(s.command.replace(/\n+$/, ""));
    lines.push(`} >"$__bo" 2>"$__be"; __c=$?`);
    lines.push(`__rec '${s.name}' "$__c"`);
    if (!s.tolerant) lines.push('if [ "$__c" -ne 0 ]; then __end; exit 0; fi');
  });
  lines.push("__end");
  return lines.join("\n") + "\n";
}
var cacheKey = "";
function setBatchCacheKey(key) {
  cacheKey = typeof key === "string" ? key : "";
}
function batchCommandPrompt(steps2) {
  return 'Run exactly this script with the Bash tool in ONE invocation and return only its stdout, nothing else. Do not run the steps one at a time, do not retry or "fix" a failing step, do not ask for clarification, do not message anyone, do not summarise or explain \u2014 this prompt is the whole task. The script prints one JSON array (one object per step: name, exit_code, stdout, stderr); a non-zero exit_code is data to return, not a problem to solve.\n\n' + (cacheKey ? `(inputs fingerprint ${cacheKey} \u2014 informational, do not act on it)

` : "") + batchScript(steps2);
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
function parseBatchResult(raw, steps2) {
  const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? parseAgentJson(raw, null) : null;
  if (!Array.isArray(arr)) {
    const text = typeof raw === "string" ? raw.trim() : "";
    return text ? { steps: [], failed: null, missing: true, refusal: text } : { steps: [], failed: null, missing: true };
  }
  const results = arr.map(asStepResult).filter((r) => r !== null);
  const tolerant = new Set(steps2.filter((s) => s.tolerant).map((s) => s.name));
  const failed = results.find((r) => r.exit_code !== 0 && !tolerant.has(r.name)) ?? null;
  return { steps: results, failed, missing: false };
}
function stepResult(r, name) {
  return r.steps.find((s) => s.name === name) ?? null;
}
function stepStdout(r, name) {
  const s = stepResult(r, name);
  return s ? s.stdout : null;
}
var REFUSAL_RE = /\b(permission|denied|blocked|classifier|not allowed|refused?|unable to (?:run|execute)|can(?:no|')t (?:run|execute))\b/i;
function describeFailure(r, label) {
  if (r.missing) {
    if (!r.refusal) return `${label}: batch agent returned no parseable result`;
    const excerpt = r.refusal.replace(/\s+/g, " ").slice(0, 300);
    if (REFUSAL_RE.test(r.refusal)) {
      return `${label}: runner_permission_denied \u2014 the datum-cli runner was refused by the host permission classifier and replied in prose; the commands in this batch need an allow-rule for this repo: "${excerpt}"`;
    }
    return `${label}: runner_no_json \u2014 batch agent returned no parseable result (reply: "${excerpt}")`;
  }
  if (!r.failed) return `${label}: ok`;
  const tail = (r.failed.stderr || r.failed.stdout).trim().split("\n").slice(-5).join("\n");
  return `${label}: step "${r.failed.name}" exited ${r.failed.exit_code}${tail ? ` \u2014 ${tail}` : ""}`;
}

// skills/src/shared/lane-steps.ts
var q = (s) => `"${s.replace(/"/g, '\\"')}"`;
function fencedScript(rendered) {
  const m = rendered.match(/```[a-z]*\n([\s\S]*?)\n```/);
  if (!m) throw new Error("template has no fenced script block");
  return m[1];
}
var PLAIN_ID_RE = /^[A-Za-z0-9._-]+$/;
function completionMarkerCommand(runId, taskId) {
  if (!PLAIN_ID_RE.test(runId)) throw new Error(`completionMarkerCommand: run id must be a plain identifier, got ${JSON.stringify(runId)}`);
  if (!PLAIN_ID_RE.test(taskId)) throw new Error(`completionMarkerCommand: task id must be a plain identifier, got ${JSON.stringify(taskId)}`);
  const dir = `.datum/runs/${runId}/lane-state`;
  return `mkdir -p ${q(dir)} && printf '%s\\n' '{"task_id": "${taskId}", "status": "completed"}' > ${q(`${dir}/${taskId}.json`)}`;
}
function mergeSteps(o) {
  const steps2 = [];
  if (o.mergeOrder.length > 0) {
    steps2.push({
      name: "merge",
      command: `__merge_out=$(datum worktrees merge --epic-branch ${q(o.epicBranch)} --lane-order ${o.mergeOrder.join(",")} --commit-message "act(${o.batchRunId}): merge ${o.mergeOrder.length} lanes"); __merge_rc=$?; printf '%s\\n' "$__merge_out"; [ "$__merge_rc" -eq 0 ]`,
      tolerant: true
    });
  }
  if (o.completedIds.length > 0) {
    steps2.push({
      name: "completion-markers",
      command: `__landed_ids=" $(printf '%s' "\${__merge_out:-}" | jq -r '(.merged[]?, .already_merged[]?)' 2>/dev/null | tr '\\n' ' ')"
` + o.completedIds.map((id) => `case "$__landed_ids" in *" ${id} "*) ${completionMarkerCommand(o.batchRunId, id)};; *) echo "SKIPPED_NOT_MERGED ${id}";; esac`).join("\n"),
      tolerant: true
    });
  }
  if (o.laneStateWriteScript) {
    steps2.push({
      name: "lane-state-write",
      command: `__merged_ids=" $(printf '%s' "\${__merge_out:-}" | jq -r '.merged[]?' 2>/dev/null | tr '\\n' ' ')"
if [ "$__merged_ids" = " " ]; then echo SKIPPED_MERGE_FAILED; else
${o.laneStateWriteScript.trim()}
fi`,
      tolerant: true
    });
  }
  steps2.push({
    name: "cleanup",
    command: `datum worktrees cleanup --run-id ${q(o.batchRunId)} --epic-branch ${q(o.epicBranch)}`,
    tolerant: true
  });
  return steps2;
}
var LANE_PLAN_DIGEST_BUDGET_BYTES = 16 * 1024;

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- Test command comes from `.datum/config.json` `test_command` field \u2014 read it, don't guess\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500-line file cap \u2014 split via functional seams\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (from `.datum/config.json`)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Full Context\n- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and patterns\n";

// skills/src/prompts/lane-state-write.md
var lane_state_write_default = 'Record epic-scoped completion markers for lanes just squash-merged into {{epicBranch}}.\n\nRun this exact script from the repo root and return ONLY the word DONE. It calls `datum lane-state write` (the deterministic CLI, not hand-written JSON) once per entry:\n\n```\nMC=$(git rev-parse {{epicBranch}})\necho \'{{entriesJson}}\' | jq -c \'.[]\' | while read -r e; do\n  TID=$(echo "$e" | jq -r \'.task_id\')\n  case "${__merged_ids:- $TID }" in *" $TID "*) ;; *) continue;; esac\n  SHASH=$(echo "$e" | jq -r \'.spec_hash\')\n  datum lane-state write --epic "{{epicBranch}}" --task "$TID" --status completed \\\n    --merge-commit "$MC" --spec-hash "$SHASH" --run-id "{{runId}}" > /dev/null\ndone\necho DONE\n```\n\nDo not write files directly; all state must go through the `datum lane-state write` CLI call above.\n';

// skills/src/shared/context-relay.ts
var CONTEXT_RELAY_BUDGET_BYTES = 16 * 1024;

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function laneStateWritePrompt(vars) {
  return renderPrompt(lane_state_write_default, vars);
}
function laneStateWriteScript(vars) {
  return fencedScript(laneStateWritePrompt(vars));
}

// skills/src/datum-tdd-act-merge.ts
var a = args;
configureAgentTypes(a.agentTypes || {});
setBatchCacheKey(a.configFingerprint || "");
phase("Merge");
var { greenIds, redOnlyIds } = filterGreenLanes(a.completedIds, a.results);
for (const id of redOnlyIds) {
  log(`[${id}] left in place, not merged \u2014 stage is RED (branch: ${a.epicBranch}--${id})`);
}
var mergeOrder = greenIds.length === 0 ? [] : a.topoOrder.filter((id) => greenIds.includes(id));
if (mergeOrder.length === 0) log(`No GREEN/REFACTOR-complete lanes${a.batchTag} \u2014 skipping merge`);
var laneState = a.laneState && a.laneState.entries.length > 0 ? laneStateWriteScript({
  epicBranch: a.epicBranch,
  epicSlug: a.laneState.epicSlug,
  runId: a.batchRunId,
  entriesJson: JSON.stringify(a.laneState.entries)
}) : null;
var steps = mergeSteps({
  batchRunId: a.batchRunId,
  epicBranch: a.epicBranch,
  completedIds: a.completedIds,
  mergeOrder,
  laneStateWriteScript: laneState
});
var mergeRaw = await agent(
  batchCommandPrompt(steps),
  stageOpts("cli", { label: `merge${a.batchTag}`, phase: "Merge", model: model("fast") })
);
var merge = parseBatchResult(mergeRaw, steps);
if (merge.missing) log(`Merge${a.batchTag}: ${describeFailure(merge, "merge batch")}`);
var mergeStep = mergeOrder.length > 0 ? stepResult(merge, "merge") : null;
var mergeOk = mergeOrder.length === 0 || !!mergeStep && mergeStep.exit_code === 0;
var mergeJson = parseAgentJson(mergeStep ? mergeStep.stdout : "", null);
var landedIds = mergeJson && Array.isArray(mergeJson.merged) ? mergeJson.merged : mergeOk ? mergeOrder : [];
var failedLane = mergeJson && typeof mergeJson.failed_lane === "string" ? mergeJson.failed_lane : "";
if (mergeOrder.length > 0) {
  if (mergeOk) {
    log(`Merged${a.batchTag} in order: [${mergeOrder.join(" \u2192 ")}]`);
  } else if (failedLane) {
    log(`Merge${a.batchTag} FAILED \u2014 partial merge: ${failedLane} did not land (${mergeJson?.error || "no error text"}); landed and committed: [${landedIds.join(", ") || "none"}]`);
  } else {
    log(`Merge${a.batchTag} FAILED: ${mergeStep ? (mergeStep.stderr || mergeStep.stdout).trim().split("\n").slice(-5).join("\n") : "step did not run"}`);
  }
}
if (laneState) {
  const out = stepStdout(merge, "lane-state-write") || "";
  if (out.includes("SKIPPED_MERGE_FAILED")) {
    log(`Lane-state markers${a.batchTag} NOT recorded \u2014 no lane landed`);
  } else if (out.includes("DONE")) {
    log(`Lane-state markers${a.batchTag} recorded for [${(a.laneState?.entries || []).map((e) => e.task_id).filter((id) => landedIds.includes(id)).join(", ")}]`);
  } else {
    log(`Lane-state markers${a.batchTag}: ${describeFailure(merge, "lane-state-write")}`);
  }
}
phase("Cleanup");
var cleanup = stepResult(merge, "cleanup");
log(`Cleanup${a.batchTag}: ${cleanup ? cleanup.exit_code === 0 ? "done" : `exited ${cleanup.exit_code}` : "step did not run"}`);
var cleaned = cleanup && cleanup.exit_code === 0 ? parseAgentJson(cleanup.stdout, null) : null;
var preserved = cleaned && cleaned.cleaned && Array.isArray(cleaned.cleaned.preserved_with_commits) ? cleaned.cleaned.preserved_with_commits : [];
if (preserved.length > 0) {
  log(`Cleanup${a.batchTag}: preserved lane branch(es) with real commits (not deleted): ${preserved.join(", ")}`);
}
return {
  merged: mergeOrder.length > 0 && mergeOk,
  failed: mergeOrder.length > 0 && !mergeOk,
  mergedIds: mergeJson && Array.isArray(mergeJson.merged) ? mergeJson.merged : mergeOk ? mergeOrder : [],
  failedLane: mergeJson && typeof mergeJson.failed_lane === "string" ? mergeJson.failed_lane : ""
};
