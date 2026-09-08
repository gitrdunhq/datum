"""RED for task-006 (#528): TypeScript's lane-id-pattern.ts must define the
exact same LANE_ID_PATTERN literal as datum.id_pattern.LANE_ID_PATTERN — this
test reads the .ts source directly and fails loudly if either side is edited
alone."""

import re
from pathlib import Path

from datum.id_pattern import LANE_ID_PATTERN as PY_LANE_ID_PATTERN


def _ts_source_path() -> Path:
    return (
        Path(__file__).resolve().parent.parent
        / "skills"
        / "src"
        / "shared"
        / "lane-id-pattern.ts"
    )


def _extract_ts_pattern_literal(source: str) -> str:
    """Pull the string assigned to `export const LANE_ID_PATTERN = ...`.

    The TS literal is written as a single- or double-quoted string (possibly
    built from concatenated adjacent string literals across lines, mirroring
    the Python source's implicit string concatenation) so both sides can be
    diffed as plain text after quote characters are stripped.
    """
    match = re.search(
        r"export\s+const\s+LANE_ID_PATTERN\s*(?::\s*string)?\s*=\s*((?:['\"][^'\"]*['\"]\s*\+?\s*)+);",
        source,
    )
    assert (
        match
    ), f"no `export const LANE_ID_PATTERN = ...` assignment found in {source!r}"
    pieces = re.findall(r"['\"]([^'\"]*)['\"]", match.group(1))
    return "".join(pieces)


class TestTsPythonLaneIdPatternParity:
    def test_ts_source_defines_lane_id_pattern_export(self):
        source = _ts_source_path().read_text(encoding="utf-8")
        assert "LANE_ID_PATTERN" in source

    def test_ts_lane_id_pattern_literal_equals_python_literal_exactly(self):
        source = _ts_source_path().read_text(encoding="utf-8")
        ts_pattern = _extract_ts_pattern_literal(source)
        assert ts_pattern == PY_LANE_ID_PATTERN, (
            f"lane-id-pattern.ts LANE_ID_PATTERN ({ts_pattern!r}) has drifted from "
            f"datum.id_pattern.LANE_ID_PATTERN ({PY_LANE_ID_PATTERN!r})"
        )

    def test_ts_lane_id_pattern_is_anchored_like_python_side(self):
        source = _ts_source_path().read_text(encoding="utf-8")
        ts_pattern = _extract_ts_pattern_literal(source)
        assert ts_pattern.startswith("^")
        assert ts_pattern.endswith("$")
