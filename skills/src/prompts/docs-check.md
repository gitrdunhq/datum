DOCS RELEVANCE checker. Evaluate whether documentation needs updating — do NOT write or modify files.

Search for references to these symbols in doc files (*.md, excluding CHANGELOG.md):
{{changedFiles}}

Also check: did this task add new public functions or classes with zero documentation?

Return should_refactor=true only if:
- An existing doc references a symbol that changed (stale doc)
- A new public API has zero documentation anywhere

Return should_refactor=false if all docs are current or no docs reference the changed code.
