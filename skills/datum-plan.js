// @generated — DO NOT EDIT. Source: skills/src/datum-plan.ts
export const meta = {
  name: "datum-plan",
  description: "Decompose SPEC.md into tasks.json + lane-plan.json \u2014 approach, impact, decompose, triage, deepen",
  phases: [
    { title: "Read", detail: "read SPEC.md, CURRENT_STATE.md, prior failures" },
    { title: "Decompose", detail: "approach \u2192 impact \u2192 tasks \u2192 build lane-plan" },
    { title: "Triage", detail: "evaluate complexity, deepen if needed, gate" }
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

// skills/src/shared/tracker.ts
async function publishLanePlan(lanePlanPath, epicTitle) {
  const result = await agent(
    `Run: datum plan-issues --lane-plan "${lanePlanPath}" --title "${epicTitle}"
Return the JSON output. If the command fails, return {"error": "<message>"}.
Output raw JSON only.`,
    { label: "publish-issues", model: "haiku" }
  );
  if (!result) return null;
  const parsed = typeof result === "string" ? JSON.parse(result.replace(/```[a-z]*\n?/g, "").trim()) : result;
  if (parsed?.error) {
    log(`[tracker] publish failed: ${parsed.error}`);
    return null;
  }
  return {
    epicId: String(parsed.epic_number || ""),
    taskIds: Object.fromEntries(
      Object.entries(parsed.task_issues || {}).map(([k, v]) => [k, String(v)])
    )
  };
}

// skills/src/prompts/plan-approaches.md
var plan_approaches_default = 'Architect. Read the SPEC and propose 2-3 implementation approaches.\n\nSPEC content:\n{{specContent}}\n\nCodebase context (CURRENT_STATE.md):\n{{currentState}}\n\nFor each approach:\n- One-sentence strategy description\n- Key tradeoffs (speed vs safety, complexity vs flexibility)\n- Which existing modules/files it touches most\n- Estimated task count and blast radius (low/medium/high)\n\nReturn JSON:\n{\n  "approaches": [\n    {\n      "name": "approach name",\n      "description": "one sentence",\n      "tradeoffs": "what you gain / give up",\n      "modules_touched": ["src/module/file1", "src/module/file2"],\n      "estimated_tasks": 3,\n      "blast_radius": "low|medium|high"\n    }\n  ],\n  "recommended": 0,\n  "recommendation_reason": "why this approach is simplest/safest"\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/plan-decompose.md
var plan_decompose_default = 'Task decomposer. Break the SPEC into implementation tasks for the TDD pipeline.\n\nSPEC content:\n{{specContent}}\n\nChosen approach:\n{{chosenApproach}}\n\nLanguage: {{language}}\nTest framework: {{testFramework}}\n\nCodebase scan (files, patterns, test conventions):\n{{scanContext}}\n\nPrior failure patterns:\n{{priorFailures}}\n\nRULES:\n- Each task maps to one lane in the TDD pipeline\n- Use DESCRIPTIVE task IDs (e.g. "add-cycle-detection", "validate-input-schema") not "task-001"\n- No task touches more than 5 files\n- The \'files\' array MUST list EVERY file the implementation agent will need to create or modify \u2014 not just the primary target. Omitting a file causes a file_ownership_violation at GREEN. When in doubt, include the file. Check the codebase scan for all files in the affected module.\n- Tasks sharing files must have a dependency edge or be in the same lane\n- Each lane MUST have its own unique test file(s). Never assign the same test file to multiple lanes. If multiple tasks target the same module (e.g. `module/foo`), split tests per lane: `tests/test_foo_create`, `tests/test_foo_validate`, etc. This prevents reflect score pollution from cross-lane test accumulation.\n- Every task needs: title, acceptance_criteria, files, reads, depends_on, red_note\n- ACs must be specific enough to write a failing test from \u2014 function names, expected values, exception types\n- red_note tells the RED agent what the failing test should prove \u2014 use the project\'s language and test framework, not Python/pytest unless that IS the project language\n- depends_on lists task IDs this task requires to be completed first\n- reads lists files this task\'s implementation READS but does NOT modify (e.g. a protocol/contract file another lane owns). If a task reads a file another lane writes, it must either list that file in reads (so a dependency edge is auto-injected) or add an explicit depends_on \u2014 otherwise the reader may run before the writer produces that file.\n\nReturn JSON matching this schema:\n[\n  {\n    "id": "descriptive-task-id",\n    "title": "Human-readable title",\n    "description": "What this task implements",\n    "acceptance_criteria": [\n      "function_name(input) returns expected_output",\n      "function_name(bad_input) raises SpecificError with \'message\'"\n    ],\n    "files": ["src/module/file", "tests/test_file"],\n    "reads": [],\n    "depends_on": [],\n    "introduces_stubs": false,\n    "red_note": "The failing test must call function_name with input and assert on the return value",\n    "estimated_loc": 50\n  }\n]\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/plan-impact.md
var plan_impact_default = 'Impact analyzer. For each module/file the SPEC will change, assess blast radius.\n\nWorking directory: {{wt}}\nFiles to analyze:\n{{filesList}}\n\nTOOLS (use in preference order):\n1. `ast-grep --pattern \'<function_name>($$$)\' .` \u2014 find all callers structurally\n2. `scc --no-cocomo <file>` \u2014 LOC and complexity for a specific file\n3. GitNexus (gitnexus_impact) if available\n4. grep as fallback\n\nFor each file:\n1. Use ast-grep to find all callers/importers (structural, not string match)\n2. Run `scc --no-cocomo <file>` to get LOC and complexity\n3. Check if it\'s covered by existing tests (ast-grep for test functions referencing it)\n4. Assess risk from caller count + complexity\n\nReturn JSON:\n{\n  "files": [\n    {\n      "path": "src/module/file",\n      "loc": 150,\n      "callers": ["src/other/module", "src/cli"],\n      "caller_count": 2,\n      "has_tests": true,\n      "test_files": ["tests/test_file"],\n      "risk": "low|medium|high",\n      "notes": "why this risk level"\n    }\n  ],\n  "high_risk_files": ["files with risk=high that need isolated lanes"]\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/plan-triage.md
var plan_triage_default = 'Triage agent. Read the plan and decide if deep codebase research is needed before Act.\n\nRead TASKS.md in the working directory.\n\nEVALUATE against this rubric:\n1. Does the plan modify security, authentication, or core data models?\n2. Does any task touch more than 3 files or span multiple domains?\n3. Does it introduce a new dependency?\n4. Does it require adhering to existing, complex architectural patterns?\n\nROUTING:\n- If ANY of these are true \u2192 "deepen" (gather codebase evidence first)\n- If ALL are false (trivial changes, simple additions, isolated modules) \u2192 "properties"\n\nReturn JSON:\n{\n  "decision": "deepen|properties",\n  "reason": "one sentence justification",\n  "triggers": ["which rubric items triggered deepen, if any"]\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/plan-deepen.md
var plan_deepen_default = 'Evidence gatherer. Ground the plan in codebase reality by researching each complex task.\n\nRead TASKS.md, then for each task that touches non-trivial logic:\n\n1. Search the codebase for existing implementations of similar logic\n2. Identify project conventions (how this pattern is usually handled here)\n3. Find known pitfalls in related code (error handling patterns, edge cases)\n4. Check test conventions in the relevant test directories\n\nTOOLS (use in preference order):\n1. `ast-grep --pattern \'<pattern>\' .` \u2014 structural search (e.g. find all try/except, all class defs, all async functions)\n2. `headroom memory list` \u2014 check for relevant past learnings\n3. `headroom learn show` \u2014 check for past tool call failures relevant to these files\n4. GitNexus (gitnexus_context, gitnexus_query) if available\n5. grep/find for pattern matching\n\nUse headroom_compress on large files. Query-retrieve specific sections as needed.\n\nAPPEND a single section to the end of TASKS.md titled exactly `## Research Findings`.\nGroup findings by task ID. Keep it concise \u2014 patterns and pitfalls, not full file dumps.\n\nFormat:\n```markdown\n## Research Findings\n\n### task-id: Task Title\n- **Pattern**: See `module/file:45` for existing approach\n- **Convention**: This codebase uses X pattern for Y\n- **Pitfall**: Known issue with Z \u2014 handle via W\n- **Past failure**: headroom learn flagged <issue> in this area\n```\n\nCRITICAL: Do NOT modify existing task content. Append-only to TASKS.md.\n\nAfter appending, commit: git add TASKS.md && git commit -m "plan: deepen \u2014 research findings"\n\nReturn JSON: {"tasks_researched": N, "findings_count": N}\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/util-read-context.md
var util_read_context_default = `Return a JSON object with:
1. "branch": output of \`git rev-parse --abbrev-ref HEAD\`
2. "epic_dir": "docs/epics/" + the branch name
{{extraFields}}
If any field embeds full multi-line file contents, do NOT hand-type the JSON \u2014 build it programmatically with a command that guarantees correct escaping, e.g.:
\`python3 -c "import json; print(json.dumps({'branch': ..., 'epic_dir': ..., 'spec_content': open('path/SPEC.md').read(), ...}))"\`
Hand-escaping large files reliably produces invalid JSON (stray backslashes, unescaped control chars). Run that command, then output only its stdout \u2014 no markdown fences, no commentary.
`;

// skills/src/prompts/util-run-gate.md
var util_run_gate_default = "Run: datum gate {{phase}}{{flags}}\nReturn the JSON output from the gate command. If the gate fails, return the failure JSON as-is.\nOutput raw JSON only.\n";

// skills/src/datum-plan.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
phase("Read");
var context = await agent(
  renderPrompt(util_read_context_default, {
    extraFields: `3. "spec_content": full contents of docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md
4. "current_state": read CURRENT_STATE.md if it exists (first 80 lines), else null
5. "prior_defects": run \`jq -r '.brief_defects[]? | "\\(.surfaced_by_stage)\\t\\(.missing_ac)"' .datum/runs/*/closeout-data.json 2>/dev/null\` \u2014 return as string, empty if none
6. "error_history": read .datum/ERRORS.md if it exists (first 40 lines), else null`
  }),
  { label: "read-context", model: model("balanced") }
);
var ctx = typeof context === "string" ? parseAgentJson(context, {}) : context;
var epicDir = ctx.epic_dir || `docs/epics/${ctx.branch || "unknown"}`;
var specContent = ctx.spec_content || "";
if (!specContent) throw new Error(`SPEC.md not found at ${epicDir}/SPEC.md. Run datum-refine first.`);
log(`Branch: ${ctx.branch}, SPEC: ${specContent.split("\n").length} lines`);
var priorFailures = [ctx.prior_defects || "", ctx.error_history || ""].filter(Boolean).join("\n") || "(no prior failure data)";
var cfgText = await agent(READ_CONFIG_PROMPT, { label: "read-config", model: model("fast") });
var repoCfg = cfgText ? parseAgentJson(cfgText, { ...DEFAULT_CONFIG }) : { ...DEFAULT_CONFIG };
var language = repoCfg.language || DEFAULT_CONFIG.language;
var testFramework = repoCfg.test_framework || DEFAULT_CONFIG.test_framework;
phase("Decompose");
var approachesRaw = await agent(
  renderPrompt(plan_approaches_default, { specContent, currentState: ctx.current_state || "(not available)" }),
  { label: "propose-approaches", model: model("balanced") }
);
var approaches = parseAgentJson(approachesRaw, { approaches: [], recommended: 0, recommendation_reason: "" });
var chosen = approaches.approaches[approaches.recommended] || approaches.approaches[0];
log(`Selected: ${chosen?.name || "default"} \u2014 ${approaches.recommendation_reason}`);
var impactRaw = await agent(
  renderPrompt(plan_impact_default, { wt: ".", filesList: (chosen?.modules_touched || []).join("\n") || specContent }),
  { label: "impact-analysis", model: model("balanced") }
);
var impactStr = typeof impactRaw === "string" ? impactRaw : JSON.stringify(impactRaw);
var isComplex = chosen?.blast_radius === "high" || (chosen?.estimated_tasks || 0) > 5;
var decomposeModel = isComplex ? model("deep") : model("balanced");
if (isComplex) log("Complex epic \u2014 using opus for decomposition");
var tasksRaw = await agent(
  renderPrompt(plan_decompose_default, { specContent, chosenApproach: JSON.stringify(chosen), scanContext: impactStr, priorFailures, language, testFramework }),
  { label: "decompose-tasks", model: decomposeModel }
);
var tasks = typeof tasksRaw === "string" ? parseAgentJson(tasksRaw, []) : tasksRaw;
if (!Array.isArray(tasks) || tasks.length === 0) {
  throw new Error(`Task decomposition returned 0 tasks \u2014 refusing to write an empty lane plan. Raw output: ${String(tasksRaw).slice(0, 300)}`);
}
var tasksJson = JSON.stringify(tasks);
log(`Decomposed into ${tasks.length} tasks`);
for (const task of tasks) {
  const deps = task.depends_on?.length > 0 ? ` (depends: ${task.depends_on.join(", ")})` : "";
  log(`  ${task.id}: ${task.title}${deps}`);
}
await agent(
  `Do these steps in order:
1. mkdir -p "${epicDir}"
2. Write this JSON to "${epicDir}/tasks.json": ${tasksJson}
3. Run: datum lane-plan --input "${epicDir}/tasks.json" --output "${epicDir}/lane-plan.json" --md-output "${epicDir}/TASKS.md"
4. Commit: git add "${epicDir}/tasks.json" "${epicDir}/lane-plan.json" "${epicDir}/TASKS.md" && git commit -m "plan: tasks.json + lane-plan.json + TASKS.md"
If step 2 fails, return JSON: {"exit_code": 1, "error": "the stderr"}
Otherwise return: {"exit_code": 0}
Output raw JSON only.`,
  { label: "build-lane-plan", model: model("fast") }
);
log("Lane plan built and committed");
var skeletonDir = `${epicDir}/skeletons`;
await agent(
  `Run these commands in order:
1. mkdir -p "${skeletonDir}"
2. datum skeleton --batch --language ${language} --tasks "${epicDir}/lane-plan.json" --output-dir "${skeletonDir}"
3. git add "${skeletonDir}" && git commit -m "plan: pre-generate RED skeletons"
If step 2 fails, return JSON: {"exit_code": 1, "error": "the stderr"}
Otherwise return: {"exit_code": 0, "skeleton_dir": "${skeletonDir}"}
Output raw JSON only.`,
  { label: "skeleton-batch", model: model("fast") }
);
log(`Skeletons pre-generated in ${skeletonDir}`);
phase("Triage");
var triageRaw = await agent(
  plan_triage_default + `

ADDITIONAL TASK: After deciding, write your decision as JSON to ".datum/routing.json" and commit:
git add .datum/routing.json && git commit -m "plan: triage decision"`,
  { label: "triage-decision", model: model("fast") }
);
var triage = parseAgentJson(triageRaw, { decision: "properties", reason: "parse failure", triggers: [] });
log(`Triage: ${triage.decision} \u2014 ${triage.reason}`);
if (triage.decision === "deepen") {
  const deepenRaw = await agent(
    plan_deepen_default + `

ADDITIONAL TASK after appending Research Findings:
1. Run: datum lane-plan --input "${epicDir}/tasks.json" --output "${epicDir}/lane-plan.json" --md-output "${epicDir}/TASKS.md"
2. Commit: git add "${epicDir}/TASKS.md" "${epicDir}/lane-plan.json" && git commit -m "plan: deepen + rebuild"
Return JSON: {"tasks_researched": N, "findings_count": N}`,
    { label: "deepen-research", model: model("balanced") }
  );
  const deepen = parseAgentJson(deepenRaw, { tasks_researched: 0, findings_count: 0 });
  log(`Deepen: ${deepen.tasks_researched} tasks, ${deepen.findings_count} findings`);
} else {
  log("Deepen skipped");
}
var gateResult = await agent(
  renderPrompt(util_run_gate_default, { phase: "plan", flags: yolo ? " --approve" : "" }),
  { label: "gate", model: model("fast") }
);
var gate = typeof gateResult === "string" ? parseAgentJson(gateResult, { passed: false }) : gateResult;
if (gate?.passed) log("Plan gate PASSED");
else log(`Plan gate: ${gate?.message || "needs approval"}`);
var epicIssue;
if (gate?.passed) {
  const published = await publishLanePlan(`${epicDir}/lane-plan.json`, `[epic] ${ctx.branch}`);
  if (published) {
    epicIssue = published.epicId;
    log(`Published ${Object.keys(published.taskIds).length} task issues \u2192 epic #${epicIssue}`);
  }
}
return {
  branch: ctx.branch,
  epicDir,
  approach: chosen?.name,
  taskCount: tasks.length,
  tasks: tasks.map((t) => ({ id: t.id, title: t.title })),
  gatePassed: !!gate?.passed,
  gateMessage: gate?.message || ""
};
