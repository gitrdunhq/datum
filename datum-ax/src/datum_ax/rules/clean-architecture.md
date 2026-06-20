---
kind: discipline
tier: auto_bind
scope_tags: [universal, code, architecture]
evidence_refs: [ADR-0026, BASE_PERSONA]
version: 1
---
Enforce layered (clean) architecture, regardless of language:

- **Dependencies point inward only.** Outer layers may import inner layers, never the reverse.
- **Presentation never imports Infrastructure; Business never imports Infrastructure;** the innermost
  layer (Domain / Foundation) imports nothing project-specific.
- **Cross layers through interfaces/protocols (ports)**, injected at a composition root — concrete
  adapters are wired at the edge, not reached into from the core.
- **Consumer-first ordering:** a module is not ready to be written until the file that imports it
  exists and is verified. Write the consumer/contract first.
- **Small, single-purpose files.** Split a file when it outgrows its layer's responsibility rather
  than letting it sprawl.
- Build one **thin vertical slice** end-to-end before expanding horizontally.
