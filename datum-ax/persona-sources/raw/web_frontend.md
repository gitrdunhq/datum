

# =========================================
# SOURCE: /Users/samfakhreddine/repos/clients/SureGoodFoods/sgf-website/node_modules/.pnpm/sitemap@9.0.1/node_modules/sitemap/CLAUDE.md
# =========================================

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

sitemap.js is a TypeScript library and CLI tool for generating sitemap XML files compliant with the sitemaps.org protocol. It supports streaming large datasets, handles sitemap indexes for >50k URLs, and includes parsers for reading existing sitemaps.

## Development Commands

### Building
```bash
npm run build                 # Compile TypeScript to dist/esm/ and dist/cjs/
npm run build:esm             # Build ESM only (dist/esm/)
npm run build:cjs             # Build CJS only (dist/cjs/)
```

### Testing
```bash
npm test                      # Run Jest tests with coverage
npm run test:full             # Run lint, build, Jest, and xmllint validation
npm run test:typecheck        # Type check only (tsc)
npm run test:perf             # Run performance tests (tests/perf.mjs)
npm run test:xmllint          # Validate XML schema (requires xmllint)
```

### Linting
```bash
npx eslint lib/* ./cli.ts     # Lint TypeScript files
npx eslint lib/* ./cli.ts --fix  # Auto-fix linting issues
```

### Running CLI Locally
```bash
node dist/esm/cli.js < urls.txt   # Run CLI from built dist
./dist/esm/cli.js --version       # Run directly (has shebang)
npm link && sitemap --version     # Link and test as global command
```

## Code Architecture

### Entry Points
- **[index.ts](index.ts)**: Main library entry point, exports all public APIs
- **[cli.ts](cli.ts)**: Command-line interface for generating/parsing sitemaps

### File Organization & Responsibilities

The library follows a strict separation of concerns. Each file has a specific purpose:

**Core Infrastructure:**
- **[lib/types.ts](lib/types.ts)**: ALL TypeScript type definitions, interfaces, and enums. NO implementation code.
- **[lib/constants.ts](lib/constants.ts)**: Single source of truth for all shared constants (limits, regexes, defaults).
- **[lib/validation.ts](lib/validation.ts)**: ALL validation logic, type guards, and validators centralized here.
- **[lib/utils.ts](lib/utils.ts)**: Stream utilities, URL normalization, and general helper functions.
- **[lib/errors.ts](lib/errors.ts)**: Custom error class definitions.
- **[lib/sitemap-xml.ts](lib/sitemap-xml.ts)**: Low-level XML generation utilities (text escaping, tag building).

**Stream Processing:**
- **[lib/sitemap-stream.ts](lib/sitemap-stream.ts)**: Main transform stream for URL → sitemap XML.
- **[lib/sitemap-item-stream.ts](lib/sitemap-item-stream.ts)**: Lower-level stream for sitemap item → XML elements.
- **[lib/sitemap-index-stream.ts](lib/sitemap-index-stream.ts)**: Streams for sitemap indexes and multi-file generation.

**Parsers:**
- **[lib/sitemap-parser.ts](lib/sitemap-parser.ts)**: Parses sitemap XML → SitemapItem objects.
- **[lib/sitemap-index-parser.ts](lib/sitemap-index-parser.ts)**: Parses sitemap index XML → IndexItem objects.

**High-Level API:**
- **[lib/sitemap-simple.ts](lib/sitemap-simple.ts)**: Simplified API for common use cases.

### Core Streaming Architecture

The library is built on Node.js Transform streams for memory-efficient processing of large URL lists:

**Stream Chain Flow:**
```
Input → Transform Stream → Output
```

**Key Stream Classes:**

1. **SitemapStream** ([lib/sitemap-stream.ts](lib/sitemap-stream.ts))
   - Core Transform stream that converts `SitemapItemLoose` objects to sitemap XML
   - Handles single sitemaps (up to ~50k URLs)
   - Automatically generates XML namespaces for images, videos, news, xhtml
   - Uses `SitemapItemStream` internally for XML element generation

2. **SitemapAndIndexStream** ([lib/sitemap-index-stream.ts](lib/sitemap-index-stream.ts))
   - Higher-level stream for handling >50k URLs
   - Automatically splits into multiple sitemap files when limit reached
   - Generates sitemap index XML pointing to individual sitemaps
   - Requires `getSitemapStream` callback to create output files

3. **SitemapItemStream** ([lib/sitemap-item-stream.ts](lib/sitemap-item-stream.ts))
   - Low-level Transform stream that converts sitemap items to XML elements
   - Validates and normalizes URLs
   - Handles image, video, news, and link extensions

4. **XMLToSitemapItemStream** ([lib/sitemap-parser.ts](lib/sitemap-parser.ts))
   - Parser that converts sitemap XML back to `SitemapItem` objects
   - Built on SAX parser for streaming large XML files

5. **SitemapIndexStream** ([lib/sitemap-index-stream.ts](lib/sitemap-index-stream.ts))
   - Generates sitemap index XML from a list of sitemap URLs
   - Used for organizing multiple sitemaps

### Type System

**[lib/types.ts](lib/types.ts)** defines the core data structures:

- **SitemapItemLoose**: Flexible input type (accepts strings, objects, arrays for images/videos)
- **SitemapItem**: Strict normalized type (arrays only)
- **ErrorLevel**: Enum controlling validation behavior (SILENT, WARN, THROW)
- **NewsItem**, **Img**, **VideoItem**, **LinkItem**: Extension types for rich sitemap entries
- **IndexItem**: Structure for sitemap index entries
- **StringObj**: Generic object with string keys (used for XML attributes)

### Constants & Limits

**[lib/constants.ts](lib/constants.ts)** is the single source of truth for:
- `LIMITS`: Security limits (max URL length, max items per sitemap, max video tags, etc.)
- `DEFAULT_SITEMAP_ITEM_LIMIT`: Default items per sitemap file (45,000)

All limits are documented with references to sitemaps.org and Google specifications.

### Validation & Normalization

**[lib/validation.ts](lib/validation.ts)** centralizes ALL validation logic:
- `validateSMIOptions()`: Validates complete sitemap item fields
- `validateURL()`, `validatePath()`, `validateLimit()`: Input validation
- `validators`: Regex patterns for field validation (price, language, genres, etc.)
- Type guards: `isPriceType()`, `isResolution()`, `isValidChangeFreq()`, `isValidYesNo()`, `isAllowDeny()`

**[lib/utils.ts](lib/utils.ts)** contains utility functions:
- `normalizeURL()`: Converts `SitemapItemLoose` to `SitemapItem` with validation
- `lineSeparatedURLsToSitemapOptions()`: Stream transform for parsing line-delimited URLs
- `ReadlineStream`: Helper for reading line-by-line input
- `mergeStreams()`: Combines multiple streams into one

### XML Generation

**[lib/sitemap-xml.ts](lib/sitemap-xml.ts)** provides low-level XML building functions:
- Tag generation helpers (`otag`, `ctag`, `element`)
- Sitemap-specific element builders (images, videos, news, links)

### Error Handling

**[lib/errors.ts](lib/errors.ts)** defines custom error classes:
- `EmptyStream`, `EmptySitemap`: Stream validation errors
- `InvalidAttr`, `InvalidVideoFormat`, `InvalidNewsFormat`: Validation errors
- `XMLLintUnavailable`: External tool errors

## When Making Changes

### Where to Add New Code

- **New type or interface?** → Add to [lib/types.ts](lib/types.ts)
- **New constant or limit?** → Add to [lib/constants.ts](lib/constants.ts) (import from here everywhere)
- **New validation function or type guard?** → Add to [lib/validation.ts](lib/validation.ts)
- **New utility function?** → Add to [lib/utils.ts](lib/utils.ts)
- **New error class?** → Add to [lib/errors.ts](lib/errors.ts)
- **New public API?** → Export from [index.ts](index.ts)

### Common Pitfalls to Avoid

1. **DON'T duplicate constants** - Always import from [lib/constants.ts](lib/constants.ts)
2. **DON'T define types in implementation files** - Put them in [lib/types.ts](lib/types.ts)
3. **DON'T scatter validation logic** - Keep it all in [lib/validation.ts](lib/validation.ts)
4. **DON'T break backward compatibility** - Use re-exports if moving code between files
5. **DO update [index.ts](index.ts)** if adding new public API functions

### Adding a New Field to Sitemap Items

1. Add type to [lib/types.ts](lib/types.ts) in both `SitemapItem` and `SitemapItemLoose` interfaces
2. Add XML generation logic in [lib/sitemap-item-stream.ts](lib/sitemap-item-stream.ts) `_transform` method
3. Add parsing logic in [lib/sitemap-parser.ts](lib/sitemap-parser.ts) SAX event handlers
4. Add validation in [lib/validation.ts](lib/validation.ts) `validateSMIOptions` if needed
5. Add constants to [lib/constants.ts](lib/constants.ts) if limits are needed
6. Write tests covering the new field

### Before Submitting Changes

```bash
npm run test:full    # Run all tests, linting, and validation
npm run build        # Ensure both ESM and CJS builds work
npm test             # Verify 90%+ code coverage maintained
```

## Finding Code in the Codebase

### "Where is...?"

- **Validation for sitemap items?** → [lib/validation.ts](lib/validation.ts) (`validateSMIOptions`)
- **URL validation?** → [lib/validation.ts](lib/validation.ts) (`validateURL`)
- **Constants like max URL length?** → [lib/constants.ts](lib/constants.ts) (`LIMITS`)
- **Type guards (isPriceType, isValidYesNo)?** → [lib/validation.ts](lib/validation.ts)
- **Type definitions (SitemapItem, etc)?** → [lib/types.ts](lib/types.ts)
- **XML escaping/generation?** → [lib/sitemap-xml.ts](lib/sitemap-xml.ts)
- **URL normalization?** → [lib/utils.ts](lib/utils.ts) (`normalizeURL`)
- **Stream utilities?** → [lib/utils.ts](lib/utils.ts) (`mergeStreams`, `lineSeparatedURLsToSitemapOptions`)

### "How do I...?"

- **Check if a value is valid?** → Import type guard from [lib/validation.ts](lib/validation.ts)
- **Get a constant limit?** → Import `LIMITS` from [lib/constants.ts](lib/constants.ts)
- **Validate user input?** → Use validation functions from [lib/validation.ts](lib/validation.ts)
- **Generate XML safely?** → Use functions from [lib/sitemap-xml.ts](lib/sitemap-xml.ts) (auto-escapes)

## Testing Strategy

Tests are in [tests/](tests/) directory with Jest:
- **[tests/sitemap-stream.test.ts](tests/sitemap-stream.test.ts)**: Core streaming functionality
- **[tests/sitemap-parser.test.ts](tests/sitemap-parser.test.ts)**: XML parsing
- **[tests/sitemap-index.test.ts](tests/sitemap-index.test.ts)**: Index generation
- **[tests/sitemap-simple.test.ts](tests/sitemap-simple.test.ts)**: High-level API
- **[tests/cli.test.ts](tests/cli.test.ts)**: CLI argument parsing
- **[tests/*-security.test.ts](tests/)**: Security-focused validation and injection tests
- **[tests/sitemap-utils.test.ts](tests/sitemap-utils.test.ts)**: Utility function tests

### Coverage Requirements (enforced by jest.config.cjs)
- Branches: 80%
- Functions: 90%
- Lines: 90%
- Statements: 90%

### When to Write Tests
- **Always** write tests for new validation functions
- **Always** write tests for new security features
- **Always** add security tests for user-facing inputs (URL validation, path traversal, etc.)
- Write tests for bug fixes to prevent regression
- Add edge case tests for data transformations

## TypeScript Configuration

The project uses a dual-build setup for ESM and CommonJS:

- **[tsconfig.json](tsconfig.json)**: ESM build (`module: "NodeNext"`, `moduleResolution: "NodeNext"`)
  - Outputs to `dist/esm/`
  - Includes both [index.ts](index.ts) and [cli.ts](cli.ts)
  - ES2023 target with strict null checks enabled

- **[tsconfig.cjs.json](tsconfig.cjs.json)**: CommonJS build (`module: "CommonJS"`)
  - Outputs to `dist/cjs/`
  - Excludes [cli.ts](cli.ts) (CLI is ESM-only)
  - Only includes [index.ts](index.ts) for library exports

**Important**: All relative imports must include `.js` extensions for ESM compatibility (e.g., `import { foo } from './types.js'`)

## Key Patterns

### Stream Creation
Always create a new stream instance per operation. Streams cannot be reused.

```typescript
const stream = new SitemapStream({ hostname: 'https://example.com' });
stream.write({ url: '/page' });
stream.end();
```

### Memory Management
For large datasets, use streaming patterns with `pipe()` rather than collecting all data in memory:

```typescript
// Good - streams through
lineSeparatedURLsToSitemapOptions(readStream).pipe(sitemapStream).pipe(outputStream);

// Bad - loads everything into memory
const allUrls = await readAllUrls();
allUrls.forEach(url => stream.write(url));
```

### Error Levels
Control validation strictness with `ErrorLevel`:
- `SILENT`: Skip validation (fastest, use in production if data is pre-validated)
- `WARN`: Log warnings (default, good for development)
- `THROW`: Throw on invalid data (strict mode, good for testing)

## Package Distribution

The package is distributed as a dual ESM/CommonJS package with `"type": "module"` in package.json:

- **ESM**: `dist/esm/index.js` (ES modules)
- **CJS**: `dist/cjs/index.js` (CommonJS, via conditional exports)
- **Types**: `dist/esm/index.d.ts` (TypeScript definitions)
- **Binary**: `dist/esm/cli.js` (ESM-only CLI, executable via `npx sitemap`)
- **Engines**: Node.js >=20.19.5, npm >=10.8.2

### Dual Package Exports

The `exports` field in package.json provides conditional exports:

```json
{
  "exports": {
    ".": {
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js"
    }
  }
}
```

This allows both:
```javascript
// ESM
import { SitemapStream } from 'sitemap'

// CommonJS
const { SitemapStream } = require('sitemap')
```

## Git Hooks

Husky pre-commit hooks run lint-staged which:
- Sorts package.json
- Runs eslint --fix on TypeScript files
- Runs prettier on TypeScript files

## Architecture Decisions

### Why This File Structure?

The codebase is organized around **separation of concerns** and **single source of truth** principles:

1. **Types in [lib/types.ts](lib/types.ts)**: All interfaces and enums live here, with NO implementation code. This makes types easy to find and prevents circular dependencies.

2. **Constants in [lib/constants.ts](lib/constants.ts)**: All shared constants (limits, regexes) defined once. This prevents inconsistencies where different files use different values.

3. **Validation in [lib/validation.ts](lib/validation.ts)**: All validation logic centralized. Easy to find, test, and maintain security rules.

4. **Clear file boundaries**: Each file has ONE responsibility. You know exactly where to look for specific functionality.

### Key Principles

- **Single Source of Truth**: Constants and validation logic exist in exactly one place
- **No Duplication**: Import shared code rather than copying it
- **Backward Compatibility**: Use re-exports when moving code between files to avoid breaking changes
- **Types Separate from Implementation**: [lib/types.ts](lib/types.ts) contains only type definitions
- **Security First**: All validation and limits are centralized for consistent security enforcement

### Benefits of This Organization

- **Discoverability**: Developers know exactly where to look for types, constants, or validation
- **Maintainability**: Changes to limits or validation only require editing one file
- **Consistency**: Importing from a single source prevents different parts of the code using different limits
- **Testing**: Centralized validation makes it easy to write comprehensive security tests
- **Refactoring**: Clear boundaries make it safe to refactor without affecting other modules


# =========================================
# SOURCE: /Users/samfakhreddine/repos/clients/SureGoodFoods/sgf-website/AGENTS.md
# =========================================

# AGENTS.md

This is the single source of truth for all AI coding agents working in this repository.
All tool-specific files (CLAUDE.md, GEMINI.md, etc.) redirect here.

## Memory

Persistent project memory lives at:
```
~/.claude/projects/-Volumes-Extra-repos-clients-SureGoodFoods-sgf-website/memory/
```

**Always read `MEMORY.md` (the index) at the start of any session.** It is automatically loaded into context. Key sections:

- **Daily drivers** — mandatory patterns (CF bindings, pnpm, dev server, CSS tokens)
- **Project state** — current epic, infra status, go-live blocklist
- **Patterns & pitfalls** — non-obvious failures with fixes (check before starting any CF, CSS, or EmDash work)
- **References** — where things live (SVG tools, Pexels, etc.)

Episodic memories (specific failure+pivot events) are in `memory/episodic/` with their own `INDEX.md`.

**Before any Cloudflare Pages, KV, or CSP work — read these first:**
- `memory/feedback-astro-cf-binding.md` — CF env access pattern + Astro v6 breaking change
- `memory/feedback-wrangler-preview-kv.md` — preview KV binding gap
- `memory/feedback-csp-turnstile-frame-src.md` — Turnstile iframe CSP requirement
- `memory/episodic/kv-emdash-caching-saga-20260602.md` — why KV caching from user middleware fails

## Tier Isolation — Strict

**Every Cloudflare resource is tier-specific. No resource is shared across tiers.**

| Resource | Pattern | Example (dev) |
|---|---|---|
| D1 database | `sgf-website-{tier}-db` | `sgf-website-db-dev` |
| R2 bucket | `sgf-website-{tier}-media` | `sgf-website-dev-media` |
| KV namespace | `sgf-website-{tier}-*` | `sgf-website-dev-session` |
| Queue | `sgf-website-{tier}-translation-queue` | `sgf-website-dev-translation-queue` |
| Pages project | `sgf-website-{tier}` | `sgf-website-dev` |

**SSOT for tier resource IDs/names:** `scripts/tier-config.json`. Never hardcode a tier's resource ID or name in code or CI — always read it from tier-config.json.

**CI patches `wrangler.toml` before deploy** to swap in the correct tier's resource names (DB ID, queue name). The file on disk always holds prod values as the default; the patch step replaces them for non-prod tiers.

**Tofu manages provisioning.** Each tier has its own workspace (`tofu workspace select dev/test/prod`). Run `bash scripts/tofu-apply.sh <tier>` to provision or update a tier's resources. After creating a new resource, add its ID to `tier-config.json`.

## CI Monitoring — Mandatory

**CRITICAL RULE FOR ALL AI AGENTS:**
Whenever you push code to the `dev` branch, you MUST proactively monitor the CI pipeline (e.g. using `gh run list` and `gh run view`) to ensure the build and tests pass.
- Do NOT simply tell the user "I pushed the code" and stop.
- You must wait for or check the CI outcome.
- If the CI fails, you MUST investigate the logs, fix the issue, and push again until CI passes.

## Local Production Builds — the `[ai]` binding needs its own token

A local `CF_PAGES=1 pnpm build` triggers a **remote edge-preview proxy** for the
`[ai]` (Workers AI) binding during `astro build` — Workers AI has no local emulation,
so the build opens a real tunnel to Cloudflare. The default `CLOUDFLARE_API_TOKEN`
(D1/R2/Pages/KV scopes) **cannot** authorize that endpoint and the build dies with
`A request to the Cloudflare API (.../workers/subdomain/edge-preview) failed`
(Authentication error, code 10000).

Fix: a minimal-scope token — **Workers AI Read + Workers Scripts Write** — stored in
`.env` as `CF_BUILD_TOKEN` (gitignored). To build locally:

```bash
CLOUDFLARE_API_TOKEN="$(grep '^CF_BUILD_TOKEN=' .env | cut -d= -f2-)" CF_PAGES=1 pnpm build
```

Do NOT overwrite `CLOUDFLARE_API_TOKEN` with it — other tooling (update-pages-bindings,
media pipeline, D1/R2 ops) needs the broader scopes. CI is unaffected (CI has its own
token). If `CF_BUILD_TOKEN` is missing, mint one with the `CF_SELF_HELP` token
(it carries API Tokens:Edit) scoped to the two permission groups above.

## EmDash Seed Architecture

**CRITICAL RULE FOR ALL AI AGENTS:** 
Do NOT manually edit `.emdash/seed.json`. It is an auto-generated, compiled artifact.
If you need to edit EmDash schemas, collections, menus, or content, you MUST edit the modular JSON files inside the `.emdash/seeds/` directory.
Once you have made your edits in `.emdash/seeds/`, run `pnpm seed` to compile them into `seed.json` and deploy them to the local database.

## Local LLM — Multi-Turn Orchestration

When a pipeline phase uses local Gemma inference, ALWAYS spawn a subagent (Agent tool
with `model: "sonnet"`) that imports and calls `datum.local_llm.run_phase()` from Python.
NEVER invoke `datum local-llm` via Bash. The CLI exists for human testing only.

### How it works

`run_phase()` auto-routes to multi-turn mode when `[multi_turn]` is enabled for a phase
in `config.toml`. The flow:

1. **Planning turn** — Gemma analyzes the problem, outputs a `StepPlan` (list of actions)
2. **Execution turns** — Gemma executes each step, outputs `StepResult` with confidence score
3. **Synthesis turn** — Gemma combines all findings into the phase's final schema

### Escalation rules

- If any turn triggers repetition, context overflow, or the model says `ESCALATE` → escalate to Claude
- If confidence stays below `confidence_threshold` after retries → escalate
- If total wall-clock exceeds `timeout_s` → escalate
- The orchestrator retries with Claude using the accumulated context as a head start

### Key parameters (all in `config.toml` under `[multi_turn]`)

| Parameter | Default | What it does |
|-----------|---------|-------------|
| `max_turns` | 5 | Max reasoning turns before forced escalation |
| `timeout_s` | 300 | Total wall-clock budget for all turns |
| `turn_timeout_s` | 90 | Max wall-clock per individual turn |
| `confidence_threshold` | 0.8 | Exit early when confidence >= this |
| `temperature_schedule` | fixed | `fixed` / `rising` / `falling` / `u_curve` |
| `context_reserve_pct` | 20 | % of context window reserved for synthesis |
| `retry_on_low_confidence` | true | Retry a turn if confidence < threshold |
| `max_retries_per_turn` | 2 | Max retries per turn before accepting best |
| `planning_turn` | true | Turn 0 produces a step plan |
| `verification_turn` | true | Final turn synthesizes into phase schema |

Per-phase overrides go in `[multi_turn.phase_overrides.<phase>]`.

### Subagent pattern

```python
from datum.local_llm import run_phase

result = run_phase(
    phase="triage",
    prompt=prompt_text,
    schema=TriageDecision,       # optional: Pydantic schema for structured output
    mt_overrides={"max_turns": 3} # optional: override any multi-turn param
)

if result["escalated"]:
    # retry with Claude, pass result["turns"] as context
    ...
else:
    answer = result["result"]
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **sgf-website** (2447 symbols, 2756 relationships, 15 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/sgf-website/context` | Codebase overview, check index freshness |
| `gitnexus://repo/sgf-website/clusters` | All functional areas |
| `gitnexus://repo/sgf-website/processes` | All execution flows |
| `gitnexus://repo/sgf-website/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/clients/SureGoodFoods/sgf-website/CLAUDE.md
# =========================================

# Claude Code Instructions

All agent instructions live in [AGENTS.md](AGENTS.md). Read that file.

## Working Preferences

- **Always maintain a running task list.** Use TaskCreate/TaskUpdate throughout every session. Never let tasks go untracked. The user expects to see task progress at all times.
- **Don't interrupt the current task for new requests** — finish first, then address new asks in order.

## D1 Content Purgatory — Schema Without Data

**Symptom:** A collection returns zero entries on any remote tier, even though the local DB is fine and `seed.json` has entries.

**Why it happens:** The auto-seed on push to `main`/`test` only runs `schema.sql` + `contact_content.sql` (see `.github/workflows/seed-d1.yml`). When a new collection is added to `seed.json`, its schema table is created automatically by migrations — but its **content rows are never pushed** unless you manually trigger the workflow for that target.

The DB ends up in purgatory: table exists, zero rows.

**Diagnosis:** `getEmDashCollection("x")` returns `[]` on remote but not locally. Check if the collection was recently added:
```bash
git log --oneline -- .emdash/seed.json | head -5
```

**Fix:** Manually trigger the seed workflow for the affected collection:
```bash
unset GITHUB_TOKEN && gh workflow run seed-d1.yml \
  --repo gitrdunhq/sgf-website \
  --field tier=<tier> \
  --field target=<collection_slug>
```
Valid tiers: `test`, `prod`. Seed test first, then promote to prod.

**Defensive measure:** Any `getEmDashCollection()` call that renders visible UI should include a hardcoded fallback for when the collection returns empty, so the page degrades gracefully rather than going blank.

## Pre-Deploy Checklist

Before any deployment (`wrangler pages deploy`, `wrangler deploy`, push to main, or any CF Pages trigger), run through every item and report status. Fix issues before proceeding.

1. **patchedDependencies** — Does `package.json` have a `patchedDependencies` field? If yes, verify `postinstall` script exists and calls the patch application script (`scripts/apply-patches.mjs`). ✓/✗
2. **D1 seed files** — Are all seed/migration SQL files FK-ordered with `PRAGMA foreign_keys = OFF` at the top and no `BEGIN TRANSACTION`/`COMMIT` statements? ✓/✗
3. **Local build** — Run `CF_PAGES=1 pnpm run build` and verify exit 0. ✓/✗
4. **Wrangler bindings** — Check `wrangler.jsonc` bindings (D1, R2, KV) match what is configured in the CF dashboard for the target tier. Use `node scripts/update-pages-bindings.mjs --tier <tier>` to sync if needed. ✓/✗
5. **R2 upload commands** — List any `wrangler r2` upload commands in the deploy path. Verify every one uses the `--remote` flag (default is local emulator — no warning given). ✓/✗

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **sgf-website** (2447 symbols, 2756 relationships, 15 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/sgf-website/context` | Codebase overview, check index freshness |
| `gitnexus://repo/sgf-website/clusters` | All functional areas |
| `gitnexus://repo/sgf-website/processes` | All execution flows |
| `gitnexus://repo/sgf-website/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/clients/michif/experiments/cms-wireframe/payload/node_modules/thread-stream/CLAUDE.md
# =========================================

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

thread-stream is a library for streaming data to a Node.js Worker Thread. It uses SharedArrayBuffer and Atomics for efficient inter-thread communication, enabling high-performance data streaming to worker threads.

## Build & Test Commands

```bash
npm test                    # Run linting (standard), type checking, and all tests
npm run build               # Type check only (tsc --noEmit)
npm run test:ci             # CI-specific test run

# Run a single test file
node --test test/<filename>.test.js
node --test test/<filename>.test.ts  # For TypeScript tests

# Lint
npx standard
```

## Architecture

### Core Components

- **index.js**: Main `ThreadStream` class extending EventEmitter. Manages shared memory buffers, worker lifecycle, and provides stream-like write/flush/end API.

- **lib/worker.js**: Runs inside the Worker Thread. Loads the user-provided destination module, reads from shared buffer, and writes to the destination stream.

- **lib/indexes.js**: Defines shared buffer index constants (`WRITE_INDEX`, `READ_INDEX`) used for Atomics-based synchronization.

- **lib/wait.js**: Provides `wait()` and `waitDiff()` utilities for async waiting on Atomics state changes with exponential backoff.

### Shared Memory Communication

The main thread and worker communicate via two SharedArrayBuffers:
1. **stateBuf**: Int32Array for READ_INDEX and WRITE_INDEX positions
2. **dataBuf**: Buffer for actual string data (default 4MB)

Write flow: Main thread writes to dataBuf, updates WRITE_INDEX, worker reads data between READ_INDEX and WRITE_INDEX, updates READ_INDEX when consumed.

### Worker Module Interface

User-provided worker modules must export an async function that receives `workerData` and returns a writable stream:

```js
async function run(opts) {
  const stream = fs.createWriteStream(opts.dest)
  await once(stream, 'open')
  return stream
}
module.exports = run
```

### Sync vs Async Modes

- `sync: true`: Blocking writes using flushSync, waits for worker to consume
- `sync: false` (default): Non-blocking writes with drain events when buffer fills

## Code Style

Uses [Standard](https://standardjs.com/) for linting. Test files in `test/ts/**/*` and `test/syntax-error.mjs` are excluded from linting.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/clients/michif/experiments/cms-wireframe/AGENTS.md
# =========================================

# NHL Kids App - Research & Content Agent Architecture

This document outlines the multi-agent architecture used to generate the domain content for the CMS wireframes based on the initial project prompt.

## Mission
To generate accurate, age-appropriate (ages 2-6) content teaching NHL rules and basic hockey concepts, which was subsequently seeded into the Payload and Directus CMS wireframes.

## Agent Swarm Architecture
A parallel fan-out / fan-in (map-reduce) agent architecture was utilized to independently research NHL rule categories and then synthesize them into a single coherent document.

### 1. The Researchers (Parallel Execution)
Five independent researcher subagents were spawned simultaneously. Each operated under strict constraints (max 6 web searches, max 4 fetches) and was tasked with citing the official NHL rulebook.

*   **Agent 1: Playing Area Researcher**
    *   **Focus:** Rink dimensions, zones, boards, glass, and player equipment.
    *   **Output:** `sources/1-playing-area.md`
*   **Agent 2: Game Structure Researcher**
    *   **Focus:** Periods, faceoffs, line changes, overtime, and shootouts.
    *   **Output:** `sources/2-game-structure.md`
*   **Agent 3: Penalties Researcher**
    *   **Focus:** Minor/major penalties, tripping, hooking, high-sticking, slashing, interference.
    *   **Output:** `sources/3-penalties.md`
*   **Agent 4: Scoring Rules Researcher**
    *   **Focus:** Goals, offside, icing, delayed offside.
    *   **Output:** `sources/4-scoring-rules.md`
*   **Agent 5: Officials Conduct Researcher**
    *   **Focus:** Referees, linesmen, signals, fair play, sportsmanship norms.
    *   **Output:** `sources/5-officials-conduct.md`

### 2. The Synthesizer (Sequential Execution)
Once the five researchers completed their tasks, a final collator agent was spawned to merge the findings.

*   **Agent 6: Collator**
    *   **Focus:** Read the five source markdown files and synthesize them into `hockey-basics.md`.
    *   **Transformation:** Specifically prompted to adapt the formal NHL rules for parents and educators. For each rule, the agent generated a one-sentence "how to explain to a small child" version alongside the formal rule (e.g., *"We have to wait for the puck to cross the blue line first, just like waiting for the leader in a line!"*).
    *   **Organization:** Grouped the synthesized content into four structural themes matching the CMS schema:
        1. Skating Basics
        2. Passing and Sharing the Puck
        3. Fair Play and Good Sportsmanship
        4. The Rink and Equipment
    *   **Output:** `hockey-basics.md`

## Integration
The output from the Collator agent (`hockey-basics.md`) served as the golden dataset. The main Orchestrator agent (this session) parsed this document to extract the `learning_intent`, `parent_guidance`, and `skill_focus` fields required for the initial seed scripts (`seed.js` and `seed.mjs`) used to populate both Payload and Directus CMS databases.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/clients/michif/experiments/cms-wireframe/CLAUDE.md
# =========================================

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **cms-wireframe** (313 symbols, 320 relationships, 0 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/cms-wireframe/context` | Codebase overview, check index freshness |
| `gitnexus://repo/cms-wireframe/clusters` | All functional areas |
| `gitnexus://repo/cms-wireframe/processes` | All execution flows |
| `gitnexus://repo/cms-wireframe/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/oss/emdash/infra/cache-demo/AGENTS.md
# =========================================

This is an EmDash site -- a CMS built on Astro with a full admin UI.

## Commands

```bash
npx emdash dev        # Start dev server (runs migrations, seeds, generates types)
npx emdash types      # Regenerate TypeScript types from schema
npx emdash seed seed/seed.json --validate  # Validate seed file
```

The admin UI is at `http://localhost:4321/_emdash/admin`.

## Key Files

| File                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `astro.config.mjs`       | Astro config with `emdash()` integration, database, and storage                    |
| `src/live.config.ts`     | EmDash loader registration (boilerplate -- don't modify)                           |
| `seed/seed.json`         | Schema definition + demo content (collections, fields, taxonomies, menus, widgets) |
| `emdash-env.d.ts`        | Generated types for collections (auto-regenerated on dev server start)             |
| `src/layouts/Base.astro` | Base layout with EmDash wiring (menus, search, page contributions)                 |
| `src/pages/`             | Astro pages -- all server-rendered                                                 |

## Skills

Agent skills are in `.agents/skills/`. Load them when working on specific tasks:

- **building-emdash-site** -- Querying content, rendering Portable Text, schema design, seed files, site features (menus, widgets, search, SEO, comments, bylines). Start here.
- **creating-plugins** -- Building EmDash plugins with hooks, storage, admin UI, API routes, and Portable Text block types.
- **emdash-cli** -- CLI commands for content management, seeding, type generation, and visual editing flow.

## Rules

- All content pages must be server-rendered (`output: "server"`). No `getStaticPaths()` for CMS content.
- Image fields are objects (`{ src, alt }`), not strings. Use `<Image image={...} />` from `"emdash/ui"`.
- `entry.id` is the slug (for URLs). `entry.data.id` is the database ULID (for API calls like `getEntryTerms`).
- Always call `Astro.cache.set(cacheHint)` on pages that query content.
- Taxonomy names in queries must match the seed's `"name"` field exactly (e.g., `"category"` not `"categories"`).


# =========================================
# SOURCE: /Users/samfakhreddine/repos/oss/emdash/.claude/CLAUDE.md
# =========================================

This file provides guidance to agentic coding tools working in this repository.

For human-facing contributor info (setup, repo layout, PR policy, changesets, i18n), see [CONTRIBUTING.md](CONTRIBUTING.md). This file focuses on the patterns and gotchas an agent needs to write correct code.

`CLAUDE.md` is a symlink to this file. `.opencode/skills` and `.claude/skills` are symlinks to `skills/`. Don't try to sync between them.

# Rules

**Backwards compatibility matters.** EmDash is published and in active use, pre-1.0. Prefer additive changes (new fields, new routes, new options with defaults). Breaking changes need an explicit decision, a package bump, and a changeset that calls the break out clearly. Database migrations are forward-only -- never write one that leaves existing content inaccessible. When in doubt, open a Discussion.

**TDD for bugs.** Failing test -> fix -> verify. A bug without a reproducing test is not fixed.

**Localize everything user-facing.** All admin UI strings, aria labels, and toast messages go through Lingui. All admin layout uses RTL-safe logical Tailwind classes. See [Localization](#admin-ui-localization-lingui) and [RTL](#admin-ui-rtl-safe-tailwind).

**Scope discipline.** No drive-by refactors, no bulk lint/type cleanups, no "while I'm here" edits in unrelated files. If you see a systemic issue, open a Discussion. See [CONTRIBUTING.md § Contribution Policy](CONTRIBUTING.md#contribution-policy).

## Workflow

Run `pnpm lint:json | jq '.diagnostics | length'` before starting and confirm it's clean -- if it's failing after your edits, your changes caused it.

During work:

- `pnpm lint:quick` after every edit (sub-second)
- `pnpm typecheck` (packages) or `pnpm typecheck:demos` (Astro demos) after each round of edits
- `pnpm format` regularly (oxfmt, tabs)

Before opening a PR: tests pass, lint clean, formatted, changeset added if a published package changed. See [CONTRIBUTING.md § Changesets](CONTRIBUTING.md#changesets).

When opening a PR with `gh`/the API, copy `.github/PULL_REQUEST_TEMPLATE.md` into the body and fill every section -- the GitHub UI injects it automatically but the CLI does not, and PRs missing it are auto-closed. Check the AI-generated code disclosure box and name the model. Tick checklist items only for what you actually verified; for test-only/docs/CI PRs, note why changeset/i18n/Discussion items are n/a.

## Architecture

EmDash is an Astro-native CMS on Cloudflare (D1 + R2 + Workers) or Node + SQLite.

- **Schema in the database.** `_emdash_collections` and `_emdash_fields` are the source of truth. Each collection gets a real SQL table (`ec_posts`, `ec_products`) with typed columns -- not EAV.
- **Middleware chain:** runtime init -> setup check -> auth -> request context (ALS). Auth middleware checks authentication only; routes check authorization.
- **Handler layer** (`packages/core/src/api/handlers/*.ts`) holds business logic and returns `ApiResult<T>` (`{ success: true, data } | { success: false, error: { code, message, details? } }`). Route files are thin wrappers.
- **Storage abstraction:** `Storage` interface with `upload/download/delete/exists/list/getSignedUploadUrl`. `LocalStorage` for dev, `S3Storage` for R2/AWS. Access via `emdash.storage` from locals.

Key files:

| File                                              | Purpose                                               |
| ------------------------------------------------- | ----------------------------------------------------- |
| `packages/core/src/emdash-runtime.ts`             | Central runtime; orchestrates DB, plugins, storage    |
| `packages/core/src/schema/registry.ts`            | Manages `ec_*` table creation/modification            |
| `packages/core/src/database/migrations/runner.ts` | StaticMigrationProvider; register new migrations here |
| `packages/core/src/plugins/manager.ts`            | Loads and orchestrates plugins                        |

# Code Patterns

## Database: Never Interpolate Into SQL

Kysely is the query builder.

- **Never** use `sql.raw()` with string interpolation or template literals containing variables.
- For **values**, use Kysely's `sql` tagged template -- interpolated values are automatically parameterized.
- For **identifiers** (table/column names), use `sql.ref()`.
- If you must use `sql.raw()` for dynamic identifiers, validate with `validateIdentifier()` from `database/validate.ts` first (asserts `/^[a-z][a-z0-9_]*$/`).
- The `json_extract(data, '$.${field}')` pattern is particularly dangerous -- always validate `field`.

```typescript
// WRONG -- SQL injection
const query = `SELECT * FROM ${table} WHERE name = '${name}'`;
await sql.raw(query).execute(db);

// RIGHT -- parameterized value, safe identifier
await sql`SELECT * FROM ${sql.ref(table)} WHERE name = ${name}`.execute(db);

// RIGHT -- validated identifier in raw SQL
validateIdentifier(field);
return sql.raw(`json_extract(data, '$.${field}')`);
```

## API Routes

Routes live in `packages/core/src/astro/routes/api/`. Conventions:

- Every route file starts with `export const prerender = false;`.
- Named exports: `export const GET: APIRoute`, etc. Destructure from the Astro context.
- Access runtime via `const { emdash } = locals;`, user via `locals.user`.
- File structure mirrors URLs: `content/[collection]/index.ts` for list/create, `[id].ts` for get/update/delete, sub-actions as siblings.
- **Never** add GET handlers for state-changing operations.

Use the shared utilities -- don't roll your own:

| Need            | Use                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------- |
| Error response  | `apiError(code, message, status)` from `#api/error.js`                                   |
| Catch block     | `handleError(error, message, code)` -- never expose `error.message` to clients           |
| Body validation | `parseBody(request, zodSchema)` from `#api/parse.js` -- never `as` cast `request.json()` |
| Unwrap handler  | `unwrapResult(result)` -- maps error codes to HTTP statuses automatically                |
| Init check      | `if (!emdash) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);`      |

The error helper is `mapErrorStatus`, not `mapErrorToStatus`.

### Authorization

Every state-changing route must check authorization. Authorization is permission-based, not role-based -- the `Permissions` map in `packages/auth/src/rbac.ts` is authoritative. Never invent permission strings in route files; add them to `rbac.ts` with a sensible minimum role.

```typescript
import { requirePerm, requireOwnerPerm } from "#api/authorize.js";

// Any-actor capability (settings, schema)
const denied = requirePerm(user, "schema:manage");
if (denied) return denied;

// Ownership-aware (authors edit their own; editors edit anyone's)
const denied = requireOwnerPerm(user, post.authorId, "content:edit_own", "content:edit_any");
if (denied) return denied;
```

Both helpers return `null` on success or a `Response` (401/403) to return directly.

### CSRF

All state-changing endpoints require the `X-EmDash-Request: 1` header, enforced by auth middleware. The admin UI and visual editing client send it automatically.

### Pagination

List endpoints return `{ items, nextCursor? }` -- never a bare array. Use `encodeCursor(orderValue, id)` / `decodeCursor(cursor)`. Default limit 50, max 100, always clamp. The repository-level shape is `FindManyResult<T>`.

### URL/Redirect handling

When accepting redirect URLs from query params or bodies: require leading `/`, reject `//`, HTML-escape before interpolation, prefer `Response.redirect()` over `<meta http-equiv="refresh">`.

## Handler Layer

Handlers in `api/handlers/*.ts` are standalone async functions, not class methods.

- First parameter is always `db: Kysely<Database>`, followed by route-specific params.
- Return `ApiResult<T>`.
- Wrap the body in try/catch. Errors return `{ success: false, error: { code, message } }`.
- Error codes are `SCREAMING_SNAKE_CASE` (`NOT_FOUND`, `VALIDATION_ERROR`, `CONTENT_CREATE_ERROR`).

## Migrations

Migrations live in `packages/core/src/database/migrations/`.

- **Naming:** `NNN_descriptive_name.ts`, zero-padded.
- **Exports:** `up(db: Kysely<unknown>)` and `down(db: Kysely<unknown>)`.
- **System tables:** Kysely schema builder.
- **Dynamic content tables (`ec_*`):** `sql` tagged templates with `sql.ref()` for identifiers.
- **Column types:** SQLite -- `text`, `integer`, `real`, `blob`. Booleans are `integer` defaulting to 0. Timestamps are `text` with ``defaultTo(sql`(datetime('now'))`)``. IDs are `text` primary keys (ULIDs from `ulidx`).
- **Registration:** Migrations are statically imported in `runner.ts` and added to `StaticMigrationProvider`. Not auto-discovered (Workers bundler compatibility). When adding: create the file, add a static import in `runner.ts`, add it to `getMigrations()`.
- **Multi-table migrations:** When altering all content tables, query `_emdash_collections` and loop. See `013_scheduled_publishing.ts`.

## Indexes

Every content table gets indexes on: `status`, `slug`, `created_at`, `deleted_at`, `scheduled_at` (partial, `WHERE scheduled_at IS NOT NULL`), `live_revision_id`, `draft_revision_id`, `author_id`, `primary_byline_id`, `updated_at`, `locale`, `translation_group`. Foreign key columns always get an index.

Naming: `idx_{table}_{column}` for single-column, `idx_{table}_{purpose}` for multi-column.

## Content Tables

Managed by `SchemaRegistry` in `schema/registry.ts`:

- **Names:** `ec_{collection_slug}`. System tables: `_emdash_{name}`.
- **Slugs:** `/^[a-z][a-z0-9_]*$/`, max 63 chars, checked against `RESERVED_COLLECTION_SLUGS` / `RESERVED_FIELD_SLUGS`.
- **Standard columns:** `id`, `slug`, `status`, `author_id`, `created_at`, `updated_at`, `published_at`, `scheduled_at`, `deleted_at`, `version`, `live_revision_id`, `draft_revision_id`. Field columns added via `ALTER TABLE`.
- **Field type -> column mapping:** `FIELD_TYPE_TO_COLUMN` in `schema/types.ts`. Most string-shaped types -> TEXT; number -> REAL; integer/boolean -> INTEGER; portableText/json/multiSelect -> JSON.
- **Orphan discovery:** `discoverOrphanedTables()` finds `ec_*` tables without a matching `_emdash_collections` row.

## Content Localization

Content tables use a row-per-locale model (migration `019_i18n.ts`):

- Every `ec_*` table has `locale` (defaults to `'en'`) and `translation_group` (ULID shared across translations).
- Slug uniqueness is `UNIQUE(slug, locale)`, not global.
- Any new query against a content table must filter by `locale` -- forgetting this is a correctness bug.
- Fetch all translations via `GET /_emdash/api/content/{collection}/{id}/translations`.

When adding content-table features, ask: per-locale (display fields) or per-translation-group (anything identifying "the same thing" across languages)?

## Performance: Caching and Query Patterns

EmDash runs on D1 with the Sessions API. Anonymous reads go to the nearest replica; writes and authenticated reads route to the primary. Every round-trip matters.

**Wrap query helpers in `requestCached`.** Per-request cache (`src/request-cache.ts`) dedupes identical calls within a render. If a helper takes stable args (slug, key, id) and may be called from multiple components, wrap it. The cache key must include every argument that changes the result. The promise is cached, so concurrent callers share the in-flight query.

```typescript
export function getSiteSetting(key: string) {
	return requestCached(`siteSetting:${key}`, async () => {
		const db = await getDb();
		return ...;
	});
}
```

**Module-scope singletons must live on `globalThis`.** Vite duplicates modules across SSR chunks; a plain `let cache = null` becomes two variables. Use a `Symbol.for` key on `globalThis`. See `packages/core/src/settings/index.ts` (versioned) and `packages/core/src/request-context.ts` / `request-cache.ts` (per-request).

**Prefer the batch query to a "has any" probe.** Don't add a `SELECT id FROM foo LIMIT 1` to skip work on empty sites -- on live sites you pay the extra query every request for no gain. Handle missing tables with `isMissingTableError`.

**Defer bookkeeping with `after(fn)`.** Maintenance writes don't need to block TTFB. `after()` uses workerd's `waitUntil` when available, fire-and-forgets on Node. Wrap your function body in try/catch with a module-specific log prefix.

```typescript
import { after } from "emdash";

after(async () => {
	try {
		await recoverStaleLocks();
	} catch (error) {
		console.error("[cron] recovery failed:", error);
	}
});
```

**One query beats two.** Use `LEFT JOIN` for parent+children. Batch with `WHERE id IN (...)`, chunked at `SQL_BATCH_SIZE` (from `utils/chunks.ts`) for D1's bind-parameter limit.

**Query-count snapshots.** `pnpm query-counts` (see `scripts/query-counts.mjs`) records per-route query counts in `scripts/query-counts.snapshot.{sqlite,d1}.json`. CI auto-updates on PRs -- review the diff. Fewer is always right; more needs a conversation.

# Admin UI

The admin (`packages/admin`) is a React SPA mounted under `/_emdash/admin/*`.

## Kumo Components

Built on [Kumo](https://github.com/cloudflare/kumo) (Cloudflare's design system). Never roll your own buttons, inputs, dialogs, etc. -- use Kumo. Get consistent styling, dark mode, accessibility, RTL for free.

Look up docs from the CLI:

```bash
npx @cloudflare/kumo doc Button   # specific component
npx @cloudflare/kumo ls           # list all
```

Common imports: `Button`, `LinkButton`, `Dialog`, `Input`, `InputArea`, `Select`, `Checkbox`, `Switch`, `Loader`, `Badge`, `Toast`/`Toasty`, `Popover`, `Dropdown`, `Tooltip`, `Label`, `CommandPalette`.

### Buttons and links

| Need                                      | Component                        |
| ----------------------------------------- | -------------------------------- |
| In-place action                           | `Button`                         |
| External link styled as a button          | `LinkButton href="..." external` |
| Internal router-aware link as a button    | `RouterLinkButton to="..."`      |
| Non-button element needing button classes | `buttonVariants(...)`            |

`RouterLinkButton` wraps TanStack Router's `<Link>` with Kumo button classes. Never write `<Link><Button>...</Button></Link>` (invalid `<a><button>` HTML). Never hand-roll button styling on an `<a>`.

### Styling rules

- Use semantic tokens (`bg-kumo-brand`, `text-kumo-subtle`). Never raw Tailwind colors.
- Never use `dark:` prefixes. Kumo's tokens use CSS `light-dark()`.
- Never duplicate component styles. If you're writing `bg-kumo-brand text-white rounded-md px-3 py-2` on a `<button>`, use Kumo's `Button` instead.

### Dialogs and errors

- `ConfirmDialog` (in `components/`) for confirm/cancel modals. Pass `mutation.error` directly -- don't manage error state manually.
- `DialogError` + `getMutationError()` for inline errors in form dialogs.
- Admin API client functions use `throwResponseError()` from `lib/api/client.ts` to surface server messages -- never `throw new Error("Failed to X")` and lose the body.

## Admin UI: Localization (Lingui)

Every user-facing string goes through Lingui. No hard-coded English in JSX, attributes, or strings that end up in the DOM.

- Catalogs: `packages/admin/src/locales/{locale}/messages.po`. English is source.
- Enabled locales: `packages/admin/src/locales/locales.ts`.
- **Don't include `messages.po` changes in non-translation PRs.** A workflow runs `pnpm locale:extract` on merge to `main`. Including extracted catalog updates in feature PRs creates merge churn -- revert before opening.
- Set `EMDASH_PSEUDO_LOCALE=1` in dev to render pseudo-localized text and spot untranslated leaks.

```typescript
import { useLingui } from "@lingui/react/macro";
import { Trans } from "@lingui/react/macro";

function DeleteButton() {
	const { t } = useLingui();
	return <button aria-label={t`Delete post`}>{t`Delete`}</button>;
}

// JSX with nested components
<Trans>Published by <strong>{authorName}</strong> on {formattedDate}</Trans>

// Pluralization
import { plural } from "@lingui/core/macro";
const label = plural(count, { one: "# item", other: "# items" });

// Module-scope constants: msg`` descriptors, resolved with t() in the component
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

const transforms: { id: string; label: MessageDescriptor }[] = [
	{ id: "paragraph", label: msg`Paragraph` },
];
// ...inside component: t(transforms[0].label)
```

Common mistakes:

- Bare string literals in JSX, unwrapped aria/title/placeholder/alt attributes.
- Concatenating translated pieces (`` t`Hello ` + name``) -- breaks word order. Use `` t`Hello ${name}` `` or `<Trans>`.
- Calling `t` at module scope -- locale isn't bound. Use `msg` + `t(descriptor)` inside a component.

Server-side error messages are English-only for now. Keep error codes stable (`SCREAMING_SNAKE_CASE`); the admin maps codes to localized messages client-side.

## Admin UI: RTL-safe Tailwind

The admin supports RTL locales. Use logical Tailwind classes, never physical:

| Use                           | Not                           |
| ----------------------------- | ----------------------------- |
| `ms-*` / `me-*`               | `ml-*` / `mr-*`               |
| `ps-*` / `pe-*`               | `pl-*` / `pr-*`               |
| `start-*` / `end-*`           | `left-*` / `right-*`          |
| `text-start` / `text-end`     | `text-left` / `text-right`    |
| `border-s` / `border-e`       | `border-l` / `border-r`       |
| `rounded-s-*` / `rounded-e-*` | `rounded-l-*` / `rounded-r-*` |
| `float-start` / `float-end`   | `float-left` / `float-right`  |

For directional icons (chevrons, arrows), flip them with `rtl:-scale-x-100` or use a bidi-aware icon.

`LocaleDirectionProvider` syncs `document.documentElement.dir`/`lang` automatically.

**Test new admin UI in Arabic** before declaring done. Broken directionality is the most common i18n regression.

# Conventions

## Imports

- **Internal imports** use `.js` extensions (ESM): `import { X } from "../foo.js"`.
- **Type-only imports** use `import type` (`verbatimModuleSyntax` is on).
- **Package imports** have no extension: `import { sql } from "kysely"`.
- **Virtual modules** need a `// @ts-ignore`: `// @ts-ignore - virtual module` above `import virtualConfig from "virtual:emdash/config"`.
- **Barrel files** separate `export type { ... }` from value exports.

## Environment

- Use `import.meta.env.DEV` / `import.meta.env.PROD` (Vite/Astro standard). Never `process.env.NODE_ENV`.
- Dev-only endpoints must check `import.meta.env.DEV` and return 403 otherwise -- it's a compile-time constant, unspoofable at runtime.
- Secrets pattern: `import.meta.env.EMDASH_X || import.meta.env.X || ""`.

## Cloudflare Env

Import `env` directly from `"cloudflare:workers"` -- a virtual module that resolves to the right bindings for the current environment (Worker or local dev).

Don't manually type the `Env` object. In a Worker context, run `pnpm wrangler types` to generate `worker-configuration.d.ts` (includes wrangler.jsonc bindings and `.dev.vars` secrets). Reference it in `tsconfig.json`'s `include`.

In libraries used in a Worker but not themselves Workers, install `@cloudflare/workers-types` and reference it in `tsconfig.compilerOptions.types`.

# Testing

- **Framework:** vitest. Tests in `packages/core/tests/`.
- **No mocks for the DB.** SQLite (`better-sqlite3`) by default. PostgreSQL parity tests via a real `pg` connection with per-test schema isolation (set `PG_CONNECTION_STRING` to opt in).
- **Utilities:** `tests/utils/test-db.ts` exposes `setupTestDatabase()`, `setupTestDatabaseWithCollections()`, `teardownTestDatabase()` for SQLite and `setupTestPostgresDatabase()` etc. for Postgres. Dialect-agnostic: `setupForDialect`, `setupForDialectWithCollections`, `teardownForDialect`, plus `describeEachDialect(name, fn)`. Use the dialect wrapper for query-builder code -- regressions tend to be dialect-specific.
- **Structure:** `tests/unit/`, `tests/integration/`, `tests/e2e/` (Playwright). Test files mirror source structure. Each test gets a fresh DB.

# Toolchain

- **pnpm** -- package manager
- **tsdown** -- TypeScript builds (ESM + DTS)
- **vitest** -- testing
- **oxfmt** -- formatting (tabs, configured in `.prettierrc`). All source files use tabs.

TypeScript: target ES2023, module `preserve`, strict mode with `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`.

# Dev Bypass for Browser Testing

Passkey auth can't be automated in browser tests. Two dev-only endpoints (`import.meta.env.DEV` only, 403 in prod):

- `GET /_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` -- runs migrations, creates a dev admin user (`dev@emdash.local`), establishes a session, redirects.
- `GET /_emdash/api/auth/dev-bypass?redirect=/_emdash/admin` -- assumes setup is complete, just creates a session.

In agent-browser:

```typescript
await page.goto("http://localhost:4321/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin");
```


# =========================================
# SOURCE: /Users/samfakhreddine/repos/oss/emdash/templates/marketing-cloudflare/AGENTS.md
# =========================================

This is an EmDash site -- a CMS built on Astro with a full admin UI.

## Commands

```bash
npx emdash dev        # Start dev server (runs migrations, seeds, generates types)
npx emdash types      # Regenerate TypeScript types from schema
```

The admin UI is at `http://localhost:4321/_emdash/admin`.

## Key Files

| File                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `astro.config.mjs`       | Astro config with `emdash()` integration, database, and storage                    |
| `src/live.config.ts`     | EmDash loader registration (boilerplate -- don't modify)                           |
| `seed/seed.json`         | Schema definition + demo content (collections, fields, taxonomies, menus, widgets) |
| `emdash-env.d.ts`        | Generated types for collections (auto-regenerated on dev server start)             |
| `src/layouts/Base.astro` | Base layout with EmDash wiring (menus, search, page contributions)                 |
| `src/pages/`             | Astro pages -- all server-rendered                                                 |

## Skills

Agent skills are in `.agents/skills/`. Load them when working on specific tasks:

- **building-emdash-site** -- Querying content, rendering Portable Text, schema design, seed files, site features (menus, widgets, search, SEO, comments, bylines). Start here.
- **creating-plugins** -- Building EmDash plugins with hooks, storage, admin UI, API routes, and Portable Text block types.
- **emdash-cli** -- CLI commands for content management, seeding, type generation, and visual editing flow.

## Documentation

The EmDash docs are available as an MCP server at `https://docs.emdashcms.com/mcp`. When you need to verify an API, hook, config option, field type, or pattern, call `search_docs` against the live documentation rather than relying on training-data recall. The docs reflect current behaviour; assumptions may not.

This template ships with `.mcp.json`, `.cursor/mcp.json`, and `.vscode/mcp.json` so Claude Code, Cursor, and VS Code auto-discover the docs server. Other tools (OpenCode, Windsurf, etc.) need a manual one-time setup -- see [docs.emdashcms.com/docs-mcp](https://docs.emdashcms.com/docs-mcp).

## Rules

- All content pages must be server-rendered (`output: "server"`). No `getStaticPaths()` for CMS content.
- Image fields are objects (`{ src, alt }`), not strings. Use `<Image image={...} />` from `"emdash/ui"`.
- `entry.id` is the slug (for URLs). `entry.data.id` is the database ULID (for API calls like `getEntryTerms`).
- Always call `Astro.cache.set(cacheHint)` on pages that query content.
- Taxonomy names in queries must match the seed's `"name"` field exactly (e.g., `"category"` not `"categories"`).

## This Template

A SaaS-style landing page template with modular content blocks: hero, features, testimonials, pricing, FAQ, plus a real contact page. Designed for product marketing sites, app landing pages, and anything that needs a hero + features + pricing + CTA flow.

Bolder than the blog and portfolio templates: vibrant gradient accents, isometric illustration in the hero, heavy headline weights. The voice is product-confident without tipping into stock SaaS cliche.

## Pages

| Page    | Path       | What it shows                                                                                                                    |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Home    | `/`        | Marketing blocks in any order (hero, features, testimonials, pricing, FAQ) authored as a Portable Text document on the Home page |
| Pricing | `/pricing` | Same block-driven editor -- "Simple, transparent pricing" page using the `pricing` block                                         |
| Contact | `/contact` | Left column with contact methods (Email / Support / Sales, each with a gradient icon), right column with a form                  |

There is no posts collection. Content is entirely authored as marketing blocks inside `pages`.

## Schema

- `pages` collection: `title`, `content` (Portable Text containing marketing blocks).
- No taxonomies.
- Four menus: `primary`, `footer_product`, `footer_company`, `footer_support`.

Site settings have `title` and `tagline`. Title renders in the header; tagline is used in the footer / metadata.

## Marketing blocks

This template ships a local plugin at `src/plugins/marketing-blocks/` that registers five Portable Text block types. Editors insert them in the admin's Portable Text editor; they render via `src/components/blocks/{Hero,Features,Testimonials,Pricing,FAQ}.astro` (dispatched from `MarketingBlocks.astro`).

| Block                    | Fields                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `marketing.hero`         | `headline`, `subheadline`, `primaryCtaLabel`, `primaryCtaUrl`, `secondaryCtaLabel`, `secondaryCtaUrl`, `centered` (toggle)         |
| `marketing.features`     | `headline`, `subheadline`, repeater of `{ icon, title, description }`                                                              |
| `marketing.testimonials` | `headline`, repeater of `{ quote, author, role, company, avatar (URL) }`                                                           |
| `marketing.pricing`      | `headline`, repeater of `{ name, price, period, description, features (newline-separated string), ctaLabel, ctaUrl, highlighted }` |
| `marketing.faq`          | `headline`, repeater of `{ question, answer }`                                                                                     |

Constraints worth remembering:

- Block Kit has no nested object element, so a CTA's `{ label, url }` is flattened to sibling fields like `primaryCtaLabel` + `primaryCtaUrl`. The renderer reads the flat keys -- don't try to nest them.
- Repeater sub-fields are scalar only. Lists-of-strings (e.g. pricing features) are a single multiline text field, split on newline at render time.
- There is no media-picker element in the plugin block modal yet, so where image fields exist they are URL strings entered by hand (testimonial `avatar`). Use real URLs, not placeholders.
- The `marketing.hero` block has no image field in the editor schema. The hero renderer falls back to the bundled `/hero-visual.svg` illustration when no image is set. To customise the hero artwork, swap `/hero-visual.svg` in `public/` or extend the plugin schema with an image field (and update `Hero.astro` accordingly).
- Icons in the Features block come from a fixed set: `zap, shield, users, chart, code, globe, heart, star, check, lock, clock, cloud`. Pick from that list.

## Visual character

Typography is **Inter** on `--font-sans` with weights up to 800 for headline emphasis. There is no mono font, no serif. Headline tracking is tight.

Colour is the loudest of any template here. The default palette is:

- `--color-primary: #6366f1` (indigo) -- main brand colour, used in buttons and links
- `--color-accent: #f472b6` (pink) -- paired with primary in gradients (CTA buttons, icon backgrounds)
- `--color-success`, `--color-warning` -- semantic colours for inline icons (pricing checkmarks)

Gradients are part of the look (`--color-primary` -> `--color-accent` on the "Get Started" button, on contact-method icons, on the "Most popular" pricing badge). Don't strip them entirely -- the template will look generic without them. Do swap them for a different pair if the brand calls for it.

Roundness is generous: `--radius` is 10px, `--radius-lg` 16px, plus a `--radius-full` for pills. Shadows are layered (`--shadow-sm` through `--shadow-xl`).

## Customisation

`src/styles/theme.css` is the only file to edit for visual changes. Every CSS variable from `Base.astro` is listed there as a commented default. The dark mode palette is defined inside `Base.astro`; light-mode overrides in `theme.css` won't affect dark mode. To customise dark mode, add `@media (prefers-color-scheme: dark)` and `:root.dark` rules in `theme.css`.

Fonts are configured in `astro.config.mjs` under `fonts:`. To swap the typeface, change the `name:` for the entry bound to `cssVariable: "--font-sans"`. Inter has 5 weights loaded (400-800) for hero impact -- if you swap, ensure the replacement has comparable weight range. Geist, Plus Jakarta Sans, Manrope, and DM Sans all work well as replacements.

CSS variables worth knowing:

- `--color-primary`, `--color-primary-dark`, `--color-primary-light`
- `--color-accent`, `--color-accent-light`
- `--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, `--color-border`
- `--font-sans`
- `--font-size-{xs,sm,base,lg,xl,2xl,3xl,4xl,5xl,6xl}` -- type scale up to 4.5rem for the largest hero
- `--radius-sm` (6px), `--radius` (10px), `--radius-lg` (16px), `--radius-full`
- `--shadow-sm`, `--shadow`, `--shadow-lg`, `--shadow-xl`

To re-brand, the highest-leverage moves are:

1. Change `--color-primary` and `--color-accent` to the brand pair.
2. Update the site title (logo wordmark) and tagline.
3. Replace the hero illustration URL.
4. Edit hero `headline` and `subheadline` blocks to specific, concrete copy.

## What not to do

- Don't write stock SaaS copy: "Build products people actually want", "Elevate your workflow", "The all-in-one platform for modern teams". These are placeholder. Write what the product actually does, for whom, with one specific outcome.
- Don't ship more than three pricing tiers. Three is the default for a reason -- more makes choice harder, not easier.
- Don't use icon and stock photo combos that fight each other. Pick illustration _or_ photography, not both.
- Don't enable the gradient on every interactive element. The CTA gradient is the signal; if it's on every button, it stops signalling.
- Don't add a hero block followed immediately by another hero block. One hero, then features / testimonials / pricing / FAQ in some order.
- Don't replace the `marketing.pricing` block with a hand-coded table. The block is the data shape downstream renderers expect.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/oss/emdash/templates/blog/AGENTS.md
# =========================================

This is an EmDash site -- a CMS built on Astro with a full admin UI.

## Commands

```bash
npx emdash dev        # Start dev server (runs migrations, seeds, generates types)
npx emdash types      # Regenerate TypeScript types from schema
```

The admin UI is at `http://localhost:4321/_emdash/admin`.

## Key Files

| File                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `astro.config.mjs`       | Astro config with `emdash()` integration, database, and storage                    |
| `src/live.config.ts`     | EmDash loader registration (boilerplate -- don't modify)                           |
| `seed/seed.json`         | Schema definition + demo content (collections, fields, taxonomies, menus, widgets) |
| `emdash-env.d.ts`        | Generated types for collections (auto-regenerated on dev server start)             |
| `src/layouts/Base.astro` | Base layout with EmDash wiring (menus, search, page contributions)                 |
| `src/pages/`             | Astro pages -- all server-rendered                                                 |

## Skills

Agent skills are in `.agents/skills/`. Load them when working on specific tasks:

- **building-emdash-site** -- Querying content, rendering Portable Text, schema design, seed files, site features (menus, widgets, search, SEO, comments, bylines). Start here.
- **creating-plugins** -- Building EmDash plugins with hooks, storage, admin UI, API routes, and Portable Text block types.
- **emdash-cli** -- CLI commands for content management, seeding, type generation, and visual editing flow.

## Documentation

The EmDash docs are available as an MCP server at `https://docs.emdashcms.com/mcp`. When you need to verify an API, hook, config option, field type, or pattern, call `search_docs` against the live documentation rather than relying on training-data recall. The docs reflect current behaviour; assumptions may not.

This template ships with `.mcp.json`, `.cursor/mcp.json`, and `.vscode/mcp.json` so Claude Code, Cursor, and VS Code auto-discover the docs server. Other tools (OpenCode, Windsurf, etc.) need a manual one-time setup -- see [docs.emdashcms.com/docs-mcp](https://docs.emdashcms.com/docs-mcp).

## Rules

- All content pages must be server-rendered (`output: "server"`). No `getStaticPaths()` for CMS content.
- Image fields are objects (`{ src, alt }`), not strings. Use `<Image image={...} />` from `"emdash/ui"`.
- `entry.id` is the slug (for URLs). `entry.data.id` is the database ULID (for API calls like `getEntryTerms`).
- Always call `Astro.cache.set(cacheHint)` on pages that query content.
- Taxonomy names in queries must match the seed's `"name"` field exactly (e.g., `"category"` not `"categories"`).

## This Template

A blog with posts, pages, categories, tags, full-text search, and RSS. Designed for personal writing, technical writing, indie newsletters, and anything where the writing is the product. Editorial-tech aesthetic: confident sans-serif, restrained accent, real article structure with bylines and reading time.

## Pages

| Page        | Path               | What it shows                                                                                          |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| Home        | `/`                | Featured post hero (large image + excerpt), latest posts grid                                          |
| All posts   | `/posts`           | Article count, full post list with excerpts and tag chips                                              |
| Post detail | `/posts/[slug]`    | Featured image, title, body, left meta column (authors + date), right TOC + search + categories gutter |
| Search      | `/search`          | Full-text search UI                                                                                    |
| Page        | `/pages/[slug]`    | Static page content (Portable Text)                                                                    |
| Category    | `/category/[slug]` | Posts filtered by category                                                                             |
| Tag         | `/tag/[slug]`      | Posts filtered by tag                                                                                  |
| RSS         | `/rss.xml`         | Generated feed                                                                                         |

## Schema

- `posts` collection: `title`, `featured_image`, `content` (Portable Text), `excerpt` (text).
- `pages` collection: `title`, `content` (Portable Text). Used for `/about` etc.
- Taxonomies: `category`, `tag`.
- Single `primary` menu (Home, About, Posts by default).

Site settings have `title` and `tagline` -- both render in the header / footer.

## Visual character

Single typeface: **Inter** on `--font-sans`, used for everything including headings (with tighter letter-spacing on h1/h2). **JetBrains Mono** on `--font-mono` for inline code and code blocks. Body and headings share the same family; weight and size carry the hierarchy.

The accent is `#0066cc` -- used for links, the post-card title hover, and the search input focus ring. There's also a secondary text colour (`--color-text-secondary`) and a `--color-muted` for meta info. Don't add a second accent.

The article layout is the standout feature: a three-column reading view with a left meta column (author bylines, date), centred 680px body column, and a right gutter for search, table of contents, and categories. Don't flatten that into one column on desktop -- the layout signals "this is something to read".

## Customisation

`src/styles/theme.css` is the only file to edit for visual changes. Every CSS variable from `Base.astro` is listed there as a commented default -- uncomment and change to override. The dark mode palette is defined inside `Base.astro` itself; light-mode overrides in `theme.css` won't affect dark mode. To customise dark mode, add `@media (prefers-color-scheme: dark)` and `:root.dark` rules in `theme.css`.

Fonts are configured in `astro.config.mjs` under `fonts:`. To swap the body face, change the `name:` for the entry bound to `cssVariable: "--font-sans"`. Good alternatives: Geist, IBM Plex Sans, Söhne (if you have a licence), Public Sans. If you want a serif-bodied blog, swap to a humanist serif like Source Serif, Crimson Pro, or Lora -- but then also raise `--font-size-base` to `1.0625rem` for readability.

CSS variables worth knowing:

- `--color-accent`, `--color-accent-hover`, `--color-on-accent`, `--color-accent-ring`
- `--color-bg`, `--color-bg-subtle`, `--color-surface`, `--color-text`, `--color-text-secondary`, `--color-muted`, `--color-border`, `--color-border-subtle`
- `--font-sans`, `--font-mono`
- `--tracking-tight` / `--tracking-snug` / `--tracking-wide` / `--tracking-wider` -- letter-spacing tokens used across headings and meta labels
- `--content-width` (680px) -- article body column
- `--wide-width` (1200px) -- max container
- `--gutter-width` (200px) -- right sidebar (TOC) on article pages
- `--meta-col-width` (180px) -- left meta column on article pages
- `--avatar-size-{xs,sm,md,lg}` -- byline avatar sizes at different scales

## What not to do

- Don't add a second accent colour or coloured section backgrounds. The page should be black, white, and one blue.
- Don't replace Inter with a display sans (Bebas, Anton, etc.). Headings rely on weight contrast, not novelty faces.
- Don't collapse the article gutter on desktop -- it's part of the reading experience.
- Don't use stock blog copy ("Welcome to my blog", "Stay tuned for more"). Write a real tagline that says what this blog is about.
- Don't seed the home page with three identical placeholder posts. If you only have one real post, show one real post.
- Don't enable comments without a plan to moderate them. The template doesn't ship a comments system by default for a reason.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/oss/emdash/templates/blank/AGENTS.md
# =========================================

This is an EmDash site -- a CMS built on Astro with a full admin UI.

## Commands

```bash
npx emdash dev        # Start dev server (runs migrations, seeds, generates types)
npx emdash types      # Regenerate TypeScript types from schema
```

The admin UI is at `http://localhost:4321/_emdash/admin`.

## Key Files

| File                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `astro.config.mjs`       | Astro config with `emdash()` integration, database, and storage                    |
| `src/live.config.ts`     | EmDash loader registration (boilerplate -- don't modify)                           |
| `seed/seed.json`         | Schema definition + demo content (collections, fields, taxonomies, menus, widgets) |
| `emdash-env.d.ts`        | Generated types for collections (auto-regenerated on dev server start)             |
| `src/layouts/Base.astro` | Base layout with EmDash wiring (menus, search, page contributions)                 |
| `src/pages/`             | Astro pages -- all server-rendered                                                 |

## Skills

Agent skills are in `.agents/skills/`. Load them when working on specific tasks:

- **building-emdash-site** -- Querying content, rendering Portable Text, schema design, seed files, site features (menus, widgets, search, SEO, comments, bylines). Start here.
- **creating-plugins** -- Building EmDash plugins with hooks, storage, admin UI, API routes, and Portable Text block types.
- **emdash-cli** -- CLI commands for content management, seeding, type generation, and visual editing flow.

## Documentation

The EmDash docs are available as an MCP server at `https://docs.emdashcms.com/mcp`. When you need to verify an API, hook, config option, field type, or pattern, call `search_docs` against the live documentation rather than relying on training-data recall. The docs reflect current behaviour; assumptions may not.

This template ships with `.mcp.json`, `.cursor/mcp.json`, and `.vscode/mcp.json` so Claude Code, Cursor, and VS Code auto-discover the docs server. Other tools (OpenCode, Windsurf, etc.) need a manual one-time setup -- see [docs.emdashcms.com/docs-mcp](https://docs.emdashcms.com/docs-mcp).

## Rules

- All content pages must be server-rendered (`output: "server"`). No `getStaticPaths()` for CMS content.
- Image fields are objects (`{ src, alt }`), not strings. Use `<Image image={...} />` from `"emdash/ui"`.
- `entry.id` is the slug (for URLs). `entry.data.id` is the database ULID (for API calls like `getEntryTerms`).
- Always call `Astro.cache.set(cacheHint)` on pages that query content.
- Taxonomy names in queries must match the seed's `"name"` field exactly (e.g., `"category"` not `"categories"`).

## This Template

The most minimal template. A single `index.astro` page with EmDash wired up and nothing else: no collections, no seed, no styles, no components, no layouts beyond what Astro provides by default.

Start here if you want full control from the beginning -- no schema or design decisions made for you.

## Pages

| Page | Path | What it shows                          |
| ---- | ---- | -------------------------------------- |
| Home | `/`  | A single Astro page with EmDash wiring |

## Schema

None. There are no collections, taxonomies, or menus seeded. You define everything via the admin UI (Schema -> Add collection) or by editing `seed/seed.json` once you create one.

## What to do here

This template is a substrate, not a starting design. The natural first steps are:

1. Decide what content types the site needs (posts? events? products?) and define them in the admin under Schema, or by adding a `seed/seed.json`.
2. Add the pages that render that content (e.g. `src/pages/posts/index.astro`).
3. Add a layout in `src/layouts/` for shared chrome.
4. Add styles -- this template has no `theme.css` and no fonts configured.

If any of that sounds like work you don't want to do, start from `starter`, `blog`, `portfolio`, or `marketing` instead. They make these decisions for you.

## What not to do

- Don't expect this template to render a designed site out of the box. It won't.
- Don't add features here that should live in the EmDash core or in a plugin. This template is meant to stay small.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/oss/emdash/templates/starter/AGENTS.md
# =========================================

This is an EmDash site -- a CMS built on Astro with a full admin UI.

## Commands

```bash
npx emdash dev        # Start dev server (runs migrations, seeds, generates types)
npx emdash types      # Regenerate TypeScript types from schema
```

The admin UI is at `http://localhost:4321/_emdash/admin`.

## Key Files

| File                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `astro.config.mjs`       | Astro config with `emdash()` integration, database, and storage                    |
| `src/live.config.ts`     | EmDash loader registration (boilerplate -- don't modify)                           |
| `seed/seed.json`         | Schema definition + demo content (collections, fields, taxonomies, menus, widgets) |
| `emdash-env.d.ts`        | Generated types for collections (auto-regenerated on dev server start)             |
| `src/layouts/Base.astro` | Base layout with EmDash wiring (menus, search, page contributions)                 |
| `src/pages/`             | Astro pages -- all server-rendered                                                 |

## Skills

Agent skills are in `.agents/skills/`. Load them when working on specific tasks:

- **building-emdash-site** -- Querying content, rendering Portable Text, schema design, seed files, site features (menus, widgets, search, SEO, comments, bylines). Start here.
- **creating-plugins** -- Building EmDash plugins with hooks, storage, admin UI, API routes, and Portable Text block types.
- **emdash-cli** -- CLI commands for content management, seeding, type generation, and visual editing flow.

## Documentation

The EmDash docs are available as an MCP server at `https://docs.emdashcms.com/mcp`. When you need to verify an API, hook, config option, field type, or pattern, call `search_docs` against the live documentation rather than relying on training-data recall. The docs reflect current behaviour; assumptions may not.

This template ships with `.mcp.json`, `.cursor/mcp.json`, and `.vscode/mcp.json` so Claude Code, Cursor, and VS Code auto-discover the docs server. Other tools (OpenCode, Windsurf, etc.) need a manual one-time setup -- see [docs.emdashcms.com/docs-mcp](https://docs.emdashcms.com/docs-mcp).

## Rules

- All content pages must be server-rendered (`output: "server"`). No `getStaticPaths()` for CMS content.
- Image fields are objects (`{ src, alt }`), not strings. Use `<Image image={...} />` from `"emdash/ui"`.
- `entry.id` is the slug (for URLs). `entry.data.id` is the database ULID (for API calls like `getEntryTerms`).
- Always call `Astro.cache.set(cacheHint)` on pages that query content.
- Taxonomy names in queries must match the seed's `"name"` field exactly (e.g., `"category"` not `"categories"`).

## This Template

A general-purpose starting point with posts, pages, categories, and tags. Less opinionated than the themed templates -- a base for sites that want to define their own design.

There is intentionally no `theme.css`, no custom font configuration, no styled layouts beyond browser defaults. The home, posts index, post detail, page, category, and tag pages all render with minimal styling. Start here if you want full control over the visual language; start with `blog`, `portfolio`, or `marketing` if you want a designed template to customise.

## Pages

| Page        | Path               | What it shows                                  |
| ----------- | ------------------ | ---------------------------------------------- |
| Home        | `/`                | Site title + tagline, links into Posts / About |
| All posts   | `/posts`           | Post list                                      |
| Post detail | `/posts/[slug]`    | Post content                                   |
| Page        | `/[slug]`          | Static page content (e.g. `/about`)            |
| Category    | `/category/[slug]` | Posts filtered by category                     |
| Tag         | `/tag/[slug]`      | Posts filtered by tag                          |

## Schema

- `posts` collection: `title`, `featured_image`, `content` (Portable Text), `excerpt` (text).
- `pages` collection: `title`, `content` (Portable Text).
- Taxonomies: `category`, `tag`.
- Single `primary` menu.

Site settings have `title` and `tagline`.

## Visual character

None imposed. Define your own.

This template ships without:

- `src/styles/theme.css` -- create one and import it from `Base.astro` if you want CSS-variable theming.
- Fonts in `astro.config.mjs` -- the `fonts:` array is empty. Add Google Fonts entries with `cssVariable` bindings if you want web fonts.
- A `components/` directory with styled cards / tag lists / etc. -- build them as needed.

## What to do here

If you're customising this template, the work is to add design, not to subtract it. Reasonable first moves:

1. Decide on one display + one body typeface, add them to `astro.config.mjs`, bind them to `--font-display` and `--font-body` CSS variables.
2. Create `src/styles/theme.css` with your colour palette, type scale, and spacing tokens.
3. Add it to `Base.astro` -- the layout already imports a small reset; add your theme above your page styles.
4. Build page-specific styles in each Astro page's `<style>` block, referencing the CSS variables.

If you want a designed template instead, switch to `blog`, `portfolio`, or `marketing` -- each ships with a full visual system you can re-skin via `theme.css`.

## What not to do

- Don't treat this as a finished design. The unstyled output is intentional; shipping it as-is looks unfinished because it is.
- Don't add component libraries (Tailwind UI, shadcn, etc.) without considering what they bring with them. The template is small on purpose.
- Don't recreate the blog template's three-column reading view here. If that's what you want, start from `blog`.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/oss/emdash/templates/portfolio/AGENTS.md
# =========================================

This is an EmDash site -- a CMS built on Astro with a full admin UI.

## Commands

```bash
npx emdash dev        # Start dev server (runs migrations, seeds, generates types)
npx emdash types      # Regenerate TypeScript types from schema
```

The admin UI is at `http://localhost:4321/_emdash/admin`.

## Key Files

| File                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `astro.config.mjs`       | Astro config with `emdash()` integration, database, and storage                    |
| `src/live.config.ts`     | EmDash loader registration (boilerplate -- don't modify)                           |
| `seed/seed.json`         | Schema definition + demo content (collections, fields, taxonomies, menus, widgets) |
| `emdash-env.d.ts`        | Generated types for collections (auto-regenerated on dev server start)             |
| `src/layouts/Base.astro` | Base layout with EmDash wiring (menus, search, page contributions)                 |
| `src/pages/`             | Astro pages -- all server-rendered                                                 |

## Skills

Agent skills are in `.agents/skills/`. Load them when working on specific tasks:

- **building-emdash-site** -- Querying content, rendering Portable Text, schema design, seed files, site features (menus, widgets, search, SEO, comments, bylines). Start here.
- **creating-plugins** -- Building EmDash plugins with hooks, storage, admin UI, API routes, and Portable Text block types.
- **emdash-cli** -- CLI commands for content management, seeding, type generation, and visual editing flow.

## Documentation

The EmDash docs are available as an MCP server at `https://docs.emdashcms.com/mcp`. When you need to verify an API, hook, config option, field type, or pattern, call `search_docs` against the live documentation rather than relying on training-data recall. The docs reflect current behaviour; assumptions may not.

This template ships with `.mcp.json`, `.cursor/mcp.json`, and `.vscode/mcp.json` so Claude Code, Cursor, and VS Code auto-discover the docs server. Other tools (OpenCode, Windsurf, etc.) need a manual one-time setup -- see [docs.emdashcms.com/docs-mcp](https://docs.emdashcms.com/docs-mcp).

## Rules

- All content pages must be server-rendered (`output: "server"`). No `getStaticPaths()` for CMS content.
- Image fields are objects (`{ src, alt }`), not strings. Use `<Image image={...} />` from `"emdash/ui"`.
- `entry.id` is the slug (for URLs). `entry.data.id` is the database ULID (for API calls like `getEntryTerms`).
- Always call `Astro.cache.set(cacheHint)` on pages that query content.
- Taxonomy names in queries must match the seed's `"name"` field exactly (e.g., `"category"` not `"categories"`).

## This Template

A portfolio for showcasing creative work. Editorial, near-monochrome, with photography as the main visual interest. Designed for designers, photographers, illustrators, studios, and other people whose work speaks for itself when laid out with generous whitespace.

The design is intentionally restrained. Don't pile on colour, gradients, or decoration -- the work is the decoration.

## Pages

| Page           | Path           | What it shows                                                                                          |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| Home           | `/`            | Centred serif title + tagline, "Selected Work" grid                                                    |
| Work index     | `/work`        | Heading + summary, tag filter chips, full grid                                                         |
| Project detail | `/work/[slug]` | Project meta line, big serif title, summary, featured image, Portable Text body, optional gallery, URL |
| About          | `/about`       | Page content (Portable Text)                                                                           |
| Contact        | `/contact`     | Form + email / location / social column                                                                |

## Schema

- `projects` collection: `title`, `featured_image`, `client`, `year`, `summary` (text), `content` (Portable Text), `gallery` (json -- optional array of `{ url, alt? }` records, see below), `url`.
- `pages` collection: `title`, `content` (Portable Text). Used for `/about`.
- Taxonomies: `category`, `tag`. Used for filtering on the work index.
- Single `primary` menu.

Site settings have `title` and `tagline` -- both render on the home page (title as the centred serif heading, tagline as italic subtitle).

The `gallery` field on `projects` is a JSON field, not an EmDash image field. It expects a literal array of `{ url: string, alt?: string }` records (a flat external URL plus optional alt text), and is rendered as-is by `src/pages/work/[slug].astro`. Do NOT confuse it with EmDash image fields like `featured_image`, which take `{ id, provider, alt }` objects from the media library. If you need media-library images in a gallery in the future, the right fix is to change the field type and renderer together.

## Visual character

Typography is the design. The display face is **Playfair Display** (serif) on the `--font-serif` CSS variable; the body face is the system sans stack on `--font-sans`. The serif is used for the site title, hero titles, project titles, page titles, and contact column labels. Everything else is the sans.

The accent colour is barely visible by design -- the only saturated colour on the page should be inside images. The default `--color-accent` (`#7c3aed`) is used sparingly for link hover and focus states.

Whitespace is generous. Sections breathe. Don't fight that.

## Customisation

`src/styles/theme.css` is the only file to edit for visual changes. Every CSS variable from `Base.astro` is listed there as a commented default -- uncomment and change to override. The dark mode palette is defined inside `Base.astro` itself; light-mode overrides in `theme.css` won't affect dark mode. To customise dark mode, add `@media (prefers-color-scheme: dark)` and `:root.dark` rules in `theme.css`.

Fonts are configured in `astro.config.mjs` under `fonts:` (the Astro Fonts API). To change the display face, swap the `name:` for any Google Fonts serif and keep `cssVariable: "--font-serif"`. Good pairings: Cormorant Garamond, Fraunces, EB Garamond, DM Serif Display. Avoid changing the body font unless you have a reason -- system sans is deliberately quiet here.

CSS variables worth knowing:

- `--color-accent` / `--color-accent-muted` -- the single accent, used very sparingly
- `--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, `--color-border` -- neutral palette
- `--font-serif`, `--font-sans` -- bound to the Fonts API entries in `astro.config.mjs`
- `--font-size-4xl` -- the size of the homepage title and project titles
- `--max-width` (720px), `--wide-width` (1200px) -- column widths

## What not to do

- Don't introduce gradients, drop shadows on cards, or coloured section backgrounds. The template's voice is calm and editorial; those break it.
- Don't change `--font-sans` to a display font. Two display faces fight each other.
- Don't add more than one accent colour.
- Don't write generic copy like "Welcome to my portfolio" or "Crafting beautiful experiences". The work should speak; the words should be specific (a client name, a discipline, a year).
- Don't pack the home page with every project. The "Selected Work" framing is intentional -- 3-6 is plenty.
- Don't add a `gallery` of small thumbnails on the home page. Use one strong image per project; the gallery field renders on the project detail page only.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/external-apps/octogent/apps/web/AGENTS.md
# =========================================

# Web Guidelines

## Ownership
- `apps/web` owns the operator UI, client-side interaction flow, and presentation of runtime state.
- Keep backend orchestration out of the UI. The web app should consume API/runtime contracts, not recreate server logic in React components.

## Relevant Docs
- `docs/concepts/mental-model.md`
- `docs/concepts/tentacles.md`
- `docs/concepts/runtime-and-api.md`
- `docs/guides/working-with-todos.md`
- `docs/guides/orchestrating-child-agents.md`
- `docs/guides/inter-agent-messaging.md`
- Read these when changing interaction models, UI vocabulary, tentacle flows, agent orchestration surfaces, or operator-facing behavior.

## Module Shape
- Top-level containers should orchestrate. Move pure constants, parsers, normalizers, and hooks into `src/app/*`.
- Keep large JSX blocks in focused components under `src/components/*` with typed props.
- Reusable primitives belong in `src/components/ui/*`.
- Runtime transport code belongs in `src/runtime/*`.

## Styling
- Keep `src/styles.css` as the import manifest.
- Add or update focused CSS modules under `src/styles/*` instead of growing one large stylesheet.
- Preserve the existing token-driven, modular CSS structure and avoid one-off style dumping in unrelated files.

## UI Conventions
- Use the existing product vocabulary: agents, sessions, worktrees, logs, pipelines, tentacles, and terminal columns.
- Preserve the current layout model: terminal columns are the visual unit; tentacles are the contextual grouping.
- Prefer in-app confirmation and action-panel flows over browser-native dialogs for destructive actions.

## State
- Persist layout and UI preferences through the runtime-backed `.octogent` state model, not browser-only storage, unless the feature is explicitly local-only.
- Keep tentacle IDs stable for routing and runtime identity; user-facing names remain presentation data.

## Testing
- Add targeted component or runtime tests when changing view-model logic, state reconciliation, or destructive UI flows.
- When modifying shared UI behavior, verify both the component surface and the normalizer/hook logic that feeds it.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/gitrdunhq/wfc/.wfc/branches/claude/wfc-documentation-site/dev-artifacts/design-system/CLAUDE.md
# =========================================

# CLAUDE.md

## Project Overview

This is a **design language specification + token library** repository. It defines a collection of interchangeable design systems — currently two production specs, with eight more decade-themed systems planned:

- **DATUM v3.0** — "The Pedagogical Machine" — Light/warm, ink-on-paper aesthetic (1965–1975 era)
- **ATLAS v3.1** — "The Intelligence Terminal" — Dark-first, analytical operations center (2020–2026 era)

Both systems target **WCAG 2.1 AA** accessibility compliance and share identical section numbering (§00–§16), token naming conventions, and component APIs so they can be swapped by changing a single theme import.

### Planned: The Decade Collection (10 total)

| System | Decade | Archetype | Dark Mode |
|--------|--------|-----------|-----------|
| LEDGER | 1930s | The Gilded Record | No |
| DISPATCH | 1940s | The War Room Memorandum | No |
| FOLIO | 1950s | The Corporate Annual | No |
| BRIEF | 1960s | The Executive Presentation | No |
| **DATUM** | 1965–1975 | The Pedagogical Machine | No |
| TICKER | 1980s | The Power Document | Yes |
| PORTAL | 1990s | The Digital Gateway | No |
| GLOSS | 2000s | The Web 2.0 Prospectus | No |
| SCHEMA | 2010s | The Flat System | Yes |
| **ATLAS** | 2020–2026 | The Intelligence Terminal | Yes (primary) |

## Repository Structure

```
/
├── newPhase/                          # ── CANONICAL SOURCE FILES ──
│   ├── datum-system-v3.md             # DATUM v3.0 — light, ink-on-paper (CANONICAL)
│   ├── atlas-system-v3.1.md           # ATLAS v3.1 — dark, terminal (CANONICAL)
│   ├── datum-system.md                # DATUM interface-design plugin file
│   ├── atlas-system.md                # ATLAS interface-design plugin file
│   ├── agent-prompt-build-library.md  # Build spec for @datum-atlas/core + PyPI package
│   ├── agent-prompt-decade-collection.md  # Build spec for 8 decade systems
│   └── craft-audit.md                # UI craft audit findings
│
├── datum-system-v3.md                 # ⚠️ MISNAMED — actually contains ATLAS v3.1 content
├── atlas-system-v3.md                 # Older ATLAS v3.0 (superseded by newPhase/atlas-system-v3.1.md)
├── datum.md                           # DATUM v2.0 legacy (frozen, do not modify)
│
├── plans/                             # WFC planning output
│   ├── HISTORY.md
│   └── plan_datum_atlas_decade_collection_20260214_140000/
│
├── .claude/                           # Claude Code settings
│   └── settings.local.json
└── CLAUDE.md                          # This file
```

**Important:** The `newPhase/` directory contains the canonical, corrected spec files. The root-level `datum-system-v3.md` is misnamed (contains ATLAS content) and `atlas-system-v3.md` is an older version. Always reference `newPhase/` as the source of truth.

## Build Commands

The token library is being built as a monorepo:

```bash
# JS package (@datum-atlas/core)
cd js && npm install && npm run build    # tsup — ESM + CJS + DTS
cd js && npm test                        # vitest

# Python package (datum-atlas)
cd python && pip install -e ".[dev]"     # editable install
cd python && pytest                      # pytest

# Generation pipeline (JSON → TS + Python + CSS)
node scripts/generate.ts                 # generates all token files from shared/*.tokens.json
```

## Design System Architecture

All systems follow identical section numbering for interchangeability:

| Section | Topic |
|---------|-------|
| §00 | Core Philosophy |
| §01 | Palette |
| §02 | Typography |
| §03 | Spacing & Sizing |
| §04 | Layout & Grid |
| §05 | Components |
| §06 | Iconography |
| §06B | Illustration & Graphic Guidelines |
| §07 | Motion & Animation |
| §08 | Signature Patterns (era-specific) |
| §09 | Forms & Validation |
| §10 | Data Visualization |
| §11 | Responsive Strategy |
| §12 | Accessibility |
| §13 | Patterns & Recipes |
| §14 | CSS Custom Properties (complete token set) |
| §15 | Tailwind Config Extension |
| §16 | Changelog |

## DATUM vs ATLAS Quick Reference

| Aspect | DATUM v3.0 (light) | ATLAS v3.1 (dark) |
|--------|-------------------|-------------------|
| Primary mode | Light (`#F4F1EA` warm paper) | Dark (`#09090b` void) |
| Accent color | Orange `#C84315` (Intl. Orange) | Green `#4ade80` (Signal Green) |
| Secondary accent | Blue `#0045A5` (Swiss Blue) | Gold `#fbbf24` |
| Palette origin | Pigment/print-derived | Terminal-derived |
| Headline font | Playfair Display (serif) | Outfit (sans-serif) |
| Reading font | Source Serif 4 | Outfit |
| Data font | Space Mono | JetBrains Mono |
| Type scale | Perfect Fourth (1.333 ratio) | Pixel-based, compact |
| Border radius | 0px everywhere, no exceptions | Graduated (3/6/8/10/12px) |
| Elevation | Borders-only, NO shadows ever | Borders + colored luminance |
| Motion | 60ms linear mechanical snaps | 80–600ms with easing curves |
| Signature | Harak Box (12px solid square) | Atmospheric Gradient (radial bg tint) |
| Dark mode | Not supported (ink on paper) | Primary (dark-first, light fallback) |
| Use cases | Agentic UIs, chat, command panels | Analytics dashboards, data viz, ops centers |

## Key Conventions

### Token Naming

All CSS custom properties follow `--{category}-{descriptor}`:

| Prefix | Purpose | Examples |
|--------|---------|---------|
| `--bg-` | Backgrounds | `--bg-paper`, `--bg-secondary`, `--bg-hover` |
| `--ink-` | Text colors | `--ink-primary`, `--ink-secondary`, `--ink-disabled` |
| `--accent-` | Interactive / emphasis | `--accent-main`, `--accent-code` |
| `--state-` | Semantic states | `--state-error`, `--state-success`, `--state-warning` |
| `--chart-` | Data visualization | `--chart-1` through `--chart-8` |
| `--font-` | Font families | `--font-headline`, `--font-reading`, `--font-data` |
| `--space-` | Spacing (4px base) | `--space-1` (4px), `--space-4` (16px) |
| `--border-` | Border widths/colors | `--border-default`, `--border-strong` |
| `--radius-` | Border radii | `--radius-sm`, `--radius-md`, `--radius-lg` |
| `--size-` | Component sizing | `--size-input-md`, `--size-icon-sm` |
| `--z-` | Z-index scale | `--z-base`, `--z-modal`, `--z-tooltip` |
| `--duration-` | Motion timing | `--duration-fast`, `--duration-normal` |
| `--ease-` | Easing functions | `--ease-default`, `--ease-data` |

### Font Roles (4 per system)

- **Headline** — Display/header text
- **Display** — Large poster/hero text
- **Reading** — Body/prose text
- **Data** — Monospace for numeric content and code

### Spacing

4px base unit. Scale: 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80.

### Accessibility

- WCAG 2.1 AA minimum for all color pairings
- Contrast ratios documented alongside every color token
- Minimum touch target: 44px
- Focus ring on `:focus-visible` (never `:focus` alone)
- `prefers-reduced-motion` always respected

### Breakpoints (shared)

| Token | Width | Target |
|-------|-------|--------|
| `xs` | 0px | Mobile |
| `sm` | 600px | Tablet |
| `md` | 900px | Desktop |
| `lg` | 1200px | Wide |
| `xl` | 1600px | Ultra-wide |

## Editing Guidelines

1. **Maintain section parity.** All systems use identical section numbers (§00–§16). If you add a component to one, add the equivalent to all.
2. **Preserve token naming.** `--{category}-{descriptor}` convention. Name by function, not appearance.
3. **Document contrast ratios.** Every new color token needs contrast ratio + WCAG rating.
4. **Single source of truth.** `shared/*.tokens.json` files are canonical. Generated files (TS, Python, CSS) must be regenerated, never hand-edited.
5. **Era constraints are the design.** DATUM has 0px radius everywhere. DISPATCH is monospace-only. BRIEF uses max 2 accent colors. These aren't limitations — they define the system.
6. **Dark mode only where historically accurate.** Only TICKER, SCHEMA, and ATLAS support dark mode.
7. **Signature elements are non-negotiable.** Each system's signature must appear in 5+ component types.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/gitrdunhq/datum/.venv/lib/python3.12/site-packages/templates/AGENTS.md
# =========================================

# AGENTS.md

This is the single source of truth for all AI coding agents working in this repository.
All tool-specific files (CLAUDE.md, GEMINI.md, etc.) redirect here.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/gitrdunhq/b2b-site/AGENTS.md
# =========================================

# AGENTS.md

This is the single source of truth for all AI coding agents working in this repository.
All tool-specific files (CLAUDE.md, GEMINI.md, etc.) redirect here.


## Local LLM — Multi-Turn Orchestration

When a pipeline phase uses local Gemma inference, ALWAYS spawn a subagent (Agent tool
with `model: "sonnet"`) that imports and calls `datum.local_llm.run_phase()` from Python.
NEVER invoke `datum local-llm` via Bash. The CLI exists for human testing only.

### How it works

`run_phase()` auto-routes to multi-turn mode when `[multi_turn]` is enabled for a phase
in `config.toml`. The flow:

1. **Planning turn** — Gemma analyzes the problem, outputs a `StepPlan` (list of actions)
2. **Execution turns** — Gemma executes each step, outputs `StepResult` with confidence score
3. **Synthesis turn** — Gemma combines all findings into the phase's final schema

### Escalation rules

- If any turn triggers repetition, context overflow, or the model says `ESCALATE` → escalate to Claude
- If confidence stays below `confidence_threshold` after retries → escalate
- If total wall-clock exceeds `timeout_s` → escalate
- The orchestrator retries with Claude using the accumulated context as a head start

### Key parameters (all in `config.toml` under `[multi_turn]`)

| Parameter | Default | What it does |
|-----------|---------|-------------|
| `max_turns` | 5 | Max reasoning turns before forced escalation |
| `timeout_s` | 300 | Total wall-clock budget for all turns |
| `turn_timeout_s` | 90 | Max wall-clock per individual turn |
| `confidence_threshold` | 0.8 | Exit early when confidence >= this |
| `temperature_schedule` | fixed | `fixed` / `rising` / `falling` / `u_curve` |
| `context_reserve_pct` | 20 | % of context window reserved for synthesis |
| `retry_on_low_confidence` | true | Retry a turn if confidence < threshold |
| `max_retries_per_turn` | 2 | Max retries per turn before accepting best |
| `planning_turn` | true | Turn 0 produces a step plan |
| `verification_turn` | true | Final turn synthesizes into phase schema |

Per-phase overrides go in `[multi_turn.phase_overrides.<phase>]`.

### Subagent pattern

```python
from datum.local_llm import run_phase

result = run_phase(
    phase="triage",
    prompt=prompt_text,
    schema=TriageDecision,       # optional: Pydantic schema for structured output
    mt_overrides={"max_turns": 3} # optional: override any multi-turn param
)

if result["escalated"]:
    # retry with Claude, pass result["turns"] as context
    ...
else:
    answer = result["result"]
```


# =========================================
# SOURCE: /Users/samfakhreddine/repos/gitrdunhq/b2b-site/CLAUDE.md
# =========================================

# Claude Code Instructions

All agent instructions live in [AGENTS.md](AGENTS.md). Read that file.
