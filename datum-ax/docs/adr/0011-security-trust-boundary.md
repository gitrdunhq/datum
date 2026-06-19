# ADR-0011: Security & Trust Boundary

## Status

Accepted (design)

## Context

datum-ax runs **model-generated code** and ingests **untrusted text** (GitHub issue/PR bodies, repo
contents, Context7 docs) straight into prompts. That is two attack surfaces: sandbox escape /
exfiltration, and prompt injection. datum already has strong primitives here — we lift them and close
its remaining gaps.

## Decision

**Trust boundary = the orchestrator/sandbox line (ADR-0001, ADR-0012).**

- **Secret isolation.** All credentials (GitHub token, oMLX, host SSH, registry creds) live on the
  orchestrator only. Sandboxes receive a diff and return results; **no credentials and no orchestrator
  env cross the boundary** — explicitly fixing datum's `HF_HUB_CACHE`/env inheritance into tools.
- **Sandbox confinement.** Ephemeral, per-task, **egress allowlist only** (Context7/registries are
  reached from the orchestrator side or via an explicit allowlist), `setrlimit` caps + timeouts
  (lifted from datum), torn down on completion or crash (ADR-0014).
- **Untrusted text = data, never instructions.** All externally sourced text is fenced in the prompt
  using datum's **rules-salting** pattern (random-salted tags with tamper detection) and never placed
  where it can act as system/instruction content (ADR-0004 owns the assembler rule).
- **Reuse datum's defenses:** command allowlist + metacharacter rejection (`command_guard.py`), and
  the **observation sanitizer** (`strip_secrets` + invisible-unicode/special-token stripping) on every
  tool result before the model sees it.
- **Upgrade datum's gaps:** advisory lint → **blocking** (ADR-0010); in-process `delegate_task`
  subagent → **isolated `ExecutionHost`**.
- **eedom as second line.** eedom's secret-scanning + policy gate run before any push (ADR-0006), so
  even a leaked secret or risky dependency is caught deterministically pre-push.

## Consequences

- A compromised or runaway generation can corrupt only a disposable sandbox — not secrets, not the
  authoritative worktree, not the host.
- Egress allowlisting may complicate sandboxes that legitimately need network (e.g. dependency
  install); those flows are explicit and reviewed, not implicit.
- Prompt-injection defense is layered (fencing + sanitizer + deterministic eedom gate), not reliant on
  any single mechanism.
- Property-test targets (eedom's taxonomy): Confidentiality (secrets never leak to sandbox/output),
  Isolation (parallel sandboxes never interfere), Integrity (untrusted text never escalates to
  instruction).
</content>
