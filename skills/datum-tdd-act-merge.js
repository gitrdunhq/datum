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
function parseAgentJson(text, fallback) {
  if (!text || typeof text !== "string") return fallback;
  const fenced = text.trim().match(/^```[a-z]*\n([\s\S]*)\n```$/);
  const cleaned = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(cleaned);
  } catch {
  }
  const openRe = /[{[]/g;
  let match;
  let best;
  let found = false;
  while ((match = openRe.exec(cleaned)) !== null) {
    const start = match.index;
    const end = findMatchingBracketEnd(cleaned, start);
    if (end === -1) continue;
    try {
      best = JSON.parse(cleaned.slice(start, end + 1));
      found = true;
      openRe.lastIndex = end + 1;
    } catch {
      openRe.lastIndex = start + 1;
    }
  }
  return found ? best : fallback;
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
function configureAgentTypes(opts) {
  if (typeof opts.agentTypes === "boolean") state.agentTypes = opts.agentTypes;
  if (typeof opts.hooksInstalled === "boolean") state.hooksInstalled = opts.hooksInstalled;
}
function stageOpts(stage, extra = {}) {
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
function batchCommandPrompt(steps2) {
  return 'Run exactly this script with the Bash tool in ONE invocation and return only its stdout, nothing else. Do not run the steps one at a time, do not retry or "fix" a failing step, do not ask for clarification, do not message anyone, do not summarise or explain \u2014 this prompt is the whole task. The script prints one JSON array (one object per step: name, exit_code, stdout, stderr); a non-zero exit_code is data to return, not a problem to solve.\n\n' + batchScript(steps2);
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
  if (!Array.isArray(arr)) return { steps: [], failed: null, missing: true };
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
function describeFailure(r, label) {
  if (r.missing) return `${label}: batch agent returned no parseable result`;
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
function completionMarkerCommand(runId, taskId) {
  const dir = `.datum/runs/${runId}/lane-state`;
  return `mkdir -p ${q(dir)} && printf '%s\\n' '{"task_id": "${taskId}", "status": "completed"}' > ${q(`${dir}/${taskId}.json`)}`;
}
function mergeSteps(o) {
  const steps2 = [];
  if (o.completedIds.length > 0) {
    steps2.push({
      name: "completion-markers",
      command: o.completedIds.map((id) => completionMarkerCommand(o.batchRunId, id)).join("\n"),
      tolerant: true
    });
  }
  if (o.mergeOrder.length > 0) {
    steps2.push({
      name: "merge",
      command: `datum worktrees merge --epic-branch ${q(o.epicBranch)} --lane-order ${o.mergeOrder.join(",")} --commit-message "act(${o.batchRunId}): merge ${o.mergeOrder.length} lanes"; __merge_rc=$?; [ "$__merge_rc" -eq 0 ]`,
      tolerant: true
    });
  }
  if (o.laneStateWriteScript) {
    steps2.push({
      name: "lane-state-write",
      command: `if [ "\${__merge_rc:-0}" -ne 0 ]; then echo SKIPPED_MERGE_FAILED; else
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

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- Test command comes from `.datum/config.json` `test_command` field \u2014 read it, don't guess\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500-line file cap \u2014 split via functional seams\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (from `.datum/config.json`)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Full Context\n- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and patterns\n";

// skills/src/prompts/lane-state-write.md
var lane_state_write_default = 'Record epic-scoped completion markers for lanes just squash-merged into {{epicBranch}}.\n\nRun this exact script from the repo root and return ONLY the word DONE. It calls `datum lane-state write` (the deterministic CLI, not hand-written JSON) once per entry:\n\n```\nMC=$(git rev-parse {{epicBranch}})\necho \'{{entriesJson}}\' | jq -c \'.[]\' | while read -r e; do\n  TID=$(echo "$e" | jq -r \'.task_id\')\n  SHASH=$(echo "$e" | jq -r \'.spec_hash\')\n  datum lane-state write --epic "{{epicBranch}}" --task "$TID" --status completed \\\n    --merge-commit "$MC" --spec-hash "$SHASH" --run-id "{{runId}}" > /dev/null\ndone\necho DONE\n```\n\nDo not write files directly; all state must go through the `datum lane-state write` CLI call above.\n';

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
if (mergeOrder.length > 0) {
  const m = stepResult(merge, "merge");
  if (m && m.exit_code === 0) {
    log(`Merged${a.batchTag} in order: [${mergeOrder.join(" \u2192 ")}]`);
  } else {
    log(`Merge${a.batchTag} FAILED: ${m ? (m.stderr || m.stdout).trim().split("\n").slice(-5).join("\n") : "step did not run"}`);
  }
}
if (laneState) {
  const out = stepStdout(merge, "lane-state-write") || "";
  if (out.includes("SKIPPED_MERGE_FAILED")) {
    log(`Lane-state markers${a.batchTag} NOT recorded \u2014 merge failed`);
  } else if (out.includes("DONE")) {
    log(`Lane-state markers${a.batchTag} recorded for [${(a.laneState?.entries || []).map((e) => e.task_id).join(", ")}]`);
  } else {
    log(`Lane-state markers${a.batchTag}: ${describeFailure(merge, "lane-state-write")}`);
  }
}
phase("Cleanup");
var cleanup = stepResult(merge, "cleanup");
log(`Cleanup${a.batchTag}: ${cleanup ? cleanup.exit_code === 0 ? "done" : `exited ${cleanup.exit_code}` : "step did not run"}`);
return { merged: a.completedIds.length > 0 };
