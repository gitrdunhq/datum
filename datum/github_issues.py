"""github_issues.py — Create and manage GitHub issues with sub-issue relationships.

Handles the full lifecycle: create epic (parent) → create tasks (children) →
link as sub-issues → read metadata back → update status.

Metadata is stored as invisible HTML comments in issue bodies:
  <!-- datum:metadata {"files":[],"depends_on":[],...} -->
"""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass, field

METADATA_PATTERN = re.compile(r"<!-- datum:metadata\s+(.*?)\s*-->", re.DOTALL)


def _detect_repo() -> str:
    try:
        r = subprocess.run(
            ["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
            capture_output=True,
            text=True,
            env={**__import__("os").environ, "GITHUB_TOKEN": ""},
        )
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except FileNotFoundError:
        pass
    return "gitrdunhq/datum"


REPO = _detect_repo()


@dataclass
class TaskIssue:
    number: int
    node_id: str
    title: str
    files: list[str] = field(default_factory=list)
    acceptance_criteria: list[str] = field(default_factory=list)
    depends_on: list[int] = field(default_factory=list)
    red_note: str = ""
    stage: str = "queued"


def _gh(*args: str, input_text: str | None = None) -> subprocess.CompletedProcess:
    env_patch = {"GITHUB_TOKEN": ""}
    import os

    env = {**os.environ, **env_patch}
    return subprocess.run(
        ["gh", *args],
        capture_output=True,
        text=True,
        env=env,
        input=input_text,
    )


def _gh_check(*args: str, input_text: str | None = None) -> str:
    r = _gh(*args, input_text=input_text)
    if r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args[:3])}... failed: {r.stderr.strip()}")
    return r.stdout.strip()


def _build_issue_body(
    description: str,
    acceptance_criteria: list[str],
    files: list[str],
    metadata: dict,
) -> str:
    ac_lines = "\n".join(f"- {ac}" for ac in acceptance_criteria)
    file_lines = "\n".join(f"- `{f}`" for f in files)
    meta_json = json.dumps(metadata, separators=(",", ":"))

    return (
        f"{description}\n\n"
        f"### Acceptance Criteria\n{ac_lines}\n\n"
        f"### Files\n{file_lines}\n\n"
        f"<!-- datum:metadata {meta_json} -->"
    )


def parse_metadata(body: str) -> dict | None:
    m = METADATA_PATTERN.search(body or "")
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def create_labels() -> None:
    labels = [
        ("datum-epic", "5319E7", "Parent epic issue for datum pipeline"),
        ("datum-task", "0E8A16", "Child task of a datum epic"),
        ("datum-red", "D93F0B", "RED phase — failing tests written"),
        ("datum-green", "0E8A16", "GREEN phase — tests passing"),
        ("datum-done", "006B75", "Lane completed successfully"),
    ]
    for name, color, desc in labels:
        _gh(
            "label",
            "create",
            name,
            "--color",
            color,
            "--description",
            desc,
            "--force",
            "--repo",
            REPO,
        )


def create_epic(
    title: str, description: str, tasks_summary: list[str]
) -> tuple[int, str]:
    task_list = "\n".join(f"- [ ] {t}" for t in tasks_summary)
    body = (
        f"{description}\n\n"
        f"### Tasks\n{task_list}\n\n"
        f"<!-- datum:metadata {json.dumps({'type': 'epic'})} -->"
    )

    url = _gh_check(
        "issue",
        "create",
        "--title",
        title,
        "--label",
        "datum-epic",
        "--body",
        body,
        "--repo",
        REPO,
    )
    number = int(url.rstrip("/").split("/")[-1])

    node_id = _gh_check(
        "issue",
        "view",
        str(number),
        "--repo",
        REPO,
        "--json",
        "id",
        "--jq",
        ".id",
    )
    return number, node_id


def create_task(
    title: str,
    description: str,
    acceptance_criteria: list[str],
    files: list[str],
    depends_on: list[int],
    red_note: str = "",
) -> tuple[int, str]:
    metadata = {
        "files": files,
        "acceptance_criteria": acceptance_criteria,
        "depends_on": depends_on,
        "red_note": red_note,
        "stage": "queued",
    }

    body = _build_issue_body(description, acceptance_criteria, files, metadata)

    url = _gh_check(
        "issue",
        "create",
        "--title",
        title,
        "--label",
        "datum-task",
        "--body",
        body,
        "--repo",
        REPO,
    )
    number = int(url.rstrip("/").split("/")[-1])

    node_id = _gh_check(
        "issue",
        "view",
        str(number),
        "--repo",
        REPO,
        "--json",
        "id",
        "--jq",
        ".id",
    )
    return number, node_id


def link_sub_issue(parent_node_id: str, child_node_id: str) -> None:
    query = """
    mutation($parentId: ID!, $childId: ID!) {
      addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
        issue { number }
        subIssue { number }
      }
    }
    """
    _gh_check(
        "api",
        "graphql",
        "-H",
        "GraphQL-Features: sub_issues",
        "-f",
        f"parentId={parent_node_id}",
        "-f",
        f"childId={child_node_id}",
        "-f",
        f"query={query}",
    )


def list_sub_issues(parent_number: int) -> list[dict]:
    raw = _gh_check(
        "api",
        f"repos/{REPO}/issues/{parent_number}/sub_issues",
    )
    issues = json.loads(raw)
    result = []
    for issue in issues:
        meta = parse_metadata(issue.get("body", ""))
        result.append(
            {
                "number": issue["number"],
                "title": issue["title"],
                "state": issue["state"],
                "metadata": meta,
            }
        )
    return result


def build_lane_plan_from_epic(epic_number: int) -> dict:
    sub_issues = list_sub_issues(epic_number)

    issue_to_number = {}
    lanes = {}
    topo_order = []

    for issue in sub_issues:
        num = issue["number"]
        meta = issue["metadata"] or {}
        lane_id = f"#{num}"
        issue_to_number[num] = lane_id

        depends_on_nums = meta.get("depends_on", [])
        depends_on_ids = [f"#{d}" for d in depends_on_nums]

        lanes[lane_id] = {
            "id": lane_id,
            "title": issue["title"],
            "files": meta.get("files", []),
            "acceptance_criteria": meta.get("acceptance_criteria", []),
            "depends_on": depends_on_ids,
            "red_note": meta.get("red_note", ""),
            "stage": meta.get("stage", "queued"),
            "github_issue": num,
        }
        topo_order.append(lane_id)

    return {
        "schema_version": "1.0.0",
        "total_lanes": len(lanes),
        "topological_order": topo_order,
        "lanes": lanes,
        "epic_issue": epic_number,
    }


def update_issue_stage(
    issue_number: int, stage: str, commit_sha: str | None = None
) -> None:
    label_map = {
        "red": "datum-red",
        "green": "datum-green",
        "done": "datum-done",
    }

    if stage in label_map:
        for old_label in ["datum-red", "datum-green", "datum-task"]:
            _gh(
                "issue",
                "edit",
                str(issue_number),
                "--remove-label",
                old_label,
                "--repo",
                REPO,
            )
        _gh(
            "issue",
            "edit",
            str(issue_number),
            "--add-label",
            label_map[stage],
            "--repo",
            REPO,
        )

    if stage == "done":
        comment = "Lane completed."
        if commit_sha:
            comment += f" Commit: {commit_sha}"
        _gh("issue", "comment", str(issue_number), "--body", comment, "--repo", REPO)

    if stage == "done":
        _gh("issue", "close", str(issue_number), "--repo", REPO)


def publish_lane_plan(
    lane_plan_path: str,
    epic_title: str,
    epic_description: str = "",
) -> dict:
    """Create GH issues for all lanes in a lane-plan, link as sub-issues.

    Writes github_issue numbers back to lane-plan.json.
    Never touches TASKS.md — issue numbers stay in lane-plan only.

    Returns: {"epic_number": N, "task_issues": {"lane-id": issue_number}}
    """
    from pathlib import Path

    lp_path = Path(lane_plan_path)
    lane_plan = json.loads(lp_path.read_text())

    create_labels()

    tasks_summary = [
        f"{lid}: {lane_plan['lanes'][lid]['title']}"
        for lid in lane_plan["topological_order"]
    ]
    epic_num, epic_node_id = create_epic(epic_title, epic_description, tasks_summary)

    task_issues: dict[str, int] = {}
    task_node_ids: dict[str, str] = {}

    for lid in lane_plan["topological_order"]:
        lane = lane_plan["lanes"][lid]
        deps_as_numbers = [
            task_issues[d] for d in lane.get("depends_on", []) if d in task_issues
        ]
        task_num, task_node = create_task(
            title=f"[{lid}] {lane['title']}",
            description=lane.get("red_note", ""),
            acceptance_criteria=lane.get("acceptance_criteria", []),
            files=lane.get("files", []),
            depends_on=deps_as_numbers,
            red_note=lane.get("red_note", ""),
        )
        task_issues[lid] = task_num
        task_node_ids[lid] = task_node
        lane_plan["lanes"][lid]["github_issue"] = task_num

        link_sub_issue(epic_node_id, task_node)

    lane_plan["epic_issue"] = epic_num
    lp_path.write_text(json.dumps(lane_plan, indent=2))

    return {"epic_number": epic_num, "task_issues": task_issues}
