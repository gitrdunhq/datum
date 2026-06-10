"""Complexity classifier for DATUM specs.

Parses Classification Metadata from a spec and assigns a tier
(patch / feature / system) with corresponding pipeline shape.
"""

from __future__ import annotations

import re
from typing import Any

DEFAULT_THRESHOLDS = {
    "patch_max_loc": 50,
    "patch_max_clusters": 1,
    "system_min_clusters": 6,
    "system_min_loc_with_api": 500,
}

_ALL_FIELDS = (
    "estimated_files",
    "estimated_loc",
    "clusters_touched",
    "new_public_api",
    "dependency_additions",
)

_SECTION_RE = re.compile(
    r"##\s+(?:\d+\.\s+)?Classification Metadata.*?```(?:yaml|yml)?\s*\n(.*?)```",
    re.DOTALL,
)

_PIPELINE_MAP = {
    "patch": "express",
    "feature": "standard",
    "system": "extended",
}


def _parse_yaml_value(raw: str) -> Any:
    """Minimal YAML-value parser for the subset we expect."""
    raw = raw.strip()
    if raw.lower() == "true":
        return True
    if raw.lower() == "false":
        return False
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        if not inner:
            return []
        return [item.strip() for item in inner.split(",")]
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        pass
    return raw


def parse_classification_metadata(spec_text: str) -> dict:
    """Extract classification metadata from a spec's markdown.

    Looks for a ``## 9. Classification Metadata`` (or ``## Classification
    Metadata``) section containing a YAML code block and returns a dict
    with all expected fields.  Missing fields are set to ``None``.
    """
    result: dict[str, Any] = {field: None for field in _ALL_FIELDS}

    match = _SECTION_RE.search(spec_text)
    if not match:
        return result

    yaml_block = match.group(1)
    for line in yaml_block.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        if key in result:
            result[key] = _parse_yaml_value(value)

    return result


def classify(metadata: dict, config: dict | None = None) -> dict:
    """Assign a complexity tier based on parsed classification metadata.

    Returns ``{"tier": str, "signals": dict, "pipeline_shape": str}``.

    Threshold rules (using ``<`` for patch ceiling, ``>=`` for system floor):
    - **patch**: ``estimated_loc < patch_max_loc`` AND
      ``clusters_touched <= patch_max_clusters`` AND ``not new_public_api``
    - **system**: ``clusters_touched >= system_min_clusters`` OR
      (``new_public_api`` AND ``estimated_loc >= system_min_loc_with_api``)
    - **feature**: everything else

    When a field is ``None`` (missing from the spec), the change is
    conservatively routed to the **feature** tier.
    """
    thresholds = {**DEFAULT_THRESHOLDS, **(config or {})}

    loc = metadata.get("estimated_loc")
    clusters = metadata.get("clusters_touched")
    new_api = metadata.get("new_public_api")

    signals = {k: v for k, v in metadata.items() if k in _ALL_FIELDS}

    # If critical signals are missing, default to feature (safe middle ground)
    if loc is None or clusters is None:
        tier = "feature"
    else:
        is_system = clusters >= thresholds["system_min_clusters"] or (
            bool(new_api) and loc >= thresholds["system_min_loc_with_api"]
        )
        is_patch = (
            loc < thresholds["patch_max_loc"]
            and clusters <= thresholds["patch_max_clusters"]
            and not new_api
        )

        if is_system:
            tier = "system"
        elif is_patch:
            tier = "patch"
        else:
            tier = "feature"

    return {
        "tier": tier,
        "signals": signals,
        "pipeline_shape": _PIPELINE_MAP[tier],
    }
