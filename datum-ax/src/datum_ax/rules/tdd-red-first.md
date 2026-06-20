---
kind: discipline
tier: auto_bind
scope_tags: [universal, code, tdd, testing]
evidence_refs: [ADR-0010, ADR-0007]
version: 1
---
Test-Driven Development is mandatory and ordered:

1. Write the test first.
2. Run it and confirm it FAILS for the right reason (**RED**).
3. Implement the minimum to make it pass (**GREEN**).
4. Refactor with the suite green; commit test and code together.

Never write implementation before a failing test exists. A producer is not done until its
consumer/contract test exists and has been seen to fail.
