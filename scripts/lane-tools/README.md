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

## read_file.py
Read the full contents of a file.
Usage: `datum lane-tool read_file '{"path": "src/foo.py"}'`

## read_file_range.py
Read a specific line range from a file.
Usage: `datum lane-tool read_file_range '{"path": "src/foo.py", "start": 10, "end": 30}'`

## list_dir.py
List the contents of a directory.
Usage: `datum lane-tool list_dir '{"path": "src/"}'`

## grep_search.py
Search for a regex pattern in files under a directory.
Usage: `datum lane-tool grep_search '{"pattern": "def main", "path": "src/"}'`

## run_command.py
Execute a shell command and return its output.
Usage: `datum lane-tool run_command '{"command": "uv run pytest tests/ -q"}'`

## write_to_file.py
Write content to a file, creating parent directories as needed.
Usage: `datum lane-tool write_to_file '{"path": "out/result.txt", "content": "hello"}'`

## replace_file_content.py
Replace the first occurrence of old_text with new_text in a file.
Usage: `datum lane-tool replace_file_content '{"path": "src/foo.py", "old_text": "pass", "new_text": "return 42"}'`

## multi_replace_file_content.py
Apply a list of old_text/new_text replacements sequentially to a file.
Usage: `datum lane-tool multi_replace_file_content '{"path": "src/foo.py", "replacements": [{"old_text": "a", "new_text": "b"}]}'`

---

## Adding a New Tool

When you write a new helper:
1. Place it in `scripts/lane-tools/<name>.py`
2. Add a manifest entry to `scripts/lane-tools/manifest.toml`
3. Add a one-line description to this README under "Available Tools"
4. Include all three changes in the same commit

The pre-commit hook will reject commits that add scripts without a manifest entry.
