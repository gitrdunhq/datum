# Retro: Epic 14 — Grammar-constrained generation

**Date:** 2026-05-28
**PR:** #38
**Branch:** datum/epic-14

## Summary

Integrated the outlines library for grammar-constrained local LLM output. Pydantic schemas now enforce valid JSON structure on Gemma responses for pipeline tasks (triage, skeleton, validate).

## Metrics

- **Files changed:** 7
- **Lines:** +482 / -46
- **Pipeline path:** Informal

## What went well

- `datum.local_llm.structured(prompt, Schema)` is a clean API for constrained generation
- Eliminates the "parse the JSON out of the markdown" failure mode
- Pydantic schemas are reusable across local and cloud tiers

## What to improve

- outlines + mlx dependency weight is non-trivial — install story needs work
