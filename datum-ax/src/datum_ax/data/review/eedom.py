"""EedomReviewGate (data tier) — the deterministic review gate adapter (ADR-0006).

Honors eedom's REAL contract: write the diff to a temp file, run
`eedom evaluate --repo-path … --diff … --pr-url … --team … --operating-mode … --output-json <path>`,
and read back his published `ReviewDecision` JSON (eedom #389), which we map to our `ReviewDecision`.
His verdict + severity enums match ours 1:1; his category set is broader, so it's mapped.

Fail-open: any invocation/parse error → NEEDS_REVIEW (never silently approves).
"""

from __future__ import annotations

import json
import subprocess
import tempfile
import uuid
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from datum_ax.contracts.review import (
    BLOCKING_VERDICTS,
    DecisionVerdict,
    Finding,
    FindingCategory,
    PolicyEvaluation,
    ReviewDecision,
    Severity,
)
from datum_ax.data.review import REVIEW_GATES

# eedom's FindingCategory is broader than ours — map his extras onto our set.
_CATEGORY_MAP = {
    "vulnerability": FindingCategory.VULNERABILITY,
    "license": FindingCategory.LICENSE,
    "copyright": FindingCategory.LICENSE,
    "malicious": FindingCategory.MALICIOUS,
    "malware": FindingCategory.MALICIOUS,
    "age": FindingCategory.AGE,
    "transitive_count": FindingCategory.TRANSITIVE_COUNT,
    "behavioral": FindingCategory.CODE,
    "code_smell": FindingCategory.CODE,
    "security": FindingCategory.CODE,
    "secret": FindingCategory.SECRET,
    "code": FindingCategory.CODE,
}
_BLOCKING = BLOCKING_VERDICTS  # single source (contracts/review.py)


def default_runner(cmd: list[str]) -> None:
    """Run eedom; it writes the decision JSON to its `--output-json` path."""
    subprocess.run(cmd, check=True, capture_output=True, text=True)


class EedomReviewGate:
    """Implements the `ReviewGate` port via the real `eedom evaluate` CLI."""

    def __init__(
        self,
        runner: Callable[[list[str]], None] = default_runner,
        *,
        repo_path: str = ".",
        pr_url: str = "local://datum-ax",
        team: str = "datum-ax",
        operating_mode: str = "advise",
        policy_bundle_version: str = "eedom",
    ) -> None:
        self.runner = runner
        self.repo_path = repo_path
        self.pr_url = pr_url
        self.team = team
        self.operating_mode = operating_mode
        self.policy_bundle_version = policy_bundle_version

    def evaluate(self, diff: str, properties: Mapping[str, Any] | None = None) -> ReviewDecision:
        try:
            with tempfile.TemporaryDirectory() as tmp:
                diff_path = Path(tmp) / "change.diff"
                out_path = Path(tmp) / "decision.json"
                diff_path.write_text(diff, encoding="utf-8")
                self.runner(
                    [
                        "eedom",
                        "evaluate",
                        "--repo-path",
                        self.repo_path,
                        "--diff",
                        str(diff_path),
                        "--pr-url",
                        self.pr_url,
                        "--team",
                        self.team,
                        "--operating-mode",
                        self.operating_mode,
                        "--output-json",
                        str(out_path),
                    ]
                )
                if not out_path.exists():
                    return self._fail_open("eedom produced no decision (no changes detected?)")
                raw = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception as exc:  # fail-open (ADR-0006)
            return self._fail_open(f"eedom invocation error: {exc}")
        return self._map(raw)

    def _map(self, raw: dict[str, Any]) -> ReviewDecision:
        verdict = self._verdict(raw.get("decision"))
        findings = tuple(self._finding(f) for f in raw.get("findings", []) if isinstance(f, dict))
        blocking = verdict in _BLOCKING
        pe = raw.get("policy_evaluation") or {}
        return ReviewDecision(
            decision_id=uuid.uuid4().hex,
            decision=verdict,
            policy_evaluation=PolicyEvaluation(
                decision=verdict,
                triggered_rules=tuple(pe.get("triggered_rules") or ()),
                constraints=tuple(pe.get("constraints") or ()),
                policy_bundle_version=str(
                    pe.get("policy_bundle_version") or self.policy_bundle_version
                ),
            ),
            should_comment=bool(raw.get("should_comment", bool(findings) or blocking)),
            should_mark_unstable=bool(raw.get("should_mark_unstable", blocking)),
            findings=findings,
            memo_text=str(raw.get("memo_text") or ""),
            created_at=datetime.now(timezone.utc),
        )

    def _verdict(self, value: Any) -> DecisionVerdict:
        try:
            return DecisionVerdict(value)
        except (ValueError, TypeError):
            return DecisionVerdict.NEEDS_REVIEW

    def _finding(self, f: dict[str, Any]) -> Finding:
        try:
            severity = Severity(f.get("severity"))
        except (ValueError, TypeError):
            severity = Severity.INFO
        return Finding(
            severity=severity,
            category=_CATEGORY_MAP.get(str(f.get("category")), FindingCategory.CODE),
            description=str(f.get("description") or "(unspecified)"),
            source_tool=str(f.get("source_tool") or "eedom"),
            advisory_id=f.get("advisory_id"),
            package_name=f.get("package_name"),
            version=f.get("version"),
        )

    def _fail_open(self, message: str) -> ReviewDecision:
        return ReviewDecision(
            decision_id=uuid.uuid4().hex,
            decision=DecisionVerdict.NEEDS_REVIEW,
            policy_evaluation=PolicyEvaluation(
                decision=DecisionVerdict.NEEDS_REVIEW,
                policy_bundle_version=self.policy_bundle_version,
            ),
            should_comment=True,
            should_mark_unstable=True,
            findings=(
                Finding(
                    severity=Severity.INFO,
                    category=FindingCategory.CODE,
                    description=message,
                    source_tool="eedom",
                ),
            ),
            memo_text=message,
            created_at=datetime.now(timezone.utc),
        )


@REVIEW_GATES.register("eedom")
def _build(**kwargs: Any) -> EedomReviewGate:
    return EedomReviewGate(**kwargs)
