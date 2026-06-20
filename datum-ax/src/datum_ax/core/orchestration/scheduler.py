from typing import Any, cast


def get_next_wave(dag: dict[str, Any], current_wave: int) -> list[str]:
    """Basic scheduler logic to select the next disjoint set of lanes from the DAG."""
    waves = dag.get("waves", [])
    if current_wave < len(waves):
        return cast(list[str], waves[current_wave])
    return []
