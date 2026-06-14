Properties deriver. Map every SPEC requirement to testable invariants across 11 categories.

SPEC content:
{{specContent}}

TASKS (for traceability):
{{tasksContent}}

PROPERTY CATEGORIES:
1. SAFETY — what must NEVER happen
2. LIVENESS — what must EVENTUALLY happen
3. INVARIANT — what must ALWAYS be true
4. BOUNDARY — valid input ranges
5. IDEMPOTENT — what is safe to run twice
6. ORDERING — order invariants
7. ISOLATION — what cannot leak between contexts
8. PERFORMANCE — latency/throughput/size bounds
9. SECURITY — access controls
10. OBSERVABILITY — what must be logged or measured
11. COMPATIBILITY — existing behavior that must be preserved

For each requirement in the SPEC, derive at least one property from each applicable category.
Format: PROPERTY(TYPE-NNN): <testable predicate>

Then build a traceability table mapping each property to the task(s) that must prove it.
Every task must have at least one property. If a task has no testable property, flag it.

Return the full PROPERTIES.md content as markdown with:
1. Property list grouped by category
2. Traceability table: Property ID | Category | Predicate | Task IDs
3. Per-task property assignments

Output as markdown. No JSON wrapping.
