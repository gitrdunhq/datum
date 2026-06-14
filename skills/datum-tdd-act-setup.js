// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-setup.ts
// skills/src/shared/utils.ts
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

// skills/src/datum-tdd-act-setup.ts
export const meta = {
  name: "datum-tdd-act-setup",
  description: "Create root + per-lane git worktrees and distribute lane plan",
  phases: [{ title: "Setup" }]
};
var a = args;
phase("Setup");
var rootWtText = await agent(
  `git worktree add --detach .datum/worktrees/${a.batchRunId}-root ${a.epicBranch} 2>&1 && echo '{"root": "'$(cd .datum/worktrees/${a.batchRunId}-root && pwd)'"}'`,
  { label: `root-wt${a.batchTag}`, phase: "Setup", model: "haiku" }
);
var rootWtInfo = parseAgentJson(rootWtText, {});
var rootWt = rootWtInfo.root;
if (!rootWt) throw new Error(`Failed to create root worktree for ${a.batchRunId}`);
log(`Root worktree${a.batchTag}: ${rootWt}`);
var setupText = await agent(
  `cd "${rootWt}" && datum worktrees setup --run-id ${a.batchRunId} --epic-branch ${a.epicBranch} --lane-ids ${a.batchLaneIds.join(",")}
Return ONLY the JSON output, no explanation.`,
  { label: `setup-wt${a.batchTag}`, phase: "Setup", model: "haiku" }
);
var worktreePaths = typeof setupText === "string" ? JSON.parse(setupText.replace(/```[a-z]*\n?/g, "").trim()) : setupText;
var validPaths = Object.values(worktreePaths || {}).filter(Boolean);
if (validPaths.length === 0) throw new Error(`Setup failed: no worktree paths for ${a.batchRunId}`);
for (const [lid, wtp] of Object.entries(worktreePaths || {})) {
  log(`  worktree ${lid}: ${wtp}`);
}
var planJson = JSON.stringify(a.lanePlan).replace(/'/g, "'\\''");
await agent(
  `mkdir -p "${rootWt}/.datum" && printf '%s' '${planJson}' > "${rootWt}/.datum/lane-plan.json"`,
  { label: `write-plan${a.batchTag}`, phase: "Setup", model: "haiku" }
);
var cpCmd = validPaths.map((p) => `mkdir -p "${p}/.datum" && cp "${rootWt}/.datum/lane-plan.json" "${p}/.datum/lane-plan.json"`).join(" && ");
if (cpCmd) {
  await agent(cpCmd, { label: `copy-plans${a.batchTag}`, phase: "Setup", model: "haiku" });
}
log(`Setup${a.batchTag}: ${a.batchLaneIds.length} lane worktrees`);
return { worktreePaths };
