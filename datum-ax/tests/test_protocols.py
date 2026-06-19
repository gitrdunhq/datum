"""Protocol conformance — the runtime-checkable ports (ADR-0026).

A conforming fake satisfies isinstance; a non-conforming one does not. (Structural / Availability.)
"""

from __future__ import annotations

from datum_ax.contracts.context import CodeContext, DocContext, NlCompressor
from datum_ax.contracts.execution import ExecutionHost
from datum_ax.contracts.inference import InferenceClient


class TestProtocolConformance:
    def test_execution_host(self):
        class Host:
            def apply_diff(self, diff): ...
            def run_tests(self, selector): ...
            def run_lint(self, paths): ...
            def collect_artifacts(self, globs): ...
            def reset(self): ...

        class Partial:
            def apply_diff(self, diff): ...

        assert isinstance(Host(), ExecutionHost)
        assert not isinstance(Partial(), ExecutionHost)

    def test_inference_client(self):
        class Client:
            async def complete(self, role, prompt, budget): ...

        assert isinstance(Client(), InferenceClient)
        assert not isinstance(object(), InferenceClient)

    def test_context_ports(self):
        class Code:
            def global_map(self): ...
            def symbol(self, name): ...
            def references(self, name): ...

        class Doc:
            def library_docs(self, library, version=None): ...

        class Comp:
            def compress(self, doc, budget): ...

        assert isinstance(Code(), CodeContext)
        assert isinstance(Doc(), DocContext)
        assert isinstance(Comp(), NlCompressor)
        # a code port is not a doc port
        assert not isinstance(Code(), DocContext)
