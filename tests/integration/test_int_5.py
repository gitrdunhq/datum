"""Integration invariants covering task-003 (integration-lanes-2 epic).

This is a `kind: "integration"` lane (task-INT-5): its acceptance criteria
describe behaviour that task-003 already merged into
skills/src/shared/triage-classify.ts, skills/src/datum-tdd-act-triage.ts and
skills/src/datum-tdd-act-lane.ts. Per contract_summary in this lane's spec,
these tests are expected to PASS against the already-merged code — a failing
test here is a finding about task-003, not a placeholder to be filled in
during GREEN.

INT-06: Covered task ids are embedded as a substring of
`TriageClassification.reason` (extracted via regex), not carried on a new
structured `taskIds: string[]` field, sufficient for the issue-filer
(datum-tdd-act-triage.ts) and the halt message (datum-tdd-act-lane.ts) that
both read `reason` in this slice.

Because `classifyLaneError`/`TriageClassification` are TypeScript (there is
no Python port), the behavioural assertions below extract and evaluate the
exact `covered ([^;]+)` regex the implementation uses against the same
byte-shape error strings task-002/task-003 actually produce, and the
structural assertions pin the absence of a `taskIds` field and the presence
of `.reason`-only reads in the two consumers named by the AC.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TRIAGE_CLASSIFY_TS = REPO_ROOT / "skills/src/shared/triage-classify.ts"
ACT_TRIAGE_TS = REPO_ROOT / "skills/src/datum-tdd-act-triage.ts"
ACT_LANE_TS = REPO_ROOT / "skills/src/datum-tdd-act-lane.ts"

SPEC_AC_ERROR = (
    "integration_failed: covered task-002, task-003; invariants INV-01, "
    "INV-03 (independent verify exit=1)"
)


def _extract_covered_regex_reason(error_text: str) -> str:
    """Mirrors classifyLaneError's `covered ([^;]+)` extraction and reason
    template in skills/src/shared/triage-classify.ts (lines ~269-277), so the
    behavioural assertions below exercise the same regex against the exact
    strings the implementation is expected to handle."""
    covered_match = re.search(r"covered ([^;]+)", error_text)
    covered_ids = covered_match.group(1).strip() if covered_match else "unknown lane(s)"
    return (
        f"integration_failed: covered {covered_ids} — the independent "
        "post-merge verify found the merged epic's suite red even though "
        "every covered lane's own tests passed in isolation, a genuine "
        "cross-lane code defect."
    )


class TestInt06CoveredTaskIdsEmbeddedInReasonSubstring:
    """INT-06 positive path: covered task ids are embedded as a substring of
    `reason`, extracted via the `covered ([^;]+)` regex — not a separate
    structured field."""

    def test_two_covered_task_ids_are_both_present_as_substrings_of_reason(
        self,
    ) -> None:
        reason = _extract_covered_regex_reason(SPEC_AC_ERROR)
        assert "task-002" in reason
        assert "task-003" in reason

    def test_single_covered_task_id_is_present_as_a_substring_of_reason(self) -> None:
        reason = _extract_covered_regex_reason(
            "integration_failed: covered task-007; invariants INV-02 "
            "(independent verify exit=1)"
        )
        assert "task-007" in reason

    def test_missing_covered_segment_falls_back_without_raising(self) -> None:
        # Negative/error path: an integration_failed error with no `covered `
        # segment must not raise, and must not silently invent a task id.
        reason = _extract_covered_regex_reason("integration_failed: exit=1")
        assert "unknown lane(s)" in reason
        assert "task-002" not in reason
        assert "task-003" not in reason

    def test_extraction_matches_the_source_regex_used_by_classify_lane_error(
        self,
    ) -> None:
        src = TRIAGE_CLASSIFY_TS.read_text()
        assert "text.match(/covered ([^;]+)/)" in src
        assert "coveredMatch ? coveredMatch[1].trim() : 'unknown lane(s)'" in src


class TestInt06NoStructuredTaskIdsField:
    """INT-06 negative path: `TriageClassification` carries category,
    confidence and reason only — no new structured `taskIds: string[]`
    field was added to hold covered task ids."""

    def test_triage_classification_interface_has_exactly_three_fields(self) -> None:
        src = TRIAGE_CLASSIFY_TS.read_text()
        iface_match = re.search(
            r"export interface TriageClassification \{(.*?)\n\}\n", src, re.DOTALL
        )
        assert iface_match is not None, "TriageClassification interface not found"
        body = iface_match.group(1)
        field_names = set(re.findall(r"^\s*(\w+)\s*:", body, re.MULTILINE))
        assert field_names == {"category", "confidence", "reason"}
        assert "taskIds" not in body

    def test_no_task_ids_array_field_anywhere_in_triage_classify_module(self) -> None:
        src = TRIAGE_CLASSIFY_TS.read_text()
        assert "taskIds" not in src
        assert "task_ids" not in src


class TestInt06IssueFilerReadsReasonOnly:
    """INT-06 consumer #1: the issue-filer (datum-tdd-act-triage.ts) reads
    `cls.reason`, not a structured task-id list, when a category is already
    deterministically known."""

    def test_issue_filer_reads_cls_reason_in_the_category_already_determined_note(
        self,
    ) -> None:
        src = ACT_TRIAGE_TS.read_text()
        assert "CATEGORY ALREADY DETERMINED: ${cls.category} (${cls.reason})" in src
        assert "cls.taskIds" not in src


class TestInt06HaltMessageReadsReasonOnly:
    """INT-06 consumer #2: the RED-stage halt/error message for a failed
    integration lane (datum-tdd-act-lane.ts) builds `error` from the covered
    task ids directly, and that `error` string is what flows into
    `classifyLaneError(...).reason` — no separate `taskIds` field is
    threaded through the LaneOutcome."""

    def test_halt_message_builds_covered_and_invariant_ids_into_the_error_string(
        self,
    ) -> None:
        src = ACT_LANE_TS.read_text()
        assert (
            "const error = `integration_failed: covered ${covered}; "
            "invariants ${invariantIds} (independent verify exit=${redVerifyVerdict.exit})`"
            in src
        )

    def test_lane_outcome_error_field_has_no_sibling_task_ids_field_nearby(
        self,
    ) -> None:
        src = ACT_LANE_TS.read_text()
        halt_match = re.search(
            r"const error = `integration_failed:.*?\n.*?return \{ task_id: taskId, status: 'failed', stage: 'RED', error \}\n",
            src,
            re.DOTALL,
        )
        assert halt_match is not None, "integration_failed halt return not found"
        assert "taskIds" not in halt_match.group(0)


# ---------------------------------------------------------------------------
# INV-3: migrate.py's fate (one-shot legacy importer) is fixed by task-001's
# decision doc and implemented unchanged by task-007.
#
# This is a `kind: "integration"` lane (task-INT-5, covering task-001 /
# task-007): these tests are expected to PASS against the already-merged
# code. A failing test below is a finding about the merged state, not a
# placeholder — do not weaken it.
# ---------------------------------------------------------------------------

import inspect

from typer.testing import CliRunner

import datum.migrate as migrate_mod
from datum.cli import app as cli_app

cli_runner = CliRunner()

MIGRATE_PY = REPO_ROOT / "datum/migrate.py"
CLI_PY = REPO_ROOT / "datum/cli.py"
DECISION_DOC = REPO_ROOT / "docs/architecture/state-store.md"


class TestInv3MigratePyDeclaresItsDecidedFate:
    """migrate.py must carry a top-of-file comment stating its decided fate:
    one-shot legacy .datum/state.json importer per SPEC Requirement 3 option
    (b), naming it as the only module permitted to read a legacy
    .datum/state.json."""

    def test_module_docstring_states_one_shot_legacy_importer_fate(self) -> None:
        src = MIGRATE_PY.read_text()
        assert "one-shot" in src
        assert "legacy" in src
        assert "Requirement 3" in src

    def test_module_docstring_names_it_the_only_legacy_state_json_reader(self) -> None:
        doc = " ".join((migrate_mod.__doc__ or "").split())
        assert "only module permitted to read a legacy .datum/state.json" in doc


class TestInv3MigratePyHasNoLoadOrSaveStateDefinitions:
    """SPEC Requirement 1's AC forbids `def load_state`/`def save_state`
    outside datum/state.py; migrate.py's reader is renamed and its writer
    delegates to datum.state.save_state."""

    def test_migrate_module_defines_no_load_state_function(self) -> None:
        src = MIGRATE_PY.read_text()
        assert "def load_state(" not in src

    def test_migrate_module_defines_no_save_state_function(self) -> None:
        src = MIGRATE_PY.read_text()
        assert "def save_state(" not in src

    def test_migrate_module_exposes_renamed_legacy_reader(self) -> None:
        assert hasattr(migrate_mod, "load_legacy_state")
        assert callable(migrate_mod.load_legacy_state)

    def test_migrate_module_writer_delegates_to_canonical_save_state(self) -> None:
        src = MIGRATE_PY.read_text()
        assert "from datum.state import save_state" in src


class TestInv3CliMigrateCommandUsesRenamedSymbols:
    """datum/cli.py's migrate command imports the renamed symbols from
    datum.migrate and still exits cleanly with the legacy 'nothing to do'
    message when there is neither a legacy state.json nor a .wfc dir."""

    def test_cli_migrate_command_imports_renamed_symbols_from_datum_migrate(
        self,
    ) -> None:
        src = CLI_PY.read_text()
        assert "from datum.migrate import (" in src
        assert "load_legacy_state" in src
        assert "migrate_wfc_directory" in src
        assert "migrate_state" in src

    def test_cli_migrate_prints_nothing_to_do_when_no_legacy_state_or_wfc_dir(
        self, tmp_path, monkeypatch
    ) -> None:
        monkeypatch.chdir(tmp_path)
        result = cli_runner.invoke(cli_app, ["migrate"])
        assert (
            "No legacy .wfc/ directory or .datum/state.json found. Nothing to do."
            in result.output
        )
        assert result.exit_code == 0


class TestInv3RunningMigrateUpgradesLegacyStateIntoStateDb:
    """Running the migrate path against a repo containing a legacy
    .datum/state.json and no state.db results in that dict being readable
    afterwards via datum.state.load_state(), with the schema-version
    upgrade from migrate_state() applied."""

    def test_legacy_state_json_lands_in_state_db_with_schema_upgrade(
        self, tmp_path, monkeypatch
    ) -> None:
        import datum.state as state_mod

        monkeypatch.chdir(tmp_path)
        datum_dir = tmp_path / ".datum"
        datum_dir.mkdir()
        (datum_dir / "state.json").write_text(
            '{"skill_version": "0.0.1", "run_id": "epic-1-legacy"}'
        )

        cli_runner.invoke(cli_app, ["migrate"])

        migrated = state_mod.load_state()
        assert migrated != {}
        assert migrated["run_id"] == "epic-1-legacy"
        assert migrated["schema_version"] == "1.0.0"
        assert migrated["skill_version"] == migrate_mod.current_skill_version()
        # The legacy importer must not have skipped writing to state.db.
        assert (datum_dir / "state.db").exists()

    def test_no_legacy_state_json_leaves_state_db_untouched(
        self, tmp_path, monkeypatch
    ) -> None:
        import datum.state as state_mod

        monkeypatch.chdir(tmp_path)
        cli_runner.invoke(cli_app, ["migrate"])
        assert state_mod.load_state() == {}


class TestInv3MigrateStateAndMigrateWfcDirectorySignaturesUnchanged:
    """migrate_state() and migrate_wfc_directory() keep their current
    signatures and behaviour."""

    def test_migrate_state_signature_is_state_and_target_version(self) -> None:
        sig = inspect.signature(migrate_mod.migrate_state)
        assert list(sig.parameters) == ["state", "target_version"]

    def test_migrate_wfc_directory_signature_is_dry_run_only(self) -> None:
        sig = inspect.signature(migrate_mod.migrate_wfc_directory)
        assert list(sig.parameters) == ["dry_run"]

    def test_migrate_state_returns_state_and_changes_tuple(self) -> None:
        state, changes = migrate_mod.migrate_state({}, "1.0.0")
        assert state == {}
        assert changes == []

    def test_migrate_state_sets_schema_version_and_records_change(self) -> None:
        state, changes = migrate_mod.migrate_state({"skill_version": "1.0.0"}, "1.0.0")
        assert state["schema_version"] == "1.0.0"
        assert "set schema_version=1.0.0" in changes


class TestInv3DecisionDocFixesMigratePyFate:
    """INV-3 requires task-001's decision doc
    (docs/architecture/state-store.md) to record migrate.py's fate as a
    one-shot legacy state.json importer (SPEC Requirement 3 option b) —
    the same fate implemented by task-007. Per this lane's contract, this
    test must PASS against already-merged code; if the doc is missing or
    silent on migrate.py's fate, that is a genuine integration finding to
    report, not a test to weaken."""

    def test_decision_doc_exists_and_records_migrate_py_legacy_importer_fate(
        self,
    ) -> None:
        assert DECISION_DOC.exists(), (
            f"{DECISION_DOC} does not exist — task-001's decision doc "
            "recording migrate.py's fate (SPEC Requirement 3 option b) "
            "is missing, so INV-3 is not satisfied"
        )
        text = DECISION_DOC.read_text()
        assert "migrate.py" in text
        assert "one-shot" in text
        assert "legacy" in text
