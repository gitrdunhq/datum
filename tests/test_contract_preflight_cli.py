"""#356: `datum contract-preflight` is the CLI entrypoint for datum.contract_preflight."""

from typer.testing import CliRunner

from datum.cli import app


def test_contract_preflight_is_registered_and_passes_args_through(monkeypatch):
    captured = {}

    def fake_run(argv, *a, **k):
        captured["argv"] = argv

        class R:
            returncode = 1

        return R()

    monkeypatch.setattr("subprocess.run", fake_run)
    result = CliRunner().invoke(
        app, ["contract-preflight", "--repo", "/x", "--test-command", "uv run pytest"]
    )
    assert result.exit_code == 1
    assert captured["argv"][1:3] == ["-m", "datum.contract_preflight"]
    assert captured["argv"][3:] == ["--repo", "/x", "--test-command", "uv run pytest"]
