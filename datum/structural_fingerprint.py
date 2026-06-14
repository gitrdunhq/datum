"""Structural fingerprint module."""

import ast
from collections import OrderedDict


def structural_fingerprint(content: str, filename: str = "") -> str:
    """Fingerprint the shape of a source file."""
    ext = ""
    if filename:
        if "." in filename:
            ext = filename.rsplit(".", 1)[1].lower()

    lines = content.splitlines()
    line_count = len(lines)
    if line_count <= 10:
        bucket = "s"
    elif line_count <= 50:
        bucket = "m"
    elif line_count <= 200:
        bucket = "l"
    else:
        bucket = "xl"

    import_count = 0
    fn_count = 0
    try:
        tree = ast.parse(content)
        for node in ast.iter_child_nodes(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                import_count += 1
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                fn_count += 1
    except SyntaxError:
        for raw_line in lines:
            stripped = raw_line.lstrip()
            if stripped.startswith("import ") or stripped.startswith("from "):
                import_count += 1
            elif stripped.startswith("def ") or stripped.startswith("class "):
                fn_count += 1

    first_line = ""
    for raw_line in lines:
        stripped = raw_line.strip()
        if stripped:
            first_line = stripped[:40]
            break

    return f"{ext}:{bucket}:{import_count}:{fn_count}:{first_line}"


def collapse_fingerprint_groups(entries: list[tuple[str, str]]) -> list[str]:
    """Group files by fingerprint; collapse duplicates into summary lines."""
    groups: OrderedDict[str, list[str]] = OrderedDict()
    for filename, content in entries:
        fp = structural_fingerprint(content, filename)
        if fp not in groups:
            groups[fp] = []
        groups[fp].append(filename)

    result: list[str] = []
    for fp, names in groups.items():
        if len(names) == 1:
            result.append(names[0])
        else:
            first = names[0]
            others = names[1:]
            count = len(others)
            if len(others) <= 5:
                others_str = ", ".join(others)
            else:
                shown = others[:5]
                remaining = len(others) - 5
                others_str = ", ".join(shown) + f", +{remaining} more"
            result.append(f"{first} (+{count} more with same shape: {others_str})")
    return result
