"""wave_builder.py — BFS wave grouping for parallel lane dispatch.

Given a lane plan with dependency edges, groups tasks into waves using
Kahn's algorithm.  Tasks within a wave have no mutual dependencies and
can run concurrently.  Wave N's tasks depend only on tasks in waves < N.
"""

from __future__ import annotations


def build_waves(
    lanes: dict[str, dict],
    depends_on_key: str = "depends_on",
) -> list[list[str]]:
    """Return BFS-layered waves from a lane dependency graph.

    Parameters
    ----------
    lanes:
        Mapping of lane_id -> lane dict.  Each lane dict may contain a
        ``depends_on`` list of upstream lane IDs.
    depends_on_key:
        Key name for the dependency list within each lane dict.

    Returns
    -------
    List of waves, each wave a list of lane IDs that can run concurrently.
    """
    ids = list(lanes.keys())
    in_deg: dict[str, int] = {}
    adj: dict[str, list[str]] = {}

    for lane_id in ids:
        deps = lanes[lane_id].get(depends_on_key) or []
        in_deg[lane_id] = len(deps)
        for dep in deps:
            adj.setdefault(dep, []).append(lane_id)

    waves: list[list[str]] = []
    queue = sorted(lid for lid in ids if in_deg[lid] == 0)

    while queue:
        waves.append(list(queue))
        next_queue: list[str] = []
        for lid in queue:
            for child in adj.get(lid, []):
                in_deg[child] -= 1
                if in_deg[child] == 0:
                    next_queue.append(child)
        queue = sorted(next_queue)

    return waves
