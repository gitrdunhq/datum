#!/usr/bin/env python3
"""Render docs/diagrams/*.png from the Mermaid blocks in docs/FLOW.md.

    uv run python scripts/render_flow_diagrams.py [--check]

Blocks are mapped to files by position and checked by diagram type, so a
reordered or added block fails here instead of writing one diagram over
another. Needs mermaid-cli (`mmdc`) on PATH. Intermediate .mmd files go to
.temp/diagrams/. --check renders nothing and only verifies the mapping.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FLOW = ROOT / "docs" / "FLOW.md"
OUT_DIR = ROOT / "docs" / "diagrams"
SCRATCH = ROOT / ".temp" / "diagrams"

# (file stem, first line of the block) in the order they appear in FLOW.md.
DIAGRAMS: list[tuple[str, str]] = [
    ("flow-propose-verify", "flowchart LR"),
    ("flow-pipeline", "flowchart TD"),
    ("flow-lane-sequence", "sequenceDiagram"),
    ("flow-lane-states", "stateDiagram-v2"),
]
MMDC_ARGS = ["-w", "2000", "-s", "2", "-b", "white"]
_BLOCK = re.compile(r"^```mermaid\n(.*?)^```", re.M | re.S)


class DiagramMismatch(RuntimeError):
    """FLOW.md's mermaid blocks no longer match DIAGRAMS."""


@dataclass(frozen=True)
class Block:
    name: str
    kind: str
    source: str


def extract_blocks(text: str) -> list[Block]:
    sources = [m.group(1) for m in _BLOCK.finditer(text)]
    if len(sources) != len(DIAGRAMS):
        raise DiagramMismatch(
            f"FLOW.md has {len(sources)} mermaid blocks, DIAGRAMS names {len(DIAGRAMS)}"
        )
    blocks = []
    for (name, kind), source in zip(DIAGRAMS, sources, strict=True):
        first = source.strip().splitlines()[0].strip()
        if first != kind:
            raise DiagramMismatch(
                f"{name}: expected a `{kind}` block at this position, found `{first}`"
            )
        blocks.append(Block(name, kind, source))
    return blocks


CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
]


def puppeteer_args() -> list[str]:
    """mmdc's bundled puppeteer wants its own pinned Chrome download; point it
    at PUPPETEER_EXECUTABLE_PATH or an installed browser instead, if any."""
    import json
    import os

    exe = os.environ.get("PUPPETEER_EXECUTABLE_PATH") or next(
        (c for c in CHROME_CANDIDATES if Path(c).exists()), None
    )
    if not exe:
        return []
    cfg = SCRATCH / "puppeteer.json"
    cfg.write_text(json.dumps({"executablePath": exe}))
    return ["-p", str(cfg)]


def render(block: Block, extra: list[str]) -> Path:
    mmd = SCRATCH / f"{block.name}.mmd"
    mmd.write_text(block.source)
    out = OUT_DIR / f"{block.name}.png"
    subprocess.run(
        ["mmdc", "-i", str(mmd), "-o", str(out), *MMDC_ARGS, *extra],
        check=True,
        timeout=120,
    )
    return out


def main(argv: list[str]) -> int:
    blocks = extract_blocks(FLOW.read_text())
    if "--check" in argv:
        print(f"ok: {len(blocks)} blocks match DIAGRAMS")
        return 0
    SCRATCH.mkdir(parents=True, exist_ok=True)
    extra = puppeteer_args()
    for block in blocks:
        out = render(block, extra)
        print(f"{out.relative_to(ROOT)} {out.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
