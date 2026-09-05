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

// skills/src/prompts/properties-derive.md
var properties_derive_default = "Properties deriver. Map every SPEC requirement to testable invariants across 11 categories.\n\nSPEC content:\n{{specContent}}\n\nTASKS (for traceability):\n{{tasksContent}}\n\nPROPERTY CATEGORIES:\n1. SAFETY \u2014 what must NEVER happen\n2. LIVENESS \u2014 what must EVENTUALLY happen\n3. INVARIANT \u2014 what must ALWAYS be true\n4. BOUNDARY \u2014 valid input ranges\n5. IDEMPOTENT \u2014 what is safe to run twice\n6. ORDERING \u2014 order invariants\n7. ISOLATION \u2014 what cannot leak between contexts\n8. PERFORMANCE \u2014 latency/throughput/size bounds\n9. SECURITY \u2014 access controls\n10. OBSERVABILITY \u2014 what must be logged or measured\n11. COMPATIBILITY \u2014 existing behavior that must be preserved\n\nFor each requirement in the SPEC, derive at least one property from each applicable category.\nFormat: PROPERTY(TYPE-NNN): <testable predicate>\n\nThen build a traceability table mapping each property to the task(s) that must prove it.\nEvery task must have at least one property. If a task has no testable property, flag it.\n\nThe full PROPERTIES.md content is markdown with:\n1. Property list grouped by category\n2. Traceability table: Property ID | Category | Predicate | Task IDs\n3. Per-task property assignments\n\nWrite that markdown to the file named in the instructions below; your response itself is the JSON receipt described there.\n";

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
  const steps = [
    { name: "branch", command: `__eb=$(git rev-parse --abbrev-ref HEAD) && printf '%s' "$__eb"`, tolerant: true }
  ];
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
Before doing anything else, read ${f.path} IN FULL with the Read tool (all ${f.bytes} bytes). Treat its contents exactly as if they were pasted here. Do not summarise it, do not skip sections, and do not proceed on memory of a previous read.`;
}
function contextWitnessInstruction(files) {
  const deferred = files.filter((f) => f.exists && !f.inlined);
  if (deferred.length === 0) return "";
  const entries = deferred.map((f) => `    "${f.path}": "<first 12 hex chars of the blob hash \u2014 run \`git hash-object ${f.path}\` with the Bash tool and copy its output>"`).join(",\n");
  return '\n\nMANDATORY READ WITNESS: for every file above marked [FILE NOT INLINED], you must actually read it, then run `git hash-object <path>` yourself with the Bash tool for that exact path and copy its output. Your JSON response MUST include a "read_witness" field, keyed by path, whose value is the first 12 hex characters of that command\'s output \u2014 taken from the first line of the file you read, computed fresh, never guessed or reused from memory:\n{\n  "read_witness": {\n' + entries + "\n  }\n}\nThe key is the file path exactly as written above; the value is the 12-character hash prefix. Your JSON response is invalid without this field for every file listed above.";
}
function extractWitnessMap(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const w = parsed.read_witness;
  if (!w || typeof w !== "object" || Array.isArray(w)) return {};
  return w;
}
var WITNESS_MIN_HEX = 7;
function verifyReadWitness(files, parsed) {
  const deferred = files.filter((f) => f.exists && !f.inlined);
  const witness = extractWitnessMap(parsed);
  const missing = [];
  const mismatched = [];
  const tooShort = [];
  const candidates = [...Object.values(witness), ...Object.keys(witness)];
  const hexValues = candidates.filter((v) => typeof v === "string" && /^[0-9a-f]+$/i.test(v));
  const values = hexValues.filter((v) => v.length >= WITNESS_MIN_HEX);
  for (const f of deferred) {
    const sha = f.sha.toLowerCase();
    if (values.some((v) => sha.startsWith(v.toLowerCase()))) continue;
    const keyed = witness[f.path];
    if (typeof keyed === "string" && /^[0-9a-f]+$/i.test(keyed) && keyed.length < WITNESS_MIN_HEX && sha.startsWith(keyed.toLowerCase())) tooShort.push(f.path);
    else if (hexValues.some((v) => v.length < WITNESS_MIN_HEX && sha.startsWith(v.toLowerCase()))) tooShort.push(f.path);
    else if (typeof keyed === "string" && keyed.length >= WITNESS_MIN_HEX) mismatched.push(f.path);
    else missing.push(f.path);
  }
  return { ok: missing.length === 0 && mismatched.length === 0 && tooShort.length === 0, missing, mismatched, tooShort };
}
function assertReadWitness(files, parsed) {
  const result = verifyReadWitness(files, parsed);
  if (result.ok) return;
  const witness = extractWitnessMap(parsed);
  const byPath = new Map(files.map((f2) => [f2.path, f2]));
  const badPath = result.tooShort[0] ?? result.missing[0] ?? result.mismatched[0];
  const f = byPath.get(badPath);
  if (result.tooShort.includes(badPath)) {
    const sha = (f ? f.sha : "").toLowerCase();
    const short = Object.values(witness).find((v) => typeof v === "string" && v.length > 0 && sha.startsWith(v.toLowerCase())) || "";
    throw new Error(`context_read_unverified: ${badPath} \u2014 witness prefix too short (${short.length} < ${WITNESS_MIN_HEX}): the agent read the file but returned only "${short}" of blob ${f ? f.sha : "?"}`);
  }
  const got = witness[badPath];
  const gotStr = typeof got === "string" && got.length > 0 ? got : "missing";
  throw new Error(`context_read_unverified: ${badPath} \u2014 agent did not evidence reading the deferred file (expected blob ${f ? f.sha : "?"}, got ${gotStr})`);
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
  const commit2 = stepResult(result, "commit");
  if (!commit2) return { ...none, error: "commit_failed: commit step did not run" };
  const out = (commit2.stdout || "").trim();
  if (out.split("\n").includes(NOTHING_TO_COMMIT)) return { ...none, nothingToCommit: true };
  if (commit2.exit_code !== 0) {
    return { ...none, error: `commit_failed: git commit exited ${commit2.exit_code}: ${(commit2.stderr || commit2.stdout || "").trim().split("\n").slice(-3).join(" | ")}` };
  }
  const sha = (stepStdout(result, "sha") || "").trim();
  if (!sha) return { ...none, error: "commit_failed: commit exited 0 but no sha was printed" };
  return { committed: true, nothingToCommit: false, sha, error: "" };
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

// skills/src/datum-properties.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
if (a.agentTypes && typeof a.agentTypes === "object") configureAgentTypes(a.agentTypes);
setBatchCacheKey(a.configFingerprint || "");
phase("Read");
var SPEC_REL = "docs/epics/$__eb/SPEC.md";
var TASKS_REL = "docs/epics/$__eb/TASKS.md";
var probeSteps = contextProbeSteps({
  files: [SPEC_REL, TASKS_REL],
  extraCommands: [
    { name: "agent-types", command: `jq -r '.agent_types // true' .datum/config.json` }
  ]
});
var readBatch = parseBatchResult(
  await agent(batchCommandPrompt(probeSteps), bootstrapOpts("cli", { label: "read-context", model: model("fast") })),
  probeSteps
);
var relayPlan = contextRelayPlan(readBatch, [SPEC_REL, TASKS_REL]);
if (!(a.agentTypes && typeof a.agentTypes === "object")) {
  const agentTypesRaw = (stepStdout(readBatch, "agent-types") || "").trim();
  configureAgentTypes({ agentTypes: agentTypesRaw !== "false" });
}
var inlineBatch = null;
if (relayPlan.inline.length > 0) {
  const inlineSteps = contextInlineSteps(relayPlan.inline);
  inlineBatch = parseBatchResult(
    await agent(batchCommandPrompt(inlineSteps), stageOpts("cli", { label: "read-context-files", model: model("fast") })),
    inlineSteps
  );
}
var ctx = contextFromRelay(readBatch, inlineBatch, relayPlan);
for (const warning of ctx.warnings) log(`read-context: ${warning}`);
var specFile = ctx.files[SPEC_REL];
var tasksFile = ctx.files[TASKS_REL];
if (!specFile.exists) throw new Error("SPEC.md not found. Run datum-refine first.");
if (!tasksFile.exists) throw new Error("TASKS.md not found. Run datum-plan first.");
var specContent = contextSlot(specFile);
var tasksContent = contextSlot(tasksFile);
var epicDir = ctx.epicDir;
log(`Branch: ${ctx.branch}, SPEC: ${specFile.bytes} bytes${specFile.inlined ? "" : " (deferred)"}, TASKS: ${tasksFile.bytes} bytes${tasksFile.inlined ? "" : " (deferred)"}`);
phase("Derive");
var propertiesPath = `${epicDir}/PROPERTIES.md`;
var deriveRaw = await agent(
  renderPrompt(properties_derive_default, { specContent, tasksContent }) + `

AFTER DERIVING THE PROPERTIES CONTENT:
1. Write the full PROPERTIES.md markdown to "${propertiesPath}" (create dirs if needed).
2. Do NOT git add or git commit anything in this step \u2014 the workflow commits.
3. Your response is raw JSON only (no markdown fences, no prose): {"written": "${propertiesPath}"}` + contextWitnessInstruction([specFile, tasksFile]),
  { label: "derive", model: model("balanced") }
);
var derive = parseAgentJsonStrict(deriveRaw, "derive");
assertReadWitness([specFile, tasksFile], derive);
if (derive.written !== propertiesPath) {
  throw new Error(`properties_derive_failed: agent reported writing ${JSON.stringify(derive.written)}, expected ${propertiesPath}`);
}
var commitStepList = commitFilesSteps({ wt: ".", files: [`${epicDir}/PROPERTIES.md`], message: "properties: derive PROPERTIES.md" });
var commit = commitFilesFromSteps(parseBatchResult(
  await agent(batchCommandPrompt(commitStepList), stageOpts("cli", { label: "commit-properties", model: model("fast") })),
  commitStepList
));
if (commit.error) throw new Error(`properties_commit_failed: ${commit.error}`);
if (commit.nothingToCommit) log(`PROPERTIES.md unchanged since the last run \u2014 already committed at ${propertiesPath}`);
else log(`PROPERTIES.md written and committed (${commit.sha})`);
var gateStepList = gateSteps("properties", yolo ? " --approve" : "");
var gate = parseGateResult(parseBatchResult(
  await agent(batchCommandPrompt(gateStepList), stageOpts("cli", { label: "gate", model: model("fast") })),
  gateStepList
));
if (gate.passed) log("Properties gate PASSED");
else log(`Properties gate: ${gate.message || "needs review"}${gate.needsHuman ? " (needs human approval)" : ""}${gate.hardStop ? " (hard stop)" : ""}`);
return { branch: ctx.branch, gatePassed: gate.passed, gateMessage: gate.message, gateNeedsHuman: gate.needsHuman };
