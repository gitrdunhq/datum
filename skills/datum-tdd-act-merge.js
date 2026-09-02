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

// skills/src/shared/boot.ts
function runCommandPrompt(command) {
  return "Run exactly this command with the Bash tool and return only its stdout, nothing else. Do not ask for clarification, do not message anyone, do not summarise or explain \u2014 this prompt is the whole task.\n\n" + command;
}

// skills/src/shared/utils.ts
function filterGreenLanes(completedIds, results) {
  const greenIds2 = completedIds.filter((id) => results?.[id]?.stage !== "RED");
  const redOnlyIds2 = completedIds.filter((id) => results?.[id]?.stage === "RED");
  return { greenIds: greenIds2, redOnlyIds: redOnlyIds2 };
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

// skills/src/datum-tdd-act-merge.ts
var a = args;
configureAgentTypes(a.agentTypes || {});
phase("Merge");
var { greenIds, redOnlyIds } = filterGreenLanes(a.completedIds, a.results);
for (const id of redOnlyIds) {
  log(`[${id}] left in place, not merged \u2014 stage is RED (branch: ${a.epicBranch}--${id})`);
}
if (greenIds.length === 0) {
  log(`No GREEN/REFACTOR-complete lanes${a.batchTag} \u2014 skipping merge`);
} else {
  const mergeOrder = a.topoOrder.filter((id) => greenIds.includes(id));
  await agent(
    runCommandPrompt(
      `datum worktrees merge --epic-branch "${a.epicBranch}" --lane-order ${mergeOrder.join(",")} --commit-message "act(${a.batchRunId}): merge ${greenIds.length} lanes"`
    ),
    stageOpts("cli", { label: `merge${a.batchTag}`, phase: "Merge", model: model("fast") })
  );
  log(`Merged${a.batchTag} in order: [${mergeOrder.join(" \u2192 ")}]`);
}
phase("Cleanup");
await agent(
  runCommandPrompt(`datum worktrees cleanup --run-id "${a.batchRunId}" --epic-branch "${a.epicBranch}"`),
  stageOpts("cli", { label: `cleanup${a.batchTag}`, phase: "Cleanup", model: model("fast") })
);
return { merged: a.completedIds.length > 0 };
