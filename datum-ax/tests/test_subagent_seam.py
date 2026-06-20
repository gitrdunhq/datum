"""G13 deterministic seam (ADR-0035): skills have a delivery mode; the crane never inlines `subagent`
playbooks, and a `Worker` port runs them as isolated workers returning a typed result."""

from __future__ import annotations

from datum_ax.contracts.persona import SkillDelivery
from datum_ax.contracts.worker import Worker, WorkerResult
from datum_ax.data.workers import WORKERS
from datum_ax.data.workers.fake import FakeWorker
from datum_ax.presentation.composition import build_context_crane, build_persona_registry


def test_playbook_skills_are_marked_subagent():
    reg = build_persona_registry()
    assert reg.get_skill("gitnexus-bug-hunt").delivery is SkillDelivery.SUBAGENT
    assert reg.get_skill("gitnexus-debugging").delivery is SkillDelivery.INLINE


def test_crane_never_inlines_a_subagent_skill():
    crane = build_context_crane()
    # troubleshooting tag matches BOTH gitnexus-debugging (inline) and gitnexus-bug-hunt (subagent)...
    lifted = crane.lift_skills(("troubleshooting",))
    assert "Debugging with GitNexus" in lifted  # inline skill lifted
    assert "GitNexus Bug Hunt" not in lifted  # subagent playbook NOT inlined
    # ...same for the prefix path.
    system = crane.compose_system("green", scope_tags=("troubleshooting",))
    assert "GitNexus Bug Hunt" not in system


def test_worker_port_and_registry():
    assert isinstance(FakeWorker(), Worker)
    assert "fake" in WORKERS.keys()


def test_worker_runs_a_playbook_and_returns_structured_result():
    worker = FakeWorker()
    result = worker.run(
        playbook="hunt for bugs", inputs={"repo": "x"}, output_schema={"findings": []}
    )
    assert isinstance(result, WorkerResult)
    assert result.ok
    assert isinstance(result.output, dict)
