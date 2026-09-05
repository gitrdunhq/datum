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
      const top = mod.split(".")[0];
      if (!FIRST_PARTY_PY_PACKAGES.includes(top)) continue;
      required.add(`${mod.split(".").join("/")}.py`);
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
function isRunnerRefusal(reply) {
  return REFUSAL_RE.test(reply);
}
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
  const outcome = stageFromSteps(parseBatchResult(
    await agent(batchCommandPrompt(steps), stageOpts("cli", { label: `tracker:${issueId}:${stage}`, model: model("fast") })),
    steps
  ));
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
var q2 = (s) => `"${s.replace(/"/g, '\\"')}"`;
var ereEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function catOrMissing(path) {
  return `cat ${q2(path)} 2>/dev/null || echo MISSING`;
}
function isMissing(raw) {
  return !raw || raw.trim() === "" || raw.trim() === "MISSING";
}
function laneIntakeSteps(o) {
  const steps = [];
  if (o.laneSpec) {
    steps.push({ name: "lane-spec", command: laneSpecExportCommand(o.laneSpec), tolerant: true });
    steps.push({ name: "lane-spec-bytes", command: `wc -c < ${q2(o.laneSpec.outPath)} | tr -d ' '`, tolerant: true });
    steps.push({ name: "lane-spec-sha", command: `git hash-object ${q2(o.laneSpec.outPath)}`, tolerant: true });
  }
  if (o.completionPath) steps.push({ name: "completion", command: catOrMissing(o.completionPath), tolerant: true });
  steps.push({ name: "history", command: `git -C ${q2(o.wt)} log --format="%H %s%x09%(trailers:key=Datum-Spec,valueonly,separator=%x2C)" ${q2(o.epicBranch)}..HEAD`, tolerant: true });
  if (!o.structural) {
    if (o.cleanupCmd) steps.push({ name: "cleanup", command: o.cleanupCmd, tolerant: true });
    if (o.planSkeletonPath) {
      steps.push({ name: "skeleton-plan", command: catOrMissing(o.planSkeletonPath), tolerant: true });
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
function testExitCode(stdout) {
  if (!stdout) return null;
  const matches = [...stdout.matchAll(/TEST_EXIT=(\d+)/g)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]);
}
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
  steps.push({
    name: "assert-check",
    command: o.testFiles.map((f) => o.sgPatterns.map(
      (p) => (
        // The grep fallback (no ast-grep, or ast-grep errored) is anchored to
        // a statement start: an unanchored grep matched `assert True` inside a
        // quoted fixture string of a test-detection test and failed a sound
        // RED as placeholder_assertions (caliper wf_181691ac-fbf, BUG I).
        `ast-grep --pattern '${p.pattern}' ${q2(`${o.wt}/${f}`)} 2>/dev/null || grep -nE '^[[:space:]]*${ereEscape(p.pattern)}' ${q2(`${o.wt}/${f}`)} 2>/dev/null`
      )
    ).join("\n")).join("\n") + `
BODYPATFILE=$(mktemp)
cat > "$BODYPATFILE" <<'PATTERN_EOF'
${o.testFuncBodyRegex}
PATTERN_EOF
` + o.testFiles.map(
      (f) => `grep -A1 -f "$BODYPATFILE" ${q2(`${o.wt}/${f}`)} 2>/dev/null | grep -B1 '^\\s*pass$' 2>/dev/null`
    ).join("\n"),
    tolerant: true
  });
  if (o.ownership) steps.push({ name: "ownership", command: ownershipCommand(o.wt), tolerant: true });
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
function ownershipCommand(wt) {
  return `git -C ${q2(wt)} diff --name-only HEAD~1 HEAD`;
}
function ownershipCheckSteps(wt) {
  return [{ name: "ownership", command: ownershipCommand(wt), tolerant: true }];
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
  const steps = [{ name: "ownership", command: ownershipCommand(o.wt), tolerant: true }];
  if (o.redSha) {
    steps.push({ name: "red-files", command: `git -C ${q2(o.wt)} diff-tree --no-commit-id --name-only -r ${q2(o.redSha)}`, tolerant: true });
  }
  if (o.verifyTestCmd) {
    steps.push({ name: "test-verify", command: testRunCommand(o.verifyTestCmd, o.wt, "green-verify"), tolerant: true });
  }
  return steps;
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
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- Test command comes from `.datum/config.json` `test_command` field \u2014 read it, don't guess\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500-line file cap \u2014 split via functional seams\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (from `.datum/config.json`)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Full Context\n- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and patterns\n";

// skills/src/prompts/red.md
var red_default = 'RED TDD agent. Write failing tests that prove the acceptance criteria are not yet implemented.\n\nSETUP:\n1. cd into {{wt}}\n2. Run: {{skeletonCmd}}\n3. Run: {{redCtxCmd}}\n\nTARGET CONTEXT (import guard):\nIf the preflight output at .datum/runs/*/preflight-{{taskId}}.json contains a target_context\nfield, read it. It lists which modules each target depends on. Only import modules listed as\ndependencies of the target your test file belongs to. DO NOT import modules from other targets.\n\nTASK PACKET: {{redPacketStr}}\n\nLANE SPEC FILE \u2014 the acceptance_criteria, red_note and contract_summary for this task are in the file named by the packet\'s lane_spec_file, not in the packet:\n{{laneSpecSlot}}\n\nFRAMEWORK DETECTION:\nBefore writing any test code, read ONE existing test file from the same directory as your target test files. Match its:\n- Import style (e.g. import XCTest vs import Testing, import pytest vs import unittest)\n- Test class/struct pattern (XCTestCase subclass vs @Test macro, etc.)\n- Assertion style (XCTAssertEqual vs #expect, assert vs self.assertEqual)\nIf no existing test files exist, fall back to the test_framework field in the task packet.\n\nGOAL: Write one test function per acceptance criterion. Each test must FAIL when you run it.\n\nAPPROACH:\n1. Read the acceptance_criteria (and red_note) from the lane spec file\n2. For each AC, write a test that calls the method described in the AC\n3. Assert specific expected values \u2014 not just "doesn\'t crash"\n4. Call methods that don\'t exist yet \u2014 the resulting error (AttributeError in Python, compilation error in Swift/Go, TypeError in TS) is the correct RED failure\n\nVERIFY BEFORE RUNNING TESTS:\n4b. Grep your test file(s) for new test functions: grep -c \'{{testFuncPattern}}\' {{testFilesList}}\n    Confirm you have at least one new test function per AC. If any AC lacks a test, go back and write it before proceeding.\n\nSELF-CHECK (mandatory before running tests):\n- Count how many `{{testFuncPattern}}` functions exist in each test file BEFORE your edits\n- Count how many `{{testFuncPattern}}` functions exist AFTER your edits\n- The count MUST increase by at least len(acceptance_criteria) new functions\n- If count did not increase, you FAILED \u2014 do not proceed, report success=false with failure_reason="no_new_tests_written"\n- Include both counts in test_output: "Before: N tests, After: M tests, New: M-N"\n\nAFTER WRITING:\n5. Run the suite with exactly this command: {{testRunCmd}}\n   It writes the full output to a log file, prints the last 50 lines and then `TEST_EXIT=<code>` \u2014 that code is the real exit status. Never run {{testCommand}} through a pipe into tail or grep: a pipe masks the exit code. Report the printed output in test_output (last 50 lines max) and TEST_EXIT in test_exit_code.\n6. Your new tests MUST fail. Report tests_pass=false and the exit code.\n7. Commit test files: git -C "{{wt}}" add {{testFilesList}} && {{commitCmd}}\n   Use that exact commit command \u2014 it pins the datum author identity and the Datum-Run/Datum-Lane/Datum-Stage trailers every lane commit carries. Do not change the subject or author.\n8. Report the commit SHA in commit_sha.\n\nCONSTRAINTS:\n- Append new test functions to existing test files \u2014 keep all existing tests intact\n- Only write and commit test files: {{testFilesList}}\n- OFF-LIMITS: Do NOT write any files not listed in {{testFilesList}}. Production implementation files, skeleton stubs, and non-test code are prohibited. Example of a prohibited write: NoOpPermissionService.swift \u2014 this is a production implementation file, not a test file. If it is not a test file, do not write it.\n\nBANNED PATTERNS (any of these = pipeline rejection, no exceptions):\n- Python: `assert True`, `assert 1`, `assert not False`, `pass` as only body, `raise NotImplementedError`\n- Swift: `XCTFail()` as only assertion, empty test body, `fatalError()`\n- Go: `t.Fatal("not implemented")`, `panic("not implemented")`, empty test body\n- TS/JS: `expect(true).toBe(false)`, `throw new Error("not implemented")`, empty test body\n- `assert x is not None` / trivial nil-checks as the ONLY assertion\nEach test MUST assert a specific expected value or exception type.\n';

// skills/src/prompts/red-retry.md
var red_retry_default = `RED TDD agent \u2014 RETRY. Previous attempt failed: {{failureReason}}.

First reset: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/

SETUP: {{redCtxCmd}}
TASK PACKET: {{redPacketStr}}

LANE SPEC FILE \u2014 the acceptance_criteria, red_note and contract_summary for this task are in the file named by the packet's lane_spec_file, not in the packet:
{{laneSpecSlot}}

Write simple, concrete tests. One test per acceptance criterion. Assert specific values.
Call methods that don't exist yet \u2014 the language's missing-method error (AttributeError, TypeError, compilation error, etc.) is your RED signal.
NEVER use hardcoded failure stubs (raise NotImplementedError, fatalError, panic) \u2014 test fixtures may auto-skip them.

AFTER WRITING:
1. Run the suite with exactly: {{testRunCmd}}
   Read the real exit status from the printed TEST_EXIT line (the suite output is written to a log file and TEST_EXIT is the real exit code \u2014 never pipe the test command into tail or grep, a pipe masks the exit code). Tests must fail. Report tests_pass=false and test_exit_code.
2. Commit: git -C "{{wt}}" add {{testFilesList}} && {{commitCmd}}
   Use that exact commit command (datum author identity + Datum-* trailers); do not change the subject or author.
3. Report commit_sha.

Only write and commit test files: {{testFilesList}}. OFF-LIMITS: Do NOT write any files not listed in {{testFilesList}}. Production implementation files, skeleton stubs, and non-test code are strictly prohibited (e.g., NoOpPermissionService.swift is a production impl file \u2014 do not write it).
`;

// skills/src/prompts/green.md
var green_default = 'GREEN TDD agent. Make the failing tests pass with minimum implementation code.\n\nSETUP (run first): {{greenCtxCmd}}\nTASK PACKET: {{greenPacketStr}}\n\nLANE SPEC FILE \u2014 the acceptance_criteria, red_note and contract_summary for this task are in the file named by the packet\'s lane_spec_file, not in the packet:\n{{laneSpecSlot}}\n\nCONTEXT MANAGEMENT:\nBefore reading implementation files, use headroom_compress on any file longer than 100 lines.\nThis saves context for reasoning. Use headroom_retrieve with a targeted query when you need\nspecific sections back (e.g. query="function signature" or query="class definition").\n\nTARGET CONTEXT (import guard):\nIf target_context is present in the task packet, only use imports that are valid for the target.\nCheck the dependency list before adding any import statement. DO NOT import modules that are\nnot listed as dependencies of the target you are implementing in.\n\nAPPROACH:\n1. Read test_signal carefully \u2014 each error tells you exactly what to implement\n2. Read impl_stubs \u2014 fill in function bodies, do not create new files\n3. Check existing_api \u2014 extend it, do not replace it\n4. Implement only what the errors require\n\nAFTER WRITING:\n5. Run the suite with exactly: {{testRunCmd}}\n   Read the real exit status from the printed TEST_EXIT line (the suite output is written to a log file and TEST_EXIT is the real exit code \u2014 never pipe the test command into tail or grep, a pipe masks the exit code). ALL tests must pass (TEST_EXIT=0). Report tests_pass and test_exit_code from it.\n6. If test output exceeds 50 lines, compress it with headroom_compress and include the hash in test_output.\n7. Commit: git -C "{{wt}}" add {{implFilesList}} && {{commitCmd}}\n   Use that exact commit command \u2014 it pins the datum author identity and the Datum-Run/Datum-Lane/Datum-Stage trailers every lane commit carries. Do not change the subject or author.\n8. Report commit_sha.\n\nPACKET FIELDS:\n- test_signal: error messages from failing tests \u2014 your implementation spec\n- lane_spec_file: the worktree file holding acceptance_criteria, red_note and contract_summary (function signatures extracted from the criteria)\n- impl_stubs: skeleton files \u2014 fill these in\n- existing_api: current module code shape\n\nCONSTRAINTS:\n- Only write and commit implementation files: {{implFilesList}}\n- Never edit, delete or `git add` a test file, and never `git commit --amend` or rewrite the RED commit: a GREEN commit whose diff touches a test file fails the lane as green_edited_tests. If a test is wrong, report it in failure_reason instead of changing it.\n- If making tests pass requires modifying files outside {{implFilesList}} (e.g. the RED test calls an existing class/function with arguments its current signature rejects, and that definition is outside your allowed files), do NOT write those files and do NOT keep retrying. Return the structured blocked result: {"success": false, "tests_pass": false, "committed": false, "status": "blocked", "needs_write": ["<repo-relative path>", ...], "reason": "<which test, which symbol, why it cannot pass within the allowed files>"}. The orchestrator turns this into a single lead-approval question (or auto-widens in yolo mode) \u2014 one honest blocked result beats three blind attempts.\n- Package.swift changes are FORBIDDEN in behavioral lanes. If a new dependency is needed, report scope_exceeded with \'Package.swift\' and a description of the required dependency.\n- For Swift: target-scoped test command (with --filter) is already provided. Do NOT run a broader test command that compiles unrelated targets.\n';

// skills/src/prompts/green-retry.md
var green_retry_default = 'GREEN TDD agent \u2014 RETRY. Previous attempt failed: {{failureReason}}.\n\nFirst reset: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/\n\nSETUP: {{greenCtxCmd}}\nTASK PACKET: {{greenRetryPacketStr}}\n\nLANE SPEC FILE \u2014 the acceptance_criteria, red_note and contract_summary for this task are in the file named by the packet\'s lane_spec_file, not in the packet:\n{{laneSpecSlot}}\n\nCONTEXT MANAGEMENT:\nUse headroom_compress on any file or test output longer than 100 lines.\nUse headroom_retrieve with a targeted query to pull back only what you need.\n\nRead test_signal errors carefully. Read existing implementation files first. Fix specific failures.\n\nAFTER WRITING:\n1. Run the suite with exactly: {{testRunCmd}}\n   Read the real exit status from the printed TEST_EXIT line (the suite output is written to a log file and TEST_EXIT is the real exit code \u2014 never pipe the test command into tail or grep, a pipe masks the exit code). All tests must pass (TEST_EXIT=0). Report tests_pass and test_exit_code.\n2. If test output exceeds 50 lines, compress it with headroom_compress and include the hash in test_output.\n3. Commit: git -C "{{wt}}" add {{implFilesList}} && {{commitCmd}}\n   Use that exact commit command (datum author identity + Datum-* trailers); do not change the subject or author.\n4. Report commit_sha.\n\nOnly write and commit implementation files: {{implFilesList}}\n- Never edit, delete or `git add` a test file, and never `git commit --amend` or rewrite the RED commit: a GREEN commit whose diff touches a test file fails the lane as green_edited_tests. If a test is wrong, report it in failure_reason instead of changing it.\nIf the tests cannot pass without writing a file outside that list, do NOT write it \u2014 return {"success": false, "tests_pass": false, "committed": false, "status": "blocked", "needs_write": ["<paths>"], "reason": "<why>"} instead.\n';

// skills/src/prompts/refactor.md
var refactor_default = 'REFACTOR agent. Clean up the implementation without changing behavior.\n\nSETUP (run first): {{refactorCtxCmd}}\nTASK PACKET: {{refactorPacketStr}}\n\nSCOPE:\n- Improve naming, reduce duplication, simplify logic, remove dead code\n- Write to allowed files only\n\nAFTER WRITING:\n1. Run the suite with exactly: {{testRunCmd}}\n   Read the real exit status from the printed TEST_EXIT line (the suite output is written to a log file and TEST_EXIT is the real exit code \u2014 never pipe the test command into tail or grep, a pipe masks the exit code). Every test must still pass (TEST_EXIT=0). Report tests_pass and test_exit_code.\n2. If tests pass: git -C "{{wt}}" add {{allFilesList}} && {{commitCmd}}\n   Use that exact commit command \u2014 same datum author identity and Datum-Run/Datum-Lane/Datum-Stage trailers as the RED and GREEN commits on this branch, so a later reader can attribute it to this lane instead of mistaking it for a stray concurrent writer. Do not change the subject or author.\n3. If tests FAIL: report tests_pass=false, do NOT commit. Report failure_reason.\n\nCONSTRAINTS:\n- Tests are a one-way ratchet: do not remove, skip, weaken, or disable any test\n- Do not add new features \u2014 only improve existing code\n';

// skills/src/prompts/reflect.md
var reflect_default = 'TEST QUALITY evaluator. Read the test files and assess coverage of the acceptance criteria.\nRead-only \u2014 do NOT write or modify any files.\n\nRead these test files in "{{wt}}": {{testFiles}}\n\nIMPORTANT: If the test file contains tests from prior lanes (i.e., test functions that do NOT relate to any of the acceptance criteria below), IGNORE those tests entirely. Only evaluate test functions whose names and assertions directly relate to the acceptance criteria listed below. Tests for unrelated functionality should neither count for nor against the score.\n\nACCEPTANCE CRITERIA to cover \u2014 the `acceptance_criteria` array in the lane spec file:\n{{laneSpecSlot}}\n\nEVALUATE:\n1. For each AC, identify which test function covers it (cite the function name)\n2. Check assertion strength: does each test assert specific values, not just "no error"?\n3. Identify gaps: ACs with no test, tests with weak assertions, missing negative/edge cases\n4. List each gap found\n\nSCORING RUBRIC:\n- 9-10: Every AC has a strong test with specific assertions\n- 7-8: All ACs covered but some assertions could be stronger\n- 5-6: Most ACs covered, 1-2 gaps\n- 3-4: Significant gaps \u2014 multiple ACs untested or only smoke-tested\n- 1-2: Tests exist but barely cover the ACs\n- 0: No meaningful test coverage\n\nReturn reasoning FIRST (with evidence), then gaps, then score.\n';

// skills/src/prompts/skeptic-base.md
var skeptic_base_default = "Adversarial code reviewer. Find bugs the test suite misses.\n\nWorking directory: \"{{wt}}\"\nImplementation files: {{implFiles}}\nTest files: {{testFiles}}\nTest command: {{testCommand}}\nAcceptance criteria \u2014 the `acceptance_criteria` array in the lane spec file:\n{{laneSpecSlot}}\n\nTOOLS (use before manual reading):\n1. `ast-grep --pattern '<pattern>' {{implFiles}}` \u2014 find structural anti-patterns:\n   - Unchecked return values: `ast-grep --pattern '$_ = $F($$$)' <file>` then check if result is used\n   - Bare exception handlers that swallow errors (Python: `except: pass`, Swift: empty `catch {}`, Go: ignoring `err`, TS: empty `catch {}`):\n     `ast-grep --pattern 'except: pass' <file>` (Python), `ast-grep --pattern 'catch { }' <file>` (Swift/TS)\n2. headroom_compress on each file after reading, then query-retrieve for specific sections\n\nCONTEXT MANAGEMENT:\nAfter reading each file, compress it with headroom_compress. This frees context for\ndeeper analysis. Use headroom_retrieve with a query (e.g. query=\"error handling\" or\nquery=\"return value\") to pull back specific sections when investigating a potential bug.\n\nFor each bug found, provide:\n- description: what is wrong\n- evidence: the specific input, file, or line that demonstrates the bug\n- severity: critical / high / medium / low\n\nRead the implementation and tests. Run the test command to understand current coverage.\nOnly report bugs you can demonstrate with evidence. \"This might be a problem\" is not a bug.\n";

// skills/src/prompts/skeptic-edge.md
var skeptic_edge_default = "LENS: Edge cases.\nTest these inputs against the implementation:\n- Empty inputs, None/null values, single-element collections\n- Boundary values (0, -1, max int, empty string)\n- Off-by-one errors in loops and ranges\nFor each finding: describe the input, what happens, what should happen.\n";

// skills/src/prompts/skeptic-error.md
var skeptic_error_default = "LENS: Error paths.\nCheck these failure modes against the implementation:\n- What happens when preconditions are violated?\n- Are exceptions caught and handled, or do they propagate silently?\n- Are there state transitions that can reach invalid states?\nFor each finding: name the error condition and trace what happens.\n";

// skills/src/prompts/skeptic-contract.md
var skeptic_contract_default = "LENS: Behavioral contracts.\nCompare implementation behavior against the acceptance criteria:\n- Does the implementation satisfy the AC intent, not just the specific test inputs?\n- Are there inputs that satisfy the AC literally but produce wrong results?\n- Do the tests only cover the happy path while the AC implies broader coverage?\nFor each finding: cite the AC, the gap, and a concrete input that exposes it.\n";

// skills/src/prompts/refactor-check.md
var refactor_check_default = 'CODE QUALITY gate. Decide if the implementation needs refactoring \u2014 be conservative.\nRead-only \u2014 do NOT write or modify any files.\n\nRead these files in "{{wt}}": {{allFiles}}\n\nReturn should_refactor=true ONLY if you find one of these concrete problems:\n- Duplicated logic (same code block copy-pasted in 2+ places)\n- Function longer than 50 lines that could be split at a clear seam\n- Dead code introduced by this task (unused imports, unreachable branches)\n- Misleading names that contradict what the code does\n\nMinor style issues (single variable name, one extra blank line) are NOT worth refactoring.\nIf the code works and reads clearly, return should_refactor=false.\n\nIf should_refactor=true, the reason must name the specific file and problem.\n';

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function withLaneSpec(template, vars, laneSpec) {
  return PREAMBLE + renderPrompt(template, { ...vars, laneSpecSlot: contextSlot(laneSpec) }) + contextWitnessInstruction([laneSpec]);
}
function redPrompt(vars) {
  const { laneSpec, ...rest } = vars;
  return withLaneSpec(red_default, rest, laneSpec);
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
function reflectPrompt(vars) {
  const { laneSpec, ...rest } = vars;
  return withLaneSpec(reflect_default, rest, laneSpec);
}
function skepticBasePrompt(vars) {
  const { laneSpec, ...rest } = vars;
  return withLaneSpec(skeptic_base_default, rest, laneSpec);
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
async function verifyFileOwnership2(taskId, wt, stage, allowedFiles, forbiddenFiles) {
  const steps = ownershipCheckSteps(wt);
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
    assertReadWitness([specFile], parsed);
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
  const testFuncDiffRegex = laneLanguage === "swift" ? "[+][[:space:]]*(@Test|func test)" : laneLanguage === "go" ? "[+][[:space:]]*func Test" : laneLanguage === "typescript" || laneLanguage === "javascript" ? "[+][[:space:]]*(it\\(|test\\(|describe\\()" : "[+][[:space:]]*def test_";
  const testFuncGrepRegex = laneLanguage === "swift" ? "@Test|func test" : laneLanguage === "go" ? "func Test" : laneLanguage === "typescript" || laneLanguage === "javascript" ? "it\\(|test\\(|describe\\(" : "def test_|async def test_";
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
    laneSpec: { planPath: `${wt}/.datum/lane-plan.json`, taskId, outPath: `${wt}/.datum/lane-spec.json`, expectHash: digestSpecHash(lanePlan2, taskId) }
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
    const r = await runRefactor(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg, specFile);
    if (!r || !r.verified) return { task_id: taskId, status: "failed", stage: "REFACTOR", error: r?.error || "refactor failed" };
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
      const r = await runRefactor(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg, specFile);
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
  const sgPatterns = laneLanguage === "swift" ? [
    { pattern: "XCTFail", name: "XCTFail" },
    { pattern: "fatalError", name: "fatalError" }
  ] : laneLanguage === "go" ? [
    { pattern: 't.Fatal("not implemented")', name: "t.Fatal placeholder" },
    { pattern: 'panic("not implemented")', name: "panic placeholder" }
  ] : laneLanguage === "typescript" || laneLanguage === "javascript" ? [
    { pattern: "throw new Error", name: "throw placeholder" },
    { pattern: "expect(true).toBe(false)", name: "forced failure" }
  ] : [
    { pattern: "assert True", name: "assert True" },
    { pattern: "assert 1", name: "assert 1" },
    { pattern: "raise NotImplementedError", name: "raise NotImplementedError" }
  ];
  const postRed = postRedSteps({
    wt,
    testFiles,
    acCount,
    testFuncDiffRegex,
    sgPatterns,
    testFuncBodyRegex,
    testFuncGrepRegex,
    ownership: deterministic,
    verifyTestCmd: scopedTestCmd,
    baseRef: cfg2.epicBranch
  });
  const postRedRaw = await runBatch(postRed, stageOpts("cli", { label: `post-red:${taskId}`, phase: "Act", model: model("fast") }));
  const postRedResult = postRedRaw;
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
        error: `count_gate_no_output: test-count-check returned null \u2014 cannot verify ${acCount} new test functions were committed`
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
  const redOwnership = deterministic ? ownershipFromStdout(stepStdout(postRedResult, "ownership"), testFiles, implFiles) : await verifyFileOwnership2(taskId, wt, "RED", testFiles, implFiles);
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
  const greenModel = lane.green_model || model("balanced");
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
    if (decision.blocked) {
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
  const postGreenVerify = postGreenSteps({ wt, verifyTestCmd: scopedTestCmd });
  const postGreenVerifyRaw = await runBatch(postGreenVerify, stageOpts("cli", { label: `post-green-verify:${taskId}`, phase: "Act", model: model("fast") }));
  const postGreenVerifyResult = postGreenVerifyRaw;
  const greenVerifyExit = testExitCode(stepStdout(postGreenVerifyResult, "test-verify"));
  const greenEnvMissing = testEnvMissing(stepStdout(postGreenVerifyResult, "test-verify"));
  if (greenEnvMissing) {
    log(`[${taskId}] test_env_missing: ${greenEnvMissing}`);
    return { task_id: taskId, status: "failed", stage: "GREEN", error: `test_env_missing: ${greenEnvMissing} \u2014 the lane worktree has no test environment; GREEN's verify is not evidence` };
  }
  if (greenVerifyExit !== 0) {
    log(`[${taskId}] GREEN VERIFY FAILED: independent re-run of the test suite exited ${greenVerifyExit ?? "null"} (expected 0), regardless of agent self-report (tests_pass=${green?.tests_pass})`);
    return {
      task_id: taskId,
      status: "failed",
      stage: "GREEN",
      error: `green_verify_failed: independent test-verify step exit=${greenVerifyExit ?? "null"} (agent self-reported tests_pass=${green?.tests_pass})`
    };
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
    return verifyFileOwnership2(taskId, wt, "GREEN", implFiles, testFiles);
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
    const retryVerify = await runBatch(postGreenSteps({ wt, verifyTestCmd: scopedTestCmd }), stageOpts("cli", { label: `post-green-tests-retry-verify:${taskId}`, phase: "Act", model: model("fast") }));
    const retryExit = testExitCode(stepStdout(retryVerify, "test-verify"));
    if (!green || !green.success || retryExit !== 0) {
      return { task_id: taskId, status: "failed", stage: "GREEN", error: `${hint} \u2014 retry ${!green ? "returned nothing" : !green.success ? `failed: ${green.failure_reason || "no reason"}` : `did not pass the suite (exit=${retryExit ?? "null"})`}` };
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
  let skeptic = await runSkepticPanel(taskId, wt, implFiles, testFiles, scopedTestCmd, specFile);
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
    const retryVerifySteps = postGreenSteps({ wt, verifyTestCmd: scopedTestCmd });
    const retryVerifyRaw = await runBatch(retryVerifySteps, stageOpts("cli", { label: `post-green-skeptic-retry-verify:${taskId}`, phase: "Act", model: model("fast") }));
    const retryVerifyExit = testExitCode(stepStdout(retryVerifyRaw, "test-verify"));
    if (retryVerifyExit !== 0 || !green || !green.success) {
      const first = confirmedBugs[0];
      const summary = first ? first.description : "GREEN retry did not produce a passing, committed fix";
      log(`[${taskId}] SKEPTIC RETRY FAILED: independent test-verify exit=${retryVerifyExit ?? "null"}`);
      return {
        task_id: taskId,
        status: "failed",
        stage: "GREEN",
        error: `skeptic_broken: ${confirmedBugs.length} confirmed bugs \u2014 ${summary}`
      };
    }
    skeptic = await runSkepticPanel(taskId, wt, implFiles, testFiles, scopedTestCmd, specFile);
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
  const refResult = await runRefactor(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg, specFile);
  if (!refResult || !refResult.verified) {
    return { task_id: taskId, status: "failed", stage: "REFACTOR", error: refResult?.error || "refactor failed" };
  }
  log(`[${taskId}] === LANE COMPLETE ===`);
  await updateStage(issueId, "done");
  return followUps > 0 ? { task_id: taskId, status: "completed", stage: "REFACTOR", follow_ups: followUps } : { task_id: taskId, status: "completed", stage: "REFACTOR" };
}
async function runSkepticPanel(taskId, wt, implFiles, testFiles, scopedTestCmd, specFile) {
  const base = skepticBasePrompt({
    wt,
    implFiles: implFiles.join(", "),
    testFiles: testFiles.join(", "),
    testCommand: scopedTestCmd,
    laneSpec: specFile
  });
  const lenses = skepticLenses();
  const skepticResults = await parallel(
    lenses.map(
      (lens) => () => agent(base + lens.prompt, stageOpts("skeptic", { label: `skeptic-${lens.key}:${taskId}`, phase: "Act", model: lens.model, schema: SKEPTIC_SCHEMA }))
    )
  );
  let verifiedLenses = 0;
  for (let i = 0; i < skepticResults.length; i++) {
    const r = skepticResults[i];
    if (r === null) continue;
    const w = verifyReadWitness([specFile], r);
    if (w.ok) {
      verifiedLenses++;
      continue;
    }
    log(`[${taskId}] skeptic_lens_unverified: ${taskId} \u2014 lens ${lenses[i].key} did not evidence reading ${specFile.path} (${w.tooShort.length ? "prefix too short" : w.mismatched.length ? "wrong prefix" : "no witness"}); its ${r.verdict} verdict and ${(r.bugs_found || []).length} bug(s) are dropped from the vote`);
    skepticResults[i] = null;
  }
  if (verifiedLenses === 0) {
    const err = new Error(`context_read_unverified: ${specFile.path} \u2014 no skeptic lens evidenced reading the lane spec; the panel is void`);
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
async function runRefactor(taskId, lane, testFiles, implFiles, wt, cfg2, specFile) {
  log(`[${taskId}] REFACTOR: checking if needed`);
  const preCheck = await resilientAgent(
    refactorCheckPrompt({ wt, allFiles: [...implFiles, ...testFiles].join(", ") }),
    stageOpts("reader", { label: `refactor-check:${taskId}`, phase: "Act", model: model("fast"), schema: REFACTOR_CHECK_SCHEMA, maxRetries: 1 })
  );
  if (!preCheck) {
    log(`[${taskId}] refactor_check_no_result: refactor-check agent returned nothing on both attempts \u2014 skipping the optional REFACTOR stage`);
    return { verified: true };
  }
  if (!preCheck.should_refactor) {
    log(`[${taskId}] REFACTOR: skipped (${preCheck.reason || "nothing to improve"})`);
    return { verified: true };
  }
  log(`[${taskId}] REFACTOR: proceeding (${preCheck.reason})`);
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
      commitCmd: laneCommitCommand({ wt, taskId, stage: "REFACTOR", runId: cfg2.runId })
    }),
    stageOpts("refactor", { label: `refactor:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA, worktree: wt })
  );
  if (!refactor) {
    const failure = "refactor_no_result: REFACTOR agent returned nothing (likely the maxTurns cap in agents/datum-refactor.md, an API error, or a skip)";
    const resetStepList = worktreeResetSteps(wt);
    const resetResult = await runBatch(resetStepList, stageOpts("cli", { label: `refactor-reset:${taskId}`, phase: "Act", model: model("fast") }));
    const leftover = (stepStdout(resetResult, "status") || "").trim();
    log(`[${taskId}] REFACTOR: ${failure}; worktree reset to HEAD${leftover ? ` (WARNING: still dirty: ${leftover.split("\n").length} paths)` : ""} \u2014 treating as no refactor applied (optional stage)`);
    const noRefactorVerifySteps = [
      { name: "test-verify", command: testRunCommand(cfg2.testCommand, wt, "refactor-verify"), tolerant: true }
    ];
    const noRefactorVerifyRaw = await runBatch(noRefactorVerifySteps, stageOpts("cli", { label: `post-refactor-verify:${taskId}`, phase: "Act", model: model("fast") }));
    const noRefactorVerifyResult = noRefactorVerifyRaw;
    if (noRefactorVerifyResult.missing) {
      return { verified: false, error: `${failure} (verify batch could not run: ${describeFailure(noRefactorVerifyResult, "post-refactor-verify")})` };
    }
    const noRefactorVerifyExit = testExitCode(stepStdout(noRefactorVerifyResult, "test-verify"));
    if (noRefactorVerifyExit !== 0) {
      return { verified: false, error: `${failure} (suite red after reset: independent exit=${noRefactorVerifyExit ?? "no result"})` };
    }
    return { verified: true };
  }
  if (!refactor.success) {
    if (refactor.failure_reason?.toLowerCase().includes("nothing to")) {
      log(`[${taskId}] REFACTOR: nothing to change`);
      return { verified: true };
    }
    log(`[${taskId}] REFACTOR FAILED: ${refactor.failure_reason || "unknown"}`);
    return { verified: false, error: `refactor_failed: ${refactor.failure_reason || "unknown"}` };
  }
  const verifySteps = [
    { name: "test-verify", command: testRunCommand(cfg2.testCommand, wt, "refactor-verify"), tolerant: true }
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
