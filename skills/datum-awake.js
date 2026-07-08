// @generated — DO NOT EDIT. Source: skills/src/datum-awake.ts
export const meta = {
  name: "datum-awake",
  description: "Scan repo rules and conventions, distill into cached agent preamble (llms.txt pattern)",
  phases: [
    { title: "Scan", detail: "read CLAUDE.md, AGENTS.md, configs, test files, code patterns" },
    { title: "Distill", detail: "compress into agent-preamble.md + agent-preamble-full.md" },
    { title: "Commit", detail: "write preamble files and commit" }
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

// skills/src/prompts/awake-scan.md
var awake_scan_default = 'Repo scanner for datum awake. Discover all rules, conventions, and patterns in this repository.\n\nWorking directory: {{wt}}\n\nTOOLS (run these first for hard data):\n1. `scc --no-cocomo -s lines .` \u2014 repo shape (LOC, languages, file counts)\n2. `ast-grep --pattern \'def test_$NAME($$$)\' .` (Python) or `func test$NAME` (Swift/Go) or `it($$$)` (TS/JS) \u2014 sample test naming convention\n3. `ast-grep --pattern \'class $NAME:\' .` \u2014 class naming convention\n4. `headroom memory list` \u2014 read any existing headroom memories for this repo\n5. `headroom learn show` \u2014 check for learned patterns from past failures\n\nThen scan these sources IN ORDER. Read each file that exists, skip those that don\'t:\n\n## Config & Rules\n- CLAUDE.md, AGENTS.md, GEMINI.md, CODEX.md (agent instructions)\n- .claude/rules/*.md (Claude Code rules)\n- .editorconfig, .prettierrc, .eslintrc*, biome.json (formatting)\n- pyproject.toml [tool.ruff], [tool.black], [tool.pytest] sections (Python)\n- tsconfig.json, package.json, biome.json (TypeScript/JavaScript)\n- Package.swift, .swiftlint.yml, .swift-format (Swift)\n- go.mod, go.sum (Go)\n- Cargo.toml, rustfmt.toml (Rust)\n- build.gradle.kts, pom.xml (Kotlin/Java)\n- Gemfile (Ruby)\n\n## Test Conventions\n- Read 2-3 existing test files to extract: naming pattern, import style, fixture approach, assertion style\n- Identify test framework: pytest, jest, vitest, XCTest, Swift Testing\n- Note any test fixtures/helpers (conftest.py / TestHelper.swift / testutil_test.go / jest.setup.ts)\n\n## Project Patterns\n- Read 2-3 implementation files to extract: module structure, error handling, logging, type patterns\n- Check for dependency injection, factory patterns, protocol/trait usage\n- Note the import convention (relative vs absolute, barrel exports)\n\nUse headroom_compress on any file longer than 80 lines. Query-retrieve specific sections.\n\nReturn JSON:\n{\n  "language": "python|typescript|swift|go|mixed",\n  "test_framework": "pytest|jest|vitest|xctest|swift-testing",\n  "repo_shape": {"total_loc": 0, "languages": {}, "file_count": 0},\n  "rules": [\n    {"source": "CLAUDE.md", "rules": ["rule 1 summary", "rule 2 summary"]},\n    {"source": "pyproject.toml | package.json | Package.swift", "rules": ["linter/formatter config summary"]}\n  ],\n  "test_conventions": {\n    "naming": "test_<function>_<scenario> or describe/it",\n    "fixtures": "conftest.py | jest.setup.ts | TestHelper.swift | setUp",\n    "assertions": "assert x == y | expect(x).toBe(y) | XCTAssertEqual | #expect",\n    "example_imports": "from module import func | import { func } from \'./module\'"\n  },\n  "code_patterns": {\n    "error_handling": "how errors are handled",\n    "logging": "structlog | console.log | os.log",\n    "typing": "fully typed | partial | none",\n    "module_structure": "flat | layered | domain-driven"\n  },\n  "file_conventions": {\n    "max_file_length": "500 lines or uncapped",\n    "naming": "snake_case | camelCase | PascalCase",\n    "test_location": "tests/ | __tests__ | Tests/"\n  },\n  "headroom_memories": ["any relevant memories from headroom"],\n  "learned_failures": ["past failure patterns from headroom learn"]\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/prompts/awake-distill.md
var awake_distill_default = 'Distill repo scan results into a token-efficient agent preamble.\n\nSCAN RESULTS:\n{{scanResults}}\n\nProduce TWO outputs:\n\n## OUTPUT 1: agent-preamble.md (lightweight \u2014 every agent gets this)\n\nWrite a concise preamble that will be PREPENDED to every agent prompt. Format as llms.txt:\n\n```\n# [Project Name]\n\n> One-line project description\n\n[Distilled rules \u2014 keep under 60 lines total]\n\n## Coding Rules\n- [rule]: brief description\n\n## Test Conventions\n- [convention]: brief description\n\n## File Conventions\n- [convention]: brief description\n\n## Full Context\n- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and patterns\n```\n\nRULES FOR THE PREAMBLE:\n- Must be EXACTLY the same text every time for prompt cache hits\n- No dynamic content (no dates, no branch names, no file counts)\n- Under 60 lines / ~2000 tokens \u2014 this gets prepended to EVERY agent call\n- Actionable rules only \u2014 "use the project\'s test runner" not "the project has tests"\n- Use imperative voice \u2014 "Always X" not "The project uses X"\n\n## OUTPUT 2: agent-preamble-full.md (expanded \u2014 agents pull this when they need depth)\n\nWrite an expanded version with:\n- All rules from the preamble PLUS detailed explanations\n- Code examples showing the correct pattern for this repo\n- Test examples showing the naming/fixture/assertion conventions\n- Error handling examples\n- Import convention examples\n- Anti-patterns to avoid (extracted from linter configs)\n\nThe full version can be 200+ lines. It\'s not cached \u2014 agents fetch it on demand.\n\nReturn JSON:\n{\n  "preamble": "full contents of agent-preamble.md as a string",\n  "preamble_full": "full contents of agent-preamble-full.md as a string",\n  "token_estimate": {"preamble": N, "full": N}\n}\n\nOutput raw JSON only. No markdown fences.\n';

// skills/src/datum-awake.ts
phase("Scan");
var scanRaw = await agent(
  renderPrompt(awake_scan_default, { wt: "." }),
  { label: "scan-repo", model: model("balanced") }
);
var scan = parseAgentJson(scanRaw, { language: "unknown", rules: [], test_conventions: {}, code_patterns: {}, file_conventions: {} });
log(`Scanned: ${scan.language} project, ${scan.rules?.length || 0} rule sources`);
phase("Distill");
var distillRaw = await agent(
  renderPrompt(awake_distill_default, { scanResults: JSON.stringify(scan) }),
  { label: "distill-preamble", model: model("balanced") }
);
var distill = parseAgentJson(distillRaw, {
  preamble: "# Project\n\n> No rules extracted.\n",
  preamble_full: "# Project \u2014 Full Context\n\n> No rules extracted.\n",
  token_estimate: { preamble: 0, full: 0 }
});
log(`Preamble: ~${distill.token_estimate.preamble} tokens, Full: ~${distill.token_estimate.full} tokens`);
phase("Commit");
var preamblePath = "skills/src/prompts/agent-preamble.md";
var fullPath = "skills/src/prompts/agent-preamble-full.md";
await agent(
  `Write these two files:

FILE 1: "${preamblePath}"
${distill.preamble}

FILE 2: "${fullPath}"
${distill.preamble_full}

Then commit both:
git add "${preamblePath}" "${fullPath}" && git commit -m "awake: regenerate agent preamble from repo scan"`,
  { label: "commit-preambles", model: model("fast") }
);
log(`Written: ${preamblePath} + ${fullPath}`);
log('Run "bash scripts/build-workflows.sh" to rebuild with new preamble');
return {
  language: scan.language,
  ruleSources: scan.rules?.length || 0,
  preambleTokens: distill.token_estimate.preamble,
  fullTokens: distill.token_estimate.full
};
