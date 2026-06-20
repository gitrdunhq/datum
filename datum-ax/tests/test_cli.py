import json
import os
from unittest.mock import patch, MagicMock

import pytest
from datum_ax.cli.main import build_parser, run_cli


def test_cli_parser_run():
    parser = build_parser()
    args = parser.parse_args(["run", "--ticket", "test-ticket"])
    assert args.command == "run"
    assert args.ticket == "test-ticket"


def test_cli_parser_status():
    parser = build_parser()
    args = parser.parse_args(["status"])
    assert args.command == "status"


def test_cli_parser_doctor():
    parser = build_parser()
    args = parser.parse_args(["doctor"])
    assert args.command == "doctor"


def test_run_cli_status(capsys):
    run_cli(["status"])
    captured = capsys.readouterr()

    # Assert JSON was printed and contains expected keys from LiveStatus
    status_json = json.loads(captured.out)
    assert "phase" in status_json
    assert "inference" in status_json


def test_run_cli_missing_env(capsys):
    with patch.dict(os.environ, {}, clear=True):
        with pytest.raises(SystemExit):
            run_cli(["run", "--ticket", "test-ticket"])
        captured = capsys.readouterr()
        assert "Missing required environment variables" in captured.err


def test_run_cli_success_omlx_vars(capsys):
    env = {"OMLX_BASE_URL": "http://mock", "OMLX_API_KEY": "omlx-secret"}
    with patch.dict(os.environ, env, clear=True):
        with patch("datum_ax.core.orchestration.graph.build_graph") as mock_build_graph:
            mock_graph = MagicMock()
            mock_graph.stream.return_value = [{"mock_node": {"results": {"foo": "bar"}}}]
            mock_build_graph.return_value = mock_graph
            run_cli(["run", "--ticket", "test-ticket"])

            mock_build_graph.assert_called_once()
            mock_graph.stream.assert_called_once()


def test_run_cli_success_openai_vars(capsys):
    env = {"OPENAI_BASE_URL": "http://mock", "OPENAI_API_KEY": "omlx-secret"}
    with patch.dict(os.environ, env, clear=True):
        with patch("datum_ax.core.orchestration.graph.build_graph") as mock_build_graph:
            mock_graph = MagicMock()
            mock_graph.stream.return_value = [{"mock_node": {"results": {"foo": "bar"}}}]
            mock_build_graph.return_value = mock_graph
            run_cli(["run", "--ticket", "test-ticket"])

            mock_build_graph.assert_called_once()
            mock_graph.stream.assert_called_once()

            # Initial state carries the ticket + workspace; deps are injected via config (DI, ADR-0026)
            state = mock_graph.stream.call_args[0][0]
            assert state["ticket"]["text"] == "test-ticket"
            assert "workspace_dir" in state
            cfg = mock_graph.stream.call_args.kwargs["config"]
            assert cfg["configurable"]["inference_client"] is not None
            assert cfg["configurable"]["execution_host"] is not None
