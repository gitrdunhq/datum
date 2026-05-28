"""TDD tests for datum-tui."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pytest
from app import DatumTUI


@pytest.mark.asyncio
async def test_app_launches():
    app = DatumTUI()
    async with app.run_test() as pilot:
        assert pilot.app.title == "DATUM Factory Floor"


@pytest.mark.asyncio
async def test_chat_input_has_focus():
    app = DatumTUI()
    async with app.run_test() as pilot:
        focused = pilot.app.focused
        assert focused is not None, "Nothing has focus"
        assert (
            focused.id == "chat-input"
        ), f"Expected chat-input focus, got {focused.id}"


@pytest.mark.asyncio
async def test_chat_input_accepts_text():
    app = DatumTUI()
    async with app.run_test() as pilot:
        await pilot.click("#chat-input")
        await pilot.press("h", "e", "l", "l", "o")
        chat_input = pilot.app.query_one("#chat-input")
        assert "hello" in chat_input.value


@pytest.mark.asyncio
async def test_panels_exist():
    app = DatumTUI()
    async with app.run_test() as pilot:
        assert pilot.app.query_one("#pipeline") is not None
        assert pilot.app.query_one("#lanes") is not None
        assert pilot.app.query_one("#gemma") is not None
        assert pilot.app.query_one("#chat") is not None


@pytest.mark.asyncio
async def test_keyboard_shortcuts_exist():
    app = DatumTUI()
    keys = [b[0] for b in app.BINDINGS]
    assert "q" in keys
    assert "r" in keys
