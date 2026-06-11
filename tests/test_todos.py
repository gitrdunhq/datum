from datum.todos import read_todos, write_todos
import pytest
from pathlib import Path


def test_write_then_read_roundtrip(tmp_path):
    p = tmp_path / "todos.json"
    items = [{"task": "write spec", "done": False}, {"task": "run driver", "done": True}]
    write_todos(items, p)
    assert read_todos(p) == {"items": items}


def test_write_returns_payload(tmp_path):
    p = tmp_path / "todos.json"
    items = [{"task": "a", "done": False}]
    assert write_todos(items, p) == {"items": items}


def test_write_creates_parent_dirs(tmp_path):
    nested = tmp_path / ".datum" / "todos.json"
    write_todos([{"task": "a", "done": False}], nested)
    assert nested.exists()


def test_empty_items_roundtrip(tmp_path):
    p = tmp_path / "todos.json"
    write_todos([], p)
    assert read_todos(p) == {"items": []}


def test_read_missing_file_returns_empty(tmp_path):
    assert read_todos(tmp_path / "nope.json") == {"items": []}


def test_read_invalid_json_returns_empty(tmp_path):
    p = tmp_path / "todos.json"
    p.write_text("not json {{")
    assert read_todos(p) == {"items": []}


def test_read_non_dict_returns_empty(tmp_path):
    p = tmp_path / "todos.json"
    p.write_text("[1, 2]")
    assert read_todos(p) == {"items": []}


def test_read_items_not_list_returns_empty(tmp_path):
    p = tmp_path / "todos.json"
    p.write_text('{"items": "oops"}')
    assert read_todos(p) == {"items": []}


def test_read_drops_malformed_items(tmp_path):
    p = tmp_path / "todos.json"
    p.write_text('{"items": [{"task": "ok", "done": false}, "junk", {"task": "", "done": true}]}')
    assert read_todos(p) == {"items": [{"task": "ok", "done": False}]}


def test_write_rejects_non_dict_item(tmp_path):
    p = tmp_path / "todos.json"
    with pytest.raises(ValueError):
        write_todos(["nope"], p)


def test_write_rejects_empty_task(tmp_path):
    p = tmp_path / "todos.json"
    with pytest.raises(ValueError):
        write_todos([{"task": "", "done": False}], p)


def test_write_rejects_non_bool_done(tmp_path):
    p = tmp_path / "todos.json"
    with pytest.raises(ValueError):
        write_todos([{"task": "a", "done": "yes"}], p)


def test_write_rejects_missing_done(tmp_path):
    p = tmp_path / "todos.json"
    with pytest.raises(ValueError):
        write_todos([{"task": "a"}], p)
