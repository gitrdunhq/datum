# persona-sources (not packaged)

Source material and prototypes behind the packaged PersonaRegistry (ADR-0033). **Nothing here ships
in the wheel or is loaded by the registry** — the registry reads `src/datum_ax/personas/`.

- `raw/` — the large unstructured corpus the distilled domain Skills were distilled *from*. Kept for
  provenance and re-distillation; far too big to inject.
- `retriever.py` — a prototype semantic matcher (sentence-transformers embeddings over a skill's
  name+description) that returns `BASE_PERSONA + best-match skill + ticket`. This is the seed for the
  **optional, cognition-side** semantic `match_role`/`match_skill` adapter noted in ADR-0033 —
  deliberately *not* in the deterministic core path. Promote it to `data/persona/` behind the
  `PersonaRegistry` port when we wire semantic selection.

Distillation flow: `raw/*.md` → distilled domain Skills → `src/datum_ax/personas/skills/*.md`.
