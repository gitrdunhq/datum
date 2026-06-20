from datum_ax.contracts.execution import (
    ApplyResult,
    ArtifactBundle,
    LintResult,
    TestResult,
    UnifiedDiff,
)


class MacOSTartHost:
    """Stub MacOS Tart implementation of the ExecutionHost contract (ADR-0001)."""

    def apply_diff(self, diff: UnifiedDiff) -> ApplyResult:
        raise NotImplementedError("MacOSTartHost is a stub")

    def run_tests(self, selector: str) -> TestResult:
        raise NotImplementedError("MacOSTartHost is a stub")

    def run_lint(self, paths: tuple[str, ...]) -> LintResult:
        raise NotImplementedError("MacOSTartHost is a stub")

    def collect_artifacts(self, globs: tuple[str, ...]) -> ArtifactBundle:
        raise NotImplementedError("MacOSTartHost is a stub")

    def reset(self) -> None:
        raise NotImplementedError("MacOSTartHost is a stub")
