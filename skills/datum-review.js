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
function parseAgentJson(text, fallback) {
  if (!text || typeof text !== "string") return fallback;
  const fenced = text.trim().match(/^```[a-z]*\n([\s\S]*)\n```$/);
  const cleaned = (fenced ? fenced[1] : text).trim();
  const start = cleaned.search(/[{[]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (start === -1 || end === -1) return fallback;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return fallback;
  }
}
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
}

// skills/src/prompts/review-domain.md
var review_domain_default = 'You are the {{domain}} reviewer. Find issues in your domain ONLY.\n\nRead the diff using difftastic for structural analysis:\n`difft --display side-by-side-show-both $(git merge-base HEAD main) HEAD 2>/dev/null || git diff main...HEAD`\n\nIf difft output is too large, use ast-grep to search changed files for domain-specific patterns:\n{{domainFocus}}\n\nDOMAIN FOCUS \u2014 {{domainFocus}}\n\nFor each finding provide:\n- id: {{domainPrefix}}-NNN\n- severity: critical / high / medium / low / info\n- file: the path\n- line: the line number (integer)\n- description: what is wrong\n- suggestion: how to fix\n\nRULES:\n- Only report findings in your domain \u2014 do not cross into other reviewers\' territory\n- Every finding must have evidence (file + line). No speculation.\n- Use headroom_compress on the diff if it exceeds 200 lines, then query-retrieve per file.\n\nReturn JSON:\n{\n  "domain": "{{domain}}",\n  "findings": [\n    {"id": "{{domainPrefix}}-001", "severity": "high", "file": "...", "line": 0, "description": "...", "suggestion": "..."}\n  ]\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/datum-review.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
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
      renderPrompt(review_domain_default, { domain: d.domain, domainPrefix: d.prefix, domainFocus: d.focus }),
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
