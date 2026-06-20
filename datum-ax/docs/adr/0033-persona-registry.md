# ADR-0033: Persona Registry — Roles + Skills, our own lean implementation

## Status

Accepted (design). Supersedes the "adopt Persona" half of GAP-LEDGER **G12**; the spike's
conclusion is recorded here.

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
