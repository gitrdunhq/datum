# Lane plan — E2 Inference layer

| Lane | Files (disjoint owner) | depends_on | wave |
|------|------------------------|-----------|------|
| L1 wire | `src/datum_ax/data/inference/wire.py` | E1 | 0 |
| L2 errors | `src/datum_ax/data/inference/errors.py` | E1 | 0 |
| L3 roles | `src/datum_ax/data/inference/roles.py` | L2 | 1 |
| L4 transport | `src/datum_ax/data/inference/transport.py` | L1 | 1 |
| L5 client | `src/datum_ax/data/inference/client.py` | L1,L2,L3,L4 | 2 |
| L6 httpx transport | `src/datum_ax/data/inference/httpx_transport.py` | L1,L4 | 2 |
| L7 package | `src/datum_ax/data/inference/__init__.py` | L1..L5 | 3 |
| Tests | `tests/fakes.py`, `tests/test_inference_client.py`, `+strategies` | L1..L7 | 3 |

**Waves:** `0: wire,errors` → `1: roles,transport` → `2: client,httpx` → `3: package + tests`.
Each lane: RED (test) → GREEN (impl) → gates. Disjoint files; conflict-free integration (ADR-0012).
Acceptance demo: `OmlxInferenceClient` vs `FakeOmlxTransport` — typed Completion, semaphore cap,
budget rejection, timeout.
