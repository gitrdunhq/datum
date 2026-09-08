import json
import re
import subprocess
import uuid
from pathlib import Path


class TaskIdPrefixError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.payload = {
            "code": "task_id_prefix_invalid",
            "message": message,
            "correlationId": str(uuid.uuid4()),
        }


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
            return existing

    prefix = _derive_prefix(repo_root)

    config["task_id_prefix"] = prefix
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(config))
    return prefix


def next_task_number(repo_root, prefix):
    repo_root = Path(repo_root)
    ls_tree = subprocess.run(
        ["git", "ls-tree", "-r", "HEAD", "--name-only"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    )
    paths = [p for p in ls_tree.stdout.splitlines() if p]

    pattern = re.compile(rf"{re.escape(prefix)}-(\d+)")
    max_number = 0
    for path in paths:
        show = subprocess.run(
            ["git", "show", f"HEAD:{path}"],
            cwd=repo_root,
            capture_output=True,
            text=True,
        )
        if show.returncode != 0:
            continue
        for match in pattern.finditer(show.stdout):
            max_number = max(max_number, int(match.group(1)))

    return max_number + 1
