"""Regression: load_state must not crash on an uninitialized state.db."""

import datum.state as state_mod


def test_load_state_zero_byte_db(tmp_path, monkeypatch):
    db = tmp_path / "state.db"
    db.touch()  # zero-byte file: exists, but no kv_state table
    monkeypatch.setattr(state_mod, "DB_FILE", db)
    assert state_mod.load_state() == {}


def test_load_state_missing_db(tmp_path, monkeypatch):
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / "absent.db")
    assert state_mod.load_state() == {}
