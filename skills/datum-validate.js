// @generated — DO NOT EDIT. Source: skills/src/datum-validate.ts
export const meta = {
  name: "datum-validate",
  description: "Post-Act validation \u2014 full test suite, lint, AC completeness check",
  phases: [
    { title: "Validate", detail: "sync with main, run tests, lint, AC coverage, gate" }
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
function parseValidateArgs(raw) {
  const base = { yolo: false, noMergeMain: false };
  if (raw && typeof raw === "object") {
    const o = raw;
    return { ...base, ...o, yolo: !!o.yolo, noMergeMain: !!(o.noMergeMain ?? o["no-merge-main"]) };
  }
  if (typeof raw !== "string") return base;
  const text = raw.trim().replace(/^"|"$/g, "").trim();
  if (!text) return base;
  if (text.startsWith("{")) {
    try {
      return parseValidateArgs(JSON.parse(text));
    } catch {
      return base;
    }
  }
  const tokens = text.split(/\s+/).map((t) => t.toLowerCase());
  return {
    yolo: tokens.includes("yolo"),
    noMergeMain: tokens.includes("--no-merge-main") || tokens.includes("no-merge-main")
  };
}
function mainSyncPrompt(noMergeMain2) {
  const merge = noMergeMain2 ? `3. Do NOT merge. Return JSON: {"behind": <BEHIND>, "merged": false, "conflict": false}` : `3. If BEHIND is 0, return JSON: {"behind": 0, "merged": false, "conflict": false}
4. Otherwise run: git merge --no-edit origin/main > .datum/main-sync.log 2>&1; MERGE_EXIT=$?
   If MERGE_EXIT is 0, return JSON: {"behind": <BEHIND>, "merged": true, "conflict": false}
   If it is not 0, run: git merge --abort
   and return JSON: {"behind": <BEHIND>, "merged": false, "conflict": true, "output": "<last 20 lines of .datum/main-sync.log>"}`;
  return `Sync the epic branch with main before validating (#358). Run these commands in order at the repo root:
1. git fetch origin main
   If the fetch fails (no remote, no network), return JSON: {"error": "<stderr>"}
2. BEHIND=$(git rev-list --count HEAD..origin/main)
${merge}
Do not read the exit code through a pipe. Output raw JSON only, no markdown fences, no explanation.`;
}
function evaluateMainSync(result, noMergeMain2) {
  if (!result || typeof result !== "object" || typeof result.behind !== "number") {
    return { ok: false, message: `could not determine whether the epic is behind main: ${result?.error || "no sync result (git fetch origin main failed or returned unparseable output)"}` };
  }
  if (result.conflict) {
    return { ok: false, message: `merging origin/main into the epic branch hit a conflict (epic was ${result.behind} commits behind main); merge aborted \u2014 resolve by hand, then re-run validate: ${result.output || ""}`.trim() };
  }
  if (result.behind > 0 && !result.merged) {
    return {
      ok: false,
      message: noMergeMain2 ? `epic is ${result.behind} commits behind main \u2014 merge origin/main into the epic branch (or drop --no-merge-main) before validating` : `epic is ${result.behind} commits behind main and origin/main was not merged`
    };
  }
  return { ok: true, message: result.merged ? `merged origin/main into the epic branch (was ${result.behind} commits behind)` : "epic branch is up to date with main" };
}
function testRunCommand(testCommand2, wt, stage) {
  const logPath = `${wt}/.datum/test-output-${stage}.log`;
  return `mkdir -p "${wt}/.datum" && ( cd "${wt}" && ${testCommand2} ) > "${logPath}" 2>&1; TEST_EXIT=$?; tail -50 "${logPath}"; echo "TEST_EXIT=$TEST_EXIT"`;
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
var DEFAULT_CONFIG = {
  language: "",
  test_framework: "",
  test_command: "",
  skills_dir: "",
  context_files: [],
  /** #368: pass agentType on every mapped agent() call (off for runtimes without it). */
  agent_types: true,
  /** #368: written by `datum init` once the datum-* PreToolUse hooks are materialised. */
  hooks_installed: false
};
var READ_CONFIG_PROMPT = `Read TWO config files and merge them (global defaults, repo overrides):
1. Global: ~/.datum/config.json (may not exist \u2014 skip if missing)
2. Repo: .datum/config.json (required \u2014 if missing, return {"error": "missing .datum/config.json \u2014 run datum init first"})
Merge: start with global, overlay repo on top (repo wins on conflict). For nested objects like "models", merge keys (repo overrides individual tiers).
Return the merged JSON. Output raw JSON only.`;

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
function readAgentTypeConfig(cfg) {
  const o = cfg && typeof cfg === "object" ? cfg : {};
  return {
    agentTypes: o.agent_types !== false,
    hooksInstalled: o.hooks_installed === true
  };
}
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
function batchCommandPrompt(steps) {
  return 'Run exactly this script with the Bash tool in ONE invocation and return only its stdout, nothing else. Do not run the steps one at a time, do not retry or "fix" a failing step, do not ask for clarification, do not message anyone, do not summarise or explain \u2014 this prompt is the whole task. The script prints one JSON array (one object per step: name, exit_code, stdout, stderr); a non-zero exit_code is data to return, not a problem to solve.\n\n' + batchScript(steps);
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
  if (!Array.isArray(arr)) return { steps: [], failed: null, missing: true };
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
function describeFailure(r, label) {
  if (r.missing) return `${label}: batch agent returned no parseable result`;
  if (!r.failed) return `${label}: ok`;
  const tail = (r.failed.stderr || r.failed.stdout).trim().split("\n").slice(-5).join("\n");
  return `${label}: step "${r.failed.name}" exited ${r.failed.exit_code}${tail ? ` \u2014 ${tail}` : ""}`;
}

// skills/src/shared/lane-steps.ts
function testExitCode(stdout) {
  if (!stdout) return null;
  const matches = [...stdout.matchAll(/TEST_EXIT=(\d+)/g)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]);
}

// skills/src/prompts/validate-check.md
var validate_check_default = 'Validation agent. Confirm the integrated result meets SPEC and PROPERTIES.\n\nWorking directory: {{wt}}\nSPEC path: {{specPath}}\nTASKS path: {{tasksPath}}\nTest command: {{testCommand}}\n\nSTEPS:\n1. Run the full test suite with exactly this command: {{testRunCmd}}\n   It writes the full output to a log file, prints the last 50 lines and then `TEST_EXIT=<code>`.\n   That code is the real exit status \u2014 never run {{testCommand}} through a pipe into tail, a pipe masks the exit code.\n   tests_pass is true ONLY if TEST_EXIT is 0. If TEST_EXIT is not 0 \u2192 report immediately. Do not proceed.\n\n2. Run linter in check mode (detect from project: ruff, eslint, swiftlint, etc.)\n   If violations exist in files touched by this epic, auto-fix them.\n   Do NOT fix violations in untouched files.\n   Re-run tests after fixing.\n\n3. For each completed task in TASKS.md, verify its acceptance criteria have\n   corresponding passing tests. If an AC has no test \u2192 flag as a gap.\n\nReturn JSON:\n{\n  "tests_pass": true,\n  "test_count": N,\n  "lint_clean": true,\n  "lint_fixes": ["files that were auto-fixed"],\n  "ac_gaps": ["ACs with no corresponding test"],\n  "committed_fixes": true,\n  "commit_sha": "sha if lint fixes were committed"\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/util-run-gate.md
var util_run_gate_default = "Run: datum gate {{phase}}{{flags}}\nReturn the JSON output from the gate command. If the gate fails, return the failure JSON as-is.\nOutput raw JSON only.\n";

// skills/src/datum-validate.ts
var a = parseValidateArgs(args);
var yolo = a.yolo;
var noMergeMain = a.noMergeMain;
var cfgText = !a.testCommand ? await agent(READ_CONFIG_PROMPT, stageOpts("reader", { label: "read-config", model: model("fast") })) : null;
var repoCfg = cfgText ? parseAgentJson(cfgText, { ...DEFAULT_CONFIG }) : {};
configureAgentTypes(a.agentTypes && typeof a.agentTypes === "object" ? a.agentTypes : readAgentTypeConfig(repoCfg));
var testCommand = a.testCommand || repoCfg.test_command || DEFAULT_CONFIG.test_command;
phase("Validate");
var syncRaw = await agent(mainSyncPrompt(noMergeMain), stageOpts("cli", { label: "main-sync", model: model("fast") }));
var syncResult = typeof syncRaw === "string" ? parseAgentJson(syncRaw, null) : syncRaw;
var mainSync = evaluateMainSync(syncResult, noMergeMain);
if (!mainSync.ok) {
  log(`VALIDATION FAILED \u2014 ${mainSync.message}`);
} else {
  log(`Main sync: ${mainSync.message}`);
}
var checkResult = !mainSync.ok ? null : await agent(
  `First: determine the branch with \`git rev-parse --abbrev-ref HEAD\` and set epic_dir to docs/epics/$(git rev-parse --abbrev-ref HEAD).

Then perform validation:
${renderPrompt(validate_check_default, {
    wt: ".",
    specPath: "docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md",
    tasksPath: "docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md",
    testCommand,
    testRunCmd: testRunCommand(testCommand, ".", "validate")
  })}`,
  { label: "validate-check", model: model("balanced") }
);
var check = typeof checkResult === "string" ? parseAgentJson(checkResult, { tests_pass: false, test_count: 0, lint_clean: false, lint_fixes: [], ac_gaps: [] }) : checkResult;
var verifySteps = [{ name: "test-verify", command: testRunCommand(testCommand, ".", "validate-verify") }];
var verifyRaw = !mainSync.ok ? null : await agent(
  batchCommandPrompt(verifySteps),
  stageOpts("cli", { label: "validate-verify", phase: "Validate", model: model("fast") })
);
var verifyResult = parseBatchResult(verifyRaw, verifySteps);
var testExit = mainSync.ok ? testExitCode(stepStdout(verifyResult, "test-verify")) : null;
var testsPassed = testExit === 0;
log(`Tests: ${testsPassed ? "PASS" : "FAIL"} (independent run exit=${testExit === null ? "n/a" : testExit}; agent self-report tests_pass=${!!check?.tests_pass}, ${check?.test_count || "?"} tests)`);
log(`Lint: ${check?.lint_clean ? "clean" : `${(check?.lint_fixes || []).length} files fixed`}`);
if (check?.ac_gaps?.length > 0) log(`AC gaps: ${check.ac_gaps.join("; ")}`);
var gatePassed = false;
if (!mainSync.ok) {
  log("Validate gate skipped \u2014 epic branch is not in sync with main.");
} else if (testExit === null) {
  log(`VALIDATION FAILED \u2014 validate_run_failed: independent test run did not execute (${describeFailure(verifyResult, "test-verify")}). Cannot proceed.`);
} else if (testExit !== 0) {
  log(`VALIDATION FAILED \u2014 tests are red (independent run exited ${testExit}${check?.tests_pass ? ", despite agent self-report of tests_pass=true" : ""}). Cannot proceed.`);
} else {
  const gateResult = await agent(
    renderPrompt(util_run_gate_default, { phase: "validate", flags: yolo ? " --approve" : "" }),
    stageOpts("cli", { label: "gate", model: model("fast") })
  );
  const gate = typeof gateResult === "string" ? parseAgentJson(gateResult, { passed: false }) : gateResult;
  gatePassed = !!gate?.passed;
  if (gate?.passed) log("Validate gate PASSED");
  else log(`Validate gate: ${gate?.message || "needs review"}`);
}
return {
  testsPassed,
  testExitCode: testExit,
  lintClean: !!check?.lint_clean,
  acGaps: check?.ac_gaps || [],
  gatePassed,
  mainSync: { ok: mainSync.ok, behind: syncResult?.behind ?? null, merged: !!syncResult?.merged, message: mainSync.message }
};
