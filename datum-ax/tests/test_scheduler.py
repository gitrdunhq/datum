import pytest
from datum_ax.core.orchestration.scheduler import get_next_wave

def test_get_next_wave():
    dag = {
        "waves": [
            ["lane1", "lane2"],
            ["lane3"]
        ]
    }
    
    # Wave 0
    lanes = get_next_wave(dag, current_wave=0)
    assert lanes == ["lane1", "lane2"]
    
    # Wave 1
    lanes = get_next_wave(dag, current_wave=1)
    assert lanes == ["lane3"]
    
    # Wave 2 (out of bounds)
    lanes = get_next_wave(dag, current_wave=2)
    assert lanes == []
