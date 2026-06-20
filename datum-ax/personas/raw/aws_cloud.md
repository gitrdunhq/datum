

# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/cloudmask-gui/.amazonq/rules/AGENTS.md
# =========================================

# Agent Instructions for CloudMask GUI

## Project Overview

CloudMask GUI is a web-based frontend for the CloudMask-AWS anonymization tool. It provides a user-friendly interface for anonymizing AWS infrastructure identifiers before sharing with LLMs.

## Architecture

- **Frontend**: React + TypeScript + Vite + AWS Cloudscape Design System (Node 22+)
- **Backend**: Python 3.13+ (FastAPI/Flask) wrapping CloudMask library
- **Deployment**: Multi-container (Docker/Podman) for standalone single-user use
- **Networking**: Browser → localhost:7337 → Nginx → api:5000 → Backend

## Requirements

- **Node.js**: 22+ (see `.amazonq/rules/node-requirements.md` for features)
- **Python**: 3.13+
- **Container Runtime**: Docker OR Podman

## Key Constraints

### Container Runtime Support

- MUST support both Docker and Podman
- Test all changes with both runtimes
- Use only OCI-standard features
- Avoid runtime-specific extensions

### Code Style

- Follow pinned API design rules (class-based namespacing)
- Follow Python import rules (all imports at top)
- Use `uv` for Python package management, never `pip`
- Minimize code - write only what's needed

### Security

- Backend validates all inputs with Pydantic
- Sandbox regex testing with timeout protection
- Secure file permissions (600 for mappings, 700 for directories)
- HTTPS required for production (Clipboard/File APIs)

## Development Workflow

### Git Branch Management

```bash
# ALWAYS check branch before committing
git branch --show-current

# Create feature branch if on main/master
git checkout -b feature/description
```

### Python Commands

```bash
# Always use uv, never pip
uv pip install <package>
uv run pytest
uv run python script.py
```

### Container Testing

```bash
# Test with Docker
docker build -t cloudmask-backend backend/
docker-compose up -d
# Verify functionality
docker-compose down

# Test with Podman
podman build -t cloudmask-backend backend/
podman-compose up -d
# Verify functionality
podman-compose down
```

## Implementation Phases

1. **Phase 1**: Project setup and basic UI skeleton
2. **Phase 2**: Core anonymization workflow
3. **Phase 3**: Configuration management
4. **Phase 4**: Advanced features (batch, clipboard)
5. **Phase 5**: Polish and production readiness

## Critical Dependencies

- CloudMask Python library (core functionality)
- AWS Cloudscape Design System (UI components)
- FastAPI/Flask (backend API)
- Nginx (reverse proxy in container)

## Common Pitfalls

### Imports

❌ **Wrong**: Inline imports inside functions

```python
def process():
    import yaml  # NEVER do this
```

✅ **Correct**: All imports at top

```python
import yaml

def process():
    pass
```

### API Design

❌ **Wrong**: get_* function pattern

```python
from mylib import get_default_path
path = get_default_path()
```

✅ **Correct**: Class-based namespacing

```python
from mylib import Storage
path = Storage.DefaultPath
```

### Package Management

❌ **Wrong**: Using pip directly

```bash
pip install pyyaml
```

✅ **Correct**: Using uv

```bash
uv pip install pyyaml
```

## Testing Requirements

- Test both Docker and Podman before marking complete
- Validate API contracts between frontend/backend
- Test with representative data volumes
- Verify HTTPS requirements for production

## Documentation Standards

- Include networking diagrams for multi-container setup
- Provide troubleshooting sections
- Document both Docker and Podman commands
- Create helper scripts for common operations

## Agent Collaboration

- Agents can parallelize Docker vs Podman testing
- Self-healing: retry with alternative approach if one runtime fails
- Share findings about CloudMask API surface area
- Coordinate on API contract definitions

## Success Criteria

- Works identically on Docker and Podman
- Follows all pinned coding rules
- Minimal, focused code (no over-engineering)
- Comprehensive documentation
- Secure by default


# =========================================
# SOURCE: /Users/samfakhreddine/repos/personal/cloudmask-aws/CLAUDE.md
# =========================================

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CloudMask is a Python library and CLI tool that anonymizes AWS infrastructure identifiers (resource IDs, account IDs, ARNs, IPs, domains, company names) for secure LLM processing. Anonymization is deterministic (HMAC-SHA256 + seed), reversible via encrypted mapping files, and structure-preserving (AWS prefixes like `vpc-`, `i-`, `sg-` are retained).

## Development Commands

```bash
# Setup
uv venv && uv pip install -e ".[dev]"

# Quality checks
make format          # black (line-length 100)
make lint            # ruff check
make lint-fix        # ruff check --fix
make type-check      # mypy (strict mode)
make quality-check   # all of the above + pydocstyle

# Tests
make test            # pytest (includes coverage)
make test-cov        # pytest with HTML coverage report
pytest tests/test_cloudmask.py              # single file
pytest tests/test_cloudmask.py::test_name   # single test

# Docs
make docs            # Sphinx HTML docs → docs/_build/html/
```

## Architecture

Source lives in `src/cloudmask/` using a src-layout. The package is organized into four subpackages:

**Core layer** (`core.py`, `anonymizer.py`, `mapper.py`):
- `CloudMask` — main entry point; composes `Anonymizer` + `MappingManager`
- `CloudUnmask` — reverses anonymization using a mapping dict or file
- `TemporaryMask` — context manager for scoped anonymization
- `Anonymizer` — HMAC-SHA256 hashing engine with 16-hex-char truncation; maintains an in-memory mapping dict
- `MappingManager` — JSON mapping file I/O with atomic writes, seed verification, and merge support

**config/** — `Config` and `CustomPattern` dataclasses, multi-format loader (YAML/JSON/TOML + env vars), predefined templates via `ConfigTemplates`. `DEFAULT_SEED = "default-seed"` defined here.

**io/** — `Storage` singleton for `~/.cloudmask/` central storage (secure permissions 700/600), `FileProcessor` for bounded file I/O (100MB limit), `streaming.py` for chunked large-file processing with optional tqdm progress

**utils/** — `patterns.py` has pre-compiled regex for all AWS resource types + `AWS_RESOURCE_PREFIXES` frozenset; `security.py` provides Fernet/AES-256 encryption with PBKDF2 key derivation; `cache.py` has LRU cache (1000 entries); `ratelimit.py` has token-bucket rate limiters

**cli/** — argparse-based CLI dispatching to handler functions in `cli_handlers.py`. Entry point: `cloudmask.cli.cli:main`

## Claude Code Hooks

CloudMask integrates with Claude Code via hooks that intercept file and prompt operations. The hook system lives in `scripts/hooks/` and is installed globally to `~/.claude/hooks/`.

### Hook Files

| File | Event | Purpose |
|------|-------|---------|
| `_hook_common.py` | (shared module) | Seed resolution, cached PBKDF2 Fernet crypto, mapping I/O, constants |
| `mask-hook.py` | PreToolUse (Read/Write/Edit) | Anonymizes file content via shadow copies at `~/.cloudmask/hooks/shadow/` |
| `demask-hook.py` | PostToolUse (Write/Edit) | Restores real values when Claude writes back to shadow files |
| `prompt-mask-hook.py` | UserPromptSubmit | Blocks prompts containing sensitive IDs, saves masked version to `~/.cloudmask/.blockedprompts/` |

### Seed Resolution (3-tier)

Hooks read the seed in order: OS keychain (`keyring.get_password("cloudmask", "seed")`) → file (`~/.cloudmask/seed`, 0o400) → env var (`$CLOUDMASK_SEED`).

### Key Design Decisions

- **Fail-closed**: mask-hook emits a `block` decision (not silent exit) when seed is missing
- **Encrypted mapping**: `mapping.json` is Fernet-encrypted with PBKDF2-derived key; deterministic salt from seed hash enables `@lru_cache` (one PBKDF2 derivation per process, not per operation)
- **No double anonymization**: Files and prompts containing `<!-- CLOUDMASK:SANITIZED -->` marker are passed through without re-anonymization
- **Empty mapping safety**: demask-hook refuses to write anonymized content to real files when reverse mapping is empty
- **Prompt blocking UX**: Blocked prompts are saved to `~/.cloudmask/.blockedprompts/YYYYMMDD-HHMMSS-<hash>.txt` with instructions header; user resubmits via `@path`. Files auto-cleaned after 15 days.
- **demask-hook avoids cloudmask imports**: For fast startup, it uses `_hook_common.py` crypto directly instead of importing the full cloudmask package

### Installing / Uninstalling Hooks

```bash
python3 scripts/install-hooks.py                        # interactive install
python3 scripts/install-hooks.py --seed <seed>           # install with specific seed
python3 scripts/install-hooks.py --status                # check installation
python3 scripts/install-hooks.py --uninstall             # remove hooks
```

The installer copies hook files to `~/.claude/hooks/`, stores the seed in the OS keychain + file fallback, and merges hook config into `~/.claude/settings.json` (tagged `cloudmask-hooks` for clean uninstall).

## Key Conventions

- **Python 3.10+** required. Uses `match/case`, `X | Y` union types, `list[T]`/`dict[K,V]` generics.
- **Type annotations** on all public functions (mypy strict mode).
- **Google-style docstrings** enforced by pydocstyle.
- **Line length**: 100 characters (black + ruff).
- **Import order**: ruff isort with `cloudmask` as known first-party.
- **Exceptions**: custom hierarchy rooted at `CloudMaskError` in `exceptions.py`. Six subclasses: `ConfigurationError`, `ValidationError`, `FileOperationError`, `MappingError`, `EncryptionError`, `ClipboardError`.
- **`__init__.py`** re-exports the full public API (~91 names) via lazy `__getattr__`. New public symbols must be added there.
- **Ruff ignores**: `F401` in `__init__.py`, `ARG`/`S101` in tests.
- **Atomic file writes**: All hook file I/O uses `tempfile.mkstemp` + `os.fdopen` + `Path.replace` pattern.
- **File locking**: `fcntl.flock` (LOCK_EX for writes, LOCK_SH for reads) on `mapping.json.lock`.

## Known Development Gotchas

### zsh `\!` escaping in hook-wrapped output

When developing with hooks active, zsh's history expansion can escape `!` to `\!` in content that passes through the Bash hook wrapper. This corrupts Python operators like `!=` to `\!=` (SyntaxError). **This only affects developers editing CloudMask source through Claude Code** — library users and normal hook users are not affected.

**Workarounds:**
- Add `setopt NO_BANG_HIST` to `~/.zshrc` to disable zsh history expansion (recommended)
- Use string concatenation in tests for values containing `!` (e.g., `"vpc-" + "A1B2C3D4"`) to avoid hook interception
- When writing files via Claude Code, verify no `\!` was injected: `grep -r '\\!' src/ tests/`

### Hooks venv

Hooks run from a dedicated venv at `~/.cloudmask/.venv/` (not the project venv). The installer creates this automatically. If hooks fail silently in other projects, run `python3 scripts/install-hooks.py` to recreate the venv.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/fcc/aws-infrastructure-cloudtrail-lake/CLAUDE.md
# =========================================

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

AWS CDK (v2) project that deploys CloudTrail Lake infrastructure to the FCC audit account. It creates an organization-wide CloudTrail Lake event data store (management + S3 data events, 7-year retention) and an S3 bucket for query results with Glacier lifecycle and CloudTrail service principal access.

## Build & Dev Commands

```bash
yarn install              # install dependencies (uses private Nexus registry via .npmrc)
yarn run build            # compile TypeScript (tsc)
yarn run watch            # continuous build on file change
yarn run eslint           # lint
yarn run eslint --fix     # auto-fix lint issues
```

There are no tests in this project.

## Deployment

Requires `AWS_PROFILE` and `FCC_ENV` environment variables. Add `FCC_DR=true` for us-west-2 (default is us-east-1).

```bash
AWS_PROFILE=<profile> FCC_ENV=<env> yarn run synth    # synthesize to cfn.yml
AWS_PROFILE=<profile> FCC_ENV=<env> yarn run diff     # diff against deployed stack
AWS_PROFILE=<profile> FCC_ENV=<env> yarn run deploy   # deploy all stacks
AWS_PROFILE=<profile> FCC_ENV=<env> yarn run destroy  # tear down
```

## Architecture

- **`bin/cloudtrail-lake.ts`** -- CDK app entry point. Registers the workload with `FccWorkload.of()`.
- **`lib/cloudtrail-lake-stack.ts`** -- Single stack (`CloudtrailLakeStack`) extending `FccBuildableStack`. Deploys to `FccDeployment.AUDIT` account only. Contains two resources:
  - `CfnEventDataStore` -- org-wide CloudTrail Lake with management + S3 data event selectors
  - S3 bucket for query results with 30-day Glacier transition and CloudTrail service principal policy

## FCC CDK Framework

This project uses `@fcc/aws-cdk` and `@fcc/aws-cdk-core` (internal FCC CDK libraries). Key patterns:

- Stacks extend `FccBuildableStack` and implement `async build()`
- Stacks are decorated with `@FccStack({ stackId, deployments })` to bind to target accounts
- `FccWorkload.of()` in the bin file registers stacks with the framework
- `@fcc/aws-data` provides account constants like `FccCoreAccount.AUDIT` and `FccCoreAccount.MANAGEMENT`
- S3 buckets are created via `this.fcc.s3.builder()` fluent API, not raw CDK constructs
- CDK bootstrap uses qualifier `envteam` and toolkit stack `cdk-toolkit-envteam`

## CI/CD

Jenkins pipeline via `Jenkinsfile` using the shared `fcc-shared` library's `yarnCdkPipeline()`.

## Code Style

- TypeScript with 4-space indentation, single quotes, LF line endings, 160-char max line length
- ESLint config extends `@fcc/aws-cdk` defaults
- EditorConfig enforced (`.editorconfig`)


# =========================================
# SOURCE: /Users/samfakhreddine/repos/fcc/aws-infrastructure-config-rules/CLAUDE.md
# =========================================

# aws-infrastructure-config-rules

Org-wide AWS Config custom rules deployed via service-managed CloudFormation StackSets from a delegated administrator account. TypeScript CDK.

## Purpose

Reusable pattern for deploying AWS Config custom rules + auto-remediation to all AWS Organization accounts — without the LZA pipeline and without the management account.

## Architecture

```
Delegated Admin Account
  └── CDK App → CloudFormation StackSet (service-managed, auto-deploy)
       └── Per account (all org accounts, including new ones):
            ├── AWS::Config::ConfigRule (periodic, custom Lambda)
            ├── Evaluation Lambda (checks compliance)
            ├── AWS::Config::RemediationConfiguration (auto)
            ├── Remediation Lambda (fixes non-compliant state)
            ├── IAM execution roles
            └── CloudWatch log groups
```

## Key Decisions

- **StackSet-deployed Config rules, NOT org Config rules API** — `PutRemediationConfigurations` is explicitly blocked for org config rules. StackSet-deployed regular Config rules support remediation natively.
- **Delegated admin, NOT management account** — management account has too much governance overhead.
- **Per-account Lambdas, NOT hub-and-spoke** — each account evaluates and remediates locally. No cross-account role assumption needed for the core operation.
- **TypeScript CDK** — infrastructure as code with type safety. Each rule is a CDK construct.
- **NOT deployed via LZA** — LZA pipeline is slow and fragile. This repo has its own deployment lifecycle.

## Stack / Tools

- **Language**: TypeScript
- **IaC**: AWS CDK v2
- **Lambda runtime**: Python 3.12 (inline or bundled)
- **Testing**: Jest (CDK), pytest (Lambda)
- **Deployment**: `cdk deploy` from delegated admin account

## Parameter Contract

All rule constructs accept these standard props:

| Prop | Type | Description |
|---|---|---|
| `companyName` | string | Company identifier (e.g., `fcc`) |
| `organizationName` | string | Org identifier (`main`, `legacy`, `test`, `dr`) |
| `evaluationFrequency` | MaximumExecutionFrequency | Config eval cadence (default: `TWENTY_FOUR_HOURS`) |
| `remediationEnabled` | boolean | Toggle auto-remediation (default: `true`) |

Rule-specific props extend this base.

## Rules

### account-alias (first rule)
- **Evaluates**: Account alias matches `{company}-{org}-{tier}-{accountName}` convention
- **Remediates**: Sets correct alias + console color based on OU tier
- **Color map**: prod=red, staging=orange, test=yellow, dev=green, infrastructure=darkBlue, security=purple, sandbox=lightBlue
- **Depends on**: Organizations read APIs (`organizations:ListParents`, `organizations:DescribeOrganizationalUnit`, `organizations:DescribeAccount`)
- **Console color**: Set via UXC API (`uxc.{region}.api.aws`) with SigV4 signing

## Project Structure

```
aws-infrastructure-config-rules/
├── bin/                        # CDK app entry point
│   └── app.ts
├── lib/
│   ├── constructs/             # Reusable CDK constructs
│   │   └── config-rule-base.ts # Base construct for all Config rules
│   ├── rules/                  # Individual rule stacks
│   │   └── account-alias/
│   │       ├── stack.ts        # CDK stack
│   │       ├── evaluate.py     # Evaluation Lambda
│   │       └── remediate.py    # Remediation Lambda
│   └── stackset-stack.ts       # StackSet wrapper
├── test/                       # Jest tests
├── docs/
│   └── ba/                     # Business analysis artifacts
├── cdk.json
├── tsconfig.json
├── package.json
└── CLAUDE.md
```

## Prerequisites (assumed, not managed by this repo)

- Delegated CloudFormation StackSet administrator registered in AWS Organizations
- AWS Config recorder enabled in all accounts (Control Tower provides this)
- CDK bootstrapped in delegated admin account

## Conventions

- One CDK stack per Config rule
- Evaluation and remediation Lambdas are separate functions (single responsibility)
- Lambda code in Python 3.12, colocated with the stack definition
- All props have sensible defaults; only `companyName` and `organizationName` are required
- No hardcoded account IDs, ARNs, or region-specific values


# =========================================
# SOURCE: /Users/samfakhreddine/repos/fcc/opswork/tools/codeshaker/CLAUDE.md
# =========================================

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**dupdetect** is a multi-language function duplicate/similarity detection tool. It scans codebases to find:
- **Level 1**: Exact structural clones (functions with identical normalized AST/structure)
- **Level 2**: Near-clones (functions with high similarity via fingerprint-gated SequenceMatcher)
- **Level 3**: Anti-patterns (declarative YAML-based pattern matching)

This project will be extracted from the parent `opswork` repository into a standalone package.

## Architecture

### Core Design Principles

1. **Plugin-based language support**: Each language is a self-contained plugin implementing `LanguagePlugin` interface
2. **Pure logic separation**: Scanner has no I/O side effects (no prints, no file writes), only returns `ScanResult`
3. **Event-driven progress**: Progress callbacks via `ProgressCallback` protocol allow any UI to hook in
4. **YAML-driven anti-patterns**: Non-developers can add detection rules without writing code

### Module Responsibilities

```
dupdetect/
├── scanner.py           # Pure scan orchestrator (main API entry point)
├── models.py            # Data structures (FuncRecord, ScanResult, CloneCluster, etc.)
├── events.py            # Progress callback protocol
├── collector.py         # File collection with nested .gitignore support
├── similarity.py        # Fingerprint-gated near-clone detection engine
├── reporter.py          # JSON report assembly and writing
├── formatter.py         # CLI terminal output (CliFormatter)
├── builder.py           # YAML anti-pattern rule compiler
├── base.py              # Backward-compat shim (imports from models.py & plugins/)
├── core.py              # Legacy monolithic implementation (being phased out)
└── plugins/
    ├── base.py          # LanguagePlugin abstract base class
    ├── python_plugin.py # Python (AST-based extraction & normalization)
    ├── js_ts_plugin.py  # JavaScript/TypeScript (regex + brace counting)
    └── patterns/        # YAML anti-pattern definitions
        ├── python.yaml
        └── js_ts.yaml
```

### Key Data Flow

1. **Scanner.scan()** orchestrates the full pipeline:
   - Collect files (respecting .gitignore) → `collector.py`
   - Extract functions via plugins → `LanguagePlugin.extract_functions()`
   - Find exact clones via hash grouping → builds `CloneCluster` list
   - Find near-clones via fingerprint filter + SequenceMatcher → `similarity.py`
   - Detect anti-patterns via YAML rules → `LanguagePlugin.detect_anti_patterns()`
   - Return `ScanResult` (pure data, no side effects)

2. **CLI layer** (`find_duplicates.py`) wraps Scanner with presentation:
   - `CliFormatter` for terminal output during scan
   - `reporter.assemble_report()` + `reporter.write_report()` for JSON persistence

### Plugin System

To add a new language:

1. Create `plugins/<language>_plugin.py`
2. Subclass `LanguagePlugin` and implement:
   - `language_name`, `cli_name`, `file_extensions` (identity)
   - `extract_functions(filepath, repo_root) -> list[FuncRecord]` (parse & normalize)
   - `detect_anti_patterns(filepath, repo_root) -> list[AntiPatternHit]` (pattern matching)
3. Set `PLUGIN = YourPlugin()` at module level
4. (Optional) Create `plugins/patterns/<language>.yaml` for declarative anti-patterns

Plugins are auto-discovered via `discover_plugins()` which imports all `*_plugin.py` files.

### Anti-Pattern YAML Format

Patterns in `plugins/patterns/*.yaml` are compiled into matcher functions at runtime:

```yaml
patterns:
  - name: pattern_identifier
    description: "Human explanation"
    suggested_replacement: "Recommended alternative"
    keywords: ["search", "terms"]  # for snippet extraction
    indicators:
      - type: substring         # Simple substring match
        value: "bad_pattern"
      - type: frequency         # Count occurrences
        substring: "import *"
        min_count: 2
      - type: and/or            # Logical combinators
        conditions: [...]
```

**Developer Tools for Pattern Creation:**

```bash
# Interactive pattern generator
python tools/pattern_generator.py

# Validate pattern YAML
python tools/pattern_validator.py plugins/patterns/python.yaml

# Learn YAML anchors (DRY patterns)
cat plugins/patterns/PATTERN_GUIDE.md
cat plugins/patterns/YAML_ANCHORS_CHEATSHEET.md
```

**YAML Anchors** make patterns DRY (Don't Repeat Yourself):

```yaml
_anchors:
  has_retry: &has_retry
    type: substring
    value: "retry"

patterns:
  - indicators: [*has_retry]  # Reuse anchor
```

See `plugins/patterns/python_with_anchors.yaml.example` for full examples.

## Development Workflow

### Running the Scanner

```bash
# From repo root (parent directory contains find_duplicates.py)
cd /Users/samfakhreddine/repos/fcc/opswork

# Scan entire opswork repo (default)
python tools/find_duplicates.py

# Scan specific directory
python tools/find_duplicates.py /path/to/codebase

# Language filters
python tools/find_duplicates.py --lang python
python tools/find_duplicates.py --lang js

# Performance tuning
python tools/find_duplicates.py --skip-near-clones        # Fast mode (Level 1 + 3 only)
python tools/find_duplicates.py --ignore-tests             # Exclude test files
python tools/find_duplicates.py --max-comparisons 500000   # Increase comparison cap

# List available plugins
python tools/find_duplicates.py --list-plugins
```

### Programmatic API

```python
from dupdetect import Scanner
from dupdetect.formatter import CliFormatter

# Silent scan (returns ScanResult)
result = Scanner("/path/to/code").scan()

# With CLI progress output
result = Scanner(".").scan(on_progress=CliFormatter())

# Access results programmatically
for cluster in result.clone_clusters:
    print(f"{cluster.count} duplicates of {cluster.functions[0]['name']}")
```

### Code Quality Tools

The parent repository's `pyproject.toml` defines:

```bash
# Formatting
black .

# Linting
flake8 .

# Type checking
mypy .

# Testing (when tests are added)
pytest
```

**Note**: This project will soon have its own dedicated `pyproject.toml` when extracted from `opswork`.

## Important Implementation Details

### Normalization Strategy

**Python Plugin**:
- AST-based normalization via `ast.NodeTransformer`
- Strips: variable names, literals, type annotations, docstrings, decorators
- Preserves: control flow, function calls, operators, structure
- Hashes normalized AST → `norm_hash` for exact clone detection
- Generates structural fingerprint (bag-of-node-types) for near-clone pre-filtering

**JS/TS Plugin**:
- Regex-based extraction (no full parser dependency)
- Brace-counting for body detection
- Less precise than Python plugin but sufficient for duplicate detection

### Performance Optimizations

The near-clone engine uses **two-stage filtering** to avoid O(n²) blowup:

1. **Fingerprint similarity** (cheap Jaccard on structural fingerprints): Skip pairs < 0.5 similarity
2. **Line count bucketing**: Skip pairs where line counts differ by > 50%
3. **SequenceMatcher** (expensive): Only run on surviving candidates

Current cap: `--max-comparisons 200000` (configurable)

### .gitignore Handling

`collector.py` implements full nested `.gitignore` support:
- Discovers and parses `.gitignore` at every directory level during walk
- Supports path patterns (`foo/bar/*.js`), name patterns (`*.pyc`), directory names (`__pycache__/`)
- Always excludes `.git` and respects baseline rules in `dupdetect/default_ignore`

## Critical Files

- `scanner.py`: Main API surface — modify with extreme care (no I/O, no side effects)
- `models.py`: All dataclasses — changes affect serialization and API contracts
- `plugins/base.py`: LanguagePlugin interface — changes break all plugins
- `builder.py`: YAML compiler — pattern format changes require migration of all `.yaml` files

## Testing Strategy

When adding tests:
- Use `Scanner` API directly (no CLI invocation)
- Mock or use small fixture codebases (avoid large repo scans in tests)
- Test each phase independently: collection, extraction, clustering, similarity, anti-patterns
- Plugin tests should verify both extraction and normalization correctness

## Migration Notes

This codebase is transitioning from monolithic `core.py` to modular architecture:
- **OLD**: `core.run_scan()` does everything (prints, writes files, mixed responsibilities)
- **NEW**: `Scanner.scan()` is pure, returns `ScanResult`, UI/persistence handled separately

When making changes:
- Prefer modifying `scanner.py`, `collector.py`, `similarity.py`, etc.
- Avoid extending `core.py` (legacy code path, will be removed)
- Keep `Scanner` pure (no I/O beyond file reads for parsing)


# =========================================
# SOURCE: /Users/samfakhreddine/repos/fcc/aws-infrastructure-operations-notifications/service-now-automated-incidents/CLAUDE.md
# =========================================

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
yarn install --frozen-lockfile

# Build TypeScript
yarn build

# Watch mode (continuous build)
yarn watch

# Run all tests
yarn test

# Run a single test file
yarn test -- --testPathPattern="path/to/test.ts"

# Lint
yarn eslint

# Fix linting issues
yarn eslint --fix

# Synthesize to CloudFormation
AWS_PROFILE=<profile> FCC_ENV=<env> yarn synth

# Preview changes
AWS_PROFILE=<profile> FCC_ENV=<env> yarn diff

# Deploy all stacks
AWS_PROFILE=<profile> FCC_ENV=<env> yarn deploy

# Deploy to specific environment
AWS_PROFILE=orglab-prod FCC_ENV=orgLabProd yarn deploy
AWS_PROFILE=shared-services FCC_ENV=sharedServices yarn deploy
```

All deployment commands accept `FCC_DR=true` to switch to `us-west-2` (default is `us-east-1`).
`FCC_STACK=<STACK_ID>` can scope deployment to a single stack.

## Architecture

**Event flow:** CloudWatch Alarms → EventBridge → SQS → Lambda (process-sqs-event) → Step Functions → ServiceNow + MS Teams

**Two CDK stacks:**
- `ServiceNowAutomationMainStack` — all core resources (EventBridge, SQS, Lambda, Step Functions, DynamoDB)
- `ServiceNowAutomationStackSetStack` — cross-account IAM role deployed via StackSet to monitored accounts

**Two deployment environments** (defined in `lib/environment-config.ts`):
- `orgLabProd` — monitors orglab prod + non-prod accounts
- `sharedServices` — monitors all prod/non-prod accounts across the organization

### Internal code structure

The `lib/infra-utils/` layer is organized by responsibility:

| Layer | Path | Purpose |
|---|---|---|
| Builders | `builders/infrastructure-builder.ts` | Creates DynamoDB, SQS, EventBridge resources |
| Builders | `builders/state-machine-builder.ts` | Composes the main Step Functions state machine and wires IAM |
| Builders | `builders/ssm-document-builder.ts` | Deploys SSM Automation documents for EC2 diagnostics |
| Factories | `factories/lambda-factory.ts` | Creates all Lambda functions with their IAM policies |
| Factories | `factories/workflow-factory.ts` | Creates EC2, RDS, OpenSearch child state machines |
| Workflows | `workflows/main-orchestrator.ts` | Step Functions definition: gather details → check DynamoDB → route by resource type |
| Workflows | `workflows/ec2-workflow.ts` | Run SSM doc → wait → get output → create incident |
| Workflows | `workflows/rds-workflow.ts` | Create incident directly |
| Workflows | `workflows/opensearch-workflow.ts` | Describe domain → optionally grow → create incident |
| Tasks | `tasks/lambda-tasks.ts` | Reusable Step Functions Lambda invoke task builders |
| Tasks | `tasks/dynamodb-tasks.ts` | Reusable Step Functions DynamoDB task builders |
| Tasks | `tasks/ssm-tasks.ts` | Reusable Step Functions SSM task builders |

Lambda handlers live in `lib/lambda/handlers/<name>/index.ts`. Business logic is in `lib/lambda/service/`.

### Key types

- `AlarmType` enum (`lib/types.ts`) — controls EventBridge rule matching and workflow routing
- `ResourceType` enum (`lib/types.ts`) — EC2 / RDS / OPENSEARCH; determines which child state machine runs
- `ProjectConfig` interface (`lib/environment-config.ts`) — per-environment settings (monitored accounts, SSM param names, SNS topic, Teams webhook SSM path)

### SSM diagnostic scripts

`lib/infra-utils/builders/ssm-scripts/` contains the shell/PowerShell scripts embedded in SSM Automation documents:
- `linux-{cpu,disk,memory}.sh`
- `windows-{cpu,disk,memory}.ps1`

### Cross-account access

The stack deploys a cross-account IAM role (`service-now-automated-incident-notification-role`) via StackSet into every monitored account. Step Functions assume this role via STS to run SSM documents and describe EC2/RDS/OpenSearch resources remotely.

## Adding a New Alarm Type

1. Add value to `AlarmType` enum in `lib/types.ts`
2. Add `EventBridgeRuleConfig` entry in the main stack (`lib/service-now-automated-incident-stack.ts`)
3. If it maps to a new `ResourceType`, create a new workflow in `lib/infra-utils/workflows/`, add a factory method in `workflow-factory.ts`, and add routing in `main-orchestrator.ts`

## Internal Packages

- `@fcc/aws-cdk` — internal CDK constructs (`FCC.from`, `NodejsFunction` wrapper, etc.)
- `@fcc/aws-data` — `FccEnvironment`, `FccEnvironmentGroup`, account ID registry
- `@fcc/aws-ops-servicenow-toolbox` — ServiceNow API client

## Tests

Tests live under `project/test/` and run with Jest + ts-jest. Run a specific test with `--testPathPattern`.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/fcc/power-scp-optimizer/AGENTS.md
# =========================================

# AGENTS.md

Instructions for AI agents working in this repository.

## Hard rules

1. **ADVISORY ONLY** — Never execute AWS write operations. No `AttachPolicy`, `DetachPolicy`, `CreatePolicy`, `UpdatePolicy`, `DeletePolicy`, `MoveAccount`, or any mutating API call. All output is recommendations only.
2. **READ-ONLY TOOLS** — Only these AWS CLI operations are permitted:
   - `organizations:List*` and `organizations:Describe*`
   - `iam:GetServiceLastAccessedDetails`, `iam:GenerateServiceLastAccessedDetails`
   - Local file reads
3. **SCP max size is 5120 characters** — every proposed merge must be validated against this limit using minified JSON (no optional whitespace).

## Architecture

- `contracts/models.py` — Domain layer. All types, enums, constants, and shared validators live here. Never duplicate these.
- `contracts/inputs.py` — Interface layer. Serializes analysis context into LLM prompts. Depends on models.py only.
- `contracts/outputs.py` — Data layer. Parses LLM JSON responses into typed models. Depends on models.py only.
- `analyzer.py` — Orchestrator. Discovery, deterministic analysis, LLM calls, report generation. Depends on contracts and writer.
- `writer.py` — Output. Writes timestamped JSON + markdown to `recommendations/`. Depends on contracts only.

## Conventions

- Python 3.12+. Use `type` keyword for aliases, native `X | Y` unions, no `from __future__ import annotations`.
- Pydantic v2 models with `by_alias=True` for AWS JSON compatibility.
- SOLID, DRY, three-tier. Don't put business logic in inputs/outputs. Don't duplicate enums or constants.
- `ScpTarget.type` normalizes `ORGANIZATIONAL_UNIT` → `OU` via field validator.
- LZA-managed SCPs detected by name prefix: `AWSAccelerator-`, `AWSA`, `LZA-`.

## Analysis pipeline

The analyzer always runs deep analysis. The pipeline is:

1. **Discovery** — hierarchy + SCPs from AWS Organizations API (read-only)
2. **LZA detection** — flag SCPs managed through Landing Zone Accelerator
3. **Redundant attachments** — SCP attached to both parent and child
4. **Consolidation groups** — SCPs sharing identical target sets
5. **Deep cross-SCP comparison** — every deny statement pair checked for action/resource/condition overlap
6. **Wildcard subsumption** — `service:*` covering specific actions in other SCPs
7. **Condition analysis** — unconditional covers conditional, mergeable values, subset detection
8. **Compression opportunities** — common action prefixes that could become wildcards
9. **Merged policy generation** — actual JSON proposals for feasible consolidation groups
10. **LLM reasoning** — reviews compressions for safety, conditions for semantic equivalence
11. **Markdown report** — engineer-friendly prose with TL;DR, safety verdicts, prioritized actions

## When modifying

- Add new finding types to `contracts/models.py` first, then wire into analyzer and writer.
- Keep the LLM prompt in `analyzer.py` updated when adding new finding types.
- Steering docs in `steering/` should reflect current capabilities.
- Always test against cached data in `../scps/analysis/` before pushing.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/fcc/aws-dev-kit/.worktrees/dashboard-consolidation/.kiro/AGENTS.md
# =========================================

# Multi-Agent Consensus Review System

**Battle-Tested Pattern for Code Quality Assurance**

## Overview

This document defines a **1+3 consensus review pattern** where a specialized worker agent produces code changes, and three senior expert reviewers independently validate the work before approval. This pattern prevents hallucinations, catches subtle bugs, and ensures production-grade quality.

## Architecture

```
                    ┌─────────────────┐
                    │  Orchestrator   │
                    │    Agent        │
                    └────────┬────────┘
                             │
                   ┌─────────┴─────────┐
                   │                   │
                   ▼                   ▼
          ┌────────────────┐   ┌──────────────┐
          │ Worker Agent   │   │   Review     │
          │ (Specialist)   │   │   Panel      │
          │                │   │   (3 Experts)│
          └────────┬───────┘   └──────┬───────┘
                   │                  │
                   │  Submits Work    │
                   └──────────────────┤
                                      │
                         ┌────────────┴────────────┐
                         │                         │
                         ▼                         ▼
                 ┌───────────────┐         ┌──────────────┐
                 │  Consensus    │         │   Escalation │
                 │   Approval    │         │   (if split) │
                 └───────┬───────┘         └──────────────┘
                         │
                         ▼
                 ┌───────────────┐
                 │    Commit     │
                 └───────────────┘
```

## Roles and Responsibilities

### 1. Worker Agent (Specialist)
**Role**: Execute the assigned task with deep domain expertise

**Responsibilities**:
- Receive task specification from orchestrator
- Apply domain-specific knowledge and patterns
- Produce complete, working code changes
- Include self-assessment and testing notes
- Submit work to review panel

**Configuration**:
```json
{
  "model": "claude-sonnet-4-5",
  "temperature": 0.2,
  "skills": ["domain-specific-skills"],
  "context": "full",
  "tools": ["Read", "Edit", "Write", "Bash"]
}
```

**Example Workers**:
- JSDoc Transform Agent (for documentation)
- Backend Specialist (for API changes)
- Frontend Specialist (for UI components)
- Security Auditor (for security fixes)

### 2. Review Panel (3 Senior Experts)

**Role**: Independent verification of worker agent's output

**Composition**:
- **Reviewer 1: Domain Expert** - Deep expertise in the specific domain
- **Reviewer 2: Quality Assurance** - Code quality, patterns, best practices
- **Reviewer 3: Integration Specialist** - Cross-cutting concerns, dependencies

**Responsibilities**:
- Review work product independently (no collaboration)
- Evaluate against domain-specific criteria
- Assign quality score (1-10)
- Provide specific feedback on issues found
- Vote: APPROVE, REJECT, or NEEDS_WORK

**Configuration**:
```json
{
  "model": "claude-sonnet-4-5",
  "temperature": 0.0,
  "skills": ["reviewer-specific-skills"],
  "context": "focused",
  "tools": ["Read", "Grep", "Glob", "Bash"]
}
```

### 3. Orchestrator Agent

**Role**: Coordinate workflow and enforce consensus rules

**Responsibilities**:
- Assign task to worker agent
- Route work product to review panel
- Aggregate review scores and votes
- Apply consensus algorithm
- Execute approval or rejection actions
- Manage retry/escalation flow

**Configuration**:
```json
{
  "model": "claude-sonnet-4-5",
  "temperature": 0.1,
  "skills": ["workflow-orchestration-patterns", "multi-agent-patterns"],
  "context": "minimal",
  "tools": ["Task", "Bash"]
}
```

## Consensus Algorithm

### Approval Criteria

**APPROVED** (auto-commit):
- All 3 reviewers vote APPROVE
- Average quality score ≥ 8.0
- No critical issues flagged

**NEEDS_WORK** (retry with feedback):
- 2-3 reviewers vote NEEDS_WORK
- Average quality score 6.0-7.9
- Specific issues identified
- Worker agent gets 1 retry with feedback

**REJECTED** (revert and escalate):
- 2-3 reviewers vote REJECT
- Average quality score < 6.0
- Critical issues or fundamental flaws
- Escalate to human review or skip

### Weighted Scoring

Reviewers have different weights based on role:

```typescript
const weights = {
  domainExpert: 0.5,      // 50% weight
  qualityAssurance: 0.3,  // 30% weight
  integrationSpecialist: 0.2  // 20% weight
};

const weightedScore = (
  reviewer1.score * weights.domainExpert +
  reviewer2.score * weights.qualityAssurance +
  reviewer3.score * weights.integrationSpecialist
);
```

### Conflict Resolution

**2-1 Split Decision**:
- If 2 APPROVE + 1 NEEDS_WORK → APPROVE (with notes)
- If 2 APPROVE + 1 REJECT → NEEDS_WORK (investigate rejection reason)
- If 2 REJECT + 1 APPROVE → REJECT (safety first)
- If 2 NEEDS_WORK + 1 APPROVE/REJECT → NEEDS_WORK

**Tie-Breaker Rules**:
1. Domain expert has veto power for REJECT
2. Quality assurance can force NEEDS_WORK
3. If still split, escalate to human

## Review Criteria

### For JSDoc Transformation

**Domain Expert (JSDoc Specialist)**:
- [ ] All JSDoc blocks comply with line limits
- [ ] Required tags present (@param, @returns, @see, @category)
- [ ] No forbidden tags (@example)
- [ ] Clear, concise descriptions
- [ ] Proper TypeDoc linking syntax

**Quality Assurance (Code Quality)**:
- [ ] No functional code removed or modified
- [ ] Method signatures unchanged
- [ ] Interface properties unchanged
- [ ] Inline comments preserved
- [ ] Block comments preserved

**Integration Specialist (Build/Test)**:
- [ ] TypeScript compilation succeeds
- [ ] All tests pass
- [ ] No new linter errors
- [ ] Validation script passes
- [ ] Git diff shows only JSDoc changes

### For Backend API Changes

**Domain Expert (Backend Specialist)**:
- [ ] API contracts maintained
- [ ] RESTful conventions followed
- [ ] Error handling comprehensive
- [ ] Input validation robust
- [ ] Performance considerations addressed

**Quality Assurance (Code Quality)**:
- [ ] SOLID principles applied
- [ ] Code duplication minimized
- [ ] Naming conventions consistent
- [ ] Documentation complete
- [ ] Test coverage adequate (≥80%)

**Integration Specialist (System)**:
- [ ] Database migrations included
- [ ] Breaking changes flagged
- [ ] Authentication/authorization correct
- [ ] Logging and monitoring added
- [ ] Deployment considerations documented

## Workflow Implementation

### Step 1: Worker Agent Execution

```typescript
// Orchestrator spawns worker agent
const workResult = await Task({
  subagent_type: "jsdoc-transform",
  description: "Transform JSDoc in file.ts",
  prompt: `
    Transform JSDoc in ${filePath} according to standards.

    Context:
    - File: ${filePath}
    - Standards: ${standards}
    - Previous violations: ${violations}

    Deliverables:
    1. Transformed file content
    2. Summary of changes made
    3. Self-assessment checklist
    4. Test commands to verify
  `,
  model: "sonnet"
});
```

### Step 2: Review Panel Activation

```typescript
// Spawn 3 reviewers in parallel
const [review1, review2, review3] = await Promise.all([
  // Reviewer 1: Domain Expert
  Task({
    subagent_type: "general-purpose",
    description: "Review JSDoc compliance",
    prompt: `
      You are a JSDoc domain expert. Review this transformed file:

      Original: ${originalFile}
      Transformed: ${transformedFile}
      Changes: ${workResult.summary}

      Evaluate:
      1. JSDoc compliance (line limits, tags, style)
      2. Accuracy of transformation
      3. No unintended changes

      Provide:
      - Score (1-10)
      - Vote (APPROVE/NEEDS_WORK/REJECT)
      - Specific issues found
      - Suggested fixes (if NEEDS_WORK)
    `,
    model: "sonnet"
  }),

  // Reviewer 2: Quality Assurance
  Task({
    subagent_type: "general-purpose",
    description: "Review code quality",
    prompt: `
      You are a code quality expert. Review this transformation:

      Diff: ${gitDiff}
      Context: JSDoc transformation only

      Evaluate:
      1. No functional code removed
      2. Only JSDoc comments modified
      3. Code structure unchanged

      Provide:
      - Score (1-10)
      - Vote (APPROVE/NEEDS_WORK/REJECT)
      - Any violations found
    `,
    model: "sonnet"
  }),

  // Reviewer 3: Integration Specialist
  Task({
    subagent_type: "Bash",
    description: "Run validation gates",
    prompt: `
      You are an integration specialist. Validate this change:

      File: ${filePath}

      Execute:
      1. Validation script: node scripts/validate-jsdoc-compliance.js
      2. TypeScript compilation: npm run build
      3. Tests: cd packages/${package} && npx jest --no-coverage

      Provide:
      - Score (1-10): 10 if all pass, 0 if any fail
      - Vote: APPROVE if all pass, REJECT if any fail
      - Output from failed gates
    `,
    model: "sonnet"
  })
]);
```

### Step 3: Consensus Evaluation

```typescript
// Orchestrator evaluates consensus
function evaluateConsensus(reviews: Review[]): Decision {
  const votes = reviews.map(r => r.vote);
  const scores = reviews.map(r => r.score);

  // Calculate weighted score
  const weightedScore = (
    scores[0] * 0.5 +  // Domain expert
    scores[1] * 0.3 +  // Quality assurance
    scores[2] * 0.2    // Integration
  );

  // Count votes
  const approveCount = votes.filter(v => v === 'APPROVE').length;
  const rejectCount = votes.filter(v => v === 'REJECT').length;
  const needsWorkCount = votes.filter(v => v === 'NEEDS_WORK').length;

  // Apply consensus rules
  if (approveCount === 3 && weightedScore >= 8.0) {
    return { action: 'COMMIT', reason: 'Unanimous approval' };
  }

  if (rejectCount >= 2 || weightedScore < 6.0) {
    return { action: 'REVERT', reason: 'Failed quality threshold' };
  }

  if (approveCount >= 2 && weightedScore >= 7.0) {
    return { action: 'COMMIT', reason: 'Majority approval with acceptable score' };
  }

  // Default to needs work
  return {
    action: 'RETRY',
    reason: 'Mixed reviews - needs improvement',
    feedback: reviews.filter(r => r.vote !== 'APPROVE').map(r => r.feedback)
  };
}
```

### Step 4: Action Execution

```typescript
// Execute decision
const decision = evaluateConsensus([review1, review2, review3]);

switch (decision.action) {
  case 'COMMIT':
    await commitFile(filePath, decision.reason);
    console.log(`✅ Approved: ${decision.reason}`);
    break;

  case 'RETRY':
    if (retryCount < MAX_RETRIES) {
      // Send feedback to worker agent and retry
      await retryWithFeedback(filePath, decision.feedback);
    } else {
      await revertAndSkip(filePath, 'Max retries exceeded');
    }
    break;

  case 'REVERT':
    await revertAndSkip(filePath, decision.reason);
    console.log(`❌ Rejected: ${decision.reason}`);
    break;
}
```

## Anti-Patterns to Avoid

### ❌ Sycophancy (Reviewers Agreeing Without Reasoning)

**Problem**: Reviewers mimic each other's conclusions without independent analysis

**Detection**:
- All 3 reviewers provide identical feedback
- Reviews submitted within < 5 seconds of each other
- Generic feedback like "looks good" without specifics

**Mitigation**:
- Run reviews in parallel (no communication)
- Require specific evidence for all votes
- Flag suspiciously similar reviews for human inspection

### ❌ Telephone Game (Orchestrator Paraphrasing)

**Problem**: Orchestrator summarizes reviewer feedback incorrectly, losing fidelity

**Solution**: Use direct message forwarding
```typescript
// Bad: Orchestrator paraphrases
const summary = "Reviewers generally approved with minor concerns";

// Good: Direct pass-through
const feedback = {
  reviewer1: review1.fullFeedback,  // Exact text
  reviewer2: review2.fullFeedback,
  reviewer3: review3.fullFeedback
};
```

### ❌ Bottleneck (Orchestrator Context Saturation)

**Problem**: Orchestrator accumulates too much context from all reviews

**Solution**: Use summarization and checkpointing
```typescript
// Store full reviews externally
await fs.writeFile(`reviews/${workId}.json`, JSON.stringify(reviews));

// Orchestrator only holds summary
const summary = {
  workId,
  scores: reviews.map(r => r.score),
  votes: reviews.map(r => r.vote),
  decision: 'APPROVE'
};
```

### ❌ Weak Model Bias

**Problem**: Using weaker models for reviewers reduces quality

**Solution**: Use Sonnet 4.5 for all agents
```json
{
  "worker": { "model": "claude-sonnet-4-5" },
  "reviewer1": { "model": "claude-sonnet-4-5" },
  "reviewer2": { "model": "claude-sonnet-4-5" },
  "reviewer3": { "model": "claude-sonnet-4-5" },
  "orchestrator": { "model": "claude-sonnet-4-5" }
}
```

## Performance Considerations

### Parallelization

**Worker executes alone** (sequential):
```
Worker Agent: 30 seconds
```

**Reviewers execute in parallel** (concurrent):
```
3 Reviewers: max(10s, 8s, 12s) = 12 seconds
```

**Total time**: ~42 seconds vs ~60 seconds sequential (30% faster)

### Cost Optimization

**Token Budget per File**:
- Worker agent: ~4,000 tokens
- Reviewer 1: ~2,000 tokens
- Reviewer 2: ~2,000 tokens
- Reviewer 3: ~1,500 tokens (mostly bash commands)
- **Total**: ~9,500 tokens per file

**Cost**: ~$0.03 per file at Sonnet 4.5 pricing

### Quality vs Speed Trade-offs

| Configuration | Speed | Cost | Quality |
|---------------|-------|------|---------|
| 1 worker, 0 reviewers | Fastest | Lowest | Low (60% accuracy) |
| 1 worker, 1 reviewer | Fast | Low | Medium (80% accuracy) |
| 1 worker, 3 reviewers | **Moderate** | **Moderate** | **High (95% accuracy)** ← Recommended |
| 1 worker, 5 reviewers | Slow | High | Highest (98% accuracy) |

**Recommendation**: 1+3 pattern provides the best quality/cost/speed balance

## Monitoring and Metrics

### Success Metrics

Track these metrics per review session:

```typescript
interface ReviewMetrics {
  // Consensus metrics
  unanimousApprovals: number;      // All 3 APPROVE
  majorityApprovals: number;       // 2 APPROVE
  splits: number;                  // Mixed votes
  rejections: number;              // 2+ REJECT

  // Quality metrics
  averageScore: number;            // Weighted score average
  scoreDistribution: number[];     // Histogram of scores

  // Efficiency metrics
  firstPassSuccess: number;        // Approved on first try
  retriesNeeded: number;           // Needed 1+ retries
  maxRetriesExceeded: number;      // Hit retry limit

  // Time metrics
  averageWorkerTime: number;       // Avg worker execution time
  averageReviewTime: number;       // Avg review time
  totalProcessingTime: number;     // End-to-end time
}
```

### Quality Indicators

**High Quality Signs**:
- ✅ Unanimous approvals > 70%
- ✅ Average score > 8.5
- ✅ First-pass success > 80%
- ✅ Splits < 10%

**Warning Signs**:
- ⚠️ Unanimous approvals < 50% (too strict or quality issues)
- ⚠️ Average score < 7.0 (worker producing poor work)
- ⚠️ Retries > 30% (worker not learning from feedback)
- ⚠️ Splits > 20% (inconsistent review criteria)

## Integration with JSDoc Workflow

### Configuration

Add to `tools/jsdoc-agent/config/agent-config.json`:

```json
{
  "review": {
    "enabled": true,
    "pattern": "1+3",
    "reviewers": [
      {
        "name": "jsdoc-domain-expert",
        "weight": 0.5,
        "skills": ["doc-coauthoring", "api-documentation-generator"],
        "criteria": "jsdoc-compliance"
      },
      {
        "name": "code-quality-expert",
        "weight": 0.3,
        "skills": ["code-refactoring-refactor-clean"],
        "criteria": "code-preservation"
      },
      {
        "name": "integration-specialist",
        "weight": 0.2,
        "skills": ["tdd-workflow"],
        "criteria": "validation-gates"
      }
    ],
    "consensus": {
      "minimumScore": 8.0,
      "approvalThreshold": 3,
      "allowMajorityApproval": true,
      "rejectThreshold": 2
    }
  }
}
```

### Usage in Orchestrator

```typescript
import { ReviewPanel } from './agents/review-panel';

// In orchestrator.processFile()
const transformed = await this.transformAgent.transformFile(file);

if (this.config.review.enabled) {
  // Submit to review panel
  const reviewResult = await this.reviewPanel.evaluate({
    workerId: 'jsdoc-transform',
    filePath: file.path,
    original: originalContent,
    transformed: transformedContent,
    workSummary: transformed.summary
  });

  if (reviewResult.decision === 'COMMIT') {
    await this.commitFile(file);
  } else if (reviewResult.decision === 'RETRY') {
    await this.retryWithFeedback(file, reviewResult.feedback);
  } else {
    await this.revertAndSkip(file, reviewResult.reason);
  }
} else {
  // Fallback: just run validation gates
  const validation = await this.validateFile(file.path);
  // ... existing validation logic
}
```

## Best Practices

1. **Run reviewers in parallel** - No communication between reviewers
2. **Use specific criteria** - Each reviewer has clear evaluation rubric
3. **Require evidence** - Reviewers must cite specific issues found
4. **Weight by expertise** - Domain expert has highest weight
5. **Apply safety bias** - When in doubt, reject or retry
6. **Log all reviews** - Store full review data for analysis
7. **Monitor consensus patterns** - Track approval rates and adjust thresholds
8. **Use same model** - All agents use Sonnet 4.5 for consistency
9. **Direct message forwarding** - Avoid orchestrator paraphrasing
10. **Checkpoint frequently** - Save review state to prevent context saturation

## References

- **Multi-Agent Patterns**: `.kiro/skills/multi-agent-patterns/SKILL.md`
- **Workflow Orchestration**: `.kiro/skills/workflow-orchestration-patterns/SKILL.md`
- **Parallel Agents**: `.kiro/skills/parallel-agents/SKILL.md`
- **LangGraph Multi-Agent Benchmarks**: Research showing swarm > supervisor when using direct message forwarding
- **Consensus Algorithms**: Weighted voting prevents weak model bias

---

**Status**: Production-Ready
**Tested On**: 1000+ file transformations
**Success Rate**: 95% first-pass approval
**False Positive Rate**: < 2%


# =========================================
# SOURCE: /Users/samfakhreddine/repos/fcc/aws-infrastructure-fcc-org-cloudtrail/CLAUDE.md
# =========================================

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AWS CDK (TypeScript) project that deploys the FCC organization-wide CloudTrail infrastructure. Deploys across three AWS accounts (billing, payer, security) using the internal `@fcc/aws-cdk` and `@fcc/aws-data` libraries. CDK v2.115.0, TypeScript ~4.9.

## Commands

```bash
npm run build          # Compile TypeScript (tsc)
npm run watch          # Continuous compilation
npm run test           # Run Jest tests (NODE_ENV=test)

# Deployment (all require AWS_PROFILE and FCC_ENV)
AWS_PROFILE=<profile> FCC_ENV=<env> npm run synth     # Synthesize to cfn.yml
AWS_PROFILE=<profile> FCC_ENV=<env> npm run diff      # Diff against deployed
AWS_PROFILE=<profile> FCC_ENV=<env> npm run deploy    # Deploy all stacks

# Add FCC_DR=true to target us-west-2 instead of us-east-1
# Add DEBUG=true for verbose output

yarn install --frozen-lockfile   # CI install (npm registry: nexus.lending.fcc.ca)
```

## Architecture

The app entry point (`bin/fcc-cloudtrail.ts`) uses `FCC.from()` to register four stacks with a dependency chain:

```
bucket-dr (billing, us-west-2)
  └─► bucket (billing, us-east-1, depends on bucket-dr)
        └─► main (payer, depends on bucket)
cloudtrail-lake (security, standalone)
```

**Stacks:**

- **`main`** (`FccCloudtrailStack`) — Organization-level CloudTrail trail deployed to the payer account. References the S3 bucket and SNS topic created by the bucket stack. Uses a hardcoded KMS key ARN.
- **`bucket`** (`FccCloudTrailBucketStack`) — S3 bucket + SNS topic + KMS key in the billing account. Configures S3 replication to DR bucket with Glacier storage class. SNS topic policy has a hardcoded list of AWS account IDs for `sns:Publish` access.
- **`bucket-dr`** (`FccCloudTrailBucketDrStack`) — DR replication target bucket in us-west-2 (billing account).
- **`cloudtrail-lake`** (`FccCloudTrailLakeSecurityStack`) — CloudTrail Lake event data store + query results bucket in the security account. 2555-day retention, termination protection enabled.

## Key Patterns

- All stacks extend `BuildableStack` from `@fcc/aws-cdk` and implement an `async build()` method.
- Stack metadata is declared via the `@FccStack()` decorator (stackId, target environments, region, dependencies).
- S3 buckets are created through the `this.fcc.s3.builder()` fluent API, not raw CDK constructs.
- Account IDs and regions come from `FccAccount` and `FccRegion` enums in `@fcc/aws-data`.
- Environment targeting uses `FccEnvironment` enum values (billing, payer, security).
- `FCC.organization.id` provides the AWS Organization ID (used in bucket policies and KMS grants).

## Important Context

- The SNS topic policy in `fcc-cloudtrail-bucket-stack.ts` contains a hardcoded list of ~27 AWS account IDs. When accounts are added or removed from the org, this list must be updated manually.
- A previous bug (commit 668cc16) showed that `FCC.organization.id` does not work with the CloudTrail `CfnTrail` construct — the main stack uses the org ID only in S3 bucket policy paths, not in the trail config itself.
- The KMS key ARNs in the bucket and main stacks are hardcoded (not looked up dynamically).
- The test file is effectively a no-op — assertions are commented out.

## Git Conventions

- Branch prefixes: `feat/`, `fix/`, `chore/`, `refactor/` — never `claude/`.
- CLAUDE.md is local-only: excluded via `.git/info/exclude`, never committed.
- Code owners: `@farmcreditca/peng-architects`.


# =========================================
# SOURCE: /Users/samfakhreddine/repos/fcc/CLAUDE.md
# =========================================

# FCC Projects — Claude Code Convention

## Local CLAUDE.md Rule

Every FCC project must follow this pattern for Claude Code context files:

- `CLAUDE.md` lives in the **project root** (not inside `.claude/`, not committed)
- `CLAUDE.md` is excluded locally via **`.git/info/exclude`** — never via `.gitignore`
- This keeps Claude context local to each developer without polluting the shared repo

### Setup for each project

1. Create `CLAUDE.md` in the project root with project-specific context
2. Add to `.git/info/exclude`:

```
# Local-only Claude Code context — not committed
CLAUDE.md
```

Never add `CLAUDE.md` to `.gitignore` (that file is committed and shared).

## Git Branch Naming

Never use `claude/` as a branch prefix. Use standard conventional prefixes:

- `feat/` for new features
- `fix/` for bug fixes
- `chore/` for maintenance tasks
- `refactor/` for refactoring

This keeps AI tooling invisible in the shared repo history.

## MCP Servers

The following MCP servers are available in this workspace. Use them when relevant:

- **`aws-documentation`** — Search and read official AWS service documentation.
- **`aws-iac`** — CDK best practices, CloudFormation validation, CDK docs and samples, pre-deploy validation instructions, and CFN deployment troubleshooting.
- **`aws-diagram`** — Generate AWS architecture diagrams from code or descriptions.
- **`context7`** — Fetch up-to-date library documentation and code examples (resolves library IDs then queries docs).


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
# SOURCE: /Users/samfakhreddine/repos/gitrdunhq/awscredsmcp/AGENTS.md
# =========================================

# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# DATUM Enforcement
This repository uses DATUM for all workflows. You must use the `/datum` skill commands (like `/datum go`, `/datum express`) for any feature work or fixes.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **awscredsmcp** (405 symbols, 719 relationships, 33 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
| `gitnexus://repo/awscredsmcp/context` | Codebase overview, check index freshness |
| `gitnexus://repo/awscredsmcp/clusters` | All functional areas |
| `gitnexus://repo/awscredsmcp/processes` | All execution flows |
| `gitnexus://repo/awscredsmcp/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |
| Work in the Tools area (15 symbols) | `.claude/skills/generated/tools/SKILL.md` |
| Work in the Scripts area (15 symbols) | `.claude/skills/generated/scripts/SKILL.md` |
| Work in the Data area (10 symbols) | `.claude/skills/generated/data/SKILL.md` |
| Work in the Awscredsmcp area (7 symbols) | `.claude/skills/generated/awscredsmcp/SKILL.md` |
| Work in the Hooks area (7 symbols) | `.claude/skills/generated/hooks/SKILL.md` |
| Work in the Presentation area (6 symbols) | `.claude/skills/generated/presentation/SKILL.md` |

<!-- gitnexus:end -->


# =========================================
# SOURCE: /Users/samfakhreddine/repos/gitrdunhq/awscredsmcp/CLAUDE.md
# =========================================

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For agent-specific instructions, see [AGENTS.md](AGENTS.md).

## Commands

```bash
uv run pytest                                          # all tests
uv run pytest tests/unit/                             # unit tests only
uv run pytest tests/integration/                      # integration tests only
uv run pytest tests/unit/path/test_file.py::test_name # single test
uv run ruff check src/ tests/                         # lint
uv run awscredsmcp                                    # run the MCP server
docker compose up                                     # run via Docker
```

## Architecture

Three-tier DPS layout under `src/awscredsmcp/`:

- **`data/`** — I/O only: `aws_client` (boto3 calls), `profile_reader`, `config_loader`, `cache`, `audit_log`, `response_serializer`
- **`logic/`** — pure functions: `allowlist` (read-only enforcement), `credential_resolver`, `response_shaper`, `config_validator` (Pydantic `AppConfig`)
- **`presentation/`** — MCP surface: `server.py` (FastMCP setup + tool registration), `service.py` (orchestration), `middleware.py` (chain), `tools/` (generic, shortcuts, profiles, search, sweep)

**Request flow:** every AWS call goes through `service.execute_aws_call` → `MiddlewareChain` → `credential → allowlist → cache → invoke → serialize → shape`, all wrapped by `audit_middleware`.

**Read-only enforcement** lives entirely in `logic/allowlist.py`. Operations are normalized to `snake_case` and must match `ALLOWED_PREFIXES` (list_, describe_, get_, etc.) or `ALLOWED_SPECIFIC`. Extra operations can be added via `AppConfig.extra_allowed_operations`.

**Config** resolves from `~/.awscredsmcp/config.json` (or `AWSCREDSMCP_CONFIG` env var), with `AWSCREDSMCP_*` env vars as overrides. Defaults to SSE transport on `127.0.0.1:12319`.

**Sweep** (`tools/sweep.py` + `service.execute_sweep`) fans out a single operation across multiple profiles concurrently via `ThreadPoolExecutor` (configurable via `sweep_max_workers`).

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **awscredsmcp** (405 symbols, 719 relationships, 33 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
| `gitnexus://repo/awscredsmcp/context` | Codebase overview, check index freshness |
| `gitnexus://repo/awscredsmcp/clusters` | All functional areas |
| `gitnexus://repo/awscredsmcp/processes` | All execution flows |
| `gitnexus://repo/awscredsmcp/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |
| Work in the Tools area (15 symbols) | `.claude/skills/generated/tools/SKILL.md` |
| Work in the Scripts area (15 symbols) | `.claude/skills/generated/scripts/SKILL.md` |
| Work in the Data area (10 symbols) | `.claude/skills/generated/data/SKILL.md` |
| Work in the Awscredsmcp area (7 symbols) | `.claude/skills/generated/awscredsmcp/SKILL.md` |
| Work in the Hooks area (7 symbols) | `.claude/skills/generated/hooks/SKILL.md` |
| Work in the Presentation area (6 symbols) | `.claude/skills/generated/presentation/SKILL.md` |

<!-- gitnexus:end -->
