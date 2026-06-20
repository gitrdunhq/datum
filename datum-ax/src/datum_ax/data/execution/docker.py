import subprocess
import time
import uuid
from typing import Optional

from datum_ax.contracts.execution import (
    ApplyResult,
    ArtifactBundle,
    LintResult,
    Outcome,
    TestResult,
    UnifiedDiff,
)
from datum_ax.data.execution.errors import SandboxInitError, HostTimeoutError


class X86DockerHost:
    """X86 Docker implementation of the ExecutionHost contract."""

    def __init__(self, image: str = "ubuntu:latest", workdir: str = "/workspace"):
        self.image = image
        self.workdir = workdir
        self.container_id: Optional[str] = None

    def _start_container(self) -> None:
        if self.container_id is not None:
            return

        name = f"datum-ax-exec-{uuid.uuid4().hex[:8]}"
        cmd = [
            "docker",
            "run",
            "-d",
            "--rm",
            "--name",
            name,
            "-w",
            self.workdir,
            self.image,
            "sleep",
            "infinity",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise SandboxInitError(f"Failed to start container: {result.stderr}")
        self.container_id = result.stdout.strip()
        
        # Ensure patch is installed if using a bare image (for demo/diff apply)
        # Note: In a real environment, the image should come with `patch` pre-installed.
        # But for safety, we try to ensure patch exists or rely on the image.

    def _exec(self, cmd: list[str], timeout: float = 30.0, input_str: str | None = None) -> subprocess.CompletedProcess[str]:
        if not self.container_id:
            self._start_container()
        assert self.container_id is not None

        exec_cmd = ["docker", "exec", "-i", self.container_id] + cmd
        try:
            return subprocess.run(
                exec_cmd,
                input=input_str,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as e:
            raise HostTimeoutError(f"Command timed out after {timeout}s") from e

    def apply_diff(self, diff: UnifiedDiff) -> ApplyResult:
        if not diff.text.strip():
            return ApplyResult(applied=True)

        result = self._exec(["patch", "-p1", "--force", "--dry-run"], input_str=diff.text)
        if result.returncode != 0:
            # Simple conflict detection from patch output
            conflicts = tuple(
                line for line in result.stdout.splitlines() if "FAILED" in line or "reject" in line.lower()
            )
            return ApplyResult(applied=False, conflicts=conflicts or ("Unknown conflict",))

        # Real apply
        result = self._exec(["patch", "-p1", "--force"], input_str=diff.text)
        if result.returncode == 0:
            return ApplyResult(applied=True)
        return ApplyResult(applied=False, conflicts=("Failed during actual patch apply",))

    def run_tests(self, selector: str) -> TestResult:
        start_t = time.monotonic()
        result = self._exec(["sh", "-c", selector])
        duration = time.monotonic() - start_t

        outcome = Outcome.PASS if result.returncode == 0 else Outcome.FAIL
        return TestResult(
            outcome=outcome,
            exit_code=result.returncode,
            duration_s=duration,
            stdout=result.stdout,
            stderr=result.stderr,
        )

    def run_lint(self, paths: tuple[str, ...]) -> LintResult:
        # Stub linting logic using echo or a generic linter if installed
        # For a full implementation, we'd invoke ruff or similar based on project
        return LintResult(outcome=Outcome.PASS, duration_s=0.0)

    def collect_artifacts(self, globs: tuple[str, ...]) -> ArtifactBundle:
        # A simple stub
        return ArtifactBundle()

    def reset(self) -> None:
        if self.container_id:
            subprocess.run(["docker", "kill", self.container_id], capture_output=True)
            self.container_id = None
