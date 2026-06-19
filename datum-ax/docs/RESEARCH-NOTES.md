# Research Notes — Verified-vs-Fabricated Ledger

This deliverable was researched with a three-stage pipeline (the cloud mirror of datum-ax's own
runtime model tiers):

- **Collect (Haiku ×3):** parallel web research on LangGraph, Apple-Silicon inference, and the
  data/sandbox/context stack.
- **Sanitize (Sonnet):** adversarial fact-check — flag future-dated arXiv IDs, suspiciously precise
  stats, content-farm sourcing, and speculative product/model names.
- **Distill (Opus):** this ledger + the architecture.

The point of this file: **future readers must know which blueprint claims are load-bearing fact and
which were rejected.** Do not silently "restore" a rejected claim without re-verifying it against a
primary source.

## VERIFIED — safe to build on (primary sources)

| Claim | Notes |
|-------|-------|
| **LangGraph** `StateGraph`, nodes return partial-state updates, `add_conditional_edges`, reducers, `.compile(checkpointer=)` | Core, stable API. |
| **LangGraph subgraphs** (compiled graph as a node; checkpointing namespaced per level) | Used for the Triage/Planner and Verification sub-graphs. |
| **Checkpointers**: `MemorySaver`, `SqliteSaver`, `PostgresSaver`; `RedisSaver` via the separate `langgraph-redis` package | Treat `langgraph-redis` as a community/partner package — pin a version. |
| **`interrupt()` / `Command(resume=...)`** for human-in-the-loop | **Load-bearing invariant:** on resume the node **re-executes from its start** → side effects before `interrupt()` re-run. Must be idempotent or placed after the interrupt. |
| **`RemoveMessage(id=...)`** with the `add_messages` reducer; `trim_messages()` | The pruning primitive for the verification loop. |
| **Retry loops**: `retry_count` in state + conditional edge back to a node; `recursion_limit`; `RetryPolicy` | The 3-attempt cap mechanism. |
| **MLX / mlx-lm**: `--max-kv-size`, `mlx_lm.cache_prompt()` prompt caching | Apple-maintained. Prefix caching yields large TTFT reductions on shared system prompts. |
| **Unified memory** (Apple Silicon single physical pool; zero-copy) | Hardware fact, not vendor claim. |
| **MLX concurrency** — effectively single-process/serialized; FIFO/semaphore is the correct pattern | Justifies `max_connections` throttling. |
| **Valkey** — BSD Linux-Foundation fork of Redis 7.2.4, wire-compatible, port 6379 | Drop-in for any Redis-protocol client, incl. `RedisSaver`. |
| **libSQL / sqld** — Turso's SQLite fork; `:memory:` and SQLite Backup API for isolation | Standard `.db` format. |
| **Serena MCP** (`oraios/serena`) — LSP-backed symbol navigation | `find_symbol`, `find_referencing_symbols`, language-agnostic. |
| **Context7 MCP** (Upstash) — version-specific library docs | `resolve-library-id`, `get-library-docs`. |
| **Tart** (Cirrus Labs) — Apple `Virtualization.framework` VMs | Correct fit for the optional macOS sandbox. |
| **Dynamic Context Pruning (DCP)** — prune stale/duplicate/oversized tool outputs to retrievable placeholders | Real coding-agent implementations: `PSU3D0/pi-dcp`, `p4r4d0xb0x/opencode-dcp`; SWE-Pruner as research middleware. Adopted as a pattern (ADR-0021). **Skeptic note:** "50–70% token reduction" blog stats are marketing, not independently verified — the mechanism is what we rely on, not the numbers. |
| **Qwen3** (April 2025) — MoE variants with A3B (≈3B active) | Use the official Qwen HF org for specs. |
| **DeepSeek-R1** — RL-trained reasoning model, `arXiv:2501.12948` | Real; the "adversarial reasoner" role's reference class. |

## FABRICATED / DISCARDED — do **not** present as fact

| Claim | Why rejected |
|-------|-------------|
| **"KVDrive" `arXiv:2605.18071`**, **"HiveMind" `arXiv:2604.17111`** | arXiv IDs encode `YYMM`; these are **future-dated** → fabricated. Cited only in support of unverifiable two-tier-KV claims. |
| **Qwen3.5 / Qwen3.6 "2026 releases"** (397B-A17B, 122B-A10B, "thinking preservation", "OptiQ") | Unverifiable; naming inconsistent with Alibaba's pattern. Only **Qwen3 (Apr 2025)** is confirmed. **Do not pin model architecture to these names.** |
| **Specific oMLX GitHub star counts / "TTFT 30–90s → 1–3s" numbers** | Suspiciously precise, single-source, content-farm flavor. |
| **Context7 "benchmark 84.49 / Trust Score 9.5"** | Marketing-style scores, no independent eval. |
| ~~Two-tier KV cache (RAM+SSD) as a relied-upon feature~~ — **superseded** | The *papers* cited (KVDrive/HiveMind) remain fabricated. But per the user, **oMLX provides KV + SSD cache natively**, so datum-ax relies on oMLX's built-in cache for TTFT/cold-start (ADR-0003). The fabricated citations do not make the oMLX feature unreal — they were just bogus support for it. |

## USER-MANDATED — treated as ground truth even where independent verification was weak

The user locked these in as required components. The design wraps each in a **thin adapter** so
datum-ax does not hard-couple to any one tool's API, but they are **required**, not optional:

| Tool | Role in datum-ax | Verification note |
|------|------------------|-------------------|
| **oMLX** | Apple-Silicon inference runtime (OpenAI/Anthropic-compatible serving of the role models); provides built-in KV + SSD cache | Independent web verification was inconclusive; accepted as the user's runtime. Adapter targets a generic OpenAI-compatible endpoint so the design survives if oMLX is swapped. |

**Operational constraints (user-provided, treated as ground truth — drive ADR-0003/0013):**
- oMLX has **built-in KV cache and SSD cache** → datum-ax builds no cache of its own (SSD cache helps
  cold-start / TTFT).
- **~80k-token throughput cliff:** past ≈80k tokens in the window, tokens/sec degrades sharply.
- **OOM risk:** without efficient, *fast* memory reclamation, a single Mac exhausts unified memory and
  OOMs. ⇒ the active window is a budgeted resource; `max_connections × per-call window ≤ memory`.
| **Serena** | Lossless LSP/AST symbol retrieval (code channel) | Verified (`oraios/serena`). |
| **TokenSave** | Token-efficient, standardized, language-agnostic repo metadata (code channel) | Accepted as user-mandated; adapter contract defined in ADR-0004. |
| **Context7** | Version-specific external library/API docs (NL channel) | Verified (Upstash). |
| **Headroom.ai** | Semantic compression of the **NL channel only** (never code/AST) | Independent verification weak; accepted as user-mandated. Adapter is the single sanctioned compression point; isolating it behind an interface contains the risk. |

## Standing rules for anyone editing the docs

1. A claim moves from this ledger's "discarded" column into the architecture **only** with a fresh
   primary-source citation.
2. Model **roles** are load-bearing; specific model **IDs** are configuration. Never wire the design
   to a speculative model name.
3. The locked-in tools are required, but every reference goes **through its adapter contract** — no
   tool-specific API leaks into the orchestration logic.
</content>
