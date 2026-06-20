#!/usr/bin/env bash
# All datum-ax quality gates in one place — run locally (`bash scripts/ci.sh`) or from CI.
set -euo pipefail

cd "$(dirname "$0")/.."

uv sync --group dev
uv run ruff format --check src tests
uv run ruff check src tests
uv run mypy
uv run pytest
