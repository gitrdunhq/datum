# Property Categories

The 11 property categories used in PROPERTIES.md. Every requirement maps to at least one category.

---

## 1. SAFETY — What must NEVER happen

Safety properties are always negative. They state what the system must not do regardless of circumstance.

**Format:** `SAFETY(SAFE-NNN): The system NEVER <bad outcome>.`

**Examples:**
- `SAFETY(SAFE-001): The recording session NEVER starts without camera permission granted.`
- `SAFETY(SAFE-002): User credentials are NEVER logged at any log level.`
- `SAFETY(SAFE-003): The payment amount NEVER exceeds the authorized amount.`

**Test pattern:** Arrange the bad precondition, assert the bad outcome does not occur.

---

## 2. LIVENESS — What must EVENTUALLY happen

Liveness properties state that progress is made — the system doesn't get stuck.

**Format:** `LIVENESS(LIVE-NNN): Once <precondition>, <outcome> ALWAYS eventually happens within <bound>.`

**Examples:**
- `LIVENESS(LIVE-001): Once startRecording() is called, the first frame ALWAYS arrives within 3 seconds.`
- `LIVENESS(LIVE-002): A queued job ALWAYS starts processing within 30 seconds of being enqueued.`

**Test pattern:** Trigger the precondition, wait for the outcome with a timeout.

---

## 3. INVARIANT — What must ALWAYS be true

Invariants hold at all observable states. They constrain the relationship between fields or objects.

**Format:** `INVARIANT(INV-NNN): <condition> is ALWAYS true.`

**Examples:**
- `INVARIANT(INV-001): session.isActive == true IFF audio and video pipelines are both running.`
- `INVARIANT(INV-002): cart.total == sum(cart.items.map(i => i.price * i.quantity)).`

**Test pattern:** Check the invariant before, during, and after state transitions.

---

## 4. BOUNDARY — Valid input ranges

Boundary properties specify what constitutes valid input and what happens at the edges.

**Format:** `BOUNDARY(BOUND-NNN): <parameter> MUST be in [<min>, <max>] / one of <set>.`

**Examples:**
- `BOUNDARY(BOUND-001): maxDurationSeconds MUST be in [1, 3600].`
- `BOUNDARY(BOUND-002): status MUST be one of {pending, processing, completed, failed}.`

**Test pattern:** Test at boundary values (min, max, min-1, max+1) and invalid types.

---

## 5. IDEMPOTENT — What is safe to run twice

Idempotence properties ensure that re-running an operation doesn't cause double effects.

**Format:** `IDEMPOTENT(IDEM-NNN): Running <operation> twice produces the same result as running it once.`

**Examples:**
- `IDEMPOTENT(IDEM-001): Calling createUser() with the same email twice results in one user, not two.`
- `IDEMPOTENT(IDEM-002): Applying the same migration twice leaves the schema unchanged after the second run.`

**Test pattern:** Run the operation twice, assert the final state is the same as after one run.

---

## 6. ORDERING — Order invariants

Ordering properties constrain the sequence of operations or events.

**Format:** `ORDERING(ORD-NNN): <A> MUST happen before <B>.`

**Examples:**
- `ORDERING(ORD-001): configureSession() MUST be called before startRecording().`
- `ORDERING(ORD-002): The merge commit tag MUST be applied after the merge, never before.`

**Test pattern:** Attempt to trigger B without A; assert the correct error or guard fires.

---

## 7. ISOLATION — What cannot leak between contexts

Isolation properties ensure that one context (user, session, lane, test) doesn't affect another.

**Format:** `ISOLATION(ISOL-NNN): <data/state/effect> from context A MUST NOT be visible in context B.`

**Examples:**
- `ISOLATION(ISOL-001): Test source code MUST NOT appear in GREEN agent's context.`
- `ISOLATION(ISOL-002): User A's session data MUST NOT be accessible to User B.`

**Test pattern:** Set state in context A, verify it is absent or inaccessible in context B.

---

## 8. PERFORMANCE — Latency, throughput, size bounds

Performance properties set measurable non-functional constraints.

**Format:** `PERFORMANCE(PERF-NNN): <operation> MUST complete within <bound> under <conditions>.`

**Examples:**
- `PERFORMANCE(PERF-001): API response time MUST be < 200ms at p95 under normal load.`
- `PERFORMANCE(PERF-002): Export file size MUST NOT exceed 50MB for any valid input.`

**Test pattern:** Measure the operation under specified conditions; assert the bound is met.

---

## 9. SECURITY — Access control invariants

Security properties enforce authorization boundaries and data protection.

**Format:** `SECURITY(SEC-NNN): <actor> MUST NOT be able to <action> without <condition>.`

**Examples:**
- `SECURITY(SEC-001): An unauthenticated user MUST NOT be able to access any /api/v1/* endpoint.`
- `SECURITY(SEC-002): User tokens MUST NOT appear in log output at any severity level.`

**Test pattern:** Attempt the action without the required condition; assert it is denied.

---

## 10. OBSERVABILITY — What must be logged or measured

Observability properties ensure that important events are captured for debugging and monitoring.

**Format:** `OBSERVABILITY(OBS-NNN): <event> MUST produce a structured log entry with fields <list>.`

**Examples:**
- `OBSERVABILITY(OBS-001): Recording session start MUST log {session_id, user_id, duration_limit, timestamp}.`
- `OBSERVABILITY(OBS-002): Payment failure MUST emit a metric increment to payment.failures with tag reason=<code>.`

**Test pattern:** Trigger the event, assert the expected log or metric was emitted.

---

## 11. COMPATIBILITY — Existing behavior that must be preserved

Compatibility properties protect callers of the changed surface from breaking changes.

**Format:** `COMPATIBILITY(COMPAT-NNN): <existing behavior/API/contract> MUST remain unchanged.`

**Examples:**
- `COMPATIBILITY(COMPAT-001): The RecordingSession.startRecording() signature MUST remain unchanged.`
- `COMPATIBILITY(COMPAT-002): Existing serialized event payloads MUST remain deserializable after the schema change.`

**Test pattern:** Run existing callers / existing serialized data against the new implementation; assert no breakage.
