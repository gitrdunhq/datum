"""datum-local: local workspace companion to the datum repo.

This package is installed as an editable path dependency on datum, meaning:
- ``import datum.state``, ``import datum.local_llm``, etc. all resolve to the
  sibling datum checkout rather than a released wheel.
- ``datum.path_utils.skill_root()`` points at the datum repo root, so
  ``scripts/lane-tools/`` and ``assets/`` are found at their on-disk locations.

Architecture constraint (strictly-local):
- No Claude / Anthropic model IDs may appear in any config or metrics log.
- All inference goes through oMLX (localhost:12200) or mlx_lm direct loading.
- Write tools are enabled only inside a fixture repo whose cwd is sandboxed.
"""
