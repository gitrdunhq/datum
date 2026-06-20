import json
import subprocess
from typing import Any, Callable


def default_runner(cmd: list[str], input_data: str) -> str:
    """Default subprocess runner. Overridable for testing."""
    result = subprocess.run(cmd, input=input_data, text=True, capture_output=True, check=True)
    return result.stdout


class EedomAdapter:
    """Manages translation and subprocess boundary for the eedom deterministic review gate (ADR-0006)."""
    
    def __init__(self, runner: Callable[[list[str], str], str] = default_runner):
        self.runner = runner

    def evaluate_diff(self, diff: str, properties: dict[str, Any]) -> dict[str, Any]:
        """Maps internal properties to the eedom schema, runs eedom evaluate, and parses the verdict."""
        # 1. Translate schema (stub mapping here)
        eedom_context = {
            "diff": diff,
            "rules": properties.get("invariants", [])
        }
        input_data = json.dumps(eedom_context)
        
        # 2. Run eedom binary
        cmd = ["eedom", "evaluate", "--json"]
        try:
            output = self.runner(cmd, input_data)
        except Exception as e:
            return {"verdict": "ERROR", "violations": [str(e)]}
            
        # 3. Parse JSON verdict
        try:
            verdict = json.loads(output)
            return {
                "verdict": verdict.get("verdict", "FAIL"),
                "violations": verdict.get("violations", [])
            }
        except json.JSONDecodeError:
            return {"verdict": "ERROR", "violations": ["Failed to parse eedom output."]}
