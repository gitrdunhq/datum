#!/usr/bin/env bash
set -e

# Run from the datum-ax root regardless of invocation dir, so `uv tool install .` targets the project.
cd "$(dirname "$0")/.."

echo "Rebuilding and reinstalling datum-ax CLI..."

# The --reinstall flag forces uv to ignore the cached wheel for the current version
# The --force flag overwrites the existing datumax executable link
uv tool install --reinstall --force .

echo "✅ datumax has been successfully rebuilt and updated!"
