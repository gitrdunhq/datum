# Token Efficiency

Token cost compounds across epics. This doc describes how the skill minimizes it.

## Agent Tooling Agency

Agents have authority to write helpers that make subsequent work cheaper.
Tooling commits do NOT count against retry budgets.

Tooling lives in `scripts/lane-tools/`. Rules:
- Every new tool must have a manifest entry in `scripts/lane-tools/manifest.toml`
- Every new tool must have a one-line description in `scripts/lane-tools/README.md`
- Tools cannot introduce external dependencies silently (pip install → user gate)
- Tools cannot circumvent gates, auto-approve plans, or bypass triage steps
- Tools are discoverable by subsequent agents via the README

## Per-Phase Efficiency Notes

**Discovery / Refine:**
- Prefer `gitnexus analyze` over manual code archaeology when the index is missing
- **Brief Caching (SMED):** Setup reduction via shared context. Pre-extract the sections of SPEC and common module signatures that every downstream lane will need into `common-context.md` once; lanes read the extract, not the full source.

**Plan:**
- Prefer `gitnexus impact` over reading every potentially-affected file
- Use `cypher` for dependency traversals that would otherwise require grep + read

**ACT:**
- GREEN agents receive only the assertion text signal, not test bodies — reduces context significantly
- Agents that need callers of a symbol use GitNexus, not grep
- If GitNexus unavailable, write an AST-based finder to `lane-tools/` and use it for all subsequent lanes (write once, reuse N times)
- Pre-extract shared SPEC sections into `lane-context.md` if 3+ lanes reference the same sections

**Review:**
- Packets are agent-filled JSON; the renderer is a script, never an LLM
- Review agents receive only the relevant SPEC sections and diff for their domain

**Closeout:**
- Synthesis agent reads ONE collated JSON file (`closeout-data.json`), not 20 source documents
- Collectors are scripts, not LLM — no tokens spent gathering data

## Principles

**Prefer structured tools over scans:**
If an agent needs callers of a symbol, it uses GitNexus or an AST tool.
It does NOT grep + read N files.

**Refuse LLM work that is script work:**
An agent asked to validate a packet against a JSON schema runs the validator script.
It does not match strings against regex in tokens.

**Filter verbose tool output:**
Agents wrap noisy tools with jq-style filters to drop fields they don't need.
Wrappers go in `lane-tools/`.

**Extract repeated patterns:**
When three lanes need the same property helper (three-duplication rule applies to test helpers),
the third lane is empowered to extract it to a shared helper module.

**Drop stale context:**
Briefs include "you may stop tracking X once Y is done" guidance.
Agents shrink their working set as a task progresses.

## Lane-Tools README Format

`scripts/lane-tools/README.md` is the discovery surface for all lane tools.
Agents read this file before starting work to know what helpers already exist.

Format:
```markdown
# Lane Tools

## find_callers.py
AST-based caller finder. Use instead of grep+read for impact lookups.
Usage: datum lane-tool find_callers <symbol_name>

## filter_gitnexus_output.py
Reduces gitnexus impact output to {file, line, confidence} fields.
Usage: gitnexus impact <symbol> | python3 scripts/lane-tools/filter_gitnexus_output.py
```

The orchestrator updates this file automatically when REFACTOR agents add new tools.
