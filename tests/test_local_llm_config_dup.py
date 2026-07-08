"""Issue #265: duplicate [local_llm] TOML table must raise an actionable
error instead of leaking a bare tomllib.TOMLDecodeError traceback.

_load_raw_config() and load_config() both walk candidate config paths and
call tomllib.load(f) with no error translation. A config file with two
[local_llm] headers currently blows up with tomllib.TOMLDecodeError, whose
message says nothing about which file caused it in a way callers can act
on. These tests pin the desired behavior: the raw TOMLDecodeError must be
converted into a ValueError (or dedicated DatumConfigError) naming the
offending file path and containing the words "duplicate" and "local_llm".
"""

import tomllib

import pytest

DUPLICATE_LOCAL_LLM_TOML = """
[local_llm]
max_tokens = 8192

[local_llm]
max_tokens = 4096
"""

SINGLE_LOCAL_LLM_TOML = """
[local_llm]
max_tokens = 2048
context_window = 65536
"""


def _write_project_config(tmp_path, contents: str):
    """Create a fake project dir with a .datum/config.toml containing
    *contents*, returning the project dir path."""
    project_dir = tmp_path / "project"
    datum_dir = project_dir / ".datum"
    datum_dir.mkdir(parents=True)
    config_path = datum_dir / "config.toml"
    config_path.write_text(contents)
    return project_dir, config_path


def test_ac1_load_raw_config_raises_actionable_error_on_duplicate_table(
    tmp_path, monkeypatch
):
    """_load_raw_config() must convert tomllib.TOMLDecodeError on a
    duplicate [local_llm] table into a ValueError whose message names the
    offending file path and contains 'duplicate' and 'local_llm' — not a
    bare tomllib.TOMLDecodeError."""
    from datum import local_llm

    project_dir, config_path = _write_project_config(tmp_path, DUPLICATE_LOCAL_LLM_TOML)
    monkeypatch.setenv("DATUM_PROJECT_DIR", str(project_dir))
    monkeypatch.chdir(tmp_path)

    with pytest.raises(ValueError) as exc_info:
        local_llm._load_raw_config()

    # Must not be a bare tomllib.TOMLDecodeError — it must be translated.
    assert not isinstance(exc_info.value, tomllib.TOMLDecodeError)
    msg = str(exc_info.value)
    assert str(config_path) in msg
    assert "duplicate" in msg.lower()
    assert "local_llm" in msg.lower()


def test_ac2_load_config_surfaces_actionable_error_no_raw_traceback(
    tmp_path, monkeypatch
):
    """load_config() must surface the same actionable error (no unhandled
    tomllib.TOMLDecodeError traceback) when the selected config file has
    two [local_llm] headers."""
    from datum import local_llm

    project_dir, config_path = _write_project_config(tmp_path, DUPLICATE_LOCAL_LLM_TOML)
    monkeypatch.setenv("DATUM_PROJECT_DIR", str(project_dir))
    monkeypatch.chdir(tmp_path)

    with pytest.raises(ValueError) as exc_info:
        local_llm.load_config()

    assert not isinstance(exc_info.value, tomllib.TOMLDecodeError)
    msg = str(exc_info.value)
    assert str(config_path) in msg
    assert "duplicate" in msg.lower()
    assert "local_llm" in msg.lower()


def test_ac3_single_local_llm_table_and_default_config_still_parse(
    tmp_path, monkeypatch
):
    """Loading assets/config.toml.default and a single-[local_llm] fixture
    must still return a valid parsed dict unchanged (no regression from
    the duplicate-table guard)."""
    from datum import local_llm

    # A well-formed project config with a single [local_llm] table parses
    # fine and its values win over DEFAULTS.
    project_dir, _ = _write_project_config(tmp_path, SINGLE_LOCAL_LLM_TOML)
    monkeypatch.setenv("DATUM_PROJECT_DIR", str(project_dir))
    monkeypatch.chdir(tmp_path)

    raw = local_llm._load_raw_config()
    assert raw["local_llm"]["max_tokens"] == 2048
    assert raw["local_llm"]["context_window"] == 65536

    config = local_llm.load_config()
    assert config["max_tokens"] == 2048
    assert config["context_window"] == 65536

    # Falling through to the repo default asset must also still parse
    # cleanly and produce the full DEFAULTS-merged shape.
    monkeypatch.delenv("DATUM_PROJECT_DIR", raising=False)
    monkeypatch.chdir(tmp_path)
    empty_project = tmp_path / "no_config_here"
    empty_project.mkdir()
    monkeypatch.chdir(empty_project)

    from datum.local_llm import DEFAULTS

    default_config = local_llm.load_config()
    assert isinstance(default_config, dict)
    for key in DEFAULTS:
        assert key in default_config
