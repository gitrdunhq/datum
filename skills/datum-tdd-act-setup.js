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

// skills/src/shared/boot.ts
function runCommandPrompt(command) {
  return "Run exactly this command with the Bash tool and return only its stdout, nothing else. Do not ask for clarification, do not message anyone, do not summarise or explain \u2014 this prompt is the whole task.\n\n" + command;
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

// skills/src/datum-tdd-act-setup.ts
var a = args;
configureAgentTypes(a.agentTypes || {});
phase("Setup");
var rootWtText = await agent(
  runCommandPrompt(
    `git worktree add --detach ".datum/worktrees/${a.batchRunId}-root" "${a.epicBranch}" 2>&1 && echo '{"root": "'$(cd ".datum/worktrees/${a.batchRunId}-root" && pwd)'"}'`
  ),
  stageOpts("cli", { label: `root-wt${a.batchTag}`, phase: "Setup", model: model("fast") })
);
var rootWtInfo = parseAgentJson(rootWtText, {});
var rootWt = rootWtInfo.root;
if (!rootWt) throw new Error(`Failed to create root worktree for ${a.batchRunId}`);
log(`Root worktree${a.batchTag}: ${rootWt}`);
var setupText = await agent(
  runCommandPrompt(
    `cd "${rootWt}" && datum worktrees setup --run-id "${a.batchRunId}" --epic-branch "${a.epicBranch}" --lane-ids ${a.batchLaneIds.join(",")}`
  ) + "\nThe stdout is JSON \u2014 return it verbatim.",
  stageOpts("cli", { label: `setup-wt${a.batchTag}`, phase: "Setup", model: model("fast") })
);
var rawPaths = typeof setupText === "string" ? parseAgentJson(setupText, null) : setupText;
if (!rawPaths || typeof rawPaths !== "object") {
  throw new Error(`Setup failed for ${a.batchRunId}: CLI output was not JSON \u2014 ${String(setupText).slice(0, 300)}`);
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
var planSource = `${rootWt}/${a.lanePlanPath}`;
var distributeTargets = [rootWt, ...validPaths].map((p) => `--target "${p}/.datum"`).join(" ");
await agent(
  `Run: datum lane-plan-distribute "${planSource}" ${distributeTargets}`,
  stageOpts("cli", { label: `distribute-plan${a.batchTag}`, phase: "Setup", model: model("fast") })
);
log(`Setup${a.batchTag}: ${a.batchLaneIds.length} lane worktrees`);
return { worktreePaths };
