"""workflow_dashboard — scan and serve workflow state.

Provides:
  find_workflow_dirs(base_path) -> list[dict]
  scan_workflow(wf_path) -> dict
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Union


def find_workflow_dirs(base_path: str | Path) -> list[dict]:
    """Return workflow directories under *base_path*, sorted by mtime descending.

    Each entry is a dict with keys:
        id       – directory name
        path     – string path to the directory
        project  – same as id (placeholder for future enrichment)
        mtime    – os.stat mtime as a float

    Returns at most 20 entries. Returns [] if base_path does not exist.
    """
    base = Path(base_path)
    if not base.exists():
        return []

    entries: list[dict] = []
    for child in base.iterdir():
        if not child.is_dir():
            continue
        stat = child.stat()
        entries.append(
            {
                "id": child.name,
                "path": str(child),
                "project": child.name,
                "mtime": stat.st_mtime,
            }
        )

    entries.sort(key=lambda e: e["mtime"], reverse=True)
    return entries[:20]


def scan_workflow(wf_path: str | Path) -> dict:
    """Scan *wf_path* for agent-*.meta.json files and return a summary.

    Returns a dict with:
        agents        – list of agent dicts (see below)
        total_agents  – int
        active_agents – int
        total_kb      – float (sum of size_bytes / 1024.0)

    Each agent dict has:
        id       – agent_id from the meta file
        type     – type field from the meta file
        size_kb  – float (size_bytes / 1024.0)
        active   – bool
        prompt   – first 120 chars of the first message's content (str)
    """
    path = Path(wf_path)
    agents: list[dict] = []

    for meta_file in sorted(path.glob("agent-*.meta.json")):
        try:
            data = json.loads(meta_file.read_text())
        except (json.JSONDecodeError, OSError):
            continue

        messages = data.get("messages") or []
        first_content = ""
        if messages:
            first_msg = messages[0]
            first_content = (
                first_msg.get("content", "") if isinstance(first_msg, dict) else ""
            )

        size_bytes = data.get("size_bytes", 0)
        agents.append(
            {
                "id": data.get("agent_id", ""),
                "type": data.get("type", ""),
                "size_kb": float(size_bytes) / 1024.0,
                "active": bool(data.get("active", False)),
                "prompt": str(first_content)[:120],
            }
        )

    total_kb = sum(a["size_kb"] for a in agents)
    active_count = sum(1 for a in agents if a["active"])

    return {
        "agents": agents,
        "total_agents": len(agents),
        "active_agents": active_count,
        "total_kb": float(total_kb),
    }
