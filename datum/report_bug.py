"""Self-healing: auto-file GitHub issues when DATUM hits unexpected errors."""

from __future__ import annotations

import json
import subprocess
import sys
import traceback
from pathlib import Path


def report_bug(
    module: str,
    error: Exception | str,
    context: dict | None = None,
) -> str | None:
    """File a GitHub issue for an unexpected DATUM error.

    Returns the issue URL on success, None on failure (never raises).
    """
    title = f"[datum-bug] {module}: {_one_line(error)}"
    body = _build_body(module, error, context)

    try:
        existing = subprocess.run(
            [
                "gh",
                "issue",
                "list",
                "--label",
                "datum-bug",
                "--state",
                "open",
                "--json",
                "title",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            env=_clean_env(),
        )
        if existing.returncode == 0:
            issues = json.loads(existing.stdout)
            for issue in issues:
                if issue.get("title") == title:
                    return None

        result = subprocess.run(
            [
                "gh",
                "issue",
                "create",
                "--title",
                title,
                "--label",
                "datum-bug",
                "--body",
                body,
            ],
            capture_output=True,
            text=True,
            timeout=15,
            env=_clean_env(),
        )
        if result.returncode == 0:
            url = result.stdout.strip()
            print(f"[datum-bug] Filed: {url}", file=sys.stderr)
            return url
    except Exception:
        pass
    return None


def _one_line(error: Exception | str) -> str:
    msg = str(error).split("\n")[0]
    return msg[:80] if len(msg) > 80 else msg


def _build_body(module: str, error: Exception | str, context: dict | None) -> str:
    parts = [
        f"**Module:** `{module}`",
        f"**Error:** `{error}`",
    ]
    if isinstance(error, Exception):
        tb = traceback.format_exception(type(error), error, error.__traceback__)
        parts.append(f"**Traceback:**\n```\n{''.join(tb[-5:])}```")

    state_path = Path(".datum/state.json")
    if state_path.exists():
        try:
            state = json.loads(state_path.read_text())
            parts.append(
                f"**State:** phase=`{state.get('current_phase')}`, "
                f"run_id=`{state.get('run_id')}`"
            )
        except Exception:
            pass

    if context:
        parts.append(f"**Context:**\n```json\n{json.dumps(context, indent=2)}\n```")

    return "\n\n".join(parts)


def _clean_env() -> dict:
    import os

    env = os.environ.copy()
    env.pop("GITHUB_TOKEN", None)
    return env
