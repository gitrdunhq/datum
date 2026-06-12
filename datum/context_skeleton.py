"""context_skeleton.py — indent-based skeleton extraction for context offload.

Issue #93: when context fills, compress already-read source files to
signatures/imports/types only.  Priority scoring (import fan-in) determines
which files stay full-fat and which get compressed.

Public API
----------
extract_skeleton(content, filename) -> str
    Reduce a source file to its structural skeleton (imports, class/function
    signatures, top-level constants, module docstring).  Bodies are replaced
    with ``...``.  Non-Python files are returned unchanged.

score_file_priority(path, read_paths, search_root=None) -> float
    Score a file by import fan-in (how many other files import it).
    Higher score → keep full.

select_files_to_compress(read_paths, keep_full_count, search_root=None) -> list[str]
    Given the set of already-read paths, return those that should be
    compressed (lowest-priority ones, after keeping ``keep_full_count`` at
    full fidelity).
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

# ── extract_skeleton ──────────────────────────────────────────────────────────

_PYTHON_EXTS = {".py", ".pyi"}


def extract_skeleton(content: str, filename: str = "") -> str:
    """Return a skeleton of *content* — imports, signatures, constants only.

    For Python files (detected by *filename* extension) the function uses an
    AST-based pass with an indent-based fallback for unparseable files.
    All other file types are returned unchanged.
    """
    ext = Path(filename).suffix.lower() if filename else ""
    if ext not in _PYTHON_EXTS:
        return content

    if not content.strip():
        return content

    try:
        tree = ast.parse(content)
    except SyntaxError:
        return _extract_skeleton_indent(content)

    lines = content.splitlines(keepends=True)
    # Build a set of line numbers (1-based) to keep
    keep: set[int] = set()

    for node in ast.walk(tree):
        # Module docstring: the first statement if it is a string constant
        if isinstance(node, ast.Module):
            if (
                node.body
                and isinstance(node.body[0], ast.Expr)
                and isinstance(node.body[0].value, ast.Constant)
                and isinstance(node.body[0].value.value, str)
            ):
                doc = node.body[0]
                for ln in range(doc.lineno, doc.end_lineno + 1):
                    keep.add(ln)

        # All import lines
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for ln in range(node.lineno, node.end_lineno + 1):
                keep.add(ln)

        # Top-level assignments (constants, type aliases) — only at module scope
        if isinstance(node, ast.Module):
            for stmt in node.body:
                if isinstance(stmt, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                    for ln in range(stmt.lineno, stmt.end_lineno + 1):
                        keep.add(ln)

        # Function and class definitions — keep signature + decorators, stub body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            # Decorators
            for dec in node.decorator_list:
                for ln in range(dec.lineno, dec.end_lineno + 1):
                    keep.add(ln)
            # Definition line(s) — from `def`/`class` up to the colon
            # node.lineno is the first line of the def/class statement itself
            # node.body[0].lineno is the first line of the body
            body_start = node.body[0].lineno if node.body else node.end_lineno
            for ln in range(node.lineno, body_start):
                keep.add(ln)

    # Build output: kept lines verbatim, each function/class body replaced
    # with a single "..." stub at the right indent level.
    result_lines: list[str] = []
    stub_needed_after: dict[int, int] = {}  # body_start_line -> indent_level

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            body_start = node.body[0].lineno
            # Indentation of the def line
            def_line = lines[node.lineno - 1]
            indent = len(def_line) - len(def_line.lstrip())
            stub_needed_after[body_start] = indent + 4

    # Collect class bodies that are ONLY method definitions — don't stub them,
    # they'll be handled per-method.  We do need class-level assignments though.
    class_body_lines: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for stmt in node.body:
                if isinstance(stmt, (ast.Assign, ast.AnnAssign)):
                    for ln in range(stmt.lineno, stmt.end_lineno + 1):
                        keep.add(ln)
                        class_body_lines.add(ln)

    inserted_stubs: set[int] = set()
    for i, raw_line in enumerate(lines, start=1):
        if i in keep or i in class_body_lines:
            result_lines.append(raw_line.rstrip("\n"))
        elif i in stub_needed_after and i not in inserted_stubs:
            indent_spaces = " " * stub_needed_after[i]
            result_lines.append(f"{indent_spaces}...")
            inserted_stubs.add(i)
        # else: body line — drop it

    # Deduplicate consecutive "..." stubs (multiple methods share same body start)
    deduped: list[str] = []
    for ln in result_lines:
        if deduped and deduped[-1].strip() == "..." and ln.strip() == "...":
            continue
        deduped.append(ln)

    return "\n".join(deduped) + "\n"


def _extract_skeleton_indent(content: str) -> str:
    """Fallback indent-based skeleton for files that fail ast.parse.

    Keeps: blank lines at top, import/from lines, def/class lines (with
    decorators), and top-level simple assignments.  Everything inside a
    function/class body is replaced with ``...``.
    """
    lines = content.splitlines()
    result: list[str] = []
    in_body = False
    body_indent: int | None = None
    stub_pending = False

    for line in lines:
        stripped = line.lstrip()
        current_indent = len(line) - len(stripped)

        if not stripped:
            result.append("")
            continue

        if in_body and body_indent is not None:
            if current_indent > body_indent:
                # Still inside the body — skip, but emit stub once
                if stub_pending:
                    result.append(" " * (body_indent + 4) + "...")
                    stub_pending = False
                continue
            else:
                in_body = False
                body_indent = None

        is_def = stripped.startswith(("def ", "async def ", "class "))
        is_import = stripped.startswith(("import ", "from "))
        is_decorator = stripped.startswith("@")
        is_assignment = (
            not is_def
            and not is_import
            and not is_decorator
            and current_indent == 0
            and "=" in stripped
            and not stripped.startswith("#")
        )
        is_docstring = stripped.startswith(('"""', "'''", '"', "'"))

        if is_def or is_import or is_decorator or is_assignment or is_docstring:
            result.append(line)
            if is_def:
                in_body = True
                body_indent = current_indent
                stub_pending = True
        # else: skip

    return "\n".join(result) + "\n"


# ── score_file_priority ───────────────────────────────────────────────────────

# Regex to find import statements referencing a module name
_IMPORT_RE = re.compile(
    r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))", re.MULTILINE
)


def score_file_priority(
    path: str,
    read_paths: set[str],
    search_root: Path | None = None,
) -> float:
    """Score *path* by how many other source files import it.

    Returns a float >= 0.  Higher means keep full in context.
    Missing files return 0.0.

    Parameters
    ----------
    path:
        Path to the file being scored (absolute or relative string).
    read_paths:
        Set of already-read file paths (currently unused but reserved for
        recency weighting in a future pass).
    search_root:
        Directory to search for importers.  Defaults to ``Path.cwd()``.
    """
    target = Path(path)
    if not target.exists():
        return 0.0

    root = search_root or Path.cwd()
    module_name = target.stem  # simple stem match (e.g. "agent_loop")

    fan_in = 0
    try:
        for src_file in root.rglob("*.py"):
            if src_file.resolve() == target.resolve():
                continue
            try:
                text = src_file.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            for match in _IMPORT_RE.finditer(text):
                imported = match.group(1) or match.group(2) or ""
                # Match on the last segment (e.g. "datum.agent_loop" → "agent_loop")
                if imported.split(".")[-1] == module_name:
                    fan_in += 1
                    break  # one hit per file is enough
    except OSError:
        return 0.0

    return float(fan_in)


# ── select_files_to_compress ──────────────────────────────────────────────────


def select_files_to_compress(
    read_paths: set[str],
    keep_full_count: int,
    search_root: Path | None = None,
) -> list[str]:
    """Return the subset of *read_paths* that should be skeleton-compressed.

    The ``keep_full_count`` highest-priority files stay full-fat; the rest
    are returned as candidates for compression.  Only ``.py`` files are ever
    compressed; other types are always kept full.

    Parameters
    ----------
    read_paths:
        Set of file paths that have been fully read into the agent context.
    keep_full_count:
        How many files to keep at full fidelity (sorted by priority score
        descending).
    search_root:
        Passed through to :func:`score_file_priority`.
    """
    if not read_paths:
        return []

    py_paths = [p for p in read_paths if Path(p).suffix.lower() in _PYTHON_EXTS]
    if not py_paths:
        return []

    scored = [
        (p, score_file_priority(p, read_paths=read_paths, search_root=search_root))
        for p in py_paths
    ]
    # Sort descending by score — highest priority first
    scored.sort(key=lambda t: t[1], reverse=True)

    if keep_full_count >= len(scored):
        return []

    return [p for p, _ in scored[keep_full_count:]]
