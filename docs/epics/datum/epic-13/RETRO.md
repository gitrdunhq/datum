# Retro: Epic 13 — datum --version + seed_state_docs fix

**Date:** 2026-05-28
**PR:** #37
**Branch:** datum/epic-13

## Summary

Added `datum --version` flag to CLI. Also fixed a critical bug where `seed_state_docs` would overwrite existing CLAUDE.md during `datum init`.

## Metrics

- **Files changed:** 8
- **Lines:** +179 / -20
- **Pipeline path:** Informal

## What went well

- CLAUDE.md nuke bug caught before it destroyed a real project's instructions
- `--version` is table-stakes CLI behavior, good to have early

## What to improve

- The CLAUDE.md overwrite bug should have been caught by tests in the seed_state_docs module
