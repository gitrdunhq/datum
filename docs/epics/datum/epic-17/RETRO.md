# Retro: Epic 17 — datum-tui beta

**Date:** 2026-05-28
**PR:** #41
**Branch:** datum/epic-17
**Merge SHA:** cfb8f3a

## Summary

Shipped a Textual-based TUI dashboard for the DATUM factory floor, plus a complete OpenRouter TUI reference implementation in TypeScript. The TUI reads `.datum/` state files without importing from the datum package — loosely coupled by design.

## Metrics

- **Files changed:** 51
- **Lines:** +5,345 / -3
- **New CLI command:** `datum floor`
- **Tests added:** 4 (smoke tests in `datum-tui/test_app.py`)
- **Pipeline path:** Informal (no TICKET/SPEC/TASKS — direct implementation)

## What went well

- Loose coupling decision (filesystem reads only, no package imports) keeps the TUI independently deployable
- OpenRouter reference implementation provides a concrete template for future TUI agents
- `datum floor` wired into the existing CLI cleanly

## What to improve

- Epic ran outside the formal DATUM pipeline (no TICKET.md, SPEC.md, TASKS.md, Properties, Triage)
- No formal closeout data collection — collectors don't exist yet
- CURRENT_STATE.md and ROADMAP.md were 10 epics behind before this closeout
- The TUI README still says `python datum-tui/app.py` instead of `datum floor`

## Follow-ups

- Build closeout collector scripts (Stage 1 of 08-closeout.md)
- Fix datum-tui README to use `datum floor` (#docs-cli-only feedback)
- Wire self-healing into gate.py try/except paths
- Fix #42: max_tokens / context_window conflation
