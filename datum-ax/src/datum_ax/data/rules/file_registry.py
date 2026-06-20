"""FileRuleRegistry (data tier) — loads generic rules from markdown + YAML frontmatter (ADR-0020).

Layout: ``<root>/*.md``. Frontmatter carries the `RuleRegistryEntry` metadata (kind, tier,
scope_tags, evidence_refs, version); the markdown body becomes the rule's `statement` (its liftable
steering text). id = filename stem. Selection mirrors skills: deterministic tag match + a keyword
`match_rules` fallback tier (ADR-0034).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

from datum_ax.contracts.rules import RuleNotFoundError
from datum_ax.data.rules import RULE_REGISTRIES
from datum_ax.schemas.rules import RuleKind, RuleRegistryEntry, RuleTier


def _split(text: str) -> tuple[dict[str, Any], str]:
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            meta = yaml.safe_load(parts[1]) or {}
            if not isinstance(meta, dict):
                raise ValueError("rule frontmatter must be a mapping")
            return meta, parts[2].strip()
    return {}, text.strip()


class FileRuleRegistry:
    """Implements the `RuleRegistry` port over a directory of markdown rule artifacts."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self._rules: dict[str, RuleRegistryEntry] = {}
        self._load()

    def _load(self) -> None:
        for path in sorted(self.root.rglob("*.md")):
            meta, body = _split(path.read_text(encoding="utf-8"))
            entry = RuleRegistryEntry(
                id=path.stem,
                kind=RuleKind(meta.get("kind", "steering")),
                tier=RuleTier(meta.get("tier", "auto_bind")),
                statement=body,
                scope_tags=tuple(str(t) for t in (meta.get("scope_tags") or ())),
                evidence_refs=tuple(str(e) for e in (meta.get("evidence_refs") or ("authored",))),
                version=int(meta.get("version", 1)),
                fire_count=int(meta.get("fire_count", 0)),
            )
            self._rules[entry.id] = entry

    # --- compound-engineering capture (ADR-0020) -----------------------------------------------
    def add_rule(self, entry: RuleRegistryEntry) -> None:
        """Persist a (learned) rule artifact so the next run's crane lifts it. Idempotent by id —
        re-binding the same id overwrites rather than duplicating."""
        fm = {
            "kind": entry.kind.value,
            "tier": entry.tier.value,
            "scope_tags": list(entry.scope_tags),
            "evidence_refs": list(entry.evidence_refs),
            "version": entry.version,
            "fire_count": entry.fire_count,
        }
        front = yaml.safe_dump(
            fm, sort_keys=False, default_flow_style=False, allow_unicode=True
        ).strip()
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / f"{entry.id}.md").write_text(
            f"---\n{front}\n---\n{entry.statement}\n", encoding="utf-8"
        )
        self._rules[entry.id] = entry

    def record_fire(self, rule_id: str) -> None:
        """Bump a rule's fire_count (it influenced a lane) — the signal that keeps it from pruning."""
        entry = self.get_rule(rule_id)
        self.add_rule(entry.model_copy(update={"fire_count": entry.fire_count + 1}))

    def prune_unfired(self) -> tuple[str, ...]:
        """Ids of rules that have never fired — surfaced as anti-bloat candidates (ADR-0020)."""
        return tuple(r.id for r in self.all_rules() if r.fire_count == 0)

    def get_rule(self, rule_id: str) -> RuleRegistryEntry:
        try:
            return self._rules[rule_id]
        except KeyError:
            raise RuleNotFoundError(f"no rule {rule_id!r}; known: {sorted(self._rules)}") from None

    def all_rules(self) -> tuple[RuleRegistryEntry, ...]:
        return tuple(sorted(self._rules.values(), key=lambda r: r.id))

    def select_rules(self, scope_tags: tuple[str, ...]) -> tuple[RuleRegistryEntry, ...]:
        wanted = set(scope_tags)
        return tuple(r for r in self.all_rules() if wanted.intersection(r.scope_tags))

    def match_rules(
        self, query: str, limit: int = 1, threshold: float = 0.0
    ) -> tuple[RuleRegistryEntry, ...]:
        q = set(re.findall(r"[a-z0-9]+", query.lower()))
        if not q:
            return ()
        scored = []
        for r in self.all_rules():
            text = f"{r.id} {r.statement} {' '.join(r.scope_tags)}".lower()
            words = set(re.findall(r"[a-z0-9]+", text))
            overlap = len(q & words) / len(q)
            if overlap > threshold:
                scored.append((overlap, r.id, r))
        scored.sort(key=lambda t: (-t[0], t[1]))
        return tuple(r for _, _, r in scored[:limit])


@RULE_REGISTRIES.register("file")
def _build(**kwargs: Any) -> FileRuleRegistry:
    return FileRuleRegistry(**kwargs)
