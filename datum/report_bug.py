"""Self-healing: auto-file GitHub issues when DATUM hits unexpected errors."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import traceback
from pathlib import Path

_MAX_BODY_LEN = 4000
_SECRET_PATTERNS = re.compile(
    r"(ghp_[A-Za-z0-9]{20,})"
    r"|(gho_[A-Za-z0-9]{20,})"
    r"|(ghs_[A-Za-z0-9]{20,})"
    r"|(sk-[A-Za-z0-9]{20,})"
    r"|(key-[A-Za-z0-9]{20,})"
    r"|(AKIA[A-Z0-9]{16})"
    r"|(xox[bpsar]-[A-Za-z0-9\-]{20,})"
)


def _sanitize(text: str) -> str:
    text = text.replace(str(Path.home()), "~")
    text = _SECRET_PATTERNS.sub("[REDACTED]", text)
    if len(text) > _MAX_BODY_LEN:
        text = text[:_MAX_BODY_LEN] + "\n\n... [truncated]"
    return text


def report_bug(
    module: str,
    error: Exception | str,
    context: dict | None = None,
) -> str | None:
    """File a GitHub issue for an unexpected DATUM error.

    Returns the issue URL on success, None on failure (never raises).
    All output is sanitized: home paths replaced with ~, secrets redacted,
    body capped at 4000 chars.
    """
    title = f"[datum-bug] {module}: {_sanitize(_one_line(error))}"
    body = _sanitize(_build_body(module, error, context))

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
            for issue in json.loads(existing.stdout):
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
        ctx_str = json.dumps(context, indent=2)
        if len(ctx_str) > 1000:
            ctx_str = ctx_str[:1000] + "\n... [truncated]"
        parts.append(f"**Context:**\n```json\n{ctx_str}\n```")

    return "\n\n".join(parts)


def _clean_env() -> dict:
    import os

    env = os.environ.copy()
    for key in list(env):
        low = key.lower()
        if any(
            s in low
            for s in ("token", "secret", "key", "password", "credential", "auth")
        ):
            del env[key]
    return env
