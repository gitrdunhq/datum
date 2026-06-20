"""Model-role registry (data tier) — maps each role to its oMLX model id + temperature (ADR-0003/0009).

Config-driven: model ids and temperatures live here, never in code paths.
"""

from __future__ import annotations

from pydantic import Field, model_validator
from typing import Any

from datum_ax._base import Contract
from datum_ax.contracts.inference import ModelRole
from datum_ax.data.inference.errors import UnknownRoleError


class RoleConfig(Contract):
    role: ModelRole
    model_id: str = Field(min_length=1)
    temperature: float = Field(ge=0, le=2)
    response_format: dict[str, Any] | None = None


class ModelRoleRegistry(Contract):
    configs: tuple[RoleConfig, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_roles(self) -> "ModelRoleRegistry":
        roles = [c.role for c in self.configs]
        if len(roles) != len(set(roles)):
            raise ValueError("duplicate role in registry")
        return self

    def get(self, role: ModelRole) -> RoleConfig:
        for cfg in self.configs:
            if cfg.role is role:
                return cfg
        raise UnknownRoleError(f"no RoleConfig registered for role {role.value!r}")
