// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act.ts
export const meta = {
  name: "datum-tdd-act",
  description: "Deterministic TDD Act: RED->GREEN->REFACTOR per lane with gate enforcement",
  phases: []
};

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
function skillPath(skillsDir, name) {
  if (skillsDir) return `${skillsDir}/${name}.js`;
  return `skills/${name}.js`;
}

// skills/src/shared/utils.ts
function buildWaves(lanePlan2) {
  const lanes = lanePlan2.lanes;
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
  const waves2 = [];
  let queue = ids.filter((id) => inDeg[id] === 0).sort();
  while (queue.length > 0) {
    waves2.push([...queue]);
    const next = [];
    for (const id of queue) {
      for (const child of adj[id] || []) {
        inDeg[child]--;
        if (inDeg[child] === 0) next.push(child);
      }
    }
    queue = next.sort();
  }
  const placed = new Set(waves2.flat());
  const cyclic = ids.filter((id) => !placed.has(id));
  if (cyclic.length > 0) {
    throw new Error(
      `Cyclic dependency detected among tasks: ${cyclic.sort().join(", ")}`
    );
  }
  return waves2;
}
function packWaves(waves2, maxBatch, lanePlan2) {
  if (lanePlan2) {
    return packWavesSafe(waves2, maxBatch, lanePlan2);
  }
  if (waves2.length <= 2) {
    return packWavesMerging(waves2, maxBatch);
  }
  return packWavesStrict(waves2, maxBatch);
}
function packWavesSafe(waves2, maxBatch, lanePlan2) {
  const batches2 = [];
  let current = [];
  for (const wave of waves2) {
    for (const id of wave) {
      const deps = lanePlan2.lanes?.[id]?.depends_on || [];
      const blockedByCurrent = deps.some((d) => current.includes(d));
      if (current.length > 0 && (current.length >= maxBatch || blockedByCurrent)) {
        batches2.push(current);
        current = [];
      }
      current.push(id);
    }
  }
  if (current.length > 0) {
    batches2.push(current);
  }
  return batches2;
}
function packWavesMerging(waves2, maxBatch) {
  const batches2 = [];
  let current = [];
  for (const wave of waves2) {
    let idx = 0;
    while (idx < wave.length) {
      const remaining = maxBatch - current.length;
      if (remaining <= 0) {
        batches2.push(current);
        current = [];
        continue;
      }
      const take = Math.min(remaining, wave.length - idx);
      current.push(...wave.slice(idx, idx + take));
      idx += take;
    }
  }
  if (current.length > 0) {
    batches2.push(current);
  }
  return batches2;
}
function packWavesStrict(waves2, maxBatch) {
  const batches2 = [];
  for (const wave of waves2) {
    let idx = 0;
    while (idx < wave.length) {
      const take = Math.min(maxBatch, wave.length - idx);
      batches2.push(wave.slice(idx, idx + take));
      idx += take;
    }
  }
  return batches2;
}
function epicSlug(branch) {
  return branch.replace(/[^A-Za-z0-9._-]/g, "-");
}
function resolveLanePlanPath(epicDir2, agentResult) {
  const resolved = agentResult.trim();
  if (resolved === "final") return `${epicDir2}/lane-plan-final.json`;
  if (resolved === "default") return `${epicDir2}/lane-plan.json`;
  throw new Error(`No lane-plan.json found \u2014 tried: ${epicDir2}/lane-plan-final.json, ${epicDir2}/lane-plan.json`);
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
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
}

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- Test command comes from `.datum/config.json` `test_command` field \u2014 read it, don't guess\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500-line file cap \u2014 split via functional seams\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (from `.datum/config.json`)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Full Context\n- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and patterns\n";

// skills/src/prompts/lane-state-read.md
var lane_state_read_default = 'Report which lanes of epic {{epicBranch}} already have epic-scoped completion markers.\n\nRun this exact script from the repo root and return ONLY its stdout \u2014 raw JSON, no markdown fences, no commentary. It calls `datum lane-state read` (the deterministic CLI, not hand-written file parsing) once per task id:\n\n```\nOUT=\'{}\'\nfor TID in {{taskIdsSpace}}; do\n  R=$(datum lane-state read --epic "{{epicBranch}}" --task "$TID")\n  STATUS=$(echo "$R" | jq -r \'.status // "not_found"\')\n  if [ "$STATUS" = "not_found" ]; then continue; fi\n  MC=$(echo "$R" | jq -r \'.merge_commit // ""\')\n  SHASH=$(echo "$R" | jq -r \'.spec_hash // ""\')\n  ANC=false\n  if [ -n "$MC" ] && git merge-base --is-ancestor "$MC" "{{epicBranch}}" 2>/dev/null; then\n    ANC=true\n  fi\n  OUT=$(echo "$OUT" | jq --arg tid "$TID" --arg status "$STATUS" --arg spec_hash "$SHASH" --argjson ancestor "$ANC" \\\n    \'. + {($tid): {status: $status, spec_hash: $spec_hash, ancestor: $ancestor}}\')\ndone\necho "$OUT"\n```\n\nIf no markers exist for any task id, the script prints `{}` \u2014 that is the correct output. Do not create any files or directories.\n';

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
  const results2 = arr.map(asStepResult).filter((r) => r !== null);
  const tolerant = new Set(steps.filter((s) => s.tolerant).map((s) => s.name));
  const failed = results2.find((r) => r.exit_code !== 0 && !tolerant.has(r.name)) ?? null;
  return { steps: results2, failed, missing: false };
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

// skills/src/shared/lane-steps.ts
var q = (s) => `"${s.replace(/"/g, '\\"')}"`;
function fencedScript(rendered) {
  const m = rendered.match(/```[a-z]*\n([\s\S]*?)\n```/);
  if (!m) throw new Error("template has no fenced script block");
  return m[1];
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

// skills/src/shared/context-relay.ts
var CONTEXT_RELAY_BUDGET_BYTES = 16 * 1024;

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function laneStateReadPrompt(vars) {
  return renderPrompt(lane_state_read_default, vars);
}
function laneStateReadScript(vars) {
  return fencedScript(laneStateReadPrompt(vars));
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
function agentTypeArgs() {
  return { ...state };
}

// skills/src/datum-tdd-act.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
setBatchCacheKey(a.configFingerprint || "");
var repoCfg = {};
if (!a.testCommand || !a.language) {
  const configReadStepList = configReadSteps();
  const configBatchRaw = await agent(batchCommandPrompt(configReadStepList), bootstrapOpts("cli", { label: "read-config", model: model("fast") }));
  repoCfg = { ...DEFAULT_CONFIG, ...configFromSteps(parseBatchResult(configBatchRaw, configReadStepList)) };
}
if (repoCfg.models && typeof repoCfg.models === "object") setModelTiers(repoCfg.models);
configureAgentTypes(readAgentTypeConfig(repoCfg));
var sk = (name) => skillPath(repoCfg.skills_dir || "", name);
var testCommand = a.testCommand || repoCfg.test_command || DEFAULT_CONFIG.test_command;
var language = a.language || repoCfg.language || DEFAULT_CONFIG.language;
var test_framework = a.test_framework || repoCfg.test_framework;
var epicBranch = a.epicBranch || "";
var runId = a.runId || "";
var actStart = actStartSteps({
  branch: epicBranch ? epicBranch : a.yolo ? "detect" : "",
  lanePlanPath: a.lanePlanPath || null,
  laneStateReadScript: laneStateReadScript({
    epicBranch: "$__eb",
    epicSlug: "",
    taskIdsSpace: `$(jq -r '.topological_order[]' "$__plan")`
  })
});
if (!epicBranch && !a.yolo) throw new Error('args.epicBranch is required. Pass {epicBranch, runId} or "yolo" to auto-detect.');
var actStartRaw = await agent(
  batchCommandPrompt(actStart),
  stageOpts("cli", { label: "act-start", phase: "Topology", model: model("fast") })
);
var actStartResult = parseBatchResult(actStartRaw, actStart);
epicBranch = epicBranch || (stepStdout(actStartResult, "branch") || "").trim();
runId = runId || (stepStdout(actStartResult, "timestamp") || "").trim();
if (!epicBranch) throw new Error(`args.epicBranch is required and auto-detect failed (${describeFailure(actStartResult, "act-start")}). Pass {epicBranch, runId} or "yolo" to auto-detect.`);
if (!runId) throw new Error(`args.runId is required and auto-detect failed (${describeFailure(actStartResult, "act-start")}). Pass {epicBranch, runId} or "yolo" to auto-detect.`);
var epicDir = `docs/epics/${epicBranch}`;
var lanePlanPath = a.lanePlanPath || resolveLanePlanPath(epicDir, stepStdout(actStartResult, "resolve") || "");
var skeletonDir = `docs/epics/${epicBranch}/skeletons`;
phase("Topology");
var digestResult = lanePlanDigestFromSteps(actStartResult, lanePlanPath);
if (!digestResult.ok || !digestResult.digest) throw new Error(digestResult.error);
var lanePlan = digestResult.digest;
var waves = buildWaves(lanePlan);
if (waves.length === 0 || Object.keys(lanePlan.lanes || {}).length === 0) {
  throw new Error("Lane plan has 0 tasks \u2014 nothing to execute");
}
log(`Topology: ${lanePlan.total_lanes} lanes in ${waves.length} waves`);
for (let i = 0; i < waves.length; i++) {
  log(`  Wave ${i}: [${waves[i].join(", ")}]`);
}
var slug = epicSlug(epicBranch);
var priorMarkers = parseAgentJson(stepStdout(actStartResult, "lane-state-read") || "", {});
var alreadyMerged = lanePlan.topological_order.filter((id) => {
  const m = priorMarkers[id];
  return !!m && m.status === "completed" && m.ancestor === true && m.spec_hash === digestSpecHash(lanePlan, id);
});
var results = {};
var failures = [];
var completedLanes = [];
for (const id of alreadyMerged) {
  results[id] = { task_id: id, status: "completed" };
  completedLanes.push(id);
}
if (alreadyMerged.length > 0) {
  log(`Epic-scoped state: ${alreadyMerged.length} lane(s) already merged, skipping: [${alreadyMerged.join(", ")}]`);
}
var MAX_BATCH = 5;
var allLaneIds = lanePlan.topological_order.filter((id) => !alreadyMerged.includes(id));
var remainingWaves = waves.map((wave) => wave.filter((id) => allLaneIds.includes(id))).filter((wave) => wave.length > 0);
var batches = packWaves(remainingWaves, MAX_BATCH, lanePlan);
log(`Wave-packed ${allLaneIds.length} tasks into ${batches.length} batches`);
if (batches.length > 1) {
  log(`Auto-partitioned ${allLaneIds.length} tasks into ${batches.length} batches (max ${MAX_BATCH}/batch)`);
  for (let b = 0; b < batches.length; b++) {
    log(`  Batch ${b}: [${batches[b].join(", ")}]`);
  }
}
for (let bi = 0; bi < batches.length; bi++) {
  const batchLaneIds = batches[bi];
  const batchTag = batches.length > 1 ? ` [batch ${bi + 1}/${batches.length}]` : "";
  const batchRunId = batches.length > 1 ? `${runId}-b${bi}` : runId;
  if (batches.length > 1) log(`
${"=".repeat(60)}
=== Batch ${bi + 1}/${batches.length}: [${batchLaneIds.join(", ")}] ===
${"=".repeat(60)}`);
  for (const lid of batchLaneIds) {
    const deps = lanePlan.lanes[lid]?.depends_on || [];
    const unmet = deps.filter((d) => !batchLaneIds.includes(d) && !completedLanes.includes(d));
    if (unmet.length === 0) continue;
    const failedDeps = unmet.filter((d) => failures.includes(d) || results[d]?.status === "blocked");
    const neverRan = unmet.filter((d) => !failedDeps.includes(d));
    const rootCauses = failedDeps.map((d) => `${d}@${results[d]?.stage || "?"}`);
    const detail = [
      rootCauses.length > 0 ? `dep(s) failed/blocked: [${rootCauses.join(", ")}]` : "",
      neverRan.length > 0 ? `dep(s) never ran: [${neverRan.join(", ")}]` : ""
    ].filter(Boolean).join("; ");
    results[lid] = { task_id: lid, status: "blocked", stage: "SKIPPED", error: `blocked \u2014 ${detail}` };
    log(`  BLOCKED ${lid}: ${detail}`);
  }
  const runnableBatchIds = batchLaneIds.filter((id) => !results[id]);
  if (runnableBatchIds.length === 0) {
    log(`Batch ${bi} fully skipped \u2014 all lanes have unmet deps`);
    continue;
  }
  try {
    log("\u2500\u2500 Setup \u2500\u2500");
    const setup = await workflow(
      { scriptPath: sk("datum-tdd-act-setup") },
      { batchRunId, epicBranch, batchLaneIds: runnableBatchIds, lanePlan, lanePlanPath, batchTag, agentTypes: agentTypeArgs(), configFingerprint: a.configFingerprint || "" }
    );
    log("\u2500\u2500 Act \u2500\u2500");
    const act = await workflow(
      { scriptPath: sk("datum-tdd-act-lane") },
      {
        batchLaneIds: runnableBatchIds,
        lanePlan,
        worktreePaths: setup.worktreePaths,
        batchTag,
        cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language, test_framework, skeletonDir, yolo: !!a.yolo, agentTypes: agentTypeArgs(), configFingerprint: a.configFingerprint || "" },
        priorFailures: failures,
        priorCompleted: completedLanes
      }
    );
    for (const [id, r] of Object.entries(act.results || {})) {
      results[id] = r;
      if (!r || r.status === "failed") {
        failures.push(id);
        log(`  FAILED ${id}: ${r ? `${r.stage} \u2014 ${r.error}` : "null result"}`);
      } else if (r.status === "skipped" || r.status === "blocked") {
        log(`  ${r.status.toUpperCase()} ${id}: ${r.error || "dependency failed"}`);
      } else {
        completedLanes.push(id);
      }
    }
    log(`Act${batchTag} done: ${batchLaneIds.filter((id) => completedLanes.includes(id)).length}/${batchLaneIds.length} succeeded`);
    const approvals = Object.values(act.results || {}).filter(
      (r) => !!r && r.status === "blocked" && r.stage === "GREEN" && Array.isArray(r.needs_write)
    );
    if (approvals.length > 0) {
      log(`
LEAD APPROVAL NEEDED${batchTag} \u2014 GREEN is blocked on files outside allowed_write_files:`);
      for (const r of approvals) {
        log(`  ${r.task_id}: needs_write=[${(r.needs_write || []).join(", ")}]`);
        log(`    ${r.error}`);
      }
      log("  To approve: add the listed paths to that lane's `files` in lane-plan.json, then re-run act (datum go --start-from act). In yolo mode, paths inside src/ are widened automatically and GREEN re-runs once.");
    }
    log("\u2500\u2500 Merge \u2500\u2500");
    const mergedIds = batchLaneIds.filter((id) => completedLanes.includes(id));
    const mergeResult = await workflow(
      { scriptPath: sk("datum-tdd-act-merge") },
      {
        epicBranch,
        completedIds: mergedIds,
        results,
        batchRunId,
        topoOrder: lanePlan.topological_order,
        batchTag,
        agentTypes: agentTypeArgs(),
        configFingerprint: a.configFingerprint || "",
        laneState: mergedIds.length > 0 ? { epicSlug: slug, entries: mergedIds.map((id) => ({ task_id: id, spec_hash: digestSpecHash(lanePlan, id) })) } : null
      }
    );
    if (mergedIds.length > 0 && (!mergeResult || mergeResult.failed || !mergeResult.merged)) {
      const failedLane = mergeResult && typeof mergeResult.failedLane === "string" ? mergeResult.failedLane : "";
      const why = mergeResult ? failedLane ? `squash-merge of ${failedLane} did not land` : "squash-merge step exited non-zero" : "merge workflow returned null";
      const landed = new Set(mergeResult && Array.isArray(mergeResult.mergedIds) ? mergeResult.mergedIds : []);
      const unmerged = mergedIds.filter((id) => !landed.has(id));
      for (const id of unmerged) {
        const i = completedLanes.indexOf(id);
        if (i >= 0) completedLanes.splice(i, 1);
        failures.push(id);
        results[id] = { task_id: id, status: "failed", stage: "MERGE", error: `merge_failed: ${why}${batchTag}` };
      }
      log(`Merge${batchTag} FAILED \u2014 demoted [${unmerged.join(", ")}] from completed to failed (${why})${landed.size > 0 ? `; landed: [${[...landed].join(", ")}]` : ""}`);
    }
  } catch (exc) {
    const message = exc.message;
    log(`act_batch_failed: batch ${bi + 1}/${batches.length} \u2014 ${message}`);
    for (const id of runnableBatchIds) {
      if (results[id] && results[id].status === "completed") continue;
      results[id] = { task_id: id, status: "failed", stage: "CRASH", error: `act_batch_failed: ${message}` };
      if (!failures.includes(id)) failures.push(id);
    }
  }
}
log("\u2500\u2500 Docs \u2500\u2500");
var docsResult = null;
try {
  docsResult = await workflow(
    { scriptPath: sk("datum-tdd-act-docs") },
    { completedLanes, lanePlan, runId, agentTypes: agentTypeArgs(), configFingerprint: a.configFingerprint || "" }
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
var skippedLanes = Object.keys(results).filter((id) => results[id]?.status === "skipped");
var blockedLanes = Object.keys(results).filter((id) => results[id]?.status === "blocked");
log(`
${"\u2550".repeat(60)}`);
log(`ACT COMPLETE: ${completedLanes.length}/${lanePlan.total_lanes} succeeded, ${failures.length} failed, ${skippedLanes.length} skipped, ${blockedLanes.length} blocked`);
if (completedLanes.length > 0) log(`  completed: [${completedLanes.join(", ")}]`);
if (failures.length > 0) {
  log(`  failed:    [${failures.join(", ")}]`);
  for (const fid of failures) {
    const r = results[fid];
    if (r) log(`    ${fid}: ${r.stage} \u2014 ${r.error}`);
  }
}
if (skippedLanes.length > 0) log(`  skipped:   [${skippedLanes.join(", ")}]`);
var followUpLanes = Object.keys(results).filter((id) => (results[id]?.follow_ups || 0) > 0);
if (followUpLanes.length > 0) {
  log(`  skeptic minority findings (filed at Closeout): [${followUpLanes.map((id) => `${id}:${results[id].follow_ups}`).join(", ")}]`);
}
if (blockedLanes.length > 0) {
  log(`  blocked:   [${blockedLanes.join(", ")}]`);
  for (const bid of blockedLanes) {
    const r = results[bid];
    if (r) log(`    ${bid}: ${r.error}`);
  }
}
log(`${"\u2550".repeat(60)}`);
var laneNeedsWrite = blockedLanes.filter((id) => Array.isArray(results[id]?.needs_write));
if (failures.length > 0 || laneNeedsWrite.length > 0) {
  log("\u2500\u2500 Triage \u2500\u2500");
  try {
    const triage = await workflow(
      { scriptPath: sk("datum-tdd-act-triage") },
      { failures: [...failures, ...laneNeedsWrite], blocked: blockedLanes.filter((id) => !laneNeedsWrite.includes(id)).map((id) => results[id]), results, lanePlan, runId, epicBranch, agentTypes: agentTypeArgs() }
    );
    log(`Triage: ${triage?.filed ?? 0} filed, ${triage?.consumer_findings ?? 0} consumer finding(s), ${triage?.skipped ?? 0} skipped`);
  } catch (exc) {
    log(`[warn] triage_workflow_failed: ${exc.message} \u2014 lane failures are still recorded above`);
  }
}
return {
  runId,
  total: lanePlan.total_lanes,
  completed: completedLanes.length,
  failed: failures.length,
  skipped: skippedLanes.length,
  blocked: blockedLanes.filter((id) => !laneNeedsWrite.includes(id)).length,
  approval: laneNeedsWrite.length,
  failedLanes: failures,
  skippedLanes,
  approvalLanes: laneNeedsWrite,
  needsApproval: Object.fromEntries(laneNeedsWrite.map((id) => [id, results[id]?.error || "green_blocked_needs_write"])),
  blockedLanes,
  completedLanes
};
