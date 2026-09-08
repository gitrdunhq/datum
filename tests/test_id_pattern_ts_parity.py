"""Review ARCH-001 / CORR-003 (#514): the lane id pattern is written ONCE, in
assets/schemas/task.schema.json. skills/src/shared/lane-id-pattern.ts must
import that file rather than restate the regex — this test reads the .ts
source and fails if a hand-written copy creeps back in."""

from pathlib import Path


def _ts_source_path() -> Path:
    return (
        Path(__file__).resolve().parent.parent
        / "skills"
        / "src"
        / "shared"
        / "lane-id-pattern.ts"
    )


class TestTsConsumesTaskSchema:
    def test_ts_source_imports_task_schema_json(self):
        source = _ts_source_path().read_text(encoding="utf-8")
        assert "assets/schemas/task.schema.json" in source

    def test_ts_source_carries_no_pattern_literal_of_its_own(self):
        source = _ts_source_path().read_text(encoding="utf-8")
        assert "[A-Z]" not in source
        assert "task-INT" not in source

    def test_ts_source_still_exports_the_pattern_and_predicate(self):
        source = _ts_source_path().read_text(encoding="utf-8")
        assert "export const LANE_ID_PATTERN" in source
        assert "export function isLaneId" in source
