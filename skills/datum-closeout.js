// @generated — DO NOT EDIT. Source: skills/src/datum-closeout.ts
export const meta = {
  name: "datum-closeout",
  description: "Post-merge closeout \u2014 collect data, synthesize artifacts, archive",
  phases: [
    { title: "Collect", detail: "run collectors + read context" },
    { title: "Synthesize", detail: "CURRENT_STATE, CHANGELOG, RETRO, follow-ups, tag, archive" }
  ]
};

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

// skills/src/shared/agent-types.ts
var AGENT_TYPE_TABLE = {
  red: "datum-red",
  green: "datum-green",
  refactor: "datum-refactor",
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
    const text = typeof raw === "string" ? raw.replace(/```[a-z]*/gi, "").trim() : "";
    if (!text) return { steps: [], failed: null, missing: true };
    const prose = raw.trim();
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
    logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 1 \u2014 retrying once with a fresh runner`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner's shell refused to execute the script; run it again`, retryOpts), steps);
  }
  return result;
}

// skills/src/prompts/closeout-synthesize.md
var closeout_synthesize_default = 'Closeout synthesis agent. Read the closeout data and produce post-epic artifacts.\n\nEvery factual claim must be grounded in the files named below. Do not read source files for fresh data. `tasks` may be null and `collector_warnings` may name collectors that did not run: say so in the retro rather than inventing numbers. Task counts come from `tasks.total` / `tasks.completed` for THIS epic only; `ignored_foreign_markers`, if present, are other epics\' lanes and are not this epic\'s work.\n\nReview decisions: quote each ACCEPT/DEFER line from REVIEW-RESPONSE.md verbatim (id, key, reason). Never paraphrase or restate an accepted finding \u2014 a paraphrase of an operator\'s reason is a new claim nobody made.\n\nProduce these artifacts IN ORDER (each depends on previous):\n\n1. CURRENT_STATE.md \u2014 full rewrite of project state post-epic\n2. The changelog artifact described as CHANGELOG below\n3. RETRO.md at the RETRO path below \u2014 metrics, observations, brief defects\n4. follow-ups.json at the FOLLOW-UPS path below \u2014 gaps as machine-readable entries\n\nFor each artifact: write the file. Do NOT git add or git commit anything \u2014 the workflow commits the tracked artifacts after you return (follow-ups.json lives under the untracked .datum/runs/ directory).\n\nReturn JSON:\n{\n  "artifacts_written": ["CURRENT_STATE.md", "...", "RETRO.md", "follow-ups.json"],\n  "follow_up_count": N\n}\n\nList in artifacts_written only the files you actually wrote. Output raw JSON only. No markdown fences.\n\nINPUTS\nDATA: read {{closeoutDataPath}}\nREVIEW-RESPONSE: read {{reviewResponsePath}} if it exists (the operator\'s recorded review decisions)\nRETRO: docs/epics/{{branch}}/RETRO.md\nFOLLOW-UPS: .datum/runs/{{runId}}/follow-ups.json\nCHANGELOG: {{changelogInstruction}}\n';

// skills/src/shared/lane-steps.ts
var q2 = (s) => `"${s.replace(/"/g, '\\"')}"`;
function housekeepSteps(epicBranch) {
  return [{ name: "housekeep", command: `datum housekeep-epic ${q2(epicBranch)}`, tolerant: true }];
}
function housekeepFromSteps(result) {
  if (result.missing) return { ok: false, summary: "", error: `housekeep_failed: ${describeFailure(result, "housekeep")}` };
  const step = stepResult(result, "housekeep");
  if (!step) return { ok: false, summary: "", error: "housekeep_failed: housekeep step did not run" };
  if (step.exit_code !== 0) {
    const tail = (step.stderr || step.stdout || "").trim().split("\n").slice(-3).join(" | ");
    return { ok: false, summary: "", error: `housekeep_failed: datum housekeep-epic exited ${step.exit_code} \u2014 ${tail}` };
  }
  return { ok: true, summary: (step.stdout || "").trim(), error: "" };
}
var SCOPE_READ_BUDGET_BYTES = 16 * 1024;
var LANE_PLAN_DIGEST_BUDGET_BYTES = 16 * 1024;
function closeoutCollectSteps(o) {
  return [
    {
      name: "branch",
      command: o.branchHint ? `printf '%s' ${q2(o.branchHint)}` : "git rev-parse --abbrev-ref HEAD",
      tolerant: true
    },
    {
      name: "timestamp",
      command: o.runId ? `__rid=${q2(o.runId)} && printf '%s' "$__rid"` : `__rid=$(date +%Y%m%d-%H%M%S) && printf '%s' "$__rid"`,
      tolerant: true
    },
    {
      // The base branch is resolved, never hard-coded origin/main (same class
      // as main-sync, be0cd7fc): origin/HEAD, then origin/main|master, then a
      // local main|master — a repo with no remote still gets a merge-base.
      name: "base-sha",
      command: [
        // The epic's recorded parent first (a chained epic's "what changed"
        // is its own commits, not its parent epic's); the shell chain only
        // when the CLI is unavailable.
        'BASE=$(datum epic-base 2>&1) || BASE=""',
        'if [ -z "$BASE" ]; then BASE=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>&1); case "$BASE" in fatal*) BASE="";; esac; fi',
        'if [ -z "$BASE" ]; then for b in main master; do if git show-ref --verify --quiet "refs/remotes/origin/$b"; then BASE="origin/$b"; break; fi; done; fi',
        'if [ -z "$BASE" ]; then for b in main master; do if git show-ref --verify --quiet "refs/heads/$b"; then BASE="$b"; break; fi; done; fi',
        '[ -n "$BASE" ] || BASE=main',
        `__base=$(git merge-base HEAD "$BASE") && printf '%s' "$__base"`
      ].join("\n"),
      tolerant: true
    },
    { name: "merge-sha", command: `__merge=$(git rev-parse HEAD) && printf '%s' "$__merge"`, tolerant: true },
    { name: "config", command: `cat .datum/config.json || echo '{}'`, tolerant: true },
    { name: "mkdir", command: `mkdir -p ".datum/runs/$__rid"`, tolerant: true },
    // caliper BUG U: a CHANGELOG.md owned by release-please must not get a
    // hand-authored section. The script reads the owner from this step.
    {
      name: "changelog-owner",
      command: `if [ -f release-please-config.json ] || { [ -f CHANGELOG.md ] && grep -qi "managed by release-please" CHANGELOG.md; }; then echo release-please; else echo datum; fi`,
      tolerant: true
    },
    // An UNTRACKED root CURRENT_STATE.md (a previous closeout's artifact git
    // never had) was overwritten and lost. Moved aside first, never clobbered.
    {
      name: "preserve-current-state",
      command: `if [ -f CURRENT_STATE.md ] && [ -z "$(git ls-files CURRENT_STATE.md)" ]; then mv CURRENT_STATE.md "CURRENT_STATE.$__rid.prev.md" && echo "moved-aside: CURRENT_STATE.$__rid.prev.md"; else echo ok; fi`,
      tolerant: true
    },
    {
      name: "collect-git",
      command: `datum closeout-collect-git --run-id "$__rid" --base-sha "$__base" --merge-sha "$__merge"`,
      tolerant: true
    },
    { name: "collect-tasks", command: `datum closeout-collect-tasks --run-id "$__rid"`, tolerant: true },
    { name: "collect-token-metrics", command: `datum closeout-collect-token-metrics --run-id "$__rid"`, tolerant: true },
    { name: "collate", command: `datum closeout-collate --run-id "$__rid" --merge-sha "$__merge"`, tolerant: true },
    {
      name: "data-exists",
      command: `test -s ".datum/runs/$__rid/closeout-data.json" && echo yes || echo no`,
      tolerant: true
    }
  ];
}
var ARCHIVE_ROOT_FILES = ["SPEC.md", "TASKS.md", "QUESTIONS.md", "PROPERTIES.md", "TICKET.md", "tasks.json"];
function moveStepName(fileName) {
  return `move-${fileName.toLowerCase().replace(/\./g, "-")}`;
}
function moveIntoEpicDirCommand(src, epicDir2, base) {
  const dest = `${epicDir2}/${base}`;
  return `if [ -f ${q2(src)} ]; then if [ -e ${q2(dest)} ]; then echo "KEPT_ROOT: ${dest} exists, root ${src} is not this epic's, left in place"; else mkdir -p ${q2(epicDir2)} && git mv ${q2(src)} ${q2(dest)}; fi; else echo ABSENT; fi`;
}
function closeoutArchiveSteps(o) {
  const steps = [
    // File the run's follow-ups (synthesis manifest + per-lane skeptic minority findings) before archiving.
    { name: "file-followups", command: `datum closeout-file-followups --run-id ${q2(o.runId)}`, tolerant: true },
    { name: "tag", command: `git tag ${q2(`epic/${o.branch}/${o.runId}`)} HEAD`, tolerant: true },
    { name: "archive", command: `datum closeout-archive --run-id ${q2(o.runId)}`, tolerant: true }
  ];
  for (const f of ARCHIVE_ROOT_FILES) {
    steps.push({ name: moveStepName(f), command: moveIntoEpicDirCommand(f, o.epicDir, f), tolerant: true });
  }
  steps.push({
    name: "move-lane-plan-json",
    command: moveIntoEpicDirCommand(".datum/lane-plan.json", o.epicDir, "lane-plan.json"),
    tolerant: true
  });
  steps.push({
    name: "commit",
    command: `git diff --cached --quiet || git commit -m ${q2(`closeout(${o.runId}): archive pipeline artifacts to ${o.epicDir}`)}`,
    tolerant: true
  });
  steps.push({ name: "commit-sha", command: "git rev-parse --short HEAD", tolerant: true });
  return steps;
}

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- Test command comes from `.datum/config.json` `test_command` field \u2014 read it, don't guess\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500 lines is a review trigger: split only on a real functional seam, never to hit a number\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (from `.datum/config.json`)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Context Budget\n- When `headroom_compress` and `headroom_retrieve` are available, use them for files over 100 lines: compress after reading, then retrieve with a targeted query when you need a section back. This is the expected path on the local-model runtime. When they are not available, read the file and move on \u2014 never block on them, never report a hash you did not produce\n";

// skills/src/shared/context-relay.ts
var CONTEXT_RELAY_BUDGET_BYTES = 16 * 1024;

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function withPreamble(text) {
  return PREAMBLE + text;
}

// skills/src/datum-closeout.ts
var COLLECTOR_STEPS = ["collect-git", "collect-tasks", "collect-token-metrics", "collate"];
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var runId = a.runId || "";
if (a.agentTypes && typeof a.agentTypes === "object") configureAgentTypes(a.agentTypes);
setBatchCacheKey(a.configFingerprint || "");
setBatchRoot(typeof a.repoRoot === "string" ? a.repoRoot : "");
phase("Collect");
var collectSteps = closeoutCollectSteps({ runId });
var collectRaw = await agent(
  batchCommandPrompt(collectSteps),
  bootstrapOpts("cli", { label: "closeout-collect", model: model("fast") })
);
var collectResult = parseBatchResult(collectRaw, collectSteps);
var failedCollectors = [];
for (const name of COLLECTOR_STEPS) {
  const step = collectResult.steps.find((s) => s.name === name);
  if (step && step.exit_code !== 0) {
    const tail = (step.stderr || step.stdout).trim().split("\n").slice(-5).join("\n");
    log(`[closeout] collector "${name}" exited ${step.exit_code}${tail ? ` \u2014 ${tail}` : ""}`);
    failedCollectors.push(`${name} exited ${step.exit_code}${tail ? `: ${tail.slice(0, 300)}` : ""}`);
  }
}
var branch = (stepStdout(collectResult, "branch") || "").trim();
var cfg = parseAgentJson(stepStdout(collectResult, "config") || "{}", {});
if (!(a.agentTypes && typeof a.agentTypes === "object")) configureAgentTypes({ agentTypes: cfg.agent_types !== false });
var rid = runId || (stepStdout(collectResult, "timestamp") || "").trim();
var dataExists = (stepStdout(collectResult, "data-exists") || "").trim() === "yes";
log(`Branch: ${branch}, run: ${rid}`);
if (!dataExists) {
  const cause = failedCollectors.length > 0 ? `Failed collectors: ${failedCollectors.join(" | ")}` : describeFailure(collectResult, "closeout-collect");
  throw new Error(
    `Closeout: .datum/runs/${rid}/closeout-data.json is missing after collect \u2014 refusing to hand a synthesis agent a missing file. ${cause}`
  );
}
phase("Synthesize");
var epicDir = `docs/epics/${branch}`;
var changelogOwner = (stepStdout(collectResult, "changelog-owner") || "").trim();
var changelogManaged = changelogOwner === "release-please";
if (changelogManaged) log("changelog_skipped: CHANGELOG.md is managed by release-please \u2014 closeout writes CURRENT_STATE.md and RETRO.md only");
var preserved = (stepStdout(collectResult, "preserve-current-state") || "").trim();
if (preserved.startsWith("moved-aside")) log(`current_state_preserved: an untracked root CURRENT_STATE.md was ${preserved}`);
var changelogInstruction = changelogManaged ? "SKIP CHANGELOG.md entirely: this repository's CHANGELOG.md is managed by release-please and is generated from the conventional commits. Do not create, edit or mention it in artifacts_written." : "CHANGELOG.md \u2014 append entries for what shipped";
var synthResult = await agent(
  withPreamble(renderPrompt(closeout_synthesize_default, {
    closeoutDataPath: `.datum/runs/${rid}/closeout-data.json`,
    reviewResponsePath: `${epicDir}/REVIEW-RESPONSE.md`,
    changelogInstruction,
    branch,
    runId: rid
  })),
  { label: "synthesize", model: model("balanced") }
);
if (!synthResult) {
  throw new Error("agent_output_unparseable: synthesize \u2014 (no result)");
}
var synth = typeof synthResult === "string" ? parseAgentJsonStrict(synthResult, "synthesize") : synthResult;
log(`Closeout synthesis wrote: ${(synth?.artifacts_written || []).join(", ")}`);
var synthFiles = changelogManaged ? ["CURRENT_STATE.md", `${epicDir}/RETRO.md`] : ["CURRENT_STATE.md", "CHANGELOG.md", `${epicDir}/RETRO.md`];
var synthCommitSteps = commitFilesSteps({ wt: ".", files: synthFiles, message: `closeout(${rid}): write ${synthFiles.map((f) => f.split("/").pop()).join(" + ")}` });
var synthCommit = commitFilesFromSteps(await runBatch(synthCommitSteps, stageOpts("cli", { label: "commit-synthesis", model: model("fast") })));
if (synthCommit.error) throw new Error(`closeout_commit_failed: ${synthCommit.error}`);
if (synthCommit.nothingToCommit) log(`Closeout artifacts unchanged since the last run \u2014 already committed (${synthFiles.join(", ")})`);
else log(`Closeout artifacts committed (${synthCommit.sha})`);
var archiveSteps = closeoutArchiveSteps({ runId: rid, branch, epicDir });
var archiveRaw = await agent(
  batchCommandPrompt(archiveSteps),
  stageOpts("cli", { label: "closeout-archive", model: model("fast") })
);
var archiveResult = parseBatchResult(archiveRaw, archiveSteps);
var filedRaw = stepStdout(archiveResult, "file-followups");
var filed = parseAgentJson(filedRaw || "", null);
if (!filed) log(`[closeout] follow-ups: filer returned no JSON (${(filedRaw || "").trim().slice(0, 120) || "nothing"})`);
else if (filed.skipped) log("[closeout] follow-ups: already filed for this run");
else {
  log(`[closeout] follow-ups: ${filed.filed ?? 0} filed, ${filed.retained ?? 0} retained in .datum/runs/${rid}/follow-ups.json${filed.tracker ? ` (tracker ${filed.tracker})` : ""}${filed.reason ? ` \u2014 ${filed.reason}` : ""}`);
  if ((filed.retained_below_threshold ?? 0) > 0) log(`[closeout] follow-ups: ${filed.retained_below_threshold} finding(s) below ${filed.min_severity || "high"} retained locally, not filed \u2014 see ${filed.manifest || `.datum/runs/${rid}/follow-ups.json`}`);
}
var archiveFailures = [];
for (const step of archiveResult.steps) {
  if (step.exit_code !== 0) {
    archiveFailures.push(step.name);
    const tail = (step.stderr || step.stdout).trim().split("\n").slice(-5).join("\n");
    log(`[closeout] archive step "${step.name}" exited ${step.exit_code}${tail ? ` \u2014 ${tail}` : ""}`);
  }
}
var commitStep = archiveResult.steps.find((s) => s.name === "commit");
var archived = !archiveResult.missing && !!commitStep && commitStep.exit_code === 0;
var archiveCommit = archived ? (stepStdout(archiveResult, "commit-sha") || "").trim() : "";
var housekeepStepList = housekeepSteps(branch);
var housekeep = housekeepFromSteps(await runBatch(housekeepStepList, stageOpts("cli", { label: "housekeep", model: model("fast") })));
if (housekeep.ok) log(`housekeep: ${housekeep.summary || "done"}`);
else log(`housekeep: ${housekeep.error}`);
return {
  branch,
  runId: rid,
  artifacts: synth?.artifacts_written || [],
  followUps: synth?.follow_up_count || 0,
  archived,
  archiveCommit,
  archiveFailures,
  housekeepError: housekeep.error
};
