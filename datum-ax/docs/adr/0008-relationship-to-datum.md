# ADR-0008: Relationship to `datum` (Borrowed vs Net-New vs Fixed)

## Status

Accepted (design)

## Context

datum-ax is a *variant inspired by* datum, not an evolution or replacement of it. datum is treated as
inspiration. A code review of datum (file-and-line evidence) found genuinely strong safety primitives
worth lifting and several structural flaws worth not inheriting. This ADR records the boundary so
future contributors know provenance.

## Decision

### Lift directly (proven; evidenced in review)
| Primitive | datum source |
|-----------|--------------|
| Lane DAG + file ownership (datum: worktrees; datum-ax: disjoint-file waves + containers, ADR-0012) | lane plan + worktree setup |
| Mandatory TDD RED→GREEN→REFACTOR gates | `datum-tdd-act-lane` |
| Model escalation ladder | `local_llm.py` |
| Command allowlist + metacharacter rejection | `command_guard.py` |
| Observation sanitizer (`strip_secrets` + invisible-unicode/special-token stripping) | `agent_loop.py` |
| Rules-salting with tamper detection | `agent_loop.py` |
| Subprocess resource limits (`setrlimit` mem/FD + timeouts) | `lane_tools_runner.py` |
| Loop/repetition detection (n-gram + tool-signature) | `local_llm.py`, `agent_loop.py` |

### Net-new
LangGraph state machine + Valkey checkpointer; asymmetric multi-host execution; the context firewall;
the explicit 3-attempt prune + adversarial loop; eedom as the deterministic review gate; tokenomics
model routing with metering.

### Datum flaws explicitly fixed
| Flaw (evidence) | Fix |
|-----------------|-----|
| Tri-source state drift: `state.db` + `state.json` + agent-written `pipeline-state.json`, no atomic boundary | One authoritative store per tier, no LLM-mediated writes (ADR-0005) |
| Advisory lint gates that warn but write the file anyway | **Blocking** discipline gates (ADR-0010) |
| In-process `delegate_task` subagent (shares process/env/secrets) | Isolated `ExecutionHost` (ADR-0001, ADR-0011) |
| Stringly-typed TS↔Python `agent("…")` seam with silent fallback defaults | Pure-Python typed contracts (no TS layer) |
| Late 80%-threshold compaction (can overflow first) | Proactive per-attempt pruning (ADR-0007) |
| Env inheritance into tools (`HF_HUB_CACHE` etc.) | Secrets/env never cross into sandboxes (ADR-0011) |

## Consequences

- datum and datum-ax stay independent; nothing here modifies datum.
- The lifted primitives are Python and port cleanly into the orchestrator.
- Migration target is a standalone repo (`gitrdunhq/datum-ax`); this directory is structured for that.
</content>
