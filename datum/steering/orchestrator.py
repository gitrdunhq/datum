"""
End-to-end deterministic orchestration for coding steering preparation.
"""

from __future__ import annotations

import json
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .extractor import RuleFamilyCandidate, RuleFamilyExtractor
from .miner import EvidenceManifest, EvidenceMiner
from .validator import SteeringDocValidator, ValidationIssue


@dataclass(frozen=True)
class SteeringRunConfig:
    """Deterministic run configuration."""

    target: str
    sources: tuple[str, ...]
    focus: str | None = None
    output_path: str | None = None
    refresh: bool = False
    prompt_block: bool = False


@dataclass(frozen=True)
class SteeringPacket:
    """Packet handed to the LLM for synthesis."""

    config: SteeringRunConfig
    manifest: EvidenceManifest
    candidates: tuple[RuleFamilyCandidate, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "config": asdict(self.config),
            "manifest": {
                "target": self.manifest.target,
                "sources": list(self.manifest.sources),
                "files": [asdict(item) for item in self.manifest.files],
            },
            "candidates": [
                {
                    "family_id": item.family_id,
                    "label": item.label,
                    "required_action": item.required_action,
                    "trigger_hint": item.trigger_hint,
                    "check_hint": item.check_hint,
                    "recurrence": item.recurrence,
                    "raw_match_count": item.raw_match_count,
                    "evidence_paths": item.evidence_paths,
                }
                for item in self.candidates
            ],
        }


class CodingSteeringOrchestrator:
    """Build a deterministic steering packet and validate final output."""

    def __init__(
        self,
        miner: EvidenceMiner | None = None,
        extractor: RuleFamilyExtractor | None = None,
        validator: SteeringDocValidator | None = None,
    ) -> None:
        self.miner = miner or EvidenceMiner()
        self.extractor = extractor or RuleFamilyExtractor()
        self.validator = validator or SteeringDocValidator()

    def build_packet(
        self,
        target: Path,
        sources: list[str] | None = None,
        focus: str | None = None,
        output_path: Path | None = None,
        refresh: bool = False,
        prompt_block: bool = False,
    ) -> SteeringPacket:
        """Run mine -> extract -> filter and return a deterministic packet."""
        resolved_target = target.resolve()
        manifest = self.miner.mine(resolved_target, sources=sources)
        candidates = self.extractor.extract_from_files(
            resolved_target,
            [item.path for item in manifest.files],
        )
        candidates = tuple(self._filter_by_focus(candidates, focus))
        config = SteeringRunConfig(
            target=str(resolved_target),
            sources=manifest.sources,
            focus=focus,
            output_path=str(output_path) if output_path else None,
            refresh=refresh,
            prompt_block=prompt_block,
        )
        return SteeringPacket(config=config, manifest=manifest, candidates=candidates)

    def validate_document(self, content: str) -> list[ValidationIssue]:
        """Validate a finished steering document."""
        return self.validator.validate(content)

    def write_packet(self, packet: SteeringPacket, path: Path) -> Path:
        """Atomically serialize packet as JSON."""
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            json.dump(packet.to_dict(), handle, indent=2, sort_keys=True)
            handle.write("\n")
            temp_path = Path(handle.name)
        temp_path.replace(path)
        return path

    def _filter_by_focus(
        self,
        candidates: tuple[RuleFamilyCandidate, ...] | list[RuleFamilyCandidate],
        focus: str | None,
    ) -> list[RuleFamilyCandidate]:
        if not focus:
            return list(candidates)
        focus_terms = [term.strip().lower() for term in focus.split(",") if term.strip()]
        if not focus_terms:
            return list(candidates)
        filtered: list[RuleFamilyCandidate] = []
        for candidate in candidates:
            haystack = " ".join(
                [
                    candidate.family_id,
                    candidate.label,
                    candidate.required_action,
                    candidate.trigger_hint,
                    candidate.check_hint,
                    " ".join(candidate.evidence_paths),
                ]
            ).lower()
            if any(term in haystack for term in focus_terms):
                filtered.append(candidate)
        return filtered
