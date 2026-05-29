# Session Walkthrough — 2026-05-28

## Summary of Changes

Four epics shipped in one session, all driven by issue #45 as the initial seed.
The session evolved from a single walkthrough feature into a broad local LLM
pipeline hardening + model upgrade pass.

## Implementation Lanes (by epic)

### Epic-19: datum walkthrough + local LLM pipeline hardening
- `datum walkthrough` command — generates `WALKTHROUGH.md` post-mortem artifact
  from SPEC, TASKS, and git diff using `run_phase("sidecar_docs", schema=WalkthroughSummary)`
- `WalkthroughSummary` Pydantic schema for grammar-constrained walkthrough output
- `templates/WALKTHROUGH.md` template with all required sections
- Two-tier model routing: `fast_model` (Llama-3.1-8B) for triage/validate,
  `model` (Qwen3-30B-A3B-8bit) for act/sidecar phases
- KV cache: `kv_bits=8` quantization + `max_kv_size` rotating buffer via both
  `stream_generate` and outlines `gen()` kwargs
- `hf_cache_dir` config option — datum sets `HF_HUB_CACHE` at load time
- Bug fixes from code review: `result["content"]` → `result["text"]` key,
  inverted `git diff` returncode, lazy import in cli.py
- 13 new tests

### Epic-20: local_llm budget check bug + prompt_cache
- Fixed `DEFAULTS["max_tokens"]` 131072 → 8192 (was equal to context_window,
  causing every budget check to reject all prompts)
- `_cache_offset(cache)` helper reads MLX KVCache.offset safely
- `multi_turn_phase()` now creates one `prompt_cache` before the turn loop
  and threads it through `structured`/`two_pass`/`vote` calls — MLX accumulates
  KV state across turns instead of starting cold each turn
- 6 new tests

### Epic-21: TriageDecision Pydantic schema (Qwen3-30B-A3B-8bit)
- `datum/models/triage_decision_schema.py` — `TriageDecision(BaseModel)` with
  `decision: Literal["deepen", "properties"]` and `reason: str`
- First real code generated entirely by Qwen3-30B-A3B-8bit (RED: 27.6s, GREEN: 11.3s)
- 4 new tests

### Epic-22: gate.py hardening (Qwen3-30B-A3B-8bit)
- `check_questions_answered` peek-ahead: multi-line answers no longer false-flagged
  as empty — looks at next non-empty, non-header line after `[Answer]:`
- `_contracts()` call sites use named unpacking (`validate_payload, validate_value`)
  instead of opaque `[0]`/`[1]` index access
- Qwen3 RED: 34.8s, GREEN: 113s — both without escalation
- 4 new tests

## Files Touched

**New files:** `datum/walkthrough.py`, `datum/models/walkthrough_schema.py`,
`datum/models/triage_decision_schema.py`, `templates/WALKTHROUGH.md`,
`assets/schemas/task.schema.json`, `assets/schemas/tasks.schema.json`,
`tests/test_walkthrough.py`, `tests/test_model_tiers.py`,
`tests/test_local_llm_hardening.py`, `tests/test_triage_schema.py`,
`tests/test_gate_fixes.py`

**Modified:** `datum/local_llm.py`, `datum/cli.py`, `datum/gate.py`

## Key Decisions

- Dropped 79B model (Qwen3-Coder-Next) — timed out on initialization for pipeline phases
- Settled on Qwen3-30B-A3B-8bit as quality model (~30 GB, ~35 t/s on M4 Pro 64 GB)
- KV cache: kv_bits=8 reduces cache memory ~50%; max_kv_size=32768 prevents OOM
- `prompt_cache` cross-turn reuse deferred (#48) — needs token-level delta tracking
  below outlines string interface (filed as separate issue)
- oMLX (jundot/omlx) identified as next major backend: persistent serving,
  SSD KV cache, xgrammar constraints — filed as epic-23

## Excluded from Scope

- oMLX backend integration (epic-23, next session)
- `datum closeout` CLI command (AC4 from epic-19, tracked as #47)
- TriageDecision schema in live triage gate.py (AGENTS.md pattern updated only)

## Issues Closed

#42 (max_tokens bug), #45 (walkthrough), #46 (TriageDecision schema),
#22 (_contracts naming), #24 (multi-line answers)

## Issues Filed

#46 (TriageDecision — now closed), #47 (closeout integration), #48 (prompt_cache delta),
#49 (oMLX backend — to be filed)
