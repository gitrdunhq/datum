"""Tests for datum.landscape — filesystem scaffold generator for LANDSCAPE.md."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path


class TestLandscapeScaffold(unittest.TestCase):
    """Unit tests for generate_scaffold()."""

    def test_generates_valid_markdown_with_headings(self) -> None:
        """LIVE-002: landscape always produces output."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "pyproject.toml").write_text(
                '[project]\nname = "demo"\n', encoding="utf-8"
            )
            (root / "src").mkdir()
            (root / "src" / "main.py").write_text("print('hello')\n", encoding="utf-8")

            from datum.landscape import generate_scaffold

            result = generate_scaffold(root, cache_dir=root / ".datum")

            md = result["markdown"]
            self.assertIn("# Landscape", md)
            self.assertIn("## Tech Stack", md)
            self.assertIn("## File Tree", md)

    def test_detects_python_tech_stack(self) -> None:
        """OBS-003: tech stack detection."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "pyproject.toml").write_text(
                '[project]\nname = "my-cool-project"\n', encoding="utf-8"
            )

            from datum.landscape import generate_scaffold

            result = generate_scaffold(root, cache_dir=root / ".datum")

            md = result["markdown"].lower()
            self.assertIn("my-cool-project", md)
            self.assertIn("python", md)

    def test_detects_node_tech_stack(self) -> None:
        """OBS-003: tech stack detection for Node/JS."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pkg = '{"name": "my-node-app", "version": "1.0.0"}'
            (root / "package.json").write_text(pkg, encoding="utf-8")

            from datum.landscape import generate_scaffold

            result = generate_scaffold(root, cache_dir=root / ".datum")

            md = result["markdown"].lower()
            self.assertIn("my-node-app", md)
            self.assertIn("node", md)

    def test_empty_directory_produces_valid_markdown(self) -> None:
        """BOUND-005: empty dir -> valid markdown."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            from datum.landscape import generate_scaffold

            result = generate_scaffold(root, cache_dir=root / ".datum")

            md = result["markdown"]
            self.assertIsInstance(md, str)
            self.assertIn("# Landscape", md)
            self.assertIn("## Tech Stack", md)
            self.assertIn("## File Tree", md)
            self.assertFalse(result["cache_hit"])

    def test_cache_hit_returns_same_content(self) -> None:
        """IDEM-001: double-run = cache hit."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "hello.py").write_text("x = 1\n", encoding="utf-8")
            cache_dir = root / ".datum"

            from datum.landscape import generate_scaffold

            first = generate_scaffold(root, cache_dir=cache_dir)
            self.assertFalse(first["cache_hit"])

            second = generate_scaffold(root, cache_dir=cache_dir)
            self.assertTrue(second["cache_hit"])
            self.assertEqual(first["markdown"], second["markdown"])

    def test_force_bypasses_cache(self) -> None:
        """IDEM-002: force double-run = regenerates."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "hello.py").write_text("x = 1\n", encoding="utf-8")
            cache_dir = root / ".datum"

            from datum.landscape import generate_scaffold

            first = generate_scaffold(root, cache_dir=cache_dir)
            self.assertFalse(first["cache_hit"])

            second = generate_scaffold(root, force=True, cache_dir=cache_dir)
            self.assertFalse(second["cache_hit"])

    def test_loc_counts_per_directory(self) -> None:
        """File tree with LOC per directory."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / "src"
            src.mkdir()
            (src / "a.py").write_text("line\n" * 10, encoding="utf-8")
            (src / "b.py").write_text("line\n" * 5, encoding="utf-8")

            from datum.landscape import generate_scaffold

            result = generate_scaffold(root, cache_dir=root / ".datum")
            md = result["markdown"]

            # The src/ directory should show 15 LOC total
            self.assertIn("15", md)

    def test_gitnexus_markers_present(self) -> None:
        """ISOL-003: gitnexus markers don't overwrite scaffold."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            from datum.landscape import generate_scaffold

            result = generate_scaffold(root, cache_dir=root / ".datum")
            md = result["markdown"]

            self.assertIn("<!-- gitnexus:start -->", md)
            self.assertIn("<!-- gitnexus:end -->", md)

            # Markers should be paired and empty between them
            start_idx = md.index("<!-- gitnexus:start -->")
            end_idx = md.index("<!-- gitnexus:end -->")
            self.assertLess(start_idx, end_idx)

    def test_skips_hidden_and_venv_dirs(self) -> None:
        """File tree skips .git, __pycache__, node_modules, .venv."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for d in [".git", "__pycache__", "node_modules", ".venv"]:
                skip_dir = root / d
                skip_dir.mkdir()
                (skip_dir / "junk.py").write_text("x = 1\n", encoding="utf-8")
            (root / "real.py").write_text("y = 2\n", encoding="utf-8")

            from datum.landscape import generate_scaffold

            result = generate_scaffold(root, cache_dir=root / ".datum")
            md = result["markdown"]

            self.assertIn("real.py", md)
            self.assertNotIn("__pycache__", md)
            self.assertNotIn("node_modules", md)
            self.assertNotIn(".venv", md)

    def test_docstrings_from_init_files(self) -> None:
        """Top-level module docstrings from __init__.py files."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pkg = root / "mypackage"
            pkg.mkdir()
            (pkg / "__init__.py").write_text(
                '"""This is a test package."""\n', encoding="utf-8"
            )

            from datum.landscape import generate_scaffold

            result = generate_scaffold(root, cache_dir=root / ".datum")
            md = result["markdown"]

            self.assertIn("This is a test package", md)


if __name__ == "__main__":
    unittest.main()
