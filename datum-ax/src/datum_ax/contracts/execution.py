"""ExecutionHost contract (ADR-0001/0012) — the core<->data seam for running code off the
orchestrator. Diff in, results out; nothing in a sandbox is authoritative.
"""

from __future__ import annotations

from enum import Enum
from typing import Protocol, runtime_checkable

from pydantic import Field, model_validator

from datum_ax._base import Contract


class ExecutionTarget(str, Enum):
    X86 = "x86"
    MACOS = "macos"


class Outcome(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    ERROR = "error"
    TIMEOUT = "timeout"


class UnifiedDiff(Contract):
    """A candidate change shipped to a host. Empty text = no-op diff."""

    text: str
    target: ExecutionTarget


class ApplyResult(Contract):
    """Atomicity: an applied diff has no conflicts; a conflicted diff is not applied."""

    applied: bool
    conflicts: tuple[str, ...] = ()

    @model_validator(mode="after")
    def _atomic(self) -> "ApplyResult":
        if self.applied and self.conflicts:
            raise ValueError("partial apply: applied=True with conflicts (Atomicity violation)")
        return self


class TestResult(Contract):
    __test__ = False  # domain model, not a pytest test class

    outcome: Outcome
    exit_code: int
    duration_s: float = Field(ge=0)
    stdout: str = ""
    stderr: str = ""
    tests_run: int | None = Field(default=None, ge=0)
    tests_passed: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _passed_within_run(self) -> "TestResult":
        if (
            self.tests_run is not None
            and self.tests_passed is not None
            and self.tests_passed > self.tests_run
        ):
            raise ValueError("tests_passed exceeds tests_run (Boundedness violation)")
        return self

    @property
    def passed(self) -> bool:
        return self.outcome is Outcome.PASS


class LintResult(Contract):
    outcome: Outcome
    findings: tuple[str, ...] = ()
    duration_s: float = Field(ge=0)


class ArtifactRef(Contract):
    path: str = Field(min_length=1)
    size_bytes: int = Field(ge=0)


class ArtifactBundle(Contract):
    artifacts: tuple[ArtifactRef, ...] = ()

    @property
    def total_bytes(self) -> int:
        return sum(a.size_bytes for a in self.artifacts)


@runtime_checkable
class ExecutionHost(Protocol):
    """Port for an ephemeral execution sandbox (X86DockerHost / MacOSTartHost in the data tier)."""

    def apply_diff(self, diff: UnifiedDiff) -> ApplyResult: ...

    def run_tests(self, selector: str) -> TestResult: ...

    def run_lint(self, paths: tuple[str, ...]) -> LintResult: ...

    def collect_artifacts(self, globs: tuple[str, ...]) -> ArtifactBundle: ...

    def reset(self) -> None: ...
