# TICKET: E4 — Context firewall & DCP

## Intent
Feed the model exact code and compressed documentation while keeping the context window strictly curated. Implement the context-firewall contracts (ADR-0004) and Dynamic Context Pruning (DCP) (ADR-0021) to ensure the `[System] + [Global AST] + [Diff]` prefix remains cache-stable, and the variable suffix respects token budgets via placeholder substitution.

## Requirements
- `SerenaTokenSaveContext`: Stub adapter implementing `CodeContext` (ADR-0004). Returns exact `SymbolSlice`s without compression.
- `Context7DocContext`: Stub adapter implementing `DocContext`.
- `HeadroomNlCompressor`: Stub adapter implementing `NlCompressor`.
- `PromptAssembler`: The core engine for this epic. 
  - Builds the context prefix (`[System] + [Global AST] + [Diff]`).
  - Manages the variable suffix (messages, tool outputs).
  - Enforces the window budget via a hard pre-dispatch guard (raising if essential content exceeds budget).
- `DynamicContextPruner`: Implements occupancy-driven pruning (watermarks). Replaces bulky tool outputs (e.g. test logs) with retrievable placeholders to stay under `TokenBudget`.

## Acceptance Criteria
- [ ] `SerenaTokenSaveContext`, `Context7DocContext`, `HeadroomNlCompressor` satisfy their E1 contracts.
- [ ] `PromptAssembler` successfully builds a prompt under the specified window budget.
- [ ] Injecting an oversized tool output triggers the `DynamicContextPruner` to replace it with a placeholder, dropping occupancy below the soft high-water mark.
- [ ] The stable prefix is correctly segregated from the variable suffix.
- [ ] `uv run pytest` green; tier-boundary guard passes (data → contracts).

## Constraints & NFRs
- `data` tier implementation (`src/datum_ax/data/context`).
- Strict Pydantic. Use fake/stub underlying systems (we don't depend on actual Serena/TokenSave/Context7 binaries for unit tests).

## Classification
- Complexity: Feature · Scope: narrow · Ambiguity: low · Suggested route: feature
