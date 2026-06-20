#!/usr/bin/env bash
set -e

echo "Rebuilding and reinstalling datum-ax CLI..."

# The --reinstall flag forces uv to ignore the cached wheel for the current version
# The --force flag overwrites the existing datumax executable link
uv tool install --reinstall --force .

echo "✅ datumax has been successfully rebuilt and updated!"
