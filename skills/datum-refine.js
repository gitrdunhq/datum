// @generated — DO NOT EDIT. Source: skills/src/datum-refine.ts
export const meta = {
  name: "datum-refine",
  description: "Transform TICKET.md into SPEC.md \u2014 triage addenda, classify ambiguity, scan codebase, write spec",
  phases: [
    { title: "Read", detail: "read TICKET.md and detect branch/epic dir" },
    { title: "Analyze", detail: "triage addenda + classify ambiguity + scan codebase" },
    { title: "Write", detail: "produce SPEC.md + QUESTIONS.md, commit, gate" }
  ]
};

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

// skills/src/prompts/refine-triage.md
var refine_triage_default = 'Addendum triage agent. Read the full TICKET.md and classify each section.\n\nRead: {{ticketPath}}\n\nThe TICKET may have appended addendum sections (marked with `## Addendum \u2014 YYYY-MM-DD`).\nFor each addendum, determine whether it belongs to the CURRENT epic scope or is a DIFFERENT feature.\n\nDECISION RULE:\n- SAME SCOPE: addendum touches the same files/modules as the original requirements, extends\n  existing behavior, adds edge cases, or refines acceptance criteria.\n- DIFFERENT FEATURE: zero file overlap with original requirements, introduces new public API,\n  targets a different module or subsystem entirely.\n\nTo check file overlap, scan the codebase:\n- grep or find for symbols/modules named in the original requirements\n- grep or find for symbols/modules named in the addendum\n- If the file sets intersect \u2192 SAME SCOPE\n- If zero intersection \u2192 DIFFERENT FEATURE\n\nReturn JSON:\n{\n  "original_scope": "one-line summary of the original TICKET scope",\n  "addenda": [\n    {"date": "YYYY-MM-DD", "summary": "what was added", "verdict": "same_scope|roadmap", "reason": "why"}\n  ],\n  "roadmap_items": ["one-line description for each roadmap-triaged addendum"],\n  "merged_requirements": ["full list of requirements after incorporating same-scope addenda"]\n}\n\nIf the TICKET has no addenda, return empty addenda/roadmap_items and the original requirements as merged_requirements.\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/refine-classify.md
var refine_classify_default = 'Ambiguity classifier. Read the TICKET and classify how much clarification Refine needs.\n\nTICKET content:\n{{ticketContent}}\n\nCLASSIFICATION LEVELS:\n- HIGH: vague or conceptual \u2014 intent unclear, architecture unspecified\n- MEDIUM: clear intent, detectable gaps in failure modes, NFRs, or scope\n- LOW: specific and concrete \u2014 intent, scope, failure modes all clear\n- TRIVIAL: rename, tooltip, wording fix, single-line config change\n\nIf you must assume a structural pattern to understand the ticket, classify as MEDIUM.\n\nReturn JSON:\n{\n  "level": "high|medium|low|trivial",\n  "reasoning": "why this classification",\n  "gaps": ["list of detected gaps that need clarification"],\n  "assumptions": ["list of assumptions the ticket relies on"]\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/refine-scan.md
var refine_scan_default = 'Codebase scanner for Refine. Verify every symbol, API, and module referenced in the TICKET.\n\nWorking directory: {{wt}}\nRequirements to verify:\n{{requirements}}\n\nTOOLS (use in preference order):\n1. `ast-grep --pattern \'<symbol>\' .` \u2014 AST-aware structural search (finds defs, not just strings)\n2. `scc .` \u2014 repo shape: LOC per language, file counts, complexity (run once, report in classification)\n3. GitNexus (gitnexus_context, gitnexus_query) if available\n4. grep/find as fallback\n\nFor each symbol, API, or module mentioned in the requirements:\n1. Use ast-grep to confirm it exists structurally (function def, class def, import)\n2. Read the relevant source file to understand current behavior\n3. Use ast-grep to find callers: `ast-grep --pattern \'<symbol>($$$)\' .`\n4. Assess blast radius from caller count\n\nRun `scc --no-cocomo -s lines .` once to get repo shape for Classification Metadata.\n\nUse headroom_compress on any file longer than 100 lines. Query-retrieve specific sections as needed.\n\nReturn JSON:\n{\n  "symbols": [\n    {\n      "name": "symbol_name",\n      "exists": true,\n      "file": "path/to/file",\n      "related_files": ["tests/test_file", "src/other/caller"],\n      "callers_count": 3,\n      "blast_radius": "low|medium|high",\n      "notes": "current behavior summary"\n    }\n  ],\n  "missing_symbols": ["symbols referenced but not found in codebase"],\n  "test_framework": "pytest|jest|vitest|swift-testing|xctest",\n  "test_conventions": "how existing tests in this area are structured",\n  "patterns": ["existing patterns relevant to the requirements"],\n  "repo_shape": {\n    "total_loc": 0,\n    "languages": {"Python": 0, "TypeScript": 0},\n    "file_count": 0\n  }\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/refine-spec.md
var refine_spec_default = "SPEC writer. Transform the TICKET + codebase context into a complete SPEC.md.\n\nTICKET content:\n{{ticketContent}}\n\nCodebase scan results:\n{{scanResults}}\n\nAmbiguity classification: {{ambiguityLevel}}\nDetected gaps: {{gaps}}\nAssumptions: {{assumptions}}\n\nWrite a SPEC.md following this structure exactly:\n\n1. **Summary** \u2014 2-3 sentences: what changes and why\n2. **Context** \u2014 how this connects to the existing system (use scan results)\n3. **Requirements** \u2014 numbered, each with testable acceptance criteria. Base these on the TICKET requirements, refined with codebase knowledge.\n4. **Failure Modes** \u2014 table: what can go wrong + handling\n5. **Non-Functional Requirements** \u2014 table: requirement + target\n6. **Out of Scope** \u2014 from TICKET's \"Not This\" section + any additional exclusions\n7. **Open Questions** \u2014 gaps that need human answers (empty if trivial/low ambiguity)\n8. **Assumption Audit** \u2014 table: #, Assumption, Justification, Status (confirmed/decided/guess), Resolves (Q# or n/a). Use `decided` for intentional product/design decisions, `confirmed` for code-verified facts, `guess` for technical unknowns that need a QUESTIONS.md entry\n9. **Classification Metadata** \u2014 YAML block with estimated_files, estimated_loc, clusters_touched, new_public_api, dependency_additions\n\nRULES:\n- Every AC must be testable \u2014 if it can't become a test assertion, rewrite it\n- Use the scan results to ground requirements in real file paths and function names\n- Flag any symbols from the TICKET that don't exist in the codebase\n- If ambiguity is HIGH/MEDIUM, put unresolved gaps in Open Questions\n- If ambiguity is LOW/TRIVIAL, Open Questions should be empty\n\nOutput the full SPEC.md content as markdown. No JSON wrapping.\n";

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

// skills/src/prompts/util-read-context.md
var util_read_context_default = `Return a JSON object with:
1. "branch": output of \`git rev-parse --abbrev-ref HEAD\`
2. "epic_dir": "docs/epics/" + the branch name
{{extraFields}}
If any field embeds full multi-line file contents, do NOT hand-type the JSON \u2014 build it programmatically with a command that guarantees correct escaping, e.g.:
\`python3 -c "import json; print(json.dumps({'branch': ..., 'epic_dir': ..., 'spec_content': open('path/SPEC.md').read(), ...}))"\`
Hand-escaping large files reliably produces invalid JSON (stray backslashes, unescaped control chars). Run that command, then output only its stdout \u2014 no markdown fences, no commentary.
`;

// skills/src/prompts/util-run-gate.md
var util_run_gate_default = "Run: datum gate {{phase}}{{flags}}\nReturn the JSON output from the gate command. If the gate fails, return the failure JSON as-is.\nOutput raw JSON only.\n";

// skills/src/datum-refine.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
phase("Read");
var readResult = await agent(
  renderPrompt(util_read_context_default, {
    extraFields: `3. "ticket_exists": whether docs/epics/$(git rev-parse --abbrev-ref HEAD)/TICKET.md exists (true/false)
4. "ticket_content": if ticket_exists, read the full file contents, else null
5. "spec_exists": whether docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md exists (true/false)
6. "current_state": read CURRENT_STATE.md if it exists (first 50 lines), else null
7. "timestamp": output of \`date +%Y-%m-%dT%H:%M:%S\``
  }),
  { label: "read-context", model: model("fast") }
);
var ctx = typeof readResult === "string" ? parseAgentJson(readResult, {}) : readResult;
var epicDir = ctx.epic_dir || `docs/epics/${ctx.branch || "unknown"}`;
var ticketPath = `${epicDir}/TICKET.md`;
var ticketContent = ctx.ticket_content || "";
if (!ctx.ticket_exists || !ticketContent) {
  throw new Error(`TICKET.md not found at ${ticketPath}. Run \`datum init\` first.`);
}
log(`Branch: ${ctx.branch}, TICKET: ${ticketContent.split("\n").length} lines`);
phase("Analyze");
var hasAddenda = ticketContent.includes("## Addendum");
var triageResult = {
  original_scope: "",
  addenda: [],
  roadmap_items: [],
  merged_requirements: []
};
if (hasAddenda) {
  const triageRaw = await agent(
    renderPrompt(refine_triage_default, { ticketPath }) + `

ADDITIONAL TASK: If any addenda are triaged as "roadmap" (different feature), also:
1. Read ROADMAP.md
2. Append the roadmap items under "## Planned"
3. Commit: git add ROADMAP.md && git commit -m "roadmap: triage items from refine"`,
    { label: "triage-addenda", model: model("balanced") }
  );
  triageResult = parseAgentJson(triageRaw, triageResult);
  log(`Triage: ${triageResult.addenda.length} addenda, ${triageResult.roadmap_items.length} roadmapped`);
} else {
  log("No addenda \u2014 single-scope TICKET");
}
var classifyRaw = await agent(
  renderPrompt(refine_classify_default, { ticketContent }),
  { label: "classify-ambiguity", model: model("fast") }
);
var classify = parseAgentJson(classifyRaw, { level: "medium", reasoning: "", gaps: [], assumptions: [] });
log(`Ambiguity: ${classify.level} \u2014 ${classify.reasoning}`);
var requirements = triageResult.merged_requirements.length > 0 ? triageResult.merged_requirements.join("\n") : ticketContent;
var scanRaw = await agent(
  renderPrompt(refine_scan_default, { wt: ".", requirements }),
  { label: "scan-codebase", model: model("balanced") }
);
var scanResults = typeof scanRaw === "string" ? scanRaw : JSON.stringify(scanRaw);
phase("Write");
var today = ctx.timestamp ? ctx.timestamp.slice(0, 10) : "(date unavailable)";
await agent(
  `You have TWO tasks. Do them in order.

TASK 1 \u2014 Write SPEC.md:
${renderPrompt(refine_spec_default, {
    ticketContent,
    scanResults,
    ambiguityLevel: classify.level,
    gaps: classify.gaps.join("\n"),
    assumptions: classify.assumptions.join("\n")
  })}

Write the SPEC to "${epicDir}/SPEC.md" (create dirs if needed).

TASK 2 \u2014 Write QUESTIONS.md:
${renderPrompt(refine_questions_default, {
    gaps: classify.gaps.join("\n"),
    assumptions: classify.assumptions.join("\n"),
    ambiguityLevel: classify.level,
    date: today
  })}

Write the QUESTIONS to "${epicDir}/QUESTIONS.md".

TASK 3 \u2014 Commit both:
git add "${epicDir}/SPEC.md" "${epicDir}/QUESTIONS.md" && git commit -m "refine: write SPEC.md + QUESTIONS.md"`,
  { label: "write-spec-and-questions", model: model("balanced") }
);
log(`SPEC.md + QUESTIONS.md written to ${epicDir}`);
var gateResult = await agent(
  renderPrompt(util_run_gate_default, { phase: "refine", flags: yolo ? " --approve" : "" }),
  { label: "gate", model: model("fast") }
);
var gate = typeof gateResult === "string" ? parseAgentJson(gateResult, { passed: false }) : gateResult;
if (gate?.passed) log("Refine gate PASSED");
else log(`Refine gate: ${gate?.message || "needs review"}`);
return {
  branch: ctx.branch,
  epicDir,
  ambiguity: classify.level,
  gaps: classify.gaps,
  roadmapItems: triageResult.roadmap_items,
  gatePassed: !!gate?.passed,
  gateMessage: gate?.message || ""
};
