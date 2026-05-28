"""
landscape.py — Filesystem scaffold generator for LANDSCAPE.md.

Scans a project root and produces a structured markdown landscape document
containing tech stack detection, file tree with LOC counts, module docstrings,
and GitNexus enrichment markers.

Properties:
  LIVE-002:  always produces output
  BOUND-005: empty dir -> valid markdown
  IDEM-001:  cache hit on second run
  IDEM-002:  force bypasses cache
  PERF-002:  < 30s on 10K files
  PERF-003:  cache hit < 1s
  OBS-003:   cache status in output
  ISOL-003:  gitnexus markers don't overwrite scaffold
"""

from __future__ import annotations

import hashlib
import json
import os
import textwrap
from pathlib import Path

SKIP_DIRS = frozenset(
    {
        ".git",
        "__pycache__",
        "node_modules",
        ".venv",
        ".datum",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".tox",
    }
)

TECH_STACK_FILES: dict[str, str] = {
    "pyproject.toml": "python",
    "setup.py": "python",
    "package.json": "node/javascript",
    "go.mod": "go",
    "Cargo.toml": "rust",
}


def generate_scaffold(
    root_path: Path,
    force: bool = False,
    cache_dir: Path | None = None,
) -> dict:
    """Generate a LANDSCAPE.md scaffold for the given project root.

    Returns {"markdown": str, "cache_hit": bool}.
    """
    root_path = root_path.resolve()
    if cache_dir is None:
        cache_dir = root_path / ".datum"
    cache_dir.mkdir(parents=True, exist_ok=True)

    content_hash = _compute_hash(root_path)

    if not force:
        cached = _check_cache(cache_dir, content_hash)
        if cached is not None:
            return {"markdown": cached, "cache_hit": True}

    md = _build_markdown(root_path)
    _write_cache(cache_dir, content_hash, md)
    return {"markdown": md, "cache_hit": False}


def _compute_hash(root_path: Path) -> str:
    """Hash based on sorted (relative_path, size, mtime_ns) tuples."""
    entries: list[tuple[str, int, int]] = []
    for dirpath, dirnames, filenames in os.walk(root_path):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fname in filenames:
            fpath = Path(dirpath) / fname
            try:
                stat = fpath.stat()
                rel = str(fpath.relative_to(root_path))
                entries.append((rel, stat.st_size, stat.st_mtime_ns))
            except OSError:
                continue

    entries.sort()
    h = hashlib.sha256()
    for rel, size, mtime in entries:
        h.update(f"{rel}|{size}|{mtime}".encode())
    return h.hexdigest()


def _check_cache(cache_dir: Path, content_hash: str) -> str | None:
    """Return cached markdown if hash matches, else None."""
    hash_file = cache_dir / "landscape-hash"
    cache_file = cache_dir / "landscape-cache.md"
    if hash_file.exists() and cache_file.exists():
        stored_hash = hash_file.read_text(encoding="utf-8").strip()
        if stored_hash == content_hash:
            return cache_file.read_text(encoding="utf-8")
    return None


def _write_cache(cache_dir: Path, content_hash: str, markdown: str) -> None:
    """Persist hash and markdown to cache."""
    (cache_dir / "landscape-hash").write_text(content_hash, encoding="utf-8")
    (cache_dir / "landscape-cache.md").write_text(markdown, encoding="utf-8")


def _build_markdown(root_path: Path) -> str:
    """Assemble the full LANDSCAPE.md content."""
    sections: list[str] = []
    sections.append("# Landscape\n")

    sections.append(_section_tech_stack(root_path))
    sections.append(_section_file_tree(root_path))
    sections.append(_section_module_docstrings(root_path))
    sections.append(_section_gitnexus())

    return "\n".join(sections)


def _section_tech_stack(root_path: Path) -> str:
    """Detect tech stack from marker files."""
    lines = ["## Tech Stack\n"]
    detected: list[str] = []

    for filename, stack in TECH_STACK_FILES.items():
        marker = root_path / filename
        if marker.exists():
            name = _extract_project_name(marker, stack)
            label = f"- **{stack}**"
            if name:
                label += f": {name}"
            detected.append(label)

    if detected:
        lines.extend(detected)
    else:
        lines.append("_No recognized tech stack files found._")

    lines.append("")
    return "\n".join(lines)


def _extract_project_name(marker: Path, stack: str) -> str | None:
    """Extract project name from a stack marker file."""
    if stack == "python" and marker.name == "pyproject.toml":
        return _parse_pyproject_name(marker)
    if stack == "node/javascript" and marker.name == "package.json":
        return _parse_package_json_name(marker)
    if stack == "go" and marker.name == "go.mod":
        return _parse_go_mod_name(marker)
    if stack == "rust" and marker.name == "Cargo.toml":
        return _parse_cargo_name(marker)
    return None


def _parse_pyproject_name(path: Path) -> str | None:
    """Extract name from pyproject.toml using tomllib (Python 3.11+)."""
    try:
        import tomllib
    except ImportError:
        return None
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
        return data.get("project", {}).get("name")
    except Exception:
        return None


def _parse_package_json_name(path: Path) -> str | None:
    """Extract name from package.json."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("name")
    except Exception:
        return None


def _parse_go_mod_name(path: Path) -> str | None:
    """Extract module name from go.mod first line."""
    try:
        first_line = path.read_text(encoding="utf-8").split("\n", 1)[0]
        if first_line.startswith("module "):
            return first_line[len("module ") :].strip()
    except Exception:
        pass
    return None


def _parse_cargo_name(path: Path) -> str | None:
    """Extract name from Cargo.toml."""
    try:
        import tomllib
    except ImportError:
        return None
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
        return data.get("package", {}).get("name")
    except Exception:
        return None


def _section_file_tree(root_path: Path) -> str:
    """Build file tree with LOC per directory."""
    lines = ["## File Tree\n", "```"]
    dir_loc: dict[str, int] = {}
    file_entries: list[tuple[str, int]] = []

    for dirpath, dirnames, filenames in os.walk(root_path):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        rel_dir = str(Path(dirpath).relative_to(root_path))
        if rel_dir == ".":
            rel_dir = ""

        dir_total = 0
        for fname in sorted(filenames):
            fpath = Path(dirpath) / fname
            loc = _count_lines(fpath)
            dir_total += loc
            rel_file = str(fpath.relative_to(root_path))
            file_entries.append((rel_file, loc))

        if rel_dir:
            dir_loc[rel_dir] = dir_loc.get(rel_dir, 0) + dir_total
            # Accumulate to parent directories
            parts = Path(rel_dir).parts
            for i in range(len(parts) - 1):
                parent = str(Path(*parts[: i + 1]))
                dir_loc[parent] = dir_loc.get(parent, 0) + dir_total
        else:
            dir_loc["."] = dir_total

    # Render tree
    for entry, loc in file_entries:
        depth = entry.count(os.sep)
        indent = "  " * depth
        name = Path(entry).name
        lines.append(f"{indent}{name} ({loc} LOC)")

    lines.append("```\n")

    # Directory LOC summary
    if dir_loc:
        lines.append("### LOC by Directory\n")
        lines.append("| Directory | LOC |")
        lines.append("|-----------|-----|")
        for d in sorted(dir_loc):
            label = d if d != "." else "(root)"
            lines.append(f"| {label} | {dir_loc[d]} |")
        lines.append("")

    return "\n".join(lines)


def _count_lines(path: Path) -> int:
    """Count lines in a file. Returns 0 on error."""
    try:
        with open(path, "rb") as f:
            return sum(1 for _ in f)
    except (OSError, UnicodeDecodeError):
        return 0


def _section_module_docstrings(root_path: Path) -> str:
    """Extract docstrings from __init__.py files."""
    lines = ["## Module Docstrings\n"]
    found = False

    for dirpath, dirnames, filenames in os.walk(root_path):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        if "__init__.py" in filenames:
            init_path = Path(dirpath) / "__init__.py"
            docstring = _extract_docstring(init_path)
            if docstring:
                rel = str(Path(dirpath).relative_to(root_path))
                if rel == ".":
                    rel = "(root)"
                lines.append(f"- **{rel}**: {docstring}")
                found = True

    if not found:
        lines.append("_No module docstrings found._")

    lines.append("")
    return "\n".join(lines)


def _extract_docstring(path: Path) -> str | None:
    """Extract the module-level docstring from a Python file via AST."""
    import ast

    try:
        content = path.read_text(encoding="utf-8")
        tree = ast.parse(content)
        return ast.get_docstring(tree)
    except Exception:
        return None


def _section_gitnexus() -> str:
    """GitNexus enrichment zone — markers only."""
    return textwrap.dedent("""\
        ## GitNexus Enrichment

        <!-- gitnexus:start -->
        <!-- gitnexus:end -->
    """)
