// @generated — DO NOT EDIT. Source: skills/src/datum-refine.ts
export const meta = {
  name: "datum-refine",
  description: "Transform TICKET.md into SPEC.md \u2014 triage addenda, classify ambiguity, scan codebase, write spec",
  phases: [
    { title: "Read", detail: "read TICKET.md and detect branch/epic dir" },
    { title: "Analyze", detail: "triage addenda + classify ambiguity + scan codebase" },
    { title: "Write", detail: "produce SPEC.md + QUESTIONS.md, commit, gate" }
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

// skills/src/prompts/refine-triage.md
var refine_triage_default = 'Addendum triage agent. Read the full TICKET.md and classify each section.\n\nRead: {{ticketPath}}\n\nThe TICKET may have appended addendum sections (marked with `## Addendum \u2014 YYYY-MM-DD`).\nFor each addendum, determine whether it belongs to the CURRENT epic scope or is a DIFFERENT feature.\n\nDECISION RULE:\n- SAME SCOPE: addendum touches the same files/modules as the original requirements, extends\n  existing behavior, adds edge cases, or refines acceptance criteria.\n- DIFFERENT FEATURE: zero file overlap with original requirements, introduces new public API,\n  targets a different module or subsystem entirely.\n\nTo check file overlap, scan the codebase:\n- grep or find for symbols/modules named in the original requirements\n- grep or find for symbols/modules named in the addendum\n- If the file sets intersect \u2192 SAME SCOPE\n- If zero intersection \u2192 DIFFERENT FEATURE\n\nReturn JSON:\n{\n  "original_scope": "one-line summary of the original TICKET scope",\n  "addenda": [\n    {"date": "YYYY-MM-DD", "summary": "what was added", "verdict": "same_scope|roadmap", "reason": "why"}\n  ],\n  "roadmap_items": ["one-line description for each roadmap-triaged addendum"],\n  "merged_requirements": ["full list of requirements after incorporating same-scope addenda"]\n}\n\nIf the TICKET has no addenda, return empty addenda/roadmap_items and the original requirements as merged_requirements.\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/refine-classify.md
var refine_classify_default = 'Ambiguity classifier. Read the TICKET and classify how much clarification Refine needs.\n\nTICKET content:\n{{ticketContent}}\n\nCLASSIFICATION LEVELS:\n- HIGH: vague or conceptual \u2014 intent unclear, architecture unspecified\n- MEDIUM: clear intent, detectable gaps in failure modes, NFRs, or scope\n- LOW: specific and concrete \u2014 intent, scope, failure modes all clear\n- TRIVIAL: rename, tooltip, wording fix, single-line config change\n\nIf you must assume a structural pattern to understand the ticket, classify as MEDIUM.\n\nReturn JSON:\n{\n  "level": "high|medium|low|trivial",\n  "reasoning": "why this classification",\n  "gaps": ["list of detected gaps that need clarification"],\n  "assumptions": ["list of assumptions the ticket relies on"]\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/refine-scan.md
var refine_scan_default = 'Codebase scanner for Refine. Verify every symbol, API, and module referenced in the TICKET.\n\nWorking directory: {{wt}}\nRequirements to verify:\n{{requirements}}\n\nTOOLS (use in preference order):\n1. `ast-grep --pattern \'<symbol>\' .` \u2014 AST-aware structural search (finds defs, not just strings)\n2. `scc .` \u2014 repo shape: LOC per language, file counts, complexity (run once, report in classification)\n3. GitNexus (gitnexus_context, gitnexus_query) if available\n4. grep/find as fallback\n\nFor each symbol, API, or module mentioned in the requirements:\n1. Use ast-grep to confirm it exists structurally (function def, class def, import)\n2. Read the relevant source file to understand current behavior\n3. Use ast-grep to find callers: `ast-grep --pattern \'<symbol>($$$)\' .`\n4. Assess blast radius from caller count\n\nRun `scc --no-cocomo -s lines .` once to get repo shape for Classification Metadata.\n\nUse headroom_compress on any file longer than 100 lines. Query-retrieve specific sections as needed.\n\nReturn JSON:\n{\n  "symbols": [\n    {\n      "name": "symbol_name",\n      "exists": true,\n      "file": "path/to/file",\n      "related_files": ["tests/test_file", "src/other/caller"],\n      "callers_count": 3,\n      "blast_radius": "low|medium|high",\n      "notes": "current behavior summary"\n    }\n  ],\n  "missing_symbols": ["symbols referenced but not found in codebase"],\n  "test_framework": "pytest|jest|vitest|swift-testing|xctest",\n  "test_conventions": "how existing tests in this area are structured",\n  "patterns": ["existing patterns relevant to the requirements"],\n  "repo_shape": {\n    "total_loc": 0,\n    "languages": {"Python": 0, "TypeScript": 0},\n    "file_count": 0\n  }\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/refine-spec.md
var refine_spec_default = "SPEC writer. Transform the TICKET + codebase context into a complete SPEC.md.\n\nTICKET content:\n{{ticketContent}}\n\nCodebase scan results:\n{{scanResults}}\n\nAmbiguity classification: {{ambiguityLevel}}\nDetected gaps: {{gaps}}\nAssumptions: {{assumptions}}\n\nWrite a SPEC.md following this structure exactly:\n\n1. **Summary** \u2014 2-3 sentences: what changes and why\n2. **Context** \u2014 how this connects to the existing system (use scan results)\n3. **Requirements** \u2014 numbered, each with testable acceptance criteria. Base these on the TICKET requirements, refined with codebase knowledge.\n4. **Failure Modes** \u2014 table: what can go wrong + handling\n5. **Non-Functional Requirements** \u2014 table: requirement + target\n6. **Out of Scope** \u2014 from TICKET's \"Not This\" section + any additional exclusions\n7. **Open Questions** \u2014 gaps that need human answers (empty if trivial/low ambiguity)\n8. **Assumption Audit** \u2014 table: #, Assumption, Justification, Status (confirmed/decided/guess), Resolves (Q# or n/a). Use `decided` for intentional product/design decisions, `confirmed` for code-verified facts, `guess` for technical unknowns that need a QUESTIONS.md entry\n9. **Classification Metadata** \u2014 YAML block with estimated_files, estimated_loc, clusters_touched, new_public_api, dependency_additions\n\nRULES:\n- Every AC must be testable \u2014 if it can't become a test assertion, rewrite it\n- Use the scan results to ground requirements in real file paths and function names\n- Flag any symbols from the TICKET that don't exist in the codebase\n- If ambiguity is HIGH/MEDIUM, put unresolved gaps in Open Questions\n- If ambiguity is LOW/TRIVIAL, Open Questions should be empty\n\nOutput the full SPEC.md content as markdown. No JSON wrapping.\n";

// skills/src/prompts/refine-questions.md
var refine_questions_default = `QUESTIONS writer. Generate clarifying questions from detected gaps.

Gaps to address:
{{gaps}}

Assumptions to validate:
{{assumptions}}

Ambiguity level: {{ambiguityLevel}}

Write a QUESTIONS.md following this format:

## Refine \u2014 {{date}}

### Q1: [Category] Question text?
> Context explaining why this matters and what depends on the answer.

[Answer]:

### Q2: [Category] ...

RULES:
- Each question addresses one specific gap or assumption
- Categories: Scope, Architecture, Behavior, NFR, Integration, Security
- The context block must explain what decision hinges on the answer
- Anchor assumptions: "I'm assuming X \u2014 is that right, or Y?"
- If there are no gaps (trivial/low ambiguity), write: "No clarifying questions needed \u2014 intent is clear."

Output the full QUESTIONS.md content as markdown. No JSON wrapping.
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
var CONTEXT_CHUNK_BYTES = 12 * 1024;

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

// skills/src/datum-refine.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
var issueNumber = typeof a.issueNumber === "number" ? a.issueNumber : null;
var freeText = typeof a.freeText === "string" ? a.freeText : "";
if (a.agentTypes && typeof a.agentTypes === "object") configureAgentTypes(a.agentTypes);
setBatchCacheKey(a.configFingerprint || "");
phase("Read");
var TICKET_REL = "docs/epics/$__eb/TICKET.md";
var probeSteps = contextProbeSteps({
  files: [TICKET_REL],
  extraCommands: [
    { name: "timestamp", command: "date +%Y-%m-%dT%H:%M:%S" },
    { name: "agent-types", command: `jq -r '.agent_types // true' .datum/config.json` },
    // Evaluated in the script (below) whether or not the TICKET is inlined.
    { name: "has-addenda", command: `grep -c '^## Addendum' "docs/epics/$__eb/TICKET.md" 2>/dev/null || true` }
  ]
});
var readBatch = parseBatchResult(
  await agent(batchCommandPrompt(probeSteps), bootstrapOpts("cli", { label: "read-context", model: model("fast") })),
  probeSteps
);
var relayPlan = contextRelayPlan(readBatch, [TICKET_REL]);
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
var epicDir = ctx.epicDir;
var ticketPath = `${epicDir}/TICKET.md`;
var ticketFile = ctx.files[TICKET_REL];
if (!ticketFile.exists) {
  const ignoredInputHint = issueNumber ? ` You passed issueNumber ${issueNumber}, but datum-go does not yet bootstrap TICKET.md from a GitHub issue automatically \u2014 that input was ignored. Run \`datum ticket-from-issue ${issueNumber}\` to fetch the issue and bootstrap TICKET.md from it, then re-run \`datum go\` with no args.` : freeText ? ` You passed a brief ("${freeText.slice(0, 80)}${freeText.length > 80 ? "\u2026" : ""}"), but datum-go only uses freeText to detect a NEW epic when one is already in progress on this branch \u2014 it does not bootstrap a brand-new epic from freeText when nothing exists yet, so that input was ignored. Run \`datum init --name <slug>\` yourself, fill in TICKET.md with your brief, commit it, then re-run \`datum go\` with no args.` : " Run `datum init` first.";
  throw new Error(`TICKET.md not found at ${ticketPath}.${ignoredInputHint}`);
}
var ticketContent = contextSlot(ticketFile);
log(`Branch: ${ctx.branch}, TICKET: ${ticketFile.bytes} bytes${ticketFile.inlined ? "" : " (over relay budget \u2014 agents read it themselves)"}`);
phase("Analyze");
var hasAddenda = parseInt((stepStdout(readBatch, "has-addenda") || "0").trim(), 10) > 0;
var triageResult = {
  original_scope: "",
  addenda: [],
  roadmap_items: [],
  merged_requirements: []
};
if (hasAddenda) {
  const triageRaw = await agent(
    renderPrompt(refine_triage_default, { ticketPath }) + `

ADDITIONAL TASK: If any addenda are triaged as "roadmap" (different feature), also:
1. Read ROADMAP.md
2. Append the roadmap items under "## Planned"
3. Commit: git add ROADMAP.md && git commit -m "roadmap: triage items from refine"`,
    { label: "triage-addenda", model: model("balanced") }
  );
  triageResult = parseAgentJsonStrict(triageRaw, "triage-addenda");
  log(`Triage: ${triageResult.addenda.length} addenda, ${triageResult.roadmap_items.length} roadmapped`);
} else {
  log("No addenda \u2014 single-scope TICKET");
}
var classifyRaw = await agent(
  renderPrompt(refine_classify_default, { ticketContent }) + contextWitnessInstruction([ticketFile]),
  { label: "classify-ambiguity", model: model("fast") }
);
var classify = parseAgentJsonStrict(classifyRaw, "classify-ambiguity");
assertReadWitness([ticketFile], classify);
log(`Ambiguity: ${classify.level} \u2014 ${classify.reasoning}`);
var requirements = triageResult.merged_requirements.length > 0 ? triageResult.merged_requirements.join("\n") : ticketContent;
var scanRaw = await agent(
  renderPrompt(refine_scan_default, { wt: ".", requirements }),
  { label: "scan-codebase", model: model("balanced") }
);
var scanResults = typeof scanRaw === "string" ? scanRaw : JSON.stringify(scanRaw);
phase("Write");
var timestamp = stepStdout(readBatch, "timestamp") || "";
var today = timestamp ? timestamp.slice(0, 10) : "(date unavailable)";
await agent(
  `You have TWO tasks. Do them in order.

TASK 1 \u2014 Write SPEC.md:
${renderPrompt(refine_spec_default, {
    ticketContent,
    scanResults,
    ambiguityLevel: classify.level,
    gaps: classify.gaps.join("\n"),
    assumptions: classify.assumptions.join("\n")
  })}

Write the SPEC to "${epicDir}/SPEC.md" (create dirs if needed).

TASK 2 \u2014 Write QUESTIONS.md:
${renderPrompt(refine_questions_default, {
    gaps: classify.gaps.join("\n"),
    assumptions: classify.assumptions.join("\n"),
    ambiguityLevel: classify.level,
    date: today
  })}

Write the QUESTIONS to "${epicDir}/QUESTIONS.md".

TASK 3 \u2014 Commit both:
git add "${epicDir}/SPEC.md" "${epicDir}/QUESTIONS.md" && git commit -m "refine: write SPEC.md + QUESTIONS.md"`,
  { label: "write-spec-and-questions", model: model("balanced") }
);
log(`SPEC.md + QUESTIONS.md written to ${epicDir}`);
var gateStepList = gateSteps("refine", yolo ? " --approve" : "");
var gate = parseGateResult(parseBatchResult(
  await agent(batchCommandPrompt(gateStepList), stageOpts("cli", { label: "gate", model: model("fast") })),
  gateStepList
));
if (gate.passed) log("Refine gate PASSED");
else log(`Refine gate: ${gate.message || "needs review"}${gate.needsHuman ? " (needs human approval)" : ""}${gate.hardStop ? " (hard stop)" : ""}`);
return {
  branch: ctx.branch,
  epicDir,
  ambiguity: classify.level,
  gaps: classify.gaps,
  roadmapItems: triageResult.roadmap_items,
  gatePassed: gate.passed,
  gateMessage: gate.message,
  gateNeedsHuman: gate.needsHuman
};
