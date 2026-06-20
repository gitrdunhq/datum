# Lane plan — E3 Execution hosts

| Lane | Files (disjoint owner) | depends_on | wave |
|------|------------------------|-----------|------|
| L1 errors | `src/datum_ax/data/execution/errors.py` | E1 | 0 |
| L2 docker host | `src/datum_ax/data/execution/docker.py` | L1 | 1 |
| L3 tart host | `src/datum_ax/data/execution/tart.py` | L1 | 1 |
| L4 package | `src/datum_ax/data/execution/__init__.py` | L2,L3 | 2 |
| Tests | `tests/test_execution_hosts.py` | L1..L4 | 2 |

**Waves:** `0: errors` → `1: docker, tart` → `2: package + tests`.
Each lane: RED (test) → GREEN (impl) → gates. Disjoint files; conflict-free integration.
Acceptance demo: `X86DockerHost` runs a diff, `TestResult` is asserted, and container is torn down.
