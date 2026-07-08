"""Tests for per-lane test_command detection and preflight validation (#326, #307)."""

from datum.lane_plan import (
    build_lane_plan,
    detect_lane_test_command,
    infer_lane_language,
    detect_command_language,
    validate_lane_test_commands,
)


class TestInferLaneLanguage:
    def test_typescript_files(self):
        assert infer_lane_language(["skills/src/datum-tdd-act-lane.ts"]) == "typescript"

    def test_typescript_test_file(self):
        assert (
            infer_lane_language(["skills/src/datum-tdd-act-lane.test.ts"])
            == "typescript"
        )

    def test_python_files(self):
        assert (
            infer_lane_language(["datum/lane_plan.py", "tests/test_x.py"]) == "python"
        )

    def test_swift_files(self):
        assert infer_lane_language(["Sources/Domain/Protocol.swift"]) == "swift"

    def test_unknown_extension_returns_none(self):
        assert infer_lane_language(["docs/README.md", "config.json"]) is None

    def test_majority_wins_on_mixed_extensions(self):
        files = ["a.py", "b.py", "c.ts"]
        assert infer_lane_language(files) == "python"

    def test_empty_files_returns_none(self):
        assert infer_lane_language([]) is None


class TestTestCommandLanguage:
    def test_pytest_command(self):
        assert detect_command_language("uv run pytest -x -q") == "python"

    def test_vitest_command(self):
        assert detect_command_language("npx vitest run") == "typescript"

    def test_unknown_command_returns_none(self):
        assert detect_command_language("make test") is None

    def test_none_command_returns_none(self):
        assert detect_command_language(None) is None


class TestDetectLaneTestCommand:
    def test_overrides_when_global_is_wrong_language(self):
        files = [
            "skills/src/datum-tdd-act-lane.ts",
            "skills/src/datum-tdd-act-lane.test.ts",
        ]
        cmd = detect_lane_test_command(files, "uv run pytest -x -q")
        assert cmd == "npx vitest run"

    def test_no_override_when_global_already_matches(self):
        files = ["datum/lane_plan.py"]
        cmd = detect_lane_test_command(files, "uv run pytest -x -q")
        assert cmd is None

    def test_no_override_when_language_unknown(self):
        cmd = detect_lane_test_command(["docs/README.md"], "uv run pytest -x -q")
        assert cmd is None

    def test_no_override_when_global_command_missing(self):
        files = ["skills/src/foo.ts"]
        cmd = detect_lane_test_command(files, None)
        assert cmd == "npx vitest run"


class TestValidateLaneTestCommands:
    def test_flags_mismatched_lane(self):
        lanes = {
            "lane-1": {
                "files": ["skills/src/foo.ts"],
                "test_command": "uv run pytest -x -q",
            }
        }
        errors = validate_lane_test_commands(lanes)
        assert len(errors) == 1
        assert "lane-1" in errors[0]
        assert "typescript" in errors[0]

    def test_passes_matching_lane(self):
        lanes = {
            "lane-1": {
                "files": ["skills/src/foo.ts"],
                "test_command": "npx vitest run",
            }
        }
        assert validate_lane_test_commands(lanes) == []

    def test_no_test_command_is_not_flagged(self):
        lanes = {"lane-1": {"files": ["skills/src/foo.ts"]}}
        assert validate_lane_test_commands(lanes) == []

    def test_unknown_lane_language_is_not_flagged(self):
        lanes = {
            "lane-1": {
                "files": ["docs/README.md"],
                "test_command": "uv run pytest -x -q",
            }
        }
        assert validate_lane_test_commands(lanes) == []


class TestBuildLanePlanTestCommandOverride:
    def _task(self, tid, files, **extra):
        return {
            "id": tid,
            "title": tid,
            "files": files,
            "acceptance_criteria": ["it works"],
            "red_note": "red",
            "depends_on": [],
            **extra,
        }

    def test_sets_override_for_typescript_lane(self):
        tasks = [self._task("lane-ts", ["skills/src/foo.ts"])]
        plan = build_lane_plan(
            tasks, ["lane-ts"], {}, global_test_command="uv run pytest -x -q"
        )
        assert plan["lanes"]["lane-ts"]["test_command"] == "npx vitest run"

    def test_no_override_for_python_lane(self):
        tasks = [self._task("lane-py", ["datum/lane_plan.py"])]
        plan = build_lane_plan(
            tasks, ["lane-py"], {}, global_test_command="uv run pytest -x -q"
        )
        assert "test_command" not in plan["lanes"]["lane-py"]

    def test_explicit_task_test_command_wins(self):
        tasks = [
            self._task(
                "lane-explicit",
                ["skills/src/foo.ts"],
                test_command="npx vitest run --project custom",
            )
        ]
        plan = build_lane_plan(
            tasks, ["lane-explicit"], {}, global_test_command="uv run pytest -x -q"
        )
        assert (
            plan["lanes"]["lane-explicit"]["test_command"]
            == "npx vitest run --project custom"
        )
