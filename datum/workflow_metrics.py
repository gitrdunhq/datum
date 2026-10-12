"""``datum metrics import-workflow``: per-call metrics for hosted runs.

On the hosted path (Claude Code's Workflow tool) nothing writes
.datum/runs/<run>/metrics.jsonl; token usage lives only in the workflow's
transcript directory: journal.jsonl (one ``started`` line per subagent with
its label, a ``result`` line when it finished) and agent-<id>.jsonl (the
subagent's turns, each assistant turn carrying ``message.usage``). This
module turns each subagent into one metrics.jsonl line in the runner's key
order (skills/src/runtime/metrics.ts), so the closeout token collector reads
hosted and local runs the same way. Closeout follow-up, run 20261012-150046.

prompt_tokens counts every input token the subagent was billed for
(uncached + cache writes + cache reads, summed over its turns);
cached_tokens is the cache-read part. Prefill, decode and queue timings are
not in the transcripts and are written as 0.

Idempotent: imported agent ids are kept in metrics-imported.json next to
metrics.jsonl and skipped on the next import.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


class WorkflowImportError(Exception):
    """The directory is not a workflow transcript directory."""


def _ts(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except (AttributeError, ValueError):
        return None


def _read_jsonl(path: Path) -> list[dict]:
    rows = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def _agent_line(
    run_id: str, agent_id: str, label: str, wf_dir: Path, finished: bool
) -> dict:
    meta_path = wf_dir / f"agent-{agent_id}.meta.json"
    agent_type = ""
    if meta_path.is_file():
        try:
            agent_type = str(json.loads(meta_path.read_text()).get("agentType") or "")
        except (json.JSONDecodeError, OSError):
            agent_type = ""
    # The transcript writes one line per content block of a message, each
    # repeating the message's usage; output_tokens is final only on the last
    # one. Count each message id once, from its last line.
    usage_by_message: dict[str, dict] = {}
    model = ""
    first = last = None
    transcript = wf_dir / f"agent-{agent_id}.jsonl"
    for n, row in enumerate(_read_jsonl(transcript) if transcript.is_file() else []):
        if row.get("type") != "assistant":
            continue
        message = row.get("message") or {}
        usage_by_message[str(message.get("id") or f"line-{n}")] = message.get("usage") or {}
        model = message.get("model") or model
        when = _ts(row.get("timestamp", ""))
        if when is not None:
            first = when if first is None else min(first, when)
            last = when if last is None else max(last, when)
    prompt = completion = cached = 0
    for usage in usage_by_message.values():
        prompt += (
            int(usage.get("input_tokens") or 0)
            + int(usage.get("cache_creation_input_tokens") or 0)
            + int(usage.get("cache_read_input_tokens") or 0)
        )
        cached += int(usage.get("cache_read_input_tokens") or 0)
        completion += int(usage.get("output_tokens") or 0)
    wall_ms = int((last - first).total_seconds() * 1000) if first and last else 0
    return {
        "ts": (
            first.isoformat(timespec="milliseconds").replace("+00:00", "Z")
            if first
            else ""
        ),
        "run_id": run_id,
        "label": label,
        "agent_type": agent_type,
        "model": model,
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "cached_tokens": cached,
        "prefill_ms": 0,
        "decode_ms": 0,
        "queue_wait_ms": 0,
        "wall_ms": wall_ms,
        "attempt": 1,
        "outcome": "ok" if finished else "error",
    }


def import_workflow_dirs(run_id: str, dirs: list[Path], repo_root: Path) -> dict:
    """Append one metrics line per not-yet-imported subagent; return counts."""
    for d in dirs:
        if not (d / "journal.jsonl").is_file():
            raise WorkflowImportError(
                f"workflow_journal_missing: {d / 'journal.jsonl'}"
            )
    run_dir = repo_root / ".datum" / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    seen_path = run_dir / "metrics-imported.json"
    seen: set[str] = set()
    if seen_path.is_file():
        try:
            seen = set(json.loads(seen_path.read_text()))
        except (json.JSONDecodeError, OSError, TypeError):
            seen = set()
    imported = skipped = 0
    lines: list[str] = []
    for d in dirs:
        started: dict[str, str] = {}
        finished: set[str] = set()
        for row in _read_jsonl(d / "journal.jsonl"):
            agent_id = row.get("agentId")
            if not isinstance(agent_id, str):
                continue
            if row.get("type") == "started":
                started.setdefault(agent_id, str(row.get("label") or ""))
            elif row.get("type") == "result":
                finished.add(agent_id)
        for agent_id, label in started.items():
            key = f"{d.name}/{agent_id}"
            if key in seen:
                skipped += 1
                continue
            lines.append(
                json.dumps(
                    _agent_line(run_id, agent_id, label, d, agent_id in finished)
                )
            )
            seen.add(key)
            imported += 1
    if lines:
        with (run_dir / "metrics.jsonl").open("a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        seen_path.write_text(json.dumps(sorted(seen), indent=2) + "\n")
    return {"ok": True, "imported": imported, "skipped": skipped}
