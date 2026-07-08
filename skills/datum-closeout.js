// @generated — DO NOT EDIT. Source: skills/src/datum-closeout.ts
export const meta = {
  name: "datum-closeout",
  description: "Post-merge closeout \u2014 collect data, synthesize artifacts, archive",
  phases: [
    { title: "Collect", detail: "run collectors + read context" },
    { title: "Synthesize", detail: "CURRENT_STATE, CHANGELOG, RETRO, follow-ups, tag, archive" }
  ]
};

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
function model(tier) {
  return activeTiers[tier];
}

// skills/src/prompts/closeout-synthesize.md
var closeout_synthesize_default = 'Closeout synthesis agent. Read closeout-data.json and produce post-epic artifacts.\n\nRead: {{closeoutDataPath}}\n\nEvery factual claim must be grounded in that file. Do not read source files for fresh data.\n\nProduce these artifacts IN ORDER (each depends on previous):\n\n1. CURRENT_STATE.md \u2014 full rewrite of project state post-epic\n2. CHANGELOG.md \u2014 append entries for what shipped\n3. RETRO.md at docs/epics/{{branch}}/RETRO.md \u2014 metrics, observations, brief defects\n4. follow-ups.json at .datum/runs/{{runId}}/follow-ups.json \u2014 gaps as machine-readable entries\n\nFor each artifact:\n- Write the file\n- Commit: git add <file> && git commit -m "closeout: write <artifact>"\n\nReturn JSON:\n{\n  "artifacts_written": ["CURRENT_STATE.md", "CHANGELOG.md", "RETRO.md", "follow-ups.json"],\n  "follow_up_count": N,\n  "key_metrics": {\n    "tasks_completed": N,\n    "tasks_failed": N,\n    "total_tokens": N\n  }\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/util-read-context.md
var util_read_context_default = `Return a JSON object with:
1. "branch": output of \`git rev-parse --abbrev-ref HEAD\`
2. "epic_dir": "docs/epics/" + the branch name
{{extraFields}}
If any field embeds full multi-line file contents, do NOT hand-type the JSON \u2014 build it programmatically with a command that guarantees correct escaping, e.g.:
\`python3 -c "import json; print(json.dumps({'branch': ..., 'epic_dir': ..., 'spec_content': open('path/SPEC.md').read(), ...}))"\`
Hand-escaping large files reliably produces invalid JSON (stray backslashes, unescaped control chars). Run that command, then output only its stdout \u2014 no markdown fences, no commentary.
`;

// skills/src/datum-closeout.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var runId = a.runId || "";
phase("Collect");
var collectResult = await agent(
  renderPrompt(util_read_context_default, {
    extraFields: `3. "merge_sha": output of \`git rev-parse HEAD\`
4. "base_sha": output of \`git merge-base HEAD origin/main\`
5. "run_id": "${runId}" if non-empty, else generate from \`date +%Y%m%d-%H%M%S\`
6. "closeout_data_exists": whether .datum/runs/<run_id>/closeout-data.json exists

ADDITIONAL: If closeout_data_exists is false, also run these collectors (skip failures):
mkdir -p .datum/runs/<run_id>
datum closeout-collect-git --run-id <run_id> --base-sha <base_sha> --merge-sha <merge_sha> 2>/dev/null || true
datum closeout-collect-tasks --run-id <run_id> 2>/dev/null || true
datum closeout-collect-token-metrics --run-id <run_id> 2>/dev/null || true
datum closeout-collate --run-id <run_id> --merge-sha <merge_sha> 2>/dev/null || true
Include "collected": true in the response if you ran collectors.`
  }),
  { label: "collect", model: model("fast") }
);
var ctx = typeof collectResult === "string" ? parseAgentJson(collectResult, {}) : collectResult;
var rid = ctx.run_id || runId;
log(`Branch: ${ctx.branch}, run: ${rid}`);
phase("Synthesize");
var synthResult = await agent(
  renderPrompt(closeout_synthesize_default, { closeoutDataPath: `.datum/runs/${rid}/closeout-data.json`, branch: ctx.branch, runId: rid }) + `

AFTER writing artifacts, also:
1. Tag: git tag "epic/${ctx.branch}/${rid}" HEAD 2>/dev/null || true
2. Archive: datum closeout-archive --run-id ${rid} 2>/dev/null || true
3. Clean up root pipeline artifacts \u2014 move them to the epic archive dir:
   EPIC_DIR="docs/epics/${ctx.branch}"
   mkdir -p "$EPIC_DIR"
   for f in SPEC.md TASKS.md QUESTIONS.md PROPERTIES.md TICKET.md tasks.json; do
     [ -f "$f" ] && mv "$f" "$EPIC_DIR/" && echo "archived $f \u2192 $EPIC_DIR/"
   done
   [ -f .datum/lane-plan.json ] && mv .datum/lane-plan.json "$EPIC_DIR/" && echo "archived lane-plan.json \u2192 $EPIC_DIR/"
4. Commit the cleanup: git add -A && git commit -m "closeout(${rid}): archive pipeline artifacts to $EPIC_DIR"`,
  { label: "synthesize-and-archive", model: model("balanced") }
);
var synth = typeof synthResult === "string" ? parseAgentJson(synthResult, { artifacts_written: [], follow_up_count: 0 }) : synthResult;
log(`Closeout complete: ${(synth?.artifacts_written || []).join(", ")}`);
await agent(
  `Run: datum housekeep-epic ${ctx.branch}`,
  { label: "housekeep", model: model("fast") }
);
return {
  branch: ctx.branch,
  runId: rid,
  artifacts: synth?.artifacts_written || [],
  followUps: synth?.follow_up_count || 0
};
