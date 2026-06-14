// @generated — DO NOT EDIT. Source: skills/src/datum-properties.ts
export const meta = {
  name: "datum-properties",
  description: "Derive PROPERTIES.md \u2014 11-category invariants with task traceability",
  phases: [
    { title: "Read", detail: "read SPEC.md + TASKS.md" },
    { title: "Derive", detail: "map requirements to testable properties across 11 categories" },
    { title: "Gate", detail: "validate coverage and traceability" }
  ]
};

// skills/src/shared/utils.ts
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
}

// skills/src/prompts/properties-derive.md
var properties_derive_default = "Properties deriver. Map every SPEC requirement to testable invariants across 11 categories.\n\nSPEC content:\n{{specContent}}\n\nTASKS (for traceability):\n{{tasksContent}}\n\nPROPERTY CATEGORIES:\n1. SAFETY \u2014 what must NEVER happen\n2. LIVENESS \u2014 what must EVENTUALLY happen\n3. INVARIANT \u2014 what must ALWAYS be true\n4. BOUNDARY \u2014 valid input ranges\n5. IDEMPOTENT \u2014 what is safe to run twice\n6. ORDERING \u2014 order invariants\n7. ISOLATION \u2014 what cannot leak between contexts\n8. PERFORMANCE \u2014 latency/throughput/size bounds\n9. SECURITY \u2014 access controls\n10. OBSERVABILITY \u2014 what must be logged or measured\n11. COMPATIBILITY \u2014 existing behavior that must be preserved\n\nFor each requirement in the SPEC, derive at least one property from each applicable category.\nFormat: PROPERTY(TYPE-NNN): <testable predicate>\n\nThen build a traceability table mapping each property to the task(s) that must prove it.\nEvery task must have at least one property. If a task has no testable property, flag it.\n\nReturn the full PROPERTIES.md content as markdown with:\n1. Property list grouped by category\n2. Traceability table: Property ID | Category | Predicate | Task IDs\n3. Per-task property assignments\n\nOutput as markdown. No JSON wrapping.\n";

// skills/src/prompts/util-read-context.md
var util_read_context_default = 'Return a JSON object with:\n1. "branch": output of `git rev-parse --abbrev-ref HEAD`\n2. "epic_dir": "docs/epics/" + the branch name\n{{extraFields}}\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/util-commit-artifact.md
var util_commit_artifact_default = 'Write this content to "{{artifactPath}}" (create parent dirs if needed).\n{{extraCommands}}\nCommit: git add {{gitAddPaths}} && git commit -m "{{commitMessage}}"\n\nCONTENT:\n{{content}}\n';

// skills/src/prompts/util-run-gate.md
var util_run_gate_default = "Run: datum gate {{phase}}{{flags}}\nReturn the JSON output from the gate command. If the gate fails, return the failure JSON as-is.\nOutput raw JSON only.\n";

// skills/src/datum-properties.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
phase("Read");
var context = await agent(
  renderPrompt(util_read_context_default, {
    extraFields: `3. "spec_content": full contents of docs/epics/<branch>/SPEC.md
4. "tasks_content": full contents of TASKS.md`
  }),
  { label: "read-inputs", model: "haiku" }
);
var ctx = typeof context === "string" ? JSON.parse(context.replace(/```[a-z]*\n?/g, "").trim()) : context;
if (!ctx.spec_content) throw new Error("SPEC.md not found. Run datum-refine first.");
if (!ctx.tasks_content) throw new Error("TASKS.md not found. Run datum-plan first.");
log(`Branch: ${ctx.branch}, SPEC: ${ctx.spec_content.split("\n").length} lines, TASKS: ${ctx.tasks_content.split("\n").length} lines`);
phase("Derive");
var propertiesContent = await agent(
  renderPrompt(properties_derive_default, {
    specContent: ctx.spec_content,
    tasksContent: ctx.tasks_content
  }),
  { label: "derive-properties", model: "sonnet" }
);
var propsPath = `${ctx.epic_dir}/PROPERTIES.md`;
await agent(
  renderPrompt(util_commit_artifact_default, {
    artifactPath: propsPath,
    extraCommands: 'Also copy to root: write the same content to "PROPERTIES.md".',
    gitAddPaths: `"${propsPath}" PROPERTIES.md`,
    commitMessage: "properties: derive PROPERTIES.md",
    content: propertiesContent
  }),
  { label: "commit-properties", model: "haiku" }
);
log(`PROPERTIES.md written to ${propsPath} + root`);
phase("Gate");
var gateResult = await agent(
  renderPrompt(util_run_gate_default, {
    phase: "properties",
    flags: yolo ? " --approve" : ""
  }),
  { label: "gate-properties", model: "haiku" }
);
var gate = typeof gateResult === "string" ? JSON.parse(gateResult.replace(/```[a-z]*\n?/g, "").trim()) : gateResult;
if (gate?.passed) log("Properties gate PASSED");
else log(`Properties gate: ${gate?.message || "needs review"}`);
return {
  branch: ctx.branch,
  gatePassed: !!gate?.passed
};
