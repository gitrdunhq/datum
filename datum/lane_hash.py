"""Python port of skills/src/shared/utils.ts `fnv1a64` / `laneSpecHash`.

This MUST stay byte-for-byte identical to the TypeScript implementation:
the TS side computes `laneSpecHash` when the workflow orchestrator writes
a lane-state marker's `spec_hash`, and this module recomputes the same
value from the on-disk plan for `datum lane-state rehash`. If the two
diverge, `rehash` would write a spec_hash that TS-side skip-condition
checks (`m.spec_hash === laneSpecHash(lanePlan.lanes[id])`) can never
match, silently defeating lane-skip / re-schedule detection.

Cross-language pin: tests/fixtures/lane_spec_hash_vectors.json holds a
fixed set of {lane, hash} vectors. The vitest test in
skills/src/shared/utils.test.ts asserts the TS `laneSpecHash` still
produces those hashes; tests/test_lane_hash.py asserts `lane_spec_hash`
below does too. Whichever side changes first breaks its own suite,
never silently drifting from the other.

## Divergence notes (see skills/src/shared/utils.ts `fnv1a64`)

- JS `fnv1a64` hashes the UTF-16 *code units* of the JSON string
  (`input.charCodeAt(i)`), not Unicode code points. For any character
  outside the Basic Multilingual Plane (e.g. an emoji), JS represents it
  as a surrogate pair — two 16-bit code units — and both are folded into
  the hash separately. To match, this port encodes the JSON string as
  UTF-16LE and hashes each 16-bit little-endian code unit in order,
  which reproduces the exact same surrogate-pair sequence.
- `json.dumps(obj, separators=(",", ":"), ensure_ascii=False)` matches
  JS `JSON.stringify(obj)` for ordinary strings: both escape `"`, `\\`,
  and control characters below U+0020 as `\\uXXXX` except for
  `\\b \\f \\n \\r \\t`, and neither escapes non-ASCII characters (with
  `ensure_ascii=False` on the Python side). Key order is preserved by
  both (Python dict insertion order; JS object literal order), so the
  `files` -> `acceptance_criteria` -> `depends_on` ordering used below
  must match the TS `laneSpecHash` object literal exactly.
- One theoretical divergence: JSON.stringify escapes a *lone* (unpaired)
  UTF-16 surrogate as `\\uXXXX`, which cannot occur in a well-formed
  Python `str` (Python strings are sequences of Unicode code points, not
  raw UTF-16 code units, so an unpaired surrogate can't be constructed
  from ordinary text). This is not reachable from any real lane-plan
  JSON, since JSON.parse'ing valid JSON on the TS side can't produce an
  unpaired surrogate the Python side would then need to reproduce.
"""

from __future__ import annotations

import json

_PRIME = 0x100000001B3
_MASK = 0xFFFFFFFFFFFFFFFF
_OFFSET_BASIS = 0xCBF29CE484222325


def fnv1a64(text: str) -> str:
    """FNV-1a 64-bit hash over the UTF-16 code units of `text`.

    Exact port of skills/src/shared/utils.ts `fnv1a64`.
    """
    utf16_bytes = text.encode("utf-16-le")
    h = _OFFSET_BASIS
    for i in range(0, len(utf16_bytes), 2):
        code_unit = utf16_bytes[i] | (utf16_bytes[i + 1] << 8)
        h ^= code_unit
        h = (h * _PRIME) & _MASK
    return f"fnv1a64:{h:016x}"


def lane_spec_hash(lane: dict) -> str:
    """Content-addressed hash of the fields that define WHAT a lane does.

    Exact port of skills/src/shared/utils.ts `laneSpecHash`. Only
    files/acceptance_criteria/depends_on participate — title/red_note/model
    hints are presentation and must not invalidate a completed lane.
    """
    spec = {
        "files": lane.get("files") or [],
        "acceptance_criteria": lane.get("acceptance_criteria") or [],
        "depends_on": lane.get("depends_on") or [],
    }
    json_str = json.dumps(spec, separators=(",", ":"), ensure_ascii=False)
    return fnv1a64(json_str)
