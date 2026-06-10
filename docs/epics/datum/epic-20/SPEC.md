# Spec: local_llm hardening — budget check bug + prompt_cache cross-turn reuse

**Run ID:** <!-- filled by datum -->
**Phase:** Refine
**Status:** Draft

---

## 1. Summary

Fix the `max_tokens`/`context_window` conflation bug that silently rejects all
local LLM inference when `max_tokens >= context_window`, and implement
delta-only `prompt_cache` reuse in `multi_turn_phase()` to eliminate redundant
re-prefill of the accumulated conversation history on every turn.

## 2. Context

Two issues in `datum/local_llm.py`:

**Bug (#42):** `DEFAULTS` sets both `max_tokens` and `context_window` to 131072.
`check_context_budget` computes `prompt_tokens + max_tokens > context_window` which
is always true for any non-empty prompt, causing every inference call to return
`escalated=True` with zero tokens. The intent is: `max_tokens` = max output length,
`context_window` = model's total context. These should be independent values.

**Feature (#48):** `multi_turn_phase()` re-prefills the full accumulated history
on every turn. Turn 4 processes all tokens from turns 0-3 again. With MLX's
`prompt_cache` and delta-only token passing, only the new tokens since the last
turn need prefilling. Outlines `gen(string)` doesn't expose token-level control,
so we bypass it for delta turns: tokenize the full new prompt, slice off the
already-cached prefix tokens, pass the delta array directly to `stream_generate`.

## 3. Requirements

### R1: Fix max_tokens / context_window defaults

**Description:** Change `DEFAULTS["max_tokens"]` to 8192 (sensible output cap).
Keep `DEFAULTS["context_window"]` at 131072. These are two separate concerns.
Update `check_context_budget` docstring to clarify the semantics.

**Acceptance criteria:**
- `DEFAULTS["max_tokens"]` is 8192, `DEFAULTS["context_window"]` is 131072
- `check_context_budget("hello", 8192)` returns `fits=True` on any model
- Budget check passes for a 100-token prompt + 8192 max_tokens against 131072 window
- Existing tests in test suite still pass

### R2: prompt_cache cross-turn reuse in multi_turn_phase

**Description:** Before the turn loop, create a `prompt_cache` via
`make_prompt_cache(model, max_kv_size=config.get("max_kv_size"))`. On turn 0,
prefill the full prompt normally (cache is empty, all tokens processed). After
each turn, record `_cache_offset(prompt_cache)` — the number of tokens now in
cache. On subsequent turns, tokenize the full new prompt, slice off the first
`cache_offset` tokens, and pass the delta token array directly to
`stream_generate(model, tokenizer, delta_tokens, prompt_cache=cache)`.
The synthesis turn (last turn with schema) still uses `structured()` but with
the delta tokens pre-tokenized and passed as the prompt array.

**Acceptance criteria:**
- `multi_turn_phase()` creates one `prompt_cache` before the loop
- Turn 0 passes full prompt; turns 1+ pass only delta tokens
- Cache offset is tracked and incremented correctly after each turn
- A 3-turn multi-turn run generates fewer total tokens than 3× the first turn's prompt length
- Falls back to full-prompt mode (no delta) if cache offset tracking fails

### R3: `_cache_offset` helper

**Description:** A helper `_cache_offset(cache: list) -> int` that returns the
current offset (tokens processed so far) from an MLX KVCache object list. Uses
`cache[0].offset` if available, else falls back to 0.

**Acceptance criteria:**
- `_cache_offset([])` returns 0
- `_cache_offset` on a populated cache returns a positive int
- Used in multi_turn_phase to compute the delta slice

### R4: Tests

**Acceptance criteria:**
- `test_budget_check_fix`: `check_context_budget` passes for 100-token prompt + 8192 max_output against 131072 window
- `test_budget_check_fails_when_prompt_too_large`: prompt alone exceeds window → fails
- `test_cache_offset_empty`: `_cache_offset([])` returns 0
- `test_cache_offset_populated`: mock cache with `.offset = 500` → returns 500
- `test_multi_turn_uses_prompt_cache`: mock verifies `make_prompt_cache` called once before loop
- All tests in `tests/test_local_llm_hardening.py`, min 5 tests

## 4. Failure Modes and Handling

| Failure | Handling |
|---|---|
| `cache[0]` has no `.offset` attr (old MLX version) | `_cache_offset` catches AttributeError, returns 0, falls back to full-prompt mode |
| Delta slice produces empty array (offset > new prompt length) | Detect and fall back to full prompt for that turn |
| `make_prompt_cache` raises (MLX unavailable) | Catch, log warning, proceed without cache (existing behavior) |
| Budget check: prompt alone exceeds context_window | Fail immediately, do not attempt generation |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| multi_turn prefill reduction | >= 2× fewer tokens prefilled across a 4-turn run |
| No regression on existing tests | 0 new failures |
| No new dependencies | Uses existing mlx_lm.models.cache |

## 6. Out of Scope

- Structured output (outlines) using delta tokens for synthesis turns
- Prompt cache persistence across separate `run_phase()` calls
- Cache invalidation / eviction beyond `max_kv_size` rotating buffer

## 7. Open Questions

*(none)*

## Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | `cache[0].offset` is the correct way to read MLX cache offset | Verified in mlx_lm.models.cache KVCache implementation | confirmed | n/a |
| 2 | `stream_generate` accepts raw token array as `prompt` param | mlx_lm docs + `generate_step` signature: `prompt: mx.array` | confirmed | n/a |
| 3 | Delta-only prefill is safe when cache already holds prefix | MLX KVCache appends new KV states; delta tokens attend to cached context | confirmed | n/a |
| 4 | Fixing `max_tokens` default to 8192 won't break anything | Config-driven; existing `.datum/config.toml` files already set `max_tokens = 8192` | confirmed | n/a |

## 9. Classification Metadata

```yaml
estimated_files: 3
estimated_loc: 120
clusters_touched: 1
new_public_api: false
dependency_additions: []
```
