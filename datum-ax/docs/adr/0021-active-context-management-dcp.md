# ADR-0021: Active Context Management (Dynamic Context Pruning)

## Status

Accepted (design)

## Context

The ~80k-token window (ADR-0003) is **generous if every character is controlled** — it is a problem
only when filled with noise. The context firewall (ADR-0004) controls what goes *in* (exact Serena
slices, Headroom-compressed NL, relevance-scoped rules). But during the verification loop the window
also *accumulates*: test logs, stderr, file reads, sandbox artifacts, prior eedom findings. Without
active management the window drifts toward the throughput cliff and OOM even though most of that
accumulated text is stale.

**Dynamic Context Pruning (DCP)** is an established pattern for exactly this, with real reference
implementations for coding agents (`PSU3D0/pi-dcp`, `p4r4d0xb0x/opencode-dcp`; cf. SWE-Pruner as
task-aware middleware). Reported token reductions (50–70%) are treated as marketing, not fact — the
*mechanism* is what we adopt.

## Decision

Adopt **DCP-style active context management** as a layer over the message array, behind a small
internal interface (so we do not hard-depend on any one plugin):

- **Targets:** stale / duplicate / oversized **tool outputs** (test & lint logs, file reads, sandbox
  artifacts, superseded eedom findings) — the bulky, low-residual-value content.
- **Placeholder substitution, not deletion:** pruned content is replaced with a **compact placeholder**
  recording *what / why / when*, and the original is kept **out-of-band** (libSQL ledger / artifact
  store, ADR-0005/0013), **retrievable on demand**. Pruning is therefore lossless to the run record,
  lossy only to the live window.
- **Two triggers:**
  1. **Automatic** — age / size / duplication thresholds, and proactively on **window-budget
     pressure** (ADR-0013).
  2. **Agent-invokable** — a `prune` / `compress` tool the executor can call when it knows it is done
     with an output.
- **Cache-safe:** pruning operates only on the **variable suffix**, never the stable
  `[System] + [Global AST] + [Diff]` prefix (ADR-0003/0004), so oMLX's prompt cache stays warm.

**Relationship to existing pruning (ADR-0007):**
- `RemoveMessage` **hard-deletes** *failed attempts* (they have no residual value once reformatted).
- **DCP placeholders** keep *retrievable summaries* of bulky-but-possibly-needed outputs.
- Both run; they are complementary, not alternatives.

**Guardrails:** never prune active essentials — the current Task Packet, the lane's contract /
PROPERTIES, or the in-flight error being reformatted. Every prune is recorded in the ledger with a
retrieval key.

## Consequences

- The window stays comfortably inside 80k as the loop runs, so "80k is generous" holds in practice —
  curation (firewall) + active management (DCP) keep signal-to-noise high.
- Retrievable placeholders avoid the classic pruning failure mode (dropping something still needed):
  the model can ask for the original back.
- This is the concrete enforcement arm of the context-window budget (ADR-0013) and a memory-safety
  mechanism (OOM avoidance), not merely a cost optimization.
- New surface: a pruning interface + the `prune`/`compress` tool + retrieval path. Kept behind an
  interface so a real plugin (pi-dcp/opencode-dcp style) or a bespoke implementation can back it.
- Property-test targets: Availability (a pruned item is always retrievable), Integrity (active
  essentials are never pruned), Boundedness (live window stays under budget).
</content>
