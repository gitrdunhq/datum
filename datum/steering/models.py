"""Typed models for the coding-steering runtime seam."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass
class CodingSteeringResult:
    """Typed outer runtime result for coding-steering operations."""

    status: Literal["ok", "blocked"]
    summary: str
    artifacts: list[str]
    validation_errors: list[str]
    details: dict[str, object]
    review_required: bool = False
    approved_for_execution: bool = True
    next_skill: str = "complete"

    def to_dict(self) -> dict[str, object]:
        return {
            "status": self.status,
            "result": {
                "summary": self.summary,
                "artifacts": self.artifacts,
            },
            "validation_errors": self.validation_errors,
            "review_required": self.review_required,
            "approved_for_execution": self.approved_for_execution,
            "next_skill": self.next_skill,
            "details": self.details,
        }
