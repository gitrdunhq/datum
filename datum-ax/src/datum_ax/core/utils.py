import json
import re
from typing import Any


def extract_json(text: str) -> Any:
    """Robustly extract JSON from model output that may contain hallucinations or conversational filler."""
    text = text.strip()
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

    # 1. Try markdown block first
    json_match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    # 2. Try finding balanced brackets/braces to pull out JSON objects from raw text
    def find_balanced(s: str, open_char: str, close_char: str) -> list[str]:
        results = []
        depth = 0
        start = -1
        in_string = False
        escape = False

        for i, char in enumerate(s):
            if char == '"' and not escape:
                in_string = not in_string

            if not in_string:
                if char == open_char:
                    if depth == 0:
                        start = i
                    depth += 1
                elif char == close_char:
                    depth -= 1
                    if depth == 0 and start != -1:
                        results.append(s[start : i + 1])
                    elif depth < 0:
                        depth = 0

            escape = char == "\\" and not escape

        return results

    candidates = find_balanced(text, "{", "}") + find_balanced(text, "[", "]")

    # Try parsing candidates from the end (the model's final answer is usually at the bottom)
    for cand in reversed(candidates):
        try:
            parsed = json.loads(cand)
            # We only expect dictionaries, or lists of dictionaries (for lanes)
            if isinstance(parsed, dict):
                return parsed
            elif isinstance(parsed, list) and len(parsed) > 0 and isinstance(parsed[0], dict):
                return parsed
        except json.JSONDecodeError:
            continue

    # 3. Fallback to parsing the whole text (will likely fail but gives a good error stack)
    return json.loads(text)
