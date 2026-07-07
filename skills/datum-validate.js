// @generated — DO NOT EDIT. Source: skills/src/datum-validate.ts
export const meta = {
  name: "datum-validate",
  description: "Post-Act validation \u2014 full test suite, lint, AC completeness check",
  phases: [
    { title: "Validate", detail: "run tests, lint, AC coverage, gate" }
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
var DEFAULT_CONFIG = {
  language: "",
  test_framework: "",
  test_command: "",
  skills_dir: ""
};
var READ_CONFIG_PROMPT = `Read TWO config files and merge them (global defaults, repo overrides):
1. Global: ~/.datum/config.json (may not exist \u2014 skip if missing)
2. Repo: .datum/config.json (required \u2014 if missing, return {"error": "missing .datum/config.json \u2014 run datum init first"})
Merge: start with global, overlay repo on top (repo wins on conflict). For nested objects like "models", merge keys (repo overrides individual tiers).
Return the merged JSON. Output raw JSON only.`;

// skills/src/prompts/validate-check.md
var validate_check_default = 'Validation agent. Confirm the integrated result meets SPEC and PROPERTIES.\n\nWorking directory: {{wt}}\nSPEC path: {{specPath}}\nTASKS path: {{tasksPath}}\nTest command: {{testCommand}}\n\nSTEPS:\n1. Run the full test suite: {{testCommand}}\n   If any test fails \u2192 report immediately. Do not proceed.\n\n2. Run linter in check mode (detect from project: ruff, eslint, swiftlint, etc.)\n   If violations exist in files touched by this epic, auto-fix them.\n   Do NOT fix violations in untouched files.\n   Re-run tests after fixing.\n\n3. For each completed task in TASKS.md, verify its acceptance criteria have\n   corresponding passing tests. If an AC has no test \u2192 flag as a gap.\n\nReturn JSON:\n{\n  "tests_pass": true,\n  "test_count": N,\n  "lint_clean": true,\n  "lint_fixes": ["files that were auto-fixed"],\n  "ac_gaps": ["ACs with no corresponding test"],\n  "committed_fixes": true,\n  "commit_sha": "sha if lint fixes were committed"\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/util-run-gate.md
var util_run_gate_default = "Run: datum gate {{phase}}{{flags}}\nReturn the JSON output from the gate command. If the gate fails, return the failure JSON as-is.\nOutput raw JSON only.\n";

// skills/src/datum-validate.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
var cfgText = !a.testCommand ? await agent(READ_CONFIG_PROMPT, { label: "read-config", model: model("fast") }) : null;
var repoCfg = cfgText ? parseAgentJson(cfgText, { ...DEFAULT_CONFIG }) : {};
var testCommand = a.testCommand || repoCfg.test_command || DEFAULT_CONFIG.test_command;
phase("Validate");
var checkResult = await agent(
  `First: determine the branch with \`git rev-parse --abbrev-ref HEAD\` and set epic_dir to docs/epics/$(git rev-parse --abbrev-ref HEAD).

Then perform validation:
${renderPrompt(validate_check_default, {
    wt: ".",
    specPath: "docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md",
    tasksPath: "docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md",
    testCommand
  })}`,
  { label: "validate-check", model: model("balanced") }
);
var check = typeof checkResult === "string" ? parseAgentJson(checkResult, { tests_pass: false, test_count: 0, lint_clean: false, lint_fixes: [], ac_gaps: [] }) : checkResult;
log(`Tests: ${check?.tests_pass ? "PASS" : "FAIL"} (${check?.test_count || "?"} tests)`);
log(`Lint: ${check?.lint_clean ? "clean" : `${(check?.lint_fixes || []).length} files fixed`}`);
if (check?.ac_gaps?.length > 0) log(`AC gaps: ${check.ac_gaps.join("; ")}`);
var gatePassed = false;
if (!check?.tests_pass) {
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
  gatePassed
};
