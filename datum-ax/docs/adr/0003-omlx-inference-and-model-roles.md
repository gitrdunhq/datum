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

## Consequences

- A wrong bet on oMLX or a model costs one adapter / one config line, not the architecture.
- The semaphore caps inference throughput; the lane scheduler (ADR-0015) must respect it as
  backpressure rather than fighting it.
- Prompt-cache benefit depends on prefix byte-stability — the prompt assembler must guarantee stable
  ordering and avoid per-call jitter in the prefix.
- Two-tier RAM+SSD KV cache is **not** relied upon (fabricated sources; RESEARCH-NOTES). Prefix
  caching is the verified mechanism.
- Tokenomics routing (ADR-0009) chooses the role; this ADR only defines the roles and the transport.
</content>
