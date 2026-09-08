"""Single-source lane id pattern (#523, #514).

The regex is written exactly once, in ``assets/schemas/task.schema.json``
under ``$defs.laneId.pattern``; this module loads it at import time and
``skills/src/shared/lane-id-pattern.ts`` imports the same file, so neither
side carries a copy that could drift. The pattern accepts legacy ``task-N``
/ ``task-INT-N`` ids alongside short-prefix ids like ``DAT-142``, while
rejecting the literal ``DATUM-`` prefix (reserved for the project name
itself) and lowercase short prefixes.
"""

from __future__ import annotations

import json
import re

from datum.path_utils import assets_dir

TASK_SCHEMA_PATH = assets_dir() / "schemas" / "task.schema.json"


def _load_pattern() -> str:
    schema = json.loads(TASK_SCHEMA_PATH.read_text(encoding="utf-8"))
    pattern = schema["$defs"]["laneId"]["pattern"]
    if not (
        isinstance(pattern, str) and pattern.startswith("^") and pattern.endswith("$")
    ):
        raise ValueError(
            f"{TASK_SCHEMA_PATH}: $defs.laneId.pattern must be an anchored regex"
        )
    return pattern


LANE_ID_PATTERN: str = _load_pattern()


def is_lane_id(value: str) -> bool:
    return re.fullmatch(LANE_ID_PATTERN, value) is not None
