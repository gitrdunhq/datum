// @generated — DO NOT EDIT. Source: skills/src/datum-awake.ts
export const meta = {
  name: "datum-awake",
  description: "Scan repo rules and conventions, distill into cached agent preamble (llms.txt pattern)",
  phases: [
    { title: "Scan", detail: "read CLAUDE.md, AGENTS.md, configs, test files, code patterns" },
    { title: "Distill", detail: "compress into agent-preamble.md" },
    { title: "Commit", detail: "write the preamble file and commit" }
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
    let a = h0;
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
      const temp = rotl(a, 5) + f + e + k + w[i] >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = h0 + a >>> 0;
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
  const tail2 = (r.failed.stderr || r.failed.stdout).trim().split("\n").slice(-5).join("\n");
  return `${label}: step "${r.failed.name}" exited ${r.failed.exit_code}${tail2 ? ` \u2014 ${tail2}` : ""}`;
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
    logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 1 \u2014 retrying once with a fresh runner`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner's shell refused to execute the script; run it again`, retryOpts), steps);
  }
  return result;
}

// skills/src/shared/toolchain.ts
var TS7_CONVENTION_LINE = 'typescript >= 7: the classic compiler API is gone; `ts.createSourceFile` and friends do not exist (`import ts from "typescript"` resolves to a module exporting only `version`); use `typescript/unstable/ast` or avoid the TS API.';
function pinsTypeScript7(range) {
  const raw = (range || "").trim();
  if (!raw || raw.startsWith("<")) return false;
  const m = raw.match(/\d+/);
  if (!m) return false;
  return Number(m[0]) >= 7;
}
function toolchainConventionLines(typescriptRange) {
  return pinsTypeScript7(typescriptRange) ? [TS7_CONVENTION_LINE] : [];
}

// skills/src/shared/write-steps.ts
var HEREDOC_TERMINATOR = "DATUM_WRITE_EOF";
var q2 = (s) => `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
var DEFAULT_NAMES = { mkdir: "mkdir", write: "write", sha: "sha" };
function heredocBytes(content) {
  return content === "" || content.endsWith("\n") ? content : content + "\n";
}
function writeFileSteps(o) {
  if (o.content.split("\n").some((line) => line === HEREDOC_TERMINATOR)) {
    throw new Error(`writeFileSteps: content contains the heredoc terminator ${HEREDOC_TERMINATOR} on its own line`);
  }
  const names = o.names ?? DEFAULT_NAMES;
  const slash = o.path.lastIndexOf("/");
  const dir = slash > 0 ? o.path.slice(0, slash) : ".";
  const body = heredocBytes(o.content);
  const write = body === "" ? `: > ${q2(o.path)}` : `cat > ${q2(o.path)} <<'${HEREDOC_TERMINATOR}'
${body.slice(0, -1)}
${HEREDOC_TERMINATOR}`;
  return [
    { name: names.mkdir, command: `mkdir -p ${q2(dir)}` },
    { name: names.write, command: write },
    { name: names.sha, command: `git hash-object ${q2(o.path)}`, tolerant: true }
  ];
}
function writeFileBlobSha(content) {
  return gitBlobSha(utf8Encode(heredocBytes(content)));
}
function tail(step) {
  return (step.stderr || step.stdout || "").trim().split("\n").slice(-3).join(" | ");
}
function writeFileFromSteps(result, o) {
  const names = o.names ?? DEFAULT_NAMES;
  if (result.missing) return { ok: false, error: `${o.prefix}_write_failed: ${describeFailure(result, names.write)}` };
  for (const name of [names.mkdir, names.write]) {
    const step = stepResult(result, name);
    if (!step) return { ok: false, error: `${o.prefix}_write_failed: ${name} step did not run` };
    if (step.exit_code !== 0) return { ok: false, error: `${o.prefix}_write_failed: ${name} exited ${step.exit_code} \u2014 ${tail(step)}` };
  }
  const sha = (stepResult(result, names.sha)?.stdout || "").trim();
  if (sha !== o.expectedSha) {
    return { ok: false, error: `${o.prefix}_write_mismatch: ${o.path} on disk is blob ${sha || "(none)"}, the script wrote ${o.expectedSha} \u2014 the runner did not copy the heredoc verbatim` };
  }
  return { ok: true, error: "" };
}

// skills/src/prompts/awake-scan.md
var awake_scan_default = 'Repo scanner for datum awake. Discover all rules, conventions, and patterns in this repository.\n\nTOOLS (run these first for hard data):\n1. `scc --no-cocomo -s lines .` \u2014 repo shape (LOC, languages, file counts)\n2. `ast-grep --pattern \'def test_$NAME($$$)\' .` (Python) or `func test$NAME` (Swift/Go) or `it($$$)` (TS/JS) \u2014 sample test naming convention\n3. `ast-grep --pattern \'class $NAME:\' .` \u2014 class naming convention\n\nThen scan these sources IN ORDER. Read each file that exists, skip those that don\'t:\n\n## Config & Rules\n- CLAUDE.md, AGENTS.md, GEMINI.md, CODEX.md (agent instructions)\n- .claude/rules/*.md (Claude Code rules)\n- .editorconfig, .prettierrc, .eslintrc*, biome.json (formatting)\n- pyproject.toml [tool.ruff], [tool.black], [tool.pytest] sections (Python)\n- tsconfig.json, package.json, biome.json (TypeScript/JavaScript)\n- Package.swift, .swiftlint.yml, .swift-format (Swift)\n- go.mod, go.sum (Go)\n- Cargo.toml, rustfmt.toml (Rust)\n- build.gradle.kts, pom.xml (Kotlin/Java)\n- Gemfile (Ruby)\n\n## Test Conventions\n- Read 2-3 existing test files to extract: naming pattern, import style, fixture approach, assertion style\n- Identify test framework: pytest, jest, vitest, XCTest, Swift Testing\n- Note any test fixtures/helpers (conftest.py / TestHelper.swift / testutil_test.go / jest.setup.ts)\n\n## Project Patterns\n- Read 2-3 implementation files to extract: module structure, error handling, logging, type patterns\n- Check for dependency injection, factory patterns, protocol/trait usage\n- Note the import convention (relative vs absolute, barrel exports)\n\nReturn JSON:\n{\n  "language": "python|typescript|swift|go|mixed",\n  "test_framework": "pytest|jest|vitest|xctest|swift-testing",\n  "repo_shape": {"total_loc": 0, "languages": {}, "file_count": 0},\n  "rules": [\n    {"source": "CLAUDE.md", "rules": ["rule 1 summary", "rule 2 summary"]},\n    {"source": "pyproject.toml | package.json | Package.swift", "rules": ["linter/formatter config summary"]}\n  ],\n  "test_conventions": {\n    "naming": "test_<function>_<scenario> or describe/it",\n    "fixtures": "conftest.py | jest.setup.ts | TestHelper.swift | setUp",\n    "assertions": "assert x == y | expect(x).toBe(y) | XCTAssertEqual | #expect",\n    "example_imports": "from module import func | import { func } from \'./module\'"\n  },\n  "code_patterns": {\n    "error_handling": "how errors are handled",\n    "logging": "structlog | console.log | os.log",\n    "typing": "fully typed | partial | none",\n    "module_structure": "flat | layered | domain-driven"\n  },\n  "file_conventions": {\n    "max_file_length": "500 lines or uncapped",\n    "naming": "snake_case | camelCase | PascalCase",\n    "test_location": "tests/ | __tests__ | Tests/"\n  }\n}\n\nOutput raw JSON only. No markdown fences.\n\nINPUTS\nWorking directory: {{wt}}\n';

// skills/src/prompts/awake-distill.md
var awake_distill_default = 'Distill repo scan results into a token-efficient agent preamble.\n\n## OUTPUT: agent-preamble.md\n\nWrite a concise preamble that is PREPENDED to every stage, refine, plan, properties, review, validate and closeout prompt. Format as llms.txt:\n\n```\n# [Project Name]\n\n> One-line project description\n\n[Distilled rules \u2014 keep under 60 lines total]\n\n## Coding Rules\n- [rule]: brief description\n\n## Test Conventions\n- [convention]: brief description\n\n## File Conventions\n- [convention]: brief description\n```\n\nRULES FOR THE PREAMBLE:\n- Must be EXACTLY the same text every time for prompt cache hits\n- No dynamic content (no dates, no branch names, no file counts)\n- Under 60 lines / ~2000 tokens \u2014 this gets prepended to EVERY agent call\n- Actionable rules only \u2014 "use the project\'s test runner" not "the project has tests"\n- Use imperative voice \u2014 "Always X" not "The project uses X"\n\nReturn JSON:\n{\n  "preamble": "full contents of agent-preamble.md as a string",\n  "token_estimate": {"preamble": N}\n}\n\nOutput raw JSON only. No markdown fences.\n\nINPUTS\nSCAN RESULTS:\n{{scanResults}}\n';

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- Test command comes from `.datum/config.json` `test_command` field \u2014 read it, don't guess\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500 lines is a review trigger: split only on a real functional seam, never to hit a number\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (from `.datum/config.json`)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Context Budget\n- When `headroom_compress` and `headroom_retrieve` are available, use them for files over 100 lines: compress after reading, then retrieve with a targeted query when you need a section back. This is the expected path on the local-model runtime. When they are not available, read the file and move on \u2014 never block on them, never report a hash you did not produce\n";

// skills/src/shared/context-relay.ts
var CONTEXT_RELAY_BUDGET_BYTES = 16 * 1024;

// skills/src/shared/lane-steps.ts
var SCOPE_READ_BUDGET_BYTES = 16 * 1024;
var LANE_PLAN_DIGEST_BUDGET_BYTES = 16 * 1024;

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function withPreamble(text) {
  return PREAMBLE + text;
}

// skills/src/datum-awake.ts
var awakeArgs = typeof args === "object" && args ? args : {};
setBatchCacheKey(awakeArgs.configFingerprint || "");
setBatchRoot(awakeArgs.repoRoot || "");
phase("Scan");
var scanRaw = await agent(
  withPreamble(renderPrompt(awake_scan_default, { wt: "." })),
  { label: "scan-repo", model: model("balanced") }
);
var scan = parseAgentJsonStrict(scanRaw, "scan-repo");
log(`Scanned: ${scan.language} project, ${scan.rules?.length || 0} rule sources`);
var toolchainSteps = [{
  name: "ts-version",
  command: "jq -r '.devDependencies.typescript // .dependencies.typescript // empty' package.json",
  tolerant: true
}];
var toolchainResult = await runBatch(toolchainSteps, { label: "read-toolchain", model: model("fast") });
var tsRange = (stepStdout(toolchainResult, "ts-version") || "").trim();
var conventionLines = toolchainConventionLines(tsRange);
for (const line of conventionLines) log(`Toolchain convention: ${line}`);
phase("Distill");
var distillRaw = await agent(
  withPreamble(renderPrompt(awake_distill_default, { scanResults: JSON.stringify(scan) })),
  { label: "distill-preamble", model: model("balanced") }
);
var distill = parseAgentJsonStrict(distillRaw, "distill-preamble");
log(`Preamble: ~${distill.token_estimate.preamble} tokens`);
phase("Commit");
var preamblePath = "skills/src/prompts/agent-preamble.md";
var PREAMBLE_NAMES = { mkdir: "mkdir-preamble", write: "write-preamble", sha: "sha-preamble" };
var preambleContent = conventionLines.length ? `${distill.preamble.replace(/\s+$/, "")}

${conventionLines.join("\n")}
` : distill.preamble;
var writeSteps = writeFileSteps({ path: preamblePath, content: preambleContent, names: PREAMBLE_NAMES });
var writeResult = await runBatch(writeSteps, { label: "write-preamble", model: model("fast") });
var verdict = writeFileFromSteps(writeResult, { path: preamblePath, expectedSha: writeFileBlobSha(preambleContent), prefix: "preamble", names: PREAMBLE_NAMES });
if (!verdict.ok) throw new Error(verdict.error);
var commitStepList = commitFilesSteps({ wt: ".", files: [preamblePath], message: "awake: regenerate agent preamble from repo scan" });
var commit = commitFilesFromSteps(await runBatch(commitStepList, { label: "commit-preamble", model: model("fast") }));
if (commit.error) throw new Error(`awake_commit_failed: ${commit.error}`);
if (commit.nothingToCommit) log("Preamble unchanged since the last awake \u2014 nothing to commit");
else log(`Written and committed: ${preamblePath} (${commit.sha})`);
log('Run "bash scripts/build-workflows.sh" to rebuild with new preamble');
return {
  language: scan.language,
  ruleSources: scan.rules?.length || 0,
  preambleTokens: distill.token_estimate.preamble
};
