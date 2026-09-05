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
function assertAcyclicTasks(tasks2) {
  const ids = tasks2.map((t) => t.id);
  const idSet = new Set(ids);
  const inDeg = {};
  const adj = {};
  for (const id of ids) inDeg[id] = 0;
  for (const task of tasks2) {
    const deps = (task.depends_on || []).filter((dep) => idSet.has(dep));
    inDeg[task.id] += deps.length;
    for (const dep of deps) {
      ;
      (adj[dep] = adj[dep] || []).push(task.id);
    }
  }
  let queue = ids.filter((id) => inDeg[id] === 0);
  const placed = new Set(queue);
  while (queue.length > 0) {
    const next = [];
    for (const id of queue) {
      for (const child of adj[id] || []) {
        inDeg[child]--;
        if (inDeg[child] === 0 && !placed.has(child)) {
          placed.add(child);
          next.push(child);
        }
      }
    }
    queue = next;
  }
  const cyclic = ids.filter((id) => !placed.has(id));
  if (cyclic.length > 0) {
    throw new Error(
      `Cyclic dependency detected among tasks: ${cyclic.sort().join(", ")}`
    );
  }
}
function buildContextFilesSection(fileContents, warn) {
  if (!fileContents || Object.keys(fileContents).length === 0) return "";
  const blocks = [];
  for (const [relPath, content] of Object.entries(fileContents)) {
    if (content === null) {
      warn(`context_files entry not found, skipping: ${relPath}`);
      continue;
    }
    blocks.push(`### ${relPath}
${content}`);
  }
  if (blocks.length === 0) return "";
  return [
    "PROJECT BUILD CONSTRAINTS",
    "",
    "The following project documentation was listed in context_files and is authoritative. Where these docs conflict with a build order inferred from source imports, the project docs take precedence over inferred imports.",
    "",
    ...blocks
  ].join("\n");
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
function mergeConfig(globalCfg, repoCfg2) {
  const g = globalCfg && typeof globalCfg === "object" ? globalCfg : {};
  const r = repoCfg2 && typeof repoCfg2 === "object" ? repoCfg2 : {};
  const merged = { ...g, ...r };
  const gModels = g.models && typeof g.models === "object" ? g.models : {};
  const rModels = r.models && typeof r.models === "object" ? r.models : {};
  if (g.models || r.models) {
    merged.models = { ...gModels, ...rModels };
  }
  return merged;
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
var configured = false;
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

// skills/src/shared/tracker.ts
async function publishLanePlan(lanePlanPath, epicTitle) {
  const result = await agent(
    `Run: datum plan-issues --lane-plan "${lanePlanPath}" --title "${epicTitle}"
Return the JSON output. If the command fails, return {"error": "<message>"}.
Output raw JSON only.`,
    stageOpts("cli", { label: "publish-issues", model: model("fast") })
  );
  if (!result) {
    log("[tracker] publish failed: agent returned no result");
    return null;
  }
  const parsed = typeof result === "string" ? parseAgentJson(result, null) : result;
  if (!parsed) {
    log(`[tracker] publish failed: unparseable output \u2014 ${String(result).slice(0, 200)}`);
    return null;
  }
  if (parsed.error) {
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

// skills/src/shared/utf8.ts
function utf8ByteLength(s) {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) bytes += 1;
    else if (c < 2048) bytes += 2;
    else if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 56320 && d <= 57343) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

// skills/src/shared/context-relay.ts
var CONTEXT_RELAY_BUDGET_BYTES = 16 * 1024;
var NOT_FOUND_MARKER = "__DATUM_CTXFILE_NOT_FOUND__";
function q(p) {
  return `"${p.replace(/(["\\`])/g, "\\$1")}"`;
}
function contextProbeSteps(o) {
  const steps = [
    { name: "branch", command: `__eb=$(git rev-parse --abbrev-ref HEAD) && printf '%s' "$__eb"`, tolerant: true },
    { name: "epic-dir", command: `printf 'docs/epics/%s' "$__eb"`, tolerant: true }
  ];
  o.files.forEach((relPath, i) => {
    steps.push({
      name: `ctx-wc-${i}`,
      command: `if [ -f ${q(relPath)} ]; then wc -c < ${q(relPath)} | tr -d ' '; else printf -- '-1'; fi`,
      tolerant: true
    });
    steps.push({
      name: `ctx-sha-${i}`,
      command: `if [ -f ${q(relPath)} ]; then git hash-object ${q(relPath)}; else printf ''; fi`,
      tolerant: true
    });
  });
  for (const extra of o.extraCommands || []) {
    steps.push({ name: extra.name, command: extra.command, tolerant: true });
  }
  return steps;
}
function contextRelayPlan(probe, files, budget = CONTEXT_RELAY_BUDGET_BYTES) {
  if (probe.missing) {
    throw new Error("context_relay_mismatch: probe batch returned no parseable result \u2014 cannot size the context files");
  }
  const plan = { files, inline: [], deferred: [], missing: [], bytes: {}, sha: {}, budget };
  let used = 0;
  files.forEach((relPath, i) => {
    const wcRaw = stepStdout(probe, `ctx-wc-${i}`);
    const bytes = wcRaw === null ? NaN : parseInt(wcRaw.trim(), 10);
    const sha = (stepStdout(probe, `ctx-sha-${i}`) || "").trim();
    if (!Number.isFinite(bytes) || bytes < 0) {
      plan.missing.push(relPath);
      plan.bytes[relPath] = -1;
      plan.sha[relPath] = "";
      return;
    }
    plan.bytes[relPath] = bytes;
    plan.sha[relPath] = sha;
    if (used + bytes <= budget) {
      plan.inline.push(relPath);
      used += bytes;
    } else {
      plan.deferred.push(relPath);
    }
  });
  return plan;
}
function contextInlineSteps(inlineFiles) {
  const steps = [];
  inlineFiles.forEach((relPath, i) => {
    steps.push({
      name: `ctx-cat-${i}`,
      command: `if [ -f ${q(relPath)} ]; then cat ${q(relPath)}; else printf '%s' '${NOT_FOUND_MARKER}'; fi`,
      tolerant: true
    });
    steps.push({
      name: `ctx-wc-${i}`,
      command: `if [ -f ${q(relPath)} ]; then wc -c < ${q(relPath)} | tr -d ' '; else printf -- '-1'; fi`,
      tolerant: true
    });
  });
  return steps;
}
function contextFromRelay(probe, inline, plan) {
  const branch = stepStdout(probe, "branch") || "";
  const epicDir2 = stepStdout(probe, "epic-dir") || `docs/epics/${branch}`;
  const files = {};
  const warnings = [];
  if (plan.inline.length > 0 && (inline === null || inline.missing)) {
    throw new Error(`context_relay_mismatch: inline batch returned no parseable result for ${plan.inline.join(", ")}`);
  }
  for (const relPath of plan.missing) {
    files[relPath] = { path: relPath, exists: false, inlined: false, bytes: -1, sha: "", content: null };
  }
  for (const relPath of plan.deferred) {
    files[relPath] = { path: relPath, exists: true, inlined: false, bytes: plan.bytes[relPath], sha: plan.sha[relPath], content: null };
    warnings.push(`context file ${relPath}: ${plan.bytes[relPath]} bytes, deferred to the consuming agent (relay budget ${plan.budget} bytes)`);
  }
  plan.inline.forEach((relPath, i) => {
    const raw = stepStdout(inline, `ctx-cat-${i}`);
    const declaredRaw = stepStdout(inline, `ctx-wc-${i}`);
    const declared = declaredRaw === null ? NaN : parseInt(declaredRaw.trim(), 10);
    if (raw === null || raw === NOT_FOUND_MARKER || declared === -1) {
      throw new Error(`context_relay_mismatch: ${relPath} existed at probe time (${plan.bytes[relPath]} bytes) but the inline read found nothing`);
    }
    const expected = plan.bytes[relPath];
    const actual = utf8ByteLength(raw);
    if (actual !== expected || Number.isFinite(declared) && declared !== expected) {
      throw new Error(`context_relay_mismatch: ${relPath} expected ${expected} bytes, got ${actual} bytes`);
    }
    files[relPath] = { path: relPath, exists: true, inlined: true, bytes: expected, sha: plan.sha[relPath], content: raw };
  });
  return { branch, epicDir: epicDir2, files, warnings };
}
function contextSlot(f) {
  if (!f.exists) throw new Error(`context file ${f.path} does not exist \u2014 caller must handle a missing file before building the prompt`);
  if (f.inlined && f.content !== null) return f.content;
  return `[FILE NOT INLINED \u2014 ${f.bytes} bytes is over the relay budget]
Before doing anything else, read ${f.path} IN FULL with the Read tool (all ${f.bytes} bytes; git blob ${f.sha}). Treat its contents exactly as if they were pasted here. Do not summarise it, do not skip sections, and do not proceed on memory of a previous read.`;
}
function contextWitnessInstruction(files) {
  const deferred = files.filter((f) => f.exists && !f.inlined);
  if (deferred.length === 0) return "";
  const entries = deferred.map((f) => `    "${f.path}": "<first 12 hex chars of the blob hash \u2014 run \`git hash-object ${f.path}\` with the Bash tool and copy its output>"`).join(",\n");
  return '\n\nMANDATORY READ WITNESS: for every file above marked [FILE NOT INLINED], you must actually read it, then run `git hash-object <path>` yourself with the Bash tool for that exact path and copy its output. Your JSON response MUST include a "read_witness" field, keyed by path, whose value is the first 12 hex characters of that command\'s output \u2014 taken from the first line of the file you read, computed fresh, never guessed or reused from memory:\n{\n  "read_witness": {\n' + entries + "\n  }\n}\nYour JSON response is invalid without this field for every file listed above.";
}
function extractWitnessMap(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const w = parsed.read_witness;
  if (!w || typeof w !== "object" || Array.isArray(w)) return {};
  return w;
}
function verifyReadWitness(files, parsed) {
  const deferred = files.filter((f) => f.exists && !f.inlined);
  const witness = extractWitnessMap(parsed);
  const missing = [];
  const mismatched = [];
  for (const f of deferred) {
    const value = witness[f.path];
    if (typeof value !== "string" || !/^[0-9a-f]{12,}$/i.test(value)) {
      missing.push(f.path);
      continue;
    }
    if (!f.sha.toLowerCase().startsWith(value.toLowerCase())) {
      mismatched.push(f.path);
    }
  }
  return { ok: missing.length === 0 && mismatched.length === 0, missing, mismatched };
}
function assertReadWitness(files, parsed) {
  const result = verifyReadWitness(files, parsed);
  if (result.ok) return;
  const witness = extractWitnessMap(parsed);
  const byPath = new Map(files.map((f2) => [f2.path, f2]));
  const badPath = result.missing[0] ?? result.mismatched[0];
  const got = witness[badPath];
  const gotStr = typeof got === "string" && got.length > 0 ? got : "missing";
  const f = byPath.get(badPath);
  throw new Error(`context_read_unverified: ${badPath} \u2014 agent did not evidence reading the deferred file (expected blob ${f ? f.sha : "?"}, got ${gotStr})`);
}

// skills/src/shared/config-steps.ts
var MISSING_CONFIG_MESSAGE = "missing .datum/config.json \u2014 run datum init first";
function configReadSteps() {
  return [
    { name: "repo-config", command: "cat .datum/config.json" },
    { name: "global-config", command: "cat ~/.datum/config.json 2>/dev/null || echo '{}'", tolerant: true }
  ];
}
function configFromSteps(result) {
  if (result.missing || result.failed) {
    throw new Error(MISSING_CONFIG_MESSAGE);
  }
  let repoCfgParsed;
  try {
    repoCfgParsed = JSON.parse(stepStdout(result, "repo-config") || "");
  } catch {
    throw new Error(MISSING_CONFIG_MESSAGE);
  }
  let globalCfgParsed = {};
  try {
    globalCfgParsed = JSON.parse(stepStdout(result, "global-config") || "{}");
  } catch {
    globalCfgParsed = {};
  }
  return mergeConfig(globalCfgParsed, repoCfgParsed);
}

// skills/src/prompts/plan-approaches.md
var plan_approaches_default = 'Architect. Read the SPEC and propose 2-3 implementation approaches.\n\nSPEC content:\n{{specContent}}\n\nCodebase context (CURRENT_STATE.md):\n{{currentState}}\n\nFor each approach:\n- One-sentence strategy description\n- Key tradeoffs (speed vs safety, complexity vs flexibility)\n- Which existing modules/files it touches most\n- Estimated task count and blast radius (low/medium/high)\n\nReturn JSON:\n{\n  "approaches": [\n    {\n      "name": "approach name",\n      "description": "one sentence",\n      "tradeoffs": "what you gain / give up",\n      "modules_touched": ["src/module/file1", "src/module/file2"],\n      "estimated_tasks": 3,\n      "blast_radius": "low|medium|high"\n    }\n  ],\n  "recommended": 0,\n  "recommendation_reason": "why this approach is simplest/safest"\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/plan-impact.md
var plan_impact_default = 'Impact analyzer. For each module/file the SPEC will change, assess blast radius.\n\nWorking directory: {{wt}}\nFiles to analyze:\n{{filesList}}\n\nTOOLS (use in preference order):\n1. `ast-grep --pattern \'<function_name>($$$)\' .` \u2014 find all callers structurally\n2. `scc --no-cocomo <file>` \u2014 LOC and complexity for a specific file\n3. GitNexus (gitnexus_impact) if available\n4. grep as fallback\n\nFor each file:\n1. Use ast-grep to find all callers/importers (structural, not string match)\n2. Run `scc --no-cocomo <file>` to get LOC and complexity\n3. Check if it\'s covered by existing tests (ast-grep for test functions referencing it)\n4. Assess risk from caller count + complexity\n\nReturn JSON:\n{\n  "files": [\n    {\n      "path": "src/module/file",\n      "loc": 150,\n      "callers": ["src/other/module", "src/cli"],\n      "caller_count": 2,\n      "has_tests": true,\n      "test_files": ["tests/test_file"],\n      "risk": "low|medium|high",\n      "notes": "why this risk level"\n    }\n  ],\n  "high_risk_files": ["files with risk=high that need isolated lanes"]\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/plan-triage.md
var plan_triage_default = 'Triage agent. Read the plan and decide if deep codebase research is needed before Act.\n\nRead docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md.\n\nEVALUATE against this rubric:\n1. Does the plan modify security, authentication, or core data models?\n2. Does any task touch more than 3 files or span multiple domains?\n3. Does it introduce a new dependency?\n4. Does it require adhering to existing, complex architectural patterns?\n\nROUTING:\n- If ANY of these are true \u2192 "deepen" (gather codebase evidence first)\n- If ALL are false (trivial changes, simple additions, isolated modules) \u2192 "properties"\n\nReturn JSON:\n{\n  "decision": "deepen|properties",\n  "reason": "one sentence justification",\n  "triggers": ["which rubric items triggered deepen, if any"]\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/plan-deepen.md
var plan_deepen_default = 'Evidence gatherer. Ground the plan in codebase reality by researching each complex task.\n\nRead docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md, then for each task that touches non-trivial logic:\n\n1. Search the codebase for existing implementations of similar logic\n2. Identify project conventions (how this pattern is usually handled here)\n3. Find known pitfalls in related code (error handling patterns, edge cases)\n4. Check test conventions in the relevant test directories\n\nTOOLS (use in preference order):\n1. `ast-grep --pattern \'<pattern>\' .` \u2014 structural search (e.g. find all try/except, all class defs, all async functions)\n2. `headroom memory list` \u2014 check for relevant past learnings\n3. `headroom learn show` \u2014 check for past tool call failures relevant to these files\n4. GitNexus (gitnexus_context, gitnexus_query) if available\n5. grep/find for pattern matching\n\nUse headroom_compress on large files. Query-retrieve specific sections as needed.\n\nAPPEND a single section to the end of docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md titled exactly `## Research Findings`.\nGroup findings by task ID. Keep it concise \u2014 patterns and pitfalls, not full file dumps.\n\nFormat:\n```markdown\n## Research Findings\n\n### task-id: Task Title\n- **Pattern**: See `module/file:45` for existing approach\n- **Convention**: This codebase uses X pattern for Y\n- **Pitfall**: Known issue with Z \u2014 handle via W\n- **Past failure**: headroom learn flagged <issue> in this area\n```\n\nCRITICAL: Do NOT modify existing task content. Append-only to TASKS.md.\n\nAfter appending, commit: git add docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md && git commit -m "plan: deepen \u2014 research findings"\n\nReturn JSON: {"tasks_researched": N, "findings_count": N}\nOutput raw JSON only. No markdown fences.\n';

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

// skills/src/prompts/plan-decompose.md
var plan_decompose_default = 'Task decomposer. Break the SPEC into implementation tasks for the TDD pipeline.\n\nSPEC content:\n{{specContent}}\n\nChosen approach:\n{{chosenApproach}}\n\nLanguage: {{language}}\nTest framework: {{testFramework}}\n\nCodebase scan (files, patterns, test conventions):\n{{scanContext}}\n\nPrior failure patterns:\n{{priorFailures}}\n\nBUILD-ORDER / IMPORT ANALYSIS CHECK:\nBefore finalizing depends_on for any task, trace the actual import/reference graph implied by the codebase scan and the SPEC \u2014 which modules/files import or call which others \u2014 and make sure each task\'s depends_on reflects that real build order, not just narrative ordering from the SPEC. A task that will import or call code another task creates must depend_on that task.\n\nPROJECT BUILD CONSTRAINTS:\n{{contextFilesSection}}\nThe context_files section above (when present) lists project documentation that is authoritative for build order and module boundaries. Where these project docs conflict with a build order you would otherwise infer from source imports, the project docs take precedence over inferred imports \u2014 follow the documented order and note the override in the affected task\'s red_note.\n\nRULES:\n- Each task maps to one lane in the TDD pipeline\n- Task ids MUST be `task-NNN` \u2014 zero-padded to three digits, numbered in the order you list them (task-001, task-002, ...). The schema gate rejects any other id shape. Put the descriptive name in the required `slug` field instead (lowercase letters, digits, hyphens; 3-61 chars; pattern `^[a-z0-9][a-z0-9-]{2,60}$`, e.g. "add-cycle-detection", "validate-input-schema"). `depends_on` references use the `task-NNN` ids, never slugs.\n- No task touches more than 5 files\n- The \'files\' array MUST list EVERY file the implementation agent will need to create or modify \u2014 not just the primary target. Omitting a file causes a file_ownership_violation at GREEN. When in doubt, include the file. Check the codebase scan for all files in the affected module.\n- PROTOCOL COMPLETENESS CHECK (do this for every task before finalizing its `files`): read each acceptance_criteria and ask "does satisfying this AC require adding or changing a method, property, or signature declared on a protocol, an abstract contract, a trait, or a base class?" (e.g. an AC like "use case calls repository.newMethod(...)" implies `newMethod` must be added to wherever the repository\'s contract is declared, not just its concrete implementation). If yes, search the repo (grep/ast-grep) for the declaration site of that contract/type \u2014 the keywords to search for vary by language ("protocol", "trait", "abstract", or the equivalent construct that declares a contract rather than an implementation) \u2014 and add that declaring file to `files` alongside the implementation file, since the lane\'s implementer needs to edit both in the same commit. Do not add it to `reads` in this case; `reads` is for files this task depends on but does not modify, and a contract gaining a new required member IS a modification. If no declaring file exists yet (the contract itself is new), say so in `red_note` instead of inventing a path.\n- NO-CODE-CHURN / DOCS-ONLY DETECTION (do this once, before writing any task\'s `red_note`): read the SPEC content for an NFR-style constraint stating the epic\'s diff must contain zero files of a given source-code extension, or that the epic is documentation-only/docs-only (e.g. "the diff must contain zero .swift/.py files", "documentation-only epic", "no code churn"). If such a constraint is present, then for every task whose `files[]` includes a test-artifact path that is directory-shaped or otherwise extensionless in a context where the epic\'s implementation language would normally require a compiled test package for that path (e.g. a Swift Testing target directory like `tests/CpdTableTests`), append this exact instruction to that task\'s `red_note`: "This epic forbids any file of the forbidden extension(s) in the diff. Write this test artifact as a single extensionless file containing pseudo-code/plain-text assertions \u2014 NOT a real compiled test package. Do NOT create a Package.swift, do NOT create a nested Tests/<Target>/ subdirectory, and do NOT add `import XCTest`/`import Testing` or any other compiled-test-framework import." Apply this identically to every affected lane so the constraint is decided once, centrally, at plan time rather than inferred independently per-lane.\n- UNIFICATION / FORK-CONSUMPTION PARITY CHECK (do this once, before finalizing any flip lane or deletion lane): read the SPEC for language describing a fork-consumption epic \u2014 e.g. "flip consumer(s) to the shared/canonical copy", "delete the fork/duplicate", "consolidate X into shared Y", or any end-state where a source tree is deleted in favor of an existing alternate tree. If detected, actually read and compare the fork\'s and the shared copy\'s file sets and public API surface for the specific files named in the SPEC \u2014 file existence, method/property signatures, protocol/contract conformance \u2014 do not just trust the SPEC\'s audit narrative. For every concrete gap found (a file present in the fork but missing from the shared copy, a method/property the fork\'s callers require that the shared copy lacks, a behavioral divergence the SPEC\'s own audit notes call out), emit a dedicated port task/lane scoped only to that gap\'s files, and add its id to the flip lane\'s `depends_on` so the flip lane is scoped to "flip now that parity is real," not "flip and also happen to fix everything wrong along the way." If the comparison can\'t be done confidently (the named files aren\'t findable, or the SPEC\'s claimed shared-copy location doesn\'t exist yet), do not fabricate port lanes \u2014 note the uncertainty in the flip lane\'s `red_note` instead, same fallback style as the PROTOCOL COMPLETENESS CHECK above.\n- BASELINE SYNC CHECK (same pass as the parity check above, unification epics only): before finalizing the flip lane, check whether the fork\'s target files as they exist on the epic branch actually match `main` for those same files \u2014 i.e. whether `main` has newer fixes to the fork that this plan doesn\'t yet account for. If a divergence is found, emit a dedicated sync-from-main task/lane scoped to only the diverging files, and add it to the flip lane\'s `depends_on` ahead of any parity-check port lanes. If this can\'t be determined confidently, note it in the flip lane\'s `red_note` rather than guessing \u2014 do not invent a sync lane speculatively.\n- Tasks sharing files must have a dependency edge or be in the same lane\n- Each lane MUST have its own unique test file(s). Never assign the same test file to multiple lanes. If multiple tasks target the same module (e.g. `module/foo`), split tests per lane: `tests/test_foo_create`, `tests/test_foo_validate`, etc. This prevents reflect score pollution from cross-lane test accumulation.\n- Every task needs: id, slug, title, acceptance_criteria, files, reads, depends_on, red_note\n- ACs must be specific enough to write a failing test from \u2014 function names, expected values, exception types\n- red_note tells the RED agent what the failing test should prove \u2014 use the project\'s language and test framework, not Python/pytest unless that IS the project language\n- kind is "behavioral" (default) for any task that changes testable behavior. Set "kind": "structural" ONLY for tasks whose deliverable has no testable behavior at all \u2014 documentation-only (ADRs, README, docs/*.md), config-only, or pure file moves. Structural tasks skip the RED/GREEN test stages and run a single commit stage, so never mark a task structural if any acceptance criterion could be checked by a test.\n- depends_on lists task IDs this task requires to be completed first\n- reads lists files this task\'s implementation READS but does NOT modify (e.g. a protocol/contract file another lane owns). If a task reads a file another lane writes, it must either list that file in reads (so a dependency edge is auto-injected) or add an explicit depends_on \u2014 otherwise the reader may run before the writer produces that file.\n\nReturn JSON matching this schema:\n[\n  {\n    "id": "task-001",\n    "slug": "descriptive-task-name",\n    "title": "Human-readable title",\n    "description": "What this task implements",\n    "acceptance_criteria": [\n      "function_name(input) returns expected_output",\n      "function_name(bad_input) raises SpecificError with \'message\'"\n    ],\n    "files": ["src/module/file", "tests/test_file"],\n    "reads": [],\n    "depends_on": [],\n    "introduces_stubs": false,\n    "kind": "behavioral",\n    "red_note": "The failing test must call function_name with input and assert on the return value",\n    "estimated_loc": 50\n  }\n]\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/datum-plan.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
if (a.agentTypes && typeof a.agentTypes === "object") configureAgentTypes(a.agentTypes);
setBatchCacheKey(a.configFingerprint || "");
phase("Read");
var NOT_FOUND_MARKER2 = "__DATUM_CTXFIELD_NOT_FOUND__";
var SPEC_REL = "docs/epics/$__eb/SPEC.md";
var probeSteps = contextProbeSteps({
  files: [SPEC_REL],
  extraCommands: [
    { name: "current-state", command: `if [ -f CURRENT_STATE.md ]; then head -80 CURRENT_STATE.md; else printf '%s' '${NOT_FOUND_MARKER2}'; fi` },
    { name: "prior-defects", command: `jq -r '.brief_defects[]? | "\\(.surfaced_by_stage)\\t\\(.missing_ac)"' .datum/runs/*/closeout-data.json 2>/dev/null` },
    { name: "error-history", command: `if [ -f .datum/ERRORS.md ]; then head -40 .datum/ERRORS.md; else printf '%s' '${NOT_FOUND_MARKER2}'; fi` }
  ]
});
var readBatch = parseBatchResult(
  await agent(batchCommandPrompt(probeSteps), bootstrapOpts("cli", { label: "read-context", model: model("fast") })),
  probeSteps
);
var relayPlan = contextRelayPlan(readBatch, [SPEC_REL]);
var inlineBatch = null;
if (relayPlan.inline.length > 0) {
  const inlineSteps = contextInlineSteps(relayPlan.inline);
  inlineBatch = parseBatchResult(
    await agent(batchCommandPrompt(inlineSteps), bootstrapOpts("cli", { label: "read-context-files", model: model("fast") })),
    inlineSteps
  );
}
var ctx = contextFromRelay(readBatch, inlineBatch, relayPlan);
for (const warning of ctx.warnings) log(`read-context: ${warning}`);
var epicDir = ctx.epicDir;
var specFile = ctx.files[SPEC_REL];
if (!specFile.exists) throw new Error(`SPEC.md not found at ${epicDir}/SPEC.md. Run datum-refine first.`);
var specContent = contextSlot(specFile);
log(`Branch: ${ctx.branch}, SPEC: ${specFile.bytes} bytes${specFile.inlined ? "" : " (over relay budget \u2014 agents read it themselves)"}`);
var currentStateRaw = stepStdout(readBatch, "current-state");
var currentState = currentStateRaw === null || currentStateRaw === NOT_FOUND_MARKER2 ? null : currentStateRaw;
var priorDefects = stepStdout(readBatch, "prior-defects") || "";
var errorHistoryRaw = stepStdout(readBatch, "error-history");
var errorHistory = errorHistoryRaw === null || errorHistoryRaw === NOT_FOUND_MARKER2 ? null : errorHistoryRaw;
var priorFailures = [priorDefects, errorHistory || ""].filter(Boolean).join("\n") || "(no prior failure data)";
var configReadStepList = configReadSteps();
var configBatchRaw = await agent(batchCommandPrompt(configReadStepList), bootstrapOpts("cli", { label: "read-config", model: model("fast") }));
var repoCfg = { ...DEFAULT_CONFIG, ...configFromSteps(parseBatchResult(configBatchRaw, configReadStepList)) };
if (!(a.agentTypes && typeof a.agentTypes === "object")) configureAgentTypes(readAgentTypeConfig(repoCfg));
var language = repoCfg.language || DEFAULT_CONFIG.language;
var testFramework = repoCfg.test_framework || DEFAULT_CONFIG.test_framework;
var contextFilesList = repoCfg.context_files || [];
var contextFileContents = {};
var contextFilesWarnings = [];
if (contextFilesList.length > 0) {
  const cfProbeSteps = contextProbeSteps({ files: contextFilesList });
  const cfProbe = parseBatchResult(
    await agent(batchCommandPrompt(cfProbeSteps), stageOpts("cli", { label: "probe-context-files", model: model("fast") })),
    cfProbeSteps
  );
  const cfPlan = contextRelayPlan(cfProbe, contextFilesList);
  let cfInline = null;
  if (cfPlan.inline.length > 0) {
    const cfInlineSteps = contextInlineSteps(cfPlan.inline);
    cfInline = parseBatchResult(
      await agent(batchCommandPrompt(cfInlineSteps), stageOpts("cli", { label: "read-context-files", model: model("fast") })),
      cfInlineSteps
    );
  }
  const cf = contextFromRelay(cfProbe, cfInline, cfPlan);
  for (const warning of cf.warnings) contextFilesWarnings.push(warning);
  for (const relPath of contextFilesList) {
    const f = cf.files[relPath];
    contextFileContents[relPath] = f.exists ? contextSlot(f) : null;
  }
}
var contextFilesSection = buildContextFilesSection(
  contextFileContents,
  (msg) => contextFilesWarnings.push(msg)
);
for (const warning of contextFilesWarnings) log(`context_files: ${warning}`);
phase("Decompose");
var approachesRaw = await agent(
  renderPrompt(plan_approaches_default, { specContent, currentState: currentState || "(not available)" }) + contextWitnessInstruction([specFile]),
  { label: "propose-approaches", model: model("balanced") }
);
var approaches = parseAgentJsonStrict(approachesRaw, "propose-approaches");
assertReadWitness([specFile], approaches);
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
  renderPrompt(plan_decompose_default, { specContent, chosenApproach: JSON.stringify(chosen), scanContext: impactStr, priorFailures, language, testFramework, contextFilesSection }),
  { label: "decompose-tasks", model: decomposeModel }
);
var tasks = typeof tasksRaw === "string" ? parseAgentJson(tasksRaw, []) : tasksRaw;
if (!Array.isArray(tasks) || tasks.length === 0) {
  throw new Error(`Task decomposition returned 0 tasks \u2014 refusing to write an empty lane plan. Raw output: ${String(tasksRaw).slice(0, 300)}`);
}
assertAcyclicTasks(tasks);
var tasksJson = JSON.stringify(tasks);
log(`Decomposed into ${tasks.length} tasks`);
for (const task of tasks) {
  const deps = task.depends_on?.length > 0 ? ` (depends: ${task.depends_on.join(", ")})` : "";
  log(`  ${task.id}: ${task.title}${deps}`);
}
var buildRaw = await agent(
  `Do these steps in order:
1. mkdir -p "${epicDir}"
2. Write this JSON to "${epicDir}/tasks.json": ${tasksJson}
3. Run: datum lane-plan --input "${epicDir}/tasks.json" --output "${epicDir}/lane-plan.json" --md-output "${epicDir}/TASKS.md"
Do NOT git add or git commit anything in this step.
If step 2 or step 3 fails (non-zero exit), return JSON: {"exit_code": <the exit code>, "error": "<the stdout+stderr of the failing step>"}
Otherwise return: {"exit_code": 0}
Output raw JSON only.`,
  { label: "build-lane-plan", model: model("fast") }
);
var build = typeof buildRaw === "string" ? parseAgentJson(buildRaw, { exit_code: 1, error: "build-lane-plan agent returned unparseable output" }) : buildRaw;
if (!build || build.exit_code !== 0) {
  throw new Error(`datum lane-plan failed (exit ${build?.exit_code ?? "?"}) \u2014 plan NOT committed: ${build?.error || "no error output"}`);
}
var earlyGateSteps = gateSteps("plan", " --approve");
var earlyGate = parseGateResult(parseBatchResult(
  await agent(batchCommandPrompt(earlyGateSteps), stageOpts("cli", { label: "gate-early", model: model("fast") })),
  earlyGateSteps
));
if (!earlyGate.passed) {
  throw new Error(`Plan gate failed right after datum lane-plan \u2014 plan NOT committed (fix tasks.json and re-run datum plan): ${earlyGate.message || "no message"}`);
}
log("Early plan gate PASSED (schema + structure)");
await agent(
  `Commit the plan artifacts: git add "${epicDir}/tasks.json" "${epicDir}/lane-plan.json" "${epicDir}/TASKS.md" && git commit -m "plan: tasks.json + lane-plan.json + TASKS.md"
Return JSON: {"exit_code": 0} on success, or {"exit_code": 1, "error": "the stderr"} on failure. Output raw JSON only.`,
  stageOpts("cli", { label: "commit-lane-plan", model: model("fast") })
);
log("Lane plan built, gated, and committed");
var skeletonDir = `${epicDir}/skeletons`;
await agent(
  `Run these commands in order:
1. mkdir -p "${skeletonDir}"
2. datum skeleton --batch --language ${language} --tasks "${epicDir}/lane-plan.json" --output-dir "${skeletonDir}"
3. git add "${skeletonDir}" && git commit -m "plan: pre-generate RED skeletons"
If step 2 fails, return JSON: {"exit_code": 1, "error": "the stderr"}
Otherwise return: {"exit_code": 0, "skeleton_dir": "${skeletonDir}"}
Output raw JSON only.`,
  stageOpts("cli", { label: "skeleton-batch", model: model("fast") })
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
var gateStepList = gateSteps("plan", yolo ? " --approve" : "");
var gate = parseGateResult(parseBatchResult(
  await agent(batchCommandPrompt(gateStepList), stageOpts("cli", { label: "gate", model: model("fast") })),
  gateStepList
));
if (gate.passed) log("Plan gate PASSED");
else log(`Plan gate: ${gate.message || "needs approval"}${gate.needsHuman ? " (needs human approval)" : ""}${gate.hardStop ? " (hard stop)" : ""}`);
var epicIssue;
if (gate.passed) {
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
  gatePassed: gate.passed,
  gateMessage: gate.message,
  gateNeedsHuman: gate.needsHuman
};
