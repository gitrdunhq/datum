#!/usr/bin/env python3
"""Render the claude-skills audit (JSON records from the audit workflow) to markdown.

Usage: uv run python scripts/render_skills_audit.py RUN_ID INPUT.json [INPUT2.json ...]

Deterministic: records are merged by skill name (later inputs win), ranked by
recommendation, then value descending, then cost ascending, then name. Writes
docs/research/claude-skills-audit-<RUN_ID>.md and the merged JSON beside it.
Never overwrites an existing run's files.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REC_ORDER = {"adopt_now": 0, "adopt_later": 1, "already_covered": 2, "skip": 3}
STATUS_LABEL = {
    "has": "has",
    "partial": "partial",
    "missing": "missing",
    "not_applicable": "n/a",
}


def load(paths: list[str]) -> dict[str, dict]:
    merged: dict[str, dict] = {}
    for p in paths:
        data = json.loads(Path(p).read_text())
        for r in data.get("results", []):
            if r and r.get("skill"):
                merged[r["skill"]] = r
    return merged


def rank_key(r: dict) -> tuple:
    return (
        REC_ORDER.get(r.get("recommendation", "skip"), 9),
        -int(r.get("value", 0)),
        int(r.get("cost", 9)),
        r["skill"],
    )


def cell(s: object) -> str:
    return str(s).replace("|", "\\|").replace("\n", " ")


def render(run_id: str, records: list[dict], audit_dir: str) -> str:
    out = [
        "# claude-skills audit — what datum should learn from randommonicle/claude-skills",
        "",
        f"run_id: {run_id}  ",
        f"audit_dir: {audit_dir}  ",
        f"records: {len(records)} of 43 skills  ",
        "source: https://github.com/randommonicle/claude-skills (43 guardrail skills, four layers: hooks / norms / hubs / leaves)  ",
        "method: one agent per skill (Sonnet; four re-run on Opus after structured-output failures), each reading the skill's SKILL.md and datum's docs/FLOW.md, returning one typed record; ranked and rendered by this script, no LLM in the rendering.",
        "",
        "## Ranking",
        "",
        "| # | Skill | Rec | datum | Value | Cost | Where |",
        "|---|---|---|---|---|---|---|",
    ]
    for i, r in enumerate(records, 1):
        out.append(
            f"| {i} | `{r['skill']}` | {r.get('recommendation','')} | {STATUS_LABEL.get(r.get('datum_status',''), r.get('datum_status',''))} | {r.get('value','')} | {r.get('cost','')} | {cell(r.get('where',''))} |"
        )
    counts: dict[str, int] = {}
    for r in records:
        counts[r.get("recommendation", "?")] = (
            counts.get(r.get("recommendation", "?"), 0) + 1
        )
    out += ["", "## Counts", ""]
    for k in ("adopt_now", "adopt_later", "already_covered", "skip"):
        out.append(f"- {k}: {counts.get(k, 0)}")
    out += ["", "## Records", ""]
    for r in records:
        out += [
            f"### {r['skill']} — {r.get('recommendation','')} (value {r.get('value','')}, cost {r.get('cost','')}, datum: {STATUS_LABEL.get(r.get('datum_status',''), r.get('datum_status',''))})",
            "",
            f"**What it prescribes.** {r.get('summary','')}",
            "",
            f"**Origin.** {r.get('origin_incident','')}",
            "",
            f"**datum evidence.** {r.get('datum_evidence','')}",
            "",
            f"**Proposal.** {r.get('proposal','')}",
            "",
            f"**Where.** {r.get('where','')}",
            "",
            f"**Rationale.** {r.get('rationale','')}",
            "",
        ]
    return "\n".join(out) + "\n"


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    run_id, inputs = sys.argv[1], sys.argv[2:]
    merged = load(inputs)
    records = sorted(merged.values(), key=rank_key)
    out_dir = Path("docs/research")
    out_dir.mkdir(parents=True, exist_ok=True)
    md = out_dir / f"claude-skills-audit-{run_id}.md"
    js = out_dir / f"claude-skills-audit-{run_id}.json"
    for p in (md, js):
        if p.exists():
            print(f"refusing to overwrite {p}", file=sys.stderr)
            sys.exit(1)
    audit_dir = f".temp/skills-audit (run {run_id})"
    md.write_text(render(run_id, records, audit_dir))
    js.write_text(
        json.dumps(
            {"run_id": run_id, "audit_dir": audit_dir, "results": records}, indent=1
        )
        + "\n"
    )
    print(f"{md} ({len(records)} records)")


if __name__ == "__main__":
    main()
