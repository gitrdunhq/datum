"""Fingerprint every human-editable input a resumed pipeline must notice (#354).

`Workflow({resumeFromRunId})` replays every agent() call whose (prompt,
opts) is unchanged — the boot config read, but equally every deterministic
batch that reads an epic doc and every gate that judges one. A dogfooding
run halted at the Refine gate on five unanswered questions; the human
answered QUESTIONS.md and resumed, and the cached gate replayed "5
unanswered" in 18 ms. The scripts stamp this fingerprint into every batch
prompt (skills/src/shared/batch.ts setBatchCacheKey), so it covers:

- `.datum/config.json` and `~/.datum/config.json`
- every `*.md` / `*.json` directly inside the current epic dir
  (TICKET, QUESTIONS, SPEC, TASKS, tasks.json, lane-plan*.json)
- `.datum/pipeline-state.json`

Scripts have no filesystem access, so the launcher computes it with
`datum config-fingerprint` and passes it in `args.configFingerprint` on
EVERY launch, resumes included.
"""

# tested-by: tests/test_config_fingerprint.py

from __future__ import annotations

import hashlib
from pathlib import Path

REPO_CONFIG = Path(".datum") / "config.json"
GLOBAL_CONFIG = Path(".datum") / "config.json"
PIPELINE_STATE = Path(".datum") / "pipeline-state.json"
EPIC_DOC_SUFFIXES = (".md", ".json")


def _mix_file(h: hashlib._Hash, label: str, path: Path) -> None:
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


def config_fingerprint(
    repo_root: Path, home: Path, epic_dir: Path | None = None
) -> str:
    """SHA-256 over the ordered (label, contents) of every resume-relevant input.

    Missing files hash as a distinct "missing" marker, so presence changes
    the fingerprint too. Labels are mixed in so the same bytes moving from
    one file to another is detected. Only files DIRECTLY inside ``epic_dir``
    count (not siblings, not the rest of the repo) so unrelated edits keep
    the cache warm.
    """
    h = hashlib.sha256()
    _mix_file(h, "global", Path(home) / GLOBAL_CONFIG)
    _mix_file(h, "repo", Path(repo_root) / REPO_CONFIG)
    _mix_file(h, "state", Path(repo_root) / PIPELINE_STATE)
    if epic_dir is not None and Path(epic_dir).is_dir():
        for p in sorted(Path(epic_dir).iterdir()):
            if p.is_file() and p.suffix in EPIC_DOC_SUFFIXES:
                _mix_file(h, f"epic:{p.name}", p)
    return f"sha256:{h.hexdigest()}"
