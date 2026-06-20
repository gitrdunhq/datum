"""Test doubles. FakeOmlxTransport = a mock oMLX endpoint that records calls and peak concurrency."""

from __future__ import annotations

import asyncio

from datum_ax.contracts.execution import (
    ApplyResult,
    ArtifactBundle,
    LintResult,
    Outcome,
    TestResult,
    UnifiedDiff,
)
from datum_ax.data.inference.wire import ChatRequest, ChatResponse, Usage


class FakeExecutionHost:
    """Implements ExecutionHost. Records applied diffs; always succeeds (hermetic, no subprocess)."""

    def __init__(self) -> None:
        self.applied: list[UnifiedDiff] = []

    def apply_diff(self, diff: UnifiedDiff) -> ApplyResult:
        self.applied.append(diff)
        return ApplyResult(applied=True, conflicts=())

    def run_tests(self, selector: str) -> TestResult:
        return TestResult(outcome=Outcome.PASS, exit_code=0, duration_s=0.0)

    def run_lint(self, paths: tuple[str, ...]) -> LintResult:
        return LintResult(outcome=Outcome.PASS, duration_s=0.0)

    def collect_artifacts(self, globs: tuple[str, ...]) -> ArtifactBundle:
        return ArtifactBundle()

    def reset(self) -> None:
        pass


class FakeOmlxTransport:
    """Implements OmlxTransport. Records every request and the peak number of concurrent in-flight
    calls (to verify the semaphore caps concurrency)."""

    def __init__(
        self,
        *,
        reply: str = "ok",
        delay: float = 0.0,
        input_tokens: int = 10,
        output_tokens: int = 5,
        finish_reason: str | None = "stop",
        fail: Exception | None = None,
    ) -> None:
        self.reply = reply
        self.delay = delay
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.finish_reason = finish_reason
        self.fail = fail
        self.calls: list[ChatRequest] = []
        self.in_flight = 0
        self.peak = 0

    async def complete(self, request: ChatRequest) -> ChatResponse:
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        self.calls.append(request)
        try:
            if self.delay:
                await asyncio.sleep(self.delay)
            if self.fail is not None:
                raise self.fail
            return ChatResponse(
                text=self.reply,
                usage=Usage(input_tokens=self.input_tokens, output_tokens=self.output_tokens),
                finish_reason=self.finish_reason,
            )
        finally:
            self.in_flight -= 1
