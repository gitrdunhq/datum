"""`datum code-tells`: the deterministic scan for machine-written tells on a lane's added lines.

Grounded in randommonicle/claude-skills `unslop-code` (references/tells.md): the
scanner catches the mechanical surface tells (narrating comments, emoji, chat
artifacts, placeholder stubs, generic names, swallowed errors) and is deliberately
blind to the substance tells (tutorial shape, over-engineering, repo fit), which
the REFACTOR check reads for. Debug logging and defensive checks are NOT flagged:
the data cleared them.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from typer.testing import CliRunner

from datum.code_tells import added_lines, scan_lines


def _lines(*texts: str) -> list[tuple[str, int, str]]:
    return [("src/a.py", i + 1, t) for i, t in enumerate(texts)]


def _tags(*texts: str) -> list[str]:
    return [f.tag for f in scan_lines(_lines(*texts))]


class TestScanLines:
    def test_narrating_comments(self) -> None:
        assert _tags("# Step 1: open the file") == ["narrating_comment"]
        assert _tags("// Now we validate the input") == ["narrating_comment"]
        assert _tags("# First, load the config") == ["narrating_comment"]

    def test_emoji(self) -> None:
        assert _tags('print("done ✅")') == ["emoji"]
        assert _tags("// 🚀 fast path") == ["emoji"]

    def test_chat_artifacts(self) -> None:
        assert _tags("# You're absolutely right, this is cleaner") == ["chat_artifact"]
        assert _tags("// Here's the updated code") == ["chat_artifact"]
        assert _tags("# As an AI language model") == ["chat_artifact"]

    def test_placeholder_stubs(self) -> None:
        assert _tags("    # ... rest of your code") == ["placeholder"]
        assert _tags("    // implementation goes here") == ["placeholder"]
        assert _tags("    # TODO: implement") == ["placeholder"]
        assert _tags("    // existing code unchanged") == ["placeholder"]

    def test_generic_names(self) -> None:
        assert _tags("def process_data(rows):") == ["generic_name"]
        assert _tags("function handleData(x) {") == ["generic_name"]
        assert _tags("func doStuff() {") == ["generic_name"]
        assert _tags("def do_something(self):") == ["generic_name"]

    def test_swallowed_errors(self) -> None:
        assert _tags("except:") == ["swallowed_error"]
        assert _tags("except Exception: pass") == ["swallowed_error"]
        assert _tags("} catch (e) {}") == ["swallowed_error"]
        assert _tags("} catch {}") == ["swallowed_error"]

    def test_clean_lines_are_not_flagged(self) -> None:
        assert (
            _tags(
                "# the API returns null on a cold cache, so retry once",
                "def process_payment(order):",
                "except ValueError:",
                "    logger.debug('retrying %s', order.id)",
                "    if order is None:",
                "        raise ValueError('order required')",
                "print('ok')",
            )
            == []
        )

    def test_unslop_ignore_skips_the_line(self) -> None:
        assert _tags('print("✅ done")  # unslop-ignore') == []

    def test_finding_carries_file_line_tag_and_text(self) -> None:
        (f,) = scan_lines([("src/b.ts", 7, "// Step 2: parse")])
        assert (f.file, f.line, f.tag, f.text) == (
            "src/b.ts",
            7,
            "narrating_comment",
            "// Step 2: parse",
        )


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        [
            "git",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            *args,
        ],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    ).stdout


class TestAddedLines:
    def test_only_lines_added_since_base_with_their_numbers(
        self, tmp_path: Path
    ) -> None:
        repo = tmp_path
        _git(repo, "init", "-q", "-b", "main")
        (repo / "a.py").write_text("x = 1\ny = 2\n", encoding="utf-8")
        _git(repo, "add", "a.py")
        _git(repo, "commit", "-q", "-m", "base")
        (repo / "a.py").write_text(
            "x = 1\n# Step 1: add\nz = 3\ny = 2\n", encoding="utf-8"
        )
        (repo / "b.py").write_text("# Now we start\n", encoding="utf-8")
        _git(repo, "add", "a.py", "b.py")
        _git(repo, "commit", "-q", "-m", "lane")

        added = added_lines(repo, "HEAD~1", ["a.py", "b.py"])

        assert added == [
            ("a.py", 2, "# Step 1: add"),
            ("a.py", 3, "z = 3"),
            ("b.py", 1, "# Now we start"),
        ]

    def test_no_base_scans_whole_files(self, tmp_path: Path) -> None:
        (tmp_path / "a.py").write_text("one\ntwo\n", encoding="utf-8")
        assert added_lines(tmp_path, None, ["a.py"]) == [
            ("a.py", 1, "one"),
            ("a.py", 2, "two"),
        ]


class TestCli:
    def test_prints_one_line_per_finding_and_exits_zero(self, tmp_path: Path) -> None:
        from datum.cli import app

        (tmp_path / "a.py").write_text(
            "def process_data(x):\n    return x\n", encoding="utf-8"
        )
        result = CliRunner().invoke(
            app, ["code-tells", "--repo", str(tmp_path), "--files", "a.py"]
        )
        assert result.exit_code == 0, result.output
        assert result.output.splitlines() == [
            "a.py:1:generic_name:def process_data(x):"
        ]

    def test_clean_tree_prints_nothing(self, tmp_path: Path) -> None:
        from datum.cli import app

        (tmp_path / "a.py").write_text(
            "def total(rows):\n    return sum(rows)\n", encoding="utf-8"
        )
        result = CliRunner().invoke(
            app, ["code-tells", "--repo", str(tmp_path), "--files", "a.py"]
        )
        assert result.exit_code == 0, result.output
        assert result.output == ""
