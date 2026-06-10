# datum-local

Local workspace companion to [datum](../datum). This repo proves the local
write path end-to-end — no Claude / Anthropic calls, ever.

## Editable-dependency rationale

datum's `path_utils.skill_root()` resolves paths relative to the source tree
(`Path(__file__).resolve().parent.parent`). A released wheel excludes
`assets/`, `scripts/lane-tools/`, and `references/`, so an editable install
from the sibling checkout is the only shape that works today.

`pyproject.toml` declares:

```toml
[tool.uv.sources]
datum = { path = "../datum", editable = true }
```

This means `import datum.state` resolves to the sibling `../datum/` directory,
and all lane-tool scripts and config templates are found at their on-disk
locations without any path munging.

## Strictly-local constraint

- No Claude / Anthropic model IDs in any config or metrics log.
- All inference runs through oMLX (`localhost:12200`) or `mlx_lm` direct loading.
- Write tools are enabled only when `cwd` is set to a sandboxed fixture repo.

## Quick start

```bash
# From the datum repo root — creates this sibling repo:
bash docs/epics/datum/epic-26/bootstrap/materialize.sh

cd ../datum-local
uv sync
uv run python -c "import datum.state; print('ok')"
```

## Fixture

`fixtures/toy-project/` is a tiny standalone git repo used as the M1 driver
target. It is `.gitignore`d in datum-local to avoid submodule confusion.
