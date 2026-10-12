"""Run ids name a directory, .datum/runs/<run_id>, so each one is a single
plain path segment. The TypeScript runner checks the same pattern
(skills/src/runtime/metrics.ts RUN_ID_RE); a test keeps the two equal.
Review finding SEC-001 (run 20261012-150046).
"""

from __future__ import annotations

import argparse
import re

RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def run_id_arg(value: str) -> str:
    """argparse `type=` for --run-id: the id, or exit 2 naming run_id_invalid."""
    if not RUN_ID_RE.match(value):
        raise argparse.ArgumentTypeError(
            f"run_id_invalid: {value!r} is not one plain path segment ({RUN_ID_RE.pattern})"
        )
    return value
