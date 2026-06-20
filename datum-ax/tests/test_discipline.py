import pytest
from datum_ax.core.verifier.discipline import evaluate_discipline_gate

def test_evaluate_discipline_gate_pass():
    code = '''
def good_function(x: int) -> int:
    """This is a good function."""
    return x
'''
    verdict = evaluate_discipline_gate(code)
    assert verdict["pass"] is True
    assert len(verdict["violations"]) == 0

def test_evaluate_discipline_gate_fail_no_docstring():
    code = '''
def bad_function(x: int) -> int:
    return x
'''
    verdict = evaluate_discipline_gate(code)
    assert verdict["pass"] is False
    assert any("docstring" in v for v in verdict["violations"])

def test_evaluate_discipline_gate_fail_no_typehints():
    code = '''
def bad_function(x):
    """Missing types."""
    return x
'''
    verdict = evaluate_discipline_gate(code)
    assert verdict["pass"] is False
    assert any("type hint" in v for v in verdict["violations"])
