# Retro: Epic 12 — local-llm chat import fix

**Date:** 2026-05-28
**PR:** #36
**Branch:** datum/epic-12

## Summary

Hotfix: corrected the `chat()` import path in `local_llm` module and fixed the SSOT `max_tokens` default resolution so config.toml values are respected.

## Metrics

- **Files changed:** 1
- **Lines:** +2 / -2
- **Pipeline path:** Patch

## What went well

- Quick, surgical fix — Patch-tier appropriate

## What to improve

- Import path was broken in the prior PR (Epic 11) — suggests smoke test gap
