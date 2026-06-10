from __future__ import annotations

from pydantic import BaseModel


class WalkthroughSummary(BaseModel):
    summary: str
    lanes: list[str]
    files_touched: list[str]
    key_decisions: list[str]
    excluded: list[str]
