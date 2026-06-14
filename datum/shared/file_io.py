"""
WFC File I/O Utilities

Safe, consistent file operations with proper error handling.
Eliminates inline boilerplate for JSON, YAML, and text file operations.
"""

import json
from pathlib import Path
from typing import Any, Dict, Optional

from filelock import FileLock, Timeout

from datum.shared.logging import get_logger

logger = get_logger(__name__)

# Sentinel used by load_json to distinguish "no default supplied" from
# "default=None supplied explicitly". Without this, callers could not
# request None as a valid fallback — the previous ``if default is not
# None`` check would re-raise even when the caller asked for None.
_UNSET: Any = object()


class FileIOError(Exception):
    """Base exception for file I/O errors"""

    pass


def load_json(path: Path, default: Any = _UNSET) -> Any:
    """
    Load JSON file safely with proper error handling.

    Args:
        path: Path to JSON file
        default: Value to return if the file does not exist. If omitted,
            a missing file raises FileIOError. Pass ``default=None`` (or
            any other value) to get that value on missing.

    Returns:
        Parsed JSON (typically a dict), or *default* if the file is
        missing and a default was supplied.

    Raises:
        FileIOError: If the file is missing and no default was supplied,
            or if the file exists but can't be read or parsed.

    Example:
        config = load_json(Path('config.json'))
        config = load_json(Path('config.json'), default={})  # Returns {} if missing
        config = load_json(Path('config.json'), default=None)  # Returns None if missing
    """
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError as e:
        if default is not _UNSET:
            return default
        raise FileIOError(f"File not found: {path}") from e
    except json.JSONDecodeError as e:
        raise FileIOError(f"Invalid JSON in {path}: {e}") from e
    except Exception as e:
        raise FileIOError(f"Error reading {path}: {e}") from e


def save_json(
    path: Path, data: dict[str, Any], indent: int = 2, ensure_parent: bool = True
) -> None:
    """
    Save JSON file safely with proper formatting.

    Args:
        path: Path to save JSON file
        data: Dict to save as JSON
        indent: JSON indentation (default: 2 spaces)
        ensure_parent: Create parent directory if needed (default: True)

    Raises:
        FileIOError: If file can't be written

    Example:
        save_json(Path('config.json'), {'key': 'value'})
        save_json(Path('data.json'), data, indent=4)
    """
    try:
        path = Path(path)

        if ensure_parent and not path.parent.exists():
            path.parent.mkdir(parents=True, exist_ok=True)

        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=indent, ensure_ascii=False)

    except Exception as e:
        raise FileIOError(f"Error writing {path}: {e}") from e


def update_json(
    path: Path,
    updates: dict[str, Any],
    create_if_missing: bool = True,
    timeout: int = 10,
) -> dict[str, Any]:
    """
    Update JSON file with new values (merge operation).

    Uses file locking to prevent read-modify-write races from concurrent callers.

    Args:
        path: Path to JSON file
        updates: Dict with values to update
        create_if_missing: Create file if doesn't exist (default: True)
        timeout: Lock timeout in seconds (default: 10)

    Returns:
        Updated dict (after merge)

    Raises:
        FileIOError: If file can't be read or written, or lock times out

    Example:
        # Update existing config
        config = update_json(Path('config.json'), {'new_key': 'value'})

        # Merge deeply
        config = update_json(Path('config.json'), {'nested': {'key': 'value'}})
    """
    try:
        path = Path(path).resolve()
        lock_path = path.parent / f"{path.name}.lock"

        if not path.parent.exists():
            path.parent.mkdir(parents=True, exist_ok=True)

        with FileLock(lock_path, timeout=timeout):
            data = load_json(path, default={} if create_if_missing else None)
            data.update(updates)
            save_json(path, data)
            return data

    except Timeout:
        raise FileIOError(f"Failed to acquire lock for {path} within {timeout}s")
    except FileIOError:
        raise
    except Exception as e:
        raise FileIOError(f"Error updating {path}: {e}") from e


def load_text(path: Path, default: str | None = None) -> str:
    """
    Load text file safely.

    Args:
        path: Path to text file
        default: Default value if file doesn't exist

    Returns:
        File contents as string

    Raises:
        FileIOError: If file exists but can't be read

    Example:
        content = load_text(Path('README.md'))
        content = load_text(Path('notes.txt'), default='')
    """
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError as e:
        if default is not None:
            return default
        raise FileIOError(f"File not found: {path}") from e
    except Exception as e:
        raise FileIOError(f"Error reading {path}: {e}") from e


def save_text(path: Path, content: str, ensure_parent: bool = True) -> None:
    """
    Save text file safely.

    Args:
        path: Path to save text file
        content: String content to save
        ensure_parent: Create parent directory if needed (default: True)

    Raises:
        FileIOError: If file can't be written

    Example:
        save_text(Path('README.md'), '# My Project')
    """
    try:
        path = Path(path)

        if ensure_parent and not path.parent.exists():
            path.parent.mkdir(parents=True, exist_ok=True)

        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    except Exception as e:
        raise FileIOError(f"Error writing {path}: {e}") from e


def safe_append_text(
    path: Path, content: str, ensure_parent: bool = True, timeout: int = 10
) -> None:
    """
    Append to text file safely with file locking for concurrent writes.

    Args:
        path: Path to text file
        content: String content to append
        ensure_parent: Create parent directory if needed (default: True)
        timeout: Lock timeout in seconds (default: 10)

    Raises:
        FileIOError: If file can't be written or lock times out

    Example:
        safe_append_text(Path('log.txt'), 'New log entry\\n')
        safe_append_text(Path('log.txt'), 'Entry\\n', timeout=5)
    """
    try:
        path = Path(path).resolve()
        lock_path = path.parent / f"{path.name}.lock"
        lock_path = lock_path.resolve()

        if lock_path.parent != path.parent:
            raise FileIOError(f"Lock file path traversal detected: {lock_path}")

        if ensure_parent and not path.parent.exists():
            path.parent.mkdir(parents=True, exist_ok=True)

        with FileLock(lock_path, timeout=timeout):
            with open(path, "a", encoding="utf-8") as f:
                f.write(content)

    except Timeout:
        raise FileIOError(f"Failed to acquire lock for {path} within {timeout}s")
    except FileIOError:
        raise
    except Exception as e:
        raise FileIOError(f"Error appending to {path}: {e}") from e


def append_text(path: Path, content: str, ensure_parent: bool = True) -> None:
    """
    Append to text file safely (delegates to safe_append_text).

    Args:
        path: Path to text file
        content: String content to append
        ensure_parent: Create parent directory if needed (default: True)

    Raises:
        FileIOError: If file can't be written

    Example:
        append_text(Path('log.txt'), 'New log entry\\n')
    """
    safe_append_text(path, content, ensure_parent=ensure_parent)


read_json = load_json
write_json = save_json
read_text = load_text
write_text = save_text
