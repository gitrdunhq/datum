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
  /** #425/#424: optional post-GREEN/Validate build check, alongside test_command. */
  build_command: "",
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
  const tail4 = (r.failed.stderr || r.failed.stdout).trim().split("\n").slice(-5).join("\n");
  return `${label}: step "${r.failed.name}" exited ${r.failed.exit_code}${tail4 ? ` \u2014 ${tail4}` : ""}`;
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

// skills/src/shared/tracker.ts
var q2 = (s) => `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
function publishSteps(lanePlanPath, epicTitle) {
  return [{ name: "publish", command: `datum plan-issues --lane-plan ${q2(lanePlanPath)} --title ${q2(epicTitle)}`, tolerant: true }];
}
function tail(step) {
  return (step.stderr || step.stdout || "").trim().split("\n").slice(-3).join(" | ");
}
function publishFromSteps(result) {
  if (result.missing) return { ok: false, parsed: null, error: `tracker_publish_failed: ${describeFailure(result, "publish")}` };
  const step = stepResult(result, "publish");
  if (!step) return { ok: false, parsed: null, error: "tracker_publish_failed: publish step did not run" };
  if (step.exit_code !== 0) return { ok: false, parsed: null, error: `tracker_publish_failed: datum plan-issues exited ${step.exit_code} \u2014 ${tail(step)}` };
  const parsed = parseAgentJson(step.stdout || "", null);
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, parsed: null, error: `tracker_publish_failed: datum plan-issues printed no JSON \u2014 ${(step.stdout || "").trim().slice(0, 200)}` };
  }
  return { ok: true, parsed, error: "" };
}
async function publishLanePlan(lanePlanPath, epicTitle) {
  const steps = publishSteps(lanePlanPath, epicTitle);
  const publish = publishFromSteps(await runBatch(steps, stageOpts("cli", { label: "publish-issues", model: model("fast") })));
  if (!publish.ok || !publish.parsed) {
    log(`[tracker] ${publish.error}`);
    return null;
  }
  const parsed = publish.parsed;
  if (parsed.skipped) {
    log(`[tracker] publish skipped: ${parsed.reason || parsed.skipped}`);
    return null;
  }
  return {
    epicId: String(parsed.epic_number || ""),
    taskIds: Object.fromEntries(
      Object.entries(parsed.task_issues || {}).map(([k, v]) => [k, String(v)])
    )
  };
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
function contextWitnessWrapInstruction(files, key) {
  const base = contextWitnessInstruction(files);
  if (base === "") return "";
  return base + `
Because this response would otherwise be a bare JSON array, return a single JSON object instead: {"read_witness": {...}, "${key}": <the array described above, unchanged>}. The array itself keeps exactly the schema above.`;
}
function unwrapWitnessedArray(parsed, key) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const inner = parsed[key];
  return Array.isArray(inner) ? inner : null;
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

// skills/src/shared/write-steps.ts
var HEREDOC_TERMINATOR = "DATUM_WRITE_EOF";
var q4 = (s) => `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
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
  const write = body === "" ? `: > ${q4(o.path)}` : `cat > ${q4(o.path)} <<'${HEREDOC_TERMINATOR}'
${body.slice(0, -1)}
${HEREDOC_TERMINATOR}`;
  return [
    { name: names.mkdir, command: `mkdir -p ${q4(dir)}` },
    { name: names.write, command: write },
    { name: names.sha, command: `git hash-object ${q4(o.path)}`, tolerant: true }
  ];
}
function writeFileBlobSha(content) {
  return gitBlobSha(utf8Encode(heredocBytes(content)));
}
function tail2(step) {
  return (step.stderr || step.stdout || "").trim().split("\n").slice(-3).join(" | ");
}
function writeFileFromSteps(result, o) {
  const names = o.names ?? DEFAULT_NAMES;
  if (result.missing) return { ok: false, error: `${o.prefix}_write_failed: ${describeFailure(result, names.write)}` };
  for (const name of [names.mkdir, names.write]) {
    const step = stepResult(result, name);
    if (!step) return { ok: false, error: `${o.prefix}_write_failed: ${name} step did not run` };
    if (step.exit_code !== 0) return { ok: false, error: `${o.prefix}_write_failed: ${name} exited ${step.exit_code} \u2014 ${tail2(step)}` };
  }
  const sha = (stepResult(result, names.sha)?.stdout || "").trim();
  if (sha !== o.expectedSha) {
    return { ok: false, error: `${o.prefix}_write_mismatch: ${o.path} on disk is blob ${sha || "(none)"}, the script wrote ${o.expectedSha} \u2014 the runner did not copy the heredoc verbatim` };
  }
  return { ok: true, error: "" };
}

// skills/src/shared/plan-steps.ts
var q5 = (s) => `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
function tail3(step) {
  return (step.stderr || step.stdout || "").trim().split("\n").slice(-3).join(" | ");
}
function lanePlanCommand(epicDir2) {
  return `datum lane-plan --input ${q5(`${epicDir2}/tasks.json`)} --output ${q5(`${epicDir2}/lane-plan.json`)} --md-output ${q5(`${epicDir2}/TASKS.md`)} --properties ${q5(`${epicDir2}/PROPERTIES.md`)}`;
}
var TASKS_WRITE_NAMES = { mkdir: "mkdir", write: "write-tasks", sha: "tasks-sha" };
function planBuildSteps(o) {
  if (o.tasksJson.includes("\n")) throw new Error("planBuildSteps: tasksJson must be a single line (JSON.stringify without indentation)");
  if (o.tasksJson.includes(HEREDOC_TERMINATOR)) throw new Error(`planBuildSteps: tasksJson contains the heredoc terminator ${HEREDOC_TERMINATOR}`);
  return [
    ...writeFileSteps({ path: `${o.epicDir}/tasks.json`, content: o.tasksJson, names: TASKS_WRITE_NAMES }),
    { name: "lane-plan", command: lanePlanCommand(o.epicDir) + (o.renumber ? " --renumber" : "") }
  ];
}
function tasksJsonBlobSha(tasksJson2) {
  return writeFileBlobSha(tasksJson2);
}
function planBuildFromSteps(result, expectedSha) {
  if (result.missing) return { ok: false, error: `plan_build_failed: ${describeFailure(result, "lane-plan")}` };
  const written = writeFileFromSteps(result, { path: "tasks.json", expectedSha, prefix: "plan", names: TASKS_WRITE_NAMES });
  if (!written.ok) return { ok: false, error: written.error.replace(/^plan_write_failed: /, "plan_build_failed: ") };
  const lanePlan = stepResult(result, "lane-plan");
  if (!lanePlan) return { ok: false, error: "plan_build_failed: lane-plan step did not run" };
  if (lanePlan.exit_code !== 0) return { ok: false, error: `plan_build_failed: datum lane-plan exited ${lanePlan.exit_code} \u2014 ${tail3(lanePlan)}` };
  return { ok: true, error: "" };
}
function skeletonBatchSteps(o) {
  const skeletonDir2 = `${o.epicDir}/skeletons`;
  return [
    { name: "mkdir", command: `mkdir -p ${q5(skeletonDir2)}` },
    { name: "skeleton", command: `datum skeleton --batch --language ${o.language} --tasks ${q5(`${o.epicDir}/lane-plan.json`)} --output-dir ${q5(skeletonDir2)}` }
  ];
}
function skeletonBatchFromSteps(result) {
  if (result.missing) return { ok: false, error: `skeleton_batch_failed: ${describeFailure(result, "skeleton")}` };
  const step = stepResult(result, "skeleton");
  if (!step) {
    const mk = stepResult(result, "mkdir");
    return { ok: false, error: `skeleton_batch_failed: skeleton step did not run${mk && mk.exit_code !== 0 ? ` (mkdir exited ${mk.exit_code} \u2014 ${tail3(mk)})` : ""}` };
  }
  if (step.exit_code !== 0) return { ok: false, error: `skeleton_batch_failed: datum skeleton exited ${step.exit_code} \u2014 ${tail3(step)}` };
  return { ok: true, error: "" };
}

// skills/src/prompts/plan-approaches.md
var plan_approaches_default = 'Architect. Read the SPEC and propose 2-3 implementation approaches.\n\nFor each approach:\n- One-sentence strategy description\n- Key tradeoffs (speed vs safety, complexity vs flexibility)\n- Which existing modules/files it touches most\n- Estimated task count and blast radius (low/medium/high)\n\nReturn JSON:\n{\n  "approaches": [\n    {\n      "name": "approach name",\n      "description": "one sentence",\n      "tradeoffs": "what you gain / give up",\n      "modules_touched": ["src/module/file1", "src/module/file2"],\n      "estimated_tasks": 3,\n      "blast_radius": "low|medium|high"\n    }\n  ],\n  "recommended": 0,\n  "recommendation_reason": "why this approach is simplest/safest"\n}\n\nOutput raw JSON only. No markdown fences.\n\nINPUTS\nSPEC content:\n{{specContent}}\n\nCodebase context (CURRENT_STATE.md):\n{{currentState}}\n';

// skills/src/prompts/plan-impact.md
var plan_impact_default = 'Impact analyzer. For each module/file the SPEC will change, assess blast radius.\n\nTOOLS (use in preference order):\n1. `ast-grep --pattern \'<function_name>($$$)\' .` \u2014 find all callers structurally\n2. `scc --no-cocomo <file>` \u2014 LOC and complexity for a specific file\n3. GitNexus (gitnexus_impact) if available\n4. grep as fallback\n\nFor each file: find its callers/importers structurally, get its LOC and complexity, check whether existing tests cover it, and rate the risk from caller count plus complexity.\n\nReturn JSON:\n{\n  "files": [\n    {\n      "path": "src/module/file",\n      "loc": 150,\n      "callers": ["src/other/module", "src/cli"],\n      "caller_count": 2,\n      "has_tests": true,\n      "test_files": ["tests/test_file"],\n      "risk": "low|medium|high",\n      "notes": "why this risk level"\n    }\n  ],\n  "high_risk_files": ["files with risk=high that need isolated lanes"]\n}\n\nOutput raw JSON only. No markdown fences.\n\nINPUTS\nWorking directory: {{wt}}\nFiles to analyze:\n{{filesList}}\n';

// skills/src/prompts/plan-triage.md
var plan_triage_default = 'Triage agent. Read the plan and decide if deep codebase research is needed before Act.\n\nRead docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md.\n\nEVALUATE against this rubric:\n1. Does the plan modify security, authentication, or core data models?\n2. Does any task touch more than 3 files or span multiple domains?\n3. Does it introduce a new dependency?\n4. Does it require adhering to existing, complex architectural patterns?\n\nROUTING:\n- If ANY of these are true \u2192 "deepen" (gather codebase evidence first)\n- If ALL are false (trivial changes, simple additions, isolated modules) \u2192 "properties"\n\nReturn JSON:\n{\n  "decision": "deepen|properties",\n  "reason": "one sentence justification",\n  "triggers": ["which rubric items triggered deepen, if any"]\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/plan-deepen.md
var plan_deepen_default = 'Evidence gatherer. Ground the plan in codebase reality by researching each complex task.\n\nRead docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md, then for each task that touches non-trivial logic:\n\n1. Search the codebase for existing implementations of similar logic\n2. Identify project conventions (how this pattern is usually handled here)\n3. Find known pitfalls in related code (error handling patterns, edge cases)\n4. Check test conventions in the relevant test directories\n\nTOOLS (use in preference order):\n1. `ast-grep --pattern \'<pattern>\' .` \u2014 structural search (e.g. find all try/except, all class defs, all async functions)\n2. GitNexus (gitnexus_context, gitnexus_query) if available\n3. grep/find for pattern matching\n\nAPPEND a single section to the end of docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md titled exactly `## Research Findings`.\nGroup findings by task ID. Keep it concise \u2014 patterns and pitfalls, not full file dumps.\n\nFormat:\n```markdown\n## Research Findings\n\n### task-id: Task Title\n- **Pattern**: See `module/file:45` for existing approach\n- **Convention**: This codebase uses X pattern for Y\n- **Pitfall**: Known issue with Z \u2014 handle via W\n```\n\nCRITICAL: Do NOT modify existing task content. Append-only to TASKS.md.\n\nDo NOT git add or git commit anything \u2014 the workflow commits TASKS.md after you return.\n\nReturn JSON: {"tasks_researched": N, "findings_count": N}\nOutput raw JSON only. No markdown fences.\n';

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
    const tail4 = (step.stderr || step.stdout).trim().split("\n").slice(-3).join(" | ");
    return {
      passed: false,
      needsHuman: false,
      hardStop: step.exit_code === 2,
      exitCode: step.exit_code,
      message: `gate_run_failed: datum gate exited ${step.exit_code} without JSON${tail4 ? ` \u2014 ${tail4}` : ""}`
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

// skills/src/shared/routing-steps.ts
var ROUTING_PATH = ".datum/routing.json";
function routingRestoreSteps() {
  return [
    {
      name: "routing-restore",
      command: `if git ls-files --error-unmatch ${ROUTING_PATH} >/dev/null 2>&1; then git checkout -- ${ROUTING_PATH} && printf 'tracked\\n'; else printf 'untracked\\n'; fi`
    }
  ];
}
function routingRestoreFromSteps(result) {
  const out = stepStdout(result, "routing-restore");
  if (out === null) return { tracked: null, note: "routing_restore_unchecked" };
  if (out.trim() === "tracked") return { tracked: true, note: "routing_json_tracked" };
  if (out.trim() === "untracked") return { tracked: false, note: "routing_json_untracked" };
  return { tracked: null, note: "routing_restore_unchecked" };
}

// skills/src/prompts/plan-decompose.md
var plan_decompose_default = 'Task decomposer. Break the SPEC into implementation tasks for the TDD pipeline.\n\nBUILD-ORDER / IMPORT ANALYSIS CHECK:\nBefore finalizing depends_on for any task, trace the actual import/reference graph implied by the codebase scan and the SPEC \u2014 which modules/files import or call which others \u2014 and make sure each task\'s depends_on reflects that real build order, not just narrative ordering from the SPEC. A task that will import or call code another task creates must depend_on that task.\n\nRULES:\n- VERTICAL SLICES: a task is a shippable, testable unit cut through every layer it needs (schema, logic, command, prompt, docs), so that when its lane merges a real caller can do one thing it could not do before. Never decompose layer-by-layer (all-state-then-all-UI, one layer per task, "the model", "the service", "the CLI" as three tasks); that defers every integration question to the last lane, where it is found in review instead of at the first merge. Make the first task the thinnest end-to-end slice, then widen. A plan in which no task crosses a layer boundary is reported by the gate as `plan_not_sliced`.\n- Each task maps to one lane in the TDD pipeline\n- Task ids MUST be `task-NNN` \u2014 zero-padded to three digits, numbered in the order you list them (task-001, task-002, ...). The schema gate rejects any other id shape. Put the descriptive name in the required `slug` field instead (lowercase letters, digits, hyphens; 3-61 chars; pattern `^[a-z0-9][a-z0-9-]{2,60}$`, e.g. "add-cycle-detection", "validate-input-schema"). `depends_on` references use the `task-NNN` ids, never slugs.\n- No task touches more than 5 files\n- The \'files\' array MUST list EVERY file the implementation agent will need to create or modify \u2014 not just the primary target. Omitting a file causes a file_ownership_violation at GREEN. When in doubt, include the file. Check the codebase scan for all files in the affected module.\n- PROTOCOL COMPLETENESS CHECK (do this for every task before finalizing its `files`): read each acceptance_criteria and ask "does satisfying this AC require adding or changing a method, property, or signature declared on a protocol, an abstract contract, a trait, or a base class?" (e.g. an AC like "use case calls repository.newMethod(...)" implies `newMethod` must be added to wherever the repository\'s contract is declared, not just its concrete implementation). If yes, search the repo (grep/ast-grep) for the declaration site of that contract/type \u2014 the keywords to search for vary by language ("protocol", "trait", "abstract", or the equivalent construct that declares a contract rather than an implementation) \u2014 and add that declaring file to `files` alongside the implementation file, since the lane\'s implementer needs to edit both in the same commit. Do not add it to `reads` in this case; `reads` is for files this task depends on but does not modify, and a contract gaining a new required member IS a modification. If no declaring file exists yet (the contract itself is new), say so in `red_note` instead of inventing a path.\n- GENERATED FILES: never list a generated file in `files`. A file whose first line carries `@generated` (for example the compiled `skills/*.js` bundles, whose source is `skills/src/*.ts` and whose prompts are `skills/src/prompts/*.md`) is rebuilt from its source after merge and is not edited by any lane; list the source file instead. `datum lane-plan` rejects a plan that lists one.\n- Tasks sharing files must have a dependency edge or be in the same lane\n- ADR SEQUENCE NUMBERS: `docs/adr/NNN-*.md` numbers must be unique across the whole plan and continue from the highest number already in docs/adr/ \u2014 list the directory before you assign any. Two lanes that each pick the next free number independently both pick the same one, and the second lane hits a file_ownership_violation at GREEN; the gate reports it as `plan_adr_sequence_collision`.\n- Each lane MUST have its own unique test file(s). Never assign the same test file to multiple lanes. If multiple tasks target the same module (e.g. `module/foo`), split tests per lane: `tests/test_foo_create`, `tests/test_foo_validate`, etc. This prevents reflect score pollution from cross-lane test accumulation.\n- Every task needs: id, slug, title, acceptance_criteria, files, reads, depends_on, red_note\n- ACs must be specific enough to write a failing test from \u2014 function names, expected values, exception types\n- red_note tells the RED agent what the failing test should prove \u2014 use the project\'s language and test framework, not Python/pytest unless that IS the project language\n- kind is "behavioral" (default) for any task that changes testable behavior. Set "kind": "structural" ONLY for tasks whose deliverable has no testable behavior at all \u2014 documentation-only (ADRs, README, docs/*.md), config-only, or pure file moves. Structural tasks skip the RED/GREEN test stages and run a single commit stage, so never mark a task structural if any acceptance criterion could be checked by a test.\n- depends_on lists task IDs this task requires to be completed first\n- reads lists files this task\'s implementation READS but does NOT modify (e.g. a protocol/contract file another lane owns). If a task reads a file another lane writes, it must either list that file in reads (so a dependency edge is auto-injected) or add an explicit depends_on \u2014 otherwise the reader may run before the writer produces that file.\n\nEPIC-SHAPE CHECKS \u2014 each fires only on the trigger named first. Skip a block whose trigger is absent from the SPEC.\n\n- NO-CODE-CHURN / DOCS-ONLY. Trigger: the SPEC states the epic\'s diff must contain zero files of some source extension, or calls itself documentation-only. Then any task whose `files[]` holds an extensionless, directory-shaped test artifact (a Swift Testing target directory, say) gets a `red_note` saying: write that artifact as a single extensionless file of plain-text assertions, not a compiled test package \u2014 no manifest file, no nested target subdirectory, no test-framework import. Decide it once here for every affected lane rather than leaving each lane to infer it.\n\n- UNIFICATION / FORK-CONSUMPTION PARITY. Trigger: the SPEC describes flipping consumers to a shared/canonical copy and deleting a fork. Then read both trees and compare the file sets and public API surface for the files the SPEC names \u2014 do not trust the SPEC\'s own audit narrative. Emit one port lane per concrete gap (a file only the fork has, a member its callers need, a divergence the SPEC notes) and add each to the flip lane\'s `depends_on`, so the flip lane means "flip now that parity is real". If the comparison cannot be made confidently, note the uncertainty in the flip lane\'s `red_note` rather than fabricating port lanes.\n\n- BASELINE SYNC. Trigger: the same unification epic, before the flip lane is final. Check whether the fork\'s target files on the epic branch still match `main` \u2014 `main` may hold fixes this plan does not account for. If they diverge, emit a sync-from-main lane scoped to the diverging files and put it ahead of the port lanes in the flip lane\'s `depends_on`. If it cannot be determined, say so in `red_note` instead of guessing.\n\nReturn JSON matching this schema:\n[\n  {\n    "id": "task-001",\n    "slug": "descriptive-task-name",\n    "title": "Human-readable title",\n    "description": "What this task implements",\n    "acceptance_criteria": [\n      "function_name(input) returns expected_output",\n      "function_name(bad_input) raises SpecificError with \'message\'"\n    ],\n    "files": ["src/module/file", "tests/test_file"],\n    "reads": [],\n    "depends_on": [],\n    "introduces_stubs": false,\n    "kind": "behavioral",\n    "red_note": "The failing test must call function_name with input and assert on the return value",\n    "estimated_loc": 50\n  }\n]\n\nOutput raw JSON only. No markdown fences.\n\nINPUTS\nLanguage: {{language}}\nTest framework: {{testFramework}}\n\nSPEC content:\n{{specContent}}\n\nChosen approach:\n{{chosenApproach}}\n\nCodebase scan (files, patterns, test conventions):\n{{scanContext}}\n\nPrior failure patterns:\n{{priorFailures}}\n\nPROJECT BUILD CONSTRAINTS:\n{{contextFilesSection}}\nThe context_files section here (when present) lists project documentation that is authoritative for build order and module boundaries. Where these project docs conflict with a build order you would otherwise infer from source imports, the project docs take precedence over inferred imports \u2014 follow the documented order and note the override in the affected task\'s red_note.\n';

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

// skills/src/datum-plan.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
if (a.agentTypes && typeof a.agentTypes === "object") configureAgentTypes(a.agentTypes);
setBatchCacheKey(a.configFingerprint || "");
setBatchRoot(typeof a.repoRoot === "string" ? a.repoRoot : "");
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
var readBatch = await runBatch(probeSteps, bootstrapOpts("cli", { label: "read-context", model: model("fast") }));
var relayPlan = contextRelayPlan(readBatch, [SPEC_REL]);
var inlineBatch = null;
var inlineSteps = contextInlineSteps(relayPlan.inline);
if (relayPlan.inline.length > 0) {
  inlineBatch = await runBatch(inlineSteps, bootstrapOpts("cli", { label: "read-context-files", model: model("fast") }));
}
var ctx = contextFromRelay(readBatch, inlineBatch, relayPlan);
if (ctx.mismatched.length > 0) {
  log(`read-context: context_relay_mismatch on ${ctx.mismatched.join(", ")} \u2014 re-fetching once with a fresh runner`);
  const retryBatch = parseBatchResult(
    await agent(contextInlineRetryPrompt(inlineSteps), bootstrapOpts("cli", { label: "read-context-files:retry", model: model("fast") })),
    inlineSteps
  );
  ctx = mergeRelayRetry(ctx, contextFromRelay(readBatch, retryBatch, relayPlan));
}
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
var configBatch = await runBatch(configReadStepList, bootstrapOpts("cli", { label: "read-config", model: model("fast") }));
var repoCfg = { ...DEFAULT_CONFIG, ...configFromSteps(configBatch) };
if (!(a.agentTypes && typeof a.agentTypes === "object")) configureAgentTypes(readAgentTypeConfig(repoCfg));
var language = repoCfg.language || DEFAULT_CONFIG.language;
var testFramework = repoCfg.test_framework || DEFAULT_CONFIG.test_framework;
var contextFilesList = repoCfg.context_files || [];
var contextFileContents = {};
var contextFileEntries = [];
var contextFilesWarnings = [];
if (contextFilesList.length > 0) {
  const cfProbeSteps = contextProbeSteps({ files: contextFilesList });
  const cfProbe = await runBatch(cfProbeSteps, stageOpts("cli", { label: "probe-context-files", model: model("fast") }));
  const cfPlan = contextRelayPlan(cfProbe, contextFilesList);
  let cfInline = null;
  const cfInlineSteps = contextInlineSteps(cfPlan.inline);
  if (cfPlan.inline.length > 0) {
    cfInline = await runBatch(cfInlineSteps, stageOpts("cli", { label: "read-context-files", model: model("fast") }));
  }
  let cf = contextFromRelay(cfProbe, cfInline, cfPlan);
  if (cf.mismatched.length > 0) {
    log(`context_files: context_relay_mismatch on ${cf.mismatched.join(", ")} \u2014 re-fetching once with a fresh runner`);
    const cfRetry = parseBatchResult(
      await agent(contextInlineRetryPrompt(cfInlineSteps), stageOpts("cli", { label: "read-context-files:retry", model: model("fast") })),
      cfInlineSteps
    );
    cf = mergeRelayRetry(cf, contextFromRelay(cfProbe, cfRetry, cfPlan));
  }
  for (const warning of cf.warnings) contextFilesWarnings.push(warning);
  for (const relPath of contextFilesList) {
    const f = cf.files[relPath];
    contextFileContents[relPath] = f.exists ? contextSlot(f) : null;
    if (f.exists) contextFileEntries.push(f);
  }
}
var contextFilesSection = buildContextFilesSection(
  contextFileContents,
  (msg) => contextFilesWarnings.push(msg)
);
for (const warning of contextFilesWarnings) log(`context_files: ${warning}`);
var refineGate = parseGateResult(await runBatch(gateSteps("refine", " --approve"), stageOpts("cli", { label: "gate-refine-prereq", model: model("fast") })));
if (!refineGate.passed) {
  throw new Error(`plan_prerequisite_failed: SPEC.md would not pass the refine gate \u2014 fix it (${refineGate.message || "no message"}) and re-run datum plan; no planning agent was dispatched`);
}
log("Refine prerequisite gate PASSED (SPEC.md structurally sound)");
phase("Decompose");
var approachesRaw = await agent(
  withPreamble(renderPrompt(plan_approaches_default, { specContent, currentState: currentState || "(not available)" }) + contextWitnessInstruction([specFile])),
  { label: "propose-approaches", model: model("balanced") }
);
var approaches = parseAgentJsonStrict(approachesRaw, "propose-approaches");
assertReadWitness([specFile], approaches);
if (!Array.isArray(approaches.approaches) || approaches.approaches.length === 0) throw new Error(`plan_no_approaches: propose-approaches returned no approaches (recommendation: ${approaches.recommendation_reason || "none"})`);
var chosen = approaches.approaches[approaches.recommended] || approaches.approaches[0];
log(`Selected: ${chosen?.name || "default"} \u2014 ${approaches.recommendation_reason}`);
var impactRaw = await agent(
  withPreamble(renderPrompt(plan_impact_default, { wt: ".", filesList: (chosen?.modules_touched || []).join("\n") || specContent })),
  { label: "impact-analysis", model: model("balanced") }
);
var impactStr = typeof impactRaw === "string" ? impactRaw : JSON.stringify(impactRaw);
var isComplex = chosen?.blast_radius === "high" || (chosen?.estimated_tasks || 0) > 5;
var decomposeModel = isComplex ? model("deep") : model("balanced");
if (isComplex) log("Complex epic \u2014 using opus for decomposition");
var decomposeFiles = [specFile, ...contextFileEntries];
var tasksRaw = await agent(
  withPreamble(renderPrompt(plan_decompose_default, { specContent, chosenApproach: JSON.stringify(chosen), scanContext: impactStr, priorFailures, language, testFramework, contextFilesSection }) + contextWitnessWrapInstruction(decomposeFiles, "tasks")),
  { label: "decompose-tasks", model: decomposeModel }
);
var tasksParsed = typeof tasksRaw === "string" ? parseAgentJson(tasksRaw, []) : tasksRaw;
assertReadWitness(decomposeFiles, tasksParsed);
var tasks = unwrapWitnessedArray(tasksParsed, "tasks");
if (!Array.isArray(tasks) || tasks.length === 0) {
  throw new Error(`Task decomposition returned 0 tasks \u2014 refusing to write an empty lane plan. Raw output: ${String(tasksRaw).slice(0, 300)}`);
}
assertAcyclicTasks(tasks);
var tasksJson = JSON.stringify(tasks);
log(`Decomposed into ${tasks.length} tasks`);
for (const task of tasks) {
  const deps = task.depends_on && task.depends_on.length > 0 ? ` (depends: ${task.depends_on.join(", ")})` : "";
  log(`  ${task.id}: ${task.title}${deps}`);
}
var buildSteps = planBuildSteps({ epicDir, tasksJson });
var build = planBuildFromSteps(await runBatch(buildSteps, stageOpts("cli", { label: "build-lane-plan", model: model("fast") })), tasksJsonBlobSha(tasksJson));
if (!build.ok) throw new Error(build.error);
var earlyGateSteps = gateSteps("plan", " --approve");
var earlyGate = parseGateResult(await runBatch(earlyGateSteps, stageOpts("cli", { label: "gate-early", model: model("fast") })));
if (!earlyGate.passed) {
  throw new Error(`Plan gate failed right after datum lane-plan \u2014 plan NOT committed (fix the file the message names: tasks.json for lane/overlap errors, SPEC.md's Assumption Audit for assumption errors; then re-run datum plan): ${earlyGate.message || "no message"}`);
}
log("Early plan gate PASSED (schema + structure)");
async function commitPlanFiles(files, message, label) {
  const commitStepList = commitFilesSteps({ wt: ".", files, message });
  const commit = commitFilesFromSteps(await runBatch(commitStepList, stageOpts("cli", { label, model: model("fast") })));
  if (commit.error) throw new Error(`plan_commit_failed: ${commit.error}`);
  if (commit.nothingToCommit) {
    log(`${label}: ${files.join(", ")} unchanged since the last run \u2014 already committed`);
    return "unchanged";
  }
  return commit.sha;
}
var planCommit = await commitPlanFiles(
  [`${epicDir}/tasks.json`, `${epicDir}/lane-plan.json`, `${epicDir}/TASKS.md`],
  "plan: tasks.json + lane-plan.json + TASKS.md",
  "commit-lane-plan"
);
log(`Lane plan built, gated, and committed (${planCommit})`);
var skeletonDir = `${epicDir}/skeletons`;
var skeletonSteps = skeletonBatchSteps({ epicDir, language });
var skeleton = skeletonBatchFromSteps(await runBatch(skeletonSteps, stageOpts("cli", { label: "skeleton-batch", model: model("fast") })));
if (!skeleton.ok) throw new Error(skeleton.error);
await commitPlanFiles([skeletonDir], "plan: pre-generate RED skeletons", "commit-skeletons");
log(`Skeletons pre-generated in ${skeletonDir}`);
phase("Triage");
var triageRaw = await agent(
  plan_triage_default,
  { label: "triage-decision", model: model("fast") }
);
var triage = parseAgentJson(triageRaw, { decision: "properties", reason: "parse failure", triggers: [] });
log(`Triage: ${triage.decision} \u2014 ${triage.reason}`);
var routingJson = JSON.stringify(triage, null, 2);
var routingSteps = writeFileSteps({ path: ".datum/routing.json", content: routingJson });
var routingWritten = writeFileFromSteps(await runBatch(routingSteps, stageOpts("cli", { label: "write-routing", model: model("fast") })), { path: ".datum/routing.json", expectedSha: writeFileBlobSha(routingJson), prefix: "routing" });
if (!routingWritten.ok) throw new Error(routingWritten.error);
var triageGateSteps = gateSteps("triage", "");
var triageGate = parseGateResult(await runBatch(triageGateSteps, stageOpts("cli", { label: "gate-triage", model: model("fast") })));
if (!triageGate.passed) throw new Error(`Triage gate failed \u2014 routing.json rejected: ${triageGate.message || "no message"}`);
var routingRestore = routingRestoreFromSteps(await runBatch(routingRestoreSteps(), stageOpts("cli", { label: "routing-restore", model: model("fast") })));
if (routingRestore.tracked === true) log(`routing_json_tracked: ${ROUTING_PATH} is committed in this repo and was restored after the triage gate \u2014 untrack it (git rm --cached ${ROUTING_PATH}) so plan runs leave the tree clean`);
else if (routingRestore.tracked === null) log(`routing_restore_unchecked: could not tell whether ${ROUTING_PATH} is tracked; a committed copy may show as modified`);
if (triage.decision === "deepen") {
  const deepenRaw = await agent(
    plan_deepen_default,
    { label: "deepen-research", model: model("balanced") }
  );
  const deepen = parseAgentJson(deepenRaw, { tasks_researched: 0, findings_count: 0 });
  log(`Deepen: ${deepen.tasks_researched} tasks, ${deepen.findings_count} findings`);
  await commitPlanFiles([`${epicDir}/TASKS.md`], "plan: deepen - research findings", "commit-deepen");
  const deepenGateSteps = gateSteps("deepen", "");
  const deepenGate = parseGateResult(await runBatch(deepenGateSteps, stageOpts("cli", { label: "gate-deepen", model: model("fast") })));
  if (!deepenGate.passed) throw new Error(`Deepen gate failed \u2014 TASKS.md carries no Research Findings after the deepen agent ran: ${deepenGate.message || "no message"}`);
  log("Deepen gate PASSED");
} else {
  log("Deepen skipped");
}
var gateStepList = gateSteps("plan", yolo ? " --approve" : "");
var gate = parseGateResult(await runBatch(gateStepList, stageOpts("cli", { label: "gate", model: model("fast") })));
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
