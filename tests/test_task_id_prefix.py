import json

import pytest

from datum.task_ids import TaskIdPrefixError, resolve_task_id_prefix


def _write_config(repo_root, data):
    datum_dir = repo_root / ".datum"
    datum_dir.mkdir(parents=True, exist_ok=True)
    config_path = datum_dir / "config.json"
    config_path.write_text(json.dumps(data))
    return config_path


def test_returns_explicit_prefix_verbatim_without_rewriting_config(tmp_path):
    repo_root = tmp_path / "some-repo"
    repo_root.mkdir()
    config_path = _write_config(repo_root, {"task_id_prefix": "XYZ"})
    before = config_path.read_text()

    result = resolve_task_id_prefix(repo_root)

    assert result == "XYZ"
    after = config_path.read_text()
    assert after == before


def test_derives_prefix_from_repo_dir_name_datum(tmp_path):
    repo_root = tmp_path / "datum"
    repo_root.mkdir()

    result = resolve_task_id_prefix(repo_root)

    assert result == "DAT"


def test_derives_prefix_strips_non_letters_and_uppercases(tmp_path):
    repo_root = tmp_path / "my-project_2"
    repo_root.mkdir()

    result = resolve_task_id_prefix(repo_root)

    assert result == "MYP"


def test_derive_persists_prefix_and_preserves_existing_keys(tmp_path):
    repo_root = tmp_path / "datum"
    repo_root.mkdir()
    config_path = _write_config(repo_root, {"unrelated_key": "keep-me", "other": 42})

    first = resolve_task_id_prefix(repo_root)

    on_disk = json.loads(config_path.read_text())
    assert on_disk["task_id_prefix"] == "DAT"
    assert on_disk["unrelated_key"] == "keep-me"
    assert on_disk["other"] == 42

    second = resolve_task_id_prefix(repo_root)

    assert second == first == "DAT"
    assert json.loads(config_path.read_text()) == on_disk


def test_invalid_repo_name_all_digits_raises_structured_error(tmp_path):
    repo_root = tmp_path / "9"
    repo_root.mkdir()

    with pytest.raises(TaskIdPrefixError) as excinfo:
        resolve_task_id_prefix(repo_root)

    payload = excinfo.value.payload
    assert payload["code"] == "task_id_prefix_invalid"
    assert isinstance(payload["message"], str) and payload["message"]
    assert isinstance(payload["correlationId"], str) and payload["correlationId"]

    config_path = repo_root / ".datum" / "config.json"
    if config_path.exists():
        on_disk = json.loads(config_path.read_text())
        assert "task_id_prefix" not in on_disk


def test_invalid_repo_name_underscore_x_raises_structured_error(tmp_path):
    repo_root = tmp_path / "_x"
    repo_root.mkdir()

    with pytest.raises(TaskIdPrefixError) as excinfo:
        resolve_task_id_prefix(repo_root)

    payload = excinfo.value.payload
    assert payload["code"] == "task_id_prefix_invalid"
    assert isinstance(payload["message"], str) and payload["message"]
    assert isinstance(payload["correlationId"], str) and payload["correlationId"]


def test_resolution_is_idempotent_writes_config_once(tmp_path):
    repo_root = tmp_path / "datum"
    repo_root.mkdir()
    config_path = repo_root / ".datum" / "config.json"

    resolve_task_id_prefix(repo_root)
    first_write = config_path.read_text()
    first_mtime = config_path.stat().st_mtime_ns

    resolve_task_id_prefix(repo_root)
    second_write = config_path.read_text()

    assert first_write == second_write
    assert json.loads(second_write)["task_id_prefix"] == "DAT"
    assert config_path.stat().st_mtime_ns == first_mtime


# #514 closeout FU-1 (review SEC-001): a config-supplied task_id_prefix seeds
# every generated id and reaches the renumber path before any schema check,
# so it must satisfy the same shape the derived path enforces.
@pytest.mark.parametrize("bad", ["dat", "D", "ABCDEFG", "DATUM", "DA-T", "DA T"])
def test_config_prefix_is_validated_like_the_derived_one(tmp_path, bad):
    repo_root = tmp_path / "myrepo"
    (repo_root / ".datum").mkdir(parents=True)
    (repo_root / ".datum" / "config.json").write_text(
        json.dumps({"task_id_prefix": bad})
    )

    with pytest.raises(TaskIdPrefixError) as exc:
        resolve_task_id_prefix(repo_root)

    assert exc.value.payload["code"] == "task_id_prefix_invalid"
    assert bad in exc.value.payload["message"]


def test_valid_config_prefix_of_any_allowed_length_is_returned(tmp_path):
    for good in ("AB", "DAT", "ABCDEF"):
        repo_root = tmp_path / good.lower()
        (repo_root / ".datum").mkdir(parents=True)
        (repo_root / ".datum" / "config.json").write_text(
            json.dumps({"task_id_prefix": good})
        )
        assert resolve_task_id_prefix(repo_root) == good
