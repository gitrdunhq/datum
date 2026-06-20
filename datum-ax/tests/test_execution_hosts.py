from unittest.mock import MagicMock, patch

import pytest
from datum_ax.contracts.execution import ExecutionTarget, Outcome, UnifiedDiff, ExecutionHost
from datum_ax.data.execution.docker import X86DockerHost
from datum_ax.data.execution.tart import MacOSTartHost


def test_tart_host_is_stub():
    host = MacOSTartHost()
    assert isinstance(host, ExecutionHost)
    with pytest.raises(NotImplementedError):
        host.run_tests("pytest")


@patch("datum_ax.data.execution.docker.subprocess.run")
def test_docker_host_init_and_reset(mock_run):
    mock_run.return_value = MagicMock(returncode=0, stdout="mock_container_id\n", stderr="")
    host = X86DockerHost()
    assert isinstance(host, ExecutionHost)
    
    # Start on first command
    host._start_container()
    assert host.container_id == "mock_container_id"
    
    # Reset tears down
    host.reset()
    assert host.container_id is None
    # Reset should have killed it
    mock_run.assert_called_with(["docker", "kill", "mock_container_id"], capture_output=True)


@patch("datum_ax.data.execution.docker.subprocess.run")
def test_docker_host_apply_diff_success(mock_run):
    # Mock start container
    def side_effect(cmd, **kwargs):
        mock = MagicMock(returncode=0, stdout="mock_container_id\n", stderr="")
        if cmd[1] == "run":
            return mock
        if cmd[1] == "exec":
            return MagicMock(returncode=0, stdout="", stderr="")
        return mock

    mock_run.side_effect = side_effect
    host = X86DockerHost()
    diff = UnifiedDiff(text="--- a/file\n+++ b/file\n@@ -1 +1 @@\n-a\n+b\n", target=ExecutionTarget.X86)
    
    result = host.apply_diff(diff)
    assert result.applied is True
    assert not result.conflicts


@patch("datum_ax.data.execution.docker.subprocess.run")
def test_docker_host_run_tests(mock_run):
    def side_effect(cmd, **kwargs):
        mock = MagicMock(returncode=0, stdout="mock_container_id\n", stderr="")
        if cmd[1] == "run":
            return mock
        if cmd[1] == "exec":
            # simulate passing test
            return MagicMock(returncode=0, stdout="1 passed", stderr="")
        return mock

    mock_run.side_effect = side_effect
    host = X86DockerHost()
    
    result = host.run_tests("pytest")
    assert result.outcome == Outcome.PASS
    assert result.exit_code == 0
    assert result.stdout == "1 passed"
    assert result.duration_s >= 0
