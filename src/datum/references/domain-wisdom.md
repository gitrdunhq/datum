# Domain Wisdom — Architectural Seeds

Compressed wisdom for scalable systems. These are not rules — they are seeds. Plant them in the
soil of your problem and they grow into architecture. Use them during **Plan** (to evaluate
architectural approaches) and **Review** (to assess whether shipped code honors production invariants).

---

## The 20 Seeds

### Seed 1: "Each Organ Has One Job"
Databases store truth and run maintenance. They do not dispatch HTTP requests.
Schedulers distribute work. They are not databases. Caches serve static content. They are not origins.
When you ask a system to do another system's job, the whole body suffers.

### Seed 2: "Don't Build a House on Sand"
Scalability is not an afterthought — it's the foundation. Test at 1x, 10x, 100x load before shipping.
When something breaks under pressure, you've found where the sand is. Fix the sand, not the house.

### Seed 3: "The River Doesn't Fight the Rocks"
Don't fight lock contention — eliminate it by changing the write pattern. Append-only buffers
have no contention. Batching amortizes cost. The river's power is in flow, not force.

### Seed 4: "Projection Is Cheaper Than Computation"
Pre-compute current state. Store it in a tiny, indexed table. Public pages read the map, not
the terrain. One indexed lookup scales better than aggregating a million rows.

### Seed 5: "The Edge Is Closer Than the Origin"
Cache public content at the edge. A million requests become ~60 origin hits. The origin only
handles cache misses. The system scales by not being hit.

### Seed 6: "The Right Tool for the Right Job"
A hammer is great for nails. Terrible for screws. `pg_cron` is great for SQL maintenance.
Terrible for HTTP fan-out. When you hit a tool's limit, you've violated this seed.

### Seed 7: "Know What Breaks If You Delete This"
Before removing a brick from a wall, know which wall it's holding up.
- What files depend on this?
- What data flows through this?
- What happens if this fails halfway?
- What's the rollback path?
- What's the actual blast radius?

### Seed 8: "The Smallest Cut Heals Fastest"
Don't rewrite half the app because one query is slow. Don't refactor for cleanliness while
fixing production. The smallest safe change always wins. Move fast by moving surgically.

### Seed 9: "Measure Before You Optimize"
A doctor doesn't prescribe medicine without taking a pulse. Load test until something breaks.
Measure throughput, latency, errors, resource usage. Fix the break. Measure again.
You don't optimize what you haven't measured.

### Seed 10: "Scalability Is Not a Feature — It's a Foundation"
You don't add scalability to a building after it's built. Design for 10x, 100x load from the
start. When something breaks under load, you've discovered where the foundation is weak.

### Seed 11: "Load Testing Is Discovery, Not Validation"
You don't load test to prove something works. You load test to find where it breaks.
Each failure teaches you something. Extract the lesson. Codify it.

### Seed 12: "Contention Is an Architecture Problem, Not a Database Problem"
When a thousand people try to use the same door, the problem isn't the door — it's that
there's only one door. Multiple processes fighting over the same row is not a Postgres
problem. It's an architecture problem. Append-only buffers = many doors.

### Seed 13: "The Database Should Store Truth, Not Dispatch Work"
The database is the library. It stores books (truth). It doesn't deliver them — that's what
couriers are for. Never ask the database to be a courier. It will hit its worker limits.

### Seed 14: "Public Traffic Reads From Projections, Not Raw Data"
Public pages are storefronts — they show what's available. They don't ask the warehouse to
count inventory every time someone looks. Pre-compute current state; public pages read that.

### Seed 15: "Append-Only Buffers Eliminate Contention"
Instead of everyone fighting to update the same counter, everyone writes to a log. A background
process counts the log. No fights. No locks. Same hardware, 25x throughput.

### Seed 16: "Separate Connection Pools for Different Workloads"
Don't make background workers wait in line behind public traffic. Give them their own line.
Each workload gets its resources. Neither starves. System stays responsive.

### Seed 17: "Idempotent Jobs Everywhere"
A job should be safe to run twice. If it runs twice, the result should be the same as once.
Jobs can be retried without side effects. Partial failures are recoverable. The system is resilient.

### Seed 18: "Graceful Degradation Over Hard Failure"
When the road is crowded, traffic moves slowly — it doesn't stop. When a system is overloaded,
it should slow down, not crash. Users see slowness, not broken.

### Seed 19: "Jittered Scheduling Over Synchronized Bursts"
If a thousand clocks chime at the exact same second, the noise is deafening. If they chime
randomly, the sound is distributed. Add jitter so jobs spread out. Load is smooth, not spiky.

### Seed 20: "The Preference Hierarchy Is Not Arbitrary"
These preferences come from production experience, not theory:

- Scheduler → queue → workers → reducers (over direct synchronous processing)
- Append-only buffers + rollups (over constant hot-row updates)
- Current-state projections (over live aggregation queries)
- External scheduler + controlled fan-out (over database as dispatcher)
- Edge caching (over origin scaling)
- Jittered scheduling (over synchronized bursts)
- Idempotent jobs (over exactly-once guarantees)
- Separate connection pools (over single shared pool)
- Graceful degradation (over hard failures)

---

## How the Seeds Work Together

When you face a design decision:

- **Seed 7** tells you the blast radius
- **Seed 8** tells you how to minimize the change
- **Seed 9** tells you what to measure first
- **Seed 6** tells you which pattern to use
- **Seed 1** tells you which system should own the work
- **Seed 2** tells you to design for scale from the start

**The meta-seed:** Architecture matters more than platform. Scalability is not an afterthought.
The smallest safe change always wins. Always know your blast radius. Measure everything.
Optimize only what you've measured. Move fast, but move carefully.
The system will tell you when you're wrong. Listen to it.

---

## When to Apply During DATUM

| Phase | How to use |
|---|---|
| **Plan (step 0.5)** | When evaluating 2-3 architectural approaches, invoke the relevant seeds to explain tradeoffs. "Approach A violates Seed 13 — it asks the database to dispatch work." |
| **Review** | When assessing shipped code: "Does this violate Seed 12 (contention)? Seed 17 (idempotency)?" |
| **Refine** | When a ticket's approach seems architecturally risky, surface the relevant seed: "This looks like Seed 2 — we're building on sand." |
