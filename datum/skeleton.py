import re
from pathlib import Path

def extract_skeleton(content: str) -> str:
    """
    Indent-based Python skeleton extractor.
    Keeps signatures (def, class), imports (import, from), decorators,
    and top-level assignments (e.g. types, constants).
    Replaces function bodies with `...`.
    """
    lines = content.split('\n')
    skeleton = []
    
    # Simple state machine to handle bodies
    in_body = False
    body_indent = 0
    in_docstring = False
    docstring_char = None
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        indent = len(line) - len(line.lstrip())
        
        # Handle docstrings (very basic heuristic)
        if in_docstring:
            if docstring_char in stripped:
                in_docstring = False
            continue
        elif stripped.startswith('"""') or stripped.startswith("'''"):
            if len(stripped) > 3 and stripped.endswith(stripped[:3]):
                pass # single line docstring
            else:
                in_docstring = True
                docstring_char = stripped[:3]
            continue
            
        if not stripped:
            skeleton.append(line)
            continue
            
        # If we are inside a function/class body, check if we broke out of it
        if in_body:
            if indent <= body_indent:
                # We broke out, unless it's a closing parenthesis from a multi-line def
                if stripped in [')', '):', ']', '}']:
                    pass
                elif stripped.startswith('else:') or stripped.startswith('elif ') or stripped.startswith('except ') or stripped.startswith('finally:'):
                    pass # Not breaking out, just another block at same level
                else:
                    in_body = False
            else:
                continue # inside body, skip line
                
        # We are not in a body (or just broke out)
        if stripped.startswith('def ') or stripped.startswith('class ') or stripped.startswith('async def '):
            skeleton.append(line)
            # Find when the signature ends
            if stripped.endswith(':') or ':\n' in line or ':\\n' in line:
                skeleton.append(" " * (indent + 4) + "...")
                in_body = True
                body_indent = indent
            else:
                # wait for next line
                pass
            continue
            
        # If the signature was broken across lines, wait until we hit a colon
        if not in_body and skeleton and (skeleton[-1].lstrip().startswith('def ') or skeleton[-1].lstrip().startswith('class ') or skeleton[-1].lstrip().startswith('async def ')):
            if stripped.endswith(':'):
                skeleton.append(line)
                skeleton.append(" " * (indent + 4) + "...")
                in_body = True
                body_indent = len(skeleton[-3]) - len(skeleton[-3].lstrip())
            else:
                skeleton.append(line)
            continue

        if stripped.startswith('@'):
            skeleton.append(line)
            continue
            
        if stripped.startswith('import ') or stripped.startswith('from '):
            skeleton.append(line)
            continue
            
        # Top level or class level variable assignment
        if '=' in stripped and not stripped.startswith('assert ') and not stripped.startswith('if ') and not stripped.startswith('while ') and not stripped.startswith('for '):
            parts = stripped.split('=', 1)
            if re.match(r'^[a-zA-Z0-9_,\s:\.\[\]\'\"]+$', parts[0].strip()):
                skeleton.append(line)
                continue
                
        if indent == 0 and stripped:
            # At top level, if it's not one of the above, we keep it just in case it's a multi-line thing or important
            if not stripped.startswith('if __name__') and not stripped.startswith('pass') and not stripped.startswith('return') and not stripped.startswith('print'):
                 skeleton.append(line)
    
    return "\n".join(skeleton)

def extract_skeleton_from_file(path: Path) -> str:
    try:
        content = path.read_text(encoding='utf-8')
        return extract_skeleton(content)
    except Exception as e:
        return f"# Error extracting skeleton: {e}"

import subprocess

def get_git_frequency(path: str, repo_dir: str = ".") -> int:
    try:
        out = subprocess.check_output(
            ["git", "log", "--oneline", "--", path],
            cwd=repo_dir,
            text=True,
            stderr=subprocess.DEVNULL
        )
        return len([line for line in out.strip().split("\n") if line.strip()])
    except Exception:
        return 0

def get_import_fan_in(path: str, repo_dir: str = ".") -> int:
    path_obj = Path(path)
    stem = path_obj.stem
    if not stem:
        return 0
    try:
        # crude grep across .py files
        out = subprocess.check_output(
            ["git", "grep", "-l", f"import.*{stem}\\|from.*{stem}"],
            cwd=repo_dir,
            text=True,
            stderr=subprocess.DEVNULL
        )
        return len([line for line in out.strip().split("\n") if line.strip()])
    except Exception:
        return 0

def score_file_priority(path: str, repo_dir: str = ".") -> int:
    """Score a file's importance based on git frequency and import fan-in."""
    return get_git_frequency(path, repo_dir) + (get_import_fan_in(path, repo_dir) * 5)
