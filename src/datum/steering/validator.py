"""
Deterministic validation of compact coding steering documents.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

RULE_HEADER_RE = re.compile(r"^###\s+(CS-\d+)\s*$", re.MULTILINE)
FIELD_RE = re.compile(r"^(Rule|Trigger|Do|Check|Evidence):\s*(.+)$", re.MULTILINE)


@dataclass(frozen=True)
class RuleBlock:
    """Parsed compact rule block."""

    rule_id: str
    fields: dict[str, str]


@dataclass(frozen=True)
class ValidationIssue:
    """A validation finding."""

    severity: str
    code: str
    message: str


class SteeringDocValidator:
    """Validate compact steering docs for enforceability and compression."""

    REQUIRED_FIELDS = ("Rule", "Trigger", "Do", "Check", "Evidence")
    STYLE_WORDS = ("readable", "clean", "elegant", "pretty", "nice", "clearer")

    def parse(self, content: str) -> list[RuleBlock]:
        blocks: list[RuleBlock] = []
        matches = list(RULE_HEADER_RE.finditer(content))
        for index, match in enumerate(matches):
            start = match.end()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(content)
            body = content[start:end]
            fields = {name: value.strip() for name, value in FIELD_RE.findall(body)}
            blocks.append(RuleBlock(rule_id=match.group(1), fields=fields))
        return blocks

    def validate(self, content: str) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        blocks = self.parse(content)
        if not blocks:
            return [ValidationIssue("error", "no-rules", "No CS-### rule blocks found")]

        do_actions: dict[str, str] = {}
        for block in blocks:
            missing = [field for field in self.REQUIRED_FIELDS if field not in block.fields]
            if missing:
                issues.append(
                    ValidationIssue(
                        "error",
                        "missing-fields",
                        f"{block.rule_id} missing required fields: {', '.join(missing)}",
                    )
                )
                continue

            if self._looks_like_style(block):
                issues.append(
                    ValidationIssue(
                        "warning",
                        "style-only",
                        f"{block.rule_id} looks like style guidance rather than enforceable steering",
                    )
                )

            action_key = re.sub(r"\s+", " ", block.fields["Do"].lower()).strip()
            prior = do_actions.get(action_key)
            if prior and prior != block.rule_id:
                issues.append(
                    ValidationIssue(
                        "warning",
                        "duplicate-action",
                        f"{block.rule_id} duplicates the Do action already used by {prior}",
                    )
                )
            else:
                do_actions[action_key] = block.rule_id

        return issues

    def _looks_like_style(self, block: RuleBlock) -> bool:
        rule_text = " ".join(block.fields.get(field, "") for field in self.REQUIRED_FIELDS)
        lower = rule_text.lower()
        if any(word in lower for word in self.STYLE_WORDS):
            trigger = block.fields.get("Trigger", "").lower()
            check = block.fields.get("Check", "").lower()
            if "test" not in check and "reject" not in check and "pass" not in check:
                return True
            if "preference" in trigger or "taste" in trigger:
                return True
        return False
