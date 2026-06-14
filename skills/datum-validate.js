// @generated — DO NOT EDIT. Source: skills/src/datum-validate.ts
export const meta = {
  name: "datum-validate",
  description: "Post-Act validation \u2014 full test suite, lint, AC completeness check",
  phases: [
    { title: "Read", detail: "detect branch, test command, epic dir" },
    { title: "Validate", detail: "run tests, lint, check AC coverage" },
    { title: "Gate", detail: "run datum gate validate" }
  ]
};

// skills/src/shared/utils.ts
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
}

// skills/src/prompts/validate-check.md
var validate_check_default = 'Validation agent. Confirm the integrated result meets SPEC and PROPERTIES.\n\nWorking directory: {{wt}}\nSPEC path: {{specPath}}\nTASKS path: {{tasksPath}}\nTest command: {{testCommand}}\n\nSTEPS:\n1. Run the full test suite: {{testCommand}}\n   If any test fails \u2192 report immediately. Do not proceed.\n\n2. Run linter in check mode (detect from project: ruff, eslint, swiftlint, etc.)\n   If violations exist in files touched by this epic, auto-fix them.\n   Do NOT fix violations in untouched files.\n   Re-run tests after fixing.\n\n3. For each completed task in TASKS.md, verify its acceptance criteria have\n   corresponding passing tests. If an AC has no test \u2192 flag as a gap.\n\nReturn JSON:\n{\n  "tests_pass": true,\n  "test_count": N,\n  "lint_clean": true,\n  "lint_fixes": ["files that were auto-fixed"],\n  "ac_gaps": ["ACs with no corresponding test"],\n  "committed_fixes": true,\n  "commit_sha": "sha if lint fixes were committed"\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/util-read-context.md
var util_read_context_default = 'Return a JSON object with:\n1. "branch": output of `git rev-parse --abbrev-ref HEAD`\n2. "epic_dir": "docs/epics/" + the branch name\n{{extraFields}}\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/util-run-gate.md
var util_run_gate_default = "Run: datum gate {{phase}}{{flags}}\nReturn the JSON output from the gate command. If the gate fails, return the failure JSON as-is.\nOutput raw JSON only.\n";

// skills/src/datum-validate.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
var testCommand = a.testCommand || "uv run pytest -x -q";
phase("Read");
var context = await agent(
  renderPrompt(util_read_context_default, { extraFields: "" }),
  { label: "read-context", model: "haiku" }
);
var ctx = typeof context === "string" ? JSON.parse(context.replace(/```[a-z]*\n?/g, "").trim()) : context;
var epicDir = ctx.epic_dir || "docs/epics/unknown";
log(`Branch: ${ctx.branch}`);
phase("Validate");
var checkResult = await agent(
  renderPrompt(validate_check_default, {
    wt: ".",
    specPath: `${epicDir}/SPEC.md`,
    tasksPath: "TASKS.md",
    testCommand
  }),
  { label: "validate-check", model: "sonnet" }
);
var check = typeof checkResult === "string" ? JSON.parse(checkResult.replace(/```[a-z]*\n?/g, "").trim()) : checkResult;
log(`Tests: ${check?.tests_pass ? "PASS" : "FAIL"} (${check?.test_count || "?"} tests)`);
log(`Lint: ${check?.lint_clean ? "clean" : `${(check?.lint_fixes || []).length} files fixed`}`);
if (check?.ac_gaps?.length > 0) {
  log(`AC gaps: ${check.ac_gaps.join("; ")}`);
}
var gatePassed = false;
if (!check?.tests_pass) {
  log("VALIDATION FAILED \u2014 tests are red. Cannot proceed.");
} else {
  phase("Gate");
  const gateResult = await agent(
    renderPrompt(util_run_gate_default, {
      phase: "validate",
      flags: yolo ? " --approve" : ""
    }),
    { label: "gate-validate", model: "haiku" }
  );
  const gate = typeof gateResult === "string" ? JSON.parse(gateResult.replace(/```[a-z]*\n?/g, "").trim()) : gateResult;
  gatePassed = !!gate?.passed;
  if (gate?.passed) log("Validate gate PASSED");
  else log(`Validate gate: ${gate?.message || "needs review"}`);
}
return {
  branch: ctx.branch,
  testsPassed: !!check?.tests_pass,
  lintClean: !!check?.lint_clean,
  acGaps: check?.ac_gaps || [],
  gatePassed
};
