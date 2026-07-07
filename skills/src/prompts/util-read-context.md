Return a JSON object with:
1. "branch": output of `git rev-parse --abbrev-ref HEAD`
2. "epic_dir": "docs/epics/" + the branch name
{{extraFields}}
If any field embeds full multi-line file contents, do NOT hand-type the JSON — build it programmatically with a command that guarantees correct escaping, e.g.:
`python3 -c "import json; print(json.dumps({'branch': ..., 'epic_dir': ..., 'spec_content': open('path/SPEC.md').read(), ...}))"`
Hand-escaping large files reliably produces invalid JSON (stray backslashes, unescaped control chars). Run that command, then output only its stdout — no markdown fences, no commentary.
