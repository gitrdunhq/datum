# ADR-0019: GitNexus as Complementary Code-Graph Intelligence

## Status

Accepted (design)

## Context

datum is indexed by **GitNexus** (call graph: symbols, relationships, execution flows/processes; tools
`gitnexus_impact`, `gitnexus_context`, `gitnexus_detect_changes`, `gitnexus_query`, `gitnexus_rename`).
The question: does GitNexus complement datum-ax's locked-in tools, or do they already cover it?

The locked tools cover the **context channel**: Serena (live LSP symbol/AST), TokenSave (repo metadata),
Context7 (external docs). The only overlap with GitNexus is "find references" — and there the tools
answer different questions:

- **Serena** → *one-hop, live* references (reflects the working tree).
- **GitNexus** → *transitive, risk-scored, flow-aware* impact (precomputed graph).

The transitive-impact, execution-flow, and change-scoping layers have **no equivalent** in Serena /
TokenSave / Context7. So GitNexus **complements**; it is not redundant.

## Decision

Adopt GitNexus as a **complementary intelligence layer** — explicitly **not** part of the context
firewall (ADR-0004) and **not** a Serena replacement. Bounded role:

- **PLAN** — derive lane dependencies, file ownership, and contract-first ordering (ADR-0010) from the
  call graph; risk-scored blast radius shapes the DAG.
- **Tokenomics routing** (ADR-0009) — blast radius selects model tier and can escalate ROUTE
  (ADR-0018): trivial impact → cheap tier; high impact → escalate.
- **Change-scoping** — `gitnexus_detect_changes` confirms a diff touched only intended scope, scoping
  the discipline gate and test/eedom selection.
- **CLOSEOUT** — reindex (datum already does this via `gitnexus_reindex.py`).

Constraints:
- **Never inside the tight per-attempt loop** — the index goes stale as diffs apply; use Serena's live
  LSP there.
- Queries are **deterministic and zero-LLM**; outputs are structured metadata that ride the lossless
  code channel — tokenomics-friendly.
- **ROUTE-gated** — `hotfix`/`spike` on small scope skip the index to avoid maintenance overhead.
- **Graceful degradation** — if the index is stale/unavailable, planning falls back to Serena
  references and the run is marked `gitnexus_degraded` (datum's existing pattern); GitNexus never
  blocks.

## Consequences

- A 6th tool adds operational weight (index lifecycle / reanalyze), justified by safer multi-lane
  planning and change-scoping; bounded to pre/post-loop keeps the cost contained.
- Blast-radius-driven tier/route selection is a concrete tokenomics win unavailable from the context
  tools alone.
- Because it degrades gracefully and is ROUTE-gated, GitNexus is an **optional accelerator**, not a
  hard dependency — consistent with the adapter-isolation stance for every external tool.
</content>
