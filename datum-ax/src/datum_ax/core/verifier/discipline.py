import ast
from typing import Any

from datum_ax.schemas.verification import GateResult, LaneVerification


def evaluate_tdd_gate(verification: LaneVerification) -> GateResult:
    """RED-before-GREEN: GREEN (impl) is never accepted without an observed failing test (ADR-0010).

    Deterministic, zero-token. Ordering invariant: a passing gate with an implementation present
    implies a test existed and was observed RED first.
    """
    violations: list[str] = []
    if verification.impl_present and not verification.test_present:
        violations.append("GREEN accepted with no test present — RED-before-GREEN violated.")
    if verification.impl_present and not verification.red_observed:
        violations.append("GREEN accepted without an observed RED (failing test) first.")
    return GateResult(passed=not violations, violations=tuple(violations))


def evaluate_discipline_gate(code: str) -> dict[str, Any]:
    """AST-based zero-token deterministic verifier for code discipline."""
    violations = []

    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {"pass": False, "violations": [f"Syntax error: {str(e)}"]}

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            # Check docstring
            if not ast.get_docstring(node):
                violations.append(f"Function '{node.name}' is missing a docstring.")

            # Check type hints
            if not node.returns:
                violations.append(f"Function '{node.name}' is missing return type hint.")
            for arg in node.args.args:
                if arg.arg != "self" and arg.arg != "cls" and not arg.annotation:
                    violations.append(
                        f"Argument '{arg.arg}' in function '{node.name}' is missing type hint."
                    )

    return {"pass": len(violations) == 0, "violations": violations}
