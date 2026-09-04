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
function parseAgentJson(text, fallback) {
  if (!text || typeof text !== "string") return fallback;
  const fenced = text.trim().match(/^```[a-z]*\n([\s\S]*)\n```$/);
  const cleaned = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(cleaned);
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
  return found ? best : fallback;
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
var state = { agentTypes: true, hooksInstalled: false };
function configureAgentTypes(opts) {
  if (typeof opts.agentTypes === "boolean") state.agentTypes = opts.agentTypes;
  if (typeof opts.hooksInstalled === "boolean") state.hooksInstalled = opts.hooksInstalled;
}

// skills/src/datum-review.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
configureAgentTypes(a.agentTypes && typeof a.agentTypes === "object" ? a.agentTypes : {});
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
    log(`${DOMAINS[i].domain}: (null)`);
    continue;
  }
  const parsed = typeof result === "string" ? parseAgentJson(result, { domain: DOMAINS[i].domain, findings: [] }) : result;
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
  ...deduped.map((f) => `| ${f.id} | ${f.severity} | ${f.file} | ${f.line} | ${f.description} | ${f.suggestion} |`),
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
return {
  totalFindings: deduped.length,
  criticalFindings: critical.length,
  canMerge: critical.length === 0
};
