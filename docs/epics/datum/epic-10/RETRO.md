# Retro: Epic 10 — Semantic memory extraction

**Date:** 2026-05-28
**PR:** #34
**Branch:** datum/epic-10

## Summary

Added MLX-based semantic memory extraction using Jina v5 embeddings on Apple Silicon. `datum dream --semantic` (default) uses vector similarity instead of regex to find memory candidates in transcripts.

## Metrics

- **Files changed:** 3
- **Lines:** +316 / -21
- **Pipeline path:** Informal

## What went well

- MLX inference runs locally with zero API cost
- Graceful fallback to regex when MLX unavailable
- Jina v5 embeddings are fast on M-series chips

## What to improve

- Needs threshold tuning for confidence scoring
