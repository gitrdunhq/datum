# ADR-0003: oMLX Inference & Role-Based Model Registry

## Status

Accepted (design)

## Context

Inference runs on Apple Silicon via **oMLX** (user-locked). The blueprint names specific models
(`Qwen3.5-4B-OptiQ`, `Qwen3.6-35B-A3B`, DeepSeek-R1) — but those `3.5/3.6` names are unverifiable
(RESEARCH-NOTES). MLX is effectively single-process/serialized; concurrent prefill spikes unified
memory and can trigger swap. We need an inference layer that is decoupled from oMLX specifics, pins
*roles* not *names*, and protects memory.

## Decision

Wrap oMLX behind a thin **`InferenceClient`** adapter targeting a generic OpenAI/Anthropic-compatible
endpoint (ARCHITECTURE §3.2). Define **three model roles** with **configurable model IDs**:

| Role | Class (default family) | Used for |
|------|------------------------|----------|
| `TRIAGE` | small/fast (~4B; Qwen3 small) | cheap classification assisting deterministic routing |
| `EXECUTOR` | MoE (~30–35B-A3B; Qwen3 MoE) | planning + code generation |
| `ADVERSARIAL` | reasoning (DeepSeek-R1 class) | reformatting a failed attempt's stderr into the next prompt |

Controls:
- **Concurrency semaphore** (`asyncio.Semaphore`, default `max_connections=2`) around every call —
  prevents parallel-prefill memory spikes.
- **Rigid prompt prefix** `[System] + [Global AST] + [Diff]` (ADR-0004) to maximize oMLX
  prompt-cache reuse and cut time-to-first-token across the retry loop.
- Model IDs, temperatures, and context windows come from **config**, never code.

**Operational reality — the governing constraint is the active context window, not the cache.**
oMLX provides **KV cache and SSD cache natively**, so datum-ax does *not* build its own — the prompt
prefix is structured to hit oMLX's cache (above), and SSD caching helps **cold-start / TTFT**. But the
SSD cache does **not** relieve the memory pressure of a large *active* window during generation. Two
hard limits on a single Mac:
- **~80k-token throughput cliff** — past roughly 80k tokens in the window, tokens/sec degrades
  sharply.
- **OOM risk** — if memory is not reclaimed efficiently and quickly, unified memory is exhausted and
  the box OOMs.

So datum-ax treats the **in-memory window as a budgeted resource** (ADR-0013): keep each call's working
context well **below the ~80k cliff** (configurable target, e.g. ≤ ~48–64k), and reclaim memory
**eagerly** after every call (drop completed-lane contexts; prune failed attempts immediately,
ADR-0007). Because each concurrent call holds its own window, the coupling
**`max_connections × per-call window ≤ unified-memory budget`** is what actually prevents OOM — the
semaphore and the window budget must be tuned together, not independently.

## Consequences

- A wrong bet on oMLX or a model costs one adapter / one config line, not the architecture.
- The semaphore caps inference throughput; the lane scheduler (ADR-0015) must respect it as
  backpressure rather than fighting it.
- Prompt-cache benefit depends on prefix byte-stability — the prompt assembler must guarantee stable
  ordering and avoid per-call jitter in the prefix.
- KV + SSD caching is **provided by oMLX** and relied upon for TTFT/cold-start; datum-ax builds no
  cache of its own. (The fabricated papers in RESEARCH-NOTES do not change this — the feature is real
  in oMLX, the cited research was not.) The constraint datum-ax actively manages is the **active
  window size** (throughput cliff + OOM), not cache construction.
- The window budget makes pruning (ADR-0007) and the context firewall (ADR-0004) **OOM-critical**, not
  just cost optimizations — they are the mechanism that keeps the working set under the cliff.
- Tokenomics routing (ADR-0009) chooses the role; this ADR only defines the roles and the transport.
</content>
