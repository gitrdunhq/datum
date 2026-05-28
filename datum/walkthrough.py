from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from datum.local_llm import run_phase
from datum.models.walkthrough_schema import WalkthroughSummary

logger = logging.getLogger(__name__)


def generate_walkthrough(epic_dir: Path) -> Path:
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
        return output_path

    except Exception as exc:
        logger.warning("generate_walkthrough: LLM failed (%s), writing fallback", exc)
        _write_fallback(output_path)
        return output_path


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
    path.write_text(
        "# Walkthrough\n\n"
        "## Summary of Changes\n\n"
        "(deterministic fallback — LLM unavailable)\n\n"
        "## Files Touched\n\n"
        "(check git diff manually)"
    )
