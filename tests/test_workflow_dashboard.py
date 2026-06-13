# RED tests for task-001: workflow_dashboard module — scan and serve workflow state
# Traceability: AC1-AC4 → tests/test_workflow_dashboard.py

import json
import time
from pathlib import Path

import pytest
from datum.workflow_dashboard import find_workflow_dirs, scan_workflow


class TestTask_001_AC1:
    """AC1: find_workflow_dirs(base_path) returns a list of dicts with keys
    'id', 'path', 'project', 'mtime' — sorted by mtime descending, max 20 entries."""

    def test_ac1_returns_list(self, tmp_path):
        """find_workflow_dirs returns a list."""
        result = find_workflow_dirs(tmp_path)
        assert isinstance(result, list)

    def test_ac1_each_entry_has_required_keys(self, tmp_path):
        """Each dict in the returned list has 'id', 'path', 'project', 'mtime'."""
        # Create two fake workflow dirs
        for name in ("wf-alpha", "wf-beta"):
            (tmp_path / name).mkdir()

        result = find_workflow_dirs(tmp_path)
        assert len(result) > 0, "Expected at least one workflow dir entry"
        required_keys = {"id", "path", "project", "mtime"}
        for entry in result:
            missing = required_keys - set(entry.keys())
            assert not missing, f"Entry missing keys {missing}: {entry}"

    def test_ac1_sorted_by_mtime_descending(self, tmp_path):
        """Entries are sorted by mtime descending (newest first)."""
        older = tmp_path / "wf-older"
        older.mkdir()
        # Force a tiny time gap so mtimes differ reliably
        time.sleep(0.01)
        newer = tmp_path / "wf-newer"
        newer.mkdir()

        result = find_workflow_dirs(tmp_path)
        assert len(result) >= 2

        mtimes = [entry["mtime"] for entry in result]
        assert mtimes == sorted(
            mtimes, reverse=True
        ), f"Entries not sorted by mtime descending: {mtimes}"

    def test_ac1_max_20_entries(self, tmp_path):
        """find_workflow_dirs returns at most 20 entries."""
        for i in range(25):
            (tmp_path / f"wf-{i:03d}").mkdir()

        result = find_workflow_dirs(tmp_path)
        assert len(result) <= 20, f"Expected at most 20 entries, got {len(result)}"

    def test_ac1_id_field_matches_dir_name(self, tmp_path):
        """The 'id' field matches the directory name."""
        (tmp_path / "wf-myproject").mkdir()
        result = find_workflow_dirs(tmp_path)
        ids = [entry["id"] for entry in result]
        assert "wf-myproject" in ids, f"Expected 'wf-myproject' in ids: {ids}"

    def test_ac1_path_field_is_string_or_path(self, tmp_path):
        """The 'path' field is a string or Path pointing to the workflow directory."""
        (tmp_path / "wf-check").mkdir()
        result = find_workflow_dirs(tmp_path)
        assert len(result) >= 1
        for entry in result:
            assert entry["path"] is not None, "path must not be None"
            # Must be resolvable as a Path
            p = Path(entry["path"])
            assert p.exists(), f"path {p} does not exist"

    def test_ac1_mtime_is_numeric(self, tmp_path):
        """The 'mtime' field is a numeric value (float or int)."""
        (tmp_path / "wf-mtime-check").mkdir()
        result = find_workflow_dirs(tmp_path)
        assert len(result) >= 1
        for entry in result:
            assert isinstance(
                entry["mtime"], (int, float)
            ), f"mtime must be numeric, got {type(entry['mtime'])}: {entry['mtime']}"


class TestTask_001_AC2:
    """AC2: scan_workflow(wf_path) reads agent-*.meta.json files and returns a dict
    with 'agents' (list), 'total_agents' (int), 'active_agents' (int), 'total_kb' (float).
    """

    def _make_meta(
        self,
        directory: Path,
        agent_id: str,
        size_bytes: int = 1024,
        active: bool = False,
        messages: list | None = None,
    ) -> Path:
        """Write a minimal agent-<id>.meta.json file."""
        if messages is None:
            messages = [{"role": "user", "content": "Hello from agent"}]
        meta = {
            "agent_id": agent_id,
            "type": "act",
            "active": active,
            "size_bytes": size_bytes,
            "messages": messages,
        }
        path = directory / f"agent-{agent_id}.meta.json"
        path.write_text(json.dumps(meta))
        return path

    def test_ac2_returns_dict_with_required_keys(self, tmp_path):
        """scan_workflow returns a dict with 'agents', 'total_agents', 'active_agents', 'total_kb'."""
        self._make_meta(tmp_path, "001")
        result = scan_workflow(tmp_path)
        required_keys = {"agents", "total_agents", "active_agents", "total_kb"}
        missing = required_keys - set(result.keys())
        assert not missing, f"Result missing keys {missing}: {result}"

    def test_ac2_agents_is_list(self, tmp_path):
        """'agents' field is a list."""
        self._make_meta(tmp_path, "001")
        result = scan_workflow(tmp_path)
        assert isinstance(
            result["agents"], list
        ), f"'agents' must be a list, got {type(result['agents'])}"

    def test_ac2_total_agents_is_int(self, tmp_path):
        """'total_agents' field is an int."""
        self._make_meta(tmp_path, "001")
        self._make_meta(tmp_path, "002")
        result = scan_workflow(tmp_path)
        assert isinstance(
            result["total_agents"], int
        ), f"'total_agents' must be int, got {type(result['total_agents'])}"
        assert (
            result["total_agents"] == 2
        ), f"Expected total_agents=2, got {result['total_agents']}"

    def test_ac2_active_agents_counts_active_flag(self, tmp_path):
        """'active_agents' counts only agents whose 'active' flag is True."""
        self._make_meta(tmp_path, "001", active=True)
        self._make_meta(tmp_path, "002", active=False)
        self._make_meta(tmp_path, "003", active=True)
        result = scan_workflow(tmp_path)
        assert (
            result["active_agents"] == 2
        ), f"Expected active_agents=2, got {result['active_agents']}"

    def test_ac2_total_kb_is_float(self, tmp_path):
        """'total_kb' field is a float."""
        self._make_meta(tmp_path, "001", size_bytes=2048)
        result = scan_workflow(tmp_path)
        assert isinstance(
            result["total_kb"], float
        ), f"'total_kb' must be float, got {type(result['total_kb'])}"

    def test_ac2_total_kb_sums_sizes(self, tmp_path):
        """'total_kb' sums the size_bytes of all agents and converts to KB."""
        self._make_meta(tmp_path, "001", size_bytes=1024)
        self._make_meta(tmp_path, "002", size_bytes=2048)
        result = scan_workflow(tmp_path)
        expected_kb = (1024 + 2048) / 1024.0
        assert (
            abs(result["total_kb"] - expected_kb) < 0.01
        ), f"Expected total_kb={expected_kb}, got {result['total_kb']}"

    def test_ac2_empty_dir_returns_zero_counts(self, tmp_path):
        """scan_workflow on a dir with no meta files returns zeros."""
        result = scan_workflow(tmp_path)
        assert result["total_agents"] == 0
        assert result["active_agents"] == 0
        assert result["total_kb"] == 0.0
        assert result["agents"] == []


class TestTask_001_AC3:
    """AC3: Each agent dict in scan_workflow output has keys 'id', 'type',
    'size_kb', 'active', 'prompt' (first 120 chars of first message)."""

    def _make_meta(
        self,
        directory: Path,
        agent_id: str,
        agent_type: str = "act",
        size_bytes: int = 512,
        active: bool = False,
        messages: list | None = None,
    ) -> Path:
        if messages is None:
            messages = [{"role": "user", "content": "Test prompt content here"}]
        meta = {
            "agent_id": agent_id,
            "type": agent_type,
            "active": active,
            "size_bytes": size_bytes,
            "messages": messages,
        }
        path = directory / f"agent-{agent_id}.meta.json"
        path.write_text(json.dumps(meta))
        return path

    def test_ac3_agent_dict_has_required_keys(self, tmp_path):
        """Each agent dict has 'id', 'type', 'size_kb', 'active', 'prompt'."""
        self._make_meta(tmp_path, "red-01", agent_type="red")
        result = scan_workflow(tmp_path)
        assert len(result["agents"]) == 1
        agent = result["agents"][0]
        required = {"id", "type", "size_kb", "active", "prompt"}
        missing = required - set(agent.keys())
        assert not missing, f"Agent dict missing keys {missing}: {agent}"

    def test_ac3_agent_id_matches_file(self, tmp_path):
        """Agent 'id' matches the agent_id from the meta file."""
        self._make_meta(tmp_path, "my-agent-007")
        result = scan_workflow(tmp_path)
        assert len(result["agents"]) == 1
        assert (
            result["agents"][0]["id"] == "my-agent-007"
        ), f"Expected id='my-agent-007', got {result['agents'][0]['id']}"

    def test_ac3_agent_type_matches_meta(self, tmp_path):
        """Agent 'type' matches the type field from the meta file."""
        self._make_meta(tmp_path, "green-01", agent_type="green")
        result = scan_workflow(tmp_path)
        assert result["agents"][0]["type"] == "green"

    def test_ac3_size_kb_is_float(self, tmp_path):
        """Agent 'size_kb' is a float."""
        self._make_meta(tmp_path, "sz-01", size_bytes=4096)
        result = scan_workflow(tmp_path)
        agent = result["agents"][0]
        assert isinstance(
            agent["size_kb"], float
        ), f"size_kb must be float, got {type(agent['size_kb'])}"
        assert (
            abs(agent["size_kb"] - 4.0) < 0.01
        ), f"Expected size_kb=4.0, got {agent['size_kb']}"

    def test_ac3_active_field_is_bool(self, tmp_path):
        """Agent 'active' is a bool matching the meta file."""
        self._make_meta(tmp_path, "act-01", active=True)
        result = scan_workflow(tmp_path)
        assert result["agents"][0]["active"] is True

    def test_ac3_prompt_is_first_120_chars_of_first_message(self, tmp_path):
        """Agent 'prompt' is the first 120 chars of the first message content."""
        long_content = "A" * 200
        self._make_meta(
            tmp_path, "pm-01", messages=[{"role": "user", "content": long_content}]
        )
        result = scan_workflow(tmp_path)
        prompt = result["agents"][0]["prompt"]
        assert (
            prompt == long_content[:120]
        ), f"Expected prompt to be first 120 chars of message, got: {prompt!r}"

    def test_ac3_prompt_short_message_not_truncated(self, tmp_path):
        """Agent 'prompt' is not padded when message is shorter than 120 chars."""
        short_content = "Short prompt"
        self._make_meta(
            tmp_path, "pm-02", messages=[{"role": "user", "content": short_content}]
        )
        result = scan_workflow(tmp_path)
        prompt = result["agents"][0]["prompt"]
        assert (
            prompt == short_content
        ), f"Expected prompt='{short_content}', got: {prompt!r}"

    def test_ac3_prompt_uses_first_message_not_last(self, tmp_path):
        """Agent 'prompt' comes from the first message, not a later one."""
        messages = [
            {"role": "user", "content": "First message content"},
            {"role": "assistant", "content": "Second message should not appear"},
        ]
        self._make_meta(tmp_path, "pm-03", messages=messages)
        result = scan_workflow(tmp_path)
        prompt = result["agents"][0]["prompt"]
        assert (
            "First message content" in prompt
        ), f"Expected first message in prompt, got: {prompt!r}"
        assert (
            "Second message" not in prompt
        ), f"Second message should not appear in prompt, got: {prompt!r}"

    def test_ac3_multiple_agents_all_have_required_keys(self, tmp_path):
        """All agents in the list have the required keys."""
        for i in range(3):
            self._make_meta(
                tmp_path, f"multi-{i:02d}", agent_type="act" if i % 2 == 0 else "red"
            )
        result = scan_workflow(tmp_path)
        assert len(result["agents"]) == 3
        required = {"id", "type", "size_kb", "active", "prompt"}
        for agent in result["agents"]:
            missing = required - set(agent.keys())
            assert not missing, f"Agent dict missing keys {missing}: {agent}"


class TestTask_001_AC4:
    """AC4: find_workflow_dirs returns empty list when base_path does not exist."""

    def test_ac4_ac4_findworkflowdirs_returns_empty_list_when(self):
        """
        PROP-004: AC4: find_workflow_dirs returns empty list when base_path does not exist
        """
        # Arrange — use a path that definitely does not exist
        nonexistent = Path("/tmp/datum-test-nonexistent-path-xyzzy-999999")
        assert not nonexistent.exists(), "Test setup error: path should not exist"

        # Act
        result = find_workflow_dirs(nonexistent)

        # Assert — prove PROP-004
        assert (
            result == []
        ), f"Expected empty list for nonexistent base_path, got: {result}"

    def test_ac4_nonexistent_path_as_string_returns_empty(self):
        """find_workflow_dirs handles a string path that does not exist."""
        nonexistent = "/tmp/datum-test-nonexistent-string-path-abc123"
        assert not Path(nonexistent).exists()

        result = find_workflow_dirs(nonexistent)

        assert (
            result == []
        ), f"Expected empty list for nonexistent string path, got: {result}"
