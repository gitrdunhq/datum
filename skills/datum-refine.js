// @generated — DO NOT EDIT. Source: skills/src/datum-refine.ts
export const meta = {
  name: "datum-refine",
  description: "Transform TICKET.md into SPEC.md \u2014 triage addenda, classify ambiguity, scan codebase, write spec",
  phases: [
    { title: "Read", detail: "read TICKET.md and detect branch/epic dir" },
    { title: "Triage", detail: "classify addenda as same-scope vs roadmap" },
    { title: "Classify", detail: "determine ambiguity level (high/medium/low/trivial)" },
    { title: "Scan", detail: "verify referenced symbols and discover codebase patterns" },
    { title: "Write", detail: "produce SPEC.md + QUESTIONS.md" },
    { title: "Gate", detail: "run datum gate refine" }
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

// skills/src/prompts/refine-triage.md
var refine_triage_default = 'Addendum triage agent. Read the full TICKET.md and classify each section.\n\nRead: {{ticketPath}}\n\nThe TICKET may have appended addendum sections (marked with `## Addendum \u2014 YYYY-MM-DD`).\nFor each addendum, determine whether it belongs to the CURRENT epic scope or is a DIFFERENT feature.\n\nDECISION RULE:\n- SAME SCOPE: addendum touches the same files/modules as the original requirements, extends\n  existing behavior, adds edge cases, or refines acceptance criteria.\n- DIFFERENT FEATURE: zero file overlap with original requirements, introduces new public API,\n  targets a different module or subsystem entirely.\n\nTo check file overlap, scan the codebase:\n- grep or find for symbols/modules named in the original requirements\n- grep or find for symbols/modules named in the addendum\n- If the file sets intersect \u2192 SAME SCOPE\n- If zero intersection \u2192 DIFFERENT FEATURE\n\nReturn JSON:\n{\n  "original_scope": "one-line summary of the original TICKET scope",\n  "addenda": [\n    {"date": "YYYY-MM-DD", "summary": "what was added", "verdict": "same_scope|roadmap", "reason": "why"}\n  ],\n  "roadmap_items": ["one-line description for each roadmap-triaged addendum"],\n  "merged_requirements": ["full list of requirements after incorporating same-scope addenda"]\n}\n\nIf the TICKET has no addenda, return empty addenda/roadmap_items and the original requirements as merged_requirements.\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/refine-classify.md
var refine_classify_default = 'Ambiguity classifier. Read the TICKET and classify how much clarification Refine needs.\n\nTICKET content:\n{{ticketContent}}\n\nCLASSIFICATION LEVELS:\n- HIGH: vague or conceptual \u2014 intent unclear, architecture unspecified\n- MEDIUM: clear intent, detectable gaps in failure modes, NFRs, or scope\n- LOW: specific and concrete \u2014 intent, scope, failure modes all clear\n- TRIVIAL: rename, tooltip, wording fix, single-line config change\n\nIf you must assume a structural pattern to understand the ticket, classify as MEDIUM.\n\nReturn JSON:\n{\n  "level": "high|medium|low|trivial",\n  "reasoning": "why this classification",\n  "gaps": ["list of detected gaps that need clarification"],\n  "assumptions": ["list of assumptions the ticket relies on"]\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/refine-scan.md
var refine_scan_default = 'Codebase scanner for Refine. Verify every symbol, API, and module referenced in the TICKET.\n\nWorking directory: {{wt}}\nRequirements to verify:\n{{requirements}}\n\nFor each symbol, API, or module mentioned in the requirements:\n1. Search the codebase (grep, find, or GitNexus if available) to confirm it exists\n2. Read the relevant source file to understand current behavior\n3. Identify related files (tests, callers, dependencies)\n4. Assess blast radius: what else touches this code?\n\nUse headroom_compress on any file longer than 100 lines. Query-retrieve specific sections as needed.\n\nReturn JSON:\n{\n  "symbols": [\n    {\n      "name": "symbol_name",\n      "exists": true,\n      "file": "path/to/file.py",\n      "related_files": ["tests/test_file.py", "other/caller.py"],\n      "blast_radius": "low|medium|high",\n      "notes": "current behavior summary"\n    }\n  ],\n  "missing_symbols": ["symbols referenced but not found in codebase"],\n  "test_framework": "pytest|jest|vitest|swift-testing|xctest",\n  "test_conventions": "how existing tests in this area are structured",\n  "patterns": ["existing patterns relevant to the requirements"]\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/refine-spec.md
var refine_spec_default = `SPEC writer. Transform the TICKET + codebase context into a complete SPEC.md.

TICKET content:
{{ticketContent}}

Codebase scan results:
{{scanResults}}

Ambiguity classification: {{ambiguityLevel}}
Detected gaps: {{gaps}}
Assumptions: {{assumptions}}

Write a SPEC.md following this structure exactly:

1. **Summary** \u2014 2-3 sentences: what changes and why
2. **Context** \u2014 how this connects to the existing system (use scan results)
3. **Requirements** \u2014 numbered, each with testable acceptance criteria. Base these on the TICKET requirements, refined with codebase knowledge.
4. **Failure Modes** \u2014 table: what can go wrong + handling
5. **Non-Functional Requirements** \u2014 table: requirement + target
6. **Out of Scope** \u2014 from TICKET's "Not This" section + any additional exclusions
7. **Open Questions** \u2014 gaps that need human answers (empty if trivial/low ambiguity)
8. **Assumption Audit** \u2014 table: #, Assumption, Justification, Status (confirmed/guess), Resolves (Q# or n/a)
9. **Classification Metadata** \u2014 YAML block with estimated_files, estimated_loc, clusters_touched, new_public_api, dependency_additions

RULES:
- Every AC must be testable \u2014 if it can't become a test assertion, rewrite it
- Use the scan results to ground requirements in real file paths and function names
- Flag any symbols from the TICKET that don't exist in the codebase
- If ambiguity is HIGH/MEDIUM, put unresolved gaps in Open Questions
- If ambiguity is LOW/TRIVIAL, Open Questions should be empty

Output the full SPEC.md content as markdown. No JSON wrapping.
`;

// skills/src/prompts/refine-questions.md
var refine_questions_default = `QUESTIONS writer. Generate clarifying questions from detected gaps.

Gaps to address:
{{gaps}}

Assumptions to validate:
{{assumptions}}

Ambiguity level: {{ambiguityLevel}}

Write a QUESTIONS.md following this format:

## Refine \u2014 {{date}}

### Q1: [Category] Question text?
> Context explaining why this matters and what depends on the answer.

[Answer]:

### Q2: [Category] ...

RULES:
- Each question addresses one specific gap or assumption
- Categories: Scope, Architecture, Behavior, NFR, Integration, Security
- The context block must explain what decision hinges on the answer
- Anchor assumptions: "I'm assuming X \u2014 is that right, or Y?"
- If there are no gaps (trivial/low ambiguity), write: "No clarifying questions needed \u2014 intent is clear."

Output the full QUESTIONS.md content as markdown. No JSON wrapping.
`;

// skills/src/datum-refine.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
phase("Read");
var branchInfo = await agent(
  `Run these commands and return ONLY a JSON object:
1. "branch": output of \`git rev-parse --abbrev-ref HEAD\`
2. "epic_dir": "docs/epics/" + the branch name
3. "ticket_exists": whether the file docs/epics/<branch>/TICKET.md exists (true/false)
4. "spec_exists": whether docs/epics/<branch>/SPEC.md exists (true/false)
5. "current_state": read CURRENT_STATE.md if it exists (first 50 lines), else null
Output raw JSON only. No markdown fences.`,
  { label: "read-context", model: "haiku" }
);
var ctx = typeof branchInfo === "string" ? parseAgentJson(branchInfo, {}) : branchInfo;
var epicDir = ctx.epic_dir || `docs/epics/${ctx.branch || "unknown"}`;
var ticketPath = `${epicDir}/TICKET.md`;
if (!ctx.ticket_exists) {
  throw new Error(`TICKET.md not found at ${ticketPath}. Run \`datum init\` first.`);
}
log(`Branch: ${ctx.branch}, Epic dir: ${epicDir}`);
var ticketContent = await agent(
  `Read the file "${ticketPath}" and return its full contents as plain text. No JSON, no wrapping.`,
  { label: "read-ticket", model: "haiku" }
);
log(`TICKET.md: ${ticketContent.split("\n").length} lines`);
phase("Triage");
var hasAddenda = ticketContent.includes("## Addendum");
var triageResult = {
  original_scope: "",
  addenda: [],
  roadmap_items: [],
  merged_requirements: []
};
if (hasAddenda) {
  const triageRaw = await agent(
    renderPrompt(refine_triage_default, { ticketPath }),
    { label: "triage-addenda", model: "sonnet" }
  );
  triageResult = typeof triageRaw === "string" ? parseAgentJson(triageRaw, { original_scope: "", addenda: [], roadmap_items: [], merged_requirements: [] }) : triageRaw;
  if (triageResult.roadmap_items?.length > 0) {
    log(`Triaged to roadmap: ${triageResult.roadmap_items.join(", ")}`);
    await agent(
      `Append these items to ROADMAP.md under "## Planned":
${triageResult.roadmap_items.map((item) => `- ${item}`).join("\n")}

Read ROADMAP.md first, append under the Planned section, write it back. Commit: git add ROADMAP.md && git commit -m "roadmap: triage ${triageResult.roadmap_items.length} items from refine"`,
      { label: "update-roadmap", model: "haiku" }
    );
  }
  log(`Triage: ${triageResult.addenda.length} addenda, ${triageResult.roadmap_items.length} roadmapped`);
} else {
  log("No addenda found \u2014 single-scope TICKET");
}
phase("Classify");
var classifyRaw = await agent(
  renderPrompt(refine_classify_default, { ticketContent }),
  { label: "classify-ambiguity", model: "haiku" }
);
var classify = typeof classifyRaw === "string" ? parseAgentJson(classifyRaw, { level: "medium", reasoning: "", gaps: [], assumptions: [] }) : classifyRaw;
log(`Ambiguity: ${classify.level} \u2014 ${classify.reasoning}`);
if (classify.gaps.length > 0) {
  log(`Gaps: ${classify.gaps.join("; ")}`);
}
phase("Scan");
var requirements = triageResult.merged_requirements.length > 0 ? triageResult.merged_requirements.join("\n") : ticketContent;
var scanRaw = await agent(
  renderPrompt(refine_scan_default, { wt: ".", requirements }),
  { label: "scan-codebase", model: "sonnet" }
);
var scanResults = typeof scanRaw === "string" ? scanRaw : JSON.stringify(scanRaw);
log(`Scan complete`);
phase("Write");
var specContent = await agent(
  renderPrompt(refine_spec_default, {
    ticketContent,
    scanResults,
    ambiguityLevel: classify.level,
    gaps: classify.gaps.join("\n"),
    assumptions: classify.assumptions.join("\n")
  }),
  { label: "write-spec", model: "sonnet" }
);
var specPath = `${epicDir}/SPEC.md`;
await agent(
  `Write this content to "${specPath}" (create parent dirs if needed), then commit:
git add "${specPath}" && git commit -m "refine: write SPEC.md"

CONTENT TO WRITE:
${specContent}`,
  { label: "commit-spec", model: "haiku" }
);
log(`SPEC.md written to ${specPath}`);
var questionsPath = `${epicDir}/QUESTIONS.md`;
var today = await agent(
  "Run `date +%Y-%m-%d` and return ONLY the date string. No explanation.",
  { label: "get-date", model: "haiku" }
);
var questionsContent = await agent(
  renderPrompt(refine_questions_default, {
    gaps: classify.gaps.join("\n"),
    assumptions: classify.assumptions.join("\n"),
    ambiguityLevel: classify.level,
    date: today.trim()
  }),
  { label: "write-questions", model: "sonnet" }
);
await agent(
  `Write this content to "${questionsPath}" (create parent dirs if needed), then commit:
git add "${questionsPath}" && git commit -m "refine: write QUESTIONS.md"

CONTENT TO WRITE:
${questionsContent}`,
  { label: "commit-questions", model: "haiku" }
);
log(`QUESTIONS.md written to ${questionsPath}`);
phase("Gate");
var gateFlag = yolo ? " --approve" : "";
var gateResult = await agent(
  `Run: datum gate refine${gateFlag}
Return the JSON output from the gate command. If the gate fails, return the failure JSON as-is.
Output raw JSON only.`,
  { label: "gate-refine", model: "haiku" }
);
var gate = typeof gateResult === "string" ? parseAgentJson(gateResult, { passed: false }) : gateResult;
if (gate?.passed) {
  log("Refine gate PASSED");
} else {
  log(`Refine gate FAILED: ${gate?.message || "unknown"}`);
}
return {
  branch: ctx.branch,
  epicDir,
  ambiguity: classify.level,
  gaps: classify.gaps,
  roadmapItems: triageResult.roadmap_items,
  gatePassed: !!gate?.passed,
  gateMessage: gate?.message || ""
};
