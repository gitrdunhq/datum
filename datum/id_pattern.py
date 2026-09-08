"""Single-source lane id pattern (#523).

Accepts legacy ``task-N`` / ``task-INT-N`` ids alongside short-prefix ids
like ``DAT-142``, while rejecting the literal ``DATUM-`` prefix (reserved
for the project name itself) and lowercase short prefixes.
"""

from __future__ import annotations

import re

LANE_ID_PATTERN = (
    r"^(?:task-\d+|task-INT-\d+|[A-Z]{2,3}-\d+|"
    r"(?:[A-SU-Z][A-Z]{3}|T[B-Z][A-Z]{2}|TA[A-RT-Z][A-Z]|TAS[A-JL-Z])-\d+|"
    r"(?:[A-CE-Z][A-Z]{4}|D[B-Z][A-Z]{3}|DA[A-SU-Z][A-Z]{2}|"
    r"DAT[A-TV-Z][A-Z]|DATU[A-LN-Z])-\d+|[A-Z]{6}-\d+)$"
)


def is_lane_id(value: str) -> bool:
    return re.fullmatch(LANE_ID_PATTERN, value) is not None
