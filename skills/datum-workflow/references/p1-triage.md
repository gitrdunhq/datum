# Pre-Dev Phase: Triage (Roadmap Governance)

**Goal:** Receive a raw user idea or business request and slot it onto the strategic roadmap. This phase actively governs `docs/ROADMAP.md`, constantly optimizing the best path forward based on current events and prerequisite leap-risk.

## Context
You are entering the Product Pipeline (Pre-Dev). The engineering lanes do not exist here. No code should be written. Your primary job is Roadmap Sequencing.

## Process
1. **Analyze the Request:** Determine if this is a bug, a platform refactor, a missing workflow, etc.
2. **Consult the Roadmap:** Read `docs/ROADMAP.md` (available via the `datum://global/roadmap` MCP resource).
3. **Assess Leap Risk:**
   - What must already be true for this to be worth doing?
   - Are we leaping ahead of a declared prerequisite?
4. **Slot the Feature:**
   - Choose a concrete anchor (`insert_before` or `insert_after` an existing item).
   - Never claim "now" without naming what gets deferred or displaced.
5. **Update the Roadmap:** Use the `datum_update_roadmap` tool to safely rewrite `docs/ROADMAP.md` with the new optimized path.

## Output
Transition to the `discovery` phase only after `docs/ROADMAP.md` has been safely updated with the new slot decision.
