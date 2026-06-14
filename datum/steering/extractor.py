"""
Deterministic extraction of failure families from mined evidence.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

DESCRIPTION_RE = re.compile(
    r"\*\*Description\*\*:\s*([\s\S]*?)(?=\n\n\*\*Remediation\*\*|\n\n### |\Z)",
    re.MULTILINE,
)
UUID_JSONL_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$",
    re.IGNORECASE,
)
STRICT_SIGNAL_RE = re.compile(
    r"\b("
    r"timeout|timed out|hang|hung|blocking call|retry exhaustion|"
    r"error|failed|failure|invalid|missing|unknown fields|"
    r"silent|silently|swallow|fallback|best-effort|"
    r"cwd|repo root|path traversal|symlink|"
    r"atomic|partial write|truncated|"
    r"race|concurrent|lockfile|flock|"
    r"nonetype|attributeerror|indexerror|nil"
    r")\b|\|\|\s*true|2>/dev/null",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class FindingSnippet:
    """A short evidence snippet extracted from a file."""

    path: str
    text: str


@dataclass(frozen=True)
class FailureFamilyMatch:
    """A matched failure family for a snippet."""

    family_id: str
    path: str
    text: str


@dataclass
class RuleFamilyCandidate:
    """Deterministic cluster that the LLM can reason over."""

    family_id: str
    label: str
    required_action: str
    trigger_hint: str
    check_hint: str
    matches: list[FailureFamilyMatch] = field(default_factory=list)

    @property
    def recurrence(self) -> int:
        return len(self.evidence_paths)

    @property
    def raw_match_count(self) -> int:
        return len(self.matches)

    @property
    def evidence_paths(self) -> list[str]:
        seen: list[str] = []
        for match in self.matches:
            if match.path not in seen:
                seen.append(match.path)
        return seen


class RuleFamilyExtractor:
    """Extract repeated failure families from markdown/text evidence."""

    _FAMILIES: tuple[dict[str, object], ...] = (
        {
            "id": "silent-failure",
            "label": "Fail loudly on degraded execution",
            "required_action": "surface a typed failure or explicit degraded state",
            "trigger_hint": "broad catches, || true, empty-success fallback",
            "check_hint": "failure path is observable in tests or logs",
            "patterns": (
                r"\bsilent|silently|swallow|swallowed|ignored|ignore[d]?|best-effort|fallback\b|\|\|\s*true|2>/dev/null",
            ),
        },
        {
            "id": "path-rooting",
            "label": "Root managed paths to an explicit repo root",
            "required_action": "derive one repo root, resolve from it, reject escape",
            "trigger_hint": "cwd-relative writes, path traversal, symlink escape",
            "check_hint": "nested-subdir run passes and escape path is rejected",
            "patterns": (r"\bpath traversal|symlink|cwd\b|repo root|process cwd|subdirectory\b",),
        },
        {
            "id": "atomic-writes",
            "label": "Use write-temp then atomic replace for durable state",
            "required_action": "write temp, validate, swap atomically, then cleanup",
            "trigger_hint": "os.WriteFile, write_text, rmtree+replace, partial write",
            "check_hint": "interrupted write leaves prior good state intact",
            "patterns": (
                r"\batomic|writefile|write_text|partial write|truncated|rmtree|replace\b",
            ),
        },
        {
            "id": "timeouts",
            "label": "Bound every external call with timeouts",
            "required_action": "add timeout and observable timeout handling",
            "trigger_hint": "hung subprocesses, unbounded SDK or parser calls",
            "check_hint": "timeout path fires in a focused test",
            "patterns": (
                r"\btimeout|timed out|hang|blocking call|block indefinitely|retry exhaustion\b",
            ),
        },
        {
            "id": "guard-state",
            "label": "Guard delegated state before dereference",
            "required_action": "check result immediately after delegated call",
            "trigger_hint": "unconditional dereference, None, nil, missing guard",
            "check_hint": "rejected or partial init path exits cleanly",
            "patterns": (
                r"\bunguarded|unconditionally|NoneType|nil\b|missing guard|IndexError|AttributeError\b",
            ),
        },
        {
            "id": "validation-boundary",
            "label": "Validate at the boundary, not downstream",
            "required_action": "perform runtime schema or input validation at ingress",
            "trigger_hint": "as T, schema drift, malformed input, unknown fields",
            "check_hint": "invalid input is rejected before main logic runs",
            "patterns": (r"\bvalidate|validation|schema|runtime validation|unknown fields|as T\b",),
        },
        {
            "id": "concurrency",
            "label": "Make concurrent access explicit and enforced",
            "required_action": "use locks, lockfiles, or optimistic version checks",
            "trigger_hint": "race, TOCTOU, parallel invocation, lock misuse",
            "check_hint": "parallel execution either serializes or fails safely",
            "patterns": (
                r"\brace\b|TOCTOU|parallel invocation|concurrent|lockfile|flock|optimistic\b",
            ),
        },
    )

    def extract_from_files(self, base_dir: Path, paths: Iterable[str]) -> list[RuleFamilyCandidate]:
        snippets: list[FindingSnippet] = []
        for rel in paths:
            path = Path(rel)
            if not path.is_absolute():
                path = base_dir / rel
            if path.suffix.lower() == ".jsonl":
                snippets.extend(self._extract_jsonl_snippets(rel, path))
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            snippets.extend(self._extract_snippets(rel, text))
        return self.cluster(snippets)

    def cluster(self, snippets: Iterable[FindingSnippet]) -> list[RuleFamilyCandidate]:
        buckets: dict[str, RuleFamilyCandidate] = {}
        for snippet in snippets:
            for family in self._FAMILIES:
                if self._matches_family(snippet.text, family["patterns"]):  # type: ignore[arg-type]
                    family_id = family["id"]  # type: ignore[index]
                    bucket = buckets.setdefault(
                        family_id,
                        RuleFamilyCandidate(
                            family_id=family_id,
                            label=family["label"],  # type: ignore[index]
                            required_action=family["required_action"],  # type: ignore[index]
                            trigger_hint=family["trigger_hint"],  # type: ignore[index]
                            check_hint=family["check_hint"],  # type: ignore[index]
                        ),
                    )
                    bucket.matches.append(
                        FailureFamilyMatch(
                            family_id=family_id,
                            path=snippet.path,
                            text=snippet.text[:220],
                        )
                    )
        candidates = sorted(
            buckets.values(),
            key=lambda item: (-item.recurrence, -item.raw_match_count, item.family_id),
        )
        return candidates

    def _extract_snippets(self, rel_path: str, text: str) -> list[FindingSnippet]:
        snippets: list[FindingSnippet] = []
        for match in DESCRIPTION_RE.finditer(text):
            body = " ".join(match.group(1).split())
            if body:
                snippets.append(FindingSnippet(path=rel_path, text=body))
        if snippets:
            return snippets
        # Fallback for logs/docs that are not structured review markdown.
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        for line in lines[:40]:
            if len(line) >= 40:
                snippets.append(FindingSnippet(path=rel_path, text=line))
        return snippets

    def _extract_jsonl_snippets(self, rel_path: str, path: Path) -> list[FindingSnippet]:
        snippets: list[FindingSnippet] = []
        try:
            with path.open(encoding="utf-8") as handle:
                for raw_line in handle:
                    line = raw_line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(record, dict):
                        continue
                    snippets.extend(
                        self._extract_jsonl_record_snippets(rel_path, path.name, record)
                    )
        except OSError:
            return []
        return snippets

    def _extract_jsonl_record_snippets(
        self, rel_path: str, filename: str, record: dict
    ) -> list[FindingSnippet]:
        snippets: list[FindingSnippet] = []
        if UUID_JSONL_RE.match(filename):
            snippets.extend(self._extract_claude_session_snippets(rel_path, record))
        if filename == "claude-response.stream.jsonl":
            snippets.extend(self._extract_stream_snippets(rel_path, record))
        if filename == "hook-events.jsonl":
            snippets.extend(self._extract_hook_event_snippets(rel_path, record))
        if filename == "hook-errors.jsonl":
            snippets.extend(self._extract_hook_error_snippets(rel_path, record))
        if filename == "fanout-status.jsonl":
            snippets.extend(self._extract_fanout_status_snippets(rel_path, record))
        return snippets

    def _extract_claude_session_snippets(self, rel_path: str, record: dict) -> list[FindingSnippet]:
        snippets: list[FindingSnippet] = []
        record_type = record.get("type")
        message = record.get("message")
        if record_type in {"assistant", "user"} and isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                if record_type == "assistant" and self._looks_like_signal(content):
                    snippets.append(FindingSnippet(path=rel_path, text=content.strip()))
            elif isinstance(content, list):
                snippets.extend(self._extract_message_block_snippets(rel_path, content))

        tool_result = record.get("toolUseResult")
        if isinstance(tool_result, dict):
            snippets.extend(self._extract_tool_use_result_snippets(rel_path, tool_result))
        return snippets

    def _extract_message_block_snippets(
        self, rel_path: str, content: list[object]
    ) -> list[FindingSnippet]:
        snippets: list[FindingSnippet] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            block_type = block.get("type")
            if block_type == "tool_use":
                name = block.get("name", "")
                raw_input = block.get("input")
                rendered = (
                    json.dumps(raw_input, ensure_ascii=False)
                    if isinstance(raw_input, dict)
                    else str(raw_input)
                )
                if self._looks_like_signal(rendered):
                    snippets.append(
                        FindingSnippet(path=rel_path, text=f"tool_use {name}: {rendered}")
                    )
            elif block_type == "tool_result":
                content_text = self._tool_result_text(block.get("content"))
                is_error = bool(block.get("is_error"))
                if is_error or self._looks_like_signal(content_text):
                    prefix = "tool_result error" if is_error else "tool_result"
                    snippets.append(FindingSnippet(path=rel_path, text=f"{prefix}: {content_text}"))
            elif block_type == "text":
                text = block.get("text", "")
                if isinstance(text, str) and self._looks_like_signal(text):
                    snippets.append(FindingSnippet(path=rel_path, text=text.strip()))
        return snippets

    def _extract_tool_use_result_snippets(
        self, rel_path: str, tool_result: dict
    ) -> list[FindingSnippet]:
        snippets: list[FindingSnippet] = []
        stdout = tool_result.get("stdout", "")
        stderr = tool_result.get("stderr", "")
        exit_code = tool_result.get("exitCode")
        interrupted = tool_result.get("interrupted")

        fields: list[str] = []
        if isinstance(exit_code, int) and exit_code != 0:
            fields.append(f"exit_code={exit_code}")
        if interrupted:
            fields.append("interrupted=true")
        if isinstance(stderr, str) and stderr.strip():
            fields.append(f"stderr={stderr.strip()}")
        if isinstance(stdout, str) and self._looks_like_signal(stdout):
            fields.append(f"stdout={stdout.strip()}")
        if fields:
            snippets.append(FindingSnippet(path=rel_path, text="tool_result " + " ".join(fields)))
        return snippets

    def _extract_stream_snippets(self, rel_path: str, record: dict) -> list[FindingSnippet]:
        if record.get("ok") is False:
            return [
                FindingSnippet(
                    path=rel_path, text=f"stream error: {json.dumps(record, ensure_ascii=False)}"
                )
            ]
        status = record.get("status")
        if isinstance(status, str) and status.lower() in {
            "failed",
            "timeout",
            "timed_out",
            "blocked",
        }:
            return [FindingSnippet(path=rel_path, text=f"stream status={status}")]
        error = record.get("error")
        if isinstance(error, str) and error.strip():
            return [FindingSnippet(path=rel_path, text=f"stream error: {error.strip()}")]
        return []

    def _extract_hook_event_snippets(self, rel_path: str, record: dict) -> list[FindingSnippet]:
        event_type = record.get("event_type")
        if event_type not in {"block", "warn"}:
            return []
        tool_name = record.get("tool_name", "?")
        pattern = record.get("pattern_id", "-")
        summary = record.get("tool_input_summary", "")
        text = f"hook {event_type} tool={tool_name} pattern={pattern} input={summary}"
        return [FindingSnippet(path=rel_path, text=text)]

    def _extract_hook_error_snippets(self, rel_path: str, record: dict) -> list[FindingSnippet]:
        error = record.get("error") or record.get("message") or record.get("exception")
        if not isinstance(error, str) or not error.strip():
            return []
        return [FindingSnippet(path=rel_path, text=f"hook error: {error.strip()}")]

    def _extract_fanout_status_snippets(self, rel_path: str, record: dict) -> list[FindingSnippet]:
        event = record.get("event")
        status = record.get("status")
        if event not in {"failed", "timeout", "orphaned", "retrying"} and status not in {
            "failed",
            "timeout",
            "blocked",
        }:
            return []
        provider = record.get("provider", "?")
        task_id = record.get("task_id", "?")
        payload = json.dumps(record, ensure_ascii=False)
        return [
            FindingSnippet(
                path=rel_path, text=f"fanout provider={provider} task={task_id} {payload}"
            )
        ]

    def _tool_result_text(self, content: object) -> str:
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    text = item.get("text")
                    if isinstance(text, str) and text:
                        parts.append(text)
            return " ".join(parts).strip()
        if isinstance(content, str):
            return content.strip()
        return "" if content is None else str(content).strip()

    def _looks_like_signal(self, text: object) -> bool:
        if not isinstance(text, str):
            return False
        return bool(STRICT_SIGNAL_RE.search(text))

    def _matches_family(self, text: str, patterns: tuple[str, ...]) -> bool:
        text_lower = text.lower()
        return any(re.search(pattern, text_lower, re.IGNORECASE) for pattern in patterns)
