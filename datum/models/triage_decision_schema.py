from __future__ import annotations
from typing import Literal
from pydantic import BaseModel


class TriageDecision(BaseModel):
    decision: Literal["deepen", "properties"]
    reason: str
