// @generated — DO NOT EDIT. Source: skills/src/datum-validate.ts
export const meta = {
  name: "datum-validate",
  description: "Post-Act validation \u2014 full test suite, lint, AC completeness check",
  phases: [
    { title: "Validate", detail: "sync with main, run tests, lint, AC coverage, gate" }
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
function parseValidateArgs(raw) {
  const base = { yolo: false, noMergeMain: false };
  if (raw && typeof raw === "object") {
    const o = raw;
    return { ...base, ...o, yolo: !!o.yolo, noMergeMain: !!(o.noMergeMain ?? o["no-merge-main"]) };
  }
  if (typeof raw !== "string") return base;
  const text = raw.trim().replace(/^"|"$/g, "").trim();
  if (!text) return base;
  if (text.startsWith("{")) {
    try {
      return parseValidateArgs(JSON.parse(text));
    } catch {
      return base;
    }
  }
  const tokens = text.split(/\s+/).map((t) => t.toLowerCase());
  return {
    yolo: tokens.includes("yolo"),
    noMergeMain: tokens.includes("--no-merge-main") || tokens.includes("no-merge-main")
  };
}
function evaluateMainSync(result, noMergeMain2) {
  if (!result || typeof result !== "object" || typeof result.behind !== "number") {
    return { ok: false, message: `could not determine whether the epic is behind main: ${result?.error || "no sync result (git fetch origin main failed or returned unparseable output)"}` };
  }
  if (result.skipped) {
    return { ok: true, message: `main sync skipped: ${result.skipped}` };
  }
  if (result.conflict) {
    return { ok: false, message: `merging origin/main into the epic branch hit a conflict (epic was ${result.behind} commits behind main); merge aborted \u2014 resolve by hand, then re-run validate: ${result.output || ""}`.trim() };
  }
  if (result.behind > 0 && !result.merged) {
    return {
      ok: false,
      message: noMergeMain2 ? `epic is ${result.behind} commits behind main \u2014 merge origin/main into the epic branch (or drop --no-merge-main) before validating` : `epic is ${result.behind} commits behind main and origin/main was not merged`
    };
  }
  return { ok: true, message: result.merged ? `merged origin/main into the epic branch (was ${result.behind} commits behind)` : "epic branch is up to date with main" };
}
function testRunCommand(testCommand2, wt, stage) {
  const logPath = `${wt}/.datum/test-output-${stage}.log`;
  return `mkdir -p "${wt}/.datum" && ( cd "${wt}" && ${testCommand2} ) > "${logPath}" 2>&1; TEST_EXIT=$?; tail -50 "${logPath}"; echo "TEST_EXIT=$TEST_EXIT"`;
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

// skills/src/shared/lane-steps.ts
function testExitCode(stdout) {
  if (!stdout) return null;
  const matches = [...stdout.matchAll(/TEST_EXIT=(\d+)/g)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]);
}
var SCOPE_READ_BUDGET_BYTES = 16 * 1024;
var LANE_PLAN_DIGEST_BUDGET_BYTES = 16 * 1024;

// skills/src/shared/validate-steps.ts
var TEST_SIGNAL_PATH = ".datum/last-test-signal.json";
function validateVerifySteps(testCommand2, cwd) {
  const signalPath = `${cwd.replace(/\/+$/, "")}/${TEST_SIGNAL_PATH}`;
  return [
    { name: "test-verify", command: testRunCommand(testCommand2, cwd, "validate-verify"), tolerant: true },
    {
      name: "write-signal",
      command: `mkdir -p "$(dirname "${signalPath}")" && jq -n --arg status "$([ "\${TEST_EXIT:-1}" -eq 0 ] && echo pass || echo fail)" --argjson exit_code "\${TEST_EXIT:-1}" --arg command ${JSON.stringify(testCommand2)} --arg recorded_at "$(date +%Y-%m-%dT%H:%M:%S)" '{status: $status, exit_code: $exit_code, command: $command, recorded_at: $recorded_at}' > "${signalPath}" && cat "${signalPath}"`,
      tolerant: true
    }
  ];
}

// skills/src/shared/main-sync-steps.ts
var SKIP_MARKER = "SKIPPED_NO_REMOTE";
var BRANCH_RE = /^[A-Za-z0-9._\/-]+$/;
function mainSyncSteps(noMergeMain2, mainBranch) {
  const explicit = typeof mainBranch === "string" && mainBranch.trim() && BRANCH_RE.test(mainBranch.trim()) && !mainBranch.trim().startsWith("-") ? mainBranch.trim() : null;
  const baseCommand = explicit ? `BASE="${explicit}"; echo "$BASE"` : [
    'BASE=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed "s#^origin/##")',
    'if [ -z "$BASE" ]; then for b in main master; do if git show-ref --verify --quiet "refs/remotes/origin/$b"; then BASE="$b"; break; fi; done; fi',
    '[ -n "$BASE" ] || BASE=main',
    'echo "$BASE"'
  ].join("\n");
  const steps = [
    { name: "remote", command: `if git remote get-url origin >/dev/null 2>&1; then HAS_REMOTE=1; echo HAS_REMOTE; else HAS_REMOTE=0; echo NO_REMOTE; fi`, tolerant: true },
    { name: "base", command: baseCommand, tolerant: true },
    { name: "fetch", command: `if [ "\${HAS_REMOTE:-0}" -eq 1 ]; then git fetch origin "$BASE"; else echo ${SKIP_MARKER}; fi` },
    { name: "behind", command: `if [ "\${HAS_REMOTE:-0}" -eq 1 ]; then BEHIND=$(git rev-list --count HEAD.."origin/$BASE"); echo "$BEHIND"; else BEHIND=0; echo ${SKIP_MARKER}; fi` }
  ];
  if (!noMergeMain2) {
    steps.push({
      name: "merge",
      command: [
        'if [ "${BEHIND:-0}" -gt 0 ]; then',
        '  if git merge --no-edit "origin/$BASE"; then',
        "    true",
        "  else",
        "    git merge --abort",
        "    false",
        "  fi",
        "else",
        '  echo "not behind, nothing to merge"',
        "fi"
      ].join("\n"),
      tolerant: true
    });
  }
  return steps;
}
function mainSyncFromSteps(result, noMergeMain2) {
  if (result.missing) {
    throw new Error(`main_sync_failed: ${describeFailure(result, "main-sync")}`);
  }
  if (result.failed) {
    throw new Error(`main_sync_failed: ${describeFailure(result, "main-sync")}`);
  }
  const behindRaw = (stepStdout(result, "behind") || "").trim();
  if (behindRaw === SKIP_MARKER && (stepStdout(result, "remote") || "").trim() === "NO_REMOTE") {
    return { behind: 0, merged: false, conflict: false, skipped: "no origin remote" };
  }
  const behind = parseInt(behindRaw, 10);
  if (!Number.isFinite(behind)) {
    throw new Error(`main_sync_failed: could not parse behind-count output from \`git rev-list --count HEAD..origin/<base>\` ("${behindRaw}")`);
  }
  if (noMergeMain2 || behind === 0) {
    return { behind, merged: false, conflict: false };
  }
  const mergeStep = stepResult(result, "merge");
  if (!mergeStep) {
    throw new Error("main_sync_failed: merge step did not run");
  }
  if (mergeStep.exit_code === 0) {
    return { behind, merged: true, conflict: false };
  }
  const output = (mergeStep.stderr || mergeStep.stdout || "").trim().split("\n").slice(-20).join("\n");
  return { behind, merged: false, conflict: true, output };
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
  }
  return result;
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

// skills/src/prompts/validate-check.md
var validate_check_default = 'Validation agent. Confirm the integrated result meets SPEC and PROPERTIES.\n\nWorking directory: {{wt}}\nSPEC path: {{specPath}}\nTASKS path: {{tasksPath}}\nTest command: {{testCommand}}\n\nSTEPS:\n1. Run the full test suite with exactly this command: {{testRunCmd}}\n   It writes the full output to a log file, prints the last 50 lines and then `TEST_EXIT=<code>`.\n   That code is the real exit status \u2014 never run {{testCommand}} through a pipe into tail, a pipe masks the exit code.\n   tests_pass is true ONLY if TEST_EXIT is 0. If TEST_EXIT is not 0 \u2192 report immediately. Do not proceed.\n\n2. Run linter in check mode (detect from project: ruff, eslint, swiftlint, etc.)\n   If violations exist in files touched by this epic, auto-fix them.\n   Do NOT fix violations in untouched files.\n   Re-run tests after fixing.\n\n3. For each completed task in TASKS.md, verify its acceptance criteria have\n   corresponding passing tests. If an AC has no test \u2192 flag as a gap.\n\nReturn JSON:\n{\n  "tests_pass": true,\n  "test_count": N,\n  "lint_clean": true,\n  "lint_fixes": ["files that were auto-fixed"],\n  "ac_gaps": ["ACs with no corresponding test"],\n  "committed_fixes": true,\n  "commit_sha": "sha if lint fixes were committed"\n}\n\nOutput raw JSON only. No markdown fences.\n';

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

// skills/src/datum-validate.ts
var a = parseValidateArgs(args);
var yolo = a.yolo;
var noMergeMain = a.noMergeMain;
if (a.agentTypes && typeof a.agentTypes === "object") configureAgentTypes(a.agentTypes);
setBatchCacheKey(typeof a.configFingerprint === "string" ? a.configFingerprint : "");
setBatchRoot(typeof a.repoRoot === "string" ? a.repoRoot : "");
var repoCfg = {};
if (!a.testCommand) {
  const configReadStepList = configReadSteps();
  const configBatch = await runBatch(configReadStepList, bootstrapOpts("cli", { label: "read-config", model: model("fast") }));
  repoCfg = configFromSteps(configBatch);
}
if (!(a.agentTypes && typeof a.agentTypes === "object")) configureAgentTypes(readAgentTypeConfig(repoCfg));
var testCommand = a.testCommand || repoCfg.test_command || DEFAULT_CONFIG.test_command;
phase("Validate");
var syncSteps = mainSyncSteps(noMergeMain, repoCfg.main_branch);
var syncBatch = await runBatch(syncSteps, stageOpts("cli", { label: "main-sync", model: model("fast") }));
var syncResult = null;
var mainSync;
try {
  syncResult = mainSyncFromSteps(syncBatch, noMergeMain);
  mainSync = evaluateMainSync(syncResult, noMergeMain);
} catch (exc) {
  mainSync = { ok: false, message: exc.message };
}
if (!mainSync.ok) {
  log(`VALIDATION FAILED \u2014 ${mainSync.message}`);
} else {
  log(`Main sync: ${mainSync.message}`);
}
var checkResult = !mainSync.ok ? null : await agent(
  `First: determine the branch with \`git rev-parse --abbrev-ref HEAD\` and set epic_dir to docs/epics/$(git rev-parse --abbrev-ref HEAD).

Then perform validation:
${renderPrompt(validate_check_default, {
    wt: ".",
    specPath: "docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md",
    tasksPath: "docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md",
    testCommand,
    testRunCmd: testRunCommand(testCommand, ".", "validate")
  })}`,
  { label: "validate-check", model: model("balanced") }
);
var check = typeof checkResult === "string" ? parseAgentJson(checkResult, { tests_pass: false, test_count: 0, lint_clean: false, lint_fixes: [], ac_gaps: [] }) : checkResult;
var verifySteps = validateVerifySteps(testCommand, ".");
var verifyRaw = !mainSync.ok ? null : await agent(
  batchCommandPrompt(verifySteps),
  stageOpts("cli", { label: "validate-verify", phase: "Validate", model: model("fast") })
);
var verifyResult = parseBatchResult(verifyRaw, verifySteps);
var testExit = mainSync.ok ? testExitCode(stepStdout(verifyResult, "test-verify")) : null;
var testsPassed = testExit === 0;
log(`Tests: ${testsPassed ? "PASS" : "FAIL"} (independent run exit=${testExit === null ? "n/a" : testExit}; agent self-report tests_pass=${!!check?.tests_pass}, ${check?.test_count || "?"} tests)`);
log(`Lint: ${check?.lint_clean ? "clean" : `${(check?.lint_fixes || []).length} files fixed`}`);
if (check?.ac_gaps?.length > 0) log(`AC gaps: ${check.ac_gaps.join("; ")}`);
var gatePassed = false;
var gateMessage = "";
var gateNeedsHuman = false;
var hardStop = false;
if (!mainSync.ok) {
  gateMessage = `main_sync: ${mainSync.message || "epic branch is not in sync with main"}`;
  log("Validate gate skipped \u2014 epic branch is not in sync with main.");
} else if (testExit === null) {
  gateMessage = `validate_run_failed: independent test run did not execute (${describeFailure(verifyResult, "test-verify")})`;
  log(`VALIDATION FAILED \u2014 ${gateMessage}. Cannot proceed.`);
} else if (testExit !== 0) {
  gateMessage = `tests red: independent run exited ${testExit}${check?.tests_pass ? ", despite agent self-report of tests_pass=true" : ""}`;
  log(`VALIDATION FAILED \u2014 ${gateMessage}. Cannot proceed.`);
} else {
  const gateStepList = gateSteps("validate", yolo ? " --approve" : "");
  const gate = parseGateResult(await runBatch(gateStepList, stageOpts("cli", { label: "gate", model: model("fast") })));
  gatePassed = gate.passed;
  gateMessage = gate.message || "";
  gateNeedsHuman = !!gate.needsHuman;
  hardStop = !!gate.hardStop;
  if (gate.passed) log("Validate gate PASSED");
  else log(`Validate gate: ${gate.message || "needs review"}${gate.needsHuman ? " (needs human approval)" : ""}${gate.hardStop ? " (hard stop)" : ""}`);
}
return {
  testsPassed,
  testExitCode: testExit,
  lintClean: !!check?.lint_clean,
  acGaps: check?.ac_gaps || [],
  gatePassed,
  gateMessage,
  gateNeedsHuman,
  hardStop,
  mainSync: { ok: mainSync.ok, behind: syncResult?.behind ?? null, merged: !!syncResult?.merged, message: mainSync.message }
};
