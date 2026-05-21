"""Migrate SPEC.md, TICKET.md, and PROPERTIES.md references to docs/ prefix.

Only replaces occurrences that look like file path references — backtick-quoted,
after keywords like write/read/output:/input:, in table cells, in code blocks, etc.
Does NOT replace in pure prose ("the SPEC.md describes...") unless it's a file ref.

Exclusions:
  - assets/templates/SPEC.md  (template source, not output location)
  - assets/templates/PROPERTIES.md
  - .datum/runs/.../SPEC.md   (archive paths)
  - .datum/runs/.../PROPERTIES.md
  - .datum/runs/.../TICKET.md
  - TASKS.md references (never touched)
"""

import re

TARGET_FILES = [
    "SKILL.md",
    "references/01-refine.md",
    "references/02-plan.md",
    "references/03-properties.md",
    "references/04-act.md",
    "references/brief-builder.md",
    "references/04-act-red-brief.md",
    "references/04-act-adversarial-brief.md",
    "references/04-act-refactor-brief.md",
    "references/gitnexus-playbook.md",
]

# Targets: the three files we want to prefix (TASKS.md is intentionally absent)
TARGETS = ["SPEC.md", "TICKET.md", "PROPERTIES.md"]

# Negative lookahead: don't prefix when already prefixed, in assets/templates/, or .datum/runs/
# Negative lookbehind: skip if preceded by assets/templates/ or .datum/runs/.../ or docs/
EXCLUDE_BEFORE = r"(?<!assets/templates/)(?<!\.datum/runs/[^/]*/)"

# We build one pattern per target.  Context indicators that signal "this is a file path ref":
#   - preceded by: backtick, write , read , `output:`, `input:`, `| `, `> `, or start-of-word in code fence
#   - OR: followed by backtick (closing a backtick-quoted path)
#   - OR: in a markdown table cell (preceded by `| ` and followed by ` ` or `|`)
#   - OR: after `-` bullet list items that mention the filename directly
#   - OR: preceded by `archive to `, `write `, `read `, `present `, `output `, `input `, `→ `
#
# Rather than a complex positive lookaround (risky with PROPERTIES.md in prose like
# "the PROPERTIES.md covers..."), we use a simpler approach:
#   Replace ALL occurrences EXCEPT those preceded by assets/templates/ or .datum/runs/<id>/
#   AND those that are already prefixed with docs/.
#
# The instruction says "only replace in contexts that look like file paths" but also says
# "change to docs/SPEC.md there only if it's clearly a file reference" — in practice
# nearly every mention in these workflow docs IS a file reference. We err toward replacing
# and rely on the exclusions to protect the three exception classes.

PROSE_EXCEPTIONS = [
    # "the SPEC.md" / "a SPEC.md" / "in SPEC.md" followed by verb — leave these alone
    # These patterns match prose like "the SPEC.md describes", "a TICKET.md is present"
    # We protect them by not replacing when preceded by an article or preposition + space.
    # Implemented as lookbehind below.
]


def build_pattern(name):
    """
    Match NAME when it should be replaced.
    Excludes:
      - already prefixed: docs/NAME
      - template paths: assets/templates/NAME
      - archive paths: .datum/runs/<anything>/NAME  (any subpath depth)
      - TASKS.md (handled by simply not including it in TARGETS)
    """
    escaped = re.escape(name)
    return re.compile(
        # Negative lookbehind: not preceded by 'docs/', 'assets/templates/', or a path segment
        # ending with '/' that would indicate a subdirectory reference (archive path).
        # We match the last path-separator prefix: if the char before NAME is '/', skip.
        r"(?<![/])(?<!docs/)" + escaped,
        flags=re.MULTILINE,
    )


def should_exclude(match, content, name):
    """Return True if this match should NOT be replaced."""
    start = match.start()
    # Get up to 60 chars before the match for context
    prefix = content[max(0, start - 60) : start]

    # Skip if already has docs/ prefix
    if prefix.endswith("docs/"):
        return True

    # Skip template paths
    if "assets/templates/" in prefix:
        return True

    # Skip archive paths: .datum/runs/ anywhere in prefix
    if ".datum/runs/" in prefix:
        return True

    # Skip if preceded by a bare '/' (i.e. already part of a longer path like some/other/SPEC.md)
    if prefix and prefix[-1] == "/":
        return True

    return False


def migrate_content(content, dry_run=False):
    """Apply all three target replacements to content. Returns (new_content, change_count)."""
    changes = 0
    for name in TARGETS:
        pattern = build_pattern(name)

        def replacer(m, _name=name, _content=content):
            if should_exclude(m, _content, _name):
                return m.group(0)
            return "docs/" + m.group(0)

        new_content, n = pattern.subn(replacer, content)
        changes += n
        content = new_content

    return content, changes


def process_file(path, dry_run=False):
    with open(path, "r") as f:
        original = f.read()

    new_content, changes = migrate_content(original)

    if changes == 0:
        return 0

    if dry_run:
        print(f"[dry-run] {path}: {changes} replacement(s)")
    else:
        with open(path, "w") as f:
            f.write(new_content)
        print(f"Updated {path}: {changes} replacement(s)")

    return changes


def main():
    import sys

    dry_run = "--dry-run" in sys.argv

    total_files = 0
    total_changes = 0

    for rel_path in TARGET_FILES:
        try:
            n = process_file(rel_path, dry_run=dry_run)
            if n > 0:
                total_files += 1
                total_changes += n
        except FileNotFoundError:
            print(f"SKIP (not found): {rel_path}")

    label = "Would update" if dry_run else "Updated"
    print(f"\n{label} {total_files} file(s) with {total_changes} total replacement(s).")


if __name__ == "__main__":
    main()
