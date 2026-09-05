// @generated — DO NOT EDIT. Source: skills/src/datum-properties.ts
export const meta = {
  name: "datum-properties",
  description: "Derive PROPERTIES.md \u2014 11-category invariants with task traceability",
  phases: [
    { title: "Read", detail: "read SPEC.md + TASKS.md" },
    { title: "Derive", detail: "map requirements to properties, write, commit, gate" }
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

// skills/src/prompts/properties-derive.md
var properties_derive_default = "Properties deriver. Map every SPEC requirement to testable invariants across 11 categories.\n\nSPEC content:\n{{specContent}}\n\nTASKS (for traceability):\n{{tasksContent}}\n\nPROPERTY CATEGORIES:\n1. SAFETY \u2014 what must NEVER happen\n2. LIVENESS \u2014 what must EVENTUALLY happen\n3. INVARIANT \u2014 what must ALWAYS be true\n4. BOUNDARY \u2014 valid input ranges\n5. IDEMPOTENT \u2014 what is safe to run twice\n6. ORDERING \u2014 order invariants\n7. ISOLATION \u2014 what cannot leak between contexts\n8. PERFORMANCE \u2014 latency/throughput/size bounds\n9. SECURITY \u2014 access controls\n10. OBSERVABILITY \u2014 what must be logged or measured\n11. COMPATIBILITY \u2014 existing behavior that must be preserved\n\nFor each requirement in the SPEC, derive at least one property from each applicable category.\nFormat: PROPERTY(TYPE-NNN): <testable predicate>\n\nThen build a traceability table mapping each property to the task(s) that must prove it.\nEvery task must have at least one property. If a task has no testable property, flag it.\n\nReturn the full PROPERTIES.md content as markdown with:\n1. Property list grouped by category\n2. Traceability table: Property ID | Category | Predicate | Task IDs\n3. Per-task property assignments\n\nOutput as markdown. No JSON wrapping.\n";

// skills/src/prompts/util-read-context.md
var util_read_context_default = `Return a JSON object with:
1. "branch": output of \`git rev-parse --abbrev-ref HEAD\`
2. "epic_dir": "docs/epics/" + the branch name
{{extraFields}}
If any field embeds full multi-line file contents, do NOT hand-type the JSON \u2014 build it programmatically with a command that guarantees correct escaping, e.g.:
\`python3 -c "import json; print(json.dumps({'branch': ..., 'epic_dir': ..., 'spec_content': open('path/SPEC.md').read(), ...}))"\`
Hand-escaping large files reliably produces invalid JSON (stray backslashes, unescaped control chars). Run that command, then output only its stdout \u2014 no markdown fences, no commentary.
`;

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
function describeFailure(r, label) {
  if (r.missing) return `${label}: batch agent returned no parseable result`;
  if (!r.failed) return `${label}: ok`;
  const tail = (r.failed.stderr || r.failed.stdout).trim().split("\n").slice(-5).join("\n");
  return `${label}: step "${r.failed.name}" exited ${r.failed.exit_code}${tail ? ` \u2014 ${tail}` : ""}`;
}

// skills/src/shared/gate.ts
function gateSteps(phase2, flags) {
  return [{ name: "gate", command: `datum gate ${phase2}${flags}`, tolerant: true }];
}
function parseGateResult(result) {
  const step = result.missing ? null : stepResult(result, "gate");
  if (!step) {
    return {
      passed: false,
      needsHuman: false,
      hardStop: false,
      exitCode: null,
      message: `gate_run_failed: ${describeFailure(result, "gate")}`
    };
  }
  let json = null;
  try {
    const text = step.stdout.trim();
    const start = text.indexOf("{");
    json = start >= 0 ? JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) : null;
  } catch {
    json = null;
  }
  if (!json || typeof json !== "object") {
    const tail = (step.stderr || step.stdout).trim().split("\n").slice(-3).join(" | ");
    return {
      passed: false,
      needsHuman: false,
      hardStop: step.exit_code === 2,
      exitCode: step.exit_code,
      message: `gate_run_failed: datum gate exited ${step.exit_code} without JSON${tail ? ` \u2014 ${tail}` : ""}`
    };
  }
  return {
    passed: step.exit_code === 0 && json.passed === true,
    needsHuman: json.needs_human === true,
    hardStop: step.exit_code === 2 || json.hard_stop === true,
    exitCode: step.exit_code,
    message: typeof json.message === "string" ? json.message : ""
  };
}

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
function configureAgentTypes(opts) {
  if (typeof opts.agentTypes === "boolean") state.agentTypes = opts.agentTypes;
  if (typeof opts.hooksInstalled === "boolean") state.hooksInstalled = opts.hooksInstalled;
}
function stageOpts(stage, extra = {}) {
  if (!state.agentTypes) return { ...extra };
  return { ...extra, agentType: AGENT_TYPE_TABLE[stage] };
}

// skills/src/datum-properties.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
phase("Read");
var context = await agent(
  renderPrompt(util_read_context_default, {
    extraFields: `3. "spec_content": full contents of docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md
4. "tasks_content": full contents of docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md
5. "agent_types": the value of the agent_types key in .datum/config.json (true if the file or key is missing; false only when it is literally false)`
  }),
  { label: "read-context", model: model("fast") }
);
var ctx = typeof context === "string" ? parseAgentJson(context, {}) : context;
configureAgentTypes(a.agentTypes && typeof a.agentTypes === "object" ? a.agentTypes : { agentTypes: ctx.agent_types !== false });
if (!ctx.spec_content) throw new Error("SPEC.md not found. Run datum-refine first.");
if (!ctx.tasks_content) throw new Error("TASKS.md not found. Run datum-plan first.");
var epicDir = ctx.epic_dir || `docs/epics/${ctx.branch || "unknown"}`;
log(`Branch: ${ctx.branch}, SPEC: ${ctx.spec_content.split("\n").length} lines`);
phase("Derive");
await agent(
  renderPrompt(properties_derive_default, { specContent: ctx.spec_content, tasksContent: ctx.tasks_content }) + `

AFTER WRITING THE PROPERTIES CONTENT:
1. Write the output to "${epicDir}/PROPERTIES.md" (create dirs if needed)
2. Commit: git add "${epicDir}/PROPERTIES.md" && git commit -m "properties: derive PROPERTIES.md"`,
  { label: "derive-and-commit", model: model("balanced") }
);
log("PROPERTIES.md written and committed");
var gateStepList = gateSteps("properties", yolo ? " --approve" : "");
var gate = parseGateResult(parseBatchResult(
  await agent(batchCommandPrompt(gateStepList), stageOpts("cli", { label: "gate", model: model("fast") })),
  gateStepList
));
if (gate.passed) log("Properties gate PASSED");
else log(`Properties gate: ${gate.message || "needs review"}${gate.needsHuman ? " (needs human approval)" : ""}${gate.hardStop ? " (hard stop)" : ""}`);
return { branch: ctx.branch, gatePassed: gate.passed, gateMessage: gate.message, gateNeedsHuman: gate.needsHuman };
