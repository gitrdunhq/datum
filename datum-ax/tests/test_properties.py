import pytest
from datum_ax.core.planner.properties import derive_properties

def test_derive_properties():
    lane = {
        "id": "l1",
        "description": "Add caching to the data plane",
        "files": ["cache.py"]
    }
    
    props = derive_properties(lane)
    
    # Should derive properties containing safety/functional invariants
    assert "invariants" in props
    assert len(props["invariants"]) > 0
