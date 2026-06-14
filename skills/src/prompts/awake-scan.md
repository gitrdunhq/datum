Repo scanner for datum awake. Discover all rules, conventions, and patterns in this repository.

Working directory: {{wt}}

TOOLS (run these first for hard data):
1. `scc --no-cocomo -s lines .` — repo shape (LOC, languages, file counts)
2. `ast-grep --pattern 'def test_$NAME($$$)' .` — sample test naming convention
3. `ast-grep --pattern 'class $NAME:' .` — class naming convention
4. `headroom memory list` — read any existing headroom memories for this repo
5. `headroom learn show` — check for learned patterns from past failures

Then scan these sources IN ORDER. Read each file that exists, skip those that don't:

## Config & Rules
- CLAUDE.md, AGENTS.md, GEMINI.md, CODEX.md (agent instructions)
- .claude/rules/*.md (Claude Code rules)
- .editorconfig, .prettierrc, .eslintrc*, biome.json (formatting)
- pyproject.toml [tool.ruff], [tool.black], [tool.pytest] sections
- tsconfig.json (strictness, paths, target)
- Package.swift (targets, dependencies)
- .swiftlint.yml, .swift-format

## Test Conventions
- Read 2-3 existing test files to extract: naming pattern, import style, fixture approach, assertion style
- Identify test framework: pytest, jest, vitest, XCTest, Swift Testing
- Note any conftest.py, test helpers, shared fixtures

## Project Patterns
- Read 2-3 implementation files to extract: module structure, error handling, logging, type patterns
- Check for dependency injection, factory patterns, protocol/trait usage
- Note the import convention (relative vs absolute, barrel exports)

Use headroom_compress on any file longer than 80 lines. Query-retrieve specific sections.

Return JSON:
{
  "language": "python|typescript|swift|go|mixed",
  "test_framework": "pytest|jest|vitest|xctest|swift-testing",
  "repo_shape": {"total_loc": 0, "languages": {}, "file_count": 0},
  "rules": [
    {"source": "CLAUDE.md", "rules": ["rule 1 summary", "rule 2 summary"]},
    {"source": "pyproject.toml", "rules": ["ruff config summary"]}
  ],
  "test_conventions": {
    "naming": "test_<function>_<scenario> or describe/it",
    "fixtures": "conftest.py shared fixtures | beforeEach | setUp",
    "assertions": "assert x == y | expect(x).toBe(y)",
    "example_imports": "from module import func"
  },
  "code_patterns": {
    "error_handling": "how errors are handled",
    "logging": "structlog | console.log | os.log",
    "typing": "fully typed | partial | none",
    "module_structure": "flat | layered | domain-driven"
  },
  "file_conventions": {
    "max_file_length": "500 lines or uncapped",
    "naming": "snake_case | camelCase | PascalCase",
    "test_location": "tests/ | __tests__ | Tests/"
  },
  "headroom_memories": ["any relevant memories from headroom"],
  "learned_failures": ["past failure patterns from headroom learn"]
}

Output raw JSON only. No markdown fences.
