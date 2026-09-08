"""task-INT-1: integration invariants covering task-001, task-002.

INT-02: `expect_tests_pass` and `depends_on` written by
`lane_plan_digest.py` / `lane_spec_export.py` (task-001) are the exact
fields `runLane` (task-002) reads to decide the RED-only fast path and to
build the RED prompt and error string, with no re-derivation or renaming
across the Python -> TypeScript boundary.

This is an integration lane: these tests exercise already-merged code from
task-001 and task-002 and are expected to PASS. A failure here is a real
finding about the boundary contract, not a test to weaken.
"""

from __future__ import annotations

import json
from pathlib import Path

from datum.lane_plan_digest import build_digest
from datum.lane_spec_export import export_lane_spec

REPO_ROOT = Path(__file__).resolve().parents[2]
RUNLANE_TS = REPO_ROOT / "skills" / "src" / "datum-tdd-act-lane.ts"


def _integration_lane(**extra: object) -> dict:
    lane = {
        "title": "An integration lane",
        "files": ["tests/integration/test_int_1.py"],
        "reads": [],
        "kind": "integration",
        "expect_tests_pass": True,
        "depends_on": ["task-001", "task-002"],
        "invariants": ["INT-02"],
        "acceptance_criteria": ["INT-02: some invariant"],
    }
    lane.update(extra)
    return lane


def test_lane_plan_digest_carries_literal_expect_tests_pass_and_depends_on():
    """The digest entry runLane actually consumes exposes the exact keys
    `expect_tests_pass` and `depends_on` with the values from the source
    lane, unrenamed and unaltered."""
    plan = {
        "lanes": {"task-INT-1": _integration_lane()},
        "topological_order": ["task-INT-1"],
        "total_lanes": 1,
    }
    digest = build_digest(plan, "deadbeef")
    entry = digest["lanes"]["task-INT-1"]
    assert entry["expect_tests_pass"] is True
    assert entry["depends_on"] == ["task-001", "task-002"]
    # No renamed/derived variants should appear anywhere in the entry.
    assert "expectTestsPass" not in entry
    assert "dependsOn" not in entry


def test_lane_spec_export_carries_literal_expect_tests_pass_and_depends_on(tmp_path):
    """`export_lane_spec` (the lane-spec.json writer runLane's RED prompt
    building and error-string building ultimately read from) must emit the
    exact same literal field names with the exact same values as the lane
    plan declared them, for an integration lane."""
    plan = {"lanes": {"task-INT-1": _integration_lane()}}
    out = tmp_path / "lane-spec.json"
    export_lane_spec(plan, "task-INT-1", out, expect_hash=None)
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["expect_tests_pass"] is True
    assert written["depends_on"] == ["task-001", "task-002"]
    assert "expectTestsPass" not in written
    assert "dependsOn" not in written


def test_runLane_reads_literal_expect_tests_pass_field_no_renaming():
    """`runLane` in the TypeScript source reads the lane's
    `expect_tests_pass` field verbatim (`lane.expect_tests_pass`) — never
    a re-derived or renamed variant such as `expectTestsPass` or
    `expected_tests_pass`."""
    source = RUNLANE_TS.read_text(encoding="utf-8")
    assert "async function runLane(" in source
    assert "lane.expect_tests_pass" in source
    assert "lane.expectTestsPass" not in source
    assert "lane.expected_tests_pass" not in source


def test_runLane_reads_literal_depends_on_field_no_renaming():
    """`runLane` reads the lane's `depends_on` field verbatim
    (`lane.depends_on`) when building the integration_failed error string
    — never a re-derived or renamed variant such as `dependsOn`."""
    source = RUNLANE_TS.read_text(encoding="utf-8")
    assert "lane.depends_on" in source
    assert "lane.dependsOn" not in source
    assert "integration_failed:" in source


STATE_STORE_DOC = REPO_ROOT / "docs" / "architecture" / "state-store.md"


def test_ac1_inv_q5_docs_architecture_state_store_md_records_that_q5_s_an():
    """INV-Q5: docs/architecture/state-store.md must record that Q5's
    answer (a SCHEMA_VERSION constant plus a kv_state key/owner docstring
    table) is deliberately NOT implemented by any task in this epic —
    state.db's schema stays unversioned beyond task-001's own doc, a scope
    gap explicitly flagged for the epic owner rather than silently
    dropped."""
    assert STATE_STORE_DOC.exists(), (
        f"{STATE_STORE_DOC} does not exist — task-001's deliverable doc "
        "is missing, so INV-Q5 cannot be verified as recorded"
    )
    text = STATE_STORE_DOC.read_text(encoding="utf-8")
    assert "SCHEMA_VERSION" in text
    assert "kv_state" in text
    # The doc must flag this as an explicit, deliberate scope gap for the
    # epic owner — not silently omitted.
    lowered = text.lower()
    assert "not implemented" in lowered or "out of scope" in lowered
    assert "scope gap" in lowered or "flagged" in lowered


def test_ac2_inv_q6_docs_architecture_state_store_md_records_that_q6_s_an():
    """INV-Q6: docs/architecture/state-store.md must record that Q6's
    answer (a 5s busy_timeout on every connection) is deliberately NOT
    implemented — update_state() retains only its existing EXCLUSIVE
    transaction, per SPEC's Out-of-Scope bar on new locking primitives, a
    scope gap explicitly flagged rather than silently dropped."""
    assert STATE_STORE_DOC.exists(), (
        f"{STATE_STORE_DOC} does not exist — task-001's deliverable doc "
        "is missing, so INV-Q6 cannot be verified as recorded"
    )
    text = STATE_STORE_DOC.read_text(encoding="utf-8")
    assert "busy_timeout" in text
    assert "EXCLUSIVE" in text
    lowered = text.lower()
    assert "not implemented" in lowered or "out of scope" in lowered
    assert "scope gap" in lowered or "flagged" in lowered

    # The actual accessor must still only carry the existing EXCLUSIVE
    # transaction — no new locking primitive introduced alongside it.
    state_py = (REPO_ROOT / "datum" / "state.py").read_text(encoding="utf-8")
    assert "BEGIN EXCLUSIVE" in state_py
    assert "PRAGMA busy_timeout" not in state_py


# ---------------------------------------------------------------------------
# II-001: the shared lane-id pattern is consumed identically by the Python
# loader (datum.id_pattern) and the esbuild-bundled TypeScript loader
# (skills/src/shared/lane-id-pattern.ts), asserted over one shared
# accept/reject fixture list with one test per language.
#
# The lane spec text names `assets/schemas/lane-id.json` with
# `pattern`/`prefix_pattern`/`new_id_pattern` fields; the actual merged
# deliverable (task-001, #523) is `datum/id_pattern.py`'s LANE_ID_PATTERN
# constant, mirrored into `assets/schemas/task.schema.json`'s `id`/
# `depends_on` `pattern` fields — there is no `prefix_pattern` or
# `new_id_pattern` field anywhere in the merged code. This is recorded as a
# finding in failure_reason; the invariant itself (same accept/reject set
# across languages) is exercised against the actual artifacts below.
# ---------------------------------------------------------------------------

II_001_ACCEPT_IDS = ["task-1", "task-001", "task-INT-1", "DAT-142", "AB-1", "ABCDEF-9"]
II_001_REJECT_IDS = [
    "DAT142",
    "dat-142",
    "DATUM-142",
    "task-",
    "task-INT-",
    "DAT-",
    "DAT-1x",
]

LANE_ID_PATTERN_TS = REPO_ROOT / "skills" / "src" / "shared" / "lane-id-pattern.ts"


def test_ac_ii_001_python_loader_accept_reject_matches_shared_fixture_list():
    """Python side (datum.id_pattern.is_lane_id) over the shared fixture
    list must accept every II_001_ACCEPT_IDS value and reject every
    II_001_REJECT_IDS value."""
    from datum.id_pattern import is_lane_id

    accepted = [is_lane_id(value) for value in II_001_ACCEPT_IDS]
    rejected = [is_lane_id(value) for value in II_001_REJECT_IDS]

    assert accepted == [True] * len(II_001_ACCEPT_IDS), (
        f"Python loader disagreed with the accept fixture list: "
        f"{list(zip(II_001_ACCEPT_IDS, accepted))}"
    )
    assert rejected == [False] * len(II_001_REJECT_IDS), (
        f"Python loader disagreed with the reject fixture list: "
        f"{list(zip(II_001_REJECT_IDS, rejected))}"
    )


def test_ac_ii_001_ts_esbuild_bundled_loader_accept_reject_matches_python():
    """The esbuild-bundled TypeScript loader (skills/src/shared/
    lane-id-pattern.ts's isLaneId) must produce the exact same
    accept/reject booleans as the Python loader over the identical shared
    fixture list. Bundles the real .ts source with esbuild (the project's
    actual bundler, per scripts/build-workflows.sh) and executes it under
    node — this is not a re-parse of the Python regex."""
    import json as _json
    import subprocess
    import sys
    import tempfile

    assert LANE_ID_PATTERN_TS.exists(), f"{LANE_ID_PATTERN_TS} does not exist"

    with tempfile.TemporaryDirectory() as tmp:
        bundle_path = Path(tmp) / "lane-id-pattern.bundle.cjs"
        esbuild = subprocess.run(
            [
                "npx",
                "esbuild",
                str(LANE_ID_PATTERN_TS),
                "--bundle",
                "--platform=node",
                "--format=cjs",
                f"--outfile={bundle_path}",
            ],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert esbuild.returncode == 0, (
            f"esbuild failed to bundle {LANE_ID_PATTERN_TS}: "
            f"{esbuild.stdout}\n{esbuild.stderr}"
        )
        assert bundle_path.exists(), "esbuild did not produce a bundle file"

        node_script = (
            f"const {{ isLaneId }} = require({str(bundle_path)!r});\n"
            f"const accept = {II_001_ACCEPT_IDS!r}.map(isLaneId);\n"
            f"const reject = {II_001_REJECT_IDS!r}.map(isLaneId);\n"
            "process.stdout.write(JSON.stringify({accept, reject}));\n"
        )

        node_result = subprocess.run(
            [sys.executable if False else "node", "-e", node_script],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert node_result.returncode == 0, (
            f"node failed to execute bundled TS loader: "
            f"{node_result.stdout}\n{node_result.stderr}"
        )
        payload = _json.loads(node_result.stdout)

    assert payload["accept"] == [True] * len(II_001_ACCEPT_IDS), (
        f"TS loader disagreed with the accept fixture list: "
        f"{list(zip(II_001_ACCEPT_IDS, payload['accept']))}"
    )
    assert payload["reject"] == [False] * len(II_001_REJECT_IDS), (
        f"TS loader disagreed with the reject fixture list: "
        f"{list(zip(II_001_REJECT_IDS, payload['reject']))}"
    )

    from datum.id_pattern import is_lane_id

    py_accepted = [is_lane_id(value) for value in II_001_ACCEPT_IDS]
    py_rejected = [is_lane_id(value) for value in II_001_REJECT_IDS]
    assert payload["accept"] == py_accepted, (
        "TS loader accept results diverge from Python loader accept results "
        f"over the identical fixture list: ts={payload['accept']!r} "
        f"py={py_accepted!r}"
    )
    assert payload["reject"] == py_rejected, (
        "TS loader reject results diverge from Python loader reject results "
        f"over the identical fixture list: ts={payload['reject']!r} "
        f"py={py_rejected!r}"
    )
