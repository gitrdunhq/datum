from typing import Any


class DAGBuilder:
    """Builds the DAG by decomposing tasks into disjoint waves and splitting oversized lanes."""

    def __init__(self, max_files_per_lane: int = 10):
        self.max_files_per_lane = max_files_per_lane

    def split_lanes(self, lanes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Splits lanes that exceed context-budget (e.g. too many files)."""
        result = []
        for lane in lanes:
            files = lane.get("files", [])
            if len(files) > self.max_files_per_lane:
                # Split logic
                for i in range(0, len(files), self.max_files_per_lane):
                    chunk = files[i : i + self.max_files_per_lane]
                    new_lane = lane.copy()
                    new_lane["files"] = chunk
                    new_lane["id"] = f"{lane['id']}_part{i // self.max_files_per_lane}"
                    result.append(new_lane)
            else:
                result.append(lane)
        return result

    def build_waves(self, lanes: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
        """Groups lanes into waves, guaranteeing file disjointness within a wave."""
        waves: list[list[dict[str, Any]]] = []

        for lane in lanes:
            placed = False
            for wave in waves:
                # Check for overlap with files already in this wave
                wave_files = set(f for w_lane in wave for f in w_lane.get("files", []))
                lane_files = set(lane.get("files", []))

                if not wave_files.intersection(lane_files):
                    wave.append(lane)
                    placed = True
                    break

            if not placed:
                waves.append([lane])

        return waves
