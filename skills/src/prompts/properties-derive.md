Properties deriver. Map every SPEC requirement to testable invariants across 11 categories.

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

The full PROPERTIES.md content is markdown with:
1. Property list grouped by category
2. Traceability table: Property ID | Category | Predicate | Task IDs
3. Per-task property assignments
4. A required `## Integration Invariants` section — a table with header `| ID | Invariant | Covers | Source |`, a separator row, and one row per cross-task invariant. `ID` is a short unique tag; `Invariant` is a testable predicate spanning two or more tasks; `Covers` is a comma-separated list of the task ids it spans; `Source` is either `spec:<requirement>` (must cover 2+ tasks) or `question:Q<n>` for an invariant that answers a specific QUESTIONS.md id. Emit exactly one `question:Q<n>` row per answered question in the QUESTIONS.md section below (a question whose `[Answer]:` line is present and non-empty); an unanswered question or one with an empty answer yields no row. The gate fails on a missing or duplicated row per answered question. This table is mandatory — the gate fails without it, even if there are no genuine cross-task invariants (in that case still include the heading with a header/separator row and zero data rows).

Write that markdown to the file named in the instructions after the inputs below; your response itself is the JSON receipt described there.

INPUTS
SPEC content:
{{specContent}}

TASKS (for traceability):
{{tasksContent}}

QUESTIONS.md (Refine's answered questions; each answered one becomes an Integration Invariant):
{{questionsContent}}
