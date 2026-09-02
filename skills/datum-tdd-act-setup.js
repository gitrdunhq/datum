// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-setup.ts
export const meta = {
  name: "datum-tdd-act-setup",
  description: "Create root + per-lane git worktrees and distribute lane plan",
  phases: [{ title: "Setup" }]
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
function setupSteps(o) {
  const rootDir = `.datum/worktrees/${o.batchRunId}-root`;
  return [
    {
      name: "root-wt",
      command: `git worktree add --detach ${q(rootDir)} ${q(o.epicBranch)} 2>&1 && __root=$(cd ${q(rootDir)} && pwd) && printf '{"root": "%s"}' "$__root"`
    },
    {
      name: "setup-wt",
      command: `__setup=$(cd "$__root" && datum worktrees setup --run-id ${q(o.batchRunId)} --epic-branch ${q(o.epicBranch)} --lane-ids ${o.laneIds.join(",")}) && printf '%s' "$__setup"`
    },
    {
      name: "distribute",
      command: `__targets=(--target "$__root/.datum")
while IFS= read -r __p; do [ -n "$__p" ] && __targets+=(--target "$__p/.datum"); done < <(printf '%s' "$__setup" | jq -r '.[] | select(type=="string" and startswith("/"))')
datum lane-plan-distribute "$__root/${o.lanePlanPath}" "\${__targets[@]}"`
    }
  ];
}

// skills/src/datum-tdd-act-setup.ts
var a = args;
configureAgentTypes(a.agentTypes || {});
phase("Setup");
var steps = setupSteps({
  batchRunId: a.batchRunId,
  epicBranch: a.epicBranch,
  laneIds: a.batchLaneIds,
  lanePlanPath: a.lanePlanPath
});
var setupRaw = await agent(
  batchCommandPrompt(steps),
  stageOpts("cli", { label: `setup${a.batchTag}`, phase: "Setup", model: model("fast") })
);
var setup = parseBatchResult(setupRaw, steps);
var rootWtInfo = parseAgentJson(stepStdout(setup, "root-wt") || "", {});
var rootWt = rootWtInfo.root;
if (!rootWt) throw new Error(`Failed to create root worktree for ${a.batchRunId} (${describeFailure(setup, "setup")})`);
log(`Root worktree${a.batchTag}: ${rootWt}`);
var setupText = stepStdout(setup, "setup-wt");
var rawPaths = setupText ? parseAgentJson(setupText, null) : null;
if (!rawPaths || typeof rawPaths !== "object") {
  throw new Error(`Setup failed for ${a.batchRunId}: CLI output was not JSON \u2014 ${String(setupText ?? describeFailure(setup, "setup")).slice(0, 300)}`);
}
var worktreePaths = {};
for (const [lid, wtp] of Object.entries(rawPaths)) {
  if (typeof wtp === "string" && wtp.startsWith("/")) {
    worktreePaths[lid] = wtp;
  } else {
    log(`  [warn] dropping ${lid}: setup returned invalid worktree path ${JSON.stringify(wtp)}`);
  }
}
var validPaths = Object.values(worktreePaths);
if (validPaths.length === 0) throw new Error(`Setup failed: no worktree paths for ${a.batchRunId}`);
for (const [lid, wtp] of Object.entries(worktreePaths)) {
  log(`  worktree ${lid}: ${wtp}`);
}
if (setup.failed) {
  throw new Error(`Setup failed for ${a.batchRunId}: ${describeFailure(setup, "setup")}`);
}
log(`Setup${a.batchTag}: ${a.batchLaneIds.length} lane worktrees`);
return { worktreePaths };
