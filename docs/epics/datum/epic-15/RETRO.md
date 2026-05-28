# Retro: Epic 15 — Enforce local LLM via subagent only

**Date:** 2026-05-28
**PR:** #39
**Branch:** datum/epic-15

## Summary

Added a PreToolUse hook that blocks direct shell invocation of local LLM commands. AGENTS.md updated to mandate the Agent tool for all local LLM calls. CLI remains available for human testing only.

## Metrics

- **Files changed:** 2
- **Lines:** +20
- **Pipeline path:** Patch

## What went well

- Hook enforcement is deterministic — no behavioral guidelines to drift
- Clean separation: humans use CLI, agents use Python API

## What to improve

- Minimal scope — executed cleanly
