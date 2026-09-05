"""Every workflow bundle datum materialises into consumer repos must have a
consumer: either datum-go dispatches it (`sk('<name>')`) or SKILL.md tells
the operator how to launch it. A bundle nobody calls or documents is a
producer without a consumer — it still ships, still costs a copy on every
`datum init`, and rots unnoticed (datum-route shipped for months with
artifact checks pointing at paths the pipeline never writes).
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def materialised_bundles() -> list[str]:
    from datum.skills_materialize import SKILL_GLOB

    return sorted(p.stem for p in (ROOT / "skills").glob(SKILL_GLOB))


def dispatched_by_datum_go() -> set[str]:
    src = (ROOT / "skills" / "src" / "datum-go.ts").read_text()
    return set(re.findall(r"sk\('([a-z-]+)'\)", src))


def documented_in_skill_md() -> set[str]:
    text = (ROOT / "SKILL.md").read_text()
    return set(re.findall(r"`(datum-[a-z-]+)`", text))


def test_every_materialised_bundle_is_dispatched_or_documented():
    bundles = materialised_bundles()
    assert bundles, "no skills/datum-*.js bundles found — build them first"
    consumers = dispatched_by_datum_go() | documented_in_skill_md() | {"datum-go"}
    orphans = [b for b in bundles if b not in consumers]
    assert not orphans, (
        "materialised workflow bundles with no consumer (not dispatched by datum-go.ts, "
        f"not documented in SKILL.md): {orphans}"
    )


def test_datum_go_dispatch_targets_exist_as_bundles():
    bundles = set(materialised_bundles())
    missing = sorted(dispatched_by_datum_go() - bundles)
    assert not missing, f"datum-go.ts dispatches workflows with no bundle: {missing}"
