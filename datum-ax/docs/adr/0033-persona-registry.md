# ADR-0033: Persona Registry — Roles + Skills, our own lean implementation

## Status

Accepted (design). Supersedes the "adopt Persona" half of GAP-LEDGER **G12**; the spike's
conclusion is recorded here.

> **Refined by ADR-0034:** the "selection must be deterministic / semantic match is optional, kept
> out of the core path" framing below is relaxed — semantic RAG is a **default-grade** selection tier
> (deterministic given a pinned model), with LLM escalation allowed for ambiguous cases. Only the
> review gate stays hard-deterministic.

**As-built:** implemented end-to-end. `Role`/`Skill`/`PersonaRegistry` live in `contracts/persona.py`;
`FilePersonaRegistry` (markdown + YAML frontmatter, registered in `PERSONA_REGISTRIES`) in
`data/persona/`; `ContextCrane.compose_system(role_id, scope_tags)` composes the `[System]` prefix and
replaced the `BASE_PERSONA & SKILL_PERSONA_HERE` stub. `prompts/*.md` were migrated to packaged
`datum_ax/personas/roles/{triage,lane-plan,red,green}.md`, and triage/lane_plan/synthesis now source
their prompt from the registry via the injected crane (they require a crane when calling a model).
The GitNexus code-intelligence suite + bug-hunt (7 skills) were imported from the datum skill library
into packaged `datum_ax/personas/skills/*.md`, tagged by **purpose** — `planning` (exploring,
impact-analysis) vs `troubleshooting` (debugging, bug-hunt). The crane lifts skills **only when the
task needs them**: the PLANNER (a planning task) lifts the `planning` skills into its prefix; a
routine GREEN/implementation lane lifts **no** gitnexus at all. A **failed synthesis attempt is a
troubleshooting task** — on retry the crane lifts `troubleshooting` skills (gitnexus-debugging /
-bug-hunt) into the **variable suffix slot** (once), keeping the `[System]` prefix cache-stable via
`crane.lift_skills(...)`. Lifting on a triage `hotfix` route from the first attempt is a possible
later refinement.

A **`BASE_PERSONA.md`** (the foundational "critical collaborator" voice + multi-agent/MCP protocols)
ships in the packaged registry root; `registry.base_persona()` is prepended to every composed system
prompt. Four **distilled domain Skills** (swift-clean-architecture, aws-infrastructure-engineer,
web-cloudflare-engineer, agentic-research-workflow) were imported into `personas/skills/`, tagged by
domain for selection. Skill artifacts are grouped in organizational subfolders
(`skills/code-intelligence/`, `skills/domain/`) — the loader recurses (`rglob`), so the folder is
cosmetic; the filename-stem id and `scope_tags` drive resolution. Their large source corpus and a
prototype **semantic** matcher
(`retriever.py`, sentence-transformers over name+description) live in non-packaged
`persona-sources/`; the matcher is the seed for the optional, cognition-side semantic selection
adapter — kept out of the deterministic core path by design.

## Context

`ContextCrane.pack_payload` composes the cache-stable `[System]` prefix from a hardcoded stub:

```python
system = f"BASE_PERSONA & SKILL_PERSONA_HERE\n\n{self.hoist_docs(libs)}"
```

The persona/skill content is the only un-formalized part of the firewall: the crane already does
hoist → assemble → prune → budget around it (ADR-0030/0004/0021/0022). The pieces a real persona
layer needs already exist but are not unified — **Roles** as bare `prompts/*.md` (no metadata),
role→model identity in `ModelRoleRegistry` (ADR-0003), the generic `Registry` (ADR-0032), and
ADR-0020's intended rules registry. `JasperHG90/persona` formalizes exactly this shape (decoupled
Roles + Skills as markdown artifacts, pulled just-in-time), so it was worth evaluating as a drop-in.

## Decision

**Build our own lean `PersonaRegistry` behind a port; do not adopt the Persona package.** Borrow its
*ideas* (markdown + YAML frontmatter as the portable artifact format, versioning/attribution,
just-in-time pull), keep its file format close enough to import later, and reuse what we already own.

Rationale (build vs adopt):
- **Footprint.** Persona ships Parquet storage, embeddings, a Textual TUI, an MCP server, and a CLI.
  We need typed Role/Skill artifacts resolved into the crane prefix — a small fraction of that.
- **Determinism boundary (ADR-0006/0009).** Persona's `roles match` is embedding-based and
  non-deterministic. Our gates are zero-LLM; selection must be **deterministic by default**
  (by id / `scope_tags`), with any semantic match an opt-in *cognition-side* adapter, never
  load-bearing in a gate.
- **Single source of truth (ADR-0030/0032).** Adopting Persona would stand up a second registry
  concept beside our `Registry`, `ModelRoleRegistry`, and rules registry. One registry abstraction.
- **Strong typing.** We want frozen Pydantic `Contract` shapes at the boundary; Persona has its own
  API surface we'd have to wrap regardless.

### Shapes (frozen Pydantic `Contract`s, in `contracts/`)

- **`Role`** — *who the AI is* for a step: `id`, `name`, `description`, `model_role: ModelRole`,
  `body` (the system-prompt markdown), `version: int`, `scope_tags: tuple[str, ...]`.
- **`Skill`** — *what it can do*: `id`, `name`, `description`, `instructions` (markdown),
  `tool_refs: tuple[str, ...]` (optional command/tool names), `version: int`,
  `scope_tags: tuple[str, ...]`.

Artifacts on disk are markdown with YAML frontmatter (Persona-compatible): the **filename stem is the
canonical `id`** (filesystem-native, and immune to YAML scalar coercion — an unquoted `true`/`1` in
frontmatter would otherwise become a bool/int key); frontmatter carries the remaining fields and the
body becomes `body`/`instructions`. `prompts/*.md` migrate into this format.

### Port (`contracts/persona.py`, a `runtime_checkable` Protocol)

```
class PersonaRegistry(Protocol):
    def get_role(self, role_id: str) -> Role: ...
    def role_for(self, model_role: ModelRole) -> Role: ...          # deterministic resolution
    def get_skill(self, skill_id: str) -> Skill: ...
    def select_skills(self, scope_tags: tuple[str, ...]) -> tuple[Skill, ...]: ...  # tag match, deterministic
```

A semantic `match_role(query)` is **out of scope** for the deterministic core; if added later it
lives in a separate cognition-side adapter and is advisory only.

### Adapter + wiring

- `data/persona/file_registry.py` → `FilePersonaRegistry`: loads markdown+frontmatter from a
  `personas/` tree; no embeddings. Registered in the existing plugin `Registry` so the backend is
  itself swappable (file now, remote later — same pattern as `REVIEW_GATES`).
- `presentation/composition.py` → `build_persona_registry(...)` factory; injected via
  `config['configurable']` like every other dependency (ADR-0026).
- **Crane integration:** `pack_payload` replaces the stub — the resolved `Role.body` (+ any global
  Skills) go in the **stable `[System]` prefix** (prompt-cache friendly); **lane-specific Skills**
  selected by `scope_tags` go in the **variable suffix slot** (ADR-0020 cache discipline). The crane
  still owns budget/prune; persona content is just another hoisted input.

## Consequences

- The `BASE_PERSONA & SKILL_PERSONA_HERE` placeholder becomes a real, versioned, swappable lookup;
  Roles/Skills are inspectable markdown, not strings buried in code.
- Backs ADR-0020: harvested rules can be delivered as versioned Skills selected by scope.
- Deterministic selection keeps personas out of the trust/determinism-sensitive path; embeddings stay
  optional and cognition-side.
- Persona-compatible file format preserves the option to import an external registry later without a
  rewrite.
- **Build order (dogfooded, contract-first):** shapes → port → `FilePersonaRegistry` adapter +
  conformance suite → crane integration → migrate `prompts/*.md`. RED-first per WORKFLOW.
