#!/bin/sh
# materialize.sh — bootstrap ../datum-local as an editable-path sibling repo.
#
# Environment overrides:
#   DATUM_REPO_PATH    path to the datum repo (default: directory two levels
#                      above this script, i.e. the datum repo root)
#   DATUM_LOCAL_TARGET path where datum-local should be created
#                      (default: ../datum-local relative to DATUM_REPO_PATH)
#
# Usage:
#   bash docs/epics/datum/epic-26/bootstrap/materialize.sh
#
# Idempotent: running twice does not corrupt an existing datum-local.

set -eu

# ---------------------------------------------------------------------------
# Resolve paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "${DATUM_REPO_PATH:-}" ]; then
    # Two levels up from docs/epics/datum/epic-26/bootstrap/ is the repo root
    DATUM_REPO_PATH="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
fi

if [ -z "${DATUM_LOCAL_TARGET:-}" ]; then
    DATUM_LOCAL_TARGET="$(cd "$DATUM_REPO_PATH/.." && pwd)/datum-local"
fi

TEMPLATES_DIR="$SCRIPT_DIR/templates"
FIXTURE_TEMPLATES_DIR="$TEMPLATES_DIR/fixture"

# ---------------------------------------------------------------------------
# Validate datum repo exists
# ---------------------------------------------------------------------------
if [ ! -d "$DATUM_REPO_PATH" ]; then
    echo "ERROR: datum repo not found at: $DATUM_REPO_PATH" >&2
    echo "Set DATUM_REPO_PATH to the correct location." >&2
    exit 1
fi

if [ ! -f "$DATUM_REPO_PATH/pyproject.toml" ]; then
    echo "ERROR: $DATUM_REPO_PATH does not look like the datum repo (no pyproject.toml)." >&2
    exit 1
fi

echo "datum repo:  $DATUM_REPO_PATH"
echo "target:      $DATUM_LOCAL_TARGET"

# ---------------------------------------------------------------------------
# Create target directory
# ---------------------------------------------------------------------------
if [ ! -d "$DATUM_LOCAL_TARGET" ]; then
    mkdir -p "$DATUM_LOCAL_TARGET"
fi

# ---------------------------------------------------------------------------
# pyproject.toml (write relative path as ../datum using the repo's basename)
# ---------------------------------------------------------------------------
# Use ../<basename> so the pyproject.toml is portable and human-readable.
# The uv.sources path is relative to the pyproject.toml file, which lives
# directly inside DATUM_LOCAL_TARGET — so "../<repo-name>" points back to
# the datum repo regardless of where both repos were materialised on disk.
TARGET_PYPROJECT="$DATUM_LOCAL_TARGET/pyproject.toml"
if [ ! -f "$TARGET_PYPROJECT" ]; then
    DATUM_REPO_BASENAME="$(basename "$DATUM_REPO_PATH")"
    DATUM_REL_PATH="../$DATUM_REPO_BASENAME"
    sed "s|__DATUM_REPO_PATH__|$DATUM_REL_PATH|g" \
        "$TEMPLATES_DIR/pyproject.toml" > "$TARGET_PYPROJECT"
    echo "  created: pyproject.toml (datum path: $DATUM_REL_PATH)"
else
    echo "  exists:  pyproject.toml (skipped)"
fi

# ---------------------------------------------------------------------------
# datum_local/__init__.py
# ---------------------------------------------------------------------------
if [ ! -d "$DATUM_LOCAL_TARGET/datum_local" ]; then
    mkdir -p "$DATUM_LOCAL_TARGET/datum_local"
fi
TARGET_INIT="$DATUM_LOCAL_TARGET/datum_local/__init__.py"
if [ ! -f "$TARGET_INIT" ]; then
    cp "$TEMPLATES_DIR/init.py" "$TARGET_INIT"
    echo "  created: datum_local/__init__.py"
else
    echo "  exists:  datum_local/__init__.py (skipped)"
fi

# ---------------------------------------------------------------------------
# README.md
# ---------------------------------------------------------------------------
TARGET_README="$DATUM_LOCAL_TARGET/README.md"
if [ ! -f "$TARGET_README" ]; then
    cp "$TEMPLATES_DIR/README.md" "$TARGET_README"
    echo "  created: README.md"
else
    echo "  exists:  README.md (skipped)"
fi

# ---------------------------------------------------------------------------
# .gitignore
# ---------------------------------------------------------------------------
TARGET_GITIGNORE="$DATUM_LOCAL_TARGET/.gitignore"
if [ ! -f "$TARGET_GITIGNORE" ]; then
    cp "$TEMPLATES_DIR/gitignore" "$TARGET_GITIGNORE"
    echo "  created: .gitignore"
else
    echo "  exists:  .gitignore (skipped)"
fi

# ---------------------------------------------------------------------------
# Fixture: fixtures/toy-project/ (copy allowlist files only — never cp -r)
# ---------------------------------------------------------------------------
FIXTURE_DEST="$DATUM_LOCAL_TARGET/fixtures/toy-project"
if [ ! -d "$FIXTURE_DEST" ]; then
    mkdir -p "$FIXTURE_DEST"
fi

for fname in calculator.py conftest.py test_calculator.py pyproject.toml; do
    src="$FIXTURE_TEMPLATES_DIR/$fname"
    dst="$FIXTURE_DEST/$fname"
    if [ ! -f "$dst" ]; then
        cp "$src" "$dst"
        echo "  created: fixtures/toy-project/$fname"
    else
        echo "  exists:  fixtures/toy-project/$fname (skipped)"
    fi
done

# ---------------------------------------------------------------------------
# git init + initial commit for toy-project fixture
# ---------------------------------------------------------------------------
if [ ! -d "$FIXTURE_DEST/.git" ]; then
    git -C "$FIXTURE_DEST" init -q
    git -C "$FIXTURE_DEST" -c user.email=datum@local -c user.name=datum \
        add calculator.py conftest.py test_calculator.py pyproject.toml
    git -C "$FIXTURE_DEST" -c user.email=datum@local -c user.name=datum \
        commit -q -m "feat: initial fixture commit"
    echo "  git init + commit: fixtures/toy-project"
else
    echo "  exists:  fixtures/toy-project/.git (skipped)"
fi

# ---------------------------------------------------------------------------
# git init + initial commit for datum-local itself
# ---------------------------------------------------------------------------
if [ ! -d "$DATUM_LOCAL_TARGET/.git" ]; then
    git -C "$DATUM_LOCAL_TARGET" init -q
    git -C "$DATUM_LOCAL_TARGET" -c user.email=datum@local -c user.name=datum \
        add pyproject.toml datum_local/__init__.py README.md .gitignore
    git -C "$DATUM_LOCAL_TARGET" -c user.email=datum@local -c user.name=datum \
        commit -q -m "feat: scaffold datum-local"
    echo "  git init + commit: datum-local"
else
    echo "  exists:  $DATUM_LOCAL_TARGET/.git (skipped)"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "datum-local materialized at: $DATUM_LOCAL_TARGET"
echo "Run 'uv sync' in that directory to install dependencies."
