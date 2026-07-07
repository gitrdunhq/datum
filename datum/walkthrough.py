from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from datum.local_llm import run_phase
from datum.models.walkthrough_schema import WalkthroughSummary

logger = logging.getLogger(__name__)


class WalkthroughResult(Path):
    """A ``Path`` to the generated WALKTHROUGH.md that also carries a
    ``degraded`` flag.

    Subclassing ``Path`` means every existing caller/test that treats the
    return value as a plain path (``isinstance(x, Path)``, ``.exists()``,
    ``.read_text()``, string formatting) keeps working unchanged, while the
    CLI can additionally check ``.degraded`` to avoid printing a success
    checkmark when the file is a deterministic (non-LLM) fallback (#303).
    """

    __slots__ = ("_degraded",)

    @property
    def degraded(self) -> bool:
        return getattr(self, "_degraded", False)


def _as_result(output_path: Path, *, degraded: bool) -> WalkthroughResult:
    result = WalkthroughResult(str(output_path))
    result._degraded = degraded
    return result


def generate_walkthrough(epic_dir: Path) -> WalkthroughResult:
    output_path = epic_dir / "WALKTHROUGH.md"

    spec_text = (
        (epic_dir / "SPEC.md").read_text() if (epic_dir / "SPEC.md").exists() else ""
    )
    tasks_text = (
        (epic_dir / "TASKS.md").read_text() if (epic_dir / "TASKS.md").exists() else ""
    )

    try:
        diff_proc = subprocess.run(
            ["git", "diff", "main..HEAD"], capture_output=True, text=True
        )
        # returncode 0 = no diff, 1 = differences found (normal), 2 = error
        diff_text = diff_proc.stdout if diff_proc.returncode != 2 else ""
    except Exception:
        diff_text = ""

    prompt = f"SPEC:\n{spec_text}\n\nTASKS:\n{tasks_text}\n\nDIFF:\n{diff_text}"

    try:
        result = run_phase("sidecar_docs", prompt, schema=WalkthroughSummary)

        if result.get("escalated"):
            raise ValueError(f"LLM escalated: {result.get('reason', 'unknown')}")

        # structured() returns {"data": dict, ...} when schema= is passed
        data = result.get("result", {}).get("data")
        if not data:
            raise ValueError("Empty or missing 'data' in structured output")

        summary = WalkthroughSummary(**data)
        _write_walkthrough(output_path, summary)
        return _as_result(output_path, degraded=False)

    except Exception as exc:
        logger.warning("generate_walkthrough: LLM failed (%s), writing fallback", exc)
        _write_fallback(output_path)
        return _as_result(output_path, degraded=True)


def _write_walkthrough(path: Path, summary: WalkthroughSummary) -> None:
    lines = ["# Walkthrough\n\n"]
    lines.append(f"## Summary of Changes\n\n{summary.summary}\n\n")
    lines.append("## Implementation Lanes\n\n")
    lines.extend(f"- {lane}\n" for lane in summary.lanes)
    lines.append("\n## Files Touched\n\n")
    lines.extend(f"- {f}\n" for f in summary.files_touched)
    lines.append("\n## Key Decisions\n\n")
    lines.extend(f"- {d}\n" for d in summary.key_decisions)
    lines.append("\n## Exclusions\n\n")
    lines.extend(f"- {e}\n" for e in summary.excluded)
    path.write_text("".join(lines))


def _write_fallback(path: Path) -> None:
    """Write a deterministic, git-derived fallback when the LLM call fails.

    Rather than an empty stub, build real content from `git log`/`git diff`
    against main — the same data sources this module already gathers for the
    LLM prompt (`diff_text` above) — so the file is genuinely useful instead
    of misleadingly empty (#303).
    """
    commits = _git_lines(["log", "--oneline", "main..HEAD"])
    files_touched = _git_lines(["diff", "--name-only", "main..HEAD"])

    lines = ["# Walkthrough\n\n"]
    lines.append("## Summary of Changes\n\n")
    if commits:
        lines.append(
            "(deterministic fallback — LLM unavailable; summary derived "
            f"from {len(commits)} commit(s) on this branch)\n\n"
        )
    else:
        lines.append(
            "(deterministic fallback — LLM unavailable; no commits found "
            "relative to main)\n\n"
        )

    lines.append("## Implementation Lanes\n\n")
    if commits:
        lines.extend(f"- {line}\n" for line in commits)
    else:
        lines.append("- (no commits found relative to main)\n")

    lines.append("\n## Files Touched\n\n")
    if files_touched:
        lines.extend(f"- {f}\n" for f in files_touched)
    else:
        lines.append("- (check git diff manually)\n")

    path.write_text("".join(lines))


def _git_lines(args: list[str]) -> list[str]:
    """Run a git command and return its stdout as a list of non-empty lines."""
    try:
        proc = subprocess.run(["git", *args], capture_output=True, text=True)
        if proc.returncode not in (0, 1):
            return []
        return [line for line in proc.stdout.splitlines() if line.strip()]
    except Exception:
        return []
