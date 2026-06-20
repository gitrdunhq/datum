

# =========================================
# SOURCE: /Users/samfakhreddine/repos/clients/SureGoodFoods/sgf-mockup/CLAUDE.md
# =========================================

# CLAUDE.md — SGF Mockup

Website mockup for **Sure Good Foods** (SGF), a Mississauga-based international food trading company. This is a pitch mockup, not a live site.

## Project Structure

```
index.html          — HTML shell (no inline styles or scripts)
css/                — Styles split by concern (SOLID/DRY)
  base.css          — Variables (~40 tokens in :root), reset, body, .glass utility, section-header, keyframes
  nav.css           — Nav bar, links, lang toggle, CTA button, hamburger menu
  hero.css          — Hero section, carousel bg, phrases, stats, buttons
  sections.css      — Products, certifications, value, doing-business, contact, footer, watermark
  responsive.css    — Media queries (1024px tablet, 768px mobile)
js/                 — Scripts split by concern
  main.js           — i18n, counters, carousel, hero text rotation, hamburger, lazy loading
images/             — 37 extracted product/cert images + 5 hero carousel images
  img-000.webp      — Stock photo (NOT the SGF logo — needs replacement)
  img-001..036.webp — Product photos, cert badges, icons (extracted from base64)
  hero-1.webp       — Apple processing production line (180 KB)
  hero-2.webp       — Spices & legumes grid (388 KB)
  hero-3.webp       — Spice flat-lay on dark background (217 KB)
  hero-4.webp       — Citrus on industrial trays (86 KB)
  hero-5.webp       — Field of gold grain field (211 KB)
scripts/            — Build/utility scripts (TypeScript, run with ts-node/npx tsx)
screenshots/        — Playwright captures for verification
```

## Deployment

**Live URL**: https://sgf.gitrdun.net (behind Cloudflare Access)

### Infrastructure

- **Host**: Docker on `sambou@192.168.0.210`
- **Container**: `nginx:alpine` serving static files from `/mediapool/docker/docker/sgf-mockup/html/`
- **Routing**: Traefik reverse proxy → Cloudflare tunnel (`sgf.gitrdun.net`)
- **Auth**: Cloudflare Access (no password gate needed)
- **DNS**: CNAME `sgf` → cloudflared tunnel, zone `428db12d3da0e30a587164cd3b29c2ea`

### Build & Deploy

Deploy script lives in this repo:

```bash
bash scripts/deploy.sh
```

This rsyncs `index.html`, `css/`, `js/`, and `images/` to the Docker host and restarts the container.

### Docker Compose (on host)

```yaml
services:
  sgf-mockup:
    image: nginx:alpine
    container_name: sgf-mockup
    restart: unless-stopped
    volumes:
      - ./html:/usr/share/nginx/html:ro
    networks:
      - traefik-a_traefik-public
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.sgf.rule=Host(`sgf.gitrdun.net`)"
      - "traefik.http.routers.sgf.entrypoints=websecure"
      - "traefik.http.routers.sgf.tls.certresolver=cloudflare"
      - "traefik.http.services.sgf.loadbalancer.server.port=80"
      - "traefik.docker.network=traefik-a_traefik-public"
```

### Cloudflare Tokens

Stored in `~/repos/gitrdun-blog/.env.local`:
- `CLOUDFLARE_API_TOKEN` — Pages/general API token
- `CLOUDFLARE_DNS_TOKEN` — DNS-only token (used in deploy script)
- `CLOUDFLARE_ACCOUNT_ID` — Account ID

## GitHub

**Repo**: https://github.com/sam-fakhreddine/sgf-mockup (private)

## Origin

Split from a single monolithic `mockup-v3.html` (all CSS/JS/images inline as base64) using `scripts/split-mockup.ts`. The split preserves exact rendering fidelity.

## Viewport Target

**Primary viewport: 1366 x 768** (most common laptop resolution).

All hero content must fit within this viewport without scrolling:
- Mockup banner: 32px (fixed top)
- Nav: 69px (sticky below banner)
- Available hero height: `calc(100vh - 101px)`

## Hero Section Rules

### Layout
- `.hero` has `overflow: visible` — never set to `hidden` (clips the stats bar)
- `.hero-bg-wrap` has `overflow: hidden` — contains background images within bounds
- `.hero-bg-wrap::after` adds a subtle SVG grain texture overlay at 3.5% opacity
- `.hero-bg-layer` divs are absolutely positioned inside `.hero-bg-wrap`
- `.hero-content` has `position: relative; z-index: 1` to sit above bg layers; `margin: 0` (left-aligned)
- `.hero-text` max-width: **100%** (uncapped)
- Hero eyebrow text "Global Food Trading" above the rotating h1
- SGF oval logo (`brand-assets/sgf-logo-oval-filled.png`) positioned bottom-right of hero-content via `.hero-oval-logo`
- Parallax scroll effect via `animation-timeline: scroll()` (progressive enhancement, `@supports` gated)
- `header` is `position: sticky` (not `.nav`); glass effect applied via `header:has(.nav.scrolled)`

### Carousel
- 5 images fade via `opacity` with `transition: opacity 1.5s ease-in-out`
- JS `setInterval` at 4000ms cycles through layers
- Each `.hero-bg-layer::before` has the dark gradient overlay using `var(--overlay-*)` variables
- Gradient: left-to-right from `var(--bg-dark)` solid through semi-transparent blue

### Text Rotation
- Hero h1 cycles through 5 phrases (EN/FR) every 4s with blur-dissolve transition
- Phrases: TRUSTED INGREDIENTS / STRONGEST LINK IN GLOBAL FOOD / FRESH & FROZEN SOURCED GLOBALLY / YOUR PRODUCT OUR NETWORK / QUALITY FOOD FAIR PRICE

### Stats Bar
- 5 stats: C$2.1B sales, 70+ countries, 16 offices, 150 team, 2,300+ customers
- Stat numbers rendered in gold (`--accent-warm: #D4A843`)
- Counter animation triggers on intersection (threshold 0.3) with IntersectionObserver feature check
- Stats have `opacity: 0; animation: fadeUp 0.5s ease-out 1s forwards` — 1 second delay
- When taking screenshots, wait at least 2000ms for stats to be visible

## CSS Architecture

### Variables (all in `:root` in `css/base.css`)

Every color, radius, and layout value is a CSS variable — change once, applies everywhere.

| Category | Variables |
|----------|-----------|
| Brand colors | `--bg-dark`, `--bg-dark-rgb`, `--bg-surface`, `--bg-glass`, `--bg-footer`, `--accent`, `--accent-rgb`, `--accent-dim/glow`, `--accent-warm`, `--accent-warm-rgb`, `--blue`, `--blue-rgb` |
| Accent tints | `--accent-border`, `--accent-border-hover`, `--accent-subtle` |
| Text | `--text-primary`, `--text-secondary`, `--text-tertiary` |
| Light sections | `--light-bg`, `--light-text`, `--light-muted` |
| Surfaces | `--border`, `--border-hover`, `--white-subtle/hover/faint`, `--card-bg`, `--card-border`, `--card-shadow`, `--watermark-light/dark` |
| Radii | `--radius-sm` (4px), `--radius-md` (10px), `--radius-lg` (14px), `--radius-xl` (20px), `--radius-pill` (28px) |
| Layout | `--section-pad-y`, `--section-pad-x`, `--content-max` (1200px), `--timeline-track` |
| Hero overlays | `--overlay-85/60/40/20` (derived from `--bg-dark-rgb`) |
| Typography | `--font-heading` |

### Organization
- Split into 5 files under `css/` by concern (base, nav, hero, sections, responsive)
- `.glass` utility class: `backdrop-filter: blur(20px) saturate(1.4)` — applied via HTML class
- Zero hardcoded color values outside `:root`
- No `will-change` properties (exceeded browser memory budget at this page size)

### Bento Grid
- 4-column grid, 3 rows: 2 hero cards (span 2) + 4 regular + 2 regular + 1 hero (span 2)
- No empty grid cells — last card (IQF Vegetables) spans 2 columns
- Compact sizing tuned for 1366x768: images 110/140px, body padding 12px 14px

### Breakpoints
- Tablet: `@media (max-width: 1024px)` — 2-col bento, full-width timeline
- Mobile: `@media (max-width: 768px)` — hamburger menu, single-col bento, stacked timeline

## i18n

- English/French toggle via `.lang-toggle` button
- All translatable strings use `data-i18n` attributes on HTML elements
- Translation map lives in `main.js`
- XSS-safe: uses `textContent` only, no `innerHTML`

## Lazy Loading

- Hero bg images 2-5: `data-bg` attribute, loaded on first carousel advance
- Bento slides: `data-bg` attribute, loaded via IntersectionObserver when grid scrolls into view
- Reduces initial page load by several MB

## Sections (in order)

| ID | Section | Background |
|----|---------|-----------|
| — | Hero | Dark (bg-dark) with carousel images |
| `#products` | Products (bento grid) | Light (light-bg: #fdf6ec) |
| `#certifications` | Certifications (marquee + editorial) | Dark |
| `#value` | How We Add Value (sticky card stack) | Dark |
| `#doing-business` | Doing Business (timeline) | Light |
| `#contact` | Contact (form + info) | Dark |
| — | Footer | Darker (bg-footer) |

## Screenshots

Use Playwright headless for all screenshots. The `npx playwright screenshot` CLI shortcut works for quick captures:

```bash
npx playwright screenshot --viewport-size='1366,768' --wait-for-timeout=2500 file://$PWD/index.html screenshots/output.png
```

## Client Source of Truth

Client research and verified facts: `~/repos/local-drafts/investigations/ClientResearch/SuregoodFoodsClientResearch/`

Do not invent or assume business facts. All claims (certifications, product lines, facility size, etc.) must trace back to the client research investigation or the client's own materials.

## Do Not

- Set `overflow: hidden` on `.hero` (clips stats)
- Use `sed` on these files (risk of data loss on large files — use Edit tool or node scripts)
- Commit screenshots or `test-render.png` to git (transient verification artifacts)
- Add new base64-encoded images inline — all images go in `images/`
- Add `will-change` CSS properties (page exceeds compositor memory budget)
- Use `innerHTML` for i18n — always use `textContent` + DOM manipulation


# =========================================
# SOURCE: /Users/samfakhreddine/repos/clients/SureGoodFoods/AGENTS.md
# =========================================

# Agent Persona: Critical Collaborator

## Project: Sure Good Foods (SGF) Website

Bilingual EN/FR production website for Sure Good Foods Ltd. (Mississauga, ON). Astro 6.0 + EmDash CMS + Cloudflare Pages.

**Stack:** Astro 6.4.2, EmDash 0.15.0, Zod, Cloudflare D1/R2/Turnstile
**Deploy:** Cloudflare Pages (adapter conditional on CF_PAGES env)
**Dev:** `npm run dev` (SQLite + local storage). After fresh clone: `npm install && npx emdash seed`
**Repo:** gitrdunhq/sgf-website (private)

### Shipped (Epics 1–6)
1. Scaffold + content model (10 bilingual collections, 60 entries)
2. 14 Astro components from mockup, zero hardcoded strings
3. SEO: robots.txt, sitemap.xml, llms.txt, JSON-LD, hreflang
4. CMS wiring: seed content into SQLite, fixed LiveEntryNotFoundError
5. Cloudflare deploy: adapter, wrangler.toml, contact form API (Zod), security headers
6. Verification: pixel-perfect, WCAG axe-core, Lighthouse, SSOT design tokens

### Recent Changes (Mobile & SEO Overhaul)
- **Mobile nav**: Oval logo replaces wordmark on mobile, wordmark stays on desktop
- **Mobile menu fix**: Removed `backdrop-filter` containing-block bug that trapped the fixed menu overlay
- **Footer**: Stacks vertically and centers on mobile
- **Hero background**: Opacity 0.88 with lighter gradient overlay (was 0.35 — too washed out)
- **About blurb**: Reworded from dense 200-word SEO dump to concise 2-sentence landing page intro
- **Growth timeline**: Moved up after about blurb, stacks vertically on mobile
- **Doing Business section**: Changed from light to dark background to match rest of site
- **Removed**: Carousel pause button, `prefers-reduced-motion` blocking, contact `::before` light-to-dark gradient
- **H2 headings**: Rewritten for SEO — generic keyword-rich headings instead of branded questions
- **Pulses product card**: Fixed `is_hero: true` → `false`
- **Certifications grid**: 2x2 on mobile instead of 1-column
- **Body background**: Removed radial gradients, solid `var(--bg-dark)` on body and main
- **Pre-handoff fixes**: Migrated company contact info from `site.ts` to `seed.json` (`site_config`), extracted inline noise SVGs, fixed hardcoded `rgba()` color, secured Turnstile endpoint in prod.
### Next
- Epic 7: Admin + Handoff (David's account, admin guide, DNS cutover)
- `/about` SEO honeypot page with full company text

### Key Constraints
- Visual fidelity to mockup at `../sgf-mockup/` — match pixels, not DOM
- Business facts only — every stat traces to source documents
- Zod for all boundary validation
- No hardcoded colors outside `:root` CSS variables
- No `overflow: hidden` on `.hero` (clips stats bar)
- No `will-change` CSS properties (compositor memory budget)
- No inline base64 images — all images in `public/images/`

### Content Architecture
- CMS content lives in `.emdash/seed.json` — re-seed with `npx emdash seed --on-conflict=update`
- Site constants (JSON-LD builder) in `src/lib/site.ts`. Company contact info (phone/email/address) is now in `seed.json` (`site_config` collection).
- 5 CSS files in `src/styles/` — 53 design tokens in `:root`
- Breakpoints: 1024px (tablet), 768px (mobile)

### Section Order on Landing Page
1. Hero (carousel background, animated phrases, stats)
2. About blurb (short company intro)
3. Growth timeline ("Global Food Trading Company Serving 70+ Countries")
4. Products grid ("Frozen Proteins, Produce, and Ingredients for Global Buyers")
5. Certifications ("Recognized by Leading Food Trade Organizations")
6. Value props ("Why Work With an International Food Supplier?")
7. Doing business ("How to Get Started With a Global Food Supplier")
8. Contact (form + company info)
9. Footer

---

All agents operating in this repository must adhere strictly to the following interaction constraints.

## Core Directives
1. **No Hype:** Strip all enthusiastic filler. Treat the user as a peer engineer.
2. **Push Back:** Assume proposed architectures have flaws. Highlight edge cases, coupling risks, and maintenance burdens before agreeing to build them.
3. **Neutral Tone:** Keep responses analytical, detached, and focused on technical tradeoffs.
4. **Answer Directly:** Do not pad responses with validation. State facts, present tradeoffs, ask for the decision.


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
# SOURCE: /Users/samfakhreddine/repos/clients/SureGoodFoods/CLAUDE.md
# =========================================

# Claude Code Instructions

All agent instructions live in [AGENTS.md](AGENTS.md). Read that file.

# CLAUDE.md — SGF Website (Production)

Production website for **Sure Good Foods** (SGF), built on EmDash CMS (Astro 6.0) deploying to Cloudflare Pages.

## Relationship to sgf-mockup

The approved mockup lives at `../sgf-mockup/` and is the visual reference. This repo migrates that design into a CMS-backed production site. The goal is visual fidelity to the mockup — match or exceed it, but don't be slavishly bound to its DOM structure. Enhancements that improve accessibility, performance, or component architecture are welcome as long as the visual output stays faithful. The mockup repo is read-only — never modify it from here.

## Stack

- **CMS:** EmDash (v0.15.0, Cloudflare open-source, built on Astro 6.0)
- **Framework:** Astro 6.0
- **Deploy:** Cloudflare Pages (auto-deploy on push to `main`)
- **Languages:** EN (`/en/`) + FR (`/fr/`), server-rendered
- **Auth:** EmDash passkey-first (WebAuthn) + OAuth fallback
- **Package manager:** pnpm
- **Media providers:** Local (uploads) + Pexels (stock photos, API key in `.env`)

## Branch conventions

- `main` — production, protected, merges via PR
- `staging` — auto-deploys to Cloudflare Pages preview URL
- `dev` — working branch
- `feat/<topic>` — feature branches off `dev`

## Development

```bash
pnpm install
pnpm dev             # Astro dev server on LAN at 0.0.0.0:4321
pnpm build           # Production build to ./dist
pnpm preview         # Preview production build locally
pnpm seed            # Re-seed EmDash database from .emdash/seed.json
```

## Hard constraints

Carried from the mockup CLAUDE.md — these still apply:

- **No `overflow: hidden` on `.hero`** (clips the stats bar)
- **No `will-change` CSS properties** (page exceeds compositor memory budget)
- **No inline base64 images** — all images in `public/images/`
- **No hardcoded color values outside `:root`** — every value references a CSS variable
- **Business facts only** — every stat and claim must trace to the source documents
- **Confirmed certifications only:** Canada Pork, CMC, USMEF, USAPEEC
- **Link color convention — semantic, not decorative.** All inline hyperlinks use one of two classes:
  - `class="link-accent"` → green (`--accent`, `#76BD42`) — product links only. Use when the anchor text is a product category word (pork, beef, chicken, turkey, lamb, goat, fruits/vegetables, potatoes, pulses) and the href points to `/products/*`.
  - `class="link-warm"` → gold (`--accent-warm`, `#D4A843`) — service and value links. Use when the anchor text references a capability, standard, or how SGF operates (logistics, compliance, financing, scale, market intelligence), and the href points to `/value/*` or a certification/authority page. On the about page specifically, `.abt-link-gold` is the current scoped equivalent; `.link-warm` is the pending global class.
  - **Never use bare `<a>` tags in prose copy without one of these two classes.** Never apply the wrong color to the wrong destination type — the color is the navigation signal, not decoration. Full specification: `docs/DESIGN-SYSTEM.md` → "Link Color Convention".
- **Visual fidelity to mockup, not DOM fidelity** — match the mockup's visual output as closely as possible. Component boundaries, prop structures, and DOM nesting can differ from the static HTML for better Astro architecture. Enhancements (accessibility, performance, semantic HTML) are encouraged. CSS class names should be preserved where the existing stylesheets depend on them, but adding classes or restructuring nesting is fine if the rendered result looks right.

## CSS architecture

5 files in `src/styles/`, starting from the mockup's CSS. 53 design tokens in `:root` in `base.css`. Modifications are permitted to fix bugs, improve accessibility (e.g., focus indicators, contrast), or adapt to Astro's rendering model — but the visual design language (tokens, spacing, typography, color) stays intact.

| File | Scope |
|---|---|
| `base.css` | Variables, reset, body, utilities, keyframes |
| `nav.css` | Header, nav, hamburger, lang toggle, CTA |
| `hero.css` | Hero section, carousel, phrases, stats |
| `sections.css` | Products, certs, value, doing-business, contact, footer |
| `responsive.css` | Breakpoints: 1024px (tablet), 768px (mobile) |

### CSS change rule: desktop changes must not break mobile

When adding or modifying a CSS rule in any section file (`value.css`, `sections.css`, `hero.css`, `nav.css`):

1. **Specificity check.** If the new/changed selector has higher specificity than the corresponding rule in `responsive.css`, you MUST update `responsive.css` to match or exceed that specificity. `:has()`, `:nth-child()`, and compound selectors silently override simple class selectors in media queries.
2. **Both viewports.** After any layout change (grid, flex, position, width, display), visually verify BOTH desktop (1440px) and mobile (390px) with Playwright screenshots before considering the change done.
3. **Mobile is separate.** Desktop layout changes are desktop-only unless explicitly requested for mobile too. Mobile layout in `responsive.css` is its own design — never assume a desktop grid or flex change should cascade to mobile.

## Content model

Content lives in `src/content/` as EmDash-managed collections. See `.development/EMDASH-PLAN.md` for the full schema. Key collections: `products` (8), `certifications` (4), `valueProps` (5), `growthMilestones` (4), `businessSteps` (4), plus singletons for hero, about, contact, footer.

## i18n

Server-rendered `/en/` and `/fr/` routes. No client-side language toggle — the lang button is an `<a>` link to the alternate locale. Each page reads locale-specific content from EmDash collections. hreflang tags in `<head>`.

## Images

All images in `public/images/`. 5 hero carousel (webp), 32 product photos (webp), 4 cert logos (svg/webp), SVG wordmark. Managed via EmDash media library. Pexels provider available in admin for stock photos.

## Build pipeline

`pnpm build` runs three steps in sequence:

1. **`astro build`** — Astro SSR build. Cloudflare adapter only activates when `CF_PAGES=1` (set automatically on CF Pages).
2. **`scripts/fix-wrangler-json.mjs`** — Strips Workers-only fields from generated wrangler.json, injects `HTML_CACHE` KV binding, creates `_routes.json` static exclusions, copies `dist/client/` to `dist/`, creates `_worker.js` entrypoint.
3. **`scripts/wrap-worker.mjs`** — Rewrites `dist/_worker.js` with KV HTML cache layer that intercepts GET requests above EmDash middleware. Cache HITs skip all D1/rendering. Stats tracked in `_stats` key.

## KV HTML cache

A Worker-level cache sits in front of EmDash. All GET requests (except `/_emdash/*`) check `HTML_CACHE` KV first. HITs return instantly (~150ms vs ~1.25s). Misses render normally and store the response with 1h TTL.

- **Admin dashboard:** `/admin/purge-cache` — hit rate, compute savings, per-page TTL, purge controls
- **Purge API:** `POST /api/purge-cache` — body `{}` purges all, body `{"key":"/en/"}` purges one
- **KV binding:** `HTML_CACHE` (id in `wrangler.jsonc`)

## Scripts

| Script | Usage |
|---|---|
| `scripts/dev-lan.sh` | Dev server on all interfaces (called by `pnpm dev`) |
| `scripts/apply-patches.mjs` | Postinstall: applies emdash middleware patch (KV cache short-circuit) |
| `scripts/fix-wrangler-json.mjs` | Post-build: strips Workers fields, injects KV bindings, creates `_worker.js` entrypoint |
| `scripts/wrap-worker.mjs` | Post-build: wraps `_worker.js` with KV HTML cache layer |
| `scripts/fetch-pexels.sh` | Fetch images from Pexels API: `bash scripts/fetch-pexels.sh "query" prefix count` |
| `scripts/smart-crop.py` | Smart-crop product images to 16:9: `uv run scripts/smart-crop.py [files...]` |

## Client

- **Client contact:** David Typer, COO — `dtyper@suregoodfoods.com`
- **Live mockup:** https://sgf.gitrdun.net (behind Cloudflare Access)
- **Production URL:** https://suregoodfoods.com (after DNS cutover)

## D1 / SQLite pitfalls

- No `BEGIN TRANSACTION` — use D1 batch API instead
- No `UNISTR()` — not supported in D1's SQLite build
- Respect FK constraint ordering in seeds (parents before children)
- Watch for expression tree depth limits on large HTML blobs (6-10KB)
- `PRAGMA foreign_keys = OFF` at the top of every seed file
- Test migrations locally (`pnpm seed`) before pushing to remote D1

## Post-change verification

After any content, data, or config change that affects the live site:

1. Check if KV HTML_CACHE might be serving stale content — purge via `/admin/purge-cache` or `POST /api/purge-cache`
2. Verify the change is visible on the actual rendered page, not just in the database
3. For D1 seed changes, confirm the seed ran successfully (`wrangler d1 execute` output)
4. For CSS changes, screenshot both desktop (1440px) and mobile (390px) viewports

## Do not

- Modify CSS files without a mockup design change approval from David
- Invent business facts not in the source documents
- Use `innerHTML` for user-facing content (render HTML via Astro components or rich-text fields)
- Commit screenshots or temp files
- Push to `main` without PR


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
# SOURCE: /Users/samfakhreddine/repos/gitrdunhq/wfc/.claude/worktrees/hosts-cli-reference-sync/AGENTS.md
# =========================================

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **hosts-cli-reference-sync** (21226 symbols, 49696 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/hosts-cli-reference-sync/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/hosts-cli-reference-sync/context` | Codebase overview, check index freshness |
| `gitnexus://repo/hosts-cli-reference-sync/clusters` | All functional areas |
| `gitnexus://repo/hosts-cli-reference-sync/processes` | All execution flows |
| `gitnexus://repo/hosts-cli-reference-sync/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:

1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

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

## Execution Flow

- WFC has five first-class CLI hosts and parity work must treat them as the
  supported set:
  - `claude`
  - `codex`
  - `kiro`
  - `opencode`
  - `gemini-cli`
- Do not forget any of the five when discussing installer parity, hook
  behavior, command export, prompt wrappers, or platform support. Cursor and VS
  Code may exist as secondary/export targets, but they are not the primary
  parity set unless the user explicitly expands scope.
- For review-driven remediation, the required loop is:
  - `review`
  - `compound`
  - `rework`
  - `delta review`
- When you need to reference an external host's CLI surface area (commands,
  flags, auth flows), prefer the repo-local reference docs under
  `docs/reference/hosts/` instead of pasting snippets into the chat.
- If a host CLI reference doc is missing or outdated, regenerate it via:
  - `wfc hosts sync-cli-reference --host <host>`
  - Example: `wfc hosts sync-cli-reference --host claude-code`
- Rework reviews must be logged as rework/diff reviews against the remediation
  slice, not re-run as a fresh full-branch review unless the user explicitly
  asks for a full review reset.
- Keep the main lane moving even when side questions arrive. Answer briefly, but
  do not pause implementation unless a decision is truly blocking.
- When external fanout is useful, default to a six-lane split:
  - 3 Claude lanes
  - 3 Kiro lanes
- Do not default to Gemini unless explicitly requested or Claude/Kiro capacity
  is unavailable.
- `1 agent = 1 task`
- `1 orchestrator = many agents`
- `wfc-superimplement` is the top-level orchestrator. Dispatched external lanes
  are leaf workers and must not spawn additional orchestration.
- For reviews of code changes, default to the `wfc-review` operating model:
  parallel reviewers across Security, Correctness, Performance,
  Maintainability, and Reliability. Prefer a mix of local and external review
  lanes when available. Do not treat single-threaded spot-checking as
  sufficient for non-trivial code slices.
- If a blocker or high-risk item appears and it is not required for the next
  safe increment:
  - park it
  - write it down clearly
  - create or link a GitHub issue
  - move immediately to the next ready low-risk task
- Do not let one bad edge stall the entire run unless it genuinely blocks the
  next safe step.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/gitrdunhq/wfc/.claude/worktrees/hosts-cli-reference-sync/CLAUDE.md
# =========================================

# WFC — World Fucking Class

Multi-agent code review, planning, and implementation framework for Claude Code.

**YOU ARE WORKING ON THE WFC CODEBASE ITSELF.**
This is the repository that BUILDS WFC skills and orchestrators.
Do not confuse working ON WFC with working WITH WFC.

**Never implement features manually — always use WFC skills.**

## Python Environment

```bash
uv run pytest              # tests
uv pip install -e ".[all]" # install
uv run python script.py    # scripts
```

Never: `python -m pytest` · `pip install` · `python script.py`

## `wfc` CLI — Invocation in Bash Tool Calls

`wfc` lives in the project venv, **not** on system PATH. Bash tool subshells don't inherit
zshrc aliases. Always use the explicit form:

```bash
uv run --project /Users/samfakhreddine/repos/wfc wfc helpers work-dir
uv run --project /Users/samfakhreddine/repos/wfc wfc helpers <cmd>
```

Interactive shells work with bare `wfc` if the zshrc alias is set (see below).
**Never** use `export PATH="$HOME/.local/bin:..."` as a workaround — the binary isn't there.

## Workflow

```
/wfc-lfg "feature"    # Full auto: plan → implement → review → PR
/wfc-build "feature"  # Quick single feature (adaptive interview)
/wfc-plan             # Structured planning for large features
/wfc-implement        # Execute TASKS.md with parallel TDD agents
/wfc-review           # 5-agent consensus review
/wfc-ba               # Business analysis / requirements
/wfc-compound         # Codify a solved problem into docs/solutions/
/wfc-pr-comments      # Triage and fix PR review comments
```

**Branch policy:** Use conventional prefixes (`feat/`, `fix/`, `chore/`) → PR to `main`. Never push directly to `main`. Never use AI-revealing branch prefixes (`claude/`, `copilot/`, etc.).
If an RC branch is active, base new development work off that RC branch rather than `main`. When the work is intended to ship in the current release train, target the RC branch in the PR instead of `main`.
**Commit policy:** One commit per PR. Always run `bash scripts/squash-pr.sh` before pushing. `wfc pr` does this automatically.
**PR gate policy:** A PR is not ready unless it has local act proof. Default path is `wfc pr`, which squashes first, runs the act preflight, writes `.act-artifacts/latest.json`, and only then opens the PR. If you skip that path, GitHub CI will fail `Verify Act Proof`.

## Commands

```bash
wfc install           # install WFC
wfc test              # run all tests
wfc format            # black + ruff (wfc/, tests/, scripts/)
wfc check-all         # tests + validate + lint
wfc validate          # Agent Skills compliance check
wfc validate-contract # Prompt contract completeness (--skill NAME for single)
wfc act fast          # local CI gate (~2 min)
wfc pr                # create PR (squash → act preflight → gh pr create)
wfc pr --skip-act     # emergency PR (skip act preflight)
make cut-rc           # local/manual RC cut fallback (branch + PR to main)
wfc clean             # remove build artifacts
wfc dev               # install-dev + pre-commit hook install
uv run pytest tests/test_file.py -v  # single test file
wfc memory backfill [--dry-run] [--project NAME]  # ingest dev artifacts into ChromaDB
wfc memory sync [--install] [--uninstall]          # incremental sync (daily cron via launchd)
wfc stats-query [metric] [--days N]               # query analytics engine (Claude-feedable JSON)
bash scripts/install_test.sh         # run installer tests (20 tests)
./install.sh --agent claude          # targeted install (skip menu)
./install.sh --agent all --nsfw      # install all platforms non-interactively
```

## PR Requirements

Before opening or updating a PR, ensure all of these are true:

1. The branch is squashed to one commit.
2. Local act preflight has been run, normally via `wfc pr`.
3. `.act-artifacts/latest.json` exists and reports a passing run for the current HEAD.
4. The PR is expected to pass these GitHub checks:
   - `Verify Act Proof`
   - `Fast Validation`
   - `Lint & Format Check`
   - `Validate Agent Skills`

If you forget the act step, the PR will fail immediately on `Verify Act Proof`.

## wfc git worktree helpers

```bash
wfc git worktree-add <task-id> [base]        # Create .worktrees/<id> with task/<id> branch
wfc git worktree-commit <task-id> <msg>      # Stage all + commit in worktree
wfc git worktree-merge <task-id>             # Merge task/<id> into current branch
wfc git worktree-cleanup <id> [id...]        # Remove worktrees + delete branches (handles .worktrees/<id>+task/<id> AND .claude/worktrees/agent-<id>+worktree-agent-<id>; accepts <id> or agent-<id>)
wfc git worktree-add-batch <id> [id...]      # Create multiple worktrees in one call
```

## wfc git sync & inspection helpers

```bash
wfc git fetch [args]                         # git fetch (default: --all --prune)
wfc git reset-hard <ref>                     # Reset current branch hard to <ref>
wfc git set-upstream <upstream> [local]      # Set tracking branch
wfc git blob <ref> <path>                    # Print blob SHA at <ref>:<path> (compare file content across branches)
wfc git is-ancestor <a> <b>                  # Exit 0 if <a> is reachable from <b>
```

## wfc helpers (Observability & State)

```bash
wfc helpers status         # active pipelines and progress checkpoints
wfc helpers doctor         # 7-point environment health check
wfc helpers resume         # find resumable interrupted pipelines
wfc helpers clean          # dry-run GC for stale state files
wfc helpers clean --force  # actually delete stale state
wfc helpers timeline       # telemetry event trail (last 7 days)
wfc helpers deps           # skill dependency graph
wfc helpers work-dir       # print WFC_WORK_DIR path
wfc helpers task-create-batch --tasks-md <path>  # Create kanban tasks from TASKS.md
wfc helpers task-update-batch --ids <csv> --status <S>  # Batch update task statuses
```

## Architecture

```
wfc/                         # Repo — source code only
├── scripts/orchestrators/   # Python orchestration (review, build, vibe)
├── scripts/skill_helpers.py # Centralized skill CLI (wfc helpers <cmd>)
├── scripts/hooks/           # PreToolUse/PostToolUse infrastructure
├── scripts/knowledge/       # RAG knowledge system
├── scripts/memory/          # Memory backfill engine (ingest, ledger, parsers, sync)
├── scripts/stats_schema.py  # Analytics DDL — single source of truth (DuckDB + SQLite)
├── references/reviewers/    # 5 reviewer PROMPT.md + KNOWLEDGE.md (file I/O, NOT Python imports)
├── gitwork/                 # git operations via worktree-manager.sh
├── skills/                  # Agent Skills packages (on-demand, invoked via slash commands)
└── rules/                   # Universal rules (always-active, installed globally)

examples/                    # Per-platform config templates
├── claude-code/CLAUDE.md    # Claude Code orchestrator instructions
├── kiro/KIRO.md             # Kiro orchestrator instructions
├── cursor/.cursorrules      # Cursor rules
├── vscode/                  # VS Code Copilot instructions
├── opencode/                # OpenCode agent config
├── codex/                   # Codex instructions
├── antigravity/             # Antigravity rules
└── goose/                   # Goose config

scripts/install_test.sh      # Installer test suite (20 tests)

~/.claude/skills/wfc-*/      # Installed skills (symlinks → ~/.wfc/skills/)
~/.claude/rules/*.md         # Universal rules (symlinks → ~/.wfc/rules/)

~/.wfc/projects/{repo}/branches/{branch}/   # Dev artifacts (Documentation is Infrastructure)
├── plans/                   # Timestamped plan directories
├── reviews/                 # wfc-review artifacts
├── ba/                      # Business analysis documents
├── experiments/             # Spikes, proofs-of-concept, explorations
└── docs/                    # All generated documentation

<repo>/.wfc → ~/.wfc/projects/{repo}/       # Symlink created by wfc install (shortcut)
.act-artifacts/latest.json                   # Act-preflight proof (tracked in git)
```

**Review:** 5 fixed reviewers (Security, Correctness, Performance, Maintainability, Reliability). NOT dynamically selected, NOT 56 personas.
CS formula: `(0.5 × R̄) + (0.3 × R̄ × k/n) + (0.2 × R_max)`. MPR: if R_max ≥ 8.5 from Security/Reliability → CS elevated.

## TDD: Red → Green — MANDATORY

**Never write source code before writing a failing test. No exceptions.**

```
1. Write the test
2. Run it — confirm it FAILS (red)       ← you must see this failure
3. Write the minimum source to make it pass
4. Run it — confirm it PASSES (green)
5. Commit
```

**The red step is not optional.** If you skip it, you cannot know the test would have caught the bug or enforced the contract. A test that was never red is unverified.

**Common failure modes to avoid:**

- Writing all source changes first, then writing tests afterward — FORBIDDEN
- Writing a test, seeing it pass immediately without any source change — the test is wrong, stop and fix it
- Writing tests that import from modules that don't exist yet — fine, that IS the red step
- Patching the wrong target in a mock so the test passes trivially — run without the patch first to confirm it fails

**Enforcement:** When the TDD hook fires a `WARN [tdd-enforcement]`, treat it as a STOP signal. Do not continue writing source. Write the test first, confirm red, then proceed.

## Absolute Rules

- **MULTI-AGENT ANALYSIS:** For complex analysis tasks (validation, review, planning), ALWAYS use Task tool to spawn parallel subagents. Never analyze sequentially in main context. Each dimension/concern gets its own agent.
- **Branching:** ALWAYS branch from `main`. Never branch from feature branches.
- **Skills:** Hyphenated names only (`wfc-review` not `wfc:review`). No invalid frontmatter. `wfc validate` before commit.
- **Code:** `wfc format` before commit. `wfc check-all` before PR. Never commit failing tests. Never skip pre-commit hooks.
- **Worktrees:** `bash wfc/gitwork/scripts/worktree-manager.sh create <name>`. Never bare `git worktree add`.
- **Knowledge:** `/wfc-compound` after solving non-trivial problems (>15 min).
- **Workspace:** All dev artifacts in `~/.wfc/projects/{repo}/branches/{branch}/` — plans, reviews, ba, experiments, docs. Never commit dev artifacts to the repo. **Documentation is Infrastructure** — never discard generated docs; store them in `~/.wfc`.
- **Experiments:** Spikes and proofs-of-concept go to `~/.wfc/projects/{repo}/branches/{branch}/experiments/`. Never in the repo root or `.development/`.
- **Tokens:** Never send full file content to reviewers. Always use file reference architecture.
- **Parallel Execution:** Use parallel Task calls in single message when agents are independent. Follow PARALLEL principle from WFC philosophy.
- **Docs Staleness:** When a skill's `SKILL.md` is modified, its `docs/site/skills/<skill-name>.md` must also be updated in the same PR. (Enforced once `docs/site/skills/` is fully bootstrapped — skill docs may be stubs during initial site population.)

## Context Files

- `wfc/references/SKILLS.md` — full skill reference (34 skills, decision guide, typical flows)
- `docs/workflow/WFC_IMPLEMENTATION.md` — wfc-implement TDD architecture, agent workflow, key files
- `wfc/references/TEAMCHARTER.md` — values governance, plan validation
- `wfc/references/TOKEN_MANAGEMENT.md` — token optimization strategy
- `PLANNING.md` — architectural decisions and absolute rules
- `docs/README.md` — full documentation index
- `examples/` — per-platform config templates (Claude Code, Kiro, Cursor, VS Code, OpenCode, Codex, Antigravity, Goose)
- `scripts/install_test.sh` — installer test suite (20 tests, run with `bash scripts/install_test.sh`)
- `docs/issues/skill-architecture-epic.md` — planned epic for `_shared/` convention system (Priority 2)
- `.devcontainer/` — devcontainer setup (firewall, tools, workspace layout)
- `.claude/rules/ai-coding-discipline.md` — 8 mandatory rules preventing AI coding anti-patterns (always active)
- `.claude/rules/code-standards.md` — Defensive Programming Standard (DPS), 13 dimensions (always active)
- `.claude/rules/safeguard.md` — PreToolUse hook blocking dangerous code patterns (always active)
- `.claude/rules/memory-recall.md` — Agent recall rule: query knowledge store before starting work (always active)

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **wfc** (21198 symbols, 49646 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/wfc/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/wfc/context` | Codebase overview, check index freshness |
| `gitnexus://repo/wfc/clusters` | All functional areas |
| `gitnexus://repo/wfc/processes` | All execution flows |
| `gitnexus://repo/wfc/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:

1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

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

## Execution Flow

- Keep the main lane moving even when side questions arrive. Answer briefly, but
  do not pause implementation unless a decision is truly blocking.
- When external fanout is useful, default to a six-lane split:
  - 3 Claude lanes
  - 3 Kiro lanes
- Do not default to Gemini unless explicitly requested or Claude/Kiro capacity
  is unavailable.
- `wfc-superimplement` is the top-level orchestrator. Dispatched external lanes
  are leaf workers and must not spawn additional orchestration.
- For reviews of code changes, default to the `wfc-review` operating model:
  parallel reviewers across Security, Correctness, Performance,
  Maintainability, and Reliability. Prefer a mix of local and external review
  lanes when available. Do not treat single-threaded spot-checking as
  sufficient for non-trivial code slices.
- If a blocker or high-risk item appears and it is not required for the next
  safe increment:
  - park it
  - write it down clearly
  - create or link a GitHub issue
  - move immediately to the next ready low-risk task
- Do not let one bad edge stall the entire run unless it genuinely blocks the
  next safe step.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/local-drafts/ecTUI/AGENTS.md
# =========================================

# ecTUI — AWS EC2 Terminal UI

Fast, keyboard-driven TUI for AWS EC2 instance management across multiple accounts.

## Tech Stack

- **Language:** Go 1.22+
- **TUI:** Bubbletea + Lipgloss + Bubbles
- **AWS:** aws-sdk-go-v2
- **Config:** TOML (pelletier/go-toml or BurntSushi/toml)
- **Cache:** SQLite (modernc.org/sqlite — pure Go, no CGO)
- **Testing:** Go standard testing + testify + pgregory.net/rapid (property-based)
- **Release:** goreleaser → GitHub Releases + Homebrew tap

## Commands

```bash
go build ./cmd/ectui          # build
go test ./...                 # run all tests
go test ./internal/...  -v    # verbose tests
go vet ./...                  # static analysis
goreleaser --snapshot --clean # test release build
```

## Architecture

Three-tier, interface-driven. See `.masterplan/PLAN.md` for full details.

```
Tier 0: domain/       — Pure types, zero dependencies
Tier 1: ui/           — Bubbletea presentation (consumes service interfaces only)
Tier 2: service/      — Business logic, search, orchestration
Tier 3: data/         — AWS API clients + cache (repository pattern)
```

### Rules

- **Tier boundaries are sacred.** UI never imports `data/`. Services never import `ui/`. Domain imports nothing.
- **All cross-tier communication goes through interfaces** defined in each tier's contracts file.
- **Repository pattern** for all data access. Never call AWS SDK directly from service or UI code.
- **Cache decorator** wraps repositories transparently. Business logic doesn't know about caching.
- **Context everywhere.** All service/repo methods accept `context.Context` as first parameter.

## Config

User config lives at `~/.config/ectui/config.toml`. The app works with zero config (discovers all AWS profiles automatically). Config only needed to filter/customize.

## Key Files

```
cmd/ectui/main.go                    # Entry point, DI wiring
internal/domain/                     # Domain types (Instance, Profile, etc.)
internal/data/repository.go          # Repository interface contracts
internal/data/aws/                   # AWS API implementations
internal/data/cache/                 # Cache store implementations
internal/data/cached/                # Caching decorators
internal/service/interfaces.go       # Service interface contracts
internal/service/                    # Service implementations
internal/ui/                         # Bubbletea TUI components
internal/config/                     # TOML config parsing
.masterplan/PLAN.md                  # Full architectural plan
```

## Branch Policy

- Develop on feature branches (`feat/*`, `fix/*`) — never AI-revealing names like `claude/*`
- Never push directly to `main`

## Testing

- Unit tests alongside source files (`foo_test.go`)
- Property tests in separate files (`foo_property_test.go`) using `pgregory.net/rapid`
- Mock AWS clients using interfaces for testing
- Use `testify/assert` and `testify/require`
- Table-driven tests for known cases, property tests for invariants
- All new features need both unit tests and property tests for pure functions
- Run property tests with high iteration count: `go test -rapid.checks=100000 -run Property ./internal/...`

## Build & Versioning

Version is managed by **`svu`** (Semantic Version Utility) reading git tags + conventional commits. **Always use the build script:**

```bash
bash scripts/build.sh    # auto-detects next version, builds, tags
```

The script:
1. Runs `svu next` to determine the version from commit prefixes since last tag
2. Builds with ldflags injection
3. Tags the commit if the version is new

Commit prefix → bump level (handled automatically by `svu`):
- `feat:` → **minor** (0.x.0)
- `fix:`/`refactor:`/`test:`/`deps:`/`chore:` → **patch** (0.x.y)
- `BREAKING CHANGE:` or `!:` → **major**

**Never set version manually.** If `svu` is not installed: `brew install caarlos0/tap/svu`

## Absolute Rules

- Never call AWS SDK directly from UI or service code — always go through repository interfaces
- Never import a higher tier from a lower tier (data must not import service or ui)
- All new features need tests
- `go vet ./...` must pass before commit
- Keep the `.masterplan/PLAN.md` updated when architecture decisions change

<!-- wfc:start -->
## WFC Integration

### Quality Commands

```bash
wfc test              # Run go test ./...
wfc lint --fix        # golangci-lint + go vet
wfc format            # gofmt
wfc check-all         # All quality gates
wfc ci                # Full CI pipeline locally
make quality-check    # Format + lint via Makefile
```

### Always Do

- Use `wfc` CLI for all dev operations (test, lint, format, git, pr)
- Run `wfc check-all` before committing
- Use `wfc git` subcommands instead of raw git

### When Needed

- `/wfc-plan` for multi-file feature planning
- `/wfc-build` for autonomous feature implementation
- `/wfc-review` for 5-agent parallel code review
- `/wfc-implement` for executing TASKS.md plans

### Never Do

- Run raw `git`, `grep`, `find` when `wfc` has the command
- Skip quality gates before commit
- Commit WFC artifacts (plans, reviews) to the repo
<!-- wfc:end -->
