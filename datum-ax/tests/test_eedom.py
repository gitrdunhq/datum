import pytest
from datum_ax.core.eedom.adapter import EedomAdapter

def test_eedom_adapter_pass():
    # Stub subprocess runner for successful review
    def stub_run(cmd, input_data):
        return '{"verdict": "PASS", "violations": []}'
        
    adapter = EedomAdapter(runner=stub_run)
    result = adapter.evaluate_diff("diff content", properties={"invariants": []})
    
    assert result["verdict"] == "PASS"
    assert len(result["violations"]) == 0

def test_eedom_adapter_fail():
    # Stub subprocess runner for failed review
    def stub_run(cmd, input_data):
        return '{"verdict": "FAIL", "violations": ["Missing type hint"]}'
        
    adapter = EedomAdapter(runner=stub_run)
    result = adapter.evaluate_diff("bad diff", properties={"invariants": ["types required"]})
    
    assert result["verdict"] == "FAIL"
    assert "Missing type hint" in result["violations"]
