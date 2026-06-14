// @generated — DO NOT EDIT. Source: skills/src/datum-review.ts
export const meta = {
  name: "datum-review",
  description: "Parallel review swarm \u2014 4 domain agents fan out, synthesize findings",
  phases: [
    { title: "Prepare", detail: "generate diff, set up review context" },
    { title: "Review", detail: "4 parallel domain reviewers" },
    { title: "Synthesize", detail: "dedup findings, render REVIEW-REPORT.md" }
  ]
};

// skills/src/shared/utils.ts
function parseAgentJson(text, fallback) {
  if (!text || typeof text !== "string") return fallback;
  const cleaned = text.replace(/```[a-z]*\n?/g, "").trim();
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
var review_domain_default = `You are the {{domain}} reviewer. Read the diff and find issues in your domain ONLY.

Read the diff: git diff main...HEAD

DOMAIN FOCUS \u2014 {{domainFocus}}

For each finding provide:
- id: {{domainPrefix}}-NNN
- severity: critical / high / medium / low / info
- file: the path
- line: the line number (integer)
- description: what is wrong
- suggestion: how to fix

RULES:
- Only report findings in your domain \u2014 do not cross into other reviewers' territory
- Every finding must have evidence (file + line). No speculation.
- Use headroom_compress on the diff if it exceeds 200 lines, then query-retrieve per file.

Return JSON:
{
  "domain": "{{domain}}",
  "findings": [
    {"id": "{{domainPrefix}}-001", "severity": "high", "file": "...", "line": 0, "description": "...", "suggestion": "..."}
  ]
}

Output raw JSON only. No markdown fences.
`;

// skills/src/prompts/util-read-context.md
var util_read_context_default = 'Return a JSON object with:\n1. "branch": output of `git rev-parse --abbrev-ref HEAD`\n2. "epic_dir": "docs/epics/" + the branch name\n{{extraFields}}\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/util-commit-artifact.md
var util_commit_artifact_default = 'Write this content to "{{artifactPath}}" (create parent dirs if needed).\n{{extraCommands}}\nCommit: git add {{gitAddPaths}} && git commit -m "{{commitMessage}}"\n\nCONTENT:\n{{content}}\n';

// skills/src/datum-review.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
var DOMAINS = [
  { domain: "Security", prefix: "SEC", focus: "OWASP top 10, injection, auth bypass, secrets exposure, unsafe deserialization", model: "sonnet" },
  { domain: "Performance", prefix: "PERF", focus: "Hot paths, N+1 queries, unbounded loops, missing pagination, excessive allocations", model: "haiku" },
  { domain: "Architecture", prefix: "ARCH", focus: "Layer violations, tight coupling, dependency direction, abstraction leaks", model: "haiku" },
  { domain: "Correctness", prefix: "CORR", focus: "Does implementation match SPEC and ACs? Off-by-one, null handling, edge cases", model: "sonnet" }
];
phase("Prepare");
var context = await agent(
  renderPrompt(util_read_context_default, {
    extraFields: '3. "diff_lines": line count of `git diff main...HEAD`'
  }),
  { label: "prepare-context", model: "haiku" }
);
var ctx = typeof context === "string" ? parseAgentJson(context, {}) : context;
log(`Branch: ${ctx.branch}, diff: ${ctx.diff_lines || "?"} lines`);
phase("Review");
var reviewResults = await parallel(
  DOMAINS.map(
    (d) => () => agent(
      renderPrompt(review_domain_default, {
        domain: d.domain,
        domainPrefix: d.prefix,
        domainFocus: d.focus
      }),
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
  `**Branch:** ${ctx.branch}`,
  `**Findings:** ${deduped.length} unique (${critical.length} high/critical)
`,
  "## Findings\n",
  "| ID | Severity | File | Line | Description | Suggestion |",
  "|---|---|---|---|---|---|",
  ...deduped.map((f) => `| ${f.id} | ${f.severity} | ${f.file} | ${f.line} | ${f.description} | ${f.suggestion} |`),
  ""
];
var reportContent = reportLines.join("\n");
var epicDir = ctx.epic_dir || `docs/epics/${ctx.branch}`;
await agent(
  renderPrompt(util_commit_artifact_default, {
    artifactPath: `${epicDir}/REVIEW-REPORT.md`,
    extraCommands: "",
    gitAddPaths: `"${epicDir}/REVIEW-REPORT.md"`,
    commitMessage: `review: write REVIEW-REPORT.md (${deduped.length} findings)`,
    content: reportContent
  }),
  { label: "commit-report", model: "haiku" }
);
log("REVIEW-REPORT.md written");
if (critical.length > 0) {
  log(`${critical.length} high/critical findings \u2014 remediation needed before merge`);
}
return {
  branch: ctx.branch,
  totalFindings: deduped.length,
  criticalFindings: critical.length,
  canMerge: critical.length === 0
};
