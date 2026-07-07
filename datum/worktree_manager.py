"""worktree_manager.py — git worktree lifecycle for parallel ACT lanes.

One worktree per lane under .datum/worktrees/<run_id>/<lane_id>/.
Each lane gets an isolated sub-branch: <epic_branch>--<lane_id>.
Agents write and commit freely inside their worktree — no shared index,
no index.lock contention, no commit queue needed during ACT.

Merge integration (after all lanes complete) is done by the orchestrator
calling merge_lane_branches(), which squash-merges lanes in dependency
order, producing a single commit on the epic branch.

See: references/git-workflows.md and GitHub issue #137.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

WORKTREE_ROOT = ".datum/worktrees"


def _git(args: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + args,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=check,
    )


def create_lane_worktree(
    epic_branch: str,
    lane_id: str,
    run_id: str,
    base_sha: str,
    *,
    repo_root: Path | None = None,
) -> Path:
    """Create an isolated worktree for a lane and return its path.

    Creates:
      branch:   <epic_branch>--<lane_id>
      worktree: .datum/worktrees/<run_id>/<lane_id>

    The worktree starts at base_sha (the epic branch tip at pipeline start),
    so all lanes share a common ancestor and cherry-picks / merges are clean.
    """
    repo_root = (repo_root or Path(".")).resolve()
    worktree_path = repo_root / WORKTREE_ROOT / run_id / lane_id
    lane_branch = f"{epic_branch}--{lane_id}"

    worktree_path.parent.mkdir(parents=True, exist_ok=True)

    # Resume: if worktree already exists and is registered, reuse it.
    if worktree_path.exists():
        registered = _git(
            ["worktree", "list", "--porcelain"], cwd=repo_root, check=False
        )
        if str(worktree_path) in registered.stdout:
            return worktree_path

    result = _git(
        ["worktree", "add", str(worktree_path), "-b", lane_branch, base_sha],
        cwd=repo_root,
        check=False,
    )
    if result.returncode != 0:
        # lane_branch has no run_id in its name (only worktree_path does), so a
        # branch left over from an earlier incomplete run collides with -b here.
        # Reuse it (checkout, no -b) instead of deleting/recreating — preserves
        # any RED/GREEN work already on it and never needs branch deletion.
        branch_exists = (
            _git(
                ["rev-parse", "--verify", "--quiet", lane_branch],
                cwd=repo_root,
                check=False,
            ).returncode
            == 0
        )
        if branch_exists:
            result = _git(
                ["worktree", "add", str(worktree_path), lane_branch],
                cwd=repo_root,
                check=False,
            )
        if result.returncode != 0:
            # A stale worktree from an even earlier incomplete run may still hold
            # lane_branch checked out ("already used by worktree at '<path>'").
            # That worktree's directory is orphaned (its run finished/errored
            # without cleanup) — deregister it (not the branch, not its commits)
            # so lane_branch is free, then retry the checkout.
            match = re.search(r"already used by worktree at '([^']+)'", result.stderr)
            if match:
                stale_path = match.group(1)
                # Non-force remove: git itself refuses if the stale worktree has
                # uncommitted changes, so this never silently discards work.
                remove_result = _git(
                    ["worktree", "remove", stale_path],
                    cwd=repo_root,
                    check=False,
                )
                if remove_result.returncode != 0:
                    raise RuntimeError(
                        f"lane branch {lane_branch} is locked to stale worktree "
                        f"{stale_path}, which has uncommitted changes and cannot "
                        f"be auto-removed: {remove_result.stderr.strip()}. "
                        f"Inspect and resolve it manually before retrying."
                    )
                _git(["worktree", "prune"], cwd=repo_root, check=False)
                result = _git(
                    ["worktree", "add", str(worktree_path), lane_branch],
                    cwd=repo_root,
                    check=False,
                )
        if result.returncode != 0:
            raise RuntimeError(
                f"git worktree add failed for lane {lane_id}: {result.stderr.strip()}"
            )
    return worktree_path


def remove_lane_worktree(
    lane_id: str,
    run_id: str,
    epic_branch: str,
    *,
    repo_root: Path | None = None,
    force: bool = True,
) -> None:
    """Remove a lane worktree and delete its sub-branch.

    Fails open: errors are not raised so pipeline teardown always completes.
    """
    repo_root = (repo_root or Path(".")).resolve()
    worktree_path = repo_root / WORKTREE_ROOT / run_id / lane_id
    lane_branch = f"{epic_branch}--{lane_id}"

    flags = ["--force"] if force else []
    _git(["worktree", "remove", str(worktree_path)] + flags, cwd=repo_root, check=False)
    _git(["branch", "-D", lane_branch], cwd=repo_root, check=False)


def prune_stale_worktrees(repo_root: Path | None = None) -> None:
    """Remove administrative files for worktrees that no longer exist on disk."""
    repo_root = (repo_root or Path(".")).resolve()
    _git(["worktree", "prune"], cwd=repo_root)


def list_worktrees(repo_root: Path | None = None) -> list[dict]:
    """Return structured info for every registered worktree.

    Each dict has keys: path, sha (optional), branch (optional).
    """
    repo_root = (repo_root or Path(".")).resolve()
    result = _git(["worktree", "list", "--porcelain"], cwd=repo_root)

    worktrees: list[dict] = []
    current: dict = {}
    for line in result.stdout.splitlines():
        if line.startswith("worktree "):
            if current:
                worktrees.append(current)
            current = {"path": line[len("worktree ") :]}
        elif line.startswith("HEAD "):
            current["sha"] = line[5:]
        elif line.startswith("branch "):
            current["branch"] = line[7:]
        elif line == "" and current:
            worktrees.append(current)
            current = {}
    if current:
        worktrees.append(current)
    return worktrees


def setup_pipeline_worktrees(
    run_id: str,
    epic_branch: str,
    lane_ids: list[str],
    *,
    repo_root: Path | None = None,
) -> dict[str, Path]:
    """Create one worktree per lane and return a mapping of lane_id → worktree path.

    base_sha is taken from the current HEAD of epic_branch so all lanes share
    the same ancestor.

    Raises RuntimeError if the epic branch does not exist.
    """
    repo_root = (repo_root or Path(".")).resolve()

    result = _git(["rev-parse", epic_branch], cwd=repo_root, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"Epic branch '{epic_branch}' not found. "
            f"Create it before setting up pipeline worktrees."
        )
    base_sha = result.stdout.strip()

    mapping: dict[str, Path] = {}
    for lane_id in lane_ids:
        mapping[lane_id] = create_lane_worktree(
            epic_branch, lane_id, run_id, base_sha, repo_root=repo_root
        )
    return mapping


def merge_lane_branches(
    epic_branch: str,
    lane_order: list[str],
    commit_message: str,
    *,
    repo_root: Path | None = None,
) -> str:
    """Squash-merge all completed lane branches into the epic branch.

    Merges in lane_order (dependency order: depended-on lanes first).
    All accumulated changes land in one commit, satisfying the squash-before-push rule.

    Returns the SHA of the resulting merge commit.
    Raises RuntimeError on any git failure.
    """
    repo_root = (repo_root or Path(".")).resolve()

    checkout = _git(["checkout", epic_branch], cwd=repo_root, check=False)
    if checkout.returncode != 0:
        raise RuntimeError(
            f"Cannot checkout '{epic_branch}': {checkout.stderr.strip()}"
        )

    for lane_id in lane_order:
        lane_branch = f"{epic_branch}--{lane_id}"
        result = _git(
            ["merge", "--squash", "--no-commit", lane_branch],
            cwd=repo_root,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"Squash-merge of lane '{lane_id}' failed: {result.stderr.strip()}"
            )

    commit = _git(["commit", "-m", commit_message], cwd=repo_root, check=False)
    if commit.returncode != 0:
        raise RuntimeError(
            f"Merge commit failed: {commit.stderr.strip()}\n{commit.stdout.strip()}"
        )

    sha = _git(["rev-parse", "HEAD"], cwd=repo_root).stdout.strip()
    return sha


def cleanup_run_worktrees(
    run_id: str,
    epic_branch: str,
    *,
    repo_root: Path | None = None,
) -> list[str]:
    """Remove all lane worktrees for a given run_id, plus its root worktree.

    Discovers lanes by listing .datum/worktrees/<run_id>/. The root worktree
    at .datum/worktrees/<run_id>-root (created --detach, no branch to delete)
    is force-removed too — this is the sole cleanup entrypoint so pipeline
    teardown never needs a raw `git worktree remove` in an agent prompt.
    Returns list of lane_ids (plus "<run_id>-root" if present) cleaned up.
    """
    repo_root = (repo_root or Path(".")).resolve()
    run_dir = repo_root / WORKTREE_ROOT / run_id

    cleaned: list[str] = []
    if run_dir.exists():
        for lane_dir in sorted(run_dir.iterdir()):
            if lane_dir.is_dir():
                lane_id = lane_dir.name
                remove_lane_worktree(lane_id, run_id, epic_branch, repo_root=repo_root)
                cleaned.append(lane_id)
        try:
            run_dir.rmdir()
        except OSError:
            pass

    root_dir = repo_root / WORKTREE_ROOT / f"{run_id}-root"
    if root_dir.exists():
        _git(
            ["worktree", "remove", str(root_dir), "--force"], cwd=repo_root, check=False
        )
        cleaned.append(f"{run_id}-root")

    prune_stale_worktrees(repo_root=repo_root)

    return cleaned


def housekeep_epic(epic_branch: str, *, repo_root: Path | None = None) -> dict:
    """Delete merged lane branches for one epic, its pipeline-state marker, and prune worktree refs.

    Only removes branches git already reports as merged (`branch -d`, never
    `-D`), and only those matching the exact `<epic_branch>--` prefix — never
    other epics/runs. Deterministic, no LLM in the loop, so closeout never
    needs a raw `git branch --merged | xargs git branch -d` pipeline in an
    agent prompt.
    """
    repo_root = (repo_root or Path(".")).resolve()

    state_path = repo_root / ".datum" / "pipeline-state.json"
    state_removed = state_path.exists()
    if state_removed:
        state_path.unlink()

    merged = _git(["branch", "--merged"], cwd=repo_root, check=False).stdout
    prefix = f"{epic_branch}--"
    deleted: list[str] = []
    for line in merged.splitlines():
        name = line.strip().lstrip("*").strip()
        if name.startswith(prefix):
            result = _git(["branch", "-d", name], cwd=repo_root, check=False)
            if result.returncode == 0:
                deleted.append(name)

    prune_stale_worktrees(repo_root=repo_root)

    return {"deleted_branches": deleted, "pipeline_state_removed": state_removed}


def worktree_path_for_lane(
    lane_id: str,
    run_id: str,
    *,
    repo_root: Path | None = None,
) -> Path:
    """Return the expected worktree path for a lane (may or may not exist yet)."""
    repo_root = (repo_root or Path(".")).resolve()
    return repo_root / WORKTREE_ROOT / run_id / lane_id


def write_lane_order(lane_order: list[str], repo_root: Path | None = None) -> None:
    """Persist the merge order to .datum/lane-order.json for the merge step."""
    repo_root = (repo_root or Path(".")).resolve()
    order_file = repo_root / ".datum" / "lane-order.json"
    order_file.parent.mkdir(parents=True, exist_ok=True)
    order_file.write_text(json.dumps(lane_order, indent=2))


def read_lane_order(repo_root: Path | None = None) -> list[str]:
    """Read the persisted merge order from .datum/lane-order.json."""
    repo_root = (repo_root or Path(".")).resolve()
    order_file = repo_root / ".datum" / "lane-order.json"
    if not order_file.exists():
        return []
    return json.loads(order_file.read_text())
