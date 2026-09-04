"""Tests for `datum classify` CLI command loading project config.

Correctness bug: the CLI command hardcoded `config = {}` instead of loading
the `[classification]` section from .datum/config.toml, so a project's
custom thresholds (patch_max_loc, system_min_clusters, etc.) were silently
ignored — datum classify always used classify()'s hardcoded
DEFAULT_THRESHOLDS regardless of project config.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from typer.testing import CliRunner

from datum.cli import app

SPEC_CONTENT = """
## 9. Classification Metadata

```yaml
estimated_files: 2
estimated_loc: 30
clusters_touched: 1
new_public_api: false
dependency_additions: []
```
"""


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True, check=True)


def _init_repo(repo: Path) -> None:
    repo.mkdir(parents=True, exist_ok=True)
    _git(["init", "-q"], cwd=repo)
    _git(["config", "user.email", "t@example.com"], cwd=repo)
    _git(["config", "user.name", "T"], cwd=repo)
    (repo / "README.md").write_text("# fixture\n")
    _git(["add", "README.md"], cwd=repo)
    _git(["commit", "-q", "-m", "init"], cwd=repo)


def test_classify_respects_project_configured_patch_max_loc(tmp_path, monkeypatch):
    """A project-configured patch_max_loc lower than the default 30-LOC spec
    must reclassify it out of 'patch' — proving config.toml was actually
    loaded, not the hardcoded DEFAULT_THRESHOLDS."""
    repo = tmp_path / "repo"
    _init_repo(repo)
    monkeypatch.chdir(repo)

    branch = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=repo,
        capture_output=True,
        text=True,
    ).stdout.strip()
    epic_dir = repo / "docs" / "epics" / branch
    epic_dir.mkdir(parents=True)
    (epic_dir / "SPEC.md").write_text(SPEC_CONTENT)

    datum_dir = repo / ".datum"
    datum_dir.mkdir()
    (datum_dir / "config.toml").write_text("[classification]\npatch_max_loc = 10\n")

    runner = CliRunner()
    result = runner.invoke(app, ["classify"])

    assert result.exit_code == 0, result.output
    assert '"tier": "feature"' in result.output or '"tier":"feature"' in result.output
    assert '"tier": "patch"' not in result.output
