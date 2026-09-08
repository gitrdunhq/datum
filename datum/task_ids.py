"""Repo-wide sequential task ids (#514).

`next_task_number` is max(existing committed id) + 1 over the two committed
files that declare or reference lane ids — `docs/epics/*/tasks.json` and
`docs/epics/*/lane-plan.json` — read at HEAD through `git ls-tree` +
`git show`, never the working tree. Nothing else is ever decoded: prose
(SPEC.md quoting `DAT-142`), binaries and unrelated files cannot move the
counter or crash it (review PERF-001 / CORR-001).
"""

import json
import re
import subprocess
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import NamedTuple

from datum.id_pattern import is_lane_id

EPIC_ID_FILE_RE = re.compile(
    r"^docs/epics/(?P<epic>.+)/(?P<name>tasks|lane-plan)\.json$"
)


class TaskIdPrefixError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.payload = {
            "code": "task_id_prefix_invalid",
            "message": message,
            "correlationId": str(uuid.uuid4()),
        }


class CommittedId(NamedTuple):
    path: str
    epic: str
    id: str
    declared: bool  # True for a task/lane id, False for a depends_on reference


def _derive_prefix(repo_root):
    name = Path(repo_root).name
    letters = re.sub(r"[^A-Za-z]", "", name).upper()
    if len(letters) < 2:
        raise TaskIdPrefixError(
            f"cannot derive a task_id_prefix from repo directory name {name!r}: "
            "at least 2 letters are required"
        )
    return letters[:3]


def resolve_task_id_prefix(repo_root):
    repo_root = Path(repo_root)
    config_path = repo_root / ".datum" / "config.json"

    config = {}
    if config_path.exists():
        config = json.loads(config_path.read_text())
        existing = config.get("task_id_prefix")
        if existing:
            # #514 FU-1: the configured prefix seeds every generated id and
            # reaches --renumber before any schema check — hold it to the
            # shape the derived path enforces (the shared lane id pattern).
            if not isinstance(existing, str) or not is_lane_id(f"{existing}-1"):
                raise TaskIdPrefixError(
                    f"task_id_prefix {existing!r} in {config_path} is not a valid "
                    "prefix: 2-6 uppercase letters, not DATUM"
                )
            return existing

    prefix = _derive_prefix(repo_root)

    config["task_id_prefix"] = prefix
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(config))
    return prefix


def epic_name_for_path(path: str) -> str:
    """`docs/epics/<name>/tasks.json` or `.../lane-plan.json` -> `<name>`
    (nested names keep their slashes: `docs/epics/datum/epic-1/tasks.json`
    -> `datum/epic-1`). Any other path is returned unchanged."""
    match = EPIC_ID_FILE_RE.match(path)
    return match.group("epic") if match else path


def _committed_epic_id_files(git_root: Path) -> list[str]:
    ls_tree = subprocess.run(
        ["git", "ls-tree", "-r", "HEAD", "--name-only", "--", "docs/epics"],
        cwd=git_root,
        capture_output=True,
        text=True,
        check=True,
    )
    return [p for p in ls_tree.stdout.splitlines() if EPIC_ID_FILE_RE.match(p)]


def _items_of(data, name: str) -> list[dict]:
    if name == "tasks":
        items = data.get("tasks") if isinstance(data, dict) else data
        return (
            [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []
        )
    lanes = data.get("lanes") if isinstance(data, dict) else None
    if not isinstance(lanes, dict):
        return []
    items = []
    for key, lane in lanes.items():
        if isinstance(lane, dict):
            items.append(
                {"id": lane.get("id", key), "depends_on": lane.get("depends_on", [])}
            )
    order = data.get("topological_order")
    if isinstance(order, list):
        items.extend({"id": i, "depends_on": []} for i in order if isinstance(i, str))
    return items


def iter_committed_ids(git_root: Path) -> Iterator[CommittedId]:
    """Every id declared by, or referenced from, a committed
    docs/epics/*/{tasks,lane-plan}.json at HEAD. Unparseable files are skipped."""
    git_root = Path(git_root)
    for path in _committed_epic_id_files(git_root):
        show = subprocess.run(
            ["git", "show", f"HEAD:{path}"],
            cwd=git_root,
            capture_output=True,
        )
        if show.returncode != 0:
            continue
        try:
            data = json.loads(show.stdout.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            continue
        epic = epic_name_for_path(path)
        for item in _items_of(data, EPIC_ID_FILE_RE.match(path).group("name")):
            tid = item.get("id")
            if isinstance(tid, str):
                yield CommittedId(path, epic, tid, True)
            deps = item.get("depends_on")
            if isinstance(deps, list):
                for dep in deps:
                    if isinstance(dep, str):
                        yield CommittedId(path, epic, dep, False)


def next_task_number(repo_root, prefix):
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
    max_number = 0
    for committed in iter_committed_ids(Path(repo_root)):
        match = pattern.match(committed.id)
        if match:
            max_number = max(max_number, int(match.group(1)))
    return max_number + 1
