"""wave_builder.py — BFS wave grouping for parallel lane dispatch.

Given a lane plan with dependency edges, groups tasks into waves using
Kahn's algorithm.  Tasks within a wave have no mutual dependencies and
can run concurrently.  Wave N's tasks depend only on tasks in waves < N.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass


class CyclicDependencyError(ValueError):
    """Raised when build_waves detects a cycle in the dependency graph."""

    def __init__(self, message: str, cycle_nodes: list[str] | None = None) -> None:
        super().__init__(message)
        self.cycle_nodes: list[str] = cycle_nodes or []


class MissingDependencyError(ValueError):
    """Raised when a lane references a dependency that does not exist in lanes."""


@dataclass
class WaveStats:
    """Statistics derived from a wave plan."""

    total_tasks: int
    num_waves: int
    max_parallelism: int
    critical_path_length: int


class WaveResult:
    """Return type for build_waves — wraps the wave list with metadata.

    Supports iteration and indexing so existing callers using
    ``build_waves()[0]`` or ``for wave in build_waves()`` continue to work.
    """

    def __init__(self, waves: list[list[str]]) -> None:
        self.waves = waves
        self.stats = WaveStats(
            total_tasks=sum(len(w) for w in waves),
            num_waves=len(waves),
            max_parallelism=max((len(w) for w in waves), default=0),
            critical_path_length=len(waves),
        )

    # --- list-like protocol ---------------------------------------------------

    def __iter__(self) -> Iterator[list[str]]:
        return iter(self.waves)

    def __getitem__(self, index: int) -> list[str]:
        return self.waves[index]

    def __len__(self) -> int:
        return len(self.waves)

    @property
    def summary(self) -> str:
        """One-line human summary of the wave plan.

        Returns ``'N tasks in W waves (max parallelism: P, critical path: C)'``
        for non-empty graphs, or ``'0 tasks in 0 waves'`` for an empty graph.
        """
        s = self.stats
        if s.total_tasks == 0:
            return "0 tasks in 0 waves"
        return (
            f"{s.total_tasks} tasks in {s.num_waves} waves"
            f" (max parallelism: {s.max_parallelism}, critical path: {s.critical_path_length})"
        )

    @property
    def cycle_path(self) -> list[str] | None:
        """None for acyclic graphs; reserved for future cyclic result support."""
        return None

    def __repr__(self) -> str:  # pragma: no cover
        return f"WaveResult(waves={self.waves!r}, stats={self.stats!r})"


def _find_cycle_path(
    cycle_nodes: list[str],
    adj: dict[str, list[str]],
) -> list[str]:
    """Return one cycle as an ordered path list ending back at the start node.

    Uses DFS restricted to nodes known to be in a cycle (``cycle_nodes``).
    Returns a list like ``['a', 'b', 'a']`` to show the full loop.
    """
    cycle_set = set(cycle_nodes)
    visited: set[str] = set()
    path: list[str] = []
    path_set: set[str] = set()

    def dfs(node: str) -> bool:
        visited.add(node)
        path.append(node)
        path_set.add(node)
        for neighbor in adj.get(node, []):
            if neighbor not in cycle_set:
                continue
            if neighbor in path_set:
                # Found the cycle — trim path to start at the repeated node.
                cycle_start = path.index(neighbor)
                path[:] = path[cycle_start:] + [neighbor]
                return True
            if neighbor not in visited:
                if dfs(neighbor):
                    return True
        path.pop()
        path_set.discard(node)
        return False

    for start in sorted(cycle_nodes):
        if start not in visited:
            if dfs(start):
                return path

    # Fallback: should not happen if cycle_nodes is accurate.
    return cycle_nodes + [cycle_nodes[0]]


def build_waves(
    lanes: dict[str, dict],
    depends_on_key: str = "depends_on",
) -> WaveResult:
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
    WaveResult wrapping the list of waves plus a WaveStats summary.
    """
    ids = list(lanes.keys())
    id_set = set(ids)

    # Validate all dependency references before running BFS.
    for lane_id in ids:
        deps = lanes[lane_id].get(depends_on_key) or []
        for dep in deps:
            if dep not in id_set:
                raise MissingDependencyError(
                    f"Lane '{lane_id}' depends on '{dep}', which does not exist in lanes."
                )

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

    cycle_nodes = sorted(lid for lid in ids if in_deg[lid] > 0)
    if cycle_nodes:
        # Find an actual cycle path using DFS on the original adjacency list.
        cycle_path = _find_cycle_path(cycle_nodes, adj)
        path_str = " -> ".join(cycle_path)
        raise CyclicDependencyError(
            f"Cycle detected: {path_str}",
            cycle_nodes=cycle_nodes,
        )

    return WaveResult(waves)
