// @generated — DO NOT EDIT. Source: skills/src/datum-validate.ts
export const meta = {
  name: "datum-validate",
  description: "Post-Act validation \u2014 full test suite, lint, AC completeness check",
  phases: [
    { title: "Validate", detail: "sync with main, run tests, lint, AC coverage, gate" }
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
  context_files: []
};
var READ_CONFIG_PROMPT = `Read TWO config files and merge them (global defaults, repo overrides):
1. Global: ~/.datum/config.json (may not exist \u2014 skip if missing)
2. Repo: .datum/config.json (required \u2014 if missing, return {"error": "missing .datum/config.json \u2014 run datum init first"})
Merge: start with global, overlay repo on top (repo wins on conflict). For nested objects like "models", merge keys (repo overrides individual tiers).
Return the merged JSON. Output raw JSON only.`;

// skills/src/prompts/validate-check.md
var validate_check_default = 'Validation agent. Confirm the integrated result meets SPEC and PROPERTIES.\n\nWorking directory: {{wt}}\nSPEC path: {{specPath}}\nTASKS path: {{tasksPath}}\nTest command: {{testCommand}}\n\nSTEPS:\n1. Run the full test suite with exactly this command: {{testRunCmd}}\n   It writes the full output to a log file, prints the last 50 lines and then `TEST_EXIT=<code>`.\n   That code is the real exit status \u2014 never run {{testCommand}} through a pipe into tail, a pipe masks the exit code.\n   tests_pass is true ONLY if TEST_EXIT is 0. If TEST_EXIT is not 0 \u2192 report immediately. Do not proceed.\n\n2. Run linter in check mode (detect from project: ruff, eslint, swiftlint, etc.)\n   If violations exist in files touched by this epic, auto-fix them.\n   Do NOT fix violations in untouched files.\n   Re-run tests after fixing.\n\n3. For each completed task in TASKS.md, verify its acceptance criteria have\n   corresponding passing tests. If an AC has no test \u2192 flag as a gap.\n\nReturn JSON:\n{\n  "tests_pass": true,\n  "test_count": N,\n  "lint_clean": true,\n  "lint_fixes": ["files that were auto-fixed"],\n  "ac_gaps": ["ACs with no corresponding test"],\n  "committed_fixes": true,\n  "commit_sha": "sha if lint fixes were committed"\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/util-run-gate.md
var util_run_gate_default = "Run: datum gate {{phase}}{{flags}}\nReturn the JSON output from the gate command. If the gate fails, return the failure JSON as-is.\nOutput raw JSON only.\n";

// skills/src/datum-validate.ts
var a = parseValidateArgs(args);
var yolo = a.yolo;
var noMergeMain = a.noMergeMain;
var cfgText = !a.testCommand ? await agent(READ_CONFIG_PROMPT, { label: "read-config", model: model("fast") }) : null;
var repoCfg = cfgText ? parseAgentJson(cfgText, { ...DEFAULT_CONFIG }) : {};
var testCommand = a.testCommand || repoCfg.test_command || DEFAULT_CONFIG.test_command;
phase("Validate");
var syncRaw = await agent(mainSyncPrompt(noMergeMain), { label: "main-sync", model: model("fast") });
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
log(`Tests: ${check?.tests_pass ? "PASS" : "FAIL"} (${check?.test_count || "?"} tests)`);
log(`Lint: ${check?.lint_clean ? "clean" : `${(check?.lint_fixes || []).length} files fixed`}`);
if (check?.ac_gaps?.length > 0) log(`AC gaps: ${check.ac_gaps.join("; ")}`);
var gatePassed = false;
if (!mainSync.ok) {
  log("Validate gate skipped \u2014 epic branch is not in sync with main.");
} else if (!check?.tests_pass) {
  log("VALIDATION FAILED \u2014 tests are red. Cannot proceed.");
} else {
  const gateResult = await agent(
    renderPrompt(util_run_gate_default, { phase: "validate", flags: yolo ? " --approve" : "" }),
    { label: "gate", model: model("fast") }
  );
  const gate = typeof gateResult === "string" ? parseAgentJson(gateResult, { passed: false }) : gateResult;
  gatePassed = !!gate?.passed;
  if (gate?.passed) log("Validate gate PASSED");
  else log(`Validate gate: ${gate?.message || "needs review"}`);
}
return {
  testsPassed: !!check?.tests_pass,
  lintClean: !!check?.lint_clean,
  acGaps: check?.ac_gaps || [],
  gatePassed,
  mainSync: { ok: mainSync.ok, behind: syncResult?.behind ?? null, merged: !!syncResult?.merged, message: mainSync.message }
};
