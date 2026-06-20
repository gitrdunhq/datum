# WORKFLOW — how we build datum-ax (dogfood the pipeline)

We build datum-ax using datum-ax's own discipline. Every change — especially each gap-ledger climb —
runs through the same phases the pipeline runs. No ad-hoc edits to behavior.

## The loop (per piece of work)

1. **INTAKE → TICKET.** Frame the work as a ticket with a scale call (task / epic / initiative,
   ADR-0025). Lives at `docs/initiatives/<initiative>/epics/<epic>/TICKET.md` with a Classification
   block. Dual artifact: Markdown for humans, JSON when a machine consumes it (ADR-0027).
2. **PLAN → lane-plan.** `lane-plan.md`: disjoint-file lanes, contract-first order, waves; sized to
   the context budget (ADR-0010/0012/0022). Same-wave lanes never share a file.
3. **PROPERTIES.** Name the invariants the change must hold, mapped to DPS-12 domains
   (SAFETY/LIVENESS/INVARIANT/PERFORMANCE — ADR-0016).
4. **RED.** Write the failing tests first (Hypothesis property tests at boundaries; integration tests
   for behavior). Watch them fail. The test agent never sees the implementation.
5. **GREEN.** Minimum code to pass. **Strongly typed always** (strict/frozen Pydantic, enums for
   state). **Three tiers, hard boundaries** — `core` never imports `data`; deps injected via
   `contracts` (ADR-0026). **Single source of truth** — no second way to do a thing (ADR-0030).
6. **GATES.** `uv run pytest` fully green, including `test_architecture.py` (the import-boundary
   guard). Lint/format clean. (eedom gate runs here once wired — ADR-0006.)
7. **CLOSEOUT.** Update the **GAP-LEDGER** row, `CURRENT_STATE.md`, and any ADR (amend in place for
   extensions/clarifications; **new ADR** for a changed decision, marking the old `Superseded by`).
   Commit with a conventional prefix; push; **leave the tree clean** (runtime junk is gitignored).

## Standing rules

- **ADRs are the north star (aspirational); code is the MVP.** Iterate the code *up*; don't downgrade
  ADRs. Track the delta in `docs/initiatives/integration-sweep/GAP-LEDGER.md`.
- **Ports & adapters everywhere (ADR-0032).** Every external/swappable dependency = a
  `runtime_checkable` Protocol port in `contracts` + typed Pydantic shapes + a `build_*(url)` factory in
  the composition root; `core` depends only on ports; each port has a conformance suite over its
  adapters. Introducing an external dependency means defining its port + shapes + factory first.
- **Dual artifacts**, JSON canonical for machines; a wrong handoff fails schema validation (ADR-0027).
- **Tokenomics**: spend effort proportional to the work; keep the window curated (crane, ADR-0030).
- **Commit prefixes** (release-please style): `feat:` user-facing capability · `fix:` correction ·
  `docs:`/`chore:`/`refactor:` no user-facing change.

## Safety net (instead of GitNexus)

`datum-ax/` is **not** in the GitNexus index (that indexes the parent `datum` project). So in lieu of
`gitnexus_impact`, the **import-boundary test + the full Hypothesis suite** are the blast-radius check:
run `uv run pytest` before every commit and confirm green + boundary intact.
</content>
