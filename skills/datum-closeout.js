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
  const cleaned = (fenced ? fenced[1] : text).trim();
  try {
    return { found: true, value: JSON.parse(cleaned) };
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
  return found ? { found: true, value: best } : { found: false };
}
function parseAgentJson(text, fallback) {
  const r = scanForAgentJson(text);
  return r.found ? r.value : fallback;
}
function parseAgentJsonStrict(text, label) {
  const r = scanForAgentJson(text);
  if (!r.found) {
    throw new Error(`agent_output_unparseable: ${label} \u2014 ${String(text ?? "").slice(0, 200)}`);
  }
  return r.value;
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
var closeout_synthesize_default = 'Closeout synthesis agent. Read closeout-data.json and produce post-epic artifacts.\n\nRead: {{closeoutDataPath}}\n\nEvery factual claim must be grounded in that file. Do not read source files for fresh data.\n\nProduce these artifacts IN ORDER (each depends on previous):\n\n1. CURRENT_STATE.md \u2014 full rewrite of project state post-epic\n2. CHANGELOG.md \u2014 append entries for what shipped\n3. RETRO.md at docs/epics/{{branch}}/RETRO.md \u2014 metrics, observations, brief defects\n4. follow-ups.json at .datum/runs/{{runId}}/follow-ups.json \u2014 gaps as machine-readable entries\n\nFor each artifact: write the file. Do NOT git add or git commit anything \u2014 the workflow commits CURRENT_STATE.md, CHANGELOG.md and RETRO.md after you return (follow-ups.json lives under the untracked .datum/runs/ directory).\n\nReturn JSON:\n{\n  "artifacts_written": ["CURRENT_STATE.md", "CHANGELOG.md", "RETRO.md", "follow-ups.json"],\n  "follow_up_count": N,\n  "key_metrics": {\n    "tasks_completed": N,\n    "tasks_failed": N,\n    "total_tokens": N\n  }\n}\n\nOutput raw JSON only. No markdown fences.\n';

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
function bootstrapOpts(stage, extra = {}) {
  if (!configured) return { ...extra };
  return stageOpts(stage, extra);
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
var cacheKey = "";
function setBatchCacheKey(key) {
  cacheKey = typeof key === "string" ? key : "";
}
function batchCommandPrompt(steps) {
  return 'Run exactly this script with the Bash tool in ONE invocation and return only its stdout, nothing else. Do not run the steps one at a time, do not retry or "fix" a failing step, do not ask for clarification, do not message anyone, do not summarise or explain \u2014 this prompt is the whole task. The script prints one JSON array (one object per step: name, exit_code, stdout, stderr); a non-zero exit_code is data to return, not a problem to solve.\n\n' + (cacheKey ? `(inputs fingerprint ${cacheKey} \u2014 informational, do not act on it)

` : "") + batchScript(steps);
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
  if (!Array.isArray(arr)) {
    const text = typeof raw === "string" ? raw.trim() : "";
    return text ? { steps: [], failed: null, missing: true, refusal: text } : { steps: [], failed: null, missing: true };
  }
  const results = arr.map(asStepResult).filter((r) => r !== null);
  const tolerant = new Set(steps.filter((s) => s.tolerant).map((s) => s.name));
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
function housekeepSteps(epicBranch) {
  return [{ name: "housekeep", command: `datum housekeep-epic ${q(epicBranch)}`, tolerant: true }];
}
function housekeepFromSteps(result) {
  if (result.missing) return { ok: false, summary: "", error: `housekeep_failed: ${describeFailure(result, "housekeep")}` };
  const step = stepResult(result, "housekeep");
  if (!step) return { ok: false, summary: "", error: "housekeep_failed: housekeep step did not run" };
  if (step.exit_code !== 0) {
    const tail = (step.stderr || step.stdout || "").trim().split("\n").slice(-3).join(" | ");
    return { ok: false, summary: "", error: `housekeep_failed: datum housekeep-epic exited ${step.exit_code} \u2014 ${tail}` };
  }
  return { ok: true, summary: (step.stdout || "").trim(), error: "" };
}
var SCOPE_READ_BUDGET_BYTES = 16 * 1024;
var LANE_PLAN_DIGEST_BUDGET_BYTES = 16 * 1024;
function closeoutCollectSteps(o) {
  return [
    {
      name: "branch",
      command: o.branchHint ? `printf '%s' ${q(o.branchHint)}` : "git rev-parse --abbrev-ref HEAD",
      tolerant: true
    },
    {
      name: "timestamp",
      command: o.runId ? `__rid=${q(o.runId)} && printf '%s' "$__rid"` : `__rid=$(date +%Y%m%d-%H%M%S) && printf '%s' "$__rid"`,
      tolerant: true
    },
    { name: "base-sha", command: `__base=$(git merge-base HEAD origin/main) && printf '%s' "$__base"`, tolerant: true },
    { name: "merge-sha", command: `__merge=$(git rev-parse HEAD) && printf '%s' "$__merge"`, tolerant: true },
    { name: "config", command: `cat .datum/config.json || echo '{}'`, tolerant: true },
    { name: "mkdir", command: `mkdir -p ".datum/runs/$__rid"`, tolerant: true },
    {
      name: "collect-git",
      command: `datum closeout-collect-git --run-id "$__rid" --base-sha "$__base" --merge-sha "$__merge"`,
      tolerant: true
    },
    { name: "collect-tasks", command: `datum closeout-collect-tasks --run-id "$__rid"`, tolerant: true },
    { name: "collect-token-metrics", command: `datum closeout-collect-token-metrics --run-id "$__rid"`, tolerant: true },
    { name: "collate", command: `datum closeout-collate --run-id "$__rid" --merge-sha "$__merge"`, tolerant: true },
    {
      name: "data-exists",
      command: `test -s ".datum/runs/$__rid/closeout-data.json" && echo yes || echo no`,
      tolerant: true
    }
  ];
}
var ARCHIVE_ROOT_FILES = ["SPEC.md", "TASKS.md", "QUESTIONS.md", "PROPERTIES.md", "TICKET.md", "tasks.json"];
function moveStepName(fileName) {
  return `move-${fileName.toLowerCase().replace(/\./g, "-")}`;
}
function moveIntoEpicDirCommand(src, epicDir2, base) {
  return `if [ -f ${q(src)} ]; then mkdir -p ${q(epicDir2)} && git mv ${q(src)} ${q(`${epicDir2}/${base}`)}; else echo ABSENT; fi`;
}
function closeoutArchiveSteps(o) {
  const steps = [
    // File the run's follow-ups (synthesis manifest + per-lane skeptic minority findings) before archiving.
    { name: "file-followups", command: `datum closeout-file-followups --run-id ${q(o.runId)}`, tolerant: true },
    { name: "tag", command: `git tag ${q(`epic/${o.branch}/${o.runId}`)} HEAD`, tolerant: true },
    { name: "archive", command: `datum closeout-archive --run-id ${q(o.runId)}`, tolerant: true }
  ];
  for (const f of ARCHIVE_ROOT_FILES) {
    steps.push({ name: moveStepName(f), command: moveIntoEpicDirCommand(f, o.epicDir, f), tolerant: true });
  }
  steps.push({
    name: "move-lane-plan-json",
    command: moveIntoEpicDirCommand(".datum/lane-plan.json", o.epicDir, "lane-plan.json"),
    tolerant: true
  });
  steps.push({
    name: "commit",
    command: `git diff --cached --quiet || git commit -m ${q(`closeout(${o.runId}): archive pipeline artifacts to ${o.epicDir}`)}`,
    tolerant: true
  });
  steps.push({ name: "commit-sha", command: "git rev-parse --short HEAD", tolerant: true });
  return steps;
}

// skills/src/shared/commit-steps.ts
var q2 = (s) => `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
var NOTHING_TO_COMMIT = "NOTHING_TO_COMMIT";
function commitFilesSteps(o) {
  if (/co-authored-by|claude-session|signed-off-by/i.test(o.message)) {
    throw new Error(`commit message must not carry a trailer (policy): ${JSON.stringify(o.message)}`);
  }
  if (/["`$\\]/.test(o.message)) {
    throw new Error(`commit message must not contain quotes, backticks, $ or backslashes: ${JSON.stringify(o.message)}`);
  }
  if (o.files.length === 0) throw new Error("commitFilesSteps: no files to commit");
  const wt = q2(o.wt);
  const files = o.files.map(q2).join(" ");
  return [
    { name: "status", command: `git -C ${wt} status --porcelain -- ${files}`, tolerant: true },
    { name: "add", command: `git -C ${wt} add -- ${files}` },
    {
      name: "commit",
      command: `if git -C ${wt} diff --cached --quiet -- ${files}; then echo ${NOTHING_TO_COMMIT}; else git -C ${wt} commit -q -m ${q2(o.message)} -- ${files} && echo COMMITTED; fi`,
      tolerant: true
    },
    { name: "sha", command: `git -C ${wt} rev-parse --short HEAD`, tolerant: true }
  ];
}
function commitFilesFromSteps(result) {
  const none = { committed: false, nothingToCommit: false, sha: "", error: "" };
  if (result.missing) return { ...none, error: `commit_failed: batch returned no parseable result (${describeFailure(result, "commit")})` };
  const add = stepResult(result, "add");
  if (!add || add.exit_code !== 0) {
    return { ...none, error: `commit_failed: git add exited ${add ? add.exit_code : "without running"}: ${(add && (add.stderr || add.stdout) || "").trim().split("\n").slice(-3).join(" | ")}` };
  }
  const commit = stepResult(result, "commit");
  if (!commit) return { ...none, error: "commit_failed: commit step did not run" };
  const out = (commit.stdout || "").trim();
  if (out.split("\n").includes(NOTHING_TO_COMMIT)) return { ...none, nothingToCommit: true };
  if (commit.exit_code !== 0) {
    return { ...none, error: `commit_failed: git commit exited ${commit.exit_code}: ${(commit.stderr || commit.stdout || "").trim().split("\n").slice(-3).join(" | ")}` };
  }
  const sha = (stepStdout(result, "sha") || "").trim();
  if (!sha) return { ...none, error: "commit_failed: commit exited 0 but no sha was printed" };
  return { committed: true, nothingToCommit: false, sha, error: "" };
}

// skills/src/datum-closeout.ts
var COLLECTOR_STEPS = ["collect-git", "collect-tasks", "collect-token-metrics", "collate"];
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var runId = a.runId || "";
if (a.agentTypes && typeof a.agentTypes === "object") configureAgentTypes(a.agentTypes);
setBatchCacheKey(a.configFingerprint || "");
phase("Collect");
var collectSteps = closeoutCollectSteps({ runId });
var collectRaw = await agent(
  batchCommandPrompt(collectSteps),
  bootstrapOpts("cli", { label: "closeout-collect", model: model("fast") })
);
var collectResult = parseBatchResult(collectRaw, collectSteps);
for (const name of COLLECTOR_STEPS) {
  const step = collectResult.steps.find((s) => s.name === name);
  if (step && step.exit_code !== 0) {
    const tail = (step.stderr || step.stdout).trim().split("\n").slice(-5).join("\n");
    log(`[closeout] collector "${name}" exited ${step.exit_code}${tail ? ` \u2014 ${tail}` : ""}`);
  }
}
var branch = (stepStdout(collectResult, "branch") || "").trim();
var cfg = parseAgentJson(stepStdout(collectResult, "config") || "{}", {});
if (!(a.agentTypes && typeof a.agentTypes === "object")) configureAgentTypes({ agentTypes: cfg.agent_types !== false });
var rid = runId || (stepStdout(collectResult, "timestamp") || "").trim();
var dataExists = (stepStdout(collectResult, "data-exists") || "").trim() === "yes";
log(`Branch: ${branch}, run: ${rid}`);
if (!dataExists) {
  throw new Error(
    `Closeout: .datum/runs/${rid}/closeout-data.json is missing after collect \u2014 refusing to hand a synthesis agent a missing file. ${describeFailure(collectResult, "closeout-collect")}`
  );
}
phase("Synthesize");
var epicDir = `docs/epics/${branch}`;
var synthResult = await agent(
  renderPrompt(closeout_synthesize_default, { closeoutDataPath: `.datum/runs/${rid}/closeout-data.json`, branch, runId: rid }),
  { label: "synthesize", model: model("balanced") }
);
if (!synthResult) {
  throw new Error("agent_output_unparseable: synthesize \u2014 (no result)");
}
var synth = typeof synthResult === "string" ? parseAgentJsonStrict(synthResult, "synthesize") : synthResult;
log(`Closeout synthesis wrote: ${(synth?.artifacts_written || []).join(", ")}`);
var synthFiles = ["CURRENT_STATE.md", "CHANGELOG.md", `${epicDir}/RETRO.md`];
var synthCommitSteps = commitFilesSteps({ wt: ".", files: synthFiles, message: `closeout(${rid}): write CURRENT_STATE.md + CHANGELOG.md + RETRO.md` });
var synthCommit = commitFilesFromSteps(parseBatchResult(
  await agent(batchCommandPrompt(synthCommitSteps), stageOpts("cli", { label: "commit-synthesis", model: model("fast") })),
  synthCommitSteps
));
if (synthCommit.error) throw new Error(`closeout_commit_failed: ${synthCommit.error}`);
if (synthCommit.nothingToCommit) log(`Closeout artifacts unchanged since the last run \u2014 already committed (${synthFiles.join(", ")})`);
else log(`Closeout artifacts committed (${synthCommit.sha})`);
var archiveSteps = closeoutArchiveSteps({ runId: rid, branch, epicDir });
var archiveRaw = await agent(
  batchCommandPrompt(archiveSteps),
  stageOpts("cli", { label: "closeout-archive", model: model("fast") })
);
var archiveResult = parseBatchResult(archiveRaw, archiveSteps);
var filedRaw = stepStdout(archiveResult, "file-followups");
var filed = parseAgentJson(filedRaw || "", null);
if (!filed) log(`[closeout] follow-ups: filer returned no JSON (${(filedRaw || "").trim().slice(0, 120) || "nothing"})`);
else if (filed.skipped) log("[closeout] follow-ups: already filed for this run");
else {
  log(`[closeout] follow-ups: ${filed.filed ?? 0} filed, ${filed.retained ?? 0} retained in .datum/runs/${rid}/follow-ups.json${filed.tracker ? ` (tracker ${filed.tracker})` : ""}${filed.reason ? ` \u2014 ${filed.reason}` : ""}`);
  if ((filed.retained_below_threshold ?? 0) > 0) log(`[closeout] follow-ups: ${filed.retained_below_threshold} finding(s) below ${filed.min_severity || "high"} retained locally, not filed \u2014 see ${filed.manifest || `.datum/runs/${rid}/follow-ups.json`}`);
}
var archiveFailures = [];
for (const step of archiveResult.steps) {
  if (step.exit_code !== 0) {
    archiveFailures.push(step.name);
    const tail = (step.stderr || step.stdout).trim().split("\n").slice(-5).join("\n");
    log(`[closeout] archive step "${step.name}" exited ${step.exit_code}${tail ? ` \u2014 ${tail}` : ""}`);
  }
}
var commitStep = archiveResult.steps.find((s) => s.name === "commit");
var archived = !archiveResult.missing && !!commitStep && commitStep.exit_code === 0;
var archiveCommit = archived ? (stepStdout(archiveResult, "commit-sha") || "").trim() : "";
var housekeepStepList = housekeepSteps(branch);
var housekeep = housekeepFromSteps(parseBatchResult(
  await agent(batchCommandPrompt(housekeepStepList), stageOpts("cli", { label: "housekeep", model: model("fast") })),
  housekeepStepList
));
if (housekeep.ok) log(`housekeep: ${housekeep.summary || "done"}`);
else log(`housekeep: ${housekeep.error}`);
return {
  branch,
  runId: rid,
  artifacts: synth?.artifacts_written || [],
  followUps: synth?.follow_up_count || 0,
  archived,
  archiveCommit,
  archiveFailures,
  housekeepError: housekeep.error
};
