# Questions — AIDLC-Inspired Pipeline Enhancements

## Refine — 2026-05-27

### Q1: [Architecture] Should the complexity classifier be a Python CLI command or SKILL.md prose logic?
> DATUM's core philosophy is "determinism is paramount" — state management and routing are 100% deterministic Python, not LLM decisions. The classifier decides which pipeline shape to use, which is a routing decision.

[Answer]: Python CLI command (`datum classify`). This is a routing decision, not a creative one. It reads file counts, cluster spread, and API surface — all measurable inputs. Making it a CLI command means it's testable, reproducible, and not subject to LLM mood swings.

### Q2: [Architecture] Should units live inside tasks.json or in a separate units.json?
> The ticket proposes extending tasks.json with a `units` top-level key. Alternative: keep tasks.json focused on individual tasks and put unit groupings in a separate units.json that references task IDs.

[Answer]: Extend tasks.json. Units are metadata about tasks, not independent entities. A separate file creates a synchronization problem — tasks.json and units.json can drift. Keeping them together means one schema, one validation pass, one source of truth.

### Q3: [Scope] Should LANDSCAPE.md regeneration be automatic or manual?
> The ticket says "regenerate when GitNexus index SHA changes." This could be checked automatically at Discovery time, or the user could run `datum landscape` manually.

[Answer]: Automatic at Discovery time with a staleness check. If the GitNexus index SHA matches the last LANDSCAPE.md generation, skip. If it changed, regenerate. Also support `datum landscape` for manual trigger.

### Q4: [Gate behavior] Should unanswered QUESTIONS.md entries block the gate or warn?
> Questions represent ambiguity. Blocking means the pipeline can't proceed with unknowns. Warning means the agent made a judgment call and moved on.

[Answer]: Block. The whole point of idea #5 is to make ambiguity visible and force resolution. If unanswered questions don't block, they're just comments. The agent can propose answers (as I'm doing here), but the human must confirm or override before the gate opens.

### Q5: [Scope] Should adaptive depth affect Review phase, or just Plan/Act?
> The ticket says System-tier gets "extended review." But what does that mean concretely? More review dimensions? Mandatory architecture review? Additional reviewers?

[Answer]: System-tier adds mandatory architecture review (the `architect` sidecar from 03.5-architect.md) and requires all quality profile dimensions. Patch-tier skips Properties and uses lightweight review (correctness only, no architecture). Feature-tier is unchanged.
