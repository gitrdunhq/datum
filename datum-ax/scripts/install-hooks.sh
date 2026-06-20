#!/usr/bin/env bash
set -e

# Install the datum-ax pre-commit hook (ruff format-check + ruff lint + mypy). pre-commit discovers the
# config at the git root and writes the git repo's .git/hooks/pre-commit.
cd "$(dirname "$0")/.."

uv run pre-commit install

echo "✅ datum-ax pre-commit hook installed (ruff format + ruff check + mypy)."
