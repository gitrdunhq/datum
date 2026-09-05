// @generated — DO NOT EDIT. Source: skills/src/datum-review.ts
export const meta = {
  name: "datum-review",
  description: "Parallel review swarm \u2014 4 domain agents fan out, synthesize findings",
  phases: [
    { title: "Review", detail: "4 parallel domain reviewers" },
    { title: "Synthesize", detail: "dedup findings, render + commit REVIEW-REPORT.md" }
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

// skills/src/prompts/review-domain.md
var review_domain_default = 'You are the {{domain}} reviewer. Find issues in your domain ONLY.\n\nRead the diff using difftastic for structural analysis:\n`difft --display side-by-side-show-both $(git merge-base HEAD main) HEAD 2>/dev/null || git diff main...HEAD`\n\nIf difft output is too large, use ast-grep to search changed files for domain-specific patterns:\n{{domainFocus}}\n\nDOMAIN FOCUS \u2014 {{domainFocus}}\n\nFor each finding provide:\n- id: {{domainPrefix}}-NNN\n- severity: critical / high / medium / low / info\n- file: the path\n- line: the line number (integer)\n- description: what is wrong\n- suggestion: how to fix\n\nRULES:\n- Only report findings in your domain \u2014 do not cross into other reviewers\' territory\n- Every finding must have evidence (file + line). No speculation.\n- Use headroom_compress on the diff if it exceeds 200 lines, then query-retrieve per file.\n\nReturn JSON:\n{\n  "domain": "{{domain}}",\n  "findings": [\n    {"id": "{{domainPrefix}}-001", "severity": "high", "file": "...", "line": 0, "description": "...", "suggestion": "..."}\n  ]\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/review-correctness-spec-verify.md
var review_correctness_spec_verify_default = 'You are the Correctness reviewer. Your job: does the implementation actually\nmatch SPEC.md and its acceptance criteria? Adjudicate \u2014 do not just hunt for\nbugs.\n\nThis follows the spec-verify skill\'s method. The failure mode it guards\nagainst is a confident overall impression: reading a diff and a spec together\nand forming a general sense that "looks good" almost always rounds every\nindividual requirement up to a pass, because the impression is dominated by\nwhatever was most prominent in the diff. Per-requirement isolation and named\nevidence exist to stop that impression from becoming the answer.\n\n## Step 1 \u2014 resolve the diff\n\n`git diff $(git merge-base HEAD main)...HEAD` (fall back to `git diff main...HEAD`\nor the working tree if no merge-base is found \u2014 note which in your report).\n\n## Step 2 \u2014 read SPEC.md\n\nRead "docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md". Extract the numbered\nitems in its Requirements section. Skip any item explicitly marked superseded.\n\n## Step 3 \u2014 adjudicate ONE requirement at a time\n\nDo not scan the whole diff and form a general impression, then assign verdicts\nto match it. Handle exactly one requirement at a time: read it, decide what\nevidence would settle it, go find that evidence in the diff or the surrounding\nfile, write the verdict, then move to the next one.\n\n**Name the evidence before the verdict.** Write down the file:line (or files\nyou read) that settles the requirement BEFORE deciding PASS or FAIL. Deciding\nthe verdict first and then looking for support produces support \u2014 the order\nmatters.\n\nThe diff is not always sufficient. When a requirement concerns behavior in\ncode the diff only touches at the edges, read the surrounding file too.\nVerifying against the diff alone produces false FAILs on things that were\nalready true before this change.\n\n### Verdicts\n\n- **PASS** \u2014 the named evidence satisfies the requirement.\n- **FAIL** \u2014 the named evidence contradicts it, or the requirement asks for\n  something the change plainly does not do.\n- **UNVERIFIABLE** \u2014 no evidence in the diff or the tree could settle it,\n  because of how the requirement is worded (e.g. "the code is maintainable").\n  This is a spec-quality problem, not an implementation problem \u2014 report it as\n  info-severity, not high/critical.\n\nA requirement with no named evidence is not a verdict, it is an impression \u2014\nnever emit PASS/FAIL without a concrete file:line or "read: <file>" citation.\n\n## Step 4 \u2014 scope creep\n\nNote any file or behavior the diff touches that is not tied to any\nrequirement. Report these as separate low/info-severity findings \u2014 they are\nnot necessarily wrong, but nobody asked for them and a reviewer should see\nthem named explicitly.\n\n## Output\n\nMap your adjudication onto the same JSON contract every other domain\nreviewer uses, so it merges into REVIEW-REPORT.md unchanged:\n\n- Each FAIL becomes one finding, severity "high" (or "critical" if it\'s a\n  MUST-priority requirement that\'s plainly unmet).\n- Each UNVERIFIABLE becomes one finding, severity "info", flagging the\n  requirement\'s wording as unverifiable rather than the code as wrong.\n- Each scope-creep item becomes one finding, severity "low".\n- PASS requirements produce no finding (do not report passes as findings).\n\nFor every finding, `description` MUST include the requirement number and the\nverdict (e.g. "R-003: FAIL \u2014 ...", "R-005: UNVERIFIABLE \u2014 ...",\n"scope-creep: ..."), and `file`/`line` MUST point at the named evidence.\n\nReturn JSON:\n{\n  "domain": "Correctness",\n  "findings": [\n    {"id": "CORR-001", "severity": "high", "file": "...", "line": 0, "description": "R-003: FAIL \u2014 ...", "suggestion": "..."}\n  ]\n}\n\nOutput raw JSON only. No markdown fences.\n';

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
function stageOpts(stage, extra = {}) {
  if (!configured) {
    throw new Error(
      `agent_types_unconfigured: stageOpts('${stage}'${extra.label ? `, ${extra.label}` : ""}) called before configureAgentTypes() \u2014 configure from args/config first, or use bootstrapOpts() for the read that has to precede configuration`
    );
  }
  if (!state.agentTypes) return { ...extra };
  return { ...extra, agentType: AGENT_TYPE_TABLE[stage] };
}

// skills/src/shared/batch.ts
var NAME_RE = /^[a-z][a-z0-9-]*$/;
function validateBatchSteps(steps) {
  if (steps.length === 0) throw new Error("batch: no steps");
  const seen2 = /* @__PURE__ */ new Set();
  for (const s of steps) {
    if (!NAME_RE.test(s.name)) throw new Error(`batch: invalid step name "${s.name}"`);
    if (seen2.has(s.name)) throw new Error(`batch: duplicate step name "${s.name}"`);
    seen2.add(s.name);
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
  if (!Array.isArray(arr)) return { steps: [], failed: null, missing: true };
  const results = arr.map(asStepResult).filter((r) => r !== null);
  const tolerant = new Set(steps.filter((s) => s.tolerant).map((s) => s.name));
  const failed = results.find((r) => r.exit_code !== 0 && !tolerant.has(r.name)) ?? null;
  return { steps: results, failed, missing: false };
}
function stepResult(r, name) {
  return r.steps.find((s) => s.name === name) ?? null;
}
function describeFailure(r, label) {
  if (r.missing) return `${label}: batch agent returned no parseable result`;
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

// skills/src/datum-review.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
if (a.agentTypes && typeof a.agentTypes === "object") configureAgentTypes(a.agentTypes);
else configureAgentTypes({});
setBatchCacheKey(a.configFingerprint || "");
var DOMAINS = [
  { domain: "Security", prefix: "SEC", focus: "OWASP top 10, injection, auth bypass, secrets exposure, unsafe deserialization", model: model("balanced") },
  { domain: "Performance", prefix: "PERF", focus: "Hot paths, N+1 queries, unbounded loops, missing pagination, excessive allocations", model: model("fast") },
  { domain: "Architecture", prefix: "ARCH", focus: "Layer violations, tight coupling, dependency direction, abstraction leaks", model: model("fast") },
  { domain: "Correctness", prefix: "CORR", focus: "Does implementation match SPEC and ACs? Off-by-one, null handling, edge cases", model: model("balanced") }
];
phase("Review");
var reviewResults = await parallel(
  DOMAINS.map(
    (d) => () => agent(
      d.domain === "Correctness" ? review_correctness_spec_verify_default : renderPrompt(review_domain_default, { domain: d.domain, domainPrefix: d.prefix, domainFocus: d.focus }),
      { label: `review-${d.domain.toLowerCase()}`, phase: "Review", model: d.model }
    )
  )
);
var allFindings = [];
for (let i = 0; i < DOMAINS.length; i++) {
  const result = reviewResults[i];
  if (!result) {
    throw new Error(`agent_output_unparseable: review-${DOMAINS[i].domain.toLowerCase()} \u2014 (no result)`);
  }
  const parsed = typeof result === "string" ? parseAgentJsonStrict(result, `review-${DOMAINS[i].domain.toLowerCase()}`) : result;
  log(`${parsed.domain}: ${parsed.findings.length} findings`);
  for (const f of parsed.findings) {
    log(`  [${f.severity}] ${f.id}: ${f.description.slice(0, 80)}`);
    allFindings.push(f);
  }
}
phase("Synthesize");
var seen = /* @__PURE__ */ new Set();
var deduped = [];
for (const f of allFindings) {
  const key = `${f.file}:${f.line}:${f.description.slice(0, 40)}`;
  if (!seen.has(key)) {
    seen.add(key);
    deduped.push(f);
  }
}
var critical = deduped.filter((f) => f.severity === "critical" || f.severity === "high");
log(`Findings: ${deduped.length} unique (${critical.length} high/critical)`);
var reportLines = [
  "# Review Report\n",
  `**Findings:** ${deduped.length} unique (${critical.length} high/critical)
`,
  "## Findings\n",
  "| ID | Severity | File | Line | Description | Suggestion |",
  "|---|---|---|---|---|---|",
  ...deduped.map((f) => `| ${f.id} | **${f.severity}** | ${f.file} | ${f.line} | ${f.description} | ${f.suggestion} |`),
  ""
];
await agent(
  `Write this content to "docs/epics/$(git rev-parse --abbrev-ref HEAD)/REVIEW-REPORT.md" (create dirs if needed).
Commit: git add "docs/epics/$(git rev-parse --abbrev-ref HEAD)/REVIEW-REPORT.md" && git commit -m "review: REVIEW-REPORT.md (${deduped.length} findings)"

CONTENT:
${reportLines.join("\n")}`,
  { label: "commit-report", model: model("fast") }
);
if (critical.length > 0) log(`${critical.length} high/critical \u2014 remediation needed`);
var gateStepList = gateSteps("review", yolo ? " --approve" : "");
var gate = parseGateResult(parseBatchResult(
  await agent(batchCommandPrompt(gateStepList), stageOpts("cli", { label: "gate", model: model("fast") })),
  gateStepList
));
if (gate.passed) log("Review gate PASSED");
else log(`Review gate: ${gate.message || "needs review"}${gate.needsHuman ? " (needs human approval)" : ""}${gate.hardStop ? " (hard stop)" : ""}`);
return {
  totalFindings: deduped.length,
  criticalFindings: critical.length,
  canMerge: critical.length === 0,
  gatePassed: gate.passed,
  gateMessage: gate.message,
  gateNeedsHuman: gate.needsHuman
};
