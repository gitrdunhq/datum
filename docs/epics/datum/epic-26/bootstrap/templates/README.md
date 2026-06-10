# datum-local

Local workspace companion to [datum](../datum). This repo proves the local
write path end-to-end — no Claude / Anthropic calls, ever.

## Editable-dependency rationale

datum's wheel ([`[tool.hatch.build.targets.wheel] packages = ["datum"]`][hatch])
packages only the `datum/` Python tree. The directories that datum's runtime
needs at startup are **excluded from the wheel**:

- `assets/` — default `config.toml.default`, prompt templates, reference files
- `references/` — lane-tool spec and constraint documents
- `scripts/lane-tools/` — the read/write tool scripts dispatched by `_execute_tool`

`datum/path_utils.skill_root()` resolves these paths relative to the
**source tree** (`Path(__file__).resolve().parent.parent`), not via
`importlib.resources`. A released wheel install therefore fails to find
`scripts/lane-tools/` and raises at runtime.

The editable install from the sibling checkout is the only shape that works:

```toml
# datum-local/pyproject.toml
[tool.uv.sources]
datum = { path = "../datum", editable = true }
```

With this declaration, `import datum.state` resolves to `../datum/datum/state.py`
in the sibling checkout. `datum.path_utils.skill_root()` returns the checkout
root, so `assets/`, `references/`, and `scripts/lane-tools/` are all found at
their on-disk locations without any path munging.

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
target. It is `.gitignore`d in datum-local to avoid submodule confusion. The
fixture's `.git/` is a real directory (not a file), confirming it is a
standalone repo rather than a submodule.

## Layout

```
datum-local/
├── pyproject.toml          # editable dep on ../datum via [tool.uv.sources]
├── datum_local/__init__.py # minimal package (importable)
├── fixtures/
│   └── toy-project/        # standalone fixture git repo (gitignored here)
├── scripts/
│   └── m1_driver.py        # M1 RED-GREEN driver
└── tests/
    ├── test_contracts.py   # datum API surface contract tests
    └── test_m1_e2e.py      # end-to-end M1 driver test (skippable)
```
