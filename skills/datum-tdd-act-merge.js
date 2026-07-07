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

// skills/src/datum-tdd-act-merge.ts
var a = args;
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
    `datum worktrees merge --epic-branch "${a.epicBranch}" --lane-order ${mergeOrder.join(",")} --commit-message "act(${a.batchRunId}): merge ${greenIds.length} lanes"`,
    { label: `merge${a.batchTag}`, phase: "Merge", model: model("fast") }
  );
  log(`Merged${a.batchTag} in order: [${mergeOrder.join(" \u2192 ")}]`);
}
phase("Cleanup");
await agent(
  `datum worktrees cleanup --run-id "${a.batchRunId}" --epic-branch "${a.epicBranch}"`,
  { label: `cleanup${a.batchTag}`, phase: "Cleanup", model: model("fast") }
);
return { merged: a.completedIds.length > 0 };
