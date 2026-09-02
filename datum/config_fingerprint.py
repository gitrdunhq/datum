"""Fingerprint the datum config files the datum-go boot agent reads (#354).

`Workflow({resumeFromRunId})` replays every agent() call whose (prompt,
opts) is unchanged. The boot agent's prompt embeds this fingerprint, so an
edited `.datum/config.json` or `~/.datum/config.json` changes the cache key
and forces a live re-read, while an unchanged config still cache-hits.

Scripts have no filesystem access, so the launcher computes it with
`datum config-fingerprint` and passes it in `args.configFingerprint`.
"""

# tested-by: tests/test_config_fingerprint.py

from __future__ import annotations

import hashlib
from pathlib import Path

REPO_CONFIG = Path(".datum") / "config.json"
GLOBAL_CONFIG = Path(".datum") / "config.json"


def config_fingerprint(repo_root: Path, home: Path) -> str:
    """SHA-256 over the ordered (label, contents) of both config files.

    Missing files hash as a distinct "missing" marker, so presence changes
    the fingerprint too. Labels are mixed in so the same bytes moving from
    the global file to the repo file is detected.
    """
    h = hashlib.sha256()
    for label, path in (
        ("global", Path(home) / GLOBAL_CONFIG),
        ("repo", Path(repo_root) / REPO_CONFIG),
    ):
        h.update(label.encode())
        h.update(b"\0")
        if path.is_file():
            data = path.read_bytes()
            h.update(str(len(data)).encode())
            h.update(b"\0")
            h.update(data)
        else:
            h.update(b"missing")
        h.update(b"\0")
    return f"sha256:{h.hexdigest()}"
