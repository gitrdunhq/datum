"""Tests for INT-lane skeleton generation — one shared file, invariant-id names.

Task-008 (AC6.1, AC6.2, AC6.3, AC7.2): a lane whose `kind` is `'integration'`
must emit every skeleton into the lane's single `files[0]` target, using
function names derived from the invariant id rather than per-AC slugified
paths. Ordinary (non-integration) lanes must keep behaving exactly as before,
both through `run_preflight` directly and through `run_batch` over a mixed
lane plan.
"""

import json

from datum.skeleton_creator import make_function_name, run_batch, run_preflight


def _write_lane_plan(tmp_path, lanes: dict, order: list[str]):
    plan = {"lanes": lanes, "topological_order": order}
    path = tmp_path / "lane-plan.json"
    path.write_text(json.dumps(plan))
    return path


def _ordinary_lane(files=None):
    return {
        "id": "task-A",
        "slug": "ordinary-lane",
        "acceptance_criteria": [
            "compute_score(x) returns a float",
            "compute_score(x) raises ValueError on negative input",
        ],
        "files": files or ["src/pkg/score.py", "tests/test_score.py"],
    }


def _integration_lane(files=None, acs=None):
    return {
        "id": "task-B",
        "slug": "int-lane",
        "kind": "integration",
        "acceptance_criteria": acs
        or [
            "II1: the pipeline persists state across restarts",
            "II2: the pipeline rejects out-of-order events",
            "II3: the pipeline never double-applies a mutation",
        ],
        # Deliberately NOT under a "tests/" dir and without a "test"/"spec"
        # marker in the name, so `infer_test_path`'s per-AC source-derived
        # fallback (`tests/test_{name}.py`) would pick a *different* path
        # than files[0] unless the integration-lane branch forces files[0].
        "files": files or ["verify/lane_checks.py", "src/pkg/pipeline.py"],
    }


class TestIntegrationLaneSharedFile:
    """AC6.1: every INT skeleton's path equals the lane's files[0]."""

    def test_all_int_skeletons_share_the_lanes_first_file_as_path(
        self, tmp_path, monkeypatch
    ):
        monkeypatch.chdir(tmp_path)
        lanes = {"task-B": _integration_lane()}
        tasks_path = _write_lane_plan(tmp_path, lanes, ["task-B"])

        result = run_preflight(
            task_id="task-B",
            language="python",
            tasks_path=tasks_path,
            output_path=None,
            skip_file_writes=True,
        )

        outputs = result["outputs"]
        assert len(outputs) == 3
        paths = {o["path"] for o in outputs}
        assert paths == {
            "verify/lane_checks.py"
        }, f"expected every skeleton to share files[0], got distinct paths: {paths}"


class TestIntegrationLanePlaceholderShape:
    """The INT lane must reuse the existing task-lane placeholder body verbatim."""

    def test_int_lane_body_matches_ordinary_lane_placeholder_shape(
        self, tmp_path, monkeypatch
    ):
        monkeypatch.chdir(tmp_path)

        ordinary_lanes = {"task-A": _ordinary_lane()}
        ordinary_tasks_path = _write_lane_plan(tmp_path, ordinary_lanes, ["task-A"])
        ordinary_result = run_preflight(
            task_id="task-A",
            language="python",
            tasks_path=ordinary_tasks_path,
            output_path=None,
            skip_file_writes=True,
        )
        ordinary_content = ordinary_result["outputs"][0]["content"]

        int_lanes = {"task-B": _integration_lane()}
        int_tasks_path = _write_lane_plan(tmp_path, int_lanes, ["task-B"])
        int_result = run_preflight(
            task_id="task-B",
            language="python",
            tasks_path=int_tasks_path,
            output_path=None,
            skip_file_writes=True,
        )
        int_content = int_result["outputs"][0]["content"]

        # Same placeholder marker string — no bespoke INT placeholder form.
        assert "RED agent: implement this assertion" in ordinary_content
        assert "RED agent: implement this assertion" in int_content
        # The exact placeholder statement line must match character-for-character
        # between an ordinary skeleton and an INT skeleton.
        ordinary_placeholder_line = [
            ln
            for ln in ordinary_content.splitlines()
            if "implement this assertion" in ln
        ][-1].strip()
        int_placeholder_line = [
            ln for ln in int_content.splitlines() if "implement this assertion" in ln
        ][-1].strip()
        assert ordinary_placeholder_line == int_placeholder_line


class TestMakeFunctionNameBackwardCompat:
    """AC6.3: three-positional-arg contract is unchanged for non-integration ACs."""

    def test_three_positional_args_returns_same_name_as_before(self):
        name = make_function_name("AC1", "compute_score(x) returns a float", "python")
        assert name == "test_ac1_compute_score_x_returns_a_float"

    def test_three_positional_args_go_contract_unchanged(self):
        name = make_function_name("AC2", "handler returns ok", "go")
        assert name == "TestAc2HandlerReturnsOk"


class TestMakeFunctionNameInvariantId:
    """AC6.2: new default-None `invariant_id` keyword takes priority when set."""

    def test_python_uses_invariant_id_when_provided(self):
        name = make_function_name(
            "AC3",
            "the pipeline never double-applies a mutation",
            "python",
            invariant_id="II3",
        )
        assert name == "test_ii3"

    def test_typescript_uses_invariant_id_when_provided(self):
        name = make_function_name(
            "AC3",
            "the pipeline never double-applies a mutation",
            "typescript",
            invariant_id="II3",
        )
        assert "ii3" in name.lower()
        assert (
            name.lower()
            != make_function_name(
                "AC3", "the pipeline never double-applies a mutation", "typescript"
            ).lower()
        )

    def test_invariant_id_omitted_falls_back_to_slug(self):
        with_id = make_function_name(
            "AC3",
            "the pipeline never double-applies a mutation",
            "python",
            invariant_id="II3",
        )
        without_id = make_function_name(
            "AC3", "the pipeline never double-applies a mutation", "python"
        )
        assert with_id == "test_ii3"
        assert without_id != "test_ii3"
        assert without_id.startswith("test_ac3_")


class TestIntegrationLaneFunctionCount:
    """AC7.2: N acceptance criteria produce exactly N skeleton functions."""

    def test_int_lane_with_three_acs_produces_exactly_three_skeletons(
        self, tmp_path, monkeypatch
    ):
        monkeypatch.chdir(tmp_path)
        lanes = {"task-B": _integration_lane()}
        tasks_path = _write_lane_plan(tmp_path, lanes, ["task-B"])

        result = run_preflight(
            task_id="task-B",
            language="python",
            tasks_path=tasks_path,
            output_path=None,
            skip_file_writes=True,
        )

        outputs = result["outputs"]
        assert len(outputs) == 3
        function_names = {o["function_name"] for o in outputs}
        assert function_names == {
            "test_ii1",
            "test_ii2",
            "test_ii3",
        }, f"expected invariant-id-derived, unique function names, got: {function_names}"


class TestRunBatchMixedLanePlan:
    """run_batch over task lanes + INT lanes leaves task-lane output unchanged."""

    def test_task_lane_output_unchanged_when_batch_also_contains_int_lane(
        self, tmp_path, monkeypatch
    ):
        monkeypatch.chdir(tmp_path)
        lanes = {
            "task-A": _ordinary_lane(),
            "task-B": _integration_lane(),
        }
        tasks_path = _write_lane_plan(tmp_path, lanes, ["task-A", "task-B"])
        output_dir = tmp_path / "out"

        summary = run_batch(
            language="python",
            tasks_path=tasks_path,
            output_dir=output_dir,
            skip_file_writes=True,
        )

        assert summary["tasks"]["task-A"]["skeleton_count"] == 2
        task_a_artifact = json.loads((output_dir / "preflight-task-A.json").read_text())
        paths = {o["path"] for o in task_a_artifact["outputs"]}
        # Ordinary lane keeps deriving per-AC paths (all from the same inferred
        # test file here, since infer_test_path is source-derived) — distinct
        # from the INT lane's contract of forcing files[0] regardless of AC text.
        assert paths == {"tests/test_score.py"}
        function_names = [o["function_name"] for o in task_a_artifact["outputs"]]
        assert function_names == [
            "test_ac1_compute_score_x_returns_a_float",
            "test_ac2_compute_score_x_raises_valueerror_on_negative_input",
        ]

        assert summary["tasks"]["task-B"]["skeleton_count"] == 3
        task_b_artifact = json.loads((output_dir / "preflight-task-B.json").read_text())
        int_paths = {o["path"] for o in task_b_artifact["outputs"]}
        assert int_paths == {"verify/lane_checks.py"}


class TestIntegrationLaneParentDirCreatedOnDemand:
    """The INT lane's test file parent directory is created when applied."""

    def test_parent_directory_created_on_apply_when_missing(
        self, tmp_path, monkeypatch
    ):
        monkeypatch.chdir(tmp_path)
        lanes = {
            "task-B": _integration_lane(
                files=["verify/nested/lane_checks.py", "src/pkg/pipeline.py"]
            )
        }
        tasks_path = _write_lane_plan(tmp_path, lanes, ["task-B"])

        target_dir = tmp_path / "verify" / "nested"
        assert not target_dir.exists()

        run_preflight(
            task_id="task-B",
            language="python",
            tasks_path=tasks_path,
            output_path=None,
            skip_file_writes=False,
        )

        assert target_dir.exists()
        assert (target_dir / "lane_checks.py").exists()


def test_extract_invariant_id_accepts_hyphenated_ids():
    """derive_integration_lanes leads each AC with the row id; PROPERTIES tables
    use both `II3` and `INV-020` shapes, and both must name the skeleton test."""
    from datum.skeleton_creator import _extract_invariant_id

    assert _extract_invariant_id("II3: output is unique") == "II3"
    assert _extract_invariant_id("INV-020: output is unique") == "INV-020"
    assert _extract_invariant_id("output is unique") is None
