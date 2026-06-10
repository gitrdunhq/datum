# oMLX inference backend for datum local LLM pipeline

**Issue:** new — epic-24

datum/local_llm.py calls mlx_lm directly: cold model load on every
pipeline run, no KV cache persistence across phases, both models resident
in memory simultaneously.

oMLX (jundot/omlx, Apache 2.0) is a persistent MLX inference server:
- Persistent model loading (no cold start between phases)
- SSD KV cache overflow (no max_kv_size hard eviction, full 262K context)
- LRU multi-model management (pin Llama-8B, Qwen3-30B loaded on demand)
- xgrammar grammar-constrained generation (replaces outlines)
- OpenAI-compatible API

Integration: detect oMLX via /health, route generate() and structured()
through HTTP, fall back to direct mlx_lm if server is down.
