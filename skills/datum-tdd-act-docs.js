// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-docs.ts
export const meta = {
  name: "datum-tdd-act-docs",
  description: "Haiku pre-check + conditional sonnet docs sync with git commit",
  phases: [{ title: "Docs" }]
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

// skills/src/shared/schemas.ts
var WRITE_RESULT_SCHEMA = {
  type: "object",
  properties: {
    files_written: { type: "array", items: { type: "string" } },
    success: { type: "boolean" },
    failure_reason: { type: "string" }
  },
  required: ["success"]
};
var REFACTOR_CHECK_SCHEMA = {
  type: "object",
  properties: {
    should_refactor: { type: "boolean" },
    reason: { type: "string" }
  },
  required: ["should_refactor"]
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
    if (/^\[\s*\{\s*"name"\s*:/.test(text)) {
      const names = [...text.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
      const complete = names.slice(0, -1);
      return { steps: [], failed: null, missing: true, scriptError: `batch_truncated: the runner's reply is a step array cut before it closed (${text.length} chars; last complete step: ${complete[complete.length - 1] ?? "none"}; cut inside: ${names[names.length - 1] ?? "unknown"}) \u2014 the script's stdout was too long to relay whole` };
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
function worktreeDirtySteps(wt) {
  return [{ name: "status", command: `git -C ${q(wt)} status --porcelain`, tolerant: true }];
}
function worktreeDirtyFromSteps(result) {
  if (result.missing) {
    return { dirty: true, known: false, detail: `retry_guard_unverified: ${describeFailure(result, "status")}` };
  }
  const step = stepResult(result, "status");
  if (!step || step.exit_code !== 0) {
    const tail = (step && (step.stderr || step.stdout) || "").trim().split("\n").slice(-3).join(" | ");
    return { dirty: true, known: false, detail: `retry_guard_unverified: git status exited ${step ? step.exit_code : "without running"}${tail ? ` \u2014 ${tail}` : ""}` };
  }
  const lines = (step.stdout || "").split("\n").filter((l) => l.trim().length > 0);
  return { dirty: lines.length > 0, known: true, detail: lines.join(" | ") };
}

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- The test command is the `test_command` in your brief (the same value as `.datum/config.json`'s `test_command`, which lane worktrees carry only because datum copied it) \u2014 never guess or fall back to a default when a file is missing\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500 lines is a review trigger: split only on a real functional seam, never to hit a number\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (`test_command` from your brief)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Context Budget\n- When `headroom_compress` and `headroom_retrieve` are available, use them for files over 100 lines: compress after reading, then retrieve with a targeted query when you need a section back. This is the expected path on the local-model runtime. When they are not available, read the file and move on \u2014 never block on them, never report a hash you did not produce\n";

// skills/src/prompts/docs-check.md
var docs_check_default = "DOCS RELEVANCE checker. Evaluate whether documentation needs updating \u2014 do NOT write or modify files.\n\nSearch for references to the changed symbols listed below in doc files (*.md, excluding CHANGELOG.md).\nAlso check: did this task add new public functions or classes with zero documentation?\n\nReturn should_refactor=true only if:\n- An existing doc references a symbol that changed (stale doc)\n- A new public API has zero documentation anywhere\n\nReturn should_refactor=false if all docs are current or no docs reference the changed code.\n\nINPUTS\nCHANGED FILES:\n{{changedFiles}}\n";

// skills/src/prompts/docs-sync.md
var docs_sync_default = 'Documentation sync agent. Update existing doc files to reflect code changes.\nWrite updated files \u2014 do NOT run any git commands.\n\nRULES (non-negotiable):\n- Do NOT create new doc files \u2014 only edit existing ones\n- Do NOT touch CHANGELOG.md\n- CLI references use "datum <cmd>", never "uv run" or "python3 scripts/"\n\nACTIONS:\n1. Fix any existing docs that reference changed code incorrectly\n2. If new public APIs were added with zero docs, add a section in the nearest relevant existing doc file\n3. Keep additions concise \u2014 one paragraph per new API, with a usage example\n\nReturn success, the files_written list (every path you edited \u2014 a success with an empty list is read as a failure by the workflow) and, if you wrote nothing, failure_reason saying why.\n\nINPUTS\nTASK PACKET: {{docsPacket}}\n';

// skills/src/shared/context-relay.ts
var CONTEXT_RELAY_BUDGET_BYTES = 16 * 1024;

// assets/schemas/task.schema.json
var task_schema_default = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "DATUM Task",
  $defs: {
    laneId: {
      type: "string",
      pattern: "^(?:task-\\d+|task-INT-\\d+|[A-Z]{2,4}-\\d+|(?:[A-CE-Z][A-Z]{4}|D[B-Z][A-Z]{3}|DA[A-SU-Z][A-Z]{2}|DAT[A-TV-Z][A-Z]|DATU[A-LN-Z])-\\d+|[A-Z]{6}-\\d+)$",
      description: "Single source of the lane id pattern: datum/id_pattern.py and skills/src/shared/lane-id-pattern.ts both load it from here (#514). Accepts task-N, task-INT-N and PREFIX-N with a 2-6 uppercase-letter prefix; TASK is ordinary (Assumption 8). Only the literal DATUM- prefix is excluded, spelled out lookaround-free because pydantic validates with the Rust regex crate."
    }
  },
  type: "object",
  required: [
    "id",
    "title",
    "acceptance_criteria",
    "files",
    "red_note"
  ],
  properties: {
    id: {
      $ref: "#/$defs/laneId"
    },
    slug: {
      type: "string",
      pattern: "^[a-z0-9][a-z0-9-]{2,60}$"
    },
    title: {
      type: "string",
      minLength: 1
    },
    description: {
      type: "string"
    },
    acceptance_criteria: {
      type: "array",
      items: {
        type: "string"
      },
      minItems: 1
    },
    files: {
      type: "array",
      items: {
        type: "string"
      },
      minItems: 1
    },
    reads: {
      type: "array",
      items: {
        type: "string"
      },
      default: []
    },
    depends_on: {
      type: "array",
      items: {
        $ref: "#/$defs/laneId"
      },
      default: []
    },
    introduces_stubs: {
      type: "boolean",
      default: false
    },
    red_note: {
      type: "string",
      minLength: 1
    },
    estimated_loc: {
      type: "integer",
      minimum: 0,
      default: 0
    },
    task_complexity: {
      type: "string",
      enum: [
        "behavioral",
        "structural"
      ],
      default: "behavioral"
    }
  }
};

// skills/src/shared/lane-id-pattern.ts
var LANE_ID_PATTERN = task_schema_default.$defs.laneId.pattern;
var LANE_ID_RE = new RegExp(LANE_ID_PATTERN);

// skills/src/shared/lane-steps.ts
var SCOPE_READ_BUDGET_BYTES = 16 * 1024;
var LANE_PLAN_DIGEST_BUDGET_BYTES = 16 * 1024;

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function docsCheckPrompt(vars) {
  return PREAMBLE + renderPrompt(docs_check_default, vars);
}
function docsSyncPrompt(vars) {
  return PREAMBLE + renderPrompt(docs_sync_default, vars);
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
function isReadOnlyAgentType(agentType) {
  return typeof agentType === "string" && READ_ONLY_AGENT_TYPES.has(agentType);
}
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

// skills/src/shared/agents.ts
var RATE_LIMIT_MAX_RETRIES = 4;
var RATE_LIMIT_BASE_DELAY_MS = 5e3;
var RATE_LIMIT_JITTER_MS = 2e3;
function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function unknownAgentType(message) {
  const m = /agent type '([^']+)' not found/.exec(message);
  return m ? m[1] : null;
}
async function resilientAgent(prompt, opts, deps) {
  const agentFn = deps?.agentFn ?? agent;
  const logFn = deps?.logFn ?? log;
  const maxRetries = opts?.maxRetries ?? RATE_LIMIT_MAX_RETRIES;
  let lastResult = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let threw = false;
    let caughtMessage = "";
    try {
      lastResult = await agentFn(prompt, opts);
    } catch (err) {
      threw = true;
      caughtMessage = err instanceof Error ? err.message : String(err);
      lastResult = null;
    }
    const unknownType = threw ? unknownAgentType(caughtMessage) : null;
    if (unknownType && opts?.agentType) {
      logFn(`[resilientAgent] agent_type_unavailable: ${unknownType} \u2014 the host has not registered agents/${unknownType}.md (a new Claude Code session picks it up); running ${opts.label || "this call"} on the default agent instead`);
      const rest = { ...opts };
      delete rest.agentType;
      opts = rest;
      attempt--;
      continue;
    }
    if (!threw && lastResult !== null) return lastResult;
    if (threw) {
      logFn(`[resilientAgent] attempt ${attempt + 1} threw: ${caughtMessage} \u2014 treating as retryable`);
    } else if (attempt < maxRetries) {
      logFn(`[resilientAgent] attempt ${attempt + 1} returned nothing (null result) \u2014 retrying`);
    }
    if (attempt < maxRetries && opts?.worktree && !isReadOnlyAgentType(opts.agentType)) {
      const guardSteps = worktreeDirtySteps(opts.worktree);
      const guard = worktreeDirtyFromSteps(parseBatchResult(
        await agentFn(batchCommandPrompt(guardSteps), stageOpts("cli", { label: "retry-guard", model: "haiku" })),
        guardSteps
      ));
      if (!guard.known) {
        logFn(`[resilientAgent] attempt ${attempt + 1} ${threw ? `threw: ${caughtMessage}` : "returned null"} and the worktree state is unknown (${guard.detail}) \u2014 aborting retry to prevent duplicate writes`);
        return lastResult;
      }
      if (guard.dirty) {
        logFn(`[resilientAgent] attempt ${attempt + 1} ${threw ? `threw: ${caughtMessage}` : "returned null"} but worktree is dirty \u2014 aborting retry to prevent duplicate writes (${guard.detail})`);
        return lastResult;
      }
    }
    if (attempt < maxRetries) {
      const delay = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt) + (attempt + 1) * 7919 % RATE_LIMIT_JITTER_MS;
      const reason = threw ? `threw: ${caughtMessage}` : "returned null";
      logFn(`[resilientAgent] attempt ${attempt + 1} ${reason}, backing off ${Math.round(delay / 1e3)}s before retry ${attempt + 2}/${maxRetries + 1}`);
      await sleepMs(delay);
    }
  }
  return lastResult;
}
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
  } else if (result.missing && result.scriptError?.startsWith("batch_truncated")) {
    logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 1 \u2014 retrying once with a fresh runner`);
    result = parseBatchResult(await agentFn(`${prompt}

# attempt 2 of 2 \u2014 the previous runner's reply was cut before the JSON array closed; return the script's stdout complete and unabridged, nothing else`, retryOpts), steps);
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

// skills/src/datum-tdd-act-docs.ts
var a = args;
configureAgentTypes(a.agentTypes || {});
setBatchCacheKey(a.configFingerprint || "");
setBatchRoot(typeof a.repoRoot === "string" ? a.repoRoot : "");
phase("Docs");
var synced = false;
var syncedFiles;
var committed;
var commitSha;
var failureReason;
if (a.completedLanes.length === 0) {
  log("No completed lanes \u2014 skipping docs");
} else {
  const changedFiles = [...new Set(a.completedLanes.flatMap((id) => a.lanePlan.lanes[id].files || []))];
  const docsCheck = await resilientAgent(
    docsCheckPrompt({ changedFiles: changedFiles.join(", ") }),
    stageOpts("quality", { label: "docs-check", phase: "Docs", model: model("fast"), schema: REFACTOR_CHECK_SCHEMA, maxRetries: 1 })
  );
  if (!docsCheck) {
    failureReason = "docs_check_no_result: the docs-check agent returned nothing on both attempts \u2014 docs were not checked";
    log(`Docs: ${failureReason}`);
  } else if (docsCheck.should_refactor) {
    const docsPacket = JSON.stringify({
      schema_version: "1.0",
      changed_files: changedFiles,
      new_symbols: a.completedLanes.map((id) => ({
        task_id: id,
        title: a.lanePlan.lanes[id].title,
        files: a.lanePlan.lanes[id].files
      })),
      working_directory: "."
    });
    const docs = await agent(
      docsSyncPrompt({ docsPacket }),
      stageOpts("docs", { label: "docs-sync", phase: "Docs", model: model("balanced"), schema: WRITE_RESULT_SCHEMA })
    );
    if (docs?.success) {
      const docsWritten = docs.files_written || [];
      if (docsWritten.length === 0) {
        log("Docs: agent reported success but no files_written \u2014 skipping commit");
        failureReason = "docs agent reported success but wrote no files";
      } else {
        const commitStepList = commitFilesSteps({ wt: ".", files: docsWritten, message: `docs(${a.runId}): sync docs for merged lanes` });
        const commit = commitFilesFromSteps(await runBatch(commitStepList, stageOpts("cli", { label: "docs-commit", phase: "Docs", model: model("fast") })));
        committed = commit.committed || commit.nothingToCommit;
        commitSha = commit.sha || "";
        syncedFiles = docsWritten;
        if (committed) {
          log(commit.nothingToCommit ? `Docs already committed (nothing to commit): ${docsWritten.join(", ")}` : `Docs synced and committed (${commitSha}): ${docsWritten.join(", ")}`);
          synced = true;
        } else {
          failureReason = commit.error || "commit_failed: unknown";
          log(`Docs written but NOT committed \u2014 ${failureReason}. Files left modified in the checkout: ${docsWritten.join(", ")}`);
        }
      }
    } else {
      log(`Docs: ${docs?.failure_reason || "nothing to update"}`);
    }
  } else {
    log("Docs: no stale references found, skipping");
  }
}
return { synced, files: syncedFiles, committed, commit_sha: commitSha, failure_reason: failureReason };
