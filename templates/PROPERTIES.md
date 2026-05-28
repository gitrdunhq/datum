# Properties: [Feature Name]

**Run ID:** <!-- filled by datum -->
**Phase:** Properties

---

## Property Definitions

### Safety

| ID | Predicate | Tasks |
|---|---|---|
| SAFE-001 | [What must NEVER happen] | task-001 |

### Liveness

| ID | Predicate | Tasks |
|---|---|---|
| LIVE-001 | [What must EVENTUALLY happen] | task-001 |

### Invariant

| ID | Predicate | Tasks |
|---|---|---|
| INV-001 | [What must ALWAYS be true] | task-001 |

### Boundary

| ID | Predicate | Tasks |
|---|---|---|
| BOUND-001 | [Valid input ranges] | task-001 |

### Idempotent

| ID | Predicate | Tasks |
|---|---|---|
| IDEM-001 | [What is safe to run twice] | task-001 |

### Ordering

| ID | Predicate | Tasks |
|---|---|---|
| ORD-001 | [Order invariants] | task-001 |

### Isolation

| ID | Predicate | Tasks |
|---|---|---|
| ISOL-001 | [What cannot leak between contexts] | task-001 |

### Performance

| ID | Predicate | Tasks |
|---|---|---|
| PERF-001 | [Latency/throughput/size bounds] | task-001 |

### Security

| ID | Predicate | Tasks |
|---|---|---|
| SEC-001 | [Access control invariants] | task-001 |

### Observability

| ID | Predicate | Tasks |
|---|---|---|
| OBS-001 | [What must be logged or measured] | task-001 |

### Compatibility

| ID | Predicate | Tasks |
|---|---|---|
| COMPAT-001 | [Existing behavior that must be preserved] | task-001 |

---

## Traceability Table

| Property ID | Category | Predicate (short) | Task IDs |
|---|---|---|---|
| SAFE-001 | SAFETY | ... | task-001 |
| LIVE-001 | LIVENESS | ... | task-001 |

---

## Per-Task Property Assignment

### task-001: [Task Title]

Properties to prove: SAFE-001, LIVE-001, ...
