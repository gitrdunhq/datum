import pytest
from datum_ax.core.planner.dag import DAGBuilder

def test_dag_builder_disjoint_waves():
    builder = DAGBuilder()
    
    # Two lanes editing the same file should not be in the same wave
    lanes = [
        {"id": "l1", "files": ["app.py", "utils.py"]},
        {"id": "l2", "files": ["app.py"]},
        {"id": "l3", "files": ["models.py"]}
    ]
    
    waves = builder.build_waves(lanes)
    
    # Expect 2 waves: wave 0: l1, l3. wave 1: l2
    assert len(waves) == 2
    assert {"l1", "l3"}.issubset(set(w["id"] for w in waves[0]))
    assert waves[1][0]["id"] == "l2"

def test_dag_builder_splits_oversized_lanes():
    builder = DAGBuilder(max_files_per_lane=2)
    
    lanes = [
        {"id": "l1", "files": ["a.py", "b.py", "c.py"]}
    ]
    
    split_lanes = builder.split_lanes(lanes)
    
    assert len(split_lanes) == 2
    assert len(split_lanes[0]["files"]) == 2
    assert len(split_lanes[1]["files"]) == 1
