"""Deterministic scan for machine-written tells on a lane's added lines.

Adopted from randommonicle/claude-skills `unslop-code` (references/tells.md).
Only the mechanical surface tells live here; the scanner is blind by design
to tutorial shape, over-engineering and repo fit, which the REFACTOR check
reads for. Debug logging and defensive validation are not flagged: the
source data cleared both as tells. Findings are advisory, never a halt.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

IGNORE_MARK = "unslop-ignore"

# (tag, pattern). Order is the report order when a line matches several.
TELLS: list[tuple[str, re.Pattern[str]]] = [
    (
        "placeholder",
        re.compile(
            r"(#|//)\s*(\.\.\.\s*)?(rest of (your|the) code|your logic here|implementation goes here|existing code unchanged|TODO:? implement)",
            re.I,
        ),
    ),
    (
        "chat_artifact",
        re.compile(
            r"(you're absolutely right|here's the updated|as an ai\b|good catch|i've (implemented|updated|added))",
            re.I,
        ),
    ),
    (
        "narrating_comment",
        re.compile(r"(#|//)\s*(step \d+|now we\b|first,|next,|finally,)", re.I),
    ),
    ("emoji", re.compile(r"[\U0001F300-\U0001FAFF☀-➿]")),
    (
        "generic_name",
        re.compile(
            r"\b(def|function|func|fn)\s+(process_data|processData|handle_data|handleData|do_stuff|doStuff|do_something|doSomething|process_item|processItem)\b"
        ),
    ),
    (
        "swallowed_error",
        re.compile(
            r"(^\s*except\s*:\s*$|except\s+\w+\s*:\s*pass\s*$|catch\s*(\([^)]*\))?\s*\{\s*\}\s*$)"
        ),
    ),
]


@dataclass(frozen=True)
class Finding:
    file: str
    line: int
    tag: str
    text: str


def scan_lines(lines: list[tuple[str, int, str]]) -> list[Finding]:
    """One finding per (line, tag) for every tell a line matches."""
    out: list[Finding] = []
    for file, n, text in lines:
        if IGNORE_MARK in text:
            continue
        for tag, pat in TELLS:
            if pat.search(text):
                out.append(Finding(file, n, tag, text))
    return out


def added_lines(
    repo: Path, base: str | None, files: list[str]
) -> list[tuple[str, int, str]]:
    """(file, line number, text) for every line added since `base`; whole files when base is None."""
    out: list[tuple[str, int, str]] = []
    for f in files:
        path = repo / f
        if base is None:
            if path.is_file():
                text = path.read_text(encoding="utf-8", errors="replace")
                out.extend((f, i + 1, t) for i, t in enumerate(text.splitlines()))
            continue
        proc = subprocess.run(
            ["git", "-C", str(repo), "diff", "--unified=0", base, "HEAD", "--", f],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        out.extend(_added_from_diff(f, proc.stdout))
    return out


def _added_from_diff(file: str, diff: str) -> list[tuple[str, int, str]]:
    out: list[tuple[str, int, str]] = []
    n = 0
    for raw in diff.splitlines():
        if raw.startswith("@@"):
            m = re.search(r"\+(\d+)", raw)
            n = int(m.group(1)) if m else 0
        elif raw.startswith("+") and not raw.startswith("+++"):
            out.append((file, n, raw[1:]))
            n += 1
    return out


def format_findings(findings: list[Finding]) -> str:
    return "".join(f"{f.file}:{f.line}:{f.tag}:{f.text}\n" for f in findings)
