// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-lane.ts
export const meta = {
  name: "datum-tdd-act-lane",
  description: "DAG-scheduled TDD execution: RED->GREEN->REFACTOR per lane",
  phases: [{ title: "Act" }]
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
var state = { agentTypes: true, hooksInstalled: false };
var configured = false;
function configureAgentTypes(opts) {
  if (typeof opts.agentTypes === "boolean") state.agentTypes = opts.agentTypes;
  if (typeof opts.hooksInstalled === "boolean") state.hooksInstalled = opts.hooksInstalled;
  configured = true;
}
function deterministicChecks() {
  return state.agentTypes && state.hooksInstalled;
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

// skills/src/shared/utils.ts
function pathBoundaryMatch(a2, b) {
  const x = a2.replace(/\/+$/, "");
  const y = b.replace(/\/+$/, "");
  return x === y || x.endsWith("/" + y) || x.startsWith(y + "/");
}
function verifyFileOwnership(changed, allowedFiles, forbiddenFiles = []) {
  const violations = [];
  for (const f of changed) {
    if (forbiddenFiles.some((fb) => pathBoundaryMatch(f, fb))) {
      violations.push(`${f} is forbidden at this stage (the other stage of this lane owns it, or another lane does)`);
    }
    if (allowedFiles.length > 0 && !allowedFiles.some((a2) => pathBoundaryMatch(f, a2))) {
      violations.push(`${f} is not in allowed files list [${allowedFiles.join(", ")}]`);
    }
  }
  return { ok: violations.length === 0, violations };
}
function classifyFiles(files) {
  const isImplAdjacent = (f) => {
    return f.includes("/Mocks/") || f.includes("/mocks/") || f.includes("/Fakes/") || f.includes("/fakes/") || f.includes("/Stubs/") || f.includes("/stubs/") || f.includes("/Fixtures/") || f.includes("/fixtures/") || f.includes("/Helpers/") || f.includes("/helpers/");
  };
  const isTest = (f) => {
    if (isImplAdjacent(f)) return false;
    const base = f.split("/").pop() || "";
    return base.startsWith("test_") || base.endsWith("_test.py") || base.endsWith(".test.ts") || base.endsWith(".test.js") || base.endsWith(".spec.ts") || base.endsWith(".spec.js") || base.endsWith("_test.go") || base.endsWith("Tests.swift") || f.startsWith("tests/") || f.includes("/tests/") || f.startsWith("Tests/") || f.includes("/Tests/") || base === "conftest.py";
  };
  const testFiles = (files || []).filter(isTest);
  const implFiles = (files || []).filter((f) => !isTest(f));
  return { testFiles, implFiles };
}
function preflightTestPaths(outputs, testFiles) {
  const registered = [];
  const skipped = [];
  for (const output of outputs || []) {
    const p = output.path;
    if (!p || testFiles.includes(p) || registered.includes(p)) continue;
    if (classifyFiles([p]).testFiles.length > 0) registered.push(p);
    else if (!skipped.includes(p)) skipped.push(p);
  }
  return { registered, skipped };
}
var FIRST_PARTY_PY_PACKAGES = ["datum", "scripts", "tests"];
function joinPosix(baseDir, rel) {
  const baseParts = baseDir.split("/").filter((p) => p !== "" && p !== ".");
  const relParts = rel.split("/");
  for (const part of relParts) {
    if (part === "" || part === ".") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join("/");
}
function dirnamePosix(p) {
  const parts = p.split("/");
  parts.pop();
  return parts.join("/");
}
function ensureTsExtension(p) {
  return /\.(ts|tsx|js|jsx|json)$/.test(p) ? p : `${p}.ts`;
}
function extractRequiredScopeFiles(content, testFilePath, language) {
  const required = /* @__PURE__ */ new Set();
  const dir = dirnamePosix(testFilePath);
  if (language === "typescript" || language === "javascript") {
    const importRe = /(?:import\s+(?:type\s+)?(?:\*\s+as\s+\w+|\{[^}]*\}|\w+)\s+from\s+|require\(\s*)['"](\.\.?\/[^'"]+)['"]\)?/g;
    let m;
    while (m = importRe.exec(content)) {
      required.add(ensureTsExtension(joinPosix(dir, m[1])));
    }
    const readFileRe = /readFileSync\(\s*join\(\s*__dirname\s*,\s*([^)]+)\)/g;
    let rm;
    while (rm = readFileRe.exec(content)) {
      const argsStr = rm[1];
      const segRe = /['"]([^'"]+)['"]/g;
      const segs = [];
      let sm;
      while (sm = segRe.exec(argsStr)) segs.push(sm[1]);
      if (segs.length > 0) {
        required.add(joinPosix(dir, segs.join("/")));
      }
    }
  } else if (language === "python") {
    const fromRe = /(?:^|\n)[ \t]*from\s+([\w]+(?:\.[\w]+)*)\s+import\s+/g;
    const importRe = /(?:^|\n)[ \t]*import\s+([\w]+(?:\.[\w]+)*)/g;
    const modules = [];
    let m;
    while (m = fromRe.exec(content)) modules.push(m[1]);
    while (m = importRe.exec(content)) modules.push(m[1]);
    for (const mod of modules) {
      const parts = mod.split(".");
      if (!FIRST_PARTY_PY_PACKAGES.includes(parts[0])) continue;
      if (parts.length === 1) continue;
      required.add(`${parts.join("/")}.py`);
    }
  }
  return [...required];
}
function findScopeGaps(requiredFiles, allowedFiles) {
  return requiredFiles.filter((rf) => !allowedFiles.some((af) => pathBoundaryMatch(rf, af)));
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
function laneCtxCmd(packet, wt) {
  const ctx = JSON.stringify({
    task_id: packet.task_id,
    stage: packet.stage,
    allowed_write_files: packet.allowed_write_files,
    forbidden_write_files: packet.forbidden_write_files,
    commit_prefix: packet.commit_prefix,
    test_count_floor: 0
  });
  return `mkdir -p "${wt}/.datum" && printf '%s' '${ctx.replace(/'/g, "'\\''")}' > "${wt}/.datum/lane-context.json"`;
}
function skepticMinorityFindings(allBugs, crossValidated) {
  const validated = new Set(crossValidated);
  return allBugs.filter((b) => !validated.has(b) && typeof b.evidence === "string" && b.evidence.trim().length > 0);
}
function minorityFollowUps(taskId, greenSha, findings) {
  return findings.map((b, i) => ({
    dedup_key: `skeptic-minority:${taskId}:${greenSha || "nosha"}:${i}`,
    title: `[skeptic] ${taskId}: ${b.description.replace(/\s+/g, " ").slice(0, 100)}`,
    body: `Lane ${taskId}, GREEN ${greenSha || "(no sha)"}, skeptic lens "${b.lens}", severity ${b.severity}.

${b.description}

Evidence: ${b.evidence}

A single lens reported this and the other lenses did not corroborate it, so the lane was not retried (2-of-3 rule). Verify before acting.`,
    severity: ["critical", "high", "medium", "low"].includes(String(b.severity)) ? b.severity : "medium",
    category: "other",
    suggested_labels: ["datum-followup", "skeptic"],
    source: "act.skeptic-minority"
  }));
}
function crossValidateBugs(skepticResults, lenses) {
  const allBugs = [];
  let brokenCount = 0;
  for (let i = 0; i < lenses.length; i++) {
    const s = skepticResults[i];
    if (!s) continue;
    if (s.verdict === "BROKEN") brokenCount++;
    for (const bug of s.bugs_found || []) {
      allBugs.push({ ...bug, lens: lenses[i].key });
    }
  }
  const normalize = (d) => d.toLowerCase().replace(/\s+/g, " ").slice(0, 60);
  const bugDescs = allBugs.map((b) => normalize(b.description));
  const crossValidated = allBugs.filter((_bug, idx) => {
    const myDesc = bugDescs[idx];
    return bugDescs.some((d, j) => j !== idx && d === myDesc);
  });
  return { allBugs, brokenCount, crossValidated };
}
function buildPacket(taskId, testFiles, implFiles, lane, wt, cfg2, stage, specFile, extras = {}) {
  return {
    ...extras,
    schema_version: "1.0",
    task_id: taskId,
    stage,
    title: lane.title,
    working_directory: wt,
    test_command: cfg2.testCommand,
    // The criteria/red_note/contract_summary are in this file, not in the
    // packet: nothing an LLM turn relayed is trusted as content (see
    // datum/lane_spec_export.py). The agent reads it and witnesses the read.
    // No sha here: the blob sha is the read witness, and a prompt that
    // prints it lets the agent copy it without opening the file.
    lane_spec_file: { path: specFile.path, bytes: specFile.bytes },
    allowed_write_files: stage === "RED" ? testFiles : stage === "GREEN" ? implFiles : [...testFiles, ...implFiles],
    forbidden_write_files: stage === "RED" ? implFiles : stage === "GREEN" ? testFiles : [],
    commit_prefix: stage === "RED" ? `red(${taskId})` : stage === "GREEN" ? `green(${taskId})` : `refactor(${taskId})`,
    ...cfg2.test_framework ? { test_framework: cfg2.test_framework } : {}
  };
}
var SKIPPED_PREFLIGHT = { status: "skipped", conflicts: [], needs_write: [], reason: "no preflight result" };
function parseContractPreflight(raw) {
  if (!raw) return SKIPPED_PREFLIGHT;
  const parsed = parseAgentJson(raw, {});
  if (!parsed || typeof parsed !== "object" || !parsed.status) return SKIPPED_PREFLIGHT;
  if (parsed.status !== "ok" && parsed.status !== "contract_conflict" && parsed.status !== "skipped") return SKIPPED_PREFLIGHT;
  return {
    status: parsed.status,
    conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
    needs_write: Array.isArray(parsed.needs_write) ? parsed.needs_write.filter((p) => typeof p === "string") : [],
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
    pytest_exit_code: parsed.pytest_exit_code ?? null
  };
}
var SCOPE_EXCEEDED_RE = /scope_exceeded:\s*(.+)$/i;
function decideGreenBlock(green, preflight) {
  const notBlocked = { blocked: false, needsWrite: [], reason: "" };
  if (!green) return notBlocked;
  if (green.success && green.tests_pass) return notBlocked;
  if (green.status === "blocked") {
    return {
      blocked: true,
      needsWrite: (green.needs_write || []).filter(Boolean),
      reason: green.reason || green.failure_reason || "GREEN agent reported status=blocked"
    };
  }
  const scope = (green.failure_reason || "").match(SCOPE_EXCEEDED_RE);
  if (scope) {
    const files = scope[1].split(/[,\s]+/).map((f) => f.trim()).filter(Boolean);
    return { blocked: true, needsWrite: files, reason: green.failure_reason || "scope_exceeded" };
  }
  if (preflight && preflight.status === "contract_conflict") {
    const detail = preflight.conflicts.map((c) => `${c.test}: ${c.error_type}: ${c.message} (${c.kind}${c.symbol ? `, symbol ${c.symbol}` : ""}, defined in ${c.defined_in.join(", ")})`).join("; ");
    return {
      blocked: true,
      needsWrite: preflight.needs_write,
      reason: `contract_conflict: RED test contradicts a contract GREEN cannot write \u2014 ${detail || preflight.reason}. Re-running GREEN with an unchanged allowed_write_files cannot pass.`
    };
  }
  return notBlocked;
}
var AUTO_WIDEN_PREFIXES = ["src/"];
function autoWidenTargets(needsWrite, prefixes = AUTO_WIDEN_PREFIXES) {
  const widen = [];
  const rejected = [];
  for (const p of needsWrite) {
    const safe = !p.split("/").includes("..") && !p.startsWith("/");
    if (safe && prefixes.some((pre) => p.startsWith(pre))) widen.push(p);
    else rejected.push(p);
  }
  return { widen, rejected };
}
function testRunCommand(testCommand, wt, stage) {
  const logPath = `${wt}/.datum/test-output-${stage}.log`;
  return `mkdir -p "${wt}/.datum" && ( cd "${wt}" && ${testCommand} ) > "${logPath}" 2>&1; TEST_EXIT=$?; tail -50 "${logPath}"; echo "TEST_EXIT=$TEST_EXIT"`;
}
var LANE_COMMIT_AUTHOR_EMAIL = "datum@local";
function laneCommitCommand(opts) {
  const { wt, taskId, stage, runId, specHash } = opts;
  const prefix = `${stage.toLowerCase()}(${taskId})`;
  const authorName = runId ? `datum/${runId}` : "datum";
  const parts = [
    `git -C "${wt}"`,
    `-c user.name="${authorName}" -c user.email="${LANE_COMMIT_AUTHOR_EMAIL}"`,
    "commit",
    `-m "${prefix}: ${stage} complete"`
  ];
  if (runId) parts.push(`-m "Datum-Run: ${runId}"`);
  parts.push(`-m "Datum-Lane: ${taskId}"`);
  parts.push(`-m "Datum-Stage: ${stage}"`);
  if (specHash && /^[A-Za-z0-9:]+$/.test(specHash)) parts.push(`-m "Datum-Spec: ${specHash}"`);
  return parts.join(" ");
}
function detectExistingLaneCommits(logOutput, taskId) {
  const redTarget = `red(${taskId}): RED complete`;
  const greenTarget = `green(${taskId}): GREEN complete`;
  const lines = (logOutput || "").split("\n");
  const specOf = (target) => {
    const line = lines.find((l) => l.includes(target));
    if (!line) return null;
    const tab = line.indexOf("	");
    if (tab === -1) return null;
    const spec = line.slice(tab + 1).trim().split(",")[0];
    return spec || null;
  };
  return {
    hasRed: lines.some((l) => l.includes(redTarget)),
    hasGreen: lines.some((l) => l.includes(greenTarget)),
    redSpec: specOf(redTarget),
    greenSpec: specOf(greenTarget)
  };
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
  const results2 = arr.map(asStepResult).filter((r) => r !== null);
  if (results2.length === 0) return { steps: [], failed: null, missing: true };
  if (results2.length === 1 && results2[0].name === "__script" && results2[0].exit_code !== 0) {
    const { exit_code, stderr } = results2[0];
    const guard = /^batch_(script_corrupt|root_missing|tool_missing)\b/.test(stderr.trim());
    const scriptError = guard ? stderr.trim() : `batch_script_failed: the batch script exited ${exit_code} before any step ran (the host shell refused to execute it; exit 126 is "cannot execute")${stderr.trim() ? `; runner said: "${stderr.trim().replace(/\s+/g, " ").slice(0, 160)}"` : ""}`;
    return scriptError.startsWith("batch_script_corrupt") ? { steps: [], failed: null, missing: true, corrupt: scriptError, scriptError } : { steps: [], failed: null, missing: true, scriptError };
  }
  const tolerant = new Set(steps.filter((s) => s.tolerant).map((s) => s.name));
  const recFailed = results2.find((r) => r.stderr.startsWith("batch_rec_failed:")) ?? null;
  const failed = recFailed ?? results2.find((r) => r.exit_code !== 0 && !tolerant.has(r.name)) ?? null;
  const last = results2[results2.length - 1];
  const stoppedByFailFast = failed !== null && last?.name === failed.name && !tolerant.has(failed.name);
  if (results2.length < steps.length && !stoppedByFailFast) {
    const returned = new Set(results2.map((r) => r.name));
    const absent = steps.map((s) => s.name).filter((n) => !returned.has(n));
    return {
      steps: [],
      failed: null,
      missing: true,
      scriptError: `batch_incomplete: ${results2.length} of ${steps.length} step records returned and no non-tolerant failure stopped the batch \u2014 the runner returned a partial result (last record: ${last?.name ?? "none"}); absent: [${absent.join(", ")}]`
    };
  }
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
  const tail3 = (r.failed.stderr || r.failed.stdout).trim().split("\n").slice(-5).join("\n");
  return `${label}: step "${r.failed.name}" exited ${r.failed.exit_code}${tail3 ? ` \u2014 ${tail3}` : ""}`;
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
function worktreeResetSteps(wt) {
  return [
    { name: "reset", command: `git -C ${q(wt)} reset --hard HEAD`, tolerant: true },
    { name: "clean", command: `git -C ${q(wt)} clean -fd`, tolerant: true },
    { name: "status", command: `git -C ${q(wt)} status --porcelain`, tolerant: true }
  ];
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
    const tail3 = (step && (step.stderr || step.stdout) || "").trim().split("\n").slice(-3).join(" | ");
    return { dirty: true, known: false, detail: `retry_guard_unverified: git status exited ${step ? step.exit_code : "without running"}${tail3 ? ` \u2014 ${tail3}` : ""}` };
  }
  const lines = (step.stdout || "").split("\n").filter((l) => l.trim().length > 0);
  return { dirty: lines.length > 0, known: true, detail: lines.join(" | ") };
}
function preserveHeadRefSteps(wt, ref) {
  return [{ name: "preserve", command: `git -C ${q(wt)} branch -f ${q(ref)} HEAD`, tolerant: true }];
}
function worktreeResetToSteps(wt, sha) {
  return [
    { name: "reset", command: `git -C ${q(wt)} reset --hard ${q(sha)}`, tolerant: true },
    { name: "clean", command: `git -C ${q(wt)} clean -fd`, tolerant: true },
    { name: "status", command: `git -C ${q(wt)} status --porcelain`, tolerant: true },
    { name: "head", command: `git -C ${q(wt)} rev-parse HEAD`, tolerant: true },
    // Resolved so a ref (the epic branch) can be the target, not only a sha.
    { name: "target", command: `git -C ${q(wt)} rev-parse ${q(`${sha}^{commit}`)}`, tolerant: true }
  ];
}
function worktreeResetToFromSteps(result, sha) {
  if (result.missing) return { ok: false, error: `worktree_reset_failed: ${describeFailure(result, "reset-to-red")}` };
  const head = stepStdout(result, "head");
  if (head === null) return { ok: false, error: `worktree_reset_failed: the head step did not run \u2014 cannot confirm where the worktree is (steps returned: ${result.steps.map((st) => `${st.name}=${st.exit_code}`).join(", ") || "none"})` };
  const got = head.trim();
  const resolved = (stepStdout(result, "target") || "").trim() || sha;
  if (got !== sha && got !== resolved) {
    const reset = stepResult(result, "reset");
    const why = reset && reset.exit_code !== 0 ? ` (reset exited ${reset.exit_code}: ${(reset.stderr || reset.stdout || "").trim().slice(0, 200)})` : "";
    return { ok: false, error: `worktree_reset_failed: HEAD is ${got || "?"}, expected ${sha}${why}` };
  }
  const dirty = (stepStdout(result, "status") || "").trim();
  if (dirty) return { ok: false, error: `worktree_reset_failed: worktree still dirty after reset to ${sha}: ${dirty.split("\n").length} path(s)` };
  return { ok: true, error: "" };
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
function parseCommitVerification(logStdout, statusStdout, commitPrefix, stage) {
  if (logStdout === null || logStdout === void 0) {
    return { committed: false, detail: "independent check returned no result (log step did not run)" };
  }
  const shaLine = /^[0-9a-f]{40} /;
  const logLines = String(logStdout).split("\n").map((l) => l.trim()).filter((l) => shaLine.test(l));
  const statusLines = String(statusStdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const target = `${commitPrefix}: ${stage} complete`;
  const match = logLines.find((l) => l.includes(target));
  const clean = statusLines.length === 0;
  return {
    committed: Boolean(match) && clean,
    commitSha: match ? match.split(" ")[0] : "",
    clean,
    detail: match ? `found_commit="${match}" uncommitted_files=${statusLines.length}` : `no commit matching "${target}" found in history; uncommitted_files=${statusLines.length}`
  };
}
async function verifyCommitIndependently(taskId, wt, files, commitPrefix, stage, baseRef) {
  const q4 = (s) => `"${s.replace(/"/g, '\\"')}"`;
  const range = baseRef ? `${q4(baseRef)}..HEAD` : "-n 200";
  const steps = [
    { name: "log", command: `git -C ${q4(wt)} log --format="%H %s" ${range}`, tolerant: true },
    { name: "status", command: `git -C ${q4(wt)} status --porcelain -- ${files.map(q4).join(" ")}`, tolerant: true }
  ];
  const raw = await agent(
    batchCommandPrompt(steps),
    stageOpts("cli", { label: `verify-commit:${taskId}:${stage}`, model: model("fast") })
  );
  const result = parseBatchResult(raw, steps);
  if (result.missing) return { committed: false, detail: `independent check returned no result (${describeFailure(result, "verify-commit")})` };
  return parseCommitVerification(stepStdout(result, "log"), stepStdout(result, "status"), commitPrefix, stage);
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
    if (attempt < maxRetries && opts?.worktree) {
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
function tail(step) {
  return (step.stderr || step.stdout || "").trim().split("\n").slice(-3).join(" | ");
}
function stageSteps(issueId, stage, commitSha) {
  if (!/^\d+$/.test(issueId)) throw new Error(`stageSteps: issue id must be numeric, got ${JSON.stringify(issueId)}`);
  if (commitSha && !/^[0-9a-f]{4,40}$/i.test(commitSha)) throw new Error(`stageSteps: commit sha must be hex, got ${JSON.stringify(commitSha)}`);
  const shaFlag = commitSha ? ` --commit ${commitSha}` : "";
  return [{ name: "stage", command: `datum issue-stage --issue ${issueId} --stage ${stage}${shaFlag}`, tolerant: true }];
}
function stageFromSteps(result) {
  if (result.missing) return { ok: false, error: `tracker_stage_failed: ${describeFailure(result, "stage")}` };
  const step = stepResult(result, "stage");
  if (!step) return { ok: false, error: "tracker_stage_failed: stage step did not run" };
  if (step.exit_code !== 0) return { ok: false, error: `tracker_stage_failed: datum issue-stage exited ${step.exit_code} \u2014 ${tail(step)}` };
  const parsed = parseAgentJson(step.stdout || "", null);
  if (!parsed || parsed.ok !== true) return { ok: false, error: `tracker_stage_failed: datum issue-stage exited 0 without ok:true \u2014 ${(step.stdout || "").trim().slice(0, 200)}` };
  return { ok: true, error: "" };
}
async function updateStage(issueId, stage, commitSha) {
  if (!issueId) return false;
  const steps = stageSteps(issueId, stage, commitSha);
  const outcome = stageFromSteps(await runBatch(steps, stageOpts("cli", { label: `tracker:${issueId}:${stage}`, model: model("fast") })));
  if (!outcome.ok) {
    log(`[tracker] ${outcome.error} (issue #${issueId} \u2192 ${stage})`);
    return false;
  }
  return true;
}
function getIssueId(lanePlan2, taskId) {
  const issue = lanePlan2.lanes[taskId]?.github_issue;
  return issue ? String(issue) : "";
}

// skills/src/shared/context-relay.ts
var CONTEXT_RELAY_BUDGET_BYTES = 16 * 1024;
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

// skills/src/shared/lane-steps.ts
var q2 = (s) => `"${s.replace(/"/g, '\\"')}"`;
var ereEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function catOrMissing(path) {
  return `cat ${q2(path)} 2>/dev/null || echo MISSING`;
}
function isMissing(raw) {
  return !raw || raw.trim() === "" || raw.trim() === "MISSING";
}
var PROPERTIES_DEFERRED_MARKER = "__DATUM_PROPERTIES_DEFERRED__";
function laneIntakeSteps(o) {
  const steps = [];
  if (o.laneSpec) {
    steps.push({ name: "lane-spec", command: laneSpecExportCommand(o.laneSpec), tolerant: true });
    steps.push({ name: "lane-spec-bytes", command: `wc -c < ${q2(o.laneSpec.outPath)} | tr -d ' '`, tolerant: true });
    steps.push({ name: "lane-spec-sha", command: `git hash-object ${q2(o.laneSpec.outPath)}`, tolerant: true });
  }
  if (o.properties) {
    const propPath = `${o.wt}/docs/epics/${o.properties.epicBranch}/PROPERTIES.md`;
    steps.push({
      name: "properties-bytes",
      command: `if [ -f ${q2(propPath)} ]; then wc -c < ${q2(propPath)} | tr -d ' '; else printf -- '-1'; fi`,
      tolerant: true
    });
    steps.push({
      name: "properties-sha",
      command: `if [ -f ${q2(propPath)} ]; then git hash-object ${q2(propPath)}; else printf ''; fi`,
      tolerant: true
    });
    steps.push({
      name: "properties-cat",
      command: `__pb=$(if [ -f ${q2(propPath)} ]; then wc -c < ${q2(propPath)} | tr -d ' '; else printf -- '-1'; fi); if [ "$__pb" != "-1" ] && [ "$__pb" -le ${CONTEXT_RELAY_BUDGET_BYTES} ]; then cat ${q2(propPath)}; else printf '%s' '${PROPERTIES_DEFERRED_MARKER}'; fi`,
      tolerant: true
    });
  }
  if (o.completionPath) steps.push({ name: "completion", command: catOrMissing(o.completionPath), tolerant: true });
  steps.push({ name: "history", command: `git -C ${q2(o.wt)} log --format="%H %s%x09%(trailers:key=Datum-Spec,valueonly,separator=%x2C)" ${q2(o.epicBranch)}..HEAD`, tolerant: true });
  if (!o.structural) {
    if (o.cleanupCmd) steps.push({ name: "cleanup", command: o.cleanupCmd, tolerant: true });
    if (o.planSkeletonPath) {
      steps.push({
        name: "skeleton-plan",
        command: `jq -c '{framework, target_context, outputs: [(.outputs // [])[] | {path}]}' ${q2(o.planSkeletonPath)} 2>/dev/null || echo MISSING`,
        tolerant: true
      });
    }
    const gen = `${o.skeletonCmd}
cat ${q2(`${o.wt}/${o.preflightPath}`)} 2>/dev/null || cat ${q2(o.preflightPath)} 2>/dev/null || echo "{}"`;
    steps.push({
      name: "skeleton-gen",
      command: o.planSkeletonPath ? `if [ -s ${q2(o.planSkeletonPath)} ]; then echo SKIPPED_PLAN_SKELETON; else
${gen}
fi` : gen,
      tolerant: true
    });
  }
  if (o.verifyTestCmd) {
    steps.push({ name: "test-verify", command: testRunCommand(o.verifyTestCmd, o.wt, "intake-verify"), tolerant: true });
  }
  return steps;
}
function testEnvMissing(stdout) {
  if (!stdout) return null;
  const re = /command not found|node_modules missing|did you mean to install|No module named ['"]?pytest|Cannot find module ['"]vitest|vitest: not found|not recognized as an internal or external command/i;
  const line = stdout.split("\n").map((l) => l.trim()).find((l) => re.test(l));
  return line ? line.replace(/^\s*ERR_PNPM\S*\s*/, "") : null;
}
function verifyVerdictForStep(result, label, stepName) {
  const exit = testExitCode(stepStdout(result, stepName));
  if (exit === null) {
    const why = result.missing ? describeFailure(result, label) : stepResult(result, stepName) ? `${label}: ${stepName} step ran but printed no TEST_EXIT line` : `${label}: ${stepName} step did not run (${result.failed ? `stopped at "${result.failed.name}"` : "not in the batch result"})`;
    return { kind: "unavailable", exit: null, why };
  }
  if (exit === 0) return { kind: "passed", exit: 0, why: "" };
  return { kind: "failed", exit, why: "" };
}
function verifyVerdict(result, label) {
  return verifyVerdictForStep(result, label, "test-verify");
}
function buildVerifyVerdict(result, label) {
  return verifyVerdictForStep(result, label, "build-verify");
}
function testExitCode(stdout) {
  if (!stdout) return null;
  const matches = [...stdout.matchAll(/TEST_EXIT=(\d+)/g)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]);
}
var RUNTIME_ARTIFACT_READ_RE = `(REPO_ROOT|repo_root|ROOT_DIR|__dirname|process\\.cwd\\(\\)|parents\\[[0-9]+\\]|\\.resolve\\(\\)).{0,80}['"/]\\.datum(/|['"])`;
function postRedSteps(o) {
  const steps = [];
  if (o.acCount > 0) {
    steps.push({
      name: "count-gate",
      command: `PATFILE=$(mktemp)
cat > "$PATFILE" <<'PATTERN_EOF'
${o.testFuncDiffRegex}
PATTERN_EOF
datum dev test-count-gate --repo ${q2(o.wt)} --files ${o.testFiles.map(q2).join(" ")} --pattern-file "$PATFILE" --required ${o.acCount}` + (o.baseRef ? ` --base ${q2(o.baseRef)}` : ""),
      tolerant: true
    });
  }
  const baseLine = o.baseRef ? `__base=$(git -C ${q2(o.wt)} merge-base HEAD ${q2(o.baseRef)} 2>/dev/null)` : '__base=""';
  const filterLines = (f, i) => [
    `__d${i}=$(mktemp -d); __t="$__d${i}/${f.split("/").pop()}"`,
    `if [ -n "$__base" ]; then __added=$(git -C ${q2(o.wt)} diff --unified=0 "$__base" HEAD -- ${q2(f)} 2>/dev/null | awk '/^@@/{split($3,p,","); s=substr(p[1],2)+0; n=(p[2]==""?1:p[2]+0); for(i=0;i<n;i++) printf "%d ", s+i}'); else __added=ALL; fi`,
    `awk -v added="$__added" -v sq="'" 'BEGIN{all=(added=="ALL"); n=split(added,a," "); for(i=1;i<=n;i++) keep[a[i]]=1; re="\\"\\"\\"|" sq sq sq "|\`"} { s=$0; c=gsub(re,"",s); if (instr || !(all || keep[NR])) print ""; else print $0; if (c%2==1) instr=!instr }' ${q2(`${o.wt}/${f}`)} > "$__t"`
  ].join("\n");
  steps.push({
    name: "assert-check",
    command: baseLine + "\n" + o.testFiles.map((f, i) => filterLines(f, i) + "\n" + o.sgPatterns.map(
      (p) => (
        // The grep fallback (no ast-grep, or ast-grep errored) is anchored to
        // a statement start: an unanchored grep matched `assert True` inside a
        // quoted fixture string of a test-detection test and failed a sound
        // RED as placeholder_assertions (caliper wf_181691ac-fbf, BUG I).
        // Hits are reported against the original path. ast-grep exits 1 for
        // "no match" AND for every error, so `ast-grep || grep` fell back on
        // every clean file and its parse-aware verdict was never trusted
        // (caliper: the eedom halt was grep output with ast-grep installed).
        // Trusted when present and silent on stderr; grep only otherwise.
        `__sg=1; if command -v ast-grep >/dev/null 2>&1; then ast-grep --pattern '${p.pattern}' "$__t" > "$__d${i}/out" 2> "$__d${i}/err"; [ -s "$__d${i}/err" ] || __sg=0; fi
if [ "$__sg" -eq 0 ]; then sed "s#^$__t#${f}#" "$__d${i}/out"; else grep -nE '^[[:space:]]*${p.grep ?? ereEscape(p.pattern)}' "$__t" 2>/dev/null | sed "s#^#${f}:#"; fi`
      )
    ).join("\n")).join("\n") + `
BODYPATFILE=$(mktemp)
cat > "$BODYPATFILE" <<'PATTERN_EOF'
${o.testFuncBodyRegex}
PATTERN_EOF
` + o.testFiles.map(
      (f, i) => `grep -A1 -f "$BODYPATFILE" "$__d${i}/${f.split("/").pop()}" 2>/dev/null | grep -B1 '^\\s*pass$' 2>/dev/null`
    ).join("\n"),
    tolerant: true
  });
  steps.push({
    name: "artifact-check",
    command: `ARTPATFILE=$(mktemp)
cat > "$ARTPATFILE" <<'PATTERN_EOF'
${RUNTIME_ARTIFACT_READ_RE}
PATTERN_EOF
` + o.testFiles.map(
      (f, i) => `grep -nE -f "$ARTPATFILE" "$__d${i}/${f.split("/").pop()}" 2>/dev/null | sed "s#^#${f}:#"`
    ).join("\n"),
    tolerant: true
  });
  const redSince = o.baseRef ? laneStartExpr(o.wt, o.baseRef) : null;
  if (o.ownership) steps.push({ name: "ownership", command: ownershipCommand(o.wt, redSince), tolerant: true });
  const cap = scopeReadCap(o.testFiles.length);
  o.testFiles.forEach((f, i) => {
    steps.push({ name: `scope-size-${i}`, command: `wc -c < ${q2(`${o.wt}/${f}`)} 2>/dev/null | tr -d ' '`, tolerant: true });
    steps.push({ name: `scope-read-${i}`, command: `head -c ${cap} ${q2(`${o.wt}/${f}`)} 2>/dev/null`, tolerant: true });
  });
  steps.push({
    name: "test-count-pattern",
    command: `GREPPATFILE=$(mktemp)
cat > "$GREPPATFILE" <<'PATTERN_EOF'
${o.testFuncGrepRegex}
PATTERN_EOF
cat "$GREPPATFILE"`,
    tolerant: true
  });
  steps.push({
    name: "test-count-after",
    command: o.testFiles.map((f) => `grep -c -E -f "$GREPPATFILE" ${q2(`${o.wt}/${f}`)} 2>/dev/null || echo 0`).join("\n"),
    tolerant: true
  });
  const beforeRef = o.baseRef ? `$(git -C ${q2(o.wt)} merge-base HEAD ${q2(o.baseRef)})` : "HEAD~1";
  steps.push({
    name: "test-count-before",
    command: o.testFiles.map(
      (f) => `__before=${beforeRef}; git -C ${q2(o.wt)} rev-parse "$__before" >/dev/null 2>&1 && git -C ${q2(o.wt)} show "$__before":${q2(f)} 2>/dev/null | grep -c -E -f "$GREPPATFILE" || echo 0`
    ).join("\n"),
    tolerant: true
  });
  if (o.verifyTestCmd) {
    steps.push({ name: "test-verify", command: testRunCommand(o.verifyTestCmd, o.wt, "red-verify"), tolerant: true });
  }
  return steps;
}
function codeTellSteps(o) {
  const base = o.baseRef ? ` --base ${q2(o.baseRef)}` : "";
  return [{ name: "tell-scan", command: `datum code-tells --repo ${q2(o.wt)}${base} --files ${o.files.map(q2).join(" ")}`, tolerant: true }];
}
function parseTellScan(stdout) {
  const out = [];
  for (const row of (stdout || "").split("\n")) {
    const m = /^([^:]+):(\d+):([a-z_]+):(.*)$/.exec(row);
    if (m) out.push({ file: m[1], line: Number(m[2]), tag: m[3], text: m[4] });
  }
  return out;
}
function ownershipCommand(wt, since) {
  return `git -C ${q2(wt)} diff --name-only ${since || "HEAD~1"} HEAD`;
}
function ownershipCheckSteps(wt, since) {
  return [{ name: "ownership", command: ownershipCommand(wt, since), tolerant: true }];
}
function laneStartExpr(wt, epicBranch) {
  return `"$(git -C ${q2(wt)} merge-base HEAD ${q2(epicBranch)})"`;
}
function depMergeSteps(wt, branches) {
  return branches.map((b, i) => ({
    name: `merge-${i}`,
    command: `git -C ${q2(wt)} merge --no-edit ${q2(b)} || { git -C ${q2(wt)} merge --abort >/dev/null 2>&1; false; }`
  }));
}
function depMergeFromSteps(result, branches) {
  if (result.missing) {
    return { ok: false, error: `dep_merge_failed: could not merge [${branches.join(", ")}] \u2014 ${describeFailure(result, "merge-0")}` };
  }
  for (let i = 0; i < branches.length; i++) {
    const step = stepResult(result, `merge-${i}`);
    if (!step) {
      return { ok: false, error: `dep_merge_failed: could not merge ${branches[i]} \u2014 merge step did not run` };
    }
    if (step.exit_code !== 0) {
      const tail3 = (step.stderr || step.stdout || "").trim().split("\n").slice(-3).join(" | ");
      return { ok: false, error: `dep_merge_failed: could not merge ${branches[i]} (exit ${step.exit_code}, merge aborted) \u2014 ${tail3}` };
    }
  }
  return { ok: true, error: "" };
}
function ownershipFromStdout(raw, allowedFiles, forbiddenFiles) {
  if (raw === null || raw === void 0) {
    return { ok: false, violations: ["ownership_check_failed: ownership diff step did not run or returned no result"] };
  }
  const changed = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  return verifyFileOwnership(changed, allowedFiles, forbiddenFiles);
}
function newTestCountFromSteps(result) {
  const none = { ok: false, before: 0, after: 0, added: 0 };
  if (result.missing) return { ...none, error: `test_count_missing: ${describeFailure(result, "post-red batch")}` };
  for (const name of ["test-count-before", "test-count-after"]) {
    if (!stepResult(result, name)) return { ...none, error: `test_count_missing: ${name} step absent from the post-red batch result \u2014 cannot tell whether RED wrote any tests` };
  }
  const before = sumCounts(stepStdout(result, "test-count-before"));
  const after = sumCounts(stepStdout(result, "test-count-after"));
  return { ok: true, before, after, added: after - before, error: "" };
}
function sumCounts(raw) {
  if (!raw) return 0;
  return raw.split("\n").map((l) => parseInt(l.trim(), 10)).filter((n) => !isNaN(n)).reduce((a2, b) => a2 + b, 0);
}
var SCOPE_READ_BUDGET_BYTES = 16 * 1024;
function scopeReadCap(fileCount) {
  return Math.max(2048, Math.floor(SCOPE_READ_BUDGET_BYTES / Math.max(1, fileCount)));
}
function scopeReadTruncations(testFiles, stdoutOf, cap) {
  const out = [];
  testFiles.forEach((f, i) => {
    const bytes = parseInt((stdoutOf(`scope-size-${i}`) || "").trim(), 10);
    if (Number.isFinite(bytes) && bytes > cap) out.push({ file: f, bytes, cap });
  });
  return out;
}
function scopeContentsFromSteps(testFiles, stdoutOf) {
  const out = {};
  testFiles.forEach((f, i) => {
    const s = stdoutOf(`scope-read-${i}`);
    if (s) out[f] = s;
  });
  return out;
}
function scopeContractSteps(o) {
  const steps = [];
  o.scopeGaps.forEach((f, i) => {
    steps.push({ name: `scope-exists-${i}`, command: `test -f ${q2(`${o.wt}/${f}`)}`, tolerant: true });
  });
  if (o.contractPreflight) {
    const c = o.contractPreflight;
    const gapLoop = o.scopeGaps.length > 0 ? `for __f in ${o.scopeGaps.map(q2).join(" ")}; do [ -f ${q2(o.wt)}/"$__f" ] && __extra+=(--allowed "$__f"); done
` : "";
    steps.push({
      name: "contract-preflight",
      command: `__extra=()
${gapLoop}datum contract-preflight --repo ${q2(o.wt)} --test-command ${JSON.stringify(c.scopedTestCmd)} ` + c.testFiles.map((f) => `--test-file ${q2(f)}`).join(" ") + (c.implFiles.length > 0 ? " " + c.implFiles.map((f) => `--allowed ${q2(f)}`).join(" ") : "") + ' "${__extra[@]}"',
      tolerant: true
    });
  }
  return steps;
}
function scopeGapsFromSteps(scopeGaps, exitOf) {
  const existing = [];
  const missing = [];
  scopeGaps.forEach((f, i) => {
    const code = exitOf(`scope-exists-${i}`);
    if (code === 0) existing.push(f);
    else missing.push(f);
  });
  return { existing, missing };
}
function postGreenSteps(o) {
  const steps = [{ name: "ownership", command: ownershipCommand(o.wt, o.redSha), tolerant: true }];
  if (o.redSha) {
    steps.push({ name: "red-files", command: `git -C ${q2(o.wt)} diff-tree --no-commit-id --name-only -r ${q2(o.redSha)}`, tolerant: true });
  }
  if (o.verifyTestCmd || o.buildCommand) {
    steps.push(...strayCleanSteps(o.wt));
  }
  if (o.verifyTestCmd) {
    steps.push({ name: "test-verify", command: testRunCommand(o.verifyTestCmd, o.wt, "green-verify"), tolerant: true });
  }
  if (o.buildCommand) {
    steps.push({ name: "build-verify", command: testRunCommand(o.buildCommand, o.wt, "green-build-verify"), tolerant: true });
  }
  return steps;
}
function structuralDeliverableSteps(o) {
  const checks = o.files.map((f) => `test -e ${q2(o.wt)}/${q2(f)} || echo "MISSING ${f}"`).join("; ");
  const scoped = o.files.map(q2).join(" ");
  return [
    { name: "deliverable-check", command: checks || "true", tolerant: true },
    { name: "deliverable-commits", command: `git -C ${q2(o.wt)} log --oneline ${q2(o.epicBranch)}..HEAD -- ${scoped}`, tolerant: true }
  ];
}
function structuralDeliverablesFromSteps(result, files) {
  const check = stepStdout(result, "deliverable-check");
  const commits = stepStdout(result, "deliverable-commits");
  if (check === null || commits === null) return null;
  const flagged = new Set(check.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("MISSING ")).map((l) => l.slice("MISSING ".length)));
  return { missing: files.filter((f) => flagged.has(f)), committed: commits.trim() !== "" };
}
var STRAY_KEEP_DIRS = [".datum", ".temp"];
function strayCleanSteps(wt) {
  const keepFilter = STRAY_KEEP_DIRS.map((d) => `-e '^${d.replace(".", "\\.")}/'`).join(" ");
  const keepExcludes = STRAY_KEEP_DIRS.map((d) => `-e ${d}`).join(" ");
  const list = `git -C ${q2(wt)} status --porcelain --untracked-files=all 2>/dev/null | sed -n 's/^?? //p' | grep -v ${keepFilter}`;
  return [
    { name: "stray-list", command: list, tolerant: true },
    { name: "stray-clean", command: `git -C ${q2(wt)} clean -fdq ${keepExcludes} 2>&1`, tolerant: true },
    { name: "stray-confirm", command: list, tolerant: true }
  ];
}
function strayFilesFromSteps(result) {
  const listed = stepStdout(result, "stray-list");
  const confirm = stepStdout(result, "stray-confirm");
  if (listed === null || confirm === null) return { strays: [], cleaned: null };
  const strays = listed.split("\n").map((l) => l.trim()).filter(Boolean).sort();
  return { strays, cleaned: confirm.trim() === "" };
}
function redCommittedFilesFromSteps(r) {
  const rec = stepResult(r, "red-files");
  if (!rec || rec.exit_code !== 0) return null;
  return rec.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}
var PLAIN_ID_RE = /^[A-Za-z0-9._-]+$/;
var LANE_PLAN_DIGEST_BUDGET_BYTES = 16 * 1024;
function digestSpecHash(digest, taskId) {
  const lane = digest.lanes[taskId];
  if (!lane) throw new Error(`lane_plan_digest_unparseable: lane ${taskId} is not in the digest`);
  if (typeof lane.spec_hash !== "string" || !lane.spec_hash) throw new Error(`lane_plan_digest_unparseable: lane ${taskId} carries no spec_hash`);
  return lane.spec_hash;
}
function laneSpecExportCommand(o) {
  if (!PLAIN_ID_RE.test(o.taskId)) throw new Error(`laneSpecExportCommand: task id must be a plain identifier, got ${JSON.stringify(o.taskId)}`);
  if (!/^[A-Za-z0-9:]+$/.test(o.expectHash)) throw new Error(`laneSpecExportCommand: spec hash must be plain, got ${JSON.stringify(o.expectHash)}`);
  return `datum lane-spec-export --plan ${q2(o.planPath)} --task ${q2(o.taskId)} --out ${q2(o.outPath)} --expect-hash ${q2(o.expectHash)}`;
}
function laneSpecFromSteps(result, taskId, outPath) {
  const none = { ok: false, spec: null };
  if (result.missing) return { ...none, error: `lane_spec_export_failed: ${taskId} \u2014 ${describeFailure(result, "lane-spec")}` };
  const step = stepResult(result, "lane-spec");
  if (!step) return { ...none, error: `lane_spec_export_failed: ${taskId} \u2014 the lane-spec step never ran` };
  if (step.exit_code !== 0) {
    const cliErr = parseAgentJson(step.stdout || "", null);
    const why = cliErr && typeof cliErr.error === "string" && cliErr.error || (step.stderr || step.stdout || "").trim().slice(0, 300) || `exit ${step.exit_code}`;
    return { ...none, error: `lane_spec_export_failed: ${taskId} \u2014 ${why}` };
  }
  const parsed = parseAgentJson(step.stdout || "", null);
  const bad = (what) => ({ ...none, error: `lane_spec_export_unparseable: ${taskId} \u2014 ${what}: ${(step.stdout || "").trim().slice(0, 200)}` });
  if (!parsed || typeof parsed !== "object") return bad("datum lane-spec-export printed no JSON object");
  if (parsed.task_id !== taskId) return bad(`summary is for ${String(parsed.task_id)}`);
  if (typeof parsed.path !== "string" || !parsed.path) return bad("no path");
  if (typeof parsed.bytes !== "number" || !Number.isInteger(parsed.bytes) || parsed.bytes <= 0) return bad("bytes is not a positive integer");
  if (typeof parsed.sha !== "string" || !/^[0-9a-f]{40}$/.test(parsed.sha)) return bad("sha is not a 40-hex blob id");
  if (typeof parsed.spec_hash !== "string" || !parsed.spec_hash) return bad("no spec_hash");
  if (typeof parsed.ac_count !== "number" || !Number.isInteger(parsed.ac_count) || parsed.ac_count < 0) return bad("ac_count is not a non-negative integer");
  if (parsed.path !== outPath) return bad(`path is ${parsed.path}, expected ${outPath}`);
  const diskBytes = parseInt((stepStdout(result, "lane-spec-bytes") || "").trim(), 10);
  const diskSha = (stepStdout(result, "lane-spec-sha") || "").trim();
  if (diskBytes !== parsed.bytes || diskSha !== parsed.sha) {
    return { ...none, error: `lane_spec_relay_mismatch: ${taskId} \u2014 the summary says ${parsed.bytes} bytes / blob ${parsed.sha} but ${outPath} measures ${Number.isFinite(diskBytes) ? diskBytes : "?"} bytes / blob ${diskSha || "?"} \u2014 the runner did not return the export summary verbatim` };
  }
  return {
    ok: true,
    spec: { task_id: parsed.task_id, path: parsed.path, bytes: parsed.bytes, sha: parsed.sha, spec_hash: parsed.spec_hash, ac_count: parsed.ac_count },
    error: ""
  };
}
function laneSpecContextFile(spec) {
  return { path: spec.path, exists: true, inlined: false, bytes: spec.bytes, sha: spec.sha, content: null };
}
function propertiesFromSteps(result, epicBranch, wt) {
  const path = `${wt}/docs/epics/${epicBranch}/PROPERTIES.md`;
  const bytesRaw = stepStdout(result, "properties-bytes");
  const bytes = bytesRaw === null ? NaN : parseInt(bytesRaw.trim(), 10);
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  const sha = (stepStdout(result, "properties-sha") || "").trim();
  const catRaw = stepStdout(result, "properties-cat");
  const deferred = { path, exists: true, inlined: false, bytes, sha, content: null };
  if (catRaw === null || catRaw === PROPERTIES_DEFERRED_MARKER) return deferred;
  const actualBytes = utf8ByteLength(catRaw);
  if (actualBytes !== bytes) return deferred;
  if (sha && gitBlobSha(utf8Encode(catRaw)) !== sha) return deferred;
  return { path, exists: true, inlined: true, bytes, sha, content: catRaw };
}
function integrationVerifyCmd(testCommand, testFiles) {
  const cmd = testCommand.trim();
  if (testFiles.length === 0) return cmd;
  if (!/\bpytest\b|\bvitest\s+run\b/.test(cmd)) return cmd;
  return `${cmd} ${testFiles.join(" ")}`;
}

// skills/src/shared/write-steps.ts
var HEREDOC_TERMINATOR = "DATUM_WRITE_EOF";
var q3 = (s) => `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
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
  const write = body === "" ? `: > ${q3(o.path)}` : `cat > ${q3(o.path)} <<'${HEREDOC_TERMINATOR}'
${body.slice(0, -1)}
${HEREDOC_TERMINATOR}`;
  return [
    { name: names.mkdir, command: `mkdir -p ${q3(dir)}` },
    { name: names.write, command: write },
    { name: names.sha, command: `git hash-object ${q3(o.path)}`, tolerant: true }
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

// skills/src/shared/schemas.ts
var STAGE_RESULT_SCHEMA = {
  type: "object",
  properties: {
    files_written: { type: "array", items: { type: "string" } },
    success: { type: "boolean" },
    tests_pass: { type: "boolean" },
    test_exit_code: { type: "number" },
    test_errors: { type: "array", items: { type: "string" } },
    test_output: { type: "string" },
    committed: { type: "boolean" },
    commit_sha: { type: "string" },
    failure_reason: { type: "string" },
    // #356: structured GREEN block — {status:"blocked", needs_write:[paths], reason}
    status: { type: "string", enum: ["ok", "blocked"] },
    needs_write: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
    // Blob-sha prefix of every deferred file the agent was told to read (assertReadWitness).
    read_witness: { type: "object", additionalProperties: { type: "string" } }
  },
  required: ["success", "tests_pass", "committed"]
};
var REFLECT_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    gaps: { type: "array", items: { type: "string" } },
    score: { type: "number" },
    // Blob-sha prefix of every deferred file the agent was told to read (assertReadWitness).
    read_witness: { type: "object", additionalProperties: { type: "string" } }
  },
  required: ["reasoning", "score"]
};
var SKEPTIC_SCHEMA = {
  type: "object",
  properties: {
    bugs_found: { type: "array", items: {
      type: "object",
      properties: {
        description: { type: "string" },
        evidence: { type: "string" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] }
      },
      required: ["description", "evidence", "severity"]
    } },
    confidence: { type: "number" },
    verdict: { type: "string", enum: ["PASS", "FRAGILE", "BROKEN"] },
    // Blob-sha prefix of every deferred file the agent was told to read (assertReadWitness).
    read_witness: { type: "object", additionalProperties: { type: "string" } }
  },
  required: ["bugs_found", "confidence", "verdict"]
};
var REFACTOR_CHECK_SCHEMA = {
  type: "object",
  properties: {
    should_refactor: { type: "boolean" },
    reason: { type: "string" }
  },
  required: ["should_refactor"]
};

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- Test command comes from `.datum/config.json` `test_command` field \u2014 read it, don't guess\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500 lines is a review trigger: split only on a real functional seam, never to hit a number\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (from `.datum/config.json`)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Context Budget\n- When `headroom_compress` and `headroom_retrieve` are available, use them for files over 100 lines: compress after reading, then retrieve with a targeted query when you need a section back. This is the expected path on the local-model runtime. When they are not available, read the file and move on \u2014 never block on them, never report a hash you did not produce\n";

// skills/src/prompts/red.md
var red_default = 'RED TDD agent. Write failing tests that prove the acceptance criteria are not yet implemented.\n\nFRAMEWORK DETECTION:\nBefore writing any test code, read ONE existing test file from the same directory as your target test files. Match its:\n- Import style (e.g. import XCTest vs import Testing, import pytest vs import unittest)\n- Test class/struct pattern (XCTestCase subclass vs @Test macro, etc.)\n- Assertion style (XCTAssertEqual vs #expect, assert vs self.assertEqual)\nIf no existing test files exist, fall back to the test_framework field in the task packet.\n\nGOAL: Write one test function per acceptance criterion. Each test must FAIL when you run it \u2014 unless the LANE MODE line at the end says this is an integration lane, whose tests must PASS.\n\nAPPROACH:\n1. Read the acceptance_criteria (and red_note) from the lane spec file\n2. For each AC, write a test that calls the method described in the AC\n3. Assert specific expected values \u2014 not just "doesn\'t crash"\n4. Call methods that don\'t exist yet \u2014 the resulting error (AttributeError in Python, compilation error in Swift/Go, TypeError in TS) is the correct RED failure\n\nTARGET CONTEXT (import guard):\nIf the preflight output at the PREFLIGHT path below contains a target_context\nfield, read it. It lists which modules each target depends on. Only import modules listed as\ndependencies of the target your test file belongs to. DO NOT import modules from other targets.\n\nCONSTRAINTS:\n- Append new test functions to existing test files. Existing tests stay as they are, with ONE exception below.\n- STALE OWNED ASSERTIONS (stale_owned_test): when an existing test in one of YOUR test files (the OWNED list below) pins behaviour that this lane\'s acceptance criteria supersede \u2014 an exact-shape `toEqual` on a model this lane extends, a fixture or precondition this lane\'s ACs change, a value the AC now defines differently \u2014 amend that assertion in the same RED commit so it states the NEW contract (prefer `toMatchObject`/partial matches over widening to "anything"). Name each amended test in test_output as `amended: <test name> \u2014 superseded by <AC id>`. GREEN is forbidden from touching test files, so an assertion you leave stale deadlocks the lane: GREEN\'s correct implementation fails the old test.\n- Never delete or weaken a test that is not contradicted by an acceptance criterion of THIS lane; tests in files you do not own are off-limits even when they are stale (report them in failure_reason as `stale_foreign_test: <file>:<line>` and continue).\n- Only write and commit the test files in the OWNED list below.\n- OFF-LIMITS: Do NOT write any file that is not in the OWNED list. Production implementation files, skeleton stubs, and non-test code are prohibited. Example of a prohibited write: NoOpPermissionService.swift \u2014 this is a production implementation file, not a test file. If it is not a test file, do not write it.\n\nBANNED PATTERNS (any of these = pipeline rejection, no exceptions):\n- Python: `assert True`, `assert 1`, `assert not False`, `pass` as only body, `raise NotImplementedError`\n- Swift: `XCTFail()` as only assertion, empty test body, `fatalError()`\n- Go: `t.Fatal("not implemented")`, `panic("not implemented")`, empty test body\n- TS/JS: `expect(true).toBe(false)`, `throw new Error("not implemented")`, empty test body\n- `assert x is not None` / trivial nil-checks as the ONLY assertion\nEach test MUST assert a specific expected value or exception type.\n- Never assert on the text of the lane\'s own source files (`expect(source).toContain(...)` / `.not.toContain(...)` against an implementation file you or a later stage will write). Assert behaviour, not spelling \u2014 a rename or reformat should not break the test.\n- Never read back a set-only accessor or a write-only property to observe a value it never exposes. Assert against something the code under test actually returns or has an observable effect on.\n- Never read pipeline state under the repository\'s own `.datum/` (lane-spec.json, pipeline-state.json, a run directory). It exists only in this worktree while the pipeline runs; a test that reads it passes here and fails everywhere else. Build the input in a temporary directory instead.\n\nVERIFY BEFORE RUNNING TESTS:\nRun the command given as COUNT below to grep your test file(s) for new test functions.\nConfirm you have at least one new test function per AC. If any AC lacks a test, go back and write it before proceeding.\n\nSELF-CHECK (mandatory before running tests):\n- Count how many functions matching the COUNT command\'s pattern exist in each test file BEFORE your edits\n- Count how many exist AFTER your edits\n- The count MUST increase by at least len(acceptance_criteria) new functions\n- If count did not increase, you FAILED \u2014 do not proceed, report success=false with failure_reason="no_new_tests_written"\n- Include both counts in test_output: "Before: N tests, After: M tests, New: M-N"\n\nAFTER WRITING:\n1. Run the suite with exactly the command given as RUN below.\n   It writes the full output to a log file, prints the last 50 lines and then `TEST_EXIT=<code>` \u2014 that code is the real exit status. Never run the configured test command through a pipe into tail or grep: a pipe masks the exit code. Report the printed output in test_output (last 50 lines max) and TEST_EXIT in test_exit_code.\n2. Your new tests MUST fail. Report tests_pass=false and the exit code.\n3. Commit with exactly the command given as COMMIT below \u2014 it pins the datum author identity and the Datum-Run/Datum-Lane/Datum-Stage trailers every lane commit carries. Do not change the subject or author.\n4. Report the commit SHA in commit_sha.\n\nINPUTS\nWORKTREE: cd into {{wt}}\nSETUP: run {{skeletonCmd}} then {{redCtxCmd}}\nPREFLIGHT: .datum/runs/*/preflight-{{taskId}}.json\nTASK PACKET: {{redPacketStr}}\nOWNED: {{testFilesList}}\nCOUNT: grep -c \'{{testFuncPattern}}\' {{testFilesList}}\nRUN: {{testRunCmd}}\nCOMMIT: git -C "{{wt}}" add {{testFilesList}} && {{commitCmd}}\nLANE MODE (empty for a task lane; an integration lane\'s tests must PASS, see GOAL):\n{{integrationNote}}\nLANE SPEC FILE \u2014 the acceptance_criteria, red_note and contract_summary for this task are in the file named by the packet\'s lane_spec_file, not in the packet:\n{{laneSpecSlot}}\n';

// skills/src/prompts/red-retry.md
var red_retry_default = `RED TDD agent \u2014 RETRY. A previous attempt at this lane failed; the reason is given as PREVIOUS FAILURE below.

Start from a clean worktree: run the command given as RESET below.

Write simple, concrete tests. One test per acceptance criterion. Assert specific values.
Call methods that don't exist yet \u2014 the language's missing-method error (AttributeError, TypeError, compilation error, etc.) is your RED signal.
NEVER use hardcoded failure stubs (raise NotImplementedError, fatalError, panic) \u2014 test fixtures may auto-skip them.

Only write and commit the test files in the OWNED list below. OFF-LIMITS: Do NOT write any file that is not in the OWNED list. Production implementation files, skeleton stubs, and non-test code are strictly prohibited (e.g., NoOpPermissionService.swift is a production impl file \u2014 do not write it).

AFTER WRITING:
1. Run the suite with exactly the command given as RUN below.
   Read the real exit status from the printed TEST_EXIT line (the suite output is written to a log file and TEST_EXIT is the real exit code \u2014 never pipe the test command into tail or grep, a pipe masks the exit code). Tests must fail. Report tests_pass=false and test_exit_code.
2. Commit with exactly the command given as COMMIT below (datum author identity + Datum-* trailers); do not change the subject or author.
3. Report commit_sha.

INPUTS
PREVIOUS FAILURE: {{failureReason}}
RESET: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/
SETUP: {{redCtxCmd}}
TASK PACKET: {{redPacketStr}}
OWNED: {{testFilesList}}
RUN: {{testRunCmd}}
COMMIT: git -C "{{wt}}" add {{testFilesList}} && {{commitCmd}}
LANE SPEC FILE \u2014 the acceptance_criteria, red_note and contract_summary for this task are in the file named by the packet's lane_spec_file, not in the packet:
{{laneSpecSlot}}
`;

// skills/src/prompts/green.md
var green_default = 'GREEN TDD agent. Make the failing tests pass with minimum implementation code.\n\nAPPROACH:\n1. Read test_signal carefully \u2014 each error tells you exactly what to implement\n2. Read the existing implementation files in your allowed list \u2014 extend what is there, do not replace it\n3. Implement only what the errors require\n\nTARGET CONTEXT (import guard):\nIf target_context is present in the task packet, only use imports that are valid for the target.\nCheck the dependency list before adding any import statement. DO NOT import modules that are\nnot listed as dependencies of the target you are implementing in.\n\nPACKET FIELDS:\n- test_signal: error messages from failing tests \u2014 your implementation spec\n- lane_spec_file: the worktree file holding acceptance_criteria, red_note and contract_summary (function signatures extracted from the criteria)\n\nCONSTRAINTS:\n- Only write and commit the implementation files listed as ALLOWED below\n- Never edit, delete or `git add` a test file, and never `git commit --amend` or rewrite the RED commit: a GREEN commit whose diff touches a test file fails the lane as green_edited_tests. If a test is wrong, report it in failure_reason instead of changing it.\n- If making tests pass requires modifying files outside ALLOWED (e.g. the RED test calls an existing class/function with arguments its current signature rejects, and that definition is outside your allowed files), do NOT write those files and do NOT keep retrying. Return the structured blocked result: {"success": false, "tests_pass": false, "committed": false, "status": "blocked", "needs_write": ["<repo-relative path>", ...], "reason": "<which test, which symbol, why it cannot pass within the allowed files>"}. The orchestrator turns this into a single lead-approval question (or auto-widens in yolo mode) \u2014 one honest blocked result beats three blind attempts.\n- Package.swift changes are FORBIDDEN in behavioral lanes. If a new dependency is needed, report scope_exceeded with \'Package.swift\' and a description of the required dependency.\n- For Swift: target-scoped test command (with --filter) is already provided. Do NOT run a broader test command that compiles unrelated targets.\n\nAFTER WRITING:\n1. Run the suite with exactly the command given as RUN below.\n   Read the real exit status from the printed TEST_EXIT line (the suite output is written to a log file and TEST_EXIT is the real exit code \u2014 never pipe the test command into tail or grep, a pipe masks the exit code). ALL tests must pass (TEST_EXIT=0). Report tests_pass and test_exit_code from it.\n2. Commit with exactly the command given as COMMIT below \u2014 it pins the datum author identity and the Datum-Run/Datum-Lane/Datum-Stage trailers every lane commit carries. Do not change the subject or author.\n3. Report commit_sha.\n\nINPUTS\nSETUP (run first): {{greenCtxCmd}}\nTASK PACKET: {{greenPacketStr}}\nALLOWED: {{implFilesList}}\nRUN: {{testRunCmd}}\nCOMMIT: git -C "{{wt}}" add {{implFilesList}} && {{commitCmd}}\nLANE SPEC FILE \u2014 the acceptance_criteria, red_note and contract_summary for this task are in the file named by the packet\'s lane_spec_file, not in the packet:\n{{laneSpecSlot}}\n';

// skills/src/prompts/green-retry.md
var green_retry_default = 'GREEN TDD agent \u2014 RETRY. A previous attempt at this lane failed; the reason is given as PREVIOUS FAILURE below.\n\nStart from a clean worktree: run the command given as RESET below.\n\nRead test_signal errors carefully. Read existing implementation files first. Fix specific failures.\n\nOnly write and commit the implementation files listed as ALLOWED below.\n- Never edit, delete or `git add` a test file, and never `git commit --amend` or rewrite the RED commit: a GREEN commit whose diff touches a test file fails the lane as green_edited_tests. If a test is wrong, report it in failure_reason instead of changing it.\n- If the tests cannot pass without writing a file outside ALLOWED, do NOT write it \u2014 return {"success": false, "tests_pass": false, "committed": false, "status": "blocked", "needs_write": ["<paths>"], "reason": "<why>"} instead. One honest blocked result beats three blind attempts.\n\nAFTER WRITING:\n1. Run the suite with exactly the command given as RUN below.\n   Read the real exit status from the printed TEST_EXIT line (the suite output is written to a log file and TEST_EXIT is the real exit code \u2014 never pipe the test command into tail or grep, a pipe masks the exit code). All tests must pass (TEST_EXIT=0). Report tests_pass and test_exit_code.\n2. Commit with exactly the command given as COMMIT below (datum author identity + Datum-* trailers); do not change the subject or author.\n3. Report commit_sha.\n\nINPUTS\nPREVIOUS FAILURE: {{failureReason}}\nRESET: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/\nSETUP: {{greenCtxCmd}}\nTASK PACKET: {{greenRetryPacketStr}}\nALLOWED: {{implFilesList}}\nRUN: {{testRunCmd}}\nCOMMIT: git -C "{{wt}}" add {{implFilesList}} && {{commitCmd}}\nLANE SPEC FILE \u2014 the acceptance_criteria, red_note and contract_summary for this task are in the file named by the packet\'s lane_spec_file, not in the packet:\n{{laneSpecSlot}}\n';

// skills/src/prompts/refactor.md
var refactor_default = 'REFACTOR agent. Clean up the implementation without changing behavior.\n\nSCOPE:\n- Improve naming, reduce duplication, simplify logic, remove dead code\n- Remove machine-written tells: narrating comments that restate the code, chat phrases, emoji, placeholder stubs, generic names (process_data), abstractions with one caller, tutorial shape where a plain if/else does the job\n- Match the level the surrounding code operates at. Do not add a check, a comment, a type annotation or a layer the neighboring code would not have; trying to look careful is its own tell\n- Write to allowed files only\n\nCONSTRAINTS:\n- Tests are a one-way ratchet: do not remove, skip, weaken, or disable any test\n- Do not add new features \u2014 only improve existing code\n\nAFTER WRITING:\n1. Run the suite with exactly the command given as RUN below.\n   Read the real exit status from the printed TEST_EXIT line (the suite output is written to a log file and TEST_EXIT is the real exit code \u2014 never pipe the test command into tail or grep, a pipe masks the exit code). Every test must still pass (TEST_EXIT=0). Report tests_pass and test_exit_code.\n2. If tests pass: commit with exactly the command given as COMMIT below \u2014 same datum author identity and Datum-Run/Datum-Lane/Datum-Stage trailers as the RED and GREEN commits on this branch, so a later reader can attribute it to this lane instead of mistaking it for a stray concurrent writer. Do not change the subject or author.\n3. If tests FAIL: report tests_pass=false, do NOT commit. Report failure_reason.\n\nINPUTS\nSETUP (run first): {{refactorCtxCmd}}\nTASK PACKET: {{refactorPacketStr}}\nALLOWED: {{allFilesList}}\nRUN: {{testRunCmd}}\nCOMMIT: git -C "{{wt}}" add {{allFilesList}} && {{commitCmd}}\nSCANNER FINDINGS on the lines this lane added (remove every one, or mark a deliberate line `unslop-ignore`):\n{{tellsSlot}}\n';

// skills/src/prompts/structural.md
var structural_default = 'STRUCTURAL agent. Produce every deliverable file of a structural lane, then commit.\n\nA structural lane has no testable behaviour: its deliverable is documentation (an ADR, a decision record, a README section), configuration, or a file move. The lane is decided by the files, not by your report: after you finish, the runner checks that every file listed as ALLOWED exists in the worktree and that a commit past the epic branch touches them. A lane with a missing file fails by name, whatever the result says.\n\nSCOPE:\n- Write every file listed as ALLOWED. A file that already satisfies its criteria is left as it is\n- Read the lane spec file named in the packet first; its acceptance criteria decide the content. Read the files the criteria cite (SPEC.md, QUESTIONS.md, existing docs) so the deliverable records the decision actually made\n- Write to allowed files only\n\nCONSTRAINTS:\n- Do not write tests and do not run the test suite: there is nothing to test. Report tests_pass=true and test_exit_code=0 to say the stage has no suite\n- Do not add code, and do not change files outside ALLOWED, even to "fix" something you notice\n- A criterion that cannot be met from the files you can read: write what can be decided, do not commit, report success=false with failure_reason naming the criterion and the file that would settle it\n\nAFTER WRITING:\n1. Confirm every file listed as ALLOWED exists (`ls` each path).\n2. Commit with exactly the command given as COMMIT below \u2014 same datum author identity and Datum-Run/Datum-Lane/Datum-Stage trailers as every lane commit, so a later reader attributes it to this lane. Do not change the subject or author.\n3. Report success=true, committed=true, commit_sha, and files_written listing every file you wrote.\n\nINPUTS\nSETUP (run first): {{structuralCtxCmd}}\nTASK PACKET: {{structuralPacketStr}}\nALLOWED: {{allFilesList}}\nCOMMIT: git -C "{{wt}}" add {{allFilesList}} && {{commitCmd}}\n';

// skills/src/prompts/reflect.md
var reflect_default = 'TEST QUALITY evaluator. Read the test files and assess coverage of the acceptance criteria.\nRead-only \u2014 do NOT write or modify any files.\n\nSCOPE \u2014 one rule for prior-lane tests. A test file may hold tests from prior lanes: test functions that do not relate to any of the acceptance criteria below. Those tests neither count for nor against the score \u2014 score only the test functions whose names and assertions directly relate to the criteria. But you must still read every prior-lane test in these files, because a prior-lane assertion this lane\'s criteria contradict is the one thing that can deadlock this lane, and finding it is step 4 below.\n\nEVALUATE:\n1. For each AC, identify which test function covers it (cite the function name)\n2. Check assertion strength: does each test assert specific values, not just "no error"?\n3. Identify gaps: ACs with no test, tests with weak assertions, missing negative/edge cases\n4. STALE OWNED ASSERTIONS: for each AC, look for an EXISTING test in these files whose assertion the AC contradicts (an exact-shape equality on a model the AC extends, a fixture order or precondition the AC changes, a value the AC redefines). RED was allowed to amend those; one left standing will fail GREEN\'s correct implementation, since GREEN may not touch tests. Report each as a gap prefixed `stale_owned_test: <test name> contradicts <AC id>` \u2014 this is a gap even when every AC has a strong new test.\n5. List each gap found\n\nSCORING RUBRIC \u2014 this is the only rubric; a lane fails below 4, so nothing else sets the boundaries:\n- 9-10: Every AC has a strong test with specific assertions\n- 7-8: All ACs covered but some assertions could be stronger\n- 5-6: Most ACs covered, 1-2 gaps\n- 3-4: Significant gaps \u2014 multiple ACs untested or only smoke-tested\n- 1-2: Tests exist but barely cover the ACs\n- 0: No meaningful test coverage\n\nReturn reasoning FIRST (with evidence), then gaps, then score.\n\nINPUTS\nRead these test files in "{{wt}}": {{testFiles}}\nACCEPTANCE CRITERIA to cover \u2014 the `acceptance_criteria` array in the lane spec file:\n{{laneSpecSlot}}\n';

// skills/src/prompts/skeptic-base.md
var skeptic_base_default = "Adversarial code reviewer. Find bugs the test suite misses.\n\nTOOLS (use before manual reading):\n- `ast-grep --pattern '<pattern>' <file>` \u2014 find structural anti-patterns:\n   - Unchecked return values: `ast-grep --pattern '$_ = $F($$$)' <file>` then check if result is used\n   - Bare exception handlers that swallow errors (Python: `except: pass`, Swift: empty `catch {}`, Go: ignoring `err`, TS: empty `catch {}`):\n     `ast-grep --pattern 'except: pass' <file>` (Python), `ast-grep --pattern 'catch { }' <file>` (Swift/TS)\n\nRead the implementation and tests. Run the test command to understand current coverage.\nOnly report bugs you can demonstrate with evidence. \"This might be a problem\" is not a bug.\n\nLeave the worktree exactly as you found it: do not create files in it. Reproduce a finding with an inline command (`python -c`, `node -e`, a heredoc piped to the interpreter) and quote that command as the evidence. Any file you leave behind is removed before the next stage and reported as `stray_untracked_files`; a repro test file left under tests/ was collected by the next stage's suite and failed a sound lane.\n\nEvery bug you report is one object: description, evidence, severity \u2014 what is wrong, the specific input, file or line that demonstrates it, and one of critical / high / medium / low. That is the whole output shape; the lens at the end of this prompt tells you where to look, not what to return.\n\nINPUTS\nWorking directory: \"{{wt}}\"\nImplementation files: {{implFiles}}\nTest files: {{testFiles}}\nTest command: {{testCommand}}\nAcceptance criteria \u2014 the `acceptance_criteria` array in the lane spec file:\n{{laneSpecSlot}}\nProperties \u2014 the invariant reference for this epic (reason against these too, not only the acceptance criteria above):\n{{propertiesSlot}}\n";

// skills/src/prompts/skeptic-edge.md
var skeptic_edge_default = "LENS: Edge cases.\nTest these inputs against the implementation:\n- Empty inputs, None/null values, single-element collections\n- Boundary values (0, -1, max int, empty string)\n- Off-by-one errors in loops and ranges\n";

// skills/src/prompts/skeptic-error.md
var skeptic_error_default = "LENS: Error paths.\nCheck these failure modes against the implementation:\n- What happens when preconditions are violated?\n- Are exceptions caught and handled, or do they propagate silently?\n- Are there state transitions that can reach invalid states?\n";

// skills/src/prompts/skeptic-contract.md
var skeptic_contract_default = "LENS: Behavioral contracts.\nCompare implementation behavior against the acceptance criteria:\n- Does the implementation satisfy the AC intent, not just the specific test inputs?\n- Are there inputs that satisfy the AC literally but produce wrong results?\n- Do the tests only cover the happy path while the AC implies broader coverage?\n- Evidence for this lens names the AC and a concrete input that exposes the gap\n";

// skills/src/prompts/refactor-check.md
var refactor_check_default = 'CODE QUALITY gate. Decide if the implementation needs refactoring \u2014 be conservative.\nRead-only \u2014 do NOT write or modify any files.\n\nReturn should_refactor=true ONLY if you find one of these concrete problems:\n- Duplicated logic (same code block copy-pasted in 2+ places)\n- Function longer than 50 lines that could be split at a clear seam\n- Dead code introduced by this task (unused imports, unreachable branches)\n- Misleading names that contradict what the code does, or generic names (process_data, handle_item) that hide what a function does\n- Tutorial-shaped code: sample-app structure, dummy data, or a textbook pattern where a plain if/else does the job\n- An abstraction with one caller: an interface, factory, wrapper or helper introduced for a single use\n- Code that ignores the surrounding module: a new way to log, validate, name or structure things next to code that already does it one way\n- Narrating comments that restate the next line or walk through steps ("# Step 1", "// Now we ...")\n\nDo NOT flag: defensive checks or validation (the data does not support them as a tell, and half the complaints run the other way), log lines, single variable names, blank lines, import order, missing docstrings or type hints.\nIf the code works, reads clearly, and matches the level of the code around it, return should_refactor=false.\n\nIf should_refactor=true, the reason must name the specific file and problem.\n\nINPUTS\nRead these files in "{{wt}}": {{allFiles}}\nSCANNER FINDINGS on the lines this lane added (deterministic; each is a real problem the refactor must remove):\n{{tellsSlot}}\n';

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function withLaneSpec(template, vars, laneSpec) {
  return PREAMBLE + renderPrompt(template, { ...vars, laneSpecSlot: contextSlot(laneSpec) }) + contextWitnessInstruction([laneSpec]);
}
function redPrompt(vars) {
  const { laneSpec, integrationNote, ...rest } = vars;
  return withLaneSpec(red_default, { ...rest, integrationNote: integrationNote ?? "" }, laneSpec);
}
function redRetryPrompt(vars) {
  const { laneSpec, ...rest } = vars;
  return withLaneSpec(red_retry_default, rest, laneSpec);
}
function greenPrompt(vars) {
  const { laneSpec, ...rest } = vars;
  return withLaneSpec(green_default, rest, laneSpec);
}
function greenRetryPrompt(vars) {
  const { laneSpec, ...rest } = vars;
  return withLaneSpec(green_retry_default, rest, laneSpec);
}
function refactorPrompt(vars) {
  return PREAMBLE + renderPrompt(refactor_default, vars);
}
function structuralPrompt(vars) {
  return PREAMBLE + renderPrompt(structural_default, vars);
}
function reflectPrompt(vars) {
  const { laneSpec, ...rest } = vars;
  return withLaneSpec(reflect_default, rest, laneSpec);
}
function skepticBasePrompt(vars) {
  const { laneSpec, properties, ...rest } = vars;
  const propertiesSlot = properties ? contextSlot(properties) : "PROPERTIES.md does not exist for this epic (no Properties phase ran) \u2014 reason only against the acceptance criteria above.";
  const deferred = [laneSpec, ...properties && !properties.inlined ? [properties] : []];
  return PREAMBLE + renderPrompt(skeptic_base_default, { ...rest, laneSpecSlot: contextSlot(laneSpec), propertiesSlot }) + contextWitnessInstruction(deferred);
}
function skepticLenses() {
  return [
    { key: "edge", model: model("fast"), prompt: skeptic_edge_default },
    { key: "error", model: model("fast"), prompt: skeptic_error_default },
    { key: "contract", model: model("balanced"), prompt: skeptic_contract_default }
  ];
}
function refactorCheckPrompt(vars) {
  return PREAMBLE + renderPrompt(refactor_check_default, vars);
}

// skills/src/datum-tdd-act-lane.ts
var a = args;
var { batchLaneIds, lanePlan, worktreePaths, cfg, priorFailures, priorCompleted, batchTag } = a;
configureAgentTypes(cfg.agentTypes || {});
setBatchCacheKey(cfg.configFingerprint || "");
setBatchRoot(cfg.repoRoot || "");
async function verifyFileOwnership2(taskId, wt, stage, allowedFiles, forbiddenFiles, since) {
  const steps = ownershipCheckSteps(wt, since);
  const result = await runBatch(steps, stageOpts("cli", { label: `ownership-check:${taskId}:${stage}`, phase: "Act", model: model("fast") }));
  if (result.missing) {
    return {
      ok: false,
      checkFailed: true,
      violations: [`ownership_check_failed: ownership-check batch returned no result for ${stage} on ${taskId} (${describeFailure(result, "ownership-check")})`]
    };
  }
  const step = stepResult(result, "ownership");
  if (!step || step.exit_code !== 0) {
    return {
      ok: false,
      checkFailed: true,
      violations: [`ownership_check_failed: git diff exited ${step ? step.exit_code : "without running"} for ${stage} on ${taskId}: ${(step && (step.stderr || step.stdout) || "").trim().split("\n").slice(-3).join(" | ")}`]
    };
  }
  const verdict = ownershipFromStdout(stepStdout(result, "ownership"), allowedFiles, forbiddenFiles);
  return verdict.ok ? verdict : { ...verdict, checkFailed: verdict.violations.some((v) => v.startsWith("ownership_check_failed")) };
}
async function witnessedAgent(prompt, opts, specFile, stage) {
  const result = await resilientAgent(prompt, opts);
  if (result !== null) assertStageWitness(specFile, result, stage);
  return result;
}
function assertStageWitness(specFile, parsed, stage) {
  try {
    const verdict = assertReadWitness([specFile], parsed);
    if (verdict.nearMiss.length > 0) log(`read_witness_near_miss: ${stage} cited a witness whose leading hex matches ${verdict.nearMiss.join(", ")} but diverges after the proof \u2014 accepted (transcription slip after a genuine read)`);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    err.stage = stage;
    throw err;
  }
}
async function runLane(taskId, lanePlan2, worktreePaths2, cfg2) {
  const lane = lanePlan2.lanes[taskId];
  const wt = worktreePaths2[taskId];
  if (!wt || typeof wt !== "string" || !wt.startsWith("/")) {
    return {
      task_id: taskId,
      status: "failed",
      stage: "CRASH",
      error: `no worktree path for ${taskId} (setup returned ${JSON.stringify(wt)}) \u2014 refusing to run outside an isolated worktree`
    };
  }
  const issueId = getIssueId(lanePlan2, taskId);
  const runId = cfg2.runId;
  const isStructural = lane.kind === "structural";
  const isIntegration = lane.kind === "integration";
  if (isIntegration && !lane.expect_tests_pass) {
    log(`[${taskId}] integration lane disagreement: kind is 'integration' but expect_tests_pass is missing/false \u2014 kind is authoritative, taking the RED-only fast path anyway`);
  }
  const { testFiles, implFiles } = classifyFiles(lane.files);
  const laneTestCmd = cfg2.testCommand;
  const laneCfg = { ...cfg2, testCommand: laneTestCmd };
  const laneFiles = [...testFiles, ...implFiles];
  const laneLanguage = laneFiles.some((f) => /\.(ts|tsx)$/.test(f)) ? "typescript" : laneFiles.some((f) => /\.(js|jsx|mjs)$/.test(f)) ? "javascript" : laneFiles.some((f) => /\.go$/.test(f)) ? "go" : laneFiles.some((f) => /\.swift$/.test(f)) ? "swift" : laneFiles.some((f) => /\.py$/.test(f)) ? "python" : cfg2.language;
  const swiftTargetFilter = laneLanguage === "swift" ? (() => {
    const swft = implFiles[0];
    if (swft) {
      const parts = swft.split("/");
      const sourcesIdx = parts.indexOf("Sources");
      if (sourcesIdx >= 0 && parts[sourcesIdx + 1]) {
        return `--filter ${parts[sourcesIdx + 1]}`;
      }
    }
    return null;
  })() : null;
  const scopedTestCmd = typeof lane.test_command === "string" && lane.test_command.trim() ? lane.test_command.trim() : swiftTargetFilter ? `${cfg2.testCommand} ${swiftTargetFilter}` : cfg2.testCommand;
  const scopedLaneCfg = { ...cfg2, testCommand: scopedTestCmd };
  const testFuncDiffRegex = laneLanguage === "swift" ? "[+][[:space:]]*(@Test|func test)" : laneLanguage === "go" ? "[+][[:space:]]*func Test" : laneLanguage === "typescript" || laneLanguage === "javascript" ? "[+][[:space:]]*(it\\(|test\\(|describe\\()" : "[+][[:space:]]*(def test_|async def test_|@pytest\\.mark\\.parametrize\\(|@given\\()";
  const testFuncGrepRegex = laneLanguage === "swift" ? "@Test|func test" : laneLanguage === "go" ? "func Test" : laneLanguage === "typescript" || laneLanguage === "javascript" ? "it\\(|test\\(|describe\\(" : "def test_|async def test_|@pytest\\.mark\\.parametrize\\(|@given\\(";
  const testFuncBodyRegex = laneLanguage === "swift" ? "func test" : laneLanguage === "go" ? "func Test" : "def test_";
  const completionPath = runId ? `.datum/runs/${runId}/lane-state/${taskId}.json` : null;
  const deterministic = deterministicChecks();
  if (completionPath && !deterministic) {
    const completionExist = await agent(
      `Read the file at "${completionPath}" with the Read tool.
If the file exists, return ONLY its raw contents (valid JSON).
If the file does not exist or is empty, return exactly: MISSING
No markdown fences, no explanation.`,
      stageOpts("reader", { label: `completion-check:${taskId}`, phase: "Act", model: model("fast") })
    );
    if (completionExist && completionExist.trim() !== "MISSING") {
      const compData = parseAgentJson(completionExist, {});
      if (compData.task_id === taskId) {
        log(`[${taskId}] lane already completed in a prior run \u2014 skipping`);
        return { task_id: taskId, status: "skipped", stage: "SKIPPED", error: "cross-run completion: lane was completed in a previous run" };
      }
    }
  }
  log(`[${taskId}] Starting: ${lane.title} (${isStructural ? "structural" : "behavioral"}, ${testFiles.length} test, ${implFiles.length} impl)`);
  const scriptTestPattern = /\.(test|spec)\.(ts|js|tsx|jsx)$|(^|\/)test_.*\.py$/;
  const cleanupCmd = testFiles.some((f) => scriptTestPattern.test(f)) ? `datum lane-cleanup "${wt}" ${testFiles.map((f) => `--allowed "${f.replace(/"/g, '\\"')}"`).join(" ")}` : null;
  const skeletonCmd = `datum skeleton --task-id ${taskId} --language ${laneLanguage} --tasks ${cfg2.lanePlanPath} --output .datum/runs/${cfg2.runId}/preflight-${taskId}.json`;
  const preflightPath = `.datum/runs/${cfg2.runId}/preflight-${taskId}.json`;
  const planSkeletonPath = cfg2.skeletonDir ? `${cfg2.skeletonDir}/preflight-${taskId}.json` : "";
  const intakeSteps = laneIntakeSteps({
    wt,
    epicBranch: cfg2.epicBranch,
    completionPath: deterministic ? completionPath : null,
    structural: isStructural,
    cleanupCmd,
    planSkeletonPath,
    skeletonCmd,
    preflightPath,
    laneSpec: { planPath: `${wt}/.datum/lane-plan.json`, taskId, outPath: `${wt}/.datum/lane-spec.json`, expectHash: digestSpecHash(lanePlan2, taskId) },
    // #493 — the skeptic panel reasons against PROPERTIES.md (FLOW.md's Act
    // handoff); folded into this one intake batch rather than a second
    // command-runner call. propertiesFromSteps() returns null when the epic
    // has no Properties phase, which the panel's prompt turns into a
    // one-line sentence instead of a Read instruction.
    properties: { epicBranch: cfg2.epicBranch }
  });
  const intakeRaw = await runBatch(intakeSteps, stageOpts("cli", { label: `lane-intake:${taskId}`, phase: "Act", model: model("fast") }));
  const intakeResult = intakeRaw;
  const intake = intakeResult;
  if (intake.missing || stepStdout(intake, "history") === null) {
    const why = describeFailure(intake, "lane intake");
    log(`[${taskId}] LANE INTAKE FAILED: ${why} \u2014 cannot read the lane's history; refusing to dispatch RED`);
    return { task_id: taskId, status: "failed", stage: "UNKNOWN", error: `lane_intake_failed: ${why}` };
  }
  if (deterministic && completionPath) {
    const completionExist = stepStdout(intake, "completion");
    if (!isMissing(completionExist)) {
      const compData = parseAgentJson(completionExist || "", {});
      if (compData.task_id === taskId) {
        log(`[${taskId}] lane already completed in a prior run \u2014 skipping`);
        return { task_id: taskId, status: "skipped", stage: "SKIPPED", error: "cross-run completion: lane was completed in a previous run" };
      }
    }
  }
  const spec = laneSpecFromSteps(intakeResult, taskId, `${wt}/.datum/lane-spec.json`);
  if (!spec.ok || !spec.spec) {
    log(`[${taskId}] LANE SPEC EXPORT FAILED: ${spec.error}`);
    return { task_id: taskId, status: "failed", stage: "CRASH", error: spec.error };
  }
  const specFile = laneSpecContextFile(spec.spec);
  const propertiesFile = propertiesFromSteps(intake, cfg2.epicBranch, wt);
  const laneHistoryRaw = stepStdout(intake, "history");
  const existing = detectExistingLaneCommits(laneHistoryRaw || "", taskId);
  let { hasRed: redAlreadyCommitted, hasGreen: greenAlreadyCommitted } = existing;
  if (redAlreadyCommitted && existing.redSpec && existing.redSpec !== spec.spec.spec_hash) {
    const redSha = ((laneHistoryRaw || "").split("\n").find((l) => l.includes(`red(${taskId}): RED complete`)) || "").split(" ")[0];
    log(`[${taskId}] red_spec_stale: ${taskId} \u2014 RED commit ${redSha} was made under spec ${existing.redSpec}, the plan now hashes to ${spec.spec.spec_hash}; resetting to ${cfg2.epicBranch} and re-running RED`);
    const specResetSteps = worktreeResetToSteps(wt, cfg2.epicBranch);
    const specReset = worktreeResetToFromSteps(
      await runBatch(specResetSteps, stageOpts("cli", { label: `red-spec-reset:${taskId}`, phase: "Act", model: model("fast") })),
      cfg2.epicBranch
    );
    if (!specReset.ok) {
      return { task_id: taskId, status: "failed", stage: "UNKNOWN", error: `lane_intake_failed: red_spec_stale but could not reset the worktree to ${cfg2.epicBranch} (${specReset.error})` };
    }
    redAlreadyCommitted = false;
    greenAlreadyCommitted = false;
  }
  let greenStaleHint = null;
  if (isStructural) {
    const r = await runStructural(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg, specFile);
    if (!r.verified) return { task_id: taskId, status: "failed", stage: "REFACTOR", error: r.error || "structural stage failed" };
    await updateStage(issueId, "done");
    return { task_id: taskId, status: "completed", stage: "REFACTOR" };
  }
  if (redAlreadyCommitted && greenAlreadyCommitted) {
    const intakeVerifySteps = laneIntakeSteps({
      wt,
      epicBranch: cfg2.epicBranch,
      completionPath: null,
      structural: true,
      cleanupCmd: null,
      planSkeletonPath: "",
      skeletonCmd: "",
      preflightPath: "",
      verifyTestCmd: scopedTestCmd
    });
    const intakeVerifyRaw = await runBatch(intakeVerifySteps, stageOpts("cli", { label: `lane-intake-verify:${taskId}`, phase: "Act", model: model("fast") }));
    const intakeVerify = intakeVerifyRaw;
    const intakeVerifyExit = testExitCode(stepStdout(intakeVerify, "test-verify"));
    const intakeEnvMissing = testEnvMissing(stepStdout(intakeVerify, "test-verify"));
    if (intakeEnvMissing) {
      log(`[${taskId}] test_env_missing: ${intakeEnvMissing}`);
      return { task_id: taskId, status: "failed", stage: "UNKNOWN", error: `test_env_missing: ${intakeEnvMissing} \u2014 the lane worktree has no test environment (dependencies not linked/installed); no verdict on the committed GREEN` };
    }
    if (intakeVerifyExit === null) {
      const why = describeFailure(intakeVerify, "lane intake verify");
      log(`[${taskId}] LANE INTAKE VERIFY FAILED: ${why} \u2014 cannot confirm the existing GREEN commit passes the suite; refusing to assume it does`);
      return { task_id: taskId, status: "failed", stage: "UNKNOWN", error: `lane_intake_failed: intake-verify step did not run (${why})` };
    }
    if (intakeVerifyExit === 0) {
      log(`[${taskId}] RED and GREEN commits already exist on lane branch \u2014 lane already satisfied, resuming from REFACTOR (#331)`);
      const r = await runRefactor(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg, specFile, []);
      if (!r || !r.verified) return { task_id: taskId, status: "failed", stage: "REFACTOR", error: r?.error || "refactor failed" };
      await updateStage(issueId, "done");
      return { task_id: taskId, status: "completed", stage: "REFACTOR" };
    }
    greenStaleHint = `green_stale: GREEN commit(s) on the lane branch do not pass the suite (independent exit=${intakeVerifyExit}) \u2014 resetting to the RED commit and resuming at GREEN`;
    log(`[${taskId}] ${greenStaleHint}`);
    const redCommitInfo = parseCommitVerification(laneHistoryRaw, "", `red(${taskId})`, "RED");
    if (!redCommitInfo.commitSha) {
      return { task_id: taskId, status: "failed", stage: "UNKNOWN", error: `lane_intake_failed: could not find the RED commit sha in lane history to reset to (${redCommitInfo.detail})` };
    }
    const resetToRedSteps = worktreeResetToSteps(wt, redCommitInfo.commitSha);
    const resetToRedResult = await runBatch(resetToRedSteps, stageOpts("cli", { label: `reset-to-red:${taskId}`, phase: "Act", model: model("fast") }));
    const resetToRed = worktreeResetToFromSteps(resetToRedResult, redCommitInfo.commitSha);
    if (!resetToRed.ok) {
      return { task_id: taskId, status: "failed", stage: "UNKNOWN", error: `lane_intake_failed: could not reset worktree to RED commit ${redCommitInfo.commitSha} (${resetToRed.error})` };
    }
    redAlreadyCommitted = true;
    greenAlreadyCommitted = false;
  }
  if (cleanupCmd) {
    log(`[${taskId}] Pre-RED cleanup completed`);
  } else {
    log(`[${taskId}] Pre-RED cleanup skipped (lane has no JS/TS/Py test files)`);
  }
  log(`[${taskId}] RED: writing failing tests`);
  let targetContext;
  let preflightRaw = null;
  if (planSkeletonPath) {
    const fromPlan = stepStdout(intake, "skeleton-plan");
    if (!isMissing(fromPlan)) {
      preflightRaw = fromPlan;
      log(`[${taskId}] using pre-generated skeleton from Plan phase`);
    }
  }
  if (!preflightRaw) {
    const generated = stepStdout(intake, "skeleton-gen");
    preflightRaw = generated && generated.trim() && generated.trim() !== "SKIPPED_PLAN_SKELETON" ? generated : null;
  }
  let preflightFramework;
  if (preflightRaw) {
    const preflightData = parseAgentJson(preflightRaw, {});
    if (preflightData.target_context) {
      targetContext = preflightData.target_context;
      log(`[${taskId}] target_context extracted: ${Object.keys(targetContext).join(", ")}`);
    }
    preflightFramework = preflightData.framework;
    if (preflightData.outputs && preflightData.outputs.length > 0) {
      const reg = preflightTestPaths(preflightData.outputs, testFiles);
      testFiles.push(...reg.registered);
      if (reg.registered.length > 0) {
        log(`[${taskId}] preflight registered ${reg.registered.length} test file(s): ${reg.registered.join(", ")}`);
      }
      if (reg.skipped.length > 0) {
        log(`[${taskId}] preflight_output_not_test: [${reg.skipped.join(", ")}] not registered as test files`);
      }
      if (testFiles.length === 0) {
        return { task_id: taskId, status: "failed", stage: "RED", error: "no_test_files: classifyFiles produced empty testFiles and preflight has no registered test paths" };
      }
    }
  }
  if (testFiles.length === 0) {
    log(`[${taskId}] ERROR: classifyFiles produced empty testFiles \u2014 lane cannot proceed without a test file to write tests against`);
    return { task_id: taskId, status: "failed", stage: "RED", error: "no_test_files: classifyFiles returned empty testFiles for lane" };
  }
  const redExtras = targetContext ? { target_context: targetContext } : {};
  const redPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, "RED", specFile, redExtras);
  const redCtxCmd = laneCtxCmd(redPacket, wt);
  const testFuncLabel = laneLanguage === "swift" ? "@Test or func test" : laneLanguage === "go" ? "func Test" : laneLanguage === "typescript" || laneLanguage === "javascript" ? "it( or test( or describe(" : "def test_";
  const promptVars = {
    wt,
    skeletonCmd,
    redCtxCmd,
    redPacketStr: JSON.stringify(redPacket),
    testCommand: scopedTestCmd,
    // #358: file-backed run, real exit status — never `cmd | tail`.
    testRunCmd: testRunCommand(scopedTestCmd, wt, "RED"),
    testFilesList: testFiles.join(" "),
    commitPrefix: redPacket.commit_prefix,
    // One commit convention for every stage (#357): datum author + Datum-* trailers.
    commitCmd: laneCommitCommand({ wt, taskId, stage: "RED", runId, specHash: spec.spec.spec_hash }),
    taskId,
    testFuncPattern: testFuncLabel,
    // Review ARCH-003: the note follows the fast path's own trigger (kind
    // alone), so a lane whose expect_tests_pass drifted still hears that
    // its tests must pass, which is how it will be judged.
    integrationNote: isIntegration && (lane.invariants || []).length > 0 ? `
This lane covers invariants: ${(lane.invariants || []).join(", ")}

The code under test is already merged: these tests must PASS on your first run; a failing test is a finding, report it, do not weaken it.` : "",
    laneSpec: specFile
  };
  let red = null;
  if (redAlreadyCommitted) {
    log(`[${taskId}] RED commit already exists on lane branch \u2014 skipping RED dispatch, resuming from GREEN (#331)`);
    const existingRedCheck = await verifyCommitIndependently(taskId, wt, testFiles, redPacket.commit_prefix, "RED", cfg2.epicBranch);
    red = {
      success: true,
      tests_pass: false,
      committed: true,
      commit_sha: existingRedCheck.commitSha,
      files_written: testFiles
    };
  } else {
    red = await witnessedAgent(
      redPrompt(promptVars),
      stageOpts("red", { label: `red:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
      specFile,
      "RED"
    );
    if (!red) {
      const redFirstFailure = "red_no_result: RED agent returned nothing (likely the maxTurns cap in agents/datum-red.md, an API error, or a skip)";
      const redResetStepList = worktreeResetSteps(wt);
      const redResetResult = await runBatch(redResetStepList, stageOpts("cli", { label: `red-reset:${taskId}`, phase: "Act", model: model("fast") }));
      const redLeftover = (stepStdout(redResetResult, "status") || "").trim();
      log(`[${taskId}] RED attempt 1: ${redFirstFailure}; worktree reset to HEAD before retry${redLeftover ? ` (WARNING: still dirty: ${redLeftover.split("\n").length} paths)` : ""}`);
      red = await witnessedAgent(
        redRetryPrompt({ ...promptVars, failureReason: redFirstFailure }),
        stageOpts("red", { label: `red-retry:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
        specFile,
        "RED"
      );
      if (!red) {
        return {
          task_id: taskId,
          status: "failed",
          stage: "RED",
          error: "red_no_result: RED agent returned nothing on both attempts (likely the maxTurns cap in agents/datum-red.md \u2014 the lane may need a smaller scope, or the cap raised)"
        };
      }
    }
    if (red?.success) {
      log(`[${taskId}] RED wrote: ${(red.files_written || []).join(", ")}`);
    }
    if (!red || !red.committed) {
      const check = await verifyCommitIndependently(taskId, wt, testFiles, redPacket.commit_prefix, "RED", cfg2.epicBranch);
      if (check.committed) {
        log(`[${taskId}] RED: agent reported committed=false but independent check confirms a commit exists (${check.detail}) \u2014 treating as committed (#274)`);
        red = {
          success: true,
          tests_pass: false,
          committed: true,
          commit_sha: check.commitSha,
          files_written: red?.files_written || testFiles,
          failure_reason: red?.failure_reason
        };
      } else {
        log(`[${taskId}] RED: agent did not commit on first attempt \u2014 retrying (independent check: ${check.detail})`);
        red = await witnessedAgent(
          redRetryPrompt({ ...promptVars, failureReason: "agent did not commit test files" }),
          stageOpts("red", { label: `red-retry:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
          specFile,
          "RED"
        );
        if (!red || !red.committed) {
          const retryCheck = await verifyCommitIndependently(taskId, wt, testFiles, redPacket.commit_prefix, "RED", cfg2.epicBranch);
          if (retryCheck.committed) {
            log(`[${taskId}] RED retry: agent reported committed=false but independent check confirms a commit exists (${retryCheck.detail}) \u2014 treating as committed (#274)`);
            red = {
              success: true,
              tests_pass: false,
              committed: true,
              commit_sha: retryCheck.commitSha,
              files_written: red?.files_written || testFiles,
              failure_reason: red?.failure_reason
            };
          } else {
            log(`[${taskId}] RED: agent did not commit after retry \u2014 failing (independent check: ${retryCheck.detail})`);
            return { task_id: taskId, status: "failed", stage: "RED", error: `RED agent did not commit after retry (independent check: ${retryCheck.detail})` };
          }
        }
      }
    }
    if (!red || !red.success) {
      log(`[${taskId}] RED attempt 1 failed: ${red?.failure_reason || "unknown"}, retrying`);
      red = await witnessedAgent(
        redRetryPrompt({ ...promptVars, failureReason: red?.failure_reason || "unknown" }),
        stageOpts("red", { label: `red-retry:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
        specFile,
        "RED"
      );
    }
  }
  if (!red || !red.success) {
    log(`[${taskId}] RED FAILED: ${red?.failure_reason || "no files written after 2 attempts"}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: red?.failure_reason || "RED failed" };
  }
  const acCount = spec.spec.ac_count;
  const SKELETON_THROW_RE = "throw new Error\\(.RED agent: implement this assertion.\\)";
  const sgPatterns = laneLanguage === "swift" ? [
    { pattern: "XCTFail", name: "XCTFail" },
    { pattern: "fatalError", name: "fatalError" }
  ] : laneLanguage === "go" ? [
    { pattern: 't.Fatal("not implemented")', name: "t.Fatal placeholder" },
    { pattern: 'panic("not implemented")', name: "panic placeholder" }
  ] : laneLanguage === "typescript" || laneLanguage === "javascript" ? [
    // The placeholder is the skeleton's own throw with its own message
    // (datum/skeleton_creator.py) — never the bare `throw new Error`
    // token, which also matched a guard clause beside real expect() calls
    // and failed a sound RED (elonchesd wf_a979f3d8-f0c task-013). The
    // earlier whole-body shapes `it($_, () => { throw new Error($_) })`
    // never matched the real skeleton under ast-grep (its `// Assert`
    // comment is a node the exact shape does not allow), which went
    // unnoticed while the grep fallback ran on every file; ast-grep
    // matches the literal statement and skips it inside strings, the
    // grep fallback matches the message.
    { pattern: "throw new Error('RED agent: implement this assertion')", name: "skeleton placeholder", grep: SKELETON_THROW_RE },
    { pattern: "expect(true).toBe(false)", name: "forced failure" }
  ] : [
    { pattern: "assert True", name: "assert True" },
    { pattern: "assert 1", name: "assert 1" },
    { pattern: "raise NotImplementedError", name: "raise NotImplementedError" }
  ];
  const integrationVerify = isIntegration ? integrationVerifyCmd(scopedTestCmd, testFiles) : scopedTestCmd;
  if (isIntegration && testFiles.length > 0 && integrationVerify === scopedTestCmd.trim()) {
    log(`[${taskId}] integration_verify_unscoped: "${scopedTestCmd}" takes no file arguments the runner knows (pytest, vitest run); the independent verify runs the whole suite, so an unrelated red will read as integration_failed`);
  }
  const postRed = postRedSteps({
    wt,
    testFiles,
    acCount,
    testFuncDiffRegex,
    sgPatterns,
    testFuncBodyRegex,
    testFuncGrepRegex,
    ownership: deterministic,
    // An integration lane is decided on its own test files (run
    // 20260907-015322: a whole-suite verify turned an unrelated red into
    // integration_failed); the whole suite is Validate's job.
    verifyTestCmd: isIntegration ? integrationVerify : scopedTestCmd,
    baseRef: cfg2.epicBranch
  });
  const postRedRaw = await runBatch(postRed, stageOpts("cli", { label: `post-red:${taskId}`, phase: "Act", model: model("fast") }));
  const postRedResult = postRedRaw;
  if (isIntegration) {
    const redVerifyVerdict = verifyVerdict(postRedResult, "red-verify");
    if (redVerifyVerdict.kind === "unavailable") {
      log(`[${taskId}] green_verify_unavailable: ${redVerifyVerdict.why}`);
      return { task_id: taskId, status: "failed", stage: "RED", error: `green_verify_unavailable: ${redVerifyVerdict.why}` };
    }
    if (redVerifyVerdict.kind === "failed") {
      const covered = (lane.depends_on || []).join(", ");
      const invariantIds = (lane.invariants || []).join(", ");
      const error = `integration_failed: covered ${covered}; invariants ${invariantIds} (independent verify exit=${redVerifyVerdict.exit})`;
      log(`[${taskId}] ${error}`);
      return { task_id: taskId, status: "failed", stage: "RED", error };
    }
    log(`[${taskId}] integration lane RED-only fast path: independent verify passed \u2014 completing at RED`);
    await updateStage(issueId, "done");
    return { task_id: taskId, status: "completed", stage: "RED", red_only: true };
  }
  if (acCount > 0) {
    let newTestCount2 = 0;
    let gatePassed = false;
    const countRaw = postRedResult.missing ? null : stepStdout(postRedResult, "count-gate");
    if (countRaw === null || countRaw === void 0) {
      log(`[${taskId}] RED FAILED: test-count-check returned null (${describeFailure(postRedResult, "post-red batch")}) \u2014 cannot verify ${acCount} new test functions were committed`);
      return {
        task_id: taskId,
        status: "failed",
        stage: "RED",
        // The batch's own name for its absence rides along (batch_incomplete,
        // batch_timeout, runner_permission_denied): triage reads the error,
        // not the log (#341 task-008).
        error: `count_gate_no_output: test-count-check returned null (${describeFailure(postRedResult, "post-red batch")}) \u2014 cannot verify ${acCount} new test functions were committed`
      };
    } else {
      const text = countRaw.trim();
      const match = text.match(/\{"new_test_count":\s*(\d+)/);
      if (match) {
        newTestCount2 = parseInt(match[1], 10);
        const passedMatch = text.match(/"passed":\s*(true|false)/);
        gatePassed = passedMatch ? passedMatch[1] === "true" : newTestCount2 >= acCount;
      } else {
        const gateStep = stepResult(postRedResult, "count-gate");
        const detail = `exit ${gateStep?.exit_code ?? "?"}${(gateStep?.stderr || text).trim() ? ` \u2014 ${(gateStep?.stderr || text).trim().split("\n").slice(-3).join(" | ")}` : ""}`;
        log(`[${taskId}] RED FAILED: count-gate produced no JSON (${detail}) \u2014 cannot verify ${acCount} new test functions were committed`);
        return { task_id: taskId, status: "failed", stage: "RED", error: `count_gate_failed: test-count-gate produced no JSON (${detail})` };
      }
    }
    if (!gatePassed) {
      log(`[${taskId}] RED FAILED: only ${newTestCount2} new test functions found, need >= ${acCount} (one per AC)`);
      return { task_id: taskId, status: "failed", stage: "RED", error: `no_new_test_functions_committed: found ${newTestCount2}, need >= ${acCount}` };
    }
    log(`[${taskId}] RED: ${newTestCount2} new test functions confirmed (>= ${acCount} ACs)`);
  }
  const assertDetail = (stepStdout(postRedResult, "assert-check") || "").trim();
  if (assertDetail.length > 0) {
    log(`[${taskId}] RED: placeholder assertions found \u2014 ${assertDetail}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: `placeholder_assertions: ${assertDetail}` };
  }
  const artifactDetail = (stepStdout(postRedResult, "artifact-check") || "").trim();
  if (artifactDetail.length > 0) {
    log(`[${taskId}] RED: a test reads pipeline state under the repo root's .datum/ \u2014 ${artifactDetail}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: `red_reads_runtime_artifact: ${artifactDetail}` };
  }
  const redVerifyExit = testExitCode(stepStdout(postRedResult, "test-verify"));
  const redEnvMissing = testEnvMissing(stepStdout(postRedResult, "test-verify"));
  if (redEnvMissing) {
    log(`[${taskId}] test_env_missing: ${redEnvMissing}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: `test_env_missing: ${redEnvMissing} \u2014 the lane worktree has no test environment; RED's failure is not evidence` };
  }
  if (redVerifyExit === 0) {
    log(`[${taskId}] RED VERIFY FAILED: independent re-run of the test suite exited 0 (green blindness), regardless of agent self-report (tests_pass=${red.tests_pass})`);
    return { task_id: taskId, status: "failed", stage: "RED", error: "green_blindness_violation: independent test-verify step confirms tests passed after RED" };
  }
  if (red.tests_pass) {
    const diag = red.test_output || red.test_errors?.join("; ") || "no test output captured";
    log(`[${taskId}] RED VERIFY FAILED: tests passed (green blindness). Output: ${diag}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: `green_blindness_violation: tests passed after RED. Test output: ${diag}` };
  }
  log(`[${taskId}] RED verified \u2014 tests fail as expected (committed: ${red.commit_sha || "n/a"})`);
  await updateStage(issueId, "red", red.commit_sha);
  const redOwnership = deterministic ? ownershipFromStdout(stepStdout(postRedResult, "ownership"), testFiles, implFiles) : await verifyFileOwnership2(taskId, wt, "RED", testFiles, implFiles, laneStartExpr(wt, cfg2.epicBranch));
  if (!redOwnership.ok) {
    const redPrefix = redOwnership.checkFailed ? "ownership_check_failed" : "file_ownership_violation";
    log(`[${taskId}] RED ${redPrefix.toUpperCase()}: ${redOwnership.violations.join(", ")}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: `${redPrefix}: ${redOwnership.violations.join(", ")}` };
  }
  const scopeTestContents = scopeContentsFromSteps(testFiles, (n) => stepStdout(postRedResult, n));
  for (const t of scopeReadTruncations(testFiles, (n) => stepStdout(postRedResult, n), scopeReadCap(testFiles.length))) {
    log(`[${taskId}] scope_read_truncated: ${t.file} is ${t.bytes} bytes, scope-gap analysis used the first ${t.cap} (imports and early assertions only)`);
  }
  const requiredScopeFiles = /* @__PURE__ */ new Set();
  for (const tf of testFiles) {
    const tContent = scopeTestContents[tf] || "";
    if (!tContent) continue;
    for (const rf of extractRequiredScopeFiles(tContent, tf, laneLanguage)) {
      requiredScopeFiles.add(rf);
    }
  }
  const scopeGaps = findScopeGaps([...requiredScopeFiles], [...testFiles, ...implFiles]);
  const isPytestLane = laneLanguage === "python" && /pytest/.test(scopedTestCmd);
  const scopeContract = scopeContractSteps({
    wt,
    scopeGaps,
    contractPreflight: isPytestLane ? { testFiles, implFiles, scopedTestCmd } : null
  });
  const scopeContractResult = scopeContract.length > 0 ? await runBatch(scopeContract, stageOpts("cli", { label: `scope-contract:${taskId}`, phase: "Act", model: model("fast") })) : null;
  if (scopeGaps.length > 0) {
    const { existing: existingGaps, missing: missingGaps } = scopeGapsFromSteps(
      scopeGaps,
      (n) => scopeContractResult ? stepResult(scopeContractResult, n)?.exit_code ?? null : null
    );
    for (const f of existingGaps) {
      if (!implFiles.includes(f)) {
        implFiles.push(f);
        log(`[${taskId}] scope-repair: auto-adding '${f}' to allowed_write_files \u2014 required by RED test import/assertion, was missing from lane.files`);
      }
    }
    if (missingGaps.length > 0) {
      const msg = `lane ${taskId}: RED test requires ${missingGaps.join(", ")} but allowed_write_files does not include it (and the file does not exist in the repo, so it cannot be safely auto-added)`;
      log(`[${taskId}] SCOPE GAP (fail-loud): ${msg}`);
      return { task_id: taskId, status: "failed", stage: "RED", error: `scope_gap: ${msg}` };
    }
  }
  if (isPytestLane) {
    const redPreflight = parseContractPreflight(
      scopeContractResult ? stepStdout(scopeContractResult, "contract-preflight") : null
    );
    if (redPreflight.status === "contract_conflict") {
      log(`[${taskId}] RED FAILED: contract conflict \u2014 ${redPreflight.reason}`);
      return { task_id: taskId, status: "failed", stage: "RED", error: `contract_conflict: ${redPreflight.reason}`, needs_write: redPreflight.needs_write };
    }
    log(`[${taskId}] contract preflight: ${redPreflight.status}${redPreflight.status === "skipped" ? ` (${redPreflight.reason})` : ""}`);
  } else {
    log(`[${taskId}] contract preflight skipped (not a pytest lane)`);
  }
  const counts = newTestCountFromSteps(postRedResult);
  if (!counts.ok) {
    log(`[${taskId}] RED FAILED: ${counts.error}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: counts.error };
  }
  const { before: beforeCount, after: afterCount, added: newTestCount } = counts;
  if (newTestCount <= 0) {
    log(`[${taskId}] RED FAILED: no new test functions written (before=${beforeCount}, after=${afterCount})`);
    return { task_id: taskId, status: "failed", stage: "RED", error: "no_new_tests_written: RED agent did not append any test functions" };
  }
  log(`[${taskId}] RED: ${newTestCount} new test functions verified (${beforeCount} \u2192 ${afterCount})`);
  const reflectResult = await witnessedAgent(
    reflectPrompt({ wt, testFiles: testFiles.join(", "), laneSpec: specFile }),
    stageOpts("reflect", { label: `reflect:${taskId}`, phase: "Act", model: model("fast"), schema: REFLECT_SCHEMA, maxRetries: 1 }),
    specFile,
    "RED"
  );
  if (!reflectResult) {
    log(`[${taskId}] reflect_no_result: reflect agent returned nothing on both attempts (likely the maxTurns cap in agents/datum-reflect.md) \u2014 proceeding to GREEN without a quality score`);
  } else {
    const reflectScore = reflectResult.score || 0;
    log(`[${taskId}] Test quality: ${reflectScore}/10 \u2014 ${reflectResult.reasoning || "no reasoning"}`);
    if (reflectResult.gaps?.length) {
      log(`[${taskId}]   gaps: ${reflectResult.gaps.join("; ")}`);
    }
    if (reflectScore < 4) {
      log(`[${taskId}] RED FAILED: test quality too low (${reflectScore}/10)`);
      return { task_id: taskId, status: "failed", stage: "RED", error: `test quality ${reflectScore}/10` };
    }
  }
  const greenModel = model("balanced");
  log(`[${taskId}] GREEN: making tests pass (model: ${greenModel})`);
  const greenExtras = {
    test_signal: { exit_code: red.test_exit_code || 1, errors: red.test_errors || [] },
    ...targetContext ? { target_context: targetContext } : {}
  };
  const greenPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, scopedLaneCfg, "GREEN", specFile, greenExtras);
  const greenCtxCmd = laneCtxCmd(greenPacket, wt);
  const greenVars = {
    wt,
    greenCtxCmd,
    greenPacketStr: JSON.stringify(greenPacket),
    testCommand: scopedTestCmd,
    testRunCmd: testRunCommand(scopedTestCmd, wt, "GREEN"),
    implFilesList: implFiles.join(" "),
    commitPrefix: greenPacket.commit_prefix,
    commitCmd: laneCommitCommand({ wt, taskId, stage: "GREEN", runId, specHash: spec.spec.spec_hash }),
    laneSpec: specFile
  };
  let green = await witnessedAgent(
    greenStaleHint ? greenRetryPrompt({
      ...greenVars,
      failureReason: greenStaleHint,
      greenRetryPacketStr: JSON.stringify({ ...greenPacket, retry_hint: "green_stale" })
    }) : greenPrompt(greenVars),
    stageOpts("green", { label: `green:${taskId}`, phase: "Act", model: greenModel, schema: STAGE_RESULT_SCHEMA, worktree: wt }),
    specFile,
    "GREEN"
  );
  if (green?.success) {
    log(`[${taskId}] GREEN wrote: ${(green.files_written || []).join(", ")}`);
  }
  if (!green || !green.success || !green.tests_pass) {
    let greenPreflight = null;
    const selfReportedBlock = !!green && (green.status === "blocked" || /scope_exceeded/i.test(green.failure_reason || ""));
    if (green && isPytestLane && !selfReportedBlock) {
      const checkSteps = scopeContractSteps({ wt, scopeGaps: [], contractPreflight: { testFiles, implFiles, scopedTestCmd } });
      const checkResult = await runBatch(checkSteps, stageOpts("cli", { label: `contract-check:${taskId}`, phase: "Act", model: model("fast") }));
      greenPreflight = parseContractPreflight(stepStdout(checkResult, "contract-preflight"));
    }
    const decision = decideGreenBlock(green, greenPreflight);
    const ownTestTargets = decision.blocked && decision.needsWrite.length > 0 && decision.needsWrite.every((f) => testFiles.includes(f));
    if (decision.blocked && ownTestTargets) {
      log(`[${taskId}] GREEN blocked on the lane's own test(s) [${decision.needsWrite.join(", ")}] \u2014 re-dispatching RED once with GREEN's diagnosis (#440)`);
      const repairReason = `green_blocked_on_own_test: GREEN could not make the suite pass because the lane's own test(s) [${decision.needsWrite.join(", ")}] encode a wrong precondition or fixture. GREEN's diagnosis: ${decision.reason}. Amend ONLY the named test file(s) so each test asserts the criterion the lane spec states, under a precondition that can actually hold; never weaken an assertion the spec requires; keep every other test intact.`;
      const repaired = await witnessedAgent(
        redRetryPrompt({ ...promptVars, failureReason: repairReason }),
        stageOpts("red", { label: `red-repair:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
        specFile,
        "RED"
      );
      if (!repaired || !repaired.success || !repaired.committed) {
        return { task_id: taskId, status: "failed", stage: "RED", error: `red_repair_failed: ${!repaired ? "RED repair agent returned nothing" : repaired.failure_reason || "RED repair did not commit"} \u2014 GREEN's diagnosis: ${decision.reason}` };
      }
      const repairPostRed = await runBatch(postRed, stageOpts("cli", { label: `post-red-repair:${taskId}`, phase: "Act", model: model("fast") }));
      const repairCount = acCount > 0 ? parseAgentJson(stepStdout(repairPostRed, "count-gate") || "", { passed: false }) : { passed: true };
      const repairAssert = (stepStdout(repairPostRed, "assert-check") || "").trim();
      const repairTouched = (stepStdout(repairPostRed, "ownership") || "").split("\n").map((l) => l.trim()).filter(Boolean);
      const repairForeign = repairTouched.filter((f) => !testFiles.includes(f));
      if (!repairCount.passed || repairAssert.length > 0 || repairForeign.length > 0) {
        const why = !repairCount.passed ? "count gate failed after the repair" : repairAssert.length > 0 ? `placeholder_assertions after the repair: ${repairAssert.split("\n")[0]}` : `repair touched files outside the lane's tests [${repairForeign.join(", ")}]`;
        return { task_id: taskId, status: "failed", stage: "RED", error: `red_repair_failed: ${why}` };
      }
      log(`[${taskId}] RED repair committed (${repaired.commit_sha || "n/a"}); post-RED gates passed \u2014 re-running GREEN once`);
      green = await witnessedAgent(
        greenRetryPrompt({
          ...greenVars,
          failureReason: `red_repaired: the lane's test(s) [${decision.needsWrite.join(", ")}] were amended per your diagnosis (${decision.reason}); implement against the amended tests`,
          greenRetryPacketStr: JSON.stringify({ ...greenPacket, retry_hint: "red_repaired" })
        }),
        stageOpts("green", { label: `green-red-repair:${taskId}`, phase: "Act", model: model("deep"), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
        specFile,
        "GREEN"
      );
      const again = decideGreenBlock(green, null);
      if (again.blocked) {
        const err = `green_blocked_needs_write: [${again.needsWrite.join(", ") || "unspecified"}] \u2014 ${again.reason} (still blocked after one RED repair for [${decision.needsWrite.join(", ")}])`;
        log(`[${taskId}] ${err}`);
        return { task_id: taskId, status: "blocked", stage: "GREEN", error: err, needs_write: again.needsWrite };
      }
    } else if (decision.blocked) {
      const { widen, rejected } = cfg2.yolo ? autoWidenTargets(decision.needsWrite) : { widen: [], rejected: decision.needsWrite };
      if (cfg2.yolo && widen.length > 0 && rejected.length === 0) {
        for (const f of widen) if (!implFiles.includes(f)) implFiles.push(f);
        log(`[${taskId}] GREEN blocked \u2014 yolo auto-widened allowed_write_files with [${widen.join(", ")}] (all inside src/); re-running GREEN once`);
        const widenedPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, scopedLaneCfg, "GREEN", specFile, greenExtras);
        green = await witnessedAgent(
          greenRetryPrompt({
            ...greenVars,
            greenCtxCmd: laneCtxCmd(widenedPacket, wt),
            implFilesList: implFiles.join(" "),
            failureReason: `blocked: ${decision.reason} \u2014 allowed_write_files now also includes ${widen.join(", ")}`,
            greenRetryPacketStr: JSON.stringify({ ...widenedPacket, retry_hint: decision.reason })
          }),
          stageOpts("green", { label: `green-widened:${taskId}`, phase: "Act", model: model("deep"), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
          specFile,
          "GREEN"
        );
      } else {
        const refusal = cfg2.yolo && rejected.length > 0 ? ` (yolo auto-widen refused: [${rejected.join(", ")}] not inside src/)` : "";
        const err = `green_blocked_needs_write: [${decision.needsWrite.join(", ") || "unspecified"}] \u2014 ${decision.reason}${refusal}`;
        log(`[${taskId}] ${err}`);
        const partial = (green?.files_written || []).filter((f) => implFiles.includes(f));
        if (partial.length > 0) {
          const wipMsg = `wip(${taskId}): GREEN partial - blocked on ${decision.needsWrite.join(" ") || "unspecified"}`.replace(/["`$\\]/g, "");
          const wipSteps = commitFilesSteps({ wt, files: partial, message: wipMsg });
          const wip = commitFilesFromSteps(await runBatch(wipSteps, stageOpts("cli", { label: `green-wip-commit:${taskId}`, phase: "Act", model: model("fast") })));
          if (wip.committed) log(`[${taskId}] green_partial_committed: ${wip.sha} \u2014 [${partial.join(", ")}] kept on the lane branch as a wip commit`);
          else log(`[${taskId}] green_partial_not_committed: ${wip.nothingToCommit ? "nothing to commit" : wip.error} \u2014 partial edits in [${partial.join(", ")}] will be lost at cleanup`);
        }
        return { task_id: taskId, status: "blocked", stage: "GREEN", error: err, needs_write: decision.needsWrite };
      }
    } else {
      let firstFailure = green?.failure_reason || "unknown";
      if (!green) {
        firstFailure = "green_no_result: GREEN agent returned nothing (likely the maxTurns cap in agents/datum-green.md, an API error, or a skip)";
        const resetStepList = worktreeResetSteps(wt);
        const resetResult = await runBatch(resetStepList, stageOpts("cli", { label: `green-reset:${taskId}`, phase: "Act", model: model("fast") }));
        const leftover = (stepStdout(resetResult, "status") || "").trim();
        log(`[${taskId}] GREEN attempt 1: ${firstFailure}; worktree reset to HEAD before retry${leftover ? ` (WARNING: still dirty: ${leftover.split("\n").length} paths)` : ""}`);
      }
      log(`[${taskId}] GREEN attempt 1 failed (${greenModel}): ${firstFailure}, escalating to opus`);
      green = await witnessedAgent(
        greenRetryPrompt({
          ...greenVars,
          failureReason: firstFailure,
          greenRetryPacketStr: JSON.stringify({ ...greenPacket, retry_hint: firstFailure })
        }),
        stageOpts("green", { label: `green-retry:${taskId}`, phase: "Act", model: model("deep"), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
        specFile,
        "GREEN"
      );
    }
  }
  if (!green) {
    return {
      task_id: taskId,
      status: "failed",
      stage: "GREEN",
      error: "green_no_result: GREEN agent returned nothing on both attempts (likely the maxTurns cap in agents/datum-green.md \u2014 the lane may need a smaller scope, or the cap raised)"
    };
  }
  const postGreenVerify = postGreenSteps({ wt, verifyTestCmd: scopedTestCmd, buildCommand: cfg2.buildCommand || null });
  const postGreenVerifyRaw = await runBatch(postGreenVerify, stageOpts("cli", { label: `post-green-verify:${taskId}`, phase: "Act", model: model("fast") }));
  const postGreenVerifyResult = postGreenVerifyRaw;
  const greenStrays = strayFilesFromSteps(postGreenVerifyResult);
  if (greenStrays.strays.length > 0) log(`[${taskId}] stray_untracked_files: ${greenStrays.strays.length} untracked file(s) left by GREEN ${greenStrays.cleaned ? "removed" : "NOT removed"} before the verify: ${greenStrays.strays.join(", ")}`);
  const greenVerdict = verifyVerdict(postGreenVerifyResult, "post-green-verify");
  const greenEnvMissing = testEnvMissing(stepStdout(postGreenVerifyResult, "test-verify"));
  if (greenEnvMissing) {
    log(`[${taskId}] test_env_missing: ${greenEnvMissing}`);
    return { task_id: taskId, status: "failed", stage: "GREEN", error: `test_env_missing: ${greenEnvMissing} \u2014 the lane worktree has no test environment; GREEN's verify is not evidence` };
  }
  if (greenVerdict.kind === "unavailable") {
    log(`[${taskId}] green_verify_unavailable: ${greenVerdict.why}`);
    return { task_id: taskId, status: "failed", stage: "GREEN", error: `green_verify_unavailable: ${greenVerdict.why}` };
  }
  if (greenVerdict.kind === "failed") {
    log(`[${taskId}] GREEN VERIFY FAILED: independent re-run of the test suite exited ${greenVerdict.exit} (expected 0), regardless of agent self-report (tests_pass=${green?.tests_pass})`);
    return {
      task_id: taskId,
      status: "failed",
      stage: "GREEN",
      error: `green_verify_failed: independent test-verify step exit=${greenVerdict.exit} (agent self-reported tests_pass=${green?.tests_pass})`
    };
  }
  if (cfg2.buildCommand) {
    const buildVerdict = buildVerifyVerdict(postGreenVerifyResult, "post-green-build-verify");
    if (buildVerdict.kind === "unavailable") {
      log(`[${taskId}] build_verify_unavailable: ${buildVerdict.why}`);
      return { task_id: taskId, status: "failed", stage: "GREEN", error: `build_verify_unavailable: ${buildVerdict.why}` };
    }
    if (buildVerdict.kind === "failed") {
      log(`[${taskId}] GREEN BUILD VERIFY FAILED: independent re-run of build_command (${cfg2.buildCommand}) exited ${buildVerdict.exit}`);
      const buildTail = (stepStdout(postGreenVerifyResult, "build-verify") || "").trim().split("\n").slice(-30).join("\n");
      const buildRetryReason = `build_verify_failed: independent re-run of build_command (${cfg2.buildCommand}) exited ${buildVerdict.exit} after your GREEN commit. Output tail:
${buildTail}

If you can fix this inside allowed_write_files [${implFiles.join(", ")}], fix it and re-commit. If the failure is rooted in a file OUTSIDE allowed_write_files, do NOT retry blindly \u2014 return status="blocked" with needs_write naming the file(s) you cannot edit, exactly like the existing GREEN scope-block contract.`;
      const buildRetryGreen = await witnessedAgent(
        greenRetryPrompt({
          ...greenVars,
          failureReason: buildRetryReason,
          greenRetryPacketStr: JSON.stringify({ ...greenPacket, retry_hint: "build_verify_failed" })
        }),
        stageOpts("green", { label: `green-build-retry:${taskId}`, phase: "Act", model: model("deep"), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
        specFile,
        "GREEN"
      );
      const buildDecision = decideGreenBlock(buildRetryGreen, null);
      if (buildDecision.blocked) {
        const err = `green_blocked_needs_write: [${buildDecision.needsWrite.join(", ") || "unspecified"}] \u2014 ${buildDecision.reason} (build_verify_failed after GREEN)`;
        log(`[${taskId}] ${err}`);
        return { task_id: taskId, status: "blocked", stage: "GREEN", error: err, needs_write: buildDecision.needsWrite };
      }
      if (!buildRetryGreen || !buildRetryGreen.success) {
        return { task_id: taskId, status: "failed", stage: "GREEN", error: `build_verify_failed: independent build re-run exit=${buildVerdict.exit}; retry ${!buildRetryGreen ? "returned nothing" : `failed: ${buildRetryGreen.failure_reason || "no reason"}`}` };
      }
      const retryBuildBatch = postGreenSteps({ wt, verifyTestCmd: scopedTestCmd, buildCommand: cfg2.buildCommand });
      const retryBuildResult = await runBatch(retryBuildBatch, stageOpts("cli", { label: `post-green-build-reverify:${taskId}`, phase: "Act", model: model("fast") }));
      const retryTestVerdict = verifyVerdict(retryBuildResult, "post-green-build-reverify");
      const retryBuildVerdict = buildVerifyVerdict(retryBuildResult, "post-green-build-reverify");
      if (retryTestVerdict.kind !== "passed") {
        return { task_id: taskId, status: "failed", stage: "GREEN", error: `green_verify_failed: independent test-verify exit=${retryTestVerdict.exit ?? "null"} after the build-fix retry` };
      }
      if (retryBuildVerdict.kind === "unavailable") {
        return { task_id: taskId, status: "failed", stage: "GREEN", error: `build_verify_unavailable: ${retryBuildVerdict.why}` };
      }
      if (retryBuildVerdict.kind === "failed") {
        return { task_id: taskId, status: "failed", stage: "GREEN", error: `build_verify_failed: independent build re-run exit=${retryBuildVerdict.exit} after one retry` };
      }
      green = buildRetryGreen;
      log(`[${taskId}] build_verify passed after one GREEN retry`);
    }
  }
  if (!green || !green.success || !green.tests_pass) {
    const reason = !green ? "GREEN agent call returned no result after retries (subagent crashed, was skipped, or exhausted rate-limit backoff) \u2014 check the subagent transcript for this run to recover the actual failure cause" : green.failure_reason || `GREEN failed with no failure_reason reported (success=${green.success}, tests_pass=${green.tests_pass}, exit_code=${green.test_exit_code ?? "n/a"})`;
    log(`[${taskId}] GREEN FAILED: ${reason}`);
    return { task_id: taskId, status: "failed", stage: "GREEN", error: reason };
  }
  if (!green.committed) {
    const check = await verifyCommitIndependently(taskId, wt, implFiles, greenPacket.commit_prefix, "GREEN", cfg2.epicBranch);
    if (check.committed) {
      log(`[${taskId}] GREEN: agent reported committed=false but independent check confirms a commit exists (${check.detail}) \u2014 treating as committed (#274)`);
      green = { ...green, committed: true, commit_sha: check.commitSha || green.commit_sha };
    } else if (green.tests_pass && check.clean === true) {
      log(`[${taskId}] GREEN: no implementation change needed \u2014 tests pass and worktree is clean (${check.detail}); accepting no-op GREEN with RED commit as deliverable`);
      green = { ...green, committed: true, commit_sha: red.commit_sha };
    } else {
      log(`[${taskId}] GREEN: agent did not commit \u2014 failing (independent check: ${check.detail})`);
      return { task_id: taskId, status: "failed", stage: "GREEN", error: `GREEN agent did not commit (independent check: ${check.detail})` };
    }
  }
  let redCommitted = null;
  const checkGreenOwnership = async (labelSuffix) => {
    if (deterministic) {
      const postGreen = postGreenSteps({ wt, redSha: red.commit_sha || null });
      const postGreenRaw = await runBatch(postGreen, stageOpts("cli", { label: `post-green${labelSuffix}:${taskId}`, phase: "Act", model: model("fast") }));
      redCommitted = redCommittedFilesFromSteps(postGreenRaw);
      return ownershipFromStdout(stepStdout(postGreenRaw, "ownership"), implFiles, testFiles);
    }
    return verifyFileOwnership2(taskId, wt, "GREEN", implFiles, testFiles, red.commit_sha || null);
  };
  let greenOwnership = await checkGreenOwnership("");
  const ownTestsOnly = (o) => {
    if (o.checkFailed || o.violations.length === 0) return false;
    const files = o.violations.map((v) => v.split(" ")[0]);
    return files.every((f) => testFiles.includes(f) && (redCommitted === null || redCommitted.includes(f)));
  };
  if (!greenOwnership.ok && ownTestsOnly(greenOwnership) && red.commit_sha) {
    const touched = [...new Set(greenOwnership.violations.map((v) => v.split(" ")[0]))];
    const hint = `green_edited_tests: GREEN modified the lane's test files [${touched.join(", ")}]; write only the implementation files and never amend or rewrite the RED commit`;
    const discardedRef = `${cfg2.epicBranch}--${taskId}--discarded-green`;
    log(`[${taskId}] ${hint} \u2014 pinning the GREEN commit to ${discardedRef}, resetting to the RED commit ${red.commit_sha} and re-running GREEN once`);
    const testsResetSteps = [...preserveHeadRefSteps(wt, discardedRef), ...worktreeResetToSteps(wt, red.commit_sha)];
    const testsReset = worktreeResetToFromSteps(
      await runBatch(testsResetSteps, stageOpts("cli", { label: `green-tests-reset:${taskId}`, phase: "Act", model: model("fast") })),
      red.commit_sha
    );
    if (!testsReset.ok) {
      return { task_id: taskId, status: "failed", stage: "GREEN", error: `${hint} (could not reset for the retry: ${testsReset.error})` };
    }
    log(`[${taskId}] green_discarded_ref: ${discardedRef} keeps the discarded GREEN commit ${green?.commit_sha || "(HEAD before reset)"}`);
    green = await witnessedAgent(
      greenRetryPrompt({
        ...greenVars,
        failureReason: hint,
        greenRetryPacketStr: JSON.stringify({ ...greenPacket, retry_hint: "green_edited_tests" })
      }),
      stageOpts("green", { label: `green-tests-retry:${taskId}`, phase: "Act", model: model("deep"), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
      specFile,
      "GREEN"
    );
    const retryVerify = await runBatch(postGreenSteps({ wt, verifyTestCmd: scopedTestCmd, buildCommand: cfg2.buildCommand || null }), stageOpts("cli", { label: `post-green-tests-retry-verify:${taskId}`, phase: "Act", model: model("fast") }));
    const retryVerdict = verifyVerdict(retryVerify, "post-green-tests-retry-verify");
    if (cfg2.buildCommand) {
      const retryBuildVerdict = buildVerifyVerdict(retryVerify, "post-green-tests-retry-verify");
      if (retryBuildVerdict.kind !== "passed") {
        return { task_id: taskId, status: "failed", stage: "GREEN", error: retryBuildVerdict.kind === "unavailable" ? `build_verify_unavailable: ${retryBuildVerdict.why}` : `build_verify_failed: independent build re-run exit=${retryBuildVerdict.exit} on the tests-retry` };
      }
    }
    if (retryVerdict.kind === "unavailable" && green && green.success) {
      return { task_id: taskId, status: "failed", stage: "GREEN", error: `green_verify_unavailable: ${retryVerdict.why}` };
    }
    if (!green || !green.success || retryVerdict.kind !== "passed") {
      return { task_id: taskId, status: "failed", stage: "GREEN", error: `${hint} \u2014 retry ${!green ? "returned nothing" : !green.success ? `failed: ${green.failure_reason || "no reason"}` : `did not pass the suite (exit=${retryVerdict.exit})`}` };
    }
    greenOwnership = await checkGreenOwnership("-tests-retry");
    if (!greenOwnership.ok && ownTestsOnly(greenOwnership)) {
      return { task_id: taskId, status: "failed", stage: "GREEN", error: `green_edited_tests: GREEN modified test files again on retry [${[...new Set(greenOwnership.violations.map((v) => v.split(" ")[0]))].join(", ")}]` };
    }
  }
  if (!greenOwnership.ok) {
    const greenPrefix = greenOwnership.checkFailed ? "ownership_check_failed" : "file_ownership_violation";
    log(`[${taskId}] GREEN ${greenPrefix.toUpperCase()}: ${greenOwnership.violations.join(", ")}`);
    return { task_id: taskId, status: "failed", stage: "GREEN", error: `${greenPrefix}: ${greenOwnership.violations.join(", ")}` };
  }
  log(`[${taskId}] GREEN verified \u2014 all tests pass (committed: ${green.commit_sha || "n/a"})`);
  await updateStage(issueId, "green", green.commit_sha);
  let skeptic = await runSkepticPanel(taskId, wt, implFiles, testFiles, scopedTestCmd, specFile, propertiesFile);
  if (skeptic.brokenCount >= 2) {
    const confirmedBugs = skeptic.crossValidated.length > 0 ? skeptic.crossValidated : skeptic.allBugs;
    const bugSummary = confirmedBugs.map((b) => `- [${b.severity}] ${b.description} (evidence: ${b.evidence})`).join("\n") || "no bug detail available";
    log(`[${taskId}] SKEPTIC VERDICT: ${skeptic.brokenCount}/3 BROKEN \u2014 retrying GREEN once with ${confirmedBugs.length} confirmed bug(s)`);
    const skepticRetryPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, scopedLaneCfg, "GREEN", specFile, greenExtras);
    green = await witnessedAgent(
      greenRetryPrompt({
        ...greenVars,
        failureReason: `The skeptic panel found confirmed bugs in the GREEN implementation. Fix them without breaking the tests.
SKEPTIC FINDINGS:
${bugSummary}`,
        greenRetryPacketStr: JSON.stringify({ ...skepticRetryPacket, retry_hint: "skeptic_broken", skeptic_bugs: confirmedBugs })
      }),
      stageOpts("green", { label: `green-skeptic-retry:${taskId}`, phase: "Act", model: model("deep"), schema: STAGE_RESULT_SCHEMA, worktree: wt }),
      specFile,
      "GREEN"
    );
    const retryVerifySteps = postGreenSteps({ wt, verifyTestCmd: scopedTestCmd, buildCommand: cfg2.buildCommand || null });
    const retryVerifyRaw = await runBatch(retryVerifySteps, stageOpts("cli", { label: `post-green-skeptic-retry-verify:${taskId}`, phase: "Act", model: model("fast") }));
    const retryVerifyVerdict = verifyVerdict(retryVerifyRaw, "post-green-skeptic-retry-verify");
    if (cfg2.buildCommand) {
      const retrySkepticBuildVerdict = buildVerifyVerdict(retryVerifyRaw, "post-green-skeptic-retry-verify");
      if (retrySkepticBuildVerdict.kind !== "passed") {
        return { task_id: taskId, status: "failed", stage: "GREEN", error: retrySkepticBuildVerdict.kind === "unavailable" ? `build_verify_unavailable: ${retrySkepticBuildVerdict.why}` : `build_verify_failed: independent build re-run exit=${retrySkepticBuildVerdict.exit} on the skeptic retry` };
      }
    }
    if (retryVerifyVerdict.kind === "unavailable" && green && green.success) {
      return { task_id: taskId, status: "failed", stage: "GREEN", error: `green_verify_unavailable: ${retryVerifyVerdict.why}` };
    }
    if (retryVerifyVerdict.kind !== "passed" || !green || !green.success) {
      const first = confirmedBugs[0];
      const summary = first ? first.description : "GREEN retry did not produce a passing, committed fix";
      log(`[${taskId}] SKEPTIC RETRY FAILED: independent test-verify exit=${retryVerifyVerdict.exit ?? "null"}`);
      return {
        task_id: taskId,
        status: "failed",
        stage: "GREEN",
        error: `skeptic_broken: ${confirmedBugs.length} confirmed bugs \u2014 ${summary}`
      };
    }
    skeptic = await runSkepticPanel(taskId, wt, implFiles, testFiles, scopedTestCmd, specFile, propertiesFile);
    if (skeptic.brokenCount >= 2) {
      const stillConfirmed = skeptic.crossValidated.length > 0 ? skeptic.crossValidated : skeptic.allBugs;
      const first = stillConfirmed[0];
      const summary = first ? first.description : "implementation still broken after retry";
      log(`[${taskId}] SKEPTIC VERDICT after retry: ${skeptic.brokenCount}/3 still BROKEN`);
      return {
        task_id: taskId,
        status: "failed",
        stage: "GREEN",
        error: `skeptic_broken: ${stillConfirmed.length} confirmed bugs \u2014 ${summary}`
      };
    }
    log(`[${taskId}] SKEPTIC VERDICT after retry: PASS (${skeptic.crossValidated.length} cross-validated)`);
  } else {
    log(`[${taskId}] SKEPTIC VERDICT: PASS (${skeptic.crossValidated.length} cross-validated)`);
  }
  const minority = skepticMinorityFindings(skeptic.allBugs, skeptic.crossValidated);
  let followUps = 0;
  if (minority.length > 0) {
    for (const b of minority) log(`[${taskId}] skeptic_minority_finding: ${taskId} \u2014 [${b.severity}] ${b.description.replace(/\s+/g, " ").slice(0, 160)} (${b.lens}: ${b.evidence.replace(/\s+/g, " ").slice(0, 120)})`);
    const followUpPath = `.datum/runs/${runId}/follow-ups/${taskId}.json`;
    const followUpText = JSON.stringify(minorityFollowUps(taskId, green.commit_sha || "", minority), null, 2);
    const fuSteps = writeFileSteps({ path: followUpPath, content: followUpText });
    const fuWrite = writeFileFromSteps(
      await runBatch(fuSteps, stageOpts("cli", { label: `followups-write:${taskId}`, phase: "Act", model: model("fast") })),
      { path: followUpPath, expectedSha: writeFileBlobSha(followUpText), prefix: "followups" }
    );
    if (!fuWrite.ok) log(`[${taskId}] ${fuWrite.error} \u2014 ${minority.length} skeptic minority finding(s) stay in this log only`);
    else followUps = minority.length;
  }
  const preRefactor = await runBatch(
    [...strayCleanSteps(wt), ...codeTellSteps({ wt, files: [...implFiles, ...testFiles], baseRef: scopedLaneCfg.epicBranch })],
    stageOpts("cli", { label: `stray-clean:${taskId}`, phase: "Act", model: model("fast") })
  );
  const strayOutcome = strayFilesFromSteps(preRefactor);
  if (strayOutcome.cleaned === null) log(`[${taskId}] stray_clean_unchecked: could not list untracked files in the worktree before REFACTOR`);
  else if (strayOutcome.strays.length > 0) log(`[${taskId}] stray_untracked_files: ${strayOutcome.strays.length} untracked file(s) left by a prior stage ${strayOutcome.cleaned ? "removed" : "NOT removed"} before REFACTOR: ${strayOutcome.strays.join(", ")}`);
  const tells = tellLines(stepStdout(preRefactor, "tell-scan"));
  const refResult = await runRefactor(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg, specFile, tells);
  if (!refResult || !refResult.verified) {
    return { task_id: taskId, status: "failed", stage: "REFACTOR", error: refResult?.error || "refactor failed" };
  }
  log(`[${taskId}] === LANE COMPLETE ===`);
  await updateStage(issueId, "done");
  return followUps > 0 ? { task_id: taskId, status: "completed", stage: "REFACTOR", follow_ups: followUps } : { task_id: taskId, status: "completed", stage: "REFACTOR" };
}
async function runSkepticPanel(taskId, wt, implFiles, testFiles, scopedTestCmd, specFile, propertiesFile) {
  const base = skepticBasePrompt({
    wt,
    implFiles: implFiles.join(", "),
    testFiles: testFiles.join(", "),
    testCommand: scopedTestCmd,
    laneSpec: specFile,
    properties: propertiesFile
  });
  const lenses = skepticLenses();
  const skepticResults = await parallel(
    lenses.map(
      (lens) => () => agent(base + lens.prompt, stageOpts("skeptic", { label: `skeptic-${lens.key}:${taskId}`, phase: "Act", model: lens.model, schema: SKEPTIC_SCHEMA, worktree: wt }))
    )
  );
  const witnessFiles = [specFile, ...propertiesFile && !propertiesFile.inlined ? [propertiesFile] : []];
  let verifiedLenses = 0;
  for (let i = 0; i < skepticResults.length; i++) {
    const r = skepticResults[i];
    if (r === null) continue;
    const w = verifyReadWitness(witnessFiles, r);
    if (w.ok) {
      verifiedLenses++;
      continue;
    }
    const unverifiedPaths = [...w.missing, ...w.mismatched, ...w.tooShort];
    log(`[${taskId}] skeptic_lens_unverified: ${taskId} \u2014 lens ${lenses[i].key} did not evidence reading ${unverifiedPaths.join(", ") || specFile.path} (${w.tooShort.length ? "prefix too short" : w.mismatched.length ? "wrong prefix" : "no witness"}); its ${r.verdict} verdict and ${(r.bugs_found || []).length} bug(s) are dropped from the vote`);
    skepticResults[i] = null;
  }
  if (verifiedLenses === 0) {
    const witnessedPaths = witnessFiles.map((f) => f.path).join(", ");
    const err = new Error(`context_read_unverified: ${witnessedPaths} \u2014 no skeptic lens evidenced reading the lane spec${propertiesFile && !propertiesFile.inlined ? " and PROPERTIES.md" : ""}; the panel is void`);
    err.stage = "GREEN";
    throw err;
  }
  const { allBugs, brokenCount, crossValidated } = crossValidateBugs(skepticResults, lenses);
  for (let i = 0; i < lenses.length; i++) {
    const s = skepticResults[i];
    if (!s) {
      log(`[${taskId}] SKEPTIC ${lenses[i].key}: (null)`);
      continue;
    }
    log(`[${taskId}] SKEPTIC ${lenses[i].key}: ${s.verdict} (${(s.bugs_found || []).length} bugs)`);
    for (const bug of s.bugs_found || []) {
      log(`[${taskId}]   - [${bug.severity}] ${bug.description}`);
    }
  }
  return { allBugs, brokenCount, crossValidated };
}
async function runStructural(taskId, lane, testFiles, implFiles, wt, cfg2, specFile) {
  const files = [...testFiles, ...implFiles];
  const checkSteps = structuralDeliverableSteps({ wt, epicBranch: cfg2.epicBranch, files });
  const check = async (label) => structuralDeliverablesFromSteps(
    await runBatch(checkSteps, stageOpts("cli", { label: `${label}:${taskId}`, phase: "Act", model: model("fast") })),
    files
  );
  const before = await check("structural-check");
  if (before === null) {
    return { verified: false, error: "structural_check_unavailable: the deliverable-check batch did not run before the STRUCTURAL stage; no verdict on the declared files" };
  }
  if (before.missing.length === 0 && before.committed) {
    log(`[${taskId}] structural_already_delivered: every declared file exists and is committed past ${cfg2.epicBranch} \u2014 skipping the STRUCTURAL agent`);
    return { verified: true };
  }
  log(`[${taskId}] STRUCTURAL: writing ${files.length} deliverable(s)${before.missing.length ? ` (missing: ${before.missing.join(", ")})` : " (present, uncommitted)"}`);
  const packet = buildPacket(taskId, testFiles, implFiles, lane, wt, cfg2, "REFACTOR", specFile, {});
  const result = await resilientAgent(
    structuralPrompt({
      wt,
      structuralCtxCmd: laneCtxCmd(packet, wt),
      structuralPacketStr: JSON.stringify(packet),
      allFilesList: files.join(" "),
      commitCmd: laneCommitCommand({ wt, taskId, stage: "REFACTOR", runId: cfg2.runId })
    }),
    stageOpts("structural", { label: `structural:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA, worktree: wt })
  );
  if (!result) {
    return { verified: false, error: "structural_no_result: STRUCTURAL agent returned nothing on both attempts (likely the maxTurns cap in agents/datum-structural.md, an API error, or a skip)" };
  }
  if (!result.success) {
    return { verified: false, error: `structural_failed: ${result.failure_reason || result.reason || "STRUCTURAL reported no success"}` };
  }
  const after = await check("structural-verify");
  if (after === null) {
    return { verified: false, error: "structural_check_unavailable: the deliverable-check batch did not run after the STRUCTURAL stage; the agent's report is not evidence" };
  }
  if (after.missing.length > 0) {
    return { verified: false, error: `structural_deliverable_missing: ${after.missing.join(", ")} \u2014 the STRUCTURAL stage reported success but the declared file(s) do not exist in the worktree` };
  }
  if (!after.committed) {
    return { verified: false, error: `structural_uncommitted: every declared file exists but no commit past ${cfg2.epicBranch} touches them (agent reported committed=${!!result.committed})` };
  }
  log(`[${taskId}] STRUCTURAL: delivered ${files.length} file(s) (committed: ${result.commit_sha || "n/a"}; independent check ok)`);
  return { verified: true };
}
async function runRefactor(taskId, lane, testFiles, implFiles, wt, cfg2, specFile, tells) {
  log(`[${taskId}] REFACTOR: checking if needed`);
  const laneFiles = [...implFiles, ...testFiles];
  const tellsSlot = tells.length > 0 ? tells.join("\n") : "(none)";
  let reason = tells.length > 0 ? `code_tells: ${tells.length} on added lines (${tells.slice(0, 3).join("; ")}${tells.length > 3 ? "; \u2026" : ""})` : "";
  if (tells.length === 0) {
    const preCheck = await resilientAgent(
      refactorCheckPrompt({ wt, allFiles: laneFiles.join(", "), tellsSlot }),
      stageOpts("quality", { label: `refactor-check:${taskId}`, phase: "Act", model: model("fast"), schema: REFACTOR_CHECK_SCHEMA, maxRetries: 1 })
    );
    if (!preCheck) {
      log(`[${taskId}] refactor_check_no_result: refactor-check agent returned nothing on both attempts \u2014 skipping the optional REFACTOR stage`);
      return { verified: true };
    }
    if (!preCheck.should_refactor) {
      log(`[${taskId}] REFACTOR: skipped (${preCheck.reason || "nothing to improve"})`);
      return { verified: true };
    }
    reason = preCheck.reason || "checker asked for it";
  }
  log(`[${taskId}] REFACTOR: proceeding (${reason})`);
  const refactorPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, cfg2, "REFACTOR", specFile, {});
  const refactorCtxCmd = laneCtxCmd(refactorPacket, wt);
  const refactor = await resilientAgent(
    refactorPrompt({
      wt,
      refactorCtxCmd,
      refactorPacketStr: JSON.stringify(refactorPacket),
      testCommand: cfg2.testCommand,
      testRunCmd: testRunCommand(cfg2.testCommand, wt, "REFACTOR"),
      allFilesList: [...testFiles, ...implFiles].join(" "),
      commitPrefix: refactorPacket.commit_prefix,
      // Same author/trailer scheme as RED and GREEN (#357) — a REFACTOR commit
      // under the user's identity was being read as a stray concurrent writer.
      commitCmd: laneCommitCommand({ wt, taskId, stage: "REFACTOR", runId: cfg2.runId }),
      tellsSlot
    }),
    stageOpts("refactor", { label: `refactor:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA, worktree: wt })
  );
  if (!refactor) {
    const failure = "refactor_no_result: REFACTOR agent returned nothing (likely the maxTurns cap in agents/datum-refactor.md, an API error, or a skip)";
    log(`[${taskId}] REFACTOR: ${failure} \u2014 treating as no refactor applied (optional stage)`);
    return verifyWithoutRefactor(taskId, wt, cfg2, failure);
  }
  if (!refactor.success) {
    if (refactor.failure_reason?.toLowerCase().includes("nothing to")) {
      log(`[${taskId}] REFACTOR: nothing to change`);
      return { verified: true };
    }
    if (!refactor.committed) {
      const reason2 = `refactor_skipped: ${refactor.failure_reason || (refactor.status === "blocked" ? "REFACTOR reported blocked" : "REFACTOR reported no success")}`;
      log(`[${taskId}] REFACTOR: ${reason2}${refactor.status === "blocked" && (refactor.needs_write?.length ?? 0) > 0 ? ` (needs_write: ${refactor.needs_write.join(", ")})` : ""} \u2014 treating as no refactor applied (optional stage)`);
      return verifyWithoutRefactor(taskId, wt, cfg2, reason2);
    }
    log(`[${taskId}] REFACTOR FAILED: ${refactor.failure_reason || "unknown"}`);
    return { verified: false, error: `refactor_failed: ${refactor.failure_reason || "unknown"}` };
  }
  const verifySteps = [
    { name: "test-verify", command: testRunCommand(cfg2.testCommand, wt, "refactor-verify"), tolerant: true },
    // Rescan in the same batch when there were hits: what survived is named.
    ...tells.length > 0 ? codeTellSteps({ wt, files: laneFiles, baseRef: cfg2.epicBranch }) : []
  ];
  const verifyRaw = await runBatch(verifySteps, stageOpts("cli", { label: `post-refactor-verify:${taskId}`, phase: "Act", model: model("fast") }));
  let refactorVerifyExit = testExitCode(stepStdout(verifyRaw, "test-verify"));
  if (refactorVerifyExit !== 0) {
    log(`[${taskId}] REFACTOR VERIFY FAILED: independent run exit=${refactorVerifyExit ?? "n/a"} (agent self-reported tests_pass=${!!refactor.tests_pass}) \u2014 ${refactor.committed ? "reverting the refactor commit" : "agent reported no commit"}`);
    if (refactor.committed) {
      const revertSteps = [
        { name: "revert", command: `git -C "${wt}" revert --no-edit HEAD`, tolerant: true },
        { name: "test-verify", command: testRunCommand(cfg2.testCommand, wt, "refactor-reverify"), tolerant: true }
      ];
      const revertRaw = await runBatch(revertSteps, stageOpts("cli", { label: `revert-refactor:${taskId}`, phase: "Act", model: model("fast") }));
      const revertResult = revertRaw;
      refactorVerifyExit = testExitCode(stepStdout(revertResult, "test-verify"));
      log(`[${taskId}] REFACTOR reverted (revert exit=${stepResult(revertResult, "revert")?.exit_code ?? "n/a"}); suite after revert exit=${refactorVerifyExit ?? "n/a"}`);
    }
    if (refactorVerifyExit !== 0) {
      return { verified: false, error: `refactor_verify_failed: suite red after REFACTOR (independent exit=${refactorVerifyExit ?? "no result"})${refactor.committed ? " even after reverting the refactor commit" : ""}` };
    }
    return { verified: true };
  }
  log(`[${taskId}] REFACTOR: clean (committed: ${refactor.commit_sha || "n/a"}; independent verify exit=0)`);
  if (tells.length > 0) {
    const left = tellLines(stepStdout(verifyRaw, "tell-scan"));
    if (left.length > 0) log(`[${taskId}] code_tells_remaining: ${left.length} of ${tells.length} tell(s) survived REFACTOR \u2014 ${left.slice(0, 5).join("; ")}`);
  }
  return { verified: true };
}
function tellLines(stdout) {
  return parseTellScan(stdout).map((t) => `${t.file}:${t.line} ${t.tag}: ${t.text.trim()}`);
}
async function verifyWithoutRefactor(taskId, wt, cfg2, why) {
  const resetResult = await runBatch(worktreeResetSteps(wt), stageOpts("cli", { label: `refactor-reset:${taskId}`, phase: "Act", model: model("fast") }));
  const leftover = (stepStdout(resetResult, "status") || "").trim();
  log(`[${taskId}] REFACTOR: worktree reset to HEAD${leftover ? ` (WARNING: still dirty: ${leftover.split("\n").length} paths)` : ""}`);
  const verifySteps = [
    { name: "test-verify", command: testRunCommand(cfg2.testCommand, wt, "refactor-verify"), tolerant: true }
  ];
  const verifyResult = await runBatch(verifySteps, stageOpts("cli", { label: `post-refactor-verify:${taskId}`, phase: "Act", model: model("fast") }));
  if (verifyResult.missing) {
    return { verified: false, error: `refactor_verify_failed: ${why} (verify batch could not run: ${describeFailure(verifyResult, "post-refactor-verify")})` };
  }
  const exit = testExitCode(stepStdout(verifyResult, "test-verify"));
  if (exit !== 0) {
    return { verified: false, error: `refactor_verify_failed: suite red on the committed tree after ${why} (independent exit=${exit ?? "no result"})` };
  }
  return { verified: true };
}
phase("Act");
var lanes = lanePlan.lanes;
var depResolvers = {};
var depPromises = {};
for (const id of batchLaneIds) {
  depPromises[id] = new Promise((resolve) => {
    depResolvers[id] = resolve;
  });
}
log(`DAG scheduler${batchTag}: ${batchLaneIds.length} tasks`);
var dagResults = await parallel(
  batchLaneIds.map((taskId) => async () => {
    const allDeps = lanes[taskId].depends_on || [];
    const crossBatchDeps = allDeps.filter((d) => !batchLaneIds.includes(d));
    const crossBatchFailed = crossBatchDeps.filter((d) => priorFailures.includes(d));
    const crossBatchMissing = crossBatchDeps.filter(
      (d) => !priorFailures.includes(d) && !(priorCompleted || []).includes(d)
    );
    if (crossBatchFailed.length > 0 || crossBatchMissing.length > 0) {
      const failedPart = crossBatchFailed.length > 0 ? `failed [${crossBatchFailed.join(", ")}]` : "";
      const missingPart = crossBatchMissing.length > 0 ? `never executed [${crossBatchMissing.join(", ")}]` : "";
      const err = `blocked: cross-batch dep(s) ${[failedPart, missingPart].filter(Boolean).join(", ")}`;
      log(`[${taskId}] ${err}`);
      const skipResult = { task_id: taskId, status: "blocked", stage: "SKIPPED", error: err };
      depResolvers[taskId](skipResult);
      return skipResult;
    }
    const inBatchDeps = allDeps.filter((d) => batchLaneIds.includes(d));
    if (inBatchDeps.length > 0) {
      log(`[${taskId}] waiting on deps: [${inBatchDeps.join(", ")}]`);
      const depResults = await Promise.all(inBatchDeps.map((d) => depPromises[d]));
      const failedDeps = depResults.filter((r) => r.status !== "completed");
      if (failedDeps.length > 0) {
        const err = `blocked: dep(s) failed [${failedDeps.map((r) => r.task_id).join(", ")}]`;
        log(`[${taskId}] ${err}`);
        const skipResult = { task_id: taskId, status: "blocked", stage: "SKIPPED", error: err };
        depResolvers[taskId](skipResult);
        return skipResult;
      }
      const wt = worktreePaths[taskId];
      if (typeof wt === "string" && wt.startsWith("/")) {
        const depBranches = inBatchDeps.map((d) => `${cfg.epicBranch}--${d}`);
        const depMergeStepList = depMergeSteps(wt, depBranches);
        const depMerge = depMergeFromSteps(parseBatchResult(
          await resilientAgent(batchCommandPrompt(depMergeStepList), stageOpts("cli", { label: `dep-merge:${taskId}`, model: "haiku" })),
          depMergeStepList
        ), depBranches);
        if (!depMerge.ok) {
          log(`[${taskId}] ${depMerge.error}`);
          const failResult = { task_id: taskId, status: "failed", stage: "CRASH", error: depMerge.error };
          depResolvers[taskId](failResult);
          return failResult;
        }
        log(`[${taskId}] merged in-batch dep branches: [${depBranches.join(", ")}]`);
      }
    }
    log(`[${taskId}] deps satisfied \u2014 launching`);
    let result;
    try {
      const r = await runLane(taskId, lanePlan, worktreePaths, cfg);
      result = r || { task_id: taskId, status: "failed", stage: "UNKNOWN", error: "null result" };
    } catch (e) {
      const staged = e.stage;
      result = { task_id: taskId, status: "failed", stage: staged || "CRASH", error: e instanceof Error ? e.message : String(e) };
    }
    depResolvers[taskId](result);
    return result;
  })
);
var results = {};
for (let i = 0; i < batchLaneIds.length; i++) {
  results[batchLaneIds[i]] = dagResults[i];
}
return { results };
