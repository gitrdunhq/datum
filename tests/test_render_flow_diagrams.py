"""docs/diagrams/*.png are rendered from the Mermaid blocks in docs/FLOW.md.

The render script maps each block to a file by position AND diagram type, so
a reordered or added block in FLOW.md fails loudly instead of writing the
pipeline flowchart over the lane sequence.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "render_flow_diagrams.py"


def _load():
    spec = importlib.util.spec_from_file_location("render_flow_diagrams", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod  # dataclasses resolve postponed annotations here
    spec.loader.exec_module(mod)
    return mod


def test_flow_md_blocks_match_the_diagram_table():
    mod = _load()
    blocks = mod.extract_blocks((ROOT / "docs" / "FLOW.md").read_text())
    assert [b.name for b in blocks] == [
        "flow-propose-verify",
        "flow-pipeline",
        "flow-lane-sequence",
        "flow-lane-states",
    ]
    assert [b.kind for b in blocks] == [
        "flowchart LR",
        "flowchart TD",
        "sequenceDiagram",
        "stateDiagram-v2",
    ]
    assert all(b.source.strip() for b in blocks)


def test_a_block_of_the_wrong_kind_is_refused():
    mod = _load()
    block = "```mermaid\nsequenceDiagram\nA->>B: x\n```\n"
    with pytest.raises(mod.DiagramMismatch, match="flow-propose-verify"):
        mod.extract_blocks(block * len(mod.DIAGRAMS))
    with pytest.raises(mod.DiagramMismatch, match="1 mermaid blocks"):
        mod.extract_blocks(block)


def test_every_diagram_in_the_readme_is_produced_by_the_script():
    mod = _load()
    readme = (ROOT / "docs" / "diagrams" / "README.md").read_text()
    for name, _kind in mod.DIAGRAMS:
        assert f"`{name}.png`" in readme, name
    assert "scripts/render_flow_diagrams.py" in readme
