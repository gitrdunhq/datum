# Tasks: [Feature Name]

**Run ID:** <!-- filled by datum -->
**Phase:** Plan
**Total tasks:** <!-- N -->

<!-- Dependency graph summary:
  task-001 ──→ task-003
  task-002 ──→ task-003
  task-003 (independent)
-->

---

## task-001: [Task Title]

**Description:** ...

**Acceptance criteria:**
- AC1: ...
- AC2: ...

**Files:**
- `Sources/...`
- `Tests/Unit/...`

**Depends on:** (none)

**Introduces stubs:** false

**RED note:** The failing test must prove [property ID] — [what the assertion should check].

**Estimated LOC:** 0

---

## task-002: [Task Title]

**Description:** ...

**Acceptance criteria:**
- AC1: ...

**Files:**
- `Sources/...`
- `Tests/Unit/...`

**Depends on:** task-001

**Introduces stubs:** true

**RED note:** The failing test must prove [property ID] — [what the assertion should check].

**Estimated LOC:** 0
