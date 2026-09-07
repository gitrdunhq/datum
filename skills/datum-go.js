// @generated — DO NOT EDIT. Source: skills/src/datum-go.ts
export const meta = {
  name: "datum-go",
  description: "Full pipeline: TICKET \u2192 SPEC \u2192 Plan \u2192 Properties \u2192 Act \u2192 Validate \u2192 Review \u2192 Closeout",
  phases: []
};

// skills/src/shared/utils.ts
function buildWaves(lanePlan) {
  const lanes = lanePlan.lanes;
  const ids = Object.keys(lanes);
  const inDeg = {};
  const adj = {};
  for (const id of ids) {
    const deps = lanes[id].depends_on || [];
    for (const dep of deps) {
      if (!lanes[dep]) {
        throw new Error(
          `Task '${id}' depends on '${dep}', which does not exist in the lane plan`
        );
      }
    }
    inDeg[id] = deps.length;
    for (const dep of deps) {
      ;
      (adj[dep] = adj[dep] || []).push(id);
    }
  }
  const waves = [];
  let queue = ids.filter((id) => inDeg[id] === 0).sort();
  while (queue.length > 0) {
    waves.push([...queue]);
    const next = [];
    for (const id of queue) {
      for (const child of adj[id] || []) {
        inDeg[child]--;
        if (inDeg[child] === 0) next.push(child);
      }
    }
    queue = next.sort();
  }
  const placed = new Set(waves.flat());
  const cyclic = ids.filter((id) => !placed.has(id));
  if (cyclic.length > 0) {
    throw new Error(
      `Cyclic dependency detected among tasks: ${cyclic.sort().join(", ")}`
    );
  }
  return waves;
}
function packWaves(waves, maxBatch, lanePlan) {
  if (lanePlan) {
    return packWavesSafe(waves, maxBatch, lanePlan);
  }
  if (waves.length <= 2) {
    return packWavesMerging(waves, maxBatch);
  }
  return packWavesStrict(waves, maxBatch);
}
function packWavesSafe(waves, maxBatch, lanePlan) {
  const batches = [];
  let current = [];
  for (const wave of waves) {
    for (const id of wave) {
      const deps = lanePlan.lanes?.[id]?.depends_on || [];
      const blockedByCurrent = deps.some((d) => current.includes(d));
      if (current.length > 0 && (current.length >= maxBatch || blockedByCurrent)) {
        batches.push(current);
        current = [];
      }
      current.push(id);
    }
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}
function packWavesMerging(waves, maxBatch) {
  const batches = [];
  let current = [];
  for (const wave of waves) {
    let idx = 0;
    while (idx < wave.length) {
      const remaining = maxBatch - current.length;
      if (remaining <= 0) {
        batches.push(current);
        current = [];
        continue;
      }
      const take = Math.min(remaining, wave.length - idx);
      current.push(...wave.slice(idx, idx + take));
      idx += take;
    }
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}
function packWavesStrict(waves, maxBatch) {
  const batches = [];
  for (const wave of waves) {
    let idx = 0;
    while (idx < wave.length) {
      const take = Math.min(maxBatch, wave.length - idx);
      batches.push(wave.slice(idx, idx + take));
      idx += take;
    }
  }
  return batches;
}
function epicSlug(branch) {
  return branch.replace(/[^A-Za-z0-9._-]/g, "-");
}
function resolveLanePlanPath(epicDir, agentResult) {
  const resolved = agentResult.trim();
  if (resolved === "final") return `${epicDir}/lane-plan-final.json`;
  if (resolved === "default") return `${epicDir}/lane-plan.json`;
  throw new Error(`No lane-plan.json found \u2014 tried: ${epicDir}/lane-plan-final.json, ${epicDir}/lane-plan.json`);
}
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
function setModelTiers(tiers) {
  activeTiers = { ...DEFAULT_TIERS, ...tiers };
}
function model(tier) {
  return activeTiers[tier];
}
var PHASES = ["refine", "plan", "properties", "act", "validate", "review", "closeout"];
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
function mergeConfig(globalCfg2, repoCfg) {
  const g = globalCfg2 && typeof globalCfg2 === "object" ? globalCfg2 : {};
  const r = repoCfg && typeof repoCfg === "object" ? repoCfg : {};
  const merged = { ...g, ...r };
  const gModels = g.models && typeof g.models === "object" ? g.models : {};
  const rModels = r.models && typeof r.models === "object" ? r.models : {};
  if (g.models || r.models) {
    merged.models = { ...gModels, ...rModels };
  }
  return merged;
}
function skillPath(skillsDir, name) {
  if (skillsDir) return `${skillsDir}/${name}.js`;
  return `skills/${name}.js`;
}

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- Test command comes from `.datum/config.json` `test_command` field \u2014 read it, don't guess\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500 lines is a review trigger: split only on a real functional seam, never to hit a number\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (from `.datum/config.json`)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Context Budget\n- When `headroom_compress` and `headroom_retrieve` are available, use them for files over 100 lines: compress after reading, then retrieve with a targeted query when you need a section back. This is the expected path on the local-model runtime. When they are not available, read the file and move on \u2014 never block on them, never report a hash you did not produce\n";

// skills/src/prompts/lane-state-read.md
var lane_state_read_default = 'Report which lanes of epic {{epicBranch}} already have epic-scoped completion markers.\n\nRun this exact script from the repo root and return ONLY its stdout \u2014 raw JSON, no markdown fences, no commentary. It calls `datum lane-state read` (the deterministic CLI, not hand-written file parsing) once per task id:\n\n```\nOUT=\'{}\'\nfor TID in {{taskIdsSpace}}; do\n  R=$(datum lane-state read --epic "{{epicBranch}}" --task "$TID")\n  STATUS=$(echo "$R" | jq -r \'.status // "not_found"\')\n  if [ "$STATUS" = "not_found" ]; then continue; fi\n  MC=$(echo "$R" | jq -r \'.merge_commit // ""\')\n  SHASH=$(echo "$R" | jq -r \'.spec_hash // ""\')\n  ANC=false\n  if [ -n "$MC" ] && git merge-base --is-ancestor "$MC" "{{epicBranch}}" 2>/dev/null; then\n    ANC=true\n  fi\n  OUT=$(echo "$OUT" | jq --arg tid "$TID" --arg status "$STATUS" --arg spec_hash "$SHASH" --argjson ancestor "$ANC" \\\n    \'. + {($tid): {status: $status, spec_hash: $spec_hash, ancestor: $ancestor}}\')\ndone\necho "$OUT"\n```\n\nIf no markers exist for any task id, the script prints `{}` \u2014 that is the correct output. Do not create any files or directories.\n';

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

// skills/src/shared/context-relay.ts
var CONTEXT_RELAY_BUDGET_BYTES = 16 * 1024;

// skills/src/shared/lane-steps.ts
var q = (s) => `"${s.replace(/"/g, '\\"')}"`;
function fencedScript(rendered) {
  const m = rendered.match(/```[a-z]*\n([\s\S]*?)\n```/);
  if (!m) throw new Error("template has no fenced script block");
  return m[1];
}
var SCOPE_READ_BUDGET_BYTES = 16 * 1024;
function cleanupSteps(batchRunId, epicBranch) {
  return [{
    name: "cleanup",
    command: `datum worktrees cleanup --run-id ${q(batchRunId)} --epic-branch ${q(epicBranch)}`,
    tolerant: true
  }];
}
function actStartSteps(o) {
  const steps = [];
  if (o.branch === "init") {
    steps.push({ name: "bootstrap", command: `__boot=$(${o.initCmd || "datum init --json"}) && printf '%s' "$__boot"` });
    steps.push({ name: "branch", command: `__eb=$(printf '%s' "$__boot" | jq -r '.epicBranch // empty') && [ -n "$__eb" ] && printf '%s' "$__eb"` });
  } else if (o.branch === "detect") {
    steps.push({ name: "branch", command: `__eb=$(git rev-parse --abbrev-ref HEAD) && printf '%s' "$__eb"` });
  } else {
    steps.push({ name: "branch", command: `__eb=${q(o.branch)} && printf '%s' "$__eb"` });
  }
  steps.push({ name: "timestamp", command: "date +%Y%m%d-%H%M%S" });
  if (o.lanePlanPath) {
    steps.push({ name: "resolve", command: `__plan=${q(o.lanePlanPath)} && echo given` });
  } else {
    steps.push({
      name: "resolve",
      command: `__epic="docs/epics/$__eb"
if [ -f "$__epic/lane-plan-final.json" ]; then __plan="$__epic/lane-plan-final.json"; echo final; elif [ -f "$__epic/lane-plan.json" ]; then __plan="$__epic/lane-plan.json"; echo default; else __plan=""; echo none; fi`,
      tolerant: true
    });
  }
  steps.push({
    name: "digest",
    // The CLI's stdout is the digest on success (already in the temp file,
    // not repeated here) and a JSON error on failure — printed only then, so
    // lanePlanDigestFromSteps can name the real cause (review finding: a
    // `>/dev/null` hid every CLI error behind a blank tail).
    command: `__digest=$(mktemp) && if [ -n "$__plan" ]; then __dout=$(datum lane-plan-digest --plan "$__plan" --out "$__digest"); __drc=$?; if [ "$__drc" -ne 0 ]; then printf '%s' "$__dout"; fi; [ "$__drc" -eq 0 ]; else printf ''; fi`,
    tolerant: true
  });
  steps.push({ name: "digest-bytes", command: `if [ -n "$__plan" ]; then wc -c < "$__digest" | tr -d ' '; else printf -- '-1'; fi`, tolerant: true });
  steps.push({ name: "digest-sha", command: `if [ -n "$__plan" ]; then git hash-object "$__digest"; else printf ''; fi`, tolerant: true });
  steps.push({
    name: "digest-cat",
    command: `if [ -n "$__plan" ] && [ "$(wc -c < "$__digest" | tr -d ' ')" -le ${LANE_PLAN_DIGEST_BUDGET_BYTES} ]; then cat "$__digest"; else echo DIGEST_TOO_LARGE; fi`,
    tolerant: true
  });
  steps.push({ name: "lane-state-read", command: o.laneStateReadScript.trim(), tolerant: true });
  return steps;
}
var LANE_PLAN_DIGEST_BUDGET_BYTES = 16 * 1024;
function lanePlanDigestFromSteps(result, planPath) {
  const none = { ok: false, digest: null };
  if (result.missing) return { ...none, error: `lane_plan_digest_failed: ${describeFailure(result, "digest")}` };
  const digestStep = stepResult(result, "digest");
  if (!digestStep) return { ...none, error: "lane_plan_digest_failed: digest step did not run" };
  if (digestStep.exit_code !== 0) {
    const tail = (digestStep.stderr || digestStep.stdout || "").trim().split("\n").slice(-3).join(" | ");
    return { ...none, error: `lane_plan_digest_failed: datum lane-plan-digest exited ${digestStep.exit_code} for ${planPath} \u2014 ${tail}` };
  }
  const bytes = parseInt((stepStdout(result, "digest-bytes") || "").trim(), 10);
  const sha = (stepStdout(result, "digest-sha") || "").trim();
  if (!Number.isFinite(bytes) || bytes < 0 || !sha) {
    return { ...none, error: `lane_plan_digest_failed: no digest bytes/sha for ${planPath} (${describeFailure(result, "digest-bytes")})` };
  }
  if (bytes > LANE_PLAN_DIGEST_BUDGET_BYTES) {
    return { ...none, error: `lane_plan_digest_too_large: ${planPath} is ${bytes} bytes as a digest (budget ${LANE_PLAN_DIGEST_BUDGET_BYTES}) \u2014 split the epic or run Act on a smaller lane plan; the plan is never chunked through an LLM turn` };
  }
  const text = stepStdout(result, "digest-cat") || "";
  const gotBytes = utf8ByteLength(text);
  const gotSha = gitBlobSha(utf8Encode(text));
  if (gotBytes !== bytes || gotSha !== sha) {
    return { ...none, error: `lane_plan_digest_mismatch: ${planPath} digest \u2014 expected ${bytes} bytes / blob ${sha}, got ${gotBytes} bytes / blob ${gotSha} \u2014 the runner did not return the digest verbatim` };
  }
  const digest = parseAgentJson(text, null);
  if (!digest || typeof digest !== "object" || !digest.lanes || !Array.isArray(digest.topological_order)) {
    return { ...none, error: `lane_plan_digest_unparseable: ${planPath} digest did not parse as {lanes, topological_order}` };
  }
  return { ok: true, digest, error: "" };
}
function digestSpecHash(digest, taskId) {
  const lane = digest.lanes[taskId];
  if (!lane) throw new Error(`lane_plan_digest_unparseable: lane ${taskId} is not in the digest`);
  if (typeof lane.spec_hash !== "string" || !lane.spec_hash) throw new Error(`lane_plan_digest_unparseable: lane ${taskId} carries no spec_hash`);
  return lane.spec_hash;
}

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function laneStateReadPrompt(vars) {
  return renderPrompt(lane_state_read_default, vars);
}
function laneStateReadScript(vars) {
  return fencedScript(laneStateReadPrompt(vars));
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
function agentTypeArgs() {
  return { ...state };
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

// skills/src/shared/pipeline-state.ts
function parseState(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw.replace(/```[a-z]*\n?/g, "").trim());
  } catch {
    return null;
  }
}
function isStaleState(state2, currentBranch2) {
  if (!state2 || !currentBranch2) return false;
  return state2.branch !== currentBranch2;
}
var q2 = (s) => `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
function pipelineStateSaveSteps(o) {
  const testsFlag = o.phase === "validate" ? o.testsPass ? " --tests-pass" : " --tests-fail" : "";
  return [{
    name: "save",
    command: `datum pipeline-state-save --phase ${q2(o.phase)} --run-id ${q2(o.runId)} --route ${q2(o.route)}${testsFlag}`,
    tolerant: true
  }];
}
function pipelineStateSaveFromSteps(result, phase) {
  const unverified = (why) => ({ recorded: false, refused: false, reason: `pipeline_state_save_unverified: ${why}` });
  if (result.missing) return unverified(describeFailure(result, "save"));
  const step = stepResult(result, "save");
  if (!step) return unverified("save step did not run");
  let json = null;
  try {
    const text = (step.stdout || "").trim();
    const start = text.indexOf("{");
    json = start >= 0 ? JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) : null;
  } catch {
    json = null;
  }
  if (json && json.verified === false) {
    return { recorded: false, refused: true, reason: `pipeline_state_save_refused: ${typeof json.reason === "string" ? json.reason : "no reason given"}` };
  }
  if (step.exit_code !== 0) {
    const tail = (step.stderr || step.stdout || "").trim().split("\n").slice(-3).join(" | ");
    return unverified(`datum pipeline-state-save exited ${step.exit_code}${tail ? ` \u2014 ${tail}` : ""}`);
  }
  const completed = json && Array.isArray(json.completedPhases) ? json.completedPhases : null;
  if (!completed || !completed.includes(phase)) {
    return unverified(`exit 0 but the printed state does not list "${phase}" as completed`);
  }
  return { recorded: true, refused: false, reason: "" };
}
function detectStartFrom(state2) {
  if (!state2 || !state2.completedPhases?.length) return null;
  const ORDER = ["refine", "plan", "properties", "act", "validate", "review", "closeout"];
  const lastCompleted = state2.completedPhases[state2.completedPhases.length - 1];
  const idx = ORDER.indexOf(lastCompleted);
  if (idx >= 0 && idx < ORDER.length - 1) return ORDER[idx + 1];
  return null;
}

// skills/src/shared/boot.ts
var LOCAL_SKILLS_DIR = ".datum/skills";
function isUnder(path, root) {
  const r = root.replace(/\/+$/, "");
  return path === r || path.startsWith(r + "/");
}
function resolveSkillPath(opts) {
  const file = `${opts.name}.js`;
  if ((opts.localSkills || []).includes(file)) {
    return { path: `${LOCAL_SKILLS_DIR}/${file}`, outsideRepo: false };
  }
  const path = skillPath(opts.skillsDir || "", opts.name);
  const outsideRepo = path.startsWith("/") && !!opts.repoRoot && !isUnder(path, opts.repoRoot);
  return { path, outsideRepo };
}
function skillsDirHint(skillsDir) {
  return `skills_dir "${skillsDir}" is outside this repo and the Workflow harness will refuse it \u2014 run \`datum init --refresh-skills\` to copy the skills into ${LOCAL_SKILLS_DIR}/, or run \`/add-dir ${skillsDir}\` before launching.`;
}
function bootSteps() {
  return [
    { name: "global-config", command: "cat ~/.datum/config.json 2>/dev/null || echo '{}'", tolerant: true },
    { name: "repo-config", command: "cat .datum/config.json" },
    { name: "state", command: "cat .datum/pipeline-state.json 2>/dev/null || echo null", tolerant: true },
    {
      name: "local-skills",
      command: `for f in ${LOCAL_SKILLS_DIR}/*.js; do [ -e "$f" ] && basename "$f" .js; done`,
      tolerant: true
    },
    { name: "repo-root", command: "git rev-parse --show-toplevel", tolerant: true },
    { name: "branch", command: "git rev-parse --abbrev-ref HEAD", tolerant: true }
  ];
}
function bootFromSteps(result) {
  const repoConfigStep = stepResult(result, "repo-config");
  if (!repoConfigStep || repoConfigStep.exit_code !== 0) {
    throw new Error("missing .datum/config.json \u2014 run datum init first");
  }
  let repoCfgParsed;
  try {
    repoCfgParsed = JSON.parse(repoConfigStep.stdout || "");
  } catch {
    throw new Error("missing .datum/config.json \u2014 run datum init first");
  }
  let globalCfgParsed = {};
  try {
    globalCfgParsed = JSON.parse(stepStdout(result, "global-config") || "{}");
  } catch {
    globalCfgParsed = {};
  }
  const config = mergeConfig(globalCfgParsed, repoCfgParsed);
  const stateRaw = (stepStdout(result, "state") || "null").trim();
  let state2 = null;
  if (stateRaw && stateRaw !== "null") {
    try {
      state2 = JSON.parse(stateRaw);
    } catch (exc) {
      throw new Error(
        `pipeline_state_corrupt: .datum/pipeline-state.json exists but could not be parsed as JSON: ${exc.message}`
      );
    }
  }
  const localSkills = (stepStdout(result, "local-skills") || "").split("\n").map((s) => s.trim()).filter(Boolean).map((s) => s.endsWith(".js") ? s : `${s}.js`);
  const repoRoot = (stepStdout(result, "repo-root") || "").trim();
  const currentBranch2 = (stepStdout(result, "branch") || "").trim();
  if (!repoRoot) {
    throw new Error("boot: could not determine repo root (`git rev-parse --show-toplevel` failed \u2014 not a git repo?)");
  }
  if (!currentBranch2) {
    throw new Error("boot: could not determine current branch (`git rev-parse --abbrev-ref HEAD` failed)");
  }
  return { config, state: state2, localSkills, repoRoot, currentBranch: currentBranch2 };
}
function runCommandPrompt(command) {
  return "Run exactly this command with the Bash tool and return only its stdout, nothing else. Do not ask for clarification, do not message anyone, do not summarise or explain \u2014 this prompt is the whole task.\n\n" + command;
}
var SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
function newEpicBootstrapSteps(slug) {
  if (!SLUG_RE.test(slug)) throw new Error(`newEpicBootstrapSteps: invalid slug ${JSON.stringify(slug)} \u2014 expected kebab-case [a-z0-9-]`);
  return [{ name: "init", command: `datum init --name ${slug} --json` }];
}
function newEpicBootstrapFromSteps(result, slug) {
  const none = { ok: false, epicBranch: "" };
  if (result.missing) return { ...none, error: describeFailure(result, "init") };
  const step = stepResult(result, "init");
  if (!step) return { ...none, error: "init step did not run" };
  if (step.exit_code !== 0) {
    const tail = (step.stderr || step.stdout || "").trim().split("\n").slice(-3).join(" | ");
    return { ...none, error: `datum init --name ${slug} --json exited ${step.exit_code} \u2014 ${tail}` };
  }
  const parsed = parseAgentJson(step.stdout || "", null);
  const epicBranch = parsed && typeof parsed.epicBranch === "string" ? parsed.epicBranch.trim() : "";
  if (!epicBranch) return { ...none, error: `datum init printed no epicBranch \u2014 ${(step.stdout || "").trim().slice(0, 200)}` };
  return { ok: true, epicBranch, error: "" };
}
var NO_FINGERPRINT_WARNING = 'args.configFingerprint not set \u2014 on Workflow resume the cached config read is replayed and a config edit is NOT picked up (#354). Launch with args: { ..., configFingerprint: "<output of `datum config-fingerprint`>" }.';

// skills/src/datum-go.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
function parseArgs(raw) {
  if (!raw || raw.toLowerCase() === "yolo") return { yolo: true };
  if (/^#?\d+$/.test(raw)) return { yolo: true, issueNumber: parseInt(raw.replace("#", ""), 10) };
  try {
    return JSON.parse(raw);
  } catch {
    const result = { yolo: true, freeText: raw };
    const startFromMatch = raw.match(/--start-from[=\s]+(\S+)/);
    const routeMatch = raw.match(/--route[=\s]+(\S+)/);
    if (startFromMatch) result.startFrom = startFromMatch[1];
    if (routeMatch) result.route = routeMatch[1];
    if (!startFromMatch && !routeMatch) {
      log(`WARNING: args "${raw}" is not valid JSON and was not recognized as yolo/#N \u2014 all flags in it (startFrom, route, phases) were IGNORED. Pass valid JSON to set these, or use --start-from <phase> / --route <route>.`);
    } else {
      log(`args "${raw}" is not valid JSON \u2014 recovered ${startFromMatch ? `startFrom=${startFromMatch[1]} ` : ""}${routeMatch ? `route=${routeMatch[1]}` : ""}from flags. Other fields (e.g. phases) are not supported this way \u2014 pass valid JSON to set them.`);
    }
    return result;
  }
}
var a = typeof args === "string" ? parseArgs(rawArgs) : args || {};
var yolo = !!a.yolo;
var startFrom = (a.startFrom || "refine").toLowerCase();
var explicitStart = !!a.startFrom;
var route = (a.route || "feature").toLowerCase();
var activePhases = a.phases && a.phases.length > 0 ? a.phases.map((p) => String(p).toLowerCase()).map((p) => {
  if (!PHASES.includes(p)) throw new Error(`invalid_phase: ${JSON.stringify(p)} is not a phase. Valid: ${PHASES.join(", ")}`);
  return p;
}) : [...PHASES];
var startIdx = PHASES.indexOf(startFrom);
if (startIdx === -1) {
  throw new Error(`Unknown phase: ${startFrom}. Valid: ${PHASES.join(", ")}`);
}
var configFingerprint = typeof a.configFingerprint === "string" ? a.configFingerprint : "";
if (!configFingerprint) log(NO_FINGERPRINT_WARNING);
setBatchCacheKey(configFingerprint);
setBatchRoot(typeof a.repoRoot === "string" ? a.repoRoot : "");
var bootBatch = await runBatch(bootSteps(), bootstrapOpts("cli", { label: "boot", model: model("fast") }));
if (bootBatch.missing) throw new Error(describeFailure(bootBatch, "boot"));
var boot = bootFromSteps(bootBatch);
setBatchRoot(boot.repoRoot);
var globalCfg = { ...DEFAULT_CONFIG, ...boot.config || {} };
configureAgentTypes(readAgentTypeConfig(globalCfg));
log(`Agent types: ${agentTypeArgs().agentTypes ? "on" : "off"}, hooks_installed: ${agentTypeArgs().hooksInstalled}`);
var phaseArgs = {
  yolo,
  agentTypes: agentTypeArgs(),
  configFingerprint,
  repoRoot: boot.repoRoot,
  freeText: typeof a.freeText === "string" ? a.freeText : "",
  issueNumber: typeof a.issueNumber === "number" ? a.issueNumber : null
};
var skillsDirHinted = false;
var sk = (name) => {
  const r = resolveSkillPath({
    name,
    skillsDir: globalCfg.skills_dir || "",
    localSkills: boot.localSkills || [],
    repoRoot: boot.repoRoot || ""
  });
  if (r.outsideRepo && !skillsDirHinted) {
    skillsDirHinted = true;
    log(skillsDirHint(globalCfg.skills_dir || ""));
  }
  return r.path;
};
if (globalCfg.models && typeof globalCfg.models === "object") {
  setModelTiers(globalCfg.models);
  log(`Model tiers: fast=${model("fast")}, balanced=${model("balanced")}, deep=${model("deep")}`);
}
var toolCheckText = await agent(
  runCommandPrompt(
    `SCRIPT="$(git rev-parse --show-toplevel)/scripts/preflight-tool-check.sh" && if [ -f "$SCRIPT" ]; then bash "$SCRIPT"; else echo '{"ok":true,"note":"invoking repo is not the datum repo itself (external orchestration target) \u2014 skipping self-hosted install check"}'; fi`
  ),
  stageOpts("cli", { label: "preflight-tool-check", model: model("fast") })
);
var toolCheck = parseAgentJsonStrict(toolCheckText, "preflight-tool-check");
if (!toolCheck.ok) {
  const installedPath = toolCheck.installed ?? "(unknown \u2014 preflight check did not return valid JSON, see raw output above)";
  const expectedPath = toolCheck.expected ?? "(unknown \u2014 preflight check did not return valid JSON, see raw output above)";
  throw new Error(
    `datum CLI tool install is stale/misdirected (#327): the globally installed editable \`datum\` points at "${installedPath}" but this repo root is "${expectedPath}". Every "datum ..." command this pipeline runs would silently execute code from the wrong location. Fix: run \`uv tool install --editable . --force\` from "${expectedPath}", then re-run.`
  );
}
var gitignoreText = await agent(
  runCommandPrompt(`datum gitignore-check${yolo ? " --fix" : ""}`),
  stageOpts("cli", { label: "preflight-gitignore", model: model("fast") })
);
var gitignoreCheck = parseAgentJsonStrict(gitignoreText, "preflight-gitignore");
if (gitignoreCheck.added?.length) {
  log(`[preflight] .gitignore was missing datum scratch paths \u2014 appended (yolo): ${gitignoreCheck.added.join(", ")}`);
}
if (!gitignoreCheck.ok) {
  throw new Error(
    `.gitignore does not ignore datum's scratch paths \u2014 missing: ${(gitignoreCheck.missing || []).join(", ")}. Generated files under those paths would land in \`git add .\` and collide with lane squash-merges. Fix: run \`datum gitignore-check --fix\` (or re-run with yolo, which appends them automatically), then re-run.`
  );
}
var priorState = parseState(boot.state ? JSON.stringify(boot.state) : null);
var currentBranch = typeof boot.currentBranch === "string" ? boot.currentBranch : "";
if (priorState && isStaleState(priorState, currentBranch)) {
  log(`Ignoring pipeline state for branch "${priorState.branch}" \u2014 currently checked out on "${currentBranch}". Treating as a fresh run instead of trusting stale completedPhases.`);
  priorState = null;
}
var lastResult = {};
var haltedAt = "";
var resolvedBranch = priorState?.branch || "";
var resolvedRunId = priorState?.runId || "";
var completedPhases = priorState?.completedPhases ? [...priorState.completedPhases] : [];
function shouldRun(p, idx) {
  return !haltedAt && startIdx <= idx && activePhases.includes(p);
}
async function markPhaseComplete(p, testsPass) {
  const saveSteps = pipelineStateSaveSteps({ phase: p, runId: resolvedRunId, route, testsPass });
  const saved = pipelineStateSaveFromSteps(await runBatch(saveSteps, stageOpts("cli", { label: `save-state:${p}`, model: model("fast") })), p);
  if (!saved.recorded) {
    log(`[warn] ${saved.reason} \u2014 phase "${p}" NOT recorded in .datum/pipeline-state.json`);
    return;
  }
  if (!completedPhases.includes(p)) completedPhases.push(p);
}
var newEpicBranch = "";
if (a.freeText && priorState && !explicitStart) {
  const newEpicText = await agent(
    `An existing epic is checked out on this branch. Prior pipeline state: ${JSON.stringify(priorState)}.
Read the current epic's TICKET.md (its branch is "${priorState.branch}"; the file lives at docs/epics/${priorState.branch}/TICKET.md) and compare its title/scope to this NEW brief the caller just typed:
"""
${a.freeText}
"""
Decide: does the brief describe the SAME piece of work as the existing TICKET.md, or a CLEARLY DIFFERENT one?
- If SAME, or you cannot confidently tell they differ: output {"newEpic": false}.
- If CLEARLY DIFFERENT: derive a short kebab-case slug from the brief and output {"newEpic": true, "slug": "<kebab-case-slug>", "reason": "<why they differ>"}.
Do NOT run datum init or any other command \u2014 the workflow bootstraps the new epic itself from your slug.
Output ONLY raw JSON, no markdown fences, no explanation.`,
    { label: "new-epic-check", model: model("balanced") }
  );
  const newEpicInfo = parseAgentJson(newEpicText, { newEpic: false });
  if (newEpicInfo.newEpic && typeof newEpicInfo.slug === "string" && newEpicInfo.slug.trim()) {
    const bootstrapSteps = newEpicBootstrapSteps(newEpicInfo.slug);
    const bootstrap = newEpicBootstrapFromSteps(await runBatch(bootstrapSteps, stageOpts("cli", { label: "new-epic-bootstrap", model: model("fast") })), newEpicInfo.slug);
    if (!bootstrap.ok) throw new Error(`new_epic_bootstrap_failed: ${bootstrap.error}`);
    log(`New epic detected \u2014 brief describes different work than the existing TICKET.md on "${priorState.branch}" (${newEpicInfo.reason || "no reason given"}). Bootstrapped new epic branch: ${bootstrap.epicBranch}`);
    newEpicBranch = bootstrap.epicBranch;
    resolvedBranch = bootstrap.epicBranch;
    resolvedRunId = "";
  }
}
if (priorState && !explicitStart && !newEpicBranch) {
  const resumeAt = detectStartFrom(priorState);
  if (resumeAt) {
    const resumeIdx = PHASES.indexOf(resumeAt);
    if (resumeIdx > startIdx) {
      log(`Resuming from ${resumeAt} (prior run completed: [${priorState.completedPhases.join(", ")}])`);
      startFrom = resumeAt;
      startIdx = resumeIdx;
    }
  }
}
log(`datum go \u2014 route: ${route}, start: ${startFrom}${yolo ? " (yolo)" : ""}`);
async function runPhaseWorkflow(scriptPath, args2, phaseName) {
  try {
    return await workflow({ scriptPath }, args2);
  } catch (exc) {
    const message = exc.message;
    log(`[warn] ${phaseName}_workflow_failed: ${message}`);
    return { gatePassed: false, gateMessage: message };
  }
}
if (shouldRun("refine", 0)) {
  log("\u2500\u2500 Refine \u2500\u2500");
  lastResult = await runPhaseWorkflow(sk("datum-refine"), phaseArgs, "refine");
  if (!lastResult.gatePassed) {
    haltedAt = "refine";
    log(`Refine gate ${lastResult.gateNeedsHuman ? "held" : "FAILED"}: ${lastResult.gateMessage || "needs review"}. Address QUESTIONS.md, then: datum go --start-from plan`);
  } else {
    log("Refine complete");
    await markPhaseComplete("refine");
  }
}
if (shouldRun("plan", 1)) {
  log("\u2500\u2500 Plan \u2500\u2500");
  lastResult = await runPhaseWorkflow(sk("datum-plan"), phaseArgs, "plan");
  if (!lastResult.gatePassed) {
    haltedAt = "plan";
    log(`Plan gate ${lastResult.gateNeedsHuman ? "held" : "FAILED"}: ${lastResult.gateMessage || "needs approval"}. Review TASKS.md, then: datum go --start-from properties`);
  } else {
    log(`Plan complete \u2014 ${lastResult.taskCount || "?"} tasks`);
    await markPhaseComplete("plan");
  }
}
if (shouldRun("properties", 2)) {
  log("\u2500\u2500 Properties \u2500\u2500");
  lastResult = await runPhaseWorkflow(sk("datum-properties"), phaseArgs, "properties");
  if (!lastResult.gatePassed) {
    haltedAt = "properties";
    log(`Properties gate ${lastResult.gateNeedsHuman ? "held" : "FAILED"}: ${lastResult.gateMessage || "needs review"}. Review PROPERTIES.md, then: datum go --start-from act`);
  } else {
    log("Properties complete");
    await markPhaseComplete("properties");
  }
}
log(`[debug] shouldRun act=${shouldRun("act", 3)} startIdx=${startIdx} haltedAt=${haltedAt} activePhases=${JSON.stringify(activePhases)}`);
if (shouldRun("act", 3)) {
  log("\u2500\u2500 Act \u2500\u2500");
  let inFlightBatch = null;
  try {
    const testCommand = globalCfg.test_command || DEFAULT_CONFIG.test_command;
    const language = globalCfg.language || DEFAULT_CONFIG.language;
    const testFramework = globalCfg.test_framework;
    const actStart = actStartSteps({
      branch: "init",
      initCmd: "datum init --json",
      lanePlanPath: null,
      laneStateReadScript: laneStateReadScript({
        epicBranch: "$__eb",
        epicSlug: "",
        taskIdsSpace: `$(jq -r '.topological_order[]' "$__plan")`
      })
    });
    const actStartRaw = await agent(
      batchCommandPrompt(actStart),
      stageOpts("cli", { label: "act-start", phase: "Act", model: model("fast") })
    );
    const actStartResult = parseBatchResult(actStartRaw, actStart);
    const info = parseAgentJson(stepStdout(actStartResult, "bootstrap") || "", { epicBranch: "" });
    const epicBranch = info.epicBranch;
    const runId = (stepStdout(actStartResult, "timestamp") || "").trim();
    resolvedBranch = epicBranch;
    resolvedRunId = runId;
    if (!epicBranch || !runId) throw new Error(`Failed to resolve branch/timestamp via datum init --json: ${JSON.stringify(info)} (${describeFailure(actStartResult, "act-start")})`);
    const skeletonDir = `docs/epics/${epicBranch}/skeletons`;
    const epicDir = `docs/epics/${epicBranch}`;
    const lanePlanPath = resolveLanePlanPath(epicDir, stepStdout(actStartResult, "resolve") || "");
    const digestResult = lanePlanDigestFromSteps(actStartResult, lanePlanPath);
    if (!digestResult.ok || !digestResult.digest) throw new Error(digestResult.error);
    const lanePlan = digestResult.digest;
    const waves = buildWaves(lanePlan);
    if (waves.length === 0 || Object.keys(lanePlan.lanes || {}).length === 0) {
      throw new Error("Lane plan has 0 tasks \u2014 nothing to execute");
    }
    log(`Topology: ${lanePlan.total_lanes} lanes in ${waves.length} waves`);
    const slug = epicSlug(epicBranch);
    const priorMarkers = parseAgentJson(stepStdout(actStartResult, "lane-state-read") || "", {});
    const alreadyMerged = lanePlan.topological_order.filter((id) => {
      const m = priorMarkers[id];
      return !!m && m.status === "completed" && m.ancestor === true && m.spec_hash === digestSpecHash(lanePlan, id);
    });
    const actResults = {};
    const actFailures = [];
    const actCompleted = [];
    for (const id of alreadyMerged) {
      actResults[id] = { task_id: id, status: "completed" };
      actCompleted.push(id);
    }
    if (alreadyMerged.length > 0) {
      log(`Epic-scoped state: ${alreadyMerged.length} lane(s) already merged, skipping: [${alreadyMerged.join(", ")}]`);
    }
    const MAX_BATCH = 5;
    const allLaneIds = lanePlan.topological_order.filter((id) => !alreadyMerged.includes(id));
    const remainingWaves = waves.map((wave) => wave.filter((id) => allLaneIds.includes(id))).filter((wave) => wave.length > 0);
    const batches = packWaves(remainingWaves, MAX_BATCH, lanePlan);
    log(`Wave-packed ${allLaneIds.length} tasks into ${batches.length} batches`);
    if (batches.length > 1) {
      log(`Auto-partitioned ${allLaneIds.length} tasks into ${batches.length} batches`);
    }
    for (let bi = 0; bi < batches.length; bi++) {
      const batchLaneIds = batches[bi];
      const batchTag = batches.length > 1 ? ` [batch ${bi + 1}/${batches.length}]` : "";
      const batchRunId = batches.length > 1 ? `${runId}-b${bi}` : runId;
      inFlightBatch = { batchRunId, batchTag, epicBranch };
      if (batches.length > 1) log(`
=== Batch ${bi + 1}/${batches.length}: [${batchLaneIds.join(", ")}] ===`);
      for (const lid of batchLaneIds) {
        const deps = lanePlan.lanes[lid]?.depends_on || [];
        const unmet = deps.filter((d) => !batchLaneIds.includes(d) && !actCompleted.includes(d));
        if (unmet.length === 0) continue;
        const failedDeps = unmet.filter((d) => actFailures.includes(d) || actResults[d]?.status === "blocked");
        const neverRan = unmet.filter((d) => !failedDeps.includes(d));
        const rootCauses = failedDeps.map((d) => `${d}@${actResults[d]?.stage || "?"}`);
        const detail = [
          rootCauses.length > 0 ? `dep(s) failed/blocked: [${rootCauses.join(", ")}]` : "",
          neverRan.length > 0 ? `dep(s) never ran: [${neverRan.join(", ")}]` : ""
        ].filter(Boolean).join("; ");
        actResults[lid] = { task_id: lid, status: "blocked", stage: "SKIPPED", error: `blocked \u2014 ${detail}` };
        log(`  BLOCKED ${lid}: ${detail}`);
      }
      const runnableBatchIds = batchLaneIds.filter((id) => !actResults[id]);
      if (runnableBatchIds.length === 0) {
        log(`Batch ${bi} fully skipped \u2014 all lanes have unmet deps`);
        continue;
      }
      const setup = await workflow(
        { scriptPath: sk("datum-tdd-act-setup") },
        { batchRunId, epicBranch, batchLaneIds: runnableBatchIds, lanePlan, lanePlanPath, batchTag, agentTypes: agentTypeArgs(), configFingerprint, repoRoot: boot.repoRoot }
      );
      const act = await workflow(
        { scriptPath: sk("datum-tdd-act-lane") },
        {
          batchLaneIds: runnableBatchIds,
          lanePlan,
          worktreePaths: setup.worktreePaths,
          batchTag,
          // yolo (#356): lets a blocked GREEN auto-widen allowed_write_files
          // in the lane runner, same as datum-tdd-act passes it.
          cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language, test_framework: testFramework, skeletonDir, yolo, agentTypes: agentTypeArgs(), configFingerprint, repoRoot: boot.repoRoot },
          priorFailures: actFailures,
          priorCompleted: actCompleted
        }
      );
      for (const [id, r] of Object.entries(act.results || {})) {
        actResults[id] = r;
        if (!r || r.status === "failed") {
          actFailures.push(id);
          log(`  FAILED ${id}: ${r ? `${r.stage} \u2014 ${r.error}` : "null result"}`);
        } else if (r.status === "skipped" || r.status === "blocked") {
          log(`  ${r.status.toUpperCase()} ${id}: ${r.error || "dependency failed"}`);
        } else {
          actCompleted.push(id);
        }
      }
      log(`Act${batchTag} done: ${batchLaneIds.filter((id) => actCompleted.includes(id)).length}/${batchLaneIds.length} succeeded`);
      const mergedIds = batchLaneIds.filter((id) => actCompleted.includes(id));
      const mergeResult = await workflow(
        { scriptPath: sk("datum-tdd-act-merge") },
        {
          epicBranch,
          completedIds: mergedIds,
          results: actResults,
          batchRunId,
          topoOrder: lanePlan.topological_order,
          batchTag,
          agentTypes: agentTypeArgs(),
          configFingerprint,
          repoRoot: boot.repoRoot,
          laneState: mergedIds.length > 0 ? { epicSlug: slug, entries: mergedIds.map((id) => ({ task_id: id, spec_hash: digestSpecHash(lanePlan, id) })) } : null
        }
      );
      inFlightBatch = null;
      if (mergedIds.length > 0 && (!mergeResult || mergeResult.failed || !mergeResult.merged)) {
        const failedLane = mergeResult && typeof mergeResult.failedLane === "string" ? mergeResult.failedLane : "";
        const why = mergeResult ? failedLane ? `squash-merge of ${failedLane} did not land` : "squash-merge step exited non-zero" : "merge workflow returned null";
        const landed = new Set(mergeResult && Array.isArray(mergeResult.mergedIds) ? mergeResult.mergedIds : []);
        const unmerged = mergedIds.filter((id) => !landed.has(id));
        const conflictFiles = mergeResult && Array.isArray(mergeResult.conflictFiles) ? mergeResult.conflictFiles : [];
        const reason = mergeResult && typeof mergeResult.error === "string" ? mergeResult.error.slice(0, 300) : "";
        const detail = `${conflictFiles.length > 0 ? ` \u2014 conflicted files: [${conflictFiles.join(", ")}]` : ""}${reason ? ` \u2014 ${reason}` : ""}${mergeResult && mergeResult.report ? ` (report: ${mergeResult.report})` : ""}`;
        for (const id of unmerged) {
          const i = actCompleted.indexOf(id);
          if (i >= 0) actCompleted.splice(i, 1);
          actFailures.push(id);
          actResults[id] = { task_id: id, status: "failed", stage: "MERGE", error: `merge_failed: ${why}${detail}${batchTag}` };
        }
        log(`Merge${batchTag} FAILED \u2014 demoted [${unmerged.join(", ")}] from completed to failed (${why})${landed.size > 0 ? `; landed: [${[...landed].join(", ")}]` : ""}`);
      }
    }
    let docsResult = null;
    try {
      docsResult = await workflow(
        { scriptPath: sk("datum-tdd-act-docs") },
        { completedLanes: actCompleted, lanePlan, runId, agentTypes: agentTypeArgs(), configFingerprint, repoRoot: boot.repoRoot }
      );
    } catch (exc) {
      log(`[warn] docs_workflow_failed: ${exc.message} \u2014 continuing; docs may be stale or left uncommitted`);
      docsResult = { synced: false, committed: false, failure_reason: `docs_workflow_failed: ${exc.message}` };
    }
    if (docsResult && docsResult.committed === false) {
      log(`[warn] Docs sync wrote [${(docsResult.files || []).join(", ")}] but the commit was refused: ${docsResult.failure_reason || "unknown"} \u2014 the files are left modified in the checkout`);
    } else if (docsResult && docsResult.failure_reason) {
      log(`[warn] Docs sync did not complete: ${docsResult.failure_reason}`);
    }
    const actSkipped = Object.keys(actResults).filter((id) => actResults[id]?.status === "skipped");
    const actBlocked = Object.keys(actResults).filter((id) => actResults[id]?.status === "blocked");
    const actNeedsWrite = actBlocked.filter((id) => Array.isArray(actResults[id]?.needs_write));
    if (actNeedsWrite.length > 0) {
      log("\nLEAD APPROVAL NEEDED \u2014 GREEN is blocked on files outside allowed_write_files:");
      for (const id of actNeedsWrite) {
        const r = actResults[id];
        log(`  ${id}: needs_write=[${(r?.needs_write || []).join(", ")}]`);
        log(`    ${r?.error || ""}`);
      }
      log("  To approve: add the listed paths to that lane's `files` in lane-plan.json, then re-run act (datum go --start-from act). In yolo mode, paths inside src/ are widened automatically and GREEN re-runs once.");
    }
    if (actFailures.length > 0 || actNeedsWrite.length > 0) {
      try {
        const triage = await workflow(
          { scriptPath: sk("datum-tdd-act-triage") },
          { failures: [...actFailures, ...actNeedsWrite], blocked: actBlocked.filter((id) => !actNeedsWrite.includes(id)).map((id) => actResults[id]), results: actResults, lanePlan, runId, epicBranch, agentTypes: agentTypeArgs() }
        );
        log(`Triage: ${triage?.filed ?? 0} filed, ${triage?.consumer_findings ?? 0} consumer finding(s), ${triage?.skipped ?? 0} skipped`);
      } catch (exc) {
        log(`[warn] triage_workflow_failed: ${exc.message} \u2014 lane failures are still recorded above`);
      }
    }
    log(`Act ${actFailures.length > 0 || actBlocked.length > 0 ? "finished with failures" : "complete"} \u2014 ${actCompleted.length}/${lanePlan.total_lanes} succeeded, ${actFailures.length} failed, ${actSkipped.length} skipped, ${actBlocked.length} blocked`);
    const actDepBlocked = actBlocked.filter((id) => !actNeedsWrite.includes(id));
    const needsApproval = {};
    for (const id of actNeedsWrite) needsApproval[id] = actResults[id]?.error || "green_blocked_needs_write";
    lastResult = { completed: actCompleted.length, failed: actFailures.length, skipped: actSkipped.length, blocked: actDepBlocked.length, approval: actNeedsWrite.length, failedLanes: actFailures, skippedLanes: actSkipped, blockedLanes: actDepBlocked, approvalLanes: actNeedsWrite, needsApproval };
    if (actCompleted.length === 0 && lanePlan.total_lanes > 0 || actFailures.length > 0 || actBlocked.length > 0) {
      haltedAt = "act";
      log(`Act halted: ${actFailures.length} failed, ${actBlocked.length} blocked, ${actCompleted.length}/${lanePlan.total_lanes} merged \u2014 not continuing to validate/review/closeout. Fix the failed lanes, then re-run datum go (Act resumes from the lanes that have not merged).`);
    } else {
      await markPhaseComplete("act");
    }
  } catch (exc) {
    const message = exc.message;
    log(`[warn] act_phase_failed: ${message}`);
    haltedAt = "act";
    lastResult = { failed: 1, failedLanes: [], error: message };
    if (inFlightBatch) {
      const { batchRunId, batchTag, epicBranch } = inFlightBatch;
      try {
        const cleanup = await runBatch(cleanupSteps(batchRunId, epicBranch), stageOpts("cli", { label: `cleanup-after-crash${batchTag}`, phase: "Act", model: model("fast") }));
        log(`  cleanup${batchTag}: ${stepStdout(cleanup, "cleanup") || describeFailure(cleanup, "cleanup")}`);
      } catch (cleanupExc) {
        log(`[warn] cleanup_after_crash_failed${batchTag}: ${cleanupExc.message}`);
      }
    }
  }
} else if (activePhases.includes("act")) {
  log(`[warn] Act phase was in activePhases but shouldRun returned false \u2014 startIdx=${startIdx} haltedAt=${haltedAt}`);
}
if (shouldRun("validate", 4)) {
  log("\u2500\u2500 Validate \u2500\u2500");
  lastResult = await runPhaseWorkflow(sk("datum-validate"), phaseArgs, "validate");
  if (!lastResult.testsPassed || !lastResult.gatePassed) {
    haltedAt = "validate";
    log(`Validate ${!lastResult.testsPassed ? "FAILED \u2014 tests are red" : `gate ${lastResult.gateNeedsHuman ? "held" : "FAILED"}: ${lastResult.gateMessage || "needs review"}`}. Pipeline halted.`);
  } else {
    log("Validate complete");
    await markPhaseComplete("validate", !!lastResult.testsPassed);
  }
}
if (shouldRun("review", 5)) {
  log("\u2500\u2500 Review \u2500\u2500");
  lastResult = await runPhaseWorkflow(sk("datum-review"), phaseArgs, "review");
  if (!lastResult.gatePassed) {
    haltedAt = "review";
    log(`Review gate ${lastResult.gateNeedsHuman ? "held" : "FAILED"}: ${lastResult.gateMessage || "needs review"}. Fix, then: datum go --start-from validate`);
  } else if (!yolo && !lastResult.canMerge) {
    haltedAt = "review";
    log(`Review: ${lastResult.criticalFindings || "?"} critical issues. Fix, then: datum go --start-from validate`);
  } else {
    log("Review complete \u2014 clear to merge");
    await markPhaseComplete("review");
  }
}
if (shouldRun("closeout", 6)) {
  log("\u2500\u2500 Closeout \u2500\u2500");
  try {
    lastResult = await workflow({ scriptPath: sk("datum-closeout") }, { ...phaseArgs, runId: resolvedRunId });
    log("Closeout complete");
    await markPhaseComplete("closeout");
  } catch (exc) {
    const message = exc.message;
    haltedAt = "closeout";
    log(`[warn] closeout_workflow_failed: ${message}. Fix, then: datum go --start-from closeout`);
  }
}
if (haltedAt) {
  log(`
Pipeline halted at ${haltedAt}. Resume with: datum go --start-from <next-phase>`);
} else {
  log("\n" + "=".repeat(60));
  log("DATUM GO COMPLETE");
  log("=".repeat(60));
}
return {
  phase: haltedAt || "complete",
  halted: !!haltedAt,
  ...lastResult
};
