# Lane Tools

Reusable helpers for DATUM agent lanes. Read this file before starting work to
know what tools are already available. Using an existing tool is always cheaper
than writing the same thing from scratch.

All tools are sandboxed via `scripts/lane-tools-runner.py`. Permissions for
each tool are declared in `manifest.toml`.

## Available Tools

## find_callers.py
Find likely call/reference sites for a symbol without loading whole files.
Usage: `datum lane-tool find_callers <symbol_name>`

## filter_gitnexus_output.py
Reduce GitNexus output to compact file, line, confidence records.
Usage: `gitnexus impact <symbol> | datum lane-tool filter_gitnexus_output`

---

## Adding a New Tool

When you write a new helper:
1. Place it in `scripts/lane-tools/<name>.py`
2. Add a manifest entry to `scripts/lane-tools/manifest.toml`
3. Add a one-line description to this README under "Available Tools"
4. Include all three changes in the same commit

The pre-commit hook will reject commits that add scripts without a manifest entry.
