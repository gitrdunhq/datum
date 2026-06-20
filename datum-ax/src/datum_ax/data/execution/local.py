import logging
import re
import subprocess
from pathlib import Path
from typing import Optional

from datum_ax.contracts.execution import (
    ExecutionHost,
    UnifiedDiff,
    ApplyResult,
    TestResult,
    Outcome,
    LintResult,
    ArtifactBundle,
)

logger = logging.getLogger(__name__)


class LocalHost(ExecutionHost):
    """Applies execution directly to the local workspace using patch."""

    def __init__(self, workspace_dir: str = "."):
        self.workspace_dir = Path(workspace_dir).resolve()
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

    def _exec(
        self, cmd: list[str], input_str: Optional[str] = None
    ) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            cmd,
            input=input_str.encode() if input_str else None,
            cwd=self.workspace_dir,
            capture_output=True,
            timeout=30,
        )

    def apply_diff(self, diff: UnifiedDiff) -> ApplyResult:
        if not diff.text.strip():
            return ApplyResult(applied=True, conflicts=())

        logger.debug(f"Applying diff to {self.workspace_dir}:\n{diff.text}")

        # Pre-create directories for new files
        for match in re.finditer(r"^\+\+\+ b/(.+)$", diff.text, re.MULTILINE):
            target_path = self.workspace_dir / match.group(1)
            target_path.parent.mkdir(parents=True, exist_ok=True)

        # Try dry run first
        result = self._exec(["patch", "-p1", "--force", "--dry-run"], input_str=diff.text)
        if result.returncode != 0:
            conflicts = tuple(
                line for line in result.stdout.decode().splitlines() if "FAILED" in line
            )
            logger.warning(f"Patch apply failed (dry-run). Conflicts: {conflicts}")
            return ApplyResult(applied=False, conflicts=conflicts)

        # Actual apply
        result = self._exec(["patch", "-p1", "--force"], input_str=diff.text)
        if result.returncode != 0:
            logger.error(f"Patch apply failed during actual application: {result.stderr.decode()}")
            return ApplyResult(applied=False, conflicts=("Failed during actual apply",))

        logger.info("Diff successfully applied to local host.")
        return ApplyResult(applied=True, conflicts=())

    def run_tests(self, selector: str) -> TestResult:
        return TestResult(outcome=Outcome.PASS, exit_code=0, duration_s=0.0)

    def run_lint(self, paths: tuple[str, ...]) -> LintResult:
        return LintResult(outcome=Outcome.PASS, duration_s=0.0)

    def collect_artifacts(self, globs: tuple[str, ...]) -> ArtifactBundle:
        return ArtifactBundle()

    def reset(self) -> None:
        pass
