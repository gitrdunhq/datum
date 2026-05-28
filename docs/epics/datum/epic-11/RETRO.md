# Retro: Epic 11 — Local LLM beta

**Date:** 2026-05-28
**PR:** #35
**Branch:** datum/epic-11

## Summary

Shipped the local LLM beta: MLX Gemma 4 26B inference with retry ladder escalation (local → Sonnet → Opus) and per-call cost tracking. `datum local-llm` for status, `datum local-llm --stats` for metrics.

## Metrics

- **Files changed:** 4
- **Lines:** +295 / -1
- **Pipeline path:** Informal

## What went well

- Retry ladder design cleanly separates local and cloud tiers
- Cost tracking from day one enables ROI measurement
- `datum local-llm --stats` gives instant visibility into savings

## What to improve

- #42 filed: max_tokens and context_window conflation causes budget check to reject valid prompts
