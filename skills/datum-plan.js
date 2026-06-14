// @generated — DO NOT EDIT. Source: skills/src/datum-plan.ts
export const meta = {
  name: "datum-plan",
  description: "Decompose SPEC.md into tasks.json + lane-plan.json \u2014 approach, impact, decompose, triage, deepen",
  phases: [
    { title: "Read", detail: "read SPEC.md, CURRENT_STATE.md, prior failures" },
    { title: "Approach", detail: "propose 2-3 approaches, pick simplest in yolo mode" },
    { title: "Impact", detail: "blast radius analysis on affected files" },
    { title: "Decompose", detail: "break SPEC into tasks with ACs, files, deps, RED notes" },
    { title: "Build", detail: "write tasks.json, run datum lane-plan, commit artifacts" },
    { title: "Triage", detail: "evaluate plan complexity \u2014 route to deepen or skip" },
    { title: "Deepen", detail: "gather codebase evidence for complex tasks (conditional)" },
    { title: "Gate", detail: "run datum gate plan" }
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

// skills/src/prompts/plan-approaches.md
var plan_approaches_default = 'Architect. Read the SPEC and propose 2-3 implementation approaches.\n\nSPEC content:\n{{specContent}}\n\nCodebase context (CURRENT_STATE.md):\n{{currentState}}\n\nFor each approach:\n- One-sentence strategy description\n- Key tradeoffs (speed vs safety, complexity vs flexibility)\n- Which existing modules/files it touches most\n- Estimated task count and blast radius (low/medium/high)\n\nReturn JSON:\n{\n  "approaches": [\n    {\n      "name": "approach name",\n      "description": "one sentence",\n      "tradeoffs": "what you gain / give up",\n      "modules_touched": ["file1.py", "file2.py"],\n      "estimated_tasks": 3,\n      "blast_radius": "low|medium|high"\n    }\n  ],\n  "recommended": 0,\n  "recommendation_reason": "why this approach is simplest/safest"\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/plan-decompose.md
var plan_decompose_default = `Task decomposer. Break the SPEC into implementation tasks for the TDD pipeline.

SPEC content:
{{specContent}}

Chosen approach:
{{chosenApproach}}

Codebase scan (files, patterns, test conventions):
{{scanContext}}

Prior failure patterns:
{{priorFailures}}

RULES:
- Each task maps to one lane in the TDD pipeline
- Use DESCRIPTIVE task IDs (e.g. "add-cycle-detection", "validate-input-schema") not "task-001"
- No task touches more than 5 files
- Tasks sharing files must have a dependency edge or be in the same lane
- Every task needs: title, acceptance_criteria, files, depends_on, red_note
- ACs must be specific enough to write a failing test from \u2014 function names, expected values, exception types
- red_note tells the RED agent what the failing test should prove
- depends_on lists task IDs this task requires to be completed first

Return JSON matching this schema:
[
  {
    "id": "descriptive-task-id",
    "title": "Human-readable title",
    "description": "What this task implements",
    "acceptance_criteria": [
      "function_name(input) returns expected_output",
      "function_name(bad_input) raises SpecificError with 'message'"
    ],
    "files": ["module/file.py", "tests/test_file.py"],
    "depends_on": [],
    "introduces_stubs": false,
    "red_note": "The failing test must call function_name with input and assert on the return value",
    "estimated_loc": 50
  }
]

Output raw JSON only. No markdown fences.
`;

// skills/src/prompts/plan-impact.md
var plan_impact_default = `Impact analyzer. For each module/file the SPEC will change, assess blast radius.

Working directory: {{wt}}
Files to analyze:
{{filesList}}

For each file:
1. Find all callers/importers (grep for imports, function references)
2. Count how many other modules depend on this file
3. Check if it's covered by existing tests
4. Assess risk: will changing this break other things?

Return JSON:
{
  "files": [
    {
      "path": "module/file.py",
      "callers": ["other/module.py", "cli.py"],
      "caller_count": 2,
      "has_tests": true,
      "test_files": ["tests/test_file.py"],
      "risk": "low|medium|high",
      "notes": "why this risk level"
    }
  ],
  "high_risk_files": ["files with risk=high that need isolated lanes"]
}

Output raw JSON only. No markdown fences.
`;

// skills/src/prompts/plan-triage.md
var plan_triage_default = 'Triage agent. Read the plan and decide if deep codebase research is needed before Act.\n\nRead TASKS.md in the working directory.\n\nEVALUATE against this rubric:\n1. Does the plan modify security, authentication, or core data models?\n2. Does any task touch more than 3 files or span multiple domains?\n3. Does it introduce a new dependency?\n4. Does it require adhering to existing, complex architectural patterns?\n\nROUTING:\n- If ANY of these are true \u2192 "deepen" (gather codebase evidence first)\n- If ALL are false (trivial changes, simple additions, isolated modules) \u2192 "properties"\n\nReturn JSON:\n{\n  "decision": "deepen|properties",\n  "reason": "one sentence justification",\n  "triggers": ["which rubric items triggered deepen, if any"]\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/plan-deepen.md
var plan_deepen_default = 'Evidence gatherer. Ground the plan in codebase reality by researching each complex task.\n\nRead TASKS.md, then for each task that touches non-trivial logic:\n\n1. Search the codebase for existing implementations of similar logic\n2. Identify project conventions (how this pattern is usually handled here)\n3. Find known pitfalls in related code (error handling patterns, edge cases)\n4. Check test conventions in the relevant test directories\n\nUse headroom_compress on large files. Query-retrieve specific sections as needed.\n\nTOOLS (in preference order):\n- GitNexus (gitnexus_context, gitnexus_query) if available\n- grep/find for pattern matching\n- Read files directly for short modules\n\nAPPEND a single section to the end of TASKS.md titled exactly `## Research Findings`.\nGroup findings by task ID. Keep it concise \u2014 patterns and pitfalls, not full file dumps.\n\nFormat:\n```markdown\n## Research Findings\n\n### task-id: Task Title\n- **Pattern**: See `module/file.py:45` for existing approach\n- **Convention**: This codebase uses X pattern for Y\n- **Pitfall**: Known issue with Z \u2014 handle via W\n```\n\nCRITICAL: Do NOT modify existing task content. Append-only to TASKS.md.\n\nAfter appending, commit: git add TASKS.md && git commit -m "plan: deepen \u2014 research findings"\n\nReturn JSON: {"tasks_researched": N, "findings_count": N}\nOutput raw JSON only. No markdown fences.\n';

// skills/src/datum-plan.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
phase("Read");
var context = await agent(
  `Run these commands and return ONLY a JSON object:
1. "branch": output of \`git rev-parse --abbrev-ref HEAD\`
2. "epic_dir": "docs/epics/" + the branch name
3. Read docs/epics/<branch>/SPEC.md \u2014 return full contents as "spec_content"
4. Read CURRENT_STATE.md if it exists \u2014 return first 80 lines as "current_state", else null
5. Run: jq -r '.brief_defects[]? | "\\(.surfaced_by_stage)\\t\\(.missing_ac)"' .datum/runs/*/closeout-data.json 2>/dev/null \u2014 return as "prior_defects" string, empty if none
6. Read .datum/ERRORS.md if it exists \u2014 return first 40 lines as "error_history", else null
Output raw JSON only. No markdown fences.`,
  { label: "read-context", model: "sonnet" }
);
var ctx = typeof context === "string" ? parseAgentJson(context, {}) : context;
var epicDir = ctx.epic_dir || `docs/epics/${ctx.branch || "unknown"}`;
var specContent = ctx.spec_content || "";
if (!specContent) {
  throw new Error(`SPEC.md not found at ${epicDir}/SPEC.md. Run datum-refine first.`);
}
log(`Branch: ${ctx.branch}, SPEC: ${specContent.split("\n").length} lines`);
var priorFailures = [
  ctx.prior_defects || "",
  ctx.error_history || ""
].filter(Boolean).join("\n") || "(no prior failure data)";
phase("Approach");
var approachesRaw = await agent(
  renderPrompt(plan_approaches_default, {
    specContent,
    currentState: ctx.current_state || "(not available)"
  }),
  { label: "propose-approaches", model: "sonnet" }
);
var approaches = typeof approachesRaw === "string" ? parseAgentJson(approachesRaw, { approaches: [], recommended: 0, recommendation_reason: "" }) : approachesRaw;
for (let i = 0; i < approaches.approaches.length; i++) {
  const ap = approaches.approaches[i];
  const marker = i === approaches.recommended ? " \u2190 recommended" : "";
  log(`Approach ${i}: ${ap.name} \u2014 ~${ap.estimated_tasks} tasks, ${ap.blast_radius} risk${marker}`);
}
var chosen = approaches.approaches[approaches.recommended] || approaches.approaches[0];
log(`Selected: ${chosen.name} \u2014 ${approaches.recommendation_reason}`);
phase("Impact");
var allFiles = chosen.modules_touched || [];
var filesList = allFiles.length > 0 ? allFiles.join("\n") : specContent;
var impactRaw = await agent(
  renderPrompt(plan_impact_default, { wt: ".", filesList }),
  { label: "impact-analysis", model: "sonnet" }
);
var impactStr = typeof impactRaw === "string" ? impactRaw : JSON.stringify(impactRaw);
log("Impact analysis complete");
phase("Decompose");
var isComplex = chosen.blast_radius === "high" || (chosen.estimated_tasks || 0) > 5 || specContent.includes("clusters_touched: ") && parseInt(specContent.match(/clusters_touched:\s*(\d+)/)?.[1] || "0") > 3;
var decomposeModel = isComplex ? "opus" : "sonnet";
if (isComplex) log("Complex epic detected \u2014 using opus for decomposition");
var tasksRaw = await agent(
  renderPrompt(plan_decompose_default, {
    specContent,
    chosenApproach: JSON.stringify(chosen),
    scanContext: impactStr,
    priorFailures
  }),
  { label: "decompose-tasks", model: decomposeModel }
);
var tasks = typeof tasksRaw === "string" ? parseAgentJson(tasksRaw, []) : tasksRaw;
var tasksJson = JSON.stringify(tasks);
log(`Decomposed into ${tasks.length} tasks`);
for (const task of tasks) {
  const deps = task.depends_on?.length > 0 ? ` (depends: ${task.depends_on.join(", ")})` : "";
  log(`  ${task.id}: ${task.title}${deps}`);
}
phase("Build");
await agent(
  `Write this JSON to "tasks.json" in the repo root. Create the file if it doesn't exist.
Then commit: git add tasks.json && git commit -m "plan: write tasks.json"

JSON CONTENT:
${tasksJson}`,
  { label: "write-tasks-json", model: "haiku" }
);
var lanePlanResult = await agent(
  `Run these commands in sequence:
1. datum lane-plan --input tasks.json --output .datum/lane-plan.json --md-output TASKS.md
2. Copy artifacts to epic dir:
   mkdir -p "${epicDir}"
   cp TASKS.md "${epicDir}/TASKS.md"
   cp tasks.json "${epicDir}/tasks.json"
3. Commit: git add TASKS.md tasks.json .datum/lane-plan.json "${epicDir}/TASKS.md" "${epicDir}/tasks.json" && git commit -m "plan: build lane-plan.json + TASKS.md"
4. Return the exit code from step 1 as JSON: {"exit_code": N, "error": "stderr if any"}
Output raw JSON only.`,
  { label: "build-lane-plan", model: "haiku" }
);
var lpResult = typeof lanePlanResult === "string" ? parseAgentJson(lanePlanResult, { exit_code: 1, error: "parse failure" }) : lanePlanResult;
if (lpResult?.exit_code && lpResult.exit_code !== 0) {
  log(`lane-plan failed: ${lpResult.error || "unknown"}`);
  throw new Error(`datum lane-plan failed: ${lpResult.error}`);
}
log("tasks.json + lane-plan.json + TASKS.md written and committed");
phase("Triage");
var triageRaw = await agent(
  plan_triage_default,
  { label: "triage-decision", model: "haiku" }
);
var triage = typeof triageRaw === "string" ? parseAgentJson(triageRaw, { decision: "skip", reason: "parse failure", triggers: [] }) : triageRaw;
await agent(
  `Write this JSON to ".datum/routing.json":
${JSON.stringify(triage, null, 2)}
Then commit: git add .datum/routing.json && git commit -m "plan: triage \u2014 ${triage.decision}"`,
  { label: "write-routing", model: "haiku" }
);
log(`Triage: ${triage.decision} \u2014 ${triage.reason}`);
if (triage.triggers?.length > 0) {
  log(`  triggers: ${triage.triggers.join(", ")}`);
}
if (triage.decision === "deepen") {
  phase("Deepen");
  const deepenRaw = await agent(
    plan_deepen_default,
    { label: "deepen-research", model: "sonnet" }
  );
  const deepen = typeof deepenRaw === "string" ? parseAgentJson(deepenRaw, { tasks_researched: 0, findings_count: 0 }) : deepenRaw;
  log(`Deepen: researched ${deepen?.tasks_researched || "?"} tasks, ${deepen?.findings_count || "?"} findings`);
  await agent(
    `Run: datum lane-plan --input tasks.json --output .datum/lane-plan.json --md-output TASKS.md
Copy updated TASKS.md: cp TASKS.md "${epicDir}/TASKS.md"
Commit: git add TASKS.md .datum/lane-plan.json "${epicDir}/TASKS.md" && git commit -m "plan: rebuild after deepen"
Return JSON: {"exit_code": 0}`,
    { label: "rebuild-after-deepen", model: "haiku" }
  );
} else {
  log("Deepen skipped \u2014 plan is straightforward");
}
phase("Gate");
var gateFlag = yolo ? " --approve" : "";
var gateResult = await agent(
  `Run: datum gate plan${gateFlag}
Return the JSON output from the gate command. If the gate fails, return the failure JSON as-is.
Output raw JSON only.`,
  { label: "gate-plan", model: "haiku" }
);
var gate = typeof gateResult === "string" ? parseAgentJson(gateResult, { passed: false, message: "parse failure" }) : gateResult;
if (gate?.passed) {
  log("Plan gate PASSED");
} else {
  log(`Plan gate: ${gate?.message || "needs human approval"}`);
}
return {
  branch: ctx.branch,
  epicDir,
  approach: chosen.name,
  taskCount: tasks.length,
  tasks: tasks.map((t) => ({ id: t.id, title: t.title })),
  gatePassed: !!gate?.passed,
  gateMessage: gate?.message || ""
};
