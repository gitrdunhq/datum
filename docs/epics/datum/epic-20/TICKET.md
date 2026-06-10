# local_llm hardening: budget check bug + prompt_cache cross-turn reuse

**Issues:** #42, #48

---

## Issue #42 — max_tokens / context_window conflation (bug)

`max_tokens = 131072` in config causes every inference call to return empty
because `check_context_budget` computes `prompt_tokens + max_tokens > context_window`
which is always true when both equal 131072. The fix: separate the two concerns —
`max_tokens` is max OUTPUT tokens (default 8192), `context_window` is the model's
full context (default 131072). Budget check should be `prompt_tokens + max_tokens <= context_window`.

## Issue #48 — prompt_cache cross-turn reuse in multi_turn_phase

Currently each turn in `multi_turn_phase()` re-prefills the full accumulated
conversation history from scratch. With `prompt_cache`, only delta tokens (new
content since the last turn) need prefilling — estimated 3× reduction in prefill
work for a 5-turn pipeline.

The blocker: outlines `gen(prompt_string)` tokenizes the full string on every call.
For delta-only prefill, we need to:
1. Tokenize the full accumulated prompt, track the token boundary after each turn
2. Pass only delta tokens to the model directly (bypassing outlines' string tokenization)
3. Thread the `prompt_cache` object across turns

Approach: after each structured turn, extract the token count from the cache offset.
On the next turn, tokenize the full new prompt, slice off the first N cached tokens,
pass the delta array directly to `stream_generate` (which accepts raw token arrays
as `prompt`). The structured output for the final synthesis turn can still use outlines
on the delta only.
