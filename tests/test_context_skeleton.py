"""TDD tests for datum.context_skeleton — indent-based skeleton extraction.

Issue #93: when context fills, compress already-read source files to
signatures/imports/types only.  Priority scoring keeps high-fan-in and
frequently-changed files full-fat.

RED phase: all tests must fail before datum/context_skeleton.py exists.
"""

from __future__ import annotations

import textwrap

# ── extract_skeleton ─────────────────────────────────────────────────────────


def test_skeleton_preserves_imports():
    from datum.context_skeleton import extract_skeleton

    src = textwrap.dedent("""\
        import os
        import sys
        from pathlib import Path
        from typing import Optional, List

        def do_stuff():
            x = os.getcwd()
            return x
        """)
    result = extract_skeleton(src, "foo.py")
    assert "import os" in result
    assert "import sys" in result
    assert "from pathlib import Path" in result
    assert "from typing import Optional, List" in result


def test_skeleton_preserves_function_signatures():
    from datum.context_skeleton import extract_skeleton

    src = textwrap.dedent("""\
        def simple(x: int, y: str = "hello") -> bool:
            # body
            return True

        async def async_fn(path: Path) -> None:
            pass
        """)
    result = extract_skeleton(src, "foo.py")
    assert 'def simple(x: int, y: str = "hello") -> bool:' in result
    assert "async def async_fn(path: Path) -> None:" in result


def test_skeleton_strips_function_body():
    from datum.context_skeleton import extract_skeleton

    src = textwrap.dedent("""\
        def compute(n: int) -> int:
            total = 0
            for i in range(n):
                total += i
            return total
        """)
    result = extract_skeleton(src, "foo.py")
    assert "def compute(n: int) -> int:" in result
    # Body lines are not in skeleton
    assert "total = 0" not in result
    assert "for i in range(n):" not in result
    assert "return total" not in result


def test_skeleton_preserves_class_definition():
    from datum.context_skeleton import extract_skeleton

    src = textwrap.dedent("""\
        class Foo(Bar):
            x: int = 0

            def method(self) -> str:
                return "hello"
        """)
    result = extract_skeleton(src, "foo.py")
    assert "class Foo(Bar):" in result


def test_skeleton_preserves_class_method_signatures():
    from datum.context_skeleton import extract_skeleton

    src = textwrap.dedent("""\
        class MyClass:
            def __init__(self, value: int) -> None:
                self.value = value

            def compute(self) -> int:
                return self.value * 2

            @classmethod
            def create(cls, data: dict) -> "MyClass":
                return cls(data["value"])
        """)
    result = extract_skeleton(src, "foo.py")
    assert "def __init__(self, value: int) -> None:" in result
    assert "def compute(self) -> int:" in result
    assert 'def create(cls, data: dict) -> "MyClass":' in result
    # Body stripped
    assert "self.value = value" not in result
    assert "return self.value * 2" not in result


def test_skeleton_preserves_module_docstring():
    from datum.context_skeleton import extract_skeleton

    src = textwrap.dedent('''\
        """Module-level docstring for the thing."""

        import os

        def main():
            pass
        ''')
    result = extract_skeleton(src, "foo.py")
    assert '"""Module-level docstring for the thing."""' in result


def test_skeleton_preserves_top_level_constants():
    from datum.context_skeleton import extract_skeleton

    src = textwrap.dedent("""\
        MAX_RETRIES = 3
        DEFAULT_TIMEOUT: int = 30
        _PRIVATE_CONST = "secret"

        def noop():
            pass
        """)
    result = extract_skeleton(src, "foo.py")
    assert "MAX_RETRIES = 3" in result
    assert "DEFAULT_TIMEOUT: int = 30" in result
    assert '_PRIVATE_CONST = "secret"' in result


def test_skeleton_preserves_type_aliases():
    from datum.context_skeleton import extract_skeleton

    src = textwrap.dedent("""\
        from typing import TypeAlias

        FilePath: TypeAlias = str | Path
        ItemList = list[tuple[str, int]]

        def process(items: ItemList) -> FilePath:
            return ""
        """)
    result = extract_skeleton(src, "foo.py")
    assert "FilePath: TypeAlias = str | Path" in result
    assert "ItemList = list[tuple[str, int]]" in result


def test_skeleton_preserves_decorators():
    from datum.context_skeleton import extract_skeleton

    src = textwrap.dedent("""\
        import functools

        @functools.lru_cache(maxsize=128)
        def expensive(n: int) -> int:
            return sum(range(n))

        @property
        def value(self) -> int:
            return self._value
        """)
    result = extract_skeleton(src, "foo.py")
    assert "@functools.lru_cache(maxsize=128)" in result
    assert "def expensive(n: int) -> int:" in result
    assert "@property" in result
    # Body stripped
    assert "return sum(range(n))" not in result


def test_skeleton_adds_ellipsis_placeholder():
    from datum.context_skeleton import extract_skeleton

    src = textwrap.dedent("""\
        def something(x: int) -> str:
            result = str(x)
            return result
        """)
    result = extract_skeleton(src, "foo.py")
    # Should have an ellipsis or "..." to indicate body was stripped
    assert "..." in result


def test_skeleton_handles_nested_class():
    from datum.context_skeleton import extract_skeleton

    src = textwrap.dedent("""\
        class Outer:
            class Inner:
                def inner_method(self) -> None:
                    pass

            def outer_method(self) -> None:
                pass
        """)
    result = extract_skeleton(src, "foo.py")
    assert "class Outer:" in result
    assert "class Inner:" in result
    assert "def inner_method(self) -> None:" in result
    assert "def outer_method(self) -> None:" in result


def test_skeleton_empty_content():
    from datum.context_skeleton import extract_skeleton

    result = extract_skeleton("", "empty.py")
    assert isinstance(result, str)


def test_skeleton_non_python_passthrough():
    """Non-Python files are returned as-is (no skeleton extraction)."""
    from datum.context_skeleton import extract_skeleton

    content = "SELECT * FROM table WHERE id = 1;"
    result = extract_skeleton(content, "query.sql")
    assert result == content


def test_skeleton_reduces_token_count():
    from datum.context_skeleton import extract_skeleton

    # A file with a big function body should shrink substantially
    body_lines = "\n".join(f"    x_{i} = {i}" for i in range(100))
    src = f"def big_function():\n{body_lines}\n    return x_99\n"
    result = extract_skeleton(src, "big.py")
    # Skeleton must be much smaller than original
    assert len(result) < len(src) * 0.5


def test_skeleton_multiline_signature():
    from datum.context_skeleton import extract_skeleton

    src = textwrap.dedent("""\
        def multiline(
            arg1: int,
            arg2: str,
            arg3: float = 1.0,
        ) -> bool:
            return True
        """)
    result = extract_skeleton(src, "foo.py")
    assert "def multiline(" in result
    assert "arg1: int," in result
    assert "arg2: str," in result
    assert ") -> bool:" in result


# ── score_file_priority ───────────────────────────────────────────────────────


def test_priority_returns_float():
    from datum.context_skeleton import score_file_priority

    score = score_file_priority("datum/agent_loop.py", read_paths=set())
    assert isinstance(score, float)
    assert score >= 0.0


def test_priority_missing_file_returns_zero():
    from datum.context_skeleton import score_file_priority

    score = score_file_priority("nonexistent/file.py", read_paths=set())
    assert score == 0.0


def test_priority_fan_in_increases_score(tmp_path):
    """A file imported by many other files scores higher."""
    from datum.context_skeleton import score_file_priority

    # Create a "library" file imported by many others
    lib = tmp_path / "lib.py"
    lib.write_text("def helper(): pass\n")

    # Create importers
    for i in range(5):
        (tmp_path / f"user_{i}.py").write_text(f"from lib import helper\nx = {i}\n")

    score = score_file_priority(str(lib), read_paths=set(), search_root=tmp_path)
    assert score > 0.0


def test_priority_no_importers_gives_baseline(tmp_path):
    """A file with no importers gets a low (but non-negative) score."""
    from datum.context_skeleton import score_file_priority

    isolated = tmp_path / "isolated.py"
    isolated.write_text("x = 1\n")
    score = score_file_priority(str(isolated), read_paths=set(), search_root=tmp_path)
    assert score >= 0.0


# ── select_files_to_compress ─────────────────────────────────────────────────


def test_select_files_to_compress_returns_low_priority(tmp_path):
    """Low-priority files are selected for compression; high-priority stay full."""
    from datum.context_skeleton import select_files_to_compress

    # Three files: one highly-imported, two isolated
    core = tmp_path / "core.py"
    core.write_text("def api(): pass\n")

    # Make core.py highly imported
    for i in range(10):
        (tmp_path / f"user_{i}.py").write_text("from core import api\n")

    isolated_a = tmp_path / "isolated_a.py"
    isolated_b = tmp_path / "isolated_b.py"
    isolated_a.write_text("x = 1\n")
    isolated_b.write_text("y = 2\n")

    read_paths = {str(core), str(isolated_a), str(isolated_b)}
    to_compress = select_files_to_compress(
        read_paths=read_paths,
        keep_full_count=1,
        search_root=tmp_path,
    )
    # core.py should NOT be in the compress list (highest priority)
    assert str(core) not in to_compress
    # Both isolated files should be candidates
    assert len(to_compress) >= 1


def test_select_files_empty_read_paths():
    from datum.context_skeleton import select_files_to_compress

    result = select_files_to_compress(read_paths=set(), keep_full_count=5)
    assert result == []


def test_select_files_keep_full_count_clamps(tmp_path):
    """keep_full_count higher than total read_paths returns empty compress list."""
    from datum.context_skeleton import select_files_to_compress

    for i in range(3):
        (tmp_path / f"f_{i}.py").write_text(f"x = {i}\n")

    read_paths = {str(tmp_path / f"f_{i}.py") for i in range(3)}
    result = select_files_to_compress(
        read_paths=read_paths,
        keep_full_count=10,  # more than total files
        search_root=tmp_path,
    )
    assert result == []
