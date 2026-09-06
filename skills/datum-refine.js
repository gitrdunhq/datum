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
var refine_questions_default = 'QUESTIONS writer. Generate clarifying questions from detected gaps.\n\nGaps to address:\n{{gaps}}\n\nAssumptions to validate:\n{{assumptions}}\n\nAmbiguity level: {{ambiguityLevel}}\n\nExisting QUESTIONS.md (empty if none):\n{{existingQuestions}}\n\nCARRY-FORWARD RULE \u2014 answered questions are operator decisions:\n- Keep every existing section, question, context block and `[Answer]:` line VERBATIM, in place. Never rewrite, renumber or drop an answered question.\n- Do not ask again anything an existing answer already settles; treat those answers as facts.\n- Add only genuinely new questions, under a new `## Refine \u2014 {{date}}` heading appended after the existing content, numbered after the highest existing Qn.\n- The workflow verifies every previously answered line still exists before committing; a dropped answer fails the phase.\n\nWrite a QUESTIONS.md following this format:\n\n## Refine \u2014 {{date}}\n\n### Q1: [Category] Question text?\n> Context explaining why this matters and what depends on the answer.\n\n[Answer]:\n\n### Q2: [Category] ...\n\nRULES:\n- Each question addresses one specific gap or assumption\n- Categories: Scope, Architecture, Behavior, NFR, Integration, Security\n- The context block must explain what decision hinges on the answer\n- Anchor assumptions: "I\'m assuming X \u2014 is that right, or Y?"\n- If there are no gaps (trivial/low ambiguity), write: "No clarifying questions needed \u2014 intent is clear."\n\nOutput the full QUESTIONS.md content as markdown. No JSON wrapping.\n';

// skills/src/shared/sha1.ts
function rotl(x, n) {
  return (x << n | x >>> 32 - n) >>> 0;
}
function sha1Hex(bytes) {
  const msgBitsLow = bytes.length * 8 >>> 0;
  const msgBitsHigh = Math.floor(bytes.length * 8 / 4294967296) >>> 0;
  const padded = bytes.slice();
  padded.push(128);
  while (padded.length % 64 !== 56) padded.push(0);
  padded.push(
    msgBitsHigh >>> 24 & 255,
    msgBitsHigh >>> 16 & 255,
    msgBitsHigh >>> 8 & 255,
    msgBitsHigh & 255,
    msgBitsLow >>> 24 & 255,
    msgBitsLow >>> 16 & 255,
    msgBitsLow >>> 8 & 255,
    msgBitsLow & 255
  );
  let h0 = 1732584193;
  let h1 = 4023233417;
  let h2 = 2562383102;
  let h3 = 271733878;
  let h4 = 3285377520;
  const w = new Array(80).fill(0);
  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    for (let i = 0; i < 16; i++) {
      const o = chunkStart + i * 4;
      w[i] = (padded[o] << 24 | padded[o + 1] << 16 | padded[o + 2] << 8 | padded[o + 3]) >>> 0;
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    let a2 = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) {
        f = b & c | ~b & d;
        k = 1518500249;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 1859775393;
      } else if (i < 60) {
        f = b & c | b & d | c & d;
        k = 2400959708;
      } else {
        f = b ^ c ^ d;
        k = 3395469782;
      }
      const temp = rotl(a2, 5) + f + e + k + w[i] >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a2;
      a2 = temp;
    }
    h0 = h0 + a2 >>> 0;
    h1 = h1 + b >>> 0;
    h2 = h2 + c >>> 0;
    h3 = h3 + d >>> 0;
    h4 = h4 + e >>> 0;
  }
  const toHex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}
function gitBlobSha(bytes) {
  const header = `blob ${bytes.length}\0`;
  const headerBytes = [];
  for (let i = 0; i < header.length; i++) headerBytes.push(header.charCodeAt(i));
  return sha1Hex(headerBytes.concat(bytes));
}

// skills/src/shared/utf8.ts
function utf8Encode(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 56320 && d <= 57343) {
        c = 65536 + (c - 55296 << 10) + (d - 56320);
        i++;
      }
    }
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
    else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    else out.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  return out;
}
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
  const inner = innerBatchScript(steps);
  const sha = gitBlobSha(utf8Encode(inner));
  const rootGuard = batchRoot ? [`cd ${shellQuote(batchRoot)} 2>/dev/null || { printf '[{"name":"__script","exit_code":1,"stdout":"","stderr":"batch_root_missing: %s"}]\\n' ${shellQuote(batchRoot)}; exit 0; }`] : [];
  return [
    ...rootGuard,
    `__f=$(mktemp); trap 'rm -f "$__f"' EXIT`,
    `cat > "$__f" <<'${BATCH_EOF}'`,
    inner.replace(/\n$/, ""),
    BATCH_EOF,
    '__h=$(git hash-object "$__f" 2>&1)',
    // Sourced, not `bash "$__f"`: the steps keep running in the invoking
    // shell, so anything defined before the script (the tests' `__root=`
    // prelude, a `cd`) is visible exactly as it was before the wrapper.
    `if [ "$__h" != "${sha}" ]; then printf '[{"name":"__script","exit_code":1,"stdout":"","stderr":"batch_script_corrupt: expected %s, got %s"}]\\n' "${sha}" "$__h"; else . "$__f"; fi`
  ].join("\n") + "\n";
}
var BATCH_EOF = "DATUM_BATCH_EOF";
function shellQuote(s) {
  return `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
}
var batchRoot = "";
function setBatchRoot(root) {
  batchRoot = typeof root === "string" ? root.trim() : "";
}
function innerBatchScript(steps) {
  validateBatchSteps(steps);
  for (const s of steps) {
    if (s.command.split("\n").some((l) => l.trim() === BATCH_EOF)) throw new Error(`batch: step "${s.name}" contains the heredoc delimiter ${BATCH_EOF}`);
  }
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
  if (results.length === 1 && results[0].name === "__script" && results[0].exit_code !== 0) {
    const scriptError = results[0].stderr;
    return scriptError.startsWith("batch_script_corrupt") ? { steps: [], failed: null, missing: true, corrupt: scriptError, scriptError } : { steps: [], failed: null, missing: true, scriptError };
  }
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
function isRunnerRefusal(reply) {
  return REFUSAL_RE.test(reply);
}
function describeFailure(r, label) {
  if (r.missing) {
    if (r.corrupt) return `${label}: batch_script_corrupt \u2014 the runner did not run the script it was given (${r.corrupt})`;
    if (r.scriptError) return `${label}: ${r.scriptError}`;
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

// skills/src/shared/commit-steps.ts
var q = (s) => `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
var NOTHING_TO_COMMIT = "NOTHING_TO_COMMIT";
function commitFilesSteps(o) {
  if (/co-authored-by|claude-session|signed-off-by/i.test(o.message)) {
    throw new Error(`commit message must not carry a trailer (policy): ${JSON.stringify(o.message)}`);
  }
  if (/["`$\\]/.test(o.message)) {
    throw new Error(`commit message must not contain quotes, backticks, $ or backslashes: ${JSON.stringify(o.message)}`);
  }
  if (o.files.length === 0) throw new Error("commitFilesSteps: no files to commit");
  const wt = q(o.wt);
  const files = o.files.map(q).join(" ");
  return [
    { name: "status", command: `git -C ${wt} status --porcelain -- ${files}`, tolerant: true },
    { name: "add", command: `git -C ${wt} add -- ${files}` },
    {
      name: "commit",
      command: `if git -C ${wt} diff --cached --quiet -- ${files}; then echo ${NOTHING_TO_COMMIT}; else git -C ${wt} commit -q -m ${q(o.message)} -- ${files} && echo COMMITTED; fi`,
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
  const commit = stepResult(result, "commit");
  if (!commit) return { ...none, error: "commit_failed: commit step did not run" };
  const out = (commit.stdout || "").trim();
  if (out.split("\n").includes(NOTHING_TO_COMMIT)) return { ...none, nothingToCommit: true };
  if (commit.exit_code !== 0) {
    return { ...none, error: `commit_failed: git commit exited ${commit.exit_code}: ${(commit.stderr || commit.stdout || "").trim().split("\n").slice(-3).join(" | ")}` };
  }
  const sha = (stepStdout(result, "sha") || "").trim();
  if (!sha) return { ...none, error: "commit_failed: commit exited 0 but no sha was printed" };
  return { committed: true, nothingToCommit: false, sha, error: "" };
}

// skills/src/shared/agents.ts
async function runBatch(steps, opts, deps) {
  const agentFn = deps?.agentFn ?? agent;
  const logFn = deps?.logFn ?? log;
  const prompt = batchCommandPrompt(steps);
  let result = parseBatchResult(await agentFn(prompt, opts), steps);
  if (result.missing && result.refusal && isRunnerRefusal(result.refusal)) {
    const label = opts.label || "batch";
    logFn(`[runBatch] ${label}: runner_permission_denied on attempt 1 ("${result.refusal.replace(/\s+/g, " ").slice(0, 120)}") \u2014 retrying once with a fresh runner`);
    const retryOpts = { ...opts, label: `${label}:retry` };
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner refused this batch`, retryOpts), steps);
  }
  if (result.missing && result.corrupt) {
    const label = opts.label || "batch";
    logFn(`[runBatch] ${label}: batch_script_corrupt on attempt 1 (${result.corrupt}) \u2014 retrying once with a fresh runner`);
    const retryOpts = { ...opts, label: `${label}:retry` };
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner mistyped this script; copy it exactly`, retryOpts), steps);
  }
  return result;
}

// skills/src/shared/context-relay.ts
var CONTEXT_RELAY_BUDGET_BYTES = 16 * 1024;
var NOT_FOUND_MARKER = "__DATUM_CTXFILE_NOT_FOUND__";
function q2(p) {
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
      command: `if [ -f ${q2(relPath)} ]; then wc -c < ${q2(relPath)} | tr -d ' '; else printf -- '-1'; fi`,
      tolerant: true
    });
    steps.push({
      name: `ctx-sha-${i}`,
      command: `if [ -f ${q2(relPath)} ]; then git hash-object ${q2(relPath)}; else printf ''; fi`,
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
      command: `if [ -f ${q2(relPath)} ]; then cat ${q2(relPath)}; else printf '%s' '${NOT_FOUND_MARKER}'; fi`,
      tolerant: true
    });
    steps.push({
      name: `ctx-wc-${i}`,
      command: `if [ -f ${q2(relPath)} ]; then wc -c < ${q2(relPath)} | tr -d ' '; else printf -- '-1'; fi`,
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
  const mismatched = [];
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
  const defer = (relPath, why) => {
    mismatched.push(relPath);
    files[relPath] = { path: relPath, exists: true, inlined: false, bytes: plan.bytes[relPath], sha: plan.sha[relPath], content: null };
    warnings.push(`context_relay_mismatch: ${why} \u2014 deferred to the consuming agent`);
  };
  plan.inline.forEach((relPath, i) => {
    const raw = stepStdout(inline, `ctx-cat-${i}`);
    const declaredRaw = stepStdout(inline, `ctx-wc-${i}`);
    const declared = declaredRaw === null ? NaN : parseInt(declaredRaw.trim(), 10);
    if (raw === null || raw === NOT_FOUND_MARKER || declared === -1) {
      defer(relPath, `${relPath} existed at probe time (${plan.bytes[relPath]} bytes) but the inline read found nothing`);
      return;
    }
    const expected = plan.bytes[relPath];
    const sha = plan.sha[relPath];
    let content = raw;
    let actual = utf8ByteLength(raw);
    if (actual === expected - 1 && sha && gitBlobSha(utf8Encode(raw + "\n")) === sha) {
      content = raw + "\n";
      actual = expected;
      warnings.push(`context file ${relPath}: trailing newline restored (runner returned ${expected - 1} of ${expected} bytes; blob sha verified)`);
    }
    if (actual !== expected || Number.isFinite(declared) && declared !== expected) {
      defer(relPath, `${relPath} expected ${expected} bytes, got ${actual} bytes`);
      return;
    }
    if (sha && gitBlobSha(utf8Encode(content)) !== sha) {
      defer(relPath, `${relPath} relayed ${actual} bytes as expected but the blob sha differs from the probe's (content rewritten in transit)`);
      return;
    }
    files[relPath] = { path: relPath, exists: true, inlined: true, bytes: expected, sha, content };
  });
  return { branch, epicDir: epicDir2, files, warnings, mismatched };
}
function contextInlineRetryPrompt(steps) {
  return `${batchCommandPrompt(steps)}

# attempt 2 of 2 \u2014 the previous runner returned one of these files with bytes missing; copy the script's output verbatim, every byte`;
}
function mergeRelayRetry(first, second) {
  const files = { ...first.files };
  const warnings = [...first.warnings];
  const mismatched = [];
  for (const relPath of first.mismatched) {
    const retried = second.files[relPath];
    if (retried && retried.inlined && retried.content !== null) {
      files[relPath] = retried;
      warnings.push(`context file ${relPath}: re-fetched intact on attempt 2 (blob sha verified)`);
    } else {
      mismatched.push(relPath);
      warnings.push(`context file ${relPath}: mismatched on both attempts \u2014 deferred to the consuming agent (path + bytes + mandatory Read with a witness)`);
    }
  }
  return { branch: first.branch, epicDir: first.epicDir, files, warnings, mismatched };
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

// skills/src/shared/questions-steps.ts
var QUESTION_RE = /^###\s+Q\d+\s*:/;
var ANSWER_RE = /^\[Answer\]:\s*(.*)$/;
function answeredQuestions(content) {
  const out = [];
  let current = null;
  for (const raw of (content || "").split("\n")) {
    const line = raw.trimEnd();
    if (QUESTION_RE.test(line)) {
      current = line;
      continue;
    }
    const m = ANSWER_RE.exec(line);
    if (m && current && m[1].trim()) {
      out.push({ question: current, answer: line });
      current = null;
    }
  }
  return out;
}
function q3(p) {
  return `"${p.replace(/(["\\`$])/g, "\\$1")}"`;
}
function answersKeptSteps(questionsPath, answered) {
  return answered.map((a2, i) => ({
    name: `answer-kept-${i}`,
    command: `ANSWER=$(mktemp)
cat > "$ANSWER" <<'ANSWER_EOF'
${a2.answer}
ANSWER_EOF
grep -c -F -x -f "$ANSWER" ${q3(questionsPath)} 2>/dev/null || echo 0`,
    tolerant: true
  }));
}
function answersKeptFromSteps(result, answered) {
  if (answered.length === 0) return { ok: true, error: "", dropped: [] };
  if (result.missing) {
    return { ok: false, error: `refine_answers_dropped: ${describeFailure(result, "answers-kept batch")} \u2014 cannot confirm the ${answered.length} answered question(s) survived the rewrite`, dropped: answered.map((a2) => a2.question) };
  }
  const dropped = [];
  answered.forEach((a2, i) => {
    const rec = stepResult(result, `answer-kept-${i}`);
    const count = rec ? parseInt(rec.stdout.trim(), 10) : NaN;
    if (!Number.isFinite(count) || count < 1) dropped.push(a2.question);
  });
  if (dropped.length === 0) return { ok: true, error: "", dropped: [] };
  return {
    ok: false,
    error: `refine_answers_dropped: ${dropped.length} of ${answered.length} answered questions missing from the rewritten QUESTIONS.md: ${dropped.join(" | ")}`,
    dropped
  };
}

// skills/src/datum-refine.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
var issueNumber = typeof a.issueNumber === "number" ? a.issueNumber : null;
var freeText = typeof a.freeText === "string" ? a.freeText : "";
if (a.agentTypes && typeof a.agentTypes === "object") configureAgentTypes(a.agentTypes);
setBatchCacheKey(a.configFingerprint || "");
setBatchRoot(typeof a.repoRoot === "string" ? a.repoRoot : "");
phase("Read");
var TICKET_REL = "docs/epics/$__eb/TICKET.md";
var QUESTIONS_REL = "docs/epics/$__eb/QUESTIONS.md";
var probeSteps = contextProbeSteps({
  files: [TICKET_REL, QUESTIONS_REL],
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
var relayPlan = contextRelayPlan(readBatch, [TICKET_REL, QUESTIONS_REL]);
if (!(a.agentTypes && typeof a.agentTypes === "object")) {
  const agentTypesRaw = (stepStdout(readBatch, "agent-types") || "").trim();
  configureAgentTypes({ agentTypes: agentTypesRaw !== "false" });
}
var inlineBatch = null;
var inlineSteps = contextInlineSteps(relayPlan.inline);
if (relayPlan.inline.length > 0) {
  inlineBatch = parseBatchResult(
    await agent(batchCommandPrompt(inlineSteps), stageOpts("cli", { label: "read-context-files", model: model("fast") })),
    inlineSteps
  );
}
var ctx = contextFromRelay(readBatch, inlineBatch, relayPlan);
if (ctx.mismatched.length > 0) {
  log(`read-context: context_relay_mismatch on ${ctx.mismatched.join(", ")} \u2014 re-fetching once with a fresh runner`);
  const retryBatch = parseBatchResult(
    await agent(contextInlineRetryPrompt(inlineSteps), stageOpts("cli", { label: "read-context-files:retry", model: model("fast") })),
    inlineSteps
  );
  ctx = mergeRelayRetry(ctx, contextFromRelay(readBatch, retryBatch, relayPlan));
}
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
var questionsFile = ctx.files[QUESTIONS_REL];
var earlyGateSteps = gateSteps("refine", " --approve");
var earlyGate = parseGateResult(await runBatch(earlyGateSteps, stageOpts("cli", { label: "gate-early", model: model("fast") })));
var alreadyComplete = earlyGate.passed;
if (alreadyComplete) {
  log(`refine_already_complete: SPEC.md and QUESTIONS.md in ${epicDir} pass the refine gate \u2014 not regenerating (answered questions are operator decisions)`);
}
async function refineFromTicket() {
  phase("Analyze");
  const hasAddenda = parseInt((stepStdout(readBatch, "has-addenda") || "0").trim(), 10) > 0;
  let triageResult = {
    original_scope: "",
    addenda: [],
    roadmap_items: [],
    merged_requirements: []
  };
  async function commitRefineFiles(files, message, label, opts = { allowUnchanged: true }) {
    const commitStepList = commitFilesSteps({ wt: ".", files, message });
    const commit = commitFilesFromSteps(parseBatchResult(
      await agent(batchCommandPrompt(commitStepList), stageOpts("cli", { label, model: model("fast") })),
      commitStepList
    ));
    if (commit.error) throw new Error(`refine_commit_failed: ${commit.error}`);
    if (commit.nothingToCommit) {
      if (!opts.allowUnchanged) throw new Error(`refine_commit_failed: nothing to commit for ${label} (${files.join(", ")}) \u2014 the agent did not write them`);
      log(`${label}: ${files.join(", ")} unchanged since the last run \u2014 already committed`);
      return "unchanged";
    }
    return commit.sha;
  }
  if (hasAddenda) {
    const triageRaw = await agent(
      renderPrompt(refine_triage_default, { ticketPath }) + `

ADDITIONAL TASK: If any addenda are triaged as "roadmap" (different feature), also:
1. Read ROADMAP.md
2. Append the roadmap items under "## Planned"
Do NOT git add or git commit anything \u2014 the workflow commits ROADMAP.md after you return.`,
      { label: "triage-addenda", model: model("balanced") }
    );
    triageResult = parseAgentJsonStrict(triageRaw, "triage-addenda");
    log(`Triage: ${triageResult.addenda.length} addenda, ${triageResult.roadmap_items.length} roadmapped`);
    if (triageResult.roadmap_items.length > 0) {
      const roadmapCommit = await commitRefineFiles(["ROADMAP.md"], "roadmap: triage items from refine", "commit-roadmap", { allowUnchanged: false });
      log(`ROADMAP.md committed (${roadmapCommit})`);
    }
  } else {
    log("No addenda \u2014 single-scope TICKET");
  }
  const classifyRaw = await agent(
    renderPrompt(refine_classify_default, { ticketContent }) + contextWitnessInstruction([ticketFile]),
    { label: "classify-ambiguity", model: model("fast") }
  );
  const classify = parseAgentJsonStrict(classifyRaw, "classify-ambiguity");
  assertReadWitness([ticketFile], classify);
  log(`Ambiguity: ${classify.level} \u2014 ${classify.reasoning}`);
  const requirements = triageResult.merged_requirements.length > 0 ? triageResult.merged_requirements.join("\n") : ticketContent;
  const scanRaw = await agent(
    renderPrompt(refine_scan_default, { wt: ".", requirements }),
    { label: "scan-codebase", model: model("balanced") }
  );
  const scanResults = typeof scanRaw === "string" ? scanRaw : JSON.stringify(scanRaw);
  phase("Write");
  const timestamp = stepStdout(readBatch, "timestamp") || "";
  const today = timestamp ? timestamp.slice(0, 10) : "(date unavailable)";
  const specPath = `${epicDir}/SPEC.md`;
  const questionsPath = `${epicDir}/QUESTIONS.md`;
  const specRaw = await agent(
    `You have TWO tasks. Do them in order.

TASK 1 \u2014 Write SPEC.md:
${renderPrompt(refine_spec_default, {
      ticketContent,
      scanResults,
      ambiguityLevel: classify.level,
      gaps: classify.gaps.join("\n"),
      assumptions: classify.assumptions.join("\n")
    })}

Write the SPEC to "${specPath}" (create dirs if needed).

TASK 2 \u2014 Write QUESTIONS.md:
${renderPrompt(refine_questions_default, {
      gaps: classify.gaps.join("\n"),
      assumptions: classify.assumptions.join("\n"),
      ambiguityLevel: classify.level,
      date: today,
      existingQuestions: questionsFile.exists ? contextSlot(questionsFile) : "(none)"
    })}

Write the QUESTIONS to "${questionsPath}".

Do NOT git add or git commit anything \u2014 the workflow commits both files after you return.
Your response is raw JSON only (no markdown fences, no prose): {"written": ["${specPath}", "${questionsPath}"]}` + contextWitnessInstruction([ticketFile]),
    { label: "write-spec-and-questions", model: model("balanced") }
  );
  const spec = parseAgentJsonStrict(specRaw, "write-spec-and-questions");
  assertReadWitness([ticketFile], spec);
  for (const p of [specPath, questionsPath]) {
    if (!Array.isArray(spec.written) || !spec.written.includes(p)) {
      throw new Error(`refine_write_failed: agent did not report writing ${p} (reported: ${JSON.stringify(spec.written)})`);
    }
  }
  if (questionsFile.exists && !questionsFile.inlined) {
    log(`refine_answers_unchecked: ${questionsPath} (${questionsFile.bytes} bytes) was over the relay budget \u2014 answered questions could not be verified against the rewrite`);
  }
  const answered = questionsFile.exists && questionsFile.inlined ? answeredQuestions(questionsFile.content || "") : [];
  if (answered.length > 0) {
    const keptSteps = answersKeptSteps(questionsPath, answered);
    const kept = answersKeptFromSteps(await runBatch(keptSteps, stageOpts("cli", { label: "answers-kept", model: model("fast") })), answered);
    if (!kept.ok) throw new Error(kept.error);
    log(`${answered.length} previously answered question(s) carried forward verbatim`);
  }
  const specCommit = await commitRefineFiles([`${epicDir}/SPEC.md`, `${epicDir}/QUESTIONS.md`], "refine: write SPEC.md + QUESTIONS.md", "commit-spec");
  log(`SPEC.md + QUESTIONS.md written to ${epicDir} and committed (${specCommit})`);
  return { classify, triageResult };
}
var outcome = alreadyComplete ? null : await refineFromTicket();
var gateStepList = gateSteps("refine", yolo ? " --approve" : "");
var gate = parseGateResult(await runBatch(gateStepList, stageOpts("cli", { label: "gate", model: model("fast") })));
if (gate.passed) log("Refine gate PASSED");
else log(`Refine gate: ${gate.message || "needs review"}${gate.needsHuman ? " (needs human approval)" : ""}${gate.hardStop ? " (hard stop)" : ""}`);
return {
  branch: ctx.branch,
  epicDir,
  ambiguity: outcome ? outcome.classify.level : "unchanged",
  gaps: outcome ? outcome.classify.gaps : [],
  roadmapItems: outcome ? outcome.triageResult.roadmap_items : [],
  alreadyComplete,
  gatePassed: gate.passed,
  gateMessage: gate.message,
  gateNeedsHuman: gate.needsHuman
};
