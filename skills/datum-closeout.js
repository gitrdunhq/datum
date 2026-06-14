// @generated — DO NOT EDIT. Source: skills/src/datum-closeout.ts
export const meta = {
  name: "datum-closeout",
  description: "Post-merge closeout \u2014 collect data, synthesize artifacts, archive",
  phases: [
    { title: "Collect", detail: "run datum closeout collectors (scripts, no LLM)" },
    { title: "Synthesize", detail: "produce CURRENT_STATE, CHANGELOG, RETRO, follow-ups" },
    { title: "Archive", detail: "commit, tag, reindex, archive state" }
  ]
};

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
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
}

// skills/src/prompts/closeout-synthesize.md
var closeout_synthesize_default = 'Closeout synthesis agent. Read closeout-data.json and produce post-epic artifacts.\n\nRead: {{closeoutDataPath}}\n\nEvery factual claim must be grounded in that file. Do not read source files for fresh data.\n\nProduce these artifacts IN ORDER (each depends on previous):\n\n1. CURRENT_STATE.md \u2014 full rewrite of project state post-epic\n2. CHANGELOG.md \u2014 append entries for what shipped\n3. RETRO.md at docs/epics/{{branch}}/RETRO.md \u2014 metrics, observations, brief defects\n4. follow-ups.json at .datum/runs/{{runId}}/follow-ups.json \u2014 gaps as machine-readable entries\n\nFor each artifact:\n- Write the file\n- Commit: git add <file> && git commit -m "closeout: write <artifact>"\n\nReturn JSON:\n{\n  "artifacts_written": ["CURRENT_STATE.md", "CHANGELOG.md", "RETRO.md", "follow-ups.json"],\n  "follow_up_count": N,\n  "key_metrics": {\n    "tasks_completed": N,\n    "tasks_failed": N,\n    "total_tokens": N\n  }\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/util-read-context.md
var util_read_context_default = 'Return a JSON object with:\n1. "branch": output of `git rev-parse --abbrev-ref HEAD`\n2. "epic_dir": "docs/epics/" + the branch name\n{{extraFields}}\nOutput raw JSON only. No markdown fences.\n';

// skills/src/datum-closeout.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var runId = a.runId || "";
phase("Collect");
var context = await agent(
  renderPrompt(util_read_context_default, {
    extraFields: `3. "merge_sha": output of \`git rev-parse HEAD\`
4. "base_sha": output of \`git merge-base HEAD origin/main\`
5. "run_id": "${runId}" if non-empty, else generate from \`date +%Y%m%d-%H%M%S\`
6. "closeout_data_exists": whether .datum/runs/<run_id>/closeout-data.json exists`
  }),
  { label: "read-context", model: "haiku" }
);
var ctx = typeof context === "string" ? parseAgentJson(context, {}) : context;
var rid = ctx.run_id || runId;
log(`Branch: ${ctx.branch}, run: ${rid}`);
if (!ctx.closeout_data_exists) {
  await agent(
    `Run these commands (scripts, not LLM work). Skip any that fail with "command not found":
mkdir -p .datum/runs/${rid}
datum closeout-collect-git --run-id ${rid} --base-sha ${ctx.base_sha} --merge-sha ${ctx.merge_sha} 2>/dev/null || echo "skip: closeout-collect-git"
datum closeout-collect-tasks --run-id ${rid} 2>/dev/null || echo "skip: closeout-collect-tasks"
datum closeout-collect-token-metrics --run-id ${rid} 2>/dev/null || echo "skip: closeout-collect-token-metrics"
datum closeout-collate --run-id ${rid} --merge-sha ${ctx.merge_sha} 2>/dev/null || echo "skip: closeout-collate"
Return JSON: {"collected": true}
Output raw JSON only.`,
    { label: "run-collectors", model: "haiku" }
  );
  log("Collectors complete");
} else {
  log("closeout-data.json already exists \u2014 skipping collectors");
}
phase("Synthesize");
var synthResult = await agent(
  renderPrompt(closeout_synthesize_default, {
    closeoutDataPath: `.datum/runs/${rid}/closeout-data.json`,
    branch: ctx.branch,
    runId: rid
  }),
  { label: "synthesize", model: "sonnet" }
);
var synth = typeof synthResult === "string" ? parseAgentJson(synthResult, { artifacts_written: [], follow_up_count: 0 }) : synthResult;
log(`Synthesis: ${(synth?.artifacts_written || []).join(", ")}`);
phase("Archive");
await agent(
  `Run these commands. Skip any that fail:
datum closeout-tag 2>/dev/null || git tag "epic/${ctx.branch}/${rid}" HEAD 2>/dev/null || echo "skip: tag"
datum closeout-archive --run-id ${rid} 2>/dev/null || echo "skip: archive"
Return JSON: {"archived": true}
Output raw JSON only.`,
  { label: "archive", model: "haiku" }
);
log("Closeout complete");
return {
  branch: ctx.branch,
  runId: rid,
  artifacts: synth?.artifacts_written || [],
  followUps: synth?.follow_up_count || 0
};
