"""EedomReviewGate (data tier) — the deterministic review gate adapter (ADR-0006).

Shells out to the `eedom` binary and maps its output to a typed `ReviewDecision`. Fail-open: any
invocation/parse error becomes NEEDS_REVIEW (never silently approves).

Follow-up (sanctioned, we own eedom): have `eedom evaluate --json` emit a ReviewDecision-shaped
payload so this becomes a thin pass-through instead of a verdict/violation mapping.
"""

from __future__ import annotations

import json
import subprocess
import uuid
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any, Callable

from datum_ax.contracts.review import (
    DecisionVerdict,
    Finding,
    FindingCategory,
    PolicyEvaluation,
    ReviewDecision,
    Severity,
)
from datum_ax.data.review import REVIEW_GATES

_VERDICT_MAP = {
    "PASS": DecisionVerdict.APPROVE,
    "FAIL": DecisionVerdict.REJECT,
    "ERROR": DecisionVerdict.NEEDS_REVIEW,
}


def default_runner(cmd: list[str], input_data: str) -> str:
    result = subprocess.run(cmd, input=input_data, text=True, capture_output=True, check=True)
    return result.stdout


class EedomReviewGate:
    """Implements the `ReviewGate` port via the eedom CLI."""

    def __init__(
        self,
        runner: Callable[[list[str], str], str] = default_runner,
        policy_bundle_version: str = "eedom-local",
    ) -> None:
        self.runner = runner
        self.policy_bundle_version = policy_bundle_version

    def evaluate(self, diff: str, properties: Mapping[str, Any] | None = None) -> ReviewDecision:
        context = {"diff": diff, "rules": list((properties or {}).get("invariants", []))}
        try:
            output = self.runner(["eedom", "evaluate", "--json"], json.dumps(context))
        except Exception as exc:  # fail-open → needs_review (ADR-0006)
            return self._decision(
                DecisionVerdict.NEEDS_REVIEW,
                (self._finding(f"eedom invocation error: {exc}"),),
                memo="eedom unavailable — fail-open to needs_review",
            )
        try:
            raw = json.loads(output)
        except json.JSONDecodeError:
            return self._decision(
                DecisionVerdict.NEEDS_REVIEW,
                (self._finding("failed to parse eedom output"),),
                memo="unparseable eedom output — fail-open",
            )

        decision = _VERDICT_MAP.get(str(raw.get("verdict", "FAIL")), DecisionVerdict.NEEDS_REVIEW)
        findings = tuple(self._finding(str(v)) for v in raw.get("violations", []))
        return self._decision(decision, findings)

    def _finding(self, description: str) -> Finding:
        return Finding(
            severity=Severity.HIGH,
            category=FindingCategory.CODE,
            description=description or "(unspecified)",
            source_tool="eedom",
        )

    def _decision(
        self, verdict: DecisionVerdict, findings: tuple[Finding, ...], memo: str = ""
    ) -> ReviewDecision:
        blocking = verdict in (DecisionVerdict.REJECT, DecisionVerdict.NEEDS_REVIEW)
        return ReviewDecision(
            decision_id=uuid.uuid4().hex,
            decision=verdict,
            policy_evaluation=PolicyEvaluation(
                decision=verdict, policy_bundle_version=self.policy_bundle_version
            ),
            should_comment=bool(findings) or blocking,
            should_mark_unstable=blocking,
            findings=findings,
            memo_text=memo,
            created_at=datetime.now(timezone.utc),
        )


@REVIEW_GATES.register("eedom")
def _build(**kwargs: Any) -> EedomReviewGate:
    return EedomReviewGate(**kwargs)
