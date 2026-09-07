"""Cross-language pin: datum.lane_hash.lane_spec_hash vs the TS laneSpecHash.

tests/fixtures/lane_spec_hash_vectors.json is a static fixture generated
once from skills/src/shared/utils.ts `laneSpecHash` (via a throwaway
vitest run) and committed. skills/src/shared/utils.test.ts pins the TS
side against the same fixture. This file pins the Python port
(datum/lane_hash.py) against it: if either implementation's hashing
behavior ever changes, one of the two test suites fails loudly instead
of `datum lane-state rehash` silently writing a spec_hash the TS
orchestrator's skip-condition check can never match.
"""

import json
from pathlib import Path

import pytest

from datum.lane_hash import fnv1a64, lane_spec_hash

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "lane_spec_hash_vectors.json"


def _load_vectors():
    return json.loads(FIXTURE_PATH.read_text())


@pytest.mark.parametrize("vector", _load_vectors(), ids=lambda v: v["name"])
def test_lane_spec_hash_matches_pinned_vector(vector):
    assert lane_spec_hash(vector["lane"]) == vector["hash"]


def test_fnv1a64_basic_known_value():
    """Sanity check independent of the fixture: FNV-1a 64-bit offset basis
    hashed with an empty string must equal the FNV-1a 64-bit offset basis
    itself, formatted as the fnv1a64: prefix + 16 lowercase hex digits."""
    assert fnv1a64("") == "fnv1a64:cbf29ce484222325"


def test_lane_spec_hash_ignores_presentation_fields():
    """title/red_note/model hints must not affect the hash — only
    files/acceptance_criteria/depends_on define a lane's identity."""
    base = {"files": ["a.py"], "acceptance_criteria": ["x"], "depends_on": []}
    with_extra = {
        **base,
        "title": "some title",
        "red_note": "some note",
        "green_model": "opus",
    }
    assert lane_spec_hash(base) == lane_spec_hash(with_extra)


def test_lane_spec_hash_defaults_missing_fields_to_empty_lists():
    assert lane_spec_hash({}) == lane_spec_hash(
        {"files": [], "acceptance_criteria": [], "depends_on": []}
    )
