# Retro: Epic 8 — Documentation cleanup

**Date:** 2026-05-28
**PR:** #32
**Branch:** datum/epic-8

## Summary

Replaced all `uv run` and `python3 scripts/` references across documentation with `datum <command>` CLI syntax. Zero internal tooling exposure in user-facing prose.

## Metrics

- **Files changed:** 7
- **Lines:** +331 / -93
- **Pipeline path:** Informal

## What went well

- Systematic sweep caught all occurrences
- Docs now consistently present the CLI wrapper as the sole interface

## What to improve

- Retroactive closeout — no formal artifacts existed for this epic
