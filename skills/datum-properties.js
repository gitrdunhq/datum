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
var properties_derive_default = "Properties deriver. Map every SPEC requirement to testable invariants across 11 categories.\n\nPROPERTY CATEGORIES:\n1. SAFETY \u2014 what must NEVER happen\n2. LIVENESS \u2014 what must EVENTUALLY happen\n3. INVARIANT \u2014 what must ALWAYS be true\n4. BOUNDARY \u2014 valid input ranges\n5. IDEMPOTENT \u2014 what is safe to run twice\n6. ORDERING \u2014 order invariants\n7. ISOLATION \u2014 what cannot leak between contexts\n8. PERFORMANCE \u2014 latency/throughput/size bounds\n9. SECURITY \u2014 access controls\n10. OBSERVABILITY \u2014 what must be logged or measured\n11. COMPATIBILITY \u2014 existing behavior that must be preserved\n\nFor each requirement in the SPEC, derive at least one property from each applicable category.\nFormat: PROPERTY(TYPE-NNN): <testable predicate>\n\nThen build a traceability table mapping each property to the task(s) that must prove it.\nEvery task must have at least one property. If a task has no testable property, flag it.\n\nThe full PROPERTIES.md content is markdown with:\n1. Property list grouped by category\n2. Traceability table: Property ID | Category | Predicate | Task IDs\n3. Per-task property assignments\n4. A required `## Integration Invariants` section \u2014 a table with header `| ID | Invariant | Covers | Source |`, a separator row, and one row per cross-task invariant. `ID` is a short unique tag; `Invariant` is a testable predicate spanning two or more tasks; `Covers` is a comma-separated list of the task ids it spans; `Source` is either `spec:<requirement>` (must cover 2+ tasks) or `question:Q<n>` for an invariant that answers a specific QUESTIONS.md id. Emit exactly one `question:Q<n>` row per answered question in the QUESTIONS.md section below (a question whose `[Answer]:` line is present and non-empty); an unanswered question or one with an empty answer yields no row. The gate fails on a missing or duplicated row per answered question. This table is mandatory \u2014 the gate fails without it, even if there are no genuine cross-task invariants (in that case still include the heading with a header/separator row and zero data rows).\n\nWrite that markdown to the file named in the instructions after the inputs below; your response itself is the JSON receipt described there.\n\nINPUTS\nSPEC content:\n{{specContent}}\n\nTASKS (for traceability):\n{{tasksContent}}\n\nQUESTIONS.md (Refine's answered questions; each answered one becomes an Integration Invariant):\n{{questionsContent}}\n";

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
  const toolPath = 'export PATH="$PATH:${DATUM_BATCH_TOOL_PREFIXES:-/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin}"';
  const jqGuard = `if ! jq --version >/dev/null 2>&1; then printf '[{"name":"__script","exit_code":1,"stdout":"","stderr":"batch_tool_missing: jq is not on the runner PATH (set DATUM_BATCH_TOOL_PREFIXES or install jq)"}]\\n'; exit 0; fi`;
  return [
    ...rootGuard,
    toolPath,
    jqGuard,
    `__f=$(mktemp); trap 'rm -f "$__f"' EXIT`,
    `cat > "$__f" <<'${BATCH_EOF}'`,
    inner.replace(/\n$/, ""),
    BATCH_EOF,
    '__h=$(git hash-object "$__f" 2>&1)',
    // `bash "$__f"`, not sourced: the runner's Bash tool was zsh 5.9 on the
    // datum host (2026-09-07) and zsh refused to source the file with exit
    // 126 while bash ran it — every "boot refused the script" halt of the
    // week. The wrapper's cwd and exported PATH reach the child; a prelude
    // variable must be exported to be seen (the tests' `export __root=`).
    `if [ "$__h" != "${sha}" ]; then printf '[{"name":"__script","exit_code":1,"stdout":"","stderr":"batch_script_corrupt: expected %s, got %s"}]\\n' "${sha}" "$__h"; else bash "$__f"; fi`
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
    // #517: jq's exit is checked. A step jq cannot encode is still recorded —
    // without jq (name and exit code are validated/numeric, so a literal is
    // safe) and named on stderr — instead of vanishing from the array.
    `__rec() { __n=$(printf '%s' "$__r" | jq -c --arg n "$1" --argjson c "$2" --rawfile o "$__bo" --rawfile e "$__be" '. + [{name:$n, exit_code:$c, stdout:$o, stderr:$e}]') && __r="$__n" || { __sep=","; [ "$__r" = "[]" ] && __sep=""; __r="\${__r%]}\${__sep}{\\"name\\":\\"$1\\",\\"exit_code\\":$2,\\"stdout\\":\\"\\",\\"stderr\\":\\"batch_rec_failed: jq could not record this step (exit $2; output lost, likely not valid UTF-8)\\"}]"; }; }`,
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
var BATCH_TOOL_TIMEOUT_MS = 6e5;
var TIMEOUT_RE = /timed out after|"error"\s*:\s*"timeout"|Command timed out/i;
function batchCommandPrompt(steps) {
  return `Run exactly this script with the Bash tool in ONE invocation, with the Bash tool's timeout parameter ${BATCH_TOOL_TIMEOUT_MS} (the script may run a whole test suite; the default two minutes is too short), and return only its stdout, nothing else. Do not run the steps one at a time, do not retry or "fix" a failing step, do not ask for clarification, do not message anyone, do not summarise or explain \u2014 this prompt is the whole task. The script prints one JSON array (one object per step: name, exit_code, stdout, stderr); a non-zero exit_code is data to return, not a problem to solve.

` + (cacheKey ? `(inputs fingerprint ${cacheKey} \u2014 informational, do not act on it)

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
    const text = typeof raw === "string" ? raw.replace(/```[a-z]*/gi, "").trim() : "";
    if (!text) return { steps: [], failed: null, missing: true };
    const prose = raw.trim();
    if (TIMEOUT_RE.test(prose)) {
      return { steps: [], failed: null, missing: true, scriptError: `batch_timeout: the runner's shell cut the script before it finished (runner said: "${prose.replace(/\s+/g, " ").slice(0, 160)}"); the Bash tool must be called with timeout ${BATCH_TOOL_TIMEOUT_MS}` };
    }
    const exited = /exit(?:ed)?(?: with)? code (\d+)/i.exec(prose);
    if (exited && /\b126\b|cannot execute|failed to execute/i.test(prose)) {
      return { steps: [], failed: null, missing: true, refusal: prose, scriptError: `batch_script_failed: the batch script exited ${exited[1]} before any step ran (the host shell refused to execute it; runner said: "${prose.replace(/\s+/g, " ").slice(0, 160)}")` };
    }
    return { steps: [], failed: null, missing: true, refusal: prose };
  }
  const results = arr.map(asStepResult).filter((r) => r !== null);
  if (results.length === 0) return { steps: [], failed: null, missing: true };
  if (results.length === 1 && results[0].name === "__script" && results[0].exit_code !== 0) {
    const { exit_code, stderr } = results[0];
    const guard = /^batch_(script_corrupt|root_missing|tool_missing)\b/.test(stderr.trim());
    const scriptError = guard ? stderr.trim() : `batch_script_failed: the batch script exited ${exit_code} before any step ran (the host shell refused to execute it; exit 126 is "cannot execute")${stderr.trim() ? `; runner said: "${stderr.trim().replace(/\s+/g, " ").slice(0, 160)}"` : ""}`;
    return scriptError.startsWith("batch_script_corrupt") ? { steps: [], failed: null, missing: true, corrupt: scriptError, scriptError } : { steps: [], failed: null, missing: true, scriptError };
  }
  const tolerant = new Set(steps.filter((s) => s.tolerant).map((s) => s.name));
  const recFailed = results.find((r) => r.stderr.startsWith("batch_rec_failed:")) ?? null;
  const failed = recFailed ?? results.find((r) => r.exit_code !== 0 && !tolerant.has(r.name)) ?? null;
  const last = results[results.length - 1];
  const stoppedByFailFast = failed !== null && last?.name === failed.name && !tolerant.has(failed.name);
  if (results.length < steps.length && !stoppedByFailFast) {
    const returned = new Set(results.map((r) => r.name));
    const absent = steps.map((s) => s.name).filter((n) => !returned.has(n));
    return {
      steps: [],
      failed: null,
      missing: true,
      scriptError: `batch_incomplete: ${results.length} of ${steps.length} step records returned and no non-tolerant failure stopped the batch \u2014 the runner returned a partial result (last record: ${last?.name ?? "none"}); absent: [${absent.join(", ")}]`
    };
  }
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
    if (!r.refusal) return `${label}: runner_empty_result \u2014 batch agent returned no parseable result (empty reply)`;
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
  // #341 task-001: a structural lane's single writing stage. Not
  // datum-refactor — that definition says "clean up without changing
  // behaviour" and its pre-check answered "nothing to improve" on a file
  // that did not exist yet, so docs-only lanes completed with no commit.
  structural: "datum-structural",
  skeptic: "datum-skeptic",
  // #375: the Review lenses. Not datum-skeptic — that definition's body is
  // the lane panel's (read .datum/lane-spec.json, emit a read_witness, answer
  // PASS/FRAGILE/BROKEN), while a lens reads the epic diff and answers with a
  // findings array. Same read-only shape, plus a Bash matcher: the lens that
  // broke a run did it with `git checkout`, which Edit|Write cannot see.
  review: "datum-reviewer",
  reflect: "datum-reflect",
  docs: "datum-docs",
  reader: "datum-reader",
  // Read-only LLM *judges* (refactor pre-check, docs-staleness check). They
  // are not datum-reader: that definition says "read one file, return its
  // contents, do not interpret" at maxTurns 4, and these calls read every
  // file a lane touched and answer a rubric.
  quality: "datum-quality-reader",
  cli: "datum-cli"
};
var READ_ONLY_STAGES = ["skeptic", "review", "reflect", "reader", "quality", "cli"];
var READ_ONLY_AGENT_TYPES = new Set(READ_ONLY_STAGES.map((s) => AGENT_TYPE_TABLE[s]));
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

// skills/src/shared/agents.ts
var LARGE_BATCH_BYTES = 8 * 1024;
async function runBatch(steps, opts, deps) {
  const agentFn = deps?.agentFn ?? agent;
  const logFn = deps?.logFn ?? log;
  const prompt = batchCommandPrompt(steps);
  const promptBytes = utf8ByteLength(prompt);
  if (promptBytes > LARGE_BATCH_BYTES && opts.model !== model("balanced") && opts.model !== model("deep")) {
    logFn(`[runBatch] ${opts.label || "batch"}: ${promptBytes}-byte script routed to the balanced model (over ${LARGE_BATCH_BYTES} bytes, a fast-runner transcription slip is likely)`);
    opts = { ...opts, model: model("balanced") };
  }
  let result = parseBatchResult(await agentFn(prompt, opts), steps);
  const label = opts.label || "batch";
  const retryOpts = { ...opts, label: `${label}:retry` };
  if (result.missing && result.refusal && isRunnerRefusal(result.refusal)) {
    logFn(`[runBatch] ${label}: runner_permission_denied on attempt 1 ("${result.refusal.replace(/\s+/g, " ").slice(0, 120)}") \u2014 retrying once with a fresh runner`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner refused this batch`, retryOpts), steps);
  } else if (result.missing && result.corrupt) {
    logFn(`[runBatch] ${label}: batch_script_corrupt on attempt 1 (${result.corrupt}) \u2014 retrying once on the balanced model`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner mistyped this script; copy it exactly`, { ...retryOpts, model: model("balanced") }), steps);
  } else if (result.missing && !result.refusal && !result.scriptError) {
    logFn(`[runBatch] ${label}: runner_empty_result on attempt 1 (the runner returned nothing parseable) \u2014 retrying once with a fresh runner`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner returned nothing; return the script's stdout`, retryOpts), steps);
  } else if (result.missing && result.scriptError?.startsWith("batch_script_failed")) {
    logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 1 \u2014 retrying with a fresh runner (up to two retries)`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 3 \u2014 the previous runner's shell refused to execute the script; run it again`, retryOpts), steps);
    if (result.missing && result.scriptError?.startsWith("batch_script_failed")) {
      logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 2 \u2014 last retry with a fresh runner`);
      result = parseBatchResult(await agentFn(`${prompt}

# attempt 3 of 3 \u2014 two runners' shells refused to execute the script; run it again`, { ...opts, label: `${label}:retry2` }), steps);
    }
  } else if (result.missing && result.scriptError?.startsWith("batch_timeout")) {
    logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 1 \u2014 retrying once with the timeout instruction repeated`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner's shell cut the script short; call the Bash tool with timeout 600000 and let the script finish`, retryOpts), steps);
  } else if (result.missing && /^batch_(root_missing|tool_missing)/.test(result.scriptError || "")) {
    logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 1 \u2014 retrying once with a fresh runner (a guard row is not trusted until it repeats)`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 run the script exactly; if its guard prints a row, return that row, never one you wrote`, retryOpts), steps);
  }
  return result;
}

// skills/src/shared/plan-steps.ts
var q2 = (s) => `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
function lanePlanCommand(epicDir2) {
  return `datum lane-plan --input ${q2(`${epicDir2}/tasks.json`)} --output ${q2(`${epicDir2}/lane-plan.json`)} --md-output ${q2(`${epicDir2}/TASKS.md`)} --properties ${q2(`${epicDir2}/PROPERTIES.md`)}`;
}

// skills/src/shared/context-relay.ts
var CONTEXT_RELAY_BUDGET_BYTES = 16 * 1024;
var NOT_FOUND_MARKER = "__DATUM_CTXFILE_NOT_FOUND__";
function q3(p) {
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
      command: `if [ -f ${q3(relPath)} ]; then wc -c < ${q3(relPath)} | tr -d ' '; else printf -- '-1'; fi`,
      tolerant: true
    });
    steps.push({
      name: `ctx-sha-${i}`,
      command: `if [ -f ${q3(relPath)} ]; then git hash-object ${q3(relPath)}; else printf ''; fi`,
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
      command: `if [ -f ${q3(relPath)} ]; then cat ${q3(relPath)}; else printf '%s' '${NOT_FOUND_MARKER}'; fi`,
      tolerant: true
    });
    steps.push({
      name: `ctx-wc-${i}`,
      command: `if [ -f ${q3(relPath)} ]; then wc -c < ${q3(relPath)} | tr -d ' '; else printf -- '-1'; fi`,
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
function commonPrefixLen(a2, b) {
  let i = 0;
  while (i < a2.length && i < b.length && a2[i] === b[i]) i++;
  return i;
}
function verifyReadWitness(files, parsed) {
  const deferred = files.filter((f) => f.exists && !f.inlined);
  const witness = extractWitnessMap(parsed);
  const missing = [];
  const mismatched = [];
  const tooShort = [];
  const nearMiss = [];
  const candidates = [...Object.values(witness), ...Object.keys(witness)];
  const hexValues = candidates.filter((v) => typeof v === "string" && /^[0-9a-f]+$/i.test(v));
  const values = hexValues.filter((v) => v.length >= WITNESS_MIN_HEX);
  for (const f of deferred) {
    const sha = f.sha.toLowerCase();
    if (values.some((v) => sha.startsWith(v.toLowerCase()))) continue;
    if (values.some((v) => commonPrefixLen(sha, v.toLowerCase()) >= WITNESS_MIN_HEX)) {
      nearMiss.push(f.path);
      continue;
    }
    const keyed = witness[f.path];
    if (typeof keyed === "string" && /^[0-9a-f]+$/i.test(keyed) && keyed.length < WITNESS_MIN_HEX && sha.startsWith(keyed.toLowerCase())) tooShort.push(f.path);
    else if (hexValues.some((v) => v.length < WITNESS_MIN_HEX && sha.startsWith(v.toLowerCase()))) tooShort.push(f.path);
    else if (typeof keyed === "string" && keyed.length >= WITNESS_MIN_HEX) mismatched.push(f.path);
    else missing.push(f.path);
  }
  return { ok: missing.length === 0 && mismatched.length === 0 && tooShort.length === 0, missing, mismatched, tooShort, nearMiss };
}
function assertReadWitness(files, parsed) {
  const result = verifyReadWitness(files, parsed);
  if (result.ok) return result;
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

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- Test command comes from `.datum/config.json` `test_command` field \u2014 read it, don't guess\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500 lines is a review trigger: split only on a real functional seam, never to hit a number\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (from `.datum/config.json`)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Context Budget\n- When `headroom_compress` and `headroom_retrieve` are available, use them for files over 100 lines: compress after reading, then retrieve with a targeted query when you need a section back. This is the expected path on the local-model runtime. When they are not available, read the file and move on \u2014 never block on them, never report a hash you did not produce\n";

// skills/src/shared/lane-steps.ts
var SCOPE_READ_BUDGET_BYTES = 16 * 1024;
var LANE_PLAN_DIGEST_BUDGET_BYTES = 16 * 1024;

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function withPreamble(text) {
  return PREAMBLE + text;
}

// skills/src/datum-properties.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
if (a.agentTypes && typeof a.agentTypes === "object") configureAgentTypes(a.agentTypes);
setBatchCacheKey(a.configFingerprint || "");
setBatchRoot(typeof a.repoRoot === "string" ? a.repoRoot : "");
phase("Read");
var SPEC_REL = "docs/epics/$__eb/SPEC.md";
var TASKS_REL = "docs/epics/$__eb/TASKS.md";
var QUESTIONS_REL = "docs/epics/$__eb/QUESTIONS.md";
var probeSteps = contextProbeSteps({
  files: [SPEC_REL, TASKS_REL, QUESTIONS_REL],
  extraCommands: [
    { name: "agent-types", command: `jq -r '.agent_types // true' .datum/config.json` }
  ]
});
var readBatch = await runBatch(probeSteps, bootstrapOpts("cli", { label: "read-context", model: model("fast") }));
var relayPlan = contextRelayPlan(readBatch, [SPEC_REL, TASKS_REL, QUESTIONS_REL]);
if (!(a.agentTypes && typeof a.agentTypes === "object")) {
  const agentTypesRaw = (stepStdout(readBatch, "agent-types") || "").trim();
  configureAgentTypes({ agentTypes: agentTypesRaw !== "false" });
}
var inlineBatch = null;
var inlineSteps = contextInlineSteps(relayPlan.inline);
if (relayPlan.inline.length > 0) {
  inlineBatch = await runBatch(inlineSteps, stageOpts("cli", { label: "read-context-files", model: model("fast") }));
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
var specFile = ctx.files[SPEC_REL];
var tasksFile = ctx.files[TASKS_REL];
if (!specFile.exists) throw new Error("SPEC.md not found. Run datum-refine first.");
if (!tasksFile.exists) throw new Error("TASKS.md not found. Run datum-plan first.");
var specContent = contextSlot(specFile);
var tasksContent = contextSlot(tasksFile);
var questionsFile = ctx.files[QUESTIONS_REL];
var questionsContent = questionsFile.exists ? contextSlot(questionsFile) : "(no QUESTIONS.md in this epic: there are no answered questions, so emit no question:Q<n> rows)";
var witnessFiles = questionsFile.exists ? [specFile, tasksFile, questionsFile] : [specFile, tasksFile];
var epicDir = ctx.epicDir;
log(`Branch: ${ctx.branch}, SPEC: ${specFile.bytes} bytes${specFile.inlined ? "" : " (deferred)"}, TASKS: ${tasksFile.bytes} bytes${tasksFile.inlined ? "" : " (deferred)"}`);
phase("Derive");
var propertiesPath = `${epicDir}/PROPERTIES.md`;
var deriveRaw = await agent(
  withPreamble(renderPrompt(properties_derive_default, { specContent, tasksContent, questionsContent }) + `

AFTER DERIVING THE PROPERTIES CONTENT:
1. Write the full PROPERTIES.md markdown to "${propertiesPath}" (create dirs if needed).
2. Do NOT git add or git commit anything in this step \u2014 the workflow commits.
3. Your response is raw JSON only (no markdown fences, no prose): {"written": "${propertiesPath}"}` + contextWitnessInstruction(witnessFiles)),
  { label: "derive", model: model("balanced") }
);
var derive = parseAgentJsonStrict(deriveRaw, "derive");
assertReadWitness(witnessFiles, derive);
if (derive.written !== propertiesPath) {
  throw new Error(`properties_derive_failed: agent reported writing ${JSON.stringify(derive.written)}, expected ${propertiesPath}`);
}
var commitStepList = commitFilesSteps({ wt: ".", files: [`${epicDir}/PROPERTIES.md`], message: "properties: derive PROPERTIES.md" });
var commit = commitFilesFromSteps(await runBatch(commitStepList, stageOpts("cli", { label: "commit-properties", model: model("fast") })));
if (commit.error) throw new Error(`properties_commit_failed: ${commit.error}`);
if (commit.nothingToCommit) log(`PROPERTIES.md unchanged since the last run \u2014 already committed at ${propertiesPath}`);
else log(`PROPERTIES.md written and committed (${commit.sha})`);
var gateStepList = gateSteps("properties", yolo ? " --approve" : "");
var gate = parseGateResult(await runBatch(gateStepList, stageOpts("cli", { label: "gate", model: model("fast") })));
if (gate.passed) log("Properties gate PASSED");
else log(`Properties gate: ${gate.message || "needs review"}${gate.needsHuman ? " (needs human approval)" : ""}${gate.hardStop ? " (hard stop)" : ""}`);
var integrationLanes = 0;
if (gate.passed) {
  const scheduleSteps = [
    { name: "lane-plan", command: lanePlanCommand(epicDir) },
    { name: "int-count", command: `grep -c '"task-INT-' ${JSON.stringify(`${epicDir}/lane-plan.json`)} || true`, tolerant: true },
    ...commitFilesSteps({ wt: ".", files: [`${epicDir}/lane-plan.json`, `${epicDir}/TASKS.md`], message: "properties: schedule integration lanes" })
  ];
  const scheduled = await runBatch(scheduleSteps, stageOpts("cli", { label: "schedule-integration-lanes", model: model("fast") }));
  const lanePlanStep = stepResult(scheduled, "lane-plan");
  if (!lanePlanStep || lanePlanStep.exit_code !== 0) throw new Error(`integration_lanes_failed: datum lane-plan ${lanePlanStep ? `exited ${lanePlanStep.exit_code}` : "did not run"} \u2014 ${describeFailure(scheduled, "schedule-integration-lanes")}`);
  const scheduleCommit = commitFilesFromSteps(scheduled);
  if (scheduleCommit.error) throw new Error(`integration_lanes_failed: ${scheduleCommit.error}`);
  integrationLanes = parseInt((stepStdout(scheduled, "int-count") || "0").trim(), 10) || 0;
  const planGate = parseGateResult(await runBatch(gateSteps("plan", " --approve"), stageOpts("cli", { label: "gate-plan-after-properties", model: model("fast") })));
  if (!planGate.passed) throw new Error(`integration_lanes_failed: plan gate after scheduling: ${planGate.message || "failed"}`);
  log(integrationLanes > 0 ? `integration_lanes_scheduled: ${integrationLanes} task-INT lane(s) in lane-plan.json${scheduleCommit.sha ? ` (${scheduleCommit.sha})` : ""}` : "integration_lanes_none: PROPERTIES.md derived no integration lane");
}
return { branch: ctx.branch, gatePassed: gate.passed, gateMessage: gate.message, gateNeedsHuman: gate.needsHuman, integrationLanes };
