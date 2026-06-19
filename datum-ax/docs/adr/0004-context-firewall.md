# ADR-0004: Context Firewall (Serena / TokenSave / Context7 / Headroom.ai)

## Status

Accepted (design)

## Context

The biggest lever on both quality and cost is what goes into the prompt. Dumping whole files wastes
tokens and still loses precision; compressing code corrupts exact signatures, bindings, and imports,
which breaks generation. We have four user-locked tools and must compose them without letting any one
tool's API leak into orchestration logic.

## Decision

Enforce a strict rule: **code/AST is exact and never compressed; only natural-language docs are
compressed.** Two channels, three adapter contracts (ARCHITECTURE §3.3):

- **Code channel (lossless):**
  - **Serena** — LSP symbol/AST retrieval; build the Global AST map and pull *targeted* symbols
    instead of dumping files.
  - **TokenSave** — standardized, token-efficient, language-agnostic repo metadata.
  - Never routed through compression.
- **NL channel (compressible):**
  - **Context7** — version-specific external library/API docs.
  - **Headroom.ai** — the **single sanctioned compression point**, applied only to the NL channel.
- **Prompt assembler** enforces the firewall and emits the stable prefix
  `[System] + [Global AST] + [Diff]` for oMLX prompt-cache reuse (ADR-0003).

All four are accessed through their adapter contracts (`CodeContext`, `DocContext`, `NlCompressor`);
no tool-specific calls appear in graph nodes.

## Consequences

- Generation sees exact code and compressed prose — the right trade on both axes.
- Compression risk is contained to one interface; if Headroom.ai underperforms, only `NlCompressor`'s
  implementation changes.
- The assembler is responsible for prefix stability; instability silently kills prompt-cache hits.
- Untrusted text from any channel (issue/PR bodies, repo content, Context7 docs) is fenced as **data,
  not instructions** — the prompt-injection boundary is owned here and in ADR-0011.
- TokenSave and Serena overlap; the assembler must dedupe so the same symbol isn't sent twice.
</content>
