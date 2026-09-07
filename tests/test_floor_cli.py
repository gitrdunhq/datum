"""Tests for `datum floor` CLI command's textual-dependency check.

Bug: `textual` (the TUI framework datum-tui/app.py imports) is not declared
anywhere in pyproject.toml — not as a core dependency, not as an optional
extra. `datum floor` subprocess-invokes datum-tui/app.py unconditionally,
so on any environment without textual manually installed it crashes with a
raw ModuleNotFoundError traceback instead of a clear, actionable message.
"""

from __future__ import annotations

from typer.testing import CliRunner

from datum.cli import app


def test_floor_reports_missing_textual_dependency_clearly(monkeypatch):
    """Without textual importable, `datum floor` must print a clear
    'pip install datum[tui]' hint and exit non-zero — not a raw traceback."""
    import builtins

    real_import = builtins.__import__

    def _fake_import(name, *args, **kwargs):
        if name == "textual":
            raise ModuleNotFoundError("No module named 'textual'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _fake_import)

    runner = CliRunner()
    result = runner.invoke(app, ["floor"])

    assert result.exit_code != 0
    assert "textual" in result.output.lower()
    assert "pip install" in result.output.lower()
