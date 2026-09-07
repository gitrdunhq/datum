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
import shutil
import subprocess
from pathlib import Path

WORKTREE_ROOT = ".datum/worktrees"

_PATH_COMPONENT_RE = re.compile(r"^[a-zA-Z0-9_.-]+$")
_REF_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")


def _validate_path_component(value: str, label: str) -> None:
    """Reject values that could escape WORKTREE_ROOT via '..'/'/' segments
    when interpolated into a `WORKTREE_ROOT / value / ...` path, or that
    could be mistaken for a git command-line option (leading '-') once
    embedded — bare or as part of a `<epic_branch>--<lane_id>` string — in
    a git argv."""
    if (
        not value
        or not _PATH_COMPONENT_RE.match(value)
        or ".." in value
        or value.startswith("-")
    ):
        raise ValueError(f"{label} must be a safe path component: {value!r}")


def _validate_ref_arg(value: str, label: str) -> None:
    """Reject values unsafe to pass as a bare positional argv element to
    `git` (a branch name, base commit-ish, etc.). Unlike
    _validate_path_component this allows '/' (branch names routinely
    contain it), but still rejects a leading '-' (would be parsed as a
    git option instead of a ref), control characters/newlines, and '..'
    segments."""
    if (
        not value
        or value.startswith("-")
        or ".." in value
        or _REF_CONTROL_CHARS_RE.search(value)
    ):
        raise ValueError(f"{label} must be a safe git ref: {value!r}")


def _git(args: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + args,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=check,
    )


def _only_deletions(worktree_path: Path) -> bool:
    """True when the worktree's only uncommitted changes are deleted tracked
    files (every `git status --porcelain` line is ` D`/`D `). Such a
    checkout holds nothing that is not already on its branch."""
    if not worktree_path.is_dir():
        return False
    st = _git(["status", "--porcelain"], cwd=worktree_path, check=False)
    if st.returncode != 0:
        return False
    lines = [ln for ln in st.stdout.splitlines() if ln.strip()]
    return bool(lines) and all(ln[:2] in (" D", "D ") for ln in lines)


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
    _validate_path_component(run_id, "run_id")
    _validate_path_component(lane_id, "lane_id")
    _validate_ref_arg(epic_branch, "epic_branch")
    _validate_ref_arg(base_sha, "base_sha")
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
                if remove_result.returncode != 0 and _only_deletions(Path(stale_path)):
                    # A hollowed-out worktree: still registered, tracked files
                    # gone from disk (caliper BUG O — 557 ` D` lines and
                    # nothing else after a half-finished cleanup). Its branch
                    # keeps every commit; the checkout holds no work to lose.
                    remove_result = _git(
                        ["worktree", "remove", "--force", stale_path],
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
    worktree_path: Path | None = None,
) -> dict:
    """Remove a lane worktree; delete its sub-branch only if safe to do so.

    The worktree directory is always removed (it holds no commits of its
    own — the branch does). It is `<repo_root>/.datum/worktrees/<run>/<lane>`
    unless `worktree_path` names where git actually has it registered (the
    setup batch creates lanes from inside the batch's root worktree, so
    they nest under it). The lane sub-branch (<epic_branch>--<lane_id>)
    is force-deleted ONLY when it has zero commits beyond the point it was
    forked from the epic branch (checked via `git merge-base`, matching how
    create_lane_worktree() establishes base_sha). If the branch has real
    RED/GREEN commits, it is preserved and reported back so a caller can
    surface it rather than silently discarding work.

    Fails open: errors are not raised so pipeline teardown always completes.
    On any git failure while determining commit state, the branch is
    preserved (safer than guessing "empty").

    Returns:
        {"lane_id": ..., "branch": lane_branch, "deleted": bool, "preserved": bool}
    """
    try:
        _validate_path_component(run_id, "run_id")
        _validate_path_component(lane_id, "lane_id")
        _validate_ref_arg(epic_branch, "epic_branch")
    except ValueError:
        # Fails open (see docstring): refuse to touch anything rather than
        # raise, but never resolve a traversal-crafted path.
        return {"lane_id": lane_id, "branch": "", "deleted": False, "preserved": False}

    repo_root = (repo_root or Path(".")).resolve()
    if worktree_path is None:
        worktree_path = repo_root / WORKTREE_ROOT / run_id / lane_id
    lane_branch = f"{epic_branch}--{lane_id}"

    flags = ["--force"] if force else []
    _git(["worktree", "remove", str(worktree_path)] + flags, cwd=repo_root, check=False)

    branch_check = _git(
        ["rev-parse", "--verify", "--quiet", lane_branch], cwd=repo_root, check=False
    )
    if branch_check.returncode != 0:
        # Branch doesn't exist (already gone / never created) — nothing to do.
        return {
            "lane_id": lane_id,
            "branch": lane_branch,
            "deleted": False,
            "preserved": False,
        }

    merge_base = _git(
        ["merge-base", lane_branch, epic_branch], cwd=repo_root, check=False
    )
    lane_sha = _git(["rev-parse", lane_branch], cwd=repo_root, check=False)

    has_no_new_commits = (
        merge_base.returncode == 0
        and lane_sha.returncode == 0
        and merge_base.stdout.strip() == lane_sha.stdout.strip()
    )

    if has_no_new_commits:
        _git(["branch", "-D", lane_branch], cwd=repo_root, check=False)
        return {
            "lane_id": lane_id,
            "branch": lane_branch,
            "deleted": True,
            "preserved": False,
        }

    # Real commits (or undeterminable state) — preserve, don't delete.
    return {
        "lane_id": lane_id,
        "branch": lane_branch,
        "deleted": False,
        "preserved": True,
    }


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


DEFAULT_LINK_DIRS: tuple[str, ...] = ("node_modules", ".venv")


def main_checkout_root(repo_root: Path) -> Path:
    """The MAIN checkout for this repository (parent of the common git dir).

    Setup runs inside the batch's root worktree, which is itself a
    `git worktree add` and carries no installed dependencies; the shared
    dependency directories live only in the main checkout.
    """
    common = _git(["rev-parse", "--git-common-dir"], cwd=repo_root, check=False)
    if common.returncode != 0 or not common.stdout.strip():
        return repo_root
    return (repo_root / common.stdout.strip()).resolve().parent


# Per-lane installs from the tools' global content-addressable caches: each
# lane gets its OWN node_modules / .venv (hardlinked from the store, seconds,
# isolated from the other lanes) instead of sharing the main checkout's.
# (lockfile in the worktree, tool on PATH, command, directory it produces)
_INSTALLERS: tuple[tuple[str, str, list[str], str], ...] = (
    (
        "pnpm-lock.yaml",
        "pnpm",
        ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"],
        "node_modules",
    ),
    ("uv.lock", "uv", ["uv", "sync", "--frozen"], ".venv"),
)
_INSTALL_TIMEOUT_S = 600


def disable_worktree_hooks(worktree_path: Path, repo_root: Path) -> None:
    """Turn git hooks off for ONE worktree through per-worktree config.

    datum self-hosted wf_96fa4660-133: the developer's global hooks
    (core.hooksPath in ~/.config/git) fired inside every lane worktree — a
    post-checkout graph rebuild wrote graphify-out/ into the worktree and a
    later step left unmerged index entries, so a sound GREEN could not
    commit. Lane worktrees are datum's scratch checkouts; nothing a hook
    does there is wanted. The developer's own repo-level and global values
    are untouched: `extensions.worktreeConfig` is enabled once and the
    override lives in the worktree's own config.
    """
    _git(["config", "extensions.worktreeConfig", "true"], cwd=repo_root, check=False)
    _git(
        ["config", "--worktree", "core.hooksPath", "/dev/null"],
        cwd=worktree_path,
        check=False,
    )


def sync_args_from_config(config_path: Path | None = None) -> dict[str, list[str]]:
    """`worktree_sync_args` from .datum/config.json: extra args per installer
    tool, e.g. {"uv": ["--frozen", "--all-extras"]} when the main checkout
    carries extras the mandated test suite imports (numpy in [memory] here:
    a lane synced with --frozen alone failed pytest at collection)."""
    path = config_path or Path(".datum/config.json")
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text()).get("worktree_sync_args", {})
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        str(tool): [str(a) for a in args]
        for tool, args in raw.items()
        if isinstance(args, list)
    }


def install_lane_dependencies(
    worktree_path: Path, sync_args: dict[str, list[str]] | None = None
) -> list[str]:
    """Run each applicable per-lane installer; return the directories it
    produced. A failure is reported on stderr as deps_install_failed and the
    caller falls back to the symlink for that directory. `sync_args` replaces
    the tool's default arguments (after the subcommand) when it names the tool."""
    import shutil
    import sys

    produced: list[str] = []
    for lockfile, tool, default_cmd, out_dir in _INSTALLERS:
        if not (worktree_path / lockfile).exists() or shutil.which(tool) is None:
            continue
        cmd = default_cmd
        if sync_args and tool in sync_args:
            cmd = default_cmd[:2] + sync_args[tool]
        try:
            res = subprocess.run(
                cmd,
                cwd=worktree_path,
                capture_output=True,
                text=True,
                timeout=_INSTALL_TIMEOUT_S,
            )
        except subprocess.TimeoutExpired:
            print(
                f"deps_install_failed: {tool} timed out after {_INSTALL_TIMEOUT_S}s in {worktree_path}",
                file=sys.stderr,
            )
            continue
        if res.returncode != 0:
            tail = (res.stderr or res.stdout or "").strip().splitlines()[-3:]
            print(
                f"deps_install_failed: {' '.join(cmd)} exited {res.returncode} in {worktree_path}: {' | '.join(tail)}",
                file=sys.stderr,
            )
            continue
        if (worktree_path / out_dir).is_dir():
            produced.append(out_dir)
    return produced


def link_shared_dirs(
    worktree_path: Path, source_root: Path, dirs: list[str] | tuple[str, ...]
) -> list[str]:
    """Symlink each of `dirs` that exists under source_root into the lane
    worktree, unless the worktree already has that path (tracked content
    wins). Returns the names linked. This is how a fresh lane worktree gets
    a test environment (elonchesd wf_eb0f9f9b-7b1: `pnpm test` in a bare
    worktree exited 1 with "vitest: command not found" and every GREEN read
    as green_stale at the next intake).
    """
    linked: list[str] = []
    for name in dirs:
        name = name.strip()
        if not name or "/" in name or name in (".", ".."):
            continue
        src = source_root / name
        dst = worktree_path / name
        if not src.is_dir() or dst.exists() or dst.is_symlink():
            continue
        dst.symlink_to(src, target_is_directory=True)
        linked.append(name)
    return linked


def setup_pipeline_worktrees(
    run_id: str,
    epic_branch: str,
    lane_ids: list[str],
    *,
    repo_root: Path | None = None,
    link_dirs: list[str] | tuple[str, ...] = DEFAULT_LINK_DIRS,
) -> dict[str, Path]:
    """Create one worktree per lane and return a mapping of lane_id → worktree path.

    base_sha is taken from the current HEAD of epic_branch so all lanes share
    the same ancestor.

    Raises RuntimeError if the epic branch does not exist.
    """
    _validate_ref_arg(epic_branch, "epic_branch")
    repo_root = (repo_root or Path(".")).resolve()

    result = _git(["rev-parse", epic_branch], cwd=repo_root, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"Epic branch '{epic_branch}' not found. "
            f"Create it before setting up pipeline worktrees."
        )
    base_sha = result.stdout.strip()

    mapping: dict[str, Path] = {}
    source_root = main_checkout_root(repo_root)
    # The datum config is the MAIN checkout's (gitignored, so absent from the
    # batch's root worktree where setup runs — wf_498d1f29-3f9 synced every
    # lane with --frozen alone because the cwd had no config).
    sync_args = sync_args_from_config(source_root / ".datum" / "config.json")
    for lane_id in lane_ids:
        mapping[lane_id] = create_lane_worktree(
            epic_branch, lane_id, run_id, base_sha, repo_root=repo_root
        )
        disable_worktree_hooks(mapping[lane_id], repo_root)
        # Own install first (pnpm/uv global cache); symlink whatever remains.
        installed = install_lane_dependencies(mapping[lane_id], sync_args)
        link_shared_dirs(
            mapping[lane_id], source_root, [d for d in link_dirs if d not in installed]
        )
    return mapping


class LaneMergeError(RuntimeError):
    """A lane's squash-merge failed after zero or more earlier lanes landed.

    The lanes that merged cleanly before the failure are already folded into
    one commit (``sha``) and the checkout is clean; ``failed_lane`` is the
    one that did not land. Callers demote only that lane.
    """

    def __init__(
        self,
        message: str,
        *,
        failed_lane: str,
        merged: list[str],
        already_merged: list[str],
        sha: str,
        conflict_files: list[str] | None = None,
        report: str = "",
    ) -> None:
        super().__init__(message)
        self.failed_lane = failed_lane
        self.merged = merged
        self.already_merged = already_merged
        self.sha = sha
        self.conflict_files = list(conflict_files or [])
        self.report = report

    def payload(self) -> dict[str, str | list[str]]:
        return {
            "sha": self.sha,
            "merged": list(self.merged),
            "already_merged": list(self.already_merged),
            "failed_lane": self.failed_lane,
            "conflict_files": list(self.conflict_files),
            "report": self.report,
            "error": str(self),
        }


def merge_lane_branches(
    epic_branch: str,
    lane_order: list[str],
    commit_message: str,
    *,
    repo_root: Path | None = None,
    report_dir: Path | None = None,
) -> dict[str, str | list[str]]:
    """Squash-merge all completed lane branches into the epic branch.

    ``report_dir`` (the run directory) receives
    ``merge-conflict-<lane>.json`` — the conflicted paths and git's own
    output — when a lane's squash conflicts, so the reason survives the
    lane's demotion (elonchesd wf_8769406f-b9c task-015).

    Merges in lane_order (dependency order: depended-on lanes first).
    All accumulated changes land in one commit, satisfying the squash-before-push rule.

    Each lane's squash is committed as a temporary commit as soon as it is
    staged, and the temporary commits are folded into the single batch
    commit at the end (``git reset --soft`` to the starting sha, then one
    commit). Leaving lane 1 staged-but-uncommitted made lane 2's
    ``git merge --squash`` refuse with "Your local changes to the following
    files would be overwritten by merge" whenever both lanes touched the
    same file, even without a content conflict (elonchesd run
    wf_4f1e41dd-ab7, batch 3/5).

    A later lane that really conflicts raises LaneMergeError: the lanes
    that merged before it are folded into one commit and kept, the checkout
    is left clean, and the error carries ``failed_lane`` / ``merged`` /
    ``sha`` separately so the caller demotes only the failed lane.

    Before merging anything, checks every lane branch in lane_order for
    paths it adds/modifies that collide with an untracked file already
    sitting in the root checkout. If any lane would collide, raises
    RuntimeError naming every conflicting path (across all lanes) WITHOUT
    merging any lane — otherwise a mid-order untracked-file collision would
    leave earlier lanes squash-merged (staged, uncommitted) while later
    ones never ran, a hard-to-diagnose half-merged state.

    If a lane's commits are already on the epic branch (detected by no staged
    changes after `git merge --squash`), the lane is treated as already_merged:
    no commit is created, the epic HEAD sha is used, and the lane appears in
    both `merged` and `already_merged` lists so the caller knows the lane was
    processed but required no new commit.

    Returns a dict with keys:
      - "sha": the SHA of the merge commit (or epic HEAD if all lanes already merged)
      - "merged": list of all lane IDs processed
      - "already_merged": list of lane IDs that were already on the epic branch
    Raises RuntimeError on any git failure or if lane_order is empty.
    """
    _validate_ref_arg(epic_branch, "epic_branch")
    for lane_id in lane_order:
        _validate_path_component(lane_id, "lane_id")
    repo_root = (repo_root or Path(".")).resolve()

    # Require at least one lane to merge.
    if not lane_order:
        raise RuntimeError("lane_order must not be empty")

    checkout = _git(["checkout", epic_branch], cwd=repo_root, check=False)
    if checkout.returncode != 0:
        raise RuntimeError(
            f"Cannot checkout '{epic_branch}': {checkout.stderr.strip()}"
        )

    untracked_paths = set(
        _git(
            ["ls-files", "--others", "--exclude-standard"], cwd=repo_root, check=False
        ).stdout.splitlines()
    )

    if untracked_paths:
        conflicts: dict[str, list[str]] = {}
        for lane_id in lane_order:
            lane_branch = f"{epic_branch}--{lane_id}"
            diff_result = _git(
                [
                    "diff",
                    "--name-only",
                    "--diff-filter=ACMR",
                    f"{epic_branch}...{lane_branch}",
                ],
                cwd=repo_root,
                check=False,
            )
            if diff_result.returncode != 0:
                raise RuntimeError(
                    f"Cannot compute changed paths for lane '{lane_id}' "
                    f"(branch '{lane_branch}'): {diff_result.stderr.strip()}"
                )
            lane_paths = set(diff_result.stdout.splitlines())
            hit = sorted(lane_paths & untracked_paths)
            if hit:
                conflicts[lane_id] = hit

        if conflicts:
            details = "; ".join(
                f"lane '{lane_id}' would overwrite: {', '.join(paths)}"
                for lane_id, paths in conflicts.items()
            )
            raise RuntimeError(
                "Untracked working tree files would be overwritten by merge — "
                f"{details}. Move or delete these untracked files, or `git add` "
                "them, before merging. No lane has been merged."
            )

    merged: list[str] = []
    already_merged: list[str] = []
    any_new_changes = False
    # A crash between a lane's temporary squash commit and the fold leaves
    # `tmp(datum): squash lane <id>` commits at HEAD. Start the fold below
    # them so a retry still lands ONE commit (Python core review).
    leftover_tmp = 0
    while True:
        subject = _git(
            ["log", "-1", "--format=%s", f"HEAD~{leftover_tmp}"],
            cwd=repo_root,
            check=False,
        ).stdout.strip()
        if not subject.startswith("tmp(datum): squash lane "):
            break
        leftover_tmp += 1
    start_sha = _git(
        ["rev-parse", f"HEAD~{leftover_tmp}"], cwd=repo_root
    ).stdout.strip()
    if leftover_tmp:
        any_new_changes = True

    def fold_failed(what: str) -> LaneMergeError:
        """The fold (soft reset + one commit) failed: nothing has landed.

        The lanes' work is intact on their lane branches, so the checkout
        is hard-reset to start_sha — clean, exactly as before the call —
        and the error says merged=[] so every lane is demoted and retried.
        Leaving the squashed changes staged with HEAD already moved back
        was a dirty, half-merged checkout with no payload (review finding).
        """
        _git(["reset", "--hard", start_sha], cwd=repo_root, check=False)
        return LaneMergeError(
            f"Merge fold failed — no lane landed: {what}",
            failed_lane="",
            merged=[],
            already_merged=[],
            sha=start_sha,
        )

    def fold_into_one_commit() -> str:
        """Fold the temporary per-lane commits since start_sha into one commit."""
        if not any_new_changes:
            return _git(["rev-parse", "HEAD"], cwd=repo_root).stdout.strip()
        soft = _git(["reset", "--soft", start_sha], cwd=repo_root, check=False)
        if soft.returncode != 0:
            raise fold_failed(f"git reset --soft {start_sha}: {soft.stderr.strip()}")
        commit = _git(["commit", "-m", commit_message], cwd=repo_root, check=False)
        if commit.returncode != 0:
            raise fold_failed(
                f"git commit: {commit.stderr.strip()} {commit.stdout.strip()}".strip()
            )
        return _git(["rev-parse", "HEAD"], cwd=repo_root).stdout.strip()

    for lane_id in lane_order:
        lane_branch = f"{epic_branch}--{lane_id}"
        result = _git(
            ["merge", "--squash", "--no-commit", lane_branch],
            cwd=repo_root,
            check=False,
        )
        if result.returncode != 0:
            # Capture the reason BEFORE the reset erases it: the conflicted
            # paths and git's own output, persisted next to the run when a
            # report dir is given.
            unmerged = _git(
                ["diff", "--name-only", "--diff-filter=U"], cwd=repo_root, check=False
            )
            conflict_files = sorted(
                p.strip() for p in unmerged.stdout.splitlines() if p.strip()
            )
            git_output = (result.stdout.strip() + "\n" + result.stderr.strip()).strip()
            report_path = ""
            if report_dir is not None:
                report_dir.mkdir(parents=True, exist_ok=True)
                report_file = report_dir / f"merge-conflict-{lane_id}.json"
                report_file.write_text(
                    json.dumps(
                        {
                            "lane": lane_id,
                            "epic_branch": epic_branch,
                            "conflict_files": conflict_files,
                            "git_output": git_output,
                        },
                        indent=2,
                    )
                    + "\n"
                )
                report_path = str(report_file)
            # A failed `git merge --squash` (real content conflict) leaves the
            # root checkout mid-merge: SQUASH_MSG/MERGE_MSG present and AA
            # (unmerged) entries in the index/working tree. Left as-is, every
            # subsequent git operation in this checkout — including a later
            # retry of this same call — inherits that conflicted state
            # (elonchesd runs wf_93040d99-e3c, wf_c8cd6517-117). Reset/abort
            # BEFORE raising so the checkout is left exactly as clean as it
            # was before this call started.
            reset = _git(["reset", "--merge"], cwd=repo_root, check=False)
            if reset.returncode != 0:
                _git(["merge", "--abort"], cwd=repo_root, check=False)
            # The lanes that landed before this one stay landed: fold their
            # temporary commits into the batch commit so the epic branch never
            # carries a "tmp" commit, and report them separately.
            sha = fold_into_one_commit()
            merged_note = (
                f" Lanes merged before the failure and committed as {sha[:12]}: {', '.join(merged)}."
                if merged
                else " No lanes were merged before this failure."
            )
            files_note = (
                f" Conflicted files: {', '.join(conflict_files)}."
                if conflict_files
                else ""
            )
            raise LaneMergeError(
                f"Squash-merge of lane '{lane_id}' failed: "
                f"{git_output or result.stderr.strip()}.{files_note}{merged_note}",
                failed_lane=lane_id,
                merged=merged,
                already_merged=already_merged,
                sha=sha,
                conflict_files=conflict_files,
                report=report_path,
            )

        # Check if there are any staged changes after the squash-merge.
        # Exit code 0 means no changes, exit code 1 means there are changes.
        diff_cached = _git(
            ["diff", "--cached", "--quiet"],
            cwd=repo_root,
            check=False,
        )

        if diff_cached.returncode == 0:
            # No staged changes — the lane was already merged.
            merged.append(lane_id)
            already_merged.append(lane_id)
        else:
            # Staged changes — commit them now (temporary, folded below) so
            # the next lane's squash sees a clean index and working tree.
            tmp = _git(
                ["commit", "-q", "-m", f"tmp(datum): squash lane {lane_id}"],
                cwd=repo_root,
                check=False,
            )
            if tmp.returncode != 0:
                _git(["reset", "--merge"], cwd=repo_root, check=False)
                sha = fold_into_one_commit()
                raise LaneMergeError(
                    f"Temporary commit for lane '{lane_id}' failed: "
                    f"{tmp.stderr.strip()}\n{tmp.stdout.strip()}",
                    failed_lane=lane_id,
                    merged=merged,
                    already_merged=already_merged,
                    sha=sha,
                )
            merged.append(lane_id)
            any_new_changes = True

    sha = fold_into_one_commit()
    return {
        "sha": sha,
        "merged": merged,
        "already_merged": already_merged,
    }


def cleanup_run_worktrees(
    run_id: str,
    epic_branch: str,
    *,
    repo_root: Path | None = None,
) -> dict[str, list[str]]:
    """Remove all lane worktrees for a given run_id, plus its root worktree.

    Discovers lanes by listing .datum/worktrees/<run_id>/. The root worktree
    at .datum/worktrees/<run_id>-root (created --detach, no branch to delete)
    is force-removed too — this is the sole cleanup entrypoint so pipeline
    teardown never needs a raw `git worktree remove` in an agent prompt.

    A lane's worktree directory is always removed. Its sub-branch is only
    force-deleted if it has zero commits beyond the epic-branch fork point
    (see remove_lane_worktree()); branches with real RED/GREEN commits are
    preserved and reported so nothing is silently discarded.

    Lanes are discovered two ways and the union is what gets *deleted*: the
    directory scan under `<repo_root>/.datum/worktrees/<run_id>/`, and every
    worktree git has registered under a `.datum/worktrees/<run_id>/<lane>`
    path anywhere — the setup batch runs `datum worktrees setup` from
    INSIDE the batch's root worktree, so the lanes nest under it and the
    main checkout's run_dir never exists (caliper BUG O: cleanup from the
    main checkout found no lanes, never deleted their empty branches, and
    left a lane registered with its files gone).
    But a lane's worktree directory can already be gone by the time cleanup
    runs (a prior partial cleanup, an agent removing its own worktree, a
    crash right after `git worktree remove`) while its branch — with real
    commits — survives untouched. Such a lane is invisible to the directory
    scan alone, so reporting also cross-checks `<epic_branch>--*` branches
    that still exist: any that already carry real commits (and weren't
    already accounted for by the directory scan) are added to
    preserved_with_commits too, purely for visibility — nothing extra is
    deleted.

    Returns:
        {
            "removed": [lane_ids (plus "<run_id>-root" if present) whose
                        worktree was cleaned and branch deleted/absent],
            "preserved_with_commits": [lane_ids whose branch has real
                                        commits and was NOT deleted],
        }
    """
    _validate_path_component(run_id, "run_id")
    _validate_ref_arg(epic_branch, "epic_branch")
    repo_root = (repo_root or Path(".")).resolve()
    run_dir = repo_root / WORKTREE_ROOT / run_id

    removed: list[str] = []
    preserved_with_commits: list[str] = []
    accounted_for: set[str] = set()
    lane_paths: dict[str, Path] = {}
    if run_dir.exists():
        for lane_dir in sorted(run_dir.iterdir()):
            if lane_dir.is_dir():
                lane_paths[lane_dir.name] = lane_dir
    marker = f"/{WORKTREE_ROOT}/{run_id}/"
    for wt in list_worktrees(repo_root):
        wt_path = wt["path"].replace("\\", "/")
        if marker not in wt_path:
            continue
        lane_id = wt_path.split(marker, 1)[1].strip("/")
        if "/" in lane_id or not lane_id:
            continue
        lane_paths.setdefault(lane_id, Path(wt["path"]))
    for lane_id in sorted(lane_paths):
        try:
            _validate_path_component(lane_id, "lane_id")
        except ValueError:
            continue
        accounted_for.add(lane_id)
        result = remove_lane_worktree(
            lane_id,
            run_id,
            epic_branch,
            repo_root=repo_root,
            worktree_path=lane_paths[lane_id],
        )
        if result["preserved"]:
            preserved_with_commits.append(lane_id)
        else:
            removed.append(lane_id)
    # Whatever git did not take (an orphan directory git no longer registers,
    # a lane dir with leftovers) is deleted outright: every lane's branch is
    # already settled above, so the directories hold nothing to keep
    # (caliper BUG O: orphan run dirs accumulated under .datum/worktrees).
    if run_dir.exists():
        shutil.rmtree(run_dir, ignore_errors=True)

    root_dir = repo_root / WORKTREE_ROOT / f"{run_id}-root"
    if root_dir.exists():
        _git(
            ["worktree", "remove", str(root_dir), "--force"], cwd=repo_root, check=False
        )
        if root_dir.exists():
            shutil.rmtree(root_dir, ignore_errors=True)
        removed.append(f"{run_id}-root")
    # Registrations whose directory is gone (a lane nested under the root
    # just removed) must not survive to block the next run's `-b` checkout.
    _git(["worktree", "prune"], cwd=repo_root, check=False)

    # Reporting-only cross-check: lane branches still alive with real
    # commits, whose worktree directory was already gone before this call.
    prefix = f"{epic_branch}--"
    branch_list = _git(
        ["for-each-ref", "--format=%(refname:short)", f"refs/heads/{prefix}*"],
        cwd=repo_root,
        check=False,
    ).stdout
    for line in branch_list.splitlines():
        lane_branch = line.strip()
        if not lane_branch.startswith(prefix):
            continue
        lane_id = lane_branch[len(prefix) :]
        if lane_id in accounted_for:
            continue
        merge_base = _git(
            ["merge-base", lane_branch, epic_branch], cwd=repo_root, check=False
        )
        lane_sha = _git(["rev-parse", lane_branch], cwd=repo_root, check=False)
        has_new_commits = not (
            merge_base.returncode == 0
            and lane_sha.returncode == 0
            and merge_base.stdout.strip() == lane_sha.stdout.strip()
        )
        if has_new_commits:
            preserved_with_commits.append(lane_id)

    prune_stale_worktrees(repo_root=repo_root)

    return {"removed": removed, "preserved_with_commits": preserved_with_commits}


def housekeep_epic(epic_branch: str, *, repo_root: Path | None = None) -> dict:
    """Delete merged lane branches for one epic, its pipeline-state marker, and prune worktree refs.

    Only removes branches git already reports as merged (`branch -d`, never
    `-D`), and only those matching the exact `<epic_branch>--` prefix — never
    other epics/runs. Deterministic, no LLM in the loop, so closeout never
    needs a raw `git branch --merged | xargs git branch -d` pipeline in an
    agent prompt.
    """
    _validate_ref_arg(epic_branch, "epic_branch")
    repo_root = (repo_root or Path(".")).resolve()

    # The global pipeline-state.json is removed only when it is THIS epic's
    # (or carries no branch at all); with two epics in flight it may belong
    # to the other one (elonchesd). The epic's own per-epic mirror always goes.
    from datum.pipeline_state import epic_state_path

    state_path = repo_root / ".datum" / "pipeline-state.json"
    state_removed = False
    if state_path.exists():
        owner: object = None
        try:
            owner = json.loads(state_path.read_text()).get("branch")
        except (OSError, ValueError, AttributeError):
            owner = None
        if owner in (None, "", epic_branch):
            state_path.unlink()
            state_removed = True
    mirror = epic_state_path(epic_branch, repo_root / ".datum")
    if mirror is not None and mirror.exists():
        mirror.unlink()

    # "Merged" means merged into the EPIC branch we were given — never into
    # whatever HEAD happens to be (closeout can run from a detached root
    # worktree or with the operator on main). Bare `--merged` judged against
    # HEAD: a lane merged into the epic looked unmerged, and a lane merged
    # into HEAD but not the epic was deleted.
    merged = _git(
        ["branch", "--merged", epic_branch], cwd=repo_root, check=False
    ).stdout
    prefix = f"{epic_branch}--"
    candidates: list[str] = []
    for line in merged.splitlines():
        name = line.strip().lstrip("*").strip()
        if name.startswith(prefix):
            candidates.append(name)

    deleted: list[str] = []
    if candidates:
        # `-D`, not `-d`: `-d` re-checks "merged into HEAD", which is exactly
        # the wrong reference; every candidate was verified merged into the
        # epic above.
        result = _git(["branch", "-D", *candidates], cwd=repo_root, check=False)
        for line in result.stdout.splitlines():
            match = re.match(r"^Deleted branch (\S+) ", line.strip())
            if match:
                deleted.append(match.group(1))

    prune_stale_worktrees(repo_root=repo_root)

    return {"deleted_branches": deleted, "pipeline_state_removed": state_removed}
