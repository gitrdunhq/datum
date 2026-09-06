#!/usr/bin/env python3
"""
Gate validator for DATUM phases. Enforces completion criteria before phase transitions.

Usage:
  python3 scripts/gate.py <phase> [--yolo] [--skip-human]
  python3 scripts/gate.py validate-packets

Exit codes:
  0 — gate passed
  1 — gate failed (surfaceable issue, retry possible)
  2 — hard stop (never retried, never bypassed)
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

from datum.integration_invariants import (
    IntegrationInvariantError,
    derive_integration_lanes,
    has_integration_invariants_section,
    parse_integration_invariants,
    unknown_covered_tasks,
)
from datum.path_utils import assets_dir, existing_review_packets_dir, templates_dir


def _contracts():
    from datum.contracts import validate_payload, validate_value

    return validate_payload, validate_value


def load_config() -> dict:
    import os

    project_dir = os.environ.get("DATUM_PROJECT_DIR", ".")
    project_config = Path(project_dir) / ".datum/config.toml"
    local_config = Path(".datum/config.toml")
    default_path = assets_dir() / "config.toml.default"

    for path in (project_config, local_config, default_path):
        if path.exists():
            try:
                import tomllib  # type: ignore[import]
            except ImportError:
                try:
                    import tomli as tomllib  # type: ignore[import]
                except ImportError:
                    return {}
            with path.open("rb") as f:
                return tomllib.load(f)
    return {}


def gate_policy(config: dict, gate_name: str) -> str:
    return config.get("gates", {}).get(gate_name, "skippable_if_complete")


def fail(message: str, hard: bool = False) -> None:
    print(json.dumps({"passed": False, "hard_stop": hard, "message": message}))
    sys.exit(2 if hard else 1)


def pass_gate(message: str = "gate passed") -> None:
    print(json.dumps({"passed": True, "message": message}))
    sys.exit(0)


# ── Helper functions ────────────────────────────────────────────────────────


def _transitive_closure(deps: dict[str, set[str]]) -> dict[str, set[str]]:
    """Expand each id's direct dependency set to include indirect deps.

    Mutates and returns `deps` in place. Used by gate_plan()'s file-overlap
    check for both units and tasks (#524 dogfooding) — a direct-only check
    false-fails whenever ordering between two lanes sharing a file is
    established through an intermediate lane (a -> b -> c) rather than a
    single direct edge, which is a normal pattern for lanes that touch the
    same core file across several sequential steps.
    """
    changed = True
    while changed:
        changed = False
        for _id, d in deps.items():
            old_len = len(d)
            for dep in list(d):
                if dep in deps:
                    d.update(deps[dep])
            if len(d) > old_len:
                changed = True
    return deps


def resolve_epic_dir() -> Path:
    """Return docs/epics/<branch>/ based on current git branch."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        branch = result.stdout.strip()
        if result.returncode != 0 or not branch:
            branch = "unknown"
    except (subprocess.TimeoutExpired, FileNotFoundError):
        branch = "unknown"
    return Path(f"docs/epics/{branch}")


def resolve_artifact(name: str) -> Path:
    """SSOT for artifact path resolution: prefers newest copy between epic dir and root."""
    import sys

    epic_path = resolve_epic_dir() / name
    root_path = Path(name)

    if epic_path.exists() and root_path.exists():
        if root_path.stat().st_mtime > epic_path.stat().st_mtime:
            print(
                f"⚠️ Warning: root {name} is newer than epic-dir copy. Using root.",
                file=sys.stderr,
            )
            return root_path
        return epic_path

    if epic_path.exists():
        return epic_path
    if root_path.exists():
        return root_path
    return epic_path


def check_questions_answered(content: str) -> list[str]:
    """Check all [Answer]: lines in content for non-empty answers.

    Returns a list of error strings for unanswered questions.
    Peeks ahead to detect answers on lines following [Answer]:
    """
    errors: list[str] = []
    lines = content.split("\n")
    current_question: str | None = None

    for i in range(len(lines)):
        line = lines[i]
        # Track current question header (### Q1: ...)
        q_match = re.match(r"^###\s+(Q\d+):", line)
        if q_match:
            current_question = q_match.group(1)
            continue

        # Check [Answer]: lines
        a_match = re.match(r"^\[Answer\]:\s*(.*)", line)
        if a_match:
            answer_text = a_match.group(1).strip()
            if not answer_text and current_question:
                # Peek ahead to next non-empty, non-header line
                found = False
                for j in range(i + 1, len(lines)):
                    next_line = lines[j]
                    stripped = next_line.strip()
                    if stripped == "":
                        continue
                    # If next non-empty line is a header, answer is missing
                    if re.match(r"^###\s+", next_line):
                        errors.append(
                            f"{current_question}: unanswered (empty [Answer]:)"
                        )
                        found = True
                        break
                    else:
                        # Answer found on following line
                        found = True
                        break
                if not found:
                    # No content after [Answer]:, treat as unanswered
                    errors.append(f"{current_question}: unanswered (empty [Answer]:)")
            current_question = None

    return errors


def answered_question_ids(content: str) -> list[str]:
    """Return the Q<N> ids whose block has a non-empty [Answer]: line.

    Mirrors check_questions_answered's block-tracking and peek-ahead logic,
    inverted: a question is "answered" exactly when check_questions_answered
    would NOT emit an "unanswered" error for it.
    """
    answered: list[str] = []
    lines = content.split("\n")
    current_question: str | None = None

    for i in range(len(lines)):
        line = lines[i]
        q_match = re.match(r"^###\s+(Q\d+):", line)
        if q_match:
            current_question = q_match.group(1)
            continue

        a_match = re.match(r"^\[Answer\]:\s*(.*)", line)
        if a_match:
            answer_text = a_match.group(1).strip()
            is_answered = bool(answer_text)
            if not is_answered and current_question:
                for j in range(i + 1, len(lines)):
                    next_line = lines[j]
                    stripped = next_line.strip()
                    if stripped == "":
                        continue
                    is_answered = not re.match(r"^###\s+", next_line)
                    break
            if is_answered and current_question and current_question not in answered:
                answered.append(current_question)
            current_question = None

    return answered


def check_open_questions(spec_content: str) -> list[str]:
    """Scan the Open Questions section body for unresolved markers (#57).

    The '[ ]'/TBD/TODO scan is scoped to the Open Questions section only, so
    checkbox-style acceptance criteria elsewhere in the SPEC don't trip the
    refine gate. Returns a list of error strings.
    """
    heading = re.search(
        r"^(#{1,6})\s+(?:\d+\.\s+)?Open Questions\b.*$",
        spec_content,
        re.MULTILINE | re.IGNORECASE,
    )
    if not heading:
        return []

    level = len(heading.group(1))
    body_start = heading.end()
    # Section ends at the next heading of the same or higher level
    next_heading = re.search(
        rf"^#{{1,{level}}}\s", spec_content[body_start:], re.MULTILINE
    )
    body = (
        spec_content[body_start : body_start + next_heading.start()]
        if next_heading
        else spec_content[body_start:]
    )

    if "[ ]" in body or "TBD" in body or "TODO" in body:
        return ["SPEC.md Open Questions section has unresolved items ([ ]/TBD/TODO)"]
    return []


# Ported from the spec-write skill's scan_terms.py / banned_terms.json —
# a criterion using an unmeasurable term is unreviewable regardless of
# wording; conditional terms are fine once a measure is attached.
_BANNED_TERMS_BLOCKING: dict[str, list[str]] = {
    "subjective": [
        "appropriate",
        "adequate",
        "sufficient",
        "reasonable",
        "user-friendly",
        "user friendly",
        "clean",
        "robust",
        "efficient",
        "simple",
        "intuitive",
        "seamless",
        "proper",
    ],
    "open_ended": [
        "etc.",
        "etc",
        "and so on",
        "including but not limited to",
        "as needed",
        "if required",
        "where applicable",
        "as appropriate",
    ],
    "superlative": [
        "best",
        "optimal",
        "maximum",
        "better",
        "faster",
        "improved",
        "minimal",
        "at least as good as",
    ],
    "loophole": [
        "if possible",
        "as far as practical",
        "when convenient",
        "should ideally",
    ],
}
_BANNED_TERMS_CONDITIONAL: dict[str, list[str]] = {
    "non_verifiable": [
        "fast",
        "quick",
        "performant",
        "scalable",
        "secure",
        "reliable",
        "maintainable",
    ],
}
_MEASURE_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"\b\d+(\.\d+)?\s*(ms|milliseconds?|s|seconds?|m|minutes?|h|hours?|days?|%|percent|bytes?|kb|mb|gb|requests?|rps|qps|items?|rows?|calls?|characters?|tokens?)\b",
        r"\bas measured by\b",
        r"\bat most\b",
        r"\bno more than\b",
        r"\bwithin\b\s+\d+",
    ]
]


def _term_re(term: str) -> re.Pattern:
    if term.endswith("."):
        return re.compile(r"(?<!\w)" + re.escape(term), re.IGNORECASE)
    return re.compile(
        r"\b" + re.escape(term).replace(r"\ ", r"\s+") + r"\b", re.IGNORECASE
    )


_BLOCKING_PATTERNS = [
    (cat, term, _term_re(term))
    for cat, terms in _BANNED_TERMS_BLOCKING.items()
    for term in terms
]
_CONDITIONAL_PATTERNS = [
    (cat, term, _term_re(term))
    for cat, terms in _BANNED_TERMS_CONDITIONAL.items()
    for term in terms
]


def _has_section(content: str, heading_name: str) -> bool:
    """True when a markdown heading (any level) names the section — not when
    the words merely appear in prose (Python core review)."""
    return (
        re.search(
            rf"^#{{1,6}}\s+(?:\d+\.\s+)?{re.escape(heading_name)}\b",
            content,
            re.MULTILINE | re.IGNORECASE,
        )
        is not None
    )


_HIGH_OR_CRITICAL_RE = re.compile(
    r"(?:severity|sev|priority)\s*:?\s*\**\s*(?:high|critical)\b"
    r"|\*\*(?:high|critical)\*\*"
    r"|\|\s*(?:high|critical)\s*\|",
    re.IGNORECASE,
)


# `- ACCEPT <token> [(note)]: <reason>` or `- DEFER <token> [(note)] -> <epic>: <reason>`.
# <token> is the row's content key (8 hex, stable across re-reviews) or, for
# a report without a Key column, its id.
_ACCEPT_LINE_RE = re.compile(
    r"^\s*[-*]?\s*(ACCEPT|DEFER)\s+([A-Za-z0-9]+(?:-\d+)?)\s*(?:\([^)]*\))?\s*"
    r"(?:->\s*(\S+)\s*)?:\s*(.*?)\s*$"
)
_FINDING_ROW_RE = re.compile(
    r"^\|\s*([A-Za-z]+-\d+)\s*\|\s*\**\s*(critical|high|medium|low|info)\b",
    re.IGNORECASE,
)
_KEY_RE = re.compile(r"^[0-9a-f]{8}$", re.IGNORECASE)


DEFAULT_REVIEW_MAX_ITERATIONS = 3


def _review_max_iterations(config: dict) -> int:
    """review_max_iterations from .datum/config.json, default 3. Anything
    that is not a positive integer keeps the default (never a silent 0 that
    would hard-stop every review)."""
    raw = config.get("review_max_iterations") if isinstance(config, dict) else None
    if isinstance(raw, bool):
        return DEFAULT_REVIEW_MAX_ITERATIONS
    try:
        value = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return DEFAULT_REVIEW_MAX_ITERATIONS
    return value if value >= 1 else DEFAULT_REVIEW_MAX_ITERATIONS


def _report_sha(content: str) -> str:
    import hashlib

    return hashlib.sha1(content.encode("utf-8")).hexdigest()


def _review_iterations_path(report_path: Path) -> Path:
    """Per-epic record of the distinct blocked reports seen:
    .datum/epics/<slug>/review-iterations.json (the pipeline-state slug)."""
    from datum.pipeline_state import epic_state_slug

    slug = epic_state_slug(str(report_path.parent).replace("docs/epics/", "", 1))
    return Path(".datum") / "epics" / (slug or "unknown") / "review-iterations.json"


def _blocked_reports_seen(report_path: Path) -> set[str]:
    path = _review_iterations_path(report_path)
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return set()
    seen = data.get("seen") if isinstance(data, dict) else None
    return {str(s) for s in seen} if isinstance(seen, list) else set()


def _record_blocked_report(report_path: Path, seen: set[str]) -> None:
    path = _review_iterations_path(report_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"seen": sorted(seen)}, indent=2) + "\n")


def accepted_review_findings(response_path: Path) -> dict[str, str]:
    """Token (key or id, upper-cased) → reason from REVIEW-RESPONSE.md. A
    DEFER counts as an accept whose reason names the target epic. A line
    with no reason is not an accept: the whole point is a recorded,
    reasoned operator decision."""
    if not response_path.exists():
        return {}
    accepted: dict[str, str] = {}
    for line in response_path.read_text().splitlines():
        match = _ACCEPT_LINE_RE.match(line)
        if not match or not match.group(4).strip():
            continue
        verb, token, target, reason = match.groups()
        if verb == "DEFER" and target:
            reason = f"deferred to {target}: {reason.strip()}"
        accepted[token.upper()] = reason.strip()
    return accepted


_DECISION_LINE_RE = re.compile(
    r"^\s*[-*]?\s*(ACCEPT|DEFER)\s+([A-Za-z0-9]+(?:-\d+)?)\s*"
    r"(?:\(\s*([A-Za-z]+-\d+)\s+(\S+?):(\d+)\s*\))?\s*(?:->\s*(\S+)\s*)?:\s*(.*?)\s*$"
)


def review_decisions(response_path: Path) -> list[dict[str, str]]:
    """Every reasoned ACCEPT/DEFER line with what it was recorded against:
    {token, verb, id, file, line, reason}. `datum review-accept` writes the
    `(<ID> <file>:<line>)` note, which is what lets a decision outlive a
    reworded re-finding (caliper BUG R): the key hashes the text, the note
    names the place."""
    if not response_path.exists():
        return []
    out: list[dict[str, str]] = []
    for line in response_path.read_text().splitlines():
        m = _DECISION_LINE_RE.match(line)
        if not m or not m.group(7).strip():
            continue
        verb, token, fid, path, lineno, target, reason = m.groups()
        out.append(
            {
                "token": token.upper(),
                "verb": verb,
                "id": (fid or "").upper(),
                "file": path or "",
                "line": lineno or "",
                "target": target or "",
                "reason": reason.strip(),
            }
        )
    return out


def _lens_of(finding_id: str) -> str:
    return finding_id.split("-", 1)[0].upper() if finding_id else ""


_REQUIREMENT_ID_RE = re.compile(
    r"\b(R\d+(?:\.\d+)*|(?:SAFE|LIVE|INV|BOUND|IDEM|ORD|ISOL|PERF|SEC|OBS|COMPAT)-\d+)\b"
)


def _requirement_ids(text: str) -> set[str]:
    """Requirement / property ids cited in free text (R2.1, INV-003)."""
    return {m.group(1).upper() for m in _REQUIREMENT_ID_RE.finditer(text or "")}


def review_report_rows(content: str) -> list[dict[str, str]]:
    """The report's finding rows as {id, severity, file, line, key} in report
    order. `key` is '' for a report without a Key column (pre-key reports)."""
    header_cols: list[str] = []
    rows: list[dict[str, str]] = []
    for raw in content.splitlines():
        line = raw.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if not header_cols and cells and cells[0].lower() == "id":
            header_cols = [c.lower() for c in cells]
            continue
        match = _FINDING_ROW_RE.match(line)
        if not match:
            continue

        def cell(name: str) -> str:
            if name in header_cols and header_cols.index(name) < len(cells):
                return cells[header_cols.index(name)]
            return ""

        key = cell("key")
        rows.append(
            {
                "id": match.group(1).upper(),
                "severity": match.group(2).lower(),
                "file": cell("file"),
                "line": cell("line"),
                "description": cell("description"),
                "key": key.lower() if _KEY_RE.match(key) else "",
            }
        )
    return rows


def _blocking_review_findings(
    content: str,
    accepted: dict[str, str],
    decisions: list[dict[str, str]] | None = None,
) -> tuple[list[str], list[str], dict[str, str]]:
    """(blocking labels, ignored accept tokens, {row key: prior decision
    token} for rows cleared by place rather than key). A high/critical row
    is cleared by an accept of its key; failing that, by a recorded decision
    whose note names the same lens, file and line — the key hashes the
    finding's text, and a reviewer that restates the same finding produces
    a new key (caliper BUG R). An id accept clears a row only when the
    report carries no keys — ids are renumbered every review, so on a keyed
    report it is named as ignored rather than silently binding to whatever
    row wears that id now. A report with no id-labelled rows falls back to
    the whole-content severity scan ("(unlabelled)")."""
    rows = review_report_rows(content)
    if not rows:
        blocked = _report_has_high_or_critical(content)
        return (["(unlabelled)"] if blocked else []), [], {}
    keyed = any(r["key"] for r in rows)
    placed = [d for d in (decisions or []) if d["file"] and d["line"]]
    blocking: list[str] = []
    matched: dict[str, str] = {}
    for r in rows:
        if r["severity"] not in ("high", "critical"):
            continue
        if r["key"] and r["key"].upper() in accepted:
            continue
        if not keyed and r["id"] in accepted:
            continue
        # The place is the identity: a decision recorded at the same file and
        # line matches whatever lens re-raises it (elonchesd epic-2: the perf
        # lens's scan came back under the architecture lens at the same
        # line). A shared requirement id (R2.1, INV-003) is named when both
        # cite it. A different line is a different finding.
        row_reqs = _requirement_ids(r.get("description", ""))
        prior = next(
            (d for d in placed if d["file"] == r["file"] and d["line"] == r["line"]),
            None,
        )
        if prior is not None and r["key"]:
            shared = sorted(row_reqs & _requirement_ids(prior["reason"]))
            rule = "file+line" + (f"+{shared[0]}" if shared else "")
            matched[r["key"]] = f"{prior['token']}|{rule}"
            continue
        blocking.append(f"{r['id']} [{r['key']}]" if r["key"] else r["id"])
    ignored: list[str] = []
    if keyed:
        ids = {r["id"] for r in rows}
        ignored = [t for t in accepted if t in ids]
    return blocking, ignored, matched


def _report_has_high_or_critical(content: str) -> bool:
    """Does REVIEW-REPORT.md carry a high/critical finding, however the
    reviewer spelled the severity (\"Severity: high\", \"Priority: High\",
    \"**critical**\", a table cell)? Four literal substrings missed the rest."""
    return _HIGH_OR_CRITICAL_RE.search(content) is not None


def _extract_section(spec_content: str, heading_name: str) -> str | None:
    """Return the body text of a '## <n>. <heading_name>' section, or None if absent."""
    heading = re.search(
        rf"^(#{{1,6}})\s+(?:\d+\.\s+)?{re.escape(heading_name)}\b.*$",
        spec_content,
        re.MULTILINE | re.IGNORECASE,
    )
    if not heading:
        return None
    level = len(heading.group(1))
    body_start = heading.end()
    next_heading = re.search(
        rf"^#{{1,{level}}}\s", spec_content[body_start:], re.MULTILINE
    )
    return (
        spec_content[body_start : body_start + next_heading.start()]
        if next_heading
        else spec_content[body_start:]
    )


def check_banned_terms(spec_content: str) -> list[str]:
    """Scan the Requirements section for unreviewable vague/subjective terms.

    Ported from the spec-write skill's scan_terms.py. Scoped to the
    Requirements section only, so prose elsewhere in the SPEC (Context,
    Summary) doesn't trip the refine gate. Returns a list of error strings.
    """
    body = _extract_section(spec_content, "Requirements")
    if not body:
        return []

    errors: list[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        has_measure = any(rx.search(stripped) for rx in _MEASURE_PATTERNS)
        for _cat, term, rx in _BLOCKING_PATTERNS:
            if rx.search(stripped):
                errors.append(
                    f"SPEC.md Requirements uses unreviewable term {term!r}: {stripped[:80]!r}"
                )
        if not has_measure:
            for _cat, term, rx in _CONDITIONAL_PATTERNS:
                if rx.search(stripped):
                    errors.append(
                        f"SPEC.md Requirements uses {term!r} with no stated measure: {stripped[:80]!r}"
                    )
    return errors


def check_assumption_audit(
    spec_content: str,
    questions_content: str | None,
    overconfidence_enabled: bool = True,
) -> tuple[list[str], list[str]]:
    """Validate the Assumption Audit section in a SPEC.

    Returns (errors, warnings).
    - errors: hard failures that block the gate
    - warnings: advisory messages (e.g. zero Refine questions)
    """
    errors: list[str] = []
    warnings: list[str] = []

    if not overconfidence_enabled:
        return errors, warnings

    # Check section exists (heading may carry a section number, e.g. "## 9. Assumption Audit")
    section_match = re.search(r"##\s+(?:\d+\.\s+)?Assumption Audit", spec_content)
    if not section_match:
        errors.append("SPEC.md missing '## Assumption Audit' section")
        return errors, warnings

    # Extract table rows from the Assumption Audit section
    section_start = section_match.start()
    section_text = spec_content[section_start:]
    # End at next ## heading or end of file
    next_section = re.search(r"\n## (?!Assumption Audit)", section_text)
    if next_section:
        section_text = section_text[: next_section.start()]

    # Build set of answered question IDs from questions_content
    answered_questions: set[str] = set()
    if questions_content:
        q_lines = questions_content.split("\n")
        current_q: str | None = None
        for q_line in q_lines:
            q_match = re.match(r"^###\s+(Q\d+):", q_line)
            if q_match:
                current_q = q_match.group(1)
                continue
            a_match = re.match(r"^\[Answer\]:\s*(.*)", q_line)
            if a_match and current_q:
                if a_match.group(1).strip():
                    answered_questions.add(current_q)
                current_q = None

    # Parse table rows (skip header and separator)
    table_rows = re.findall(r"^\|(.+)\|$", section_text, re.MULTILINE)
    data_rows = []
    for row in table_rows:
        cells = [c.strip() for c in row.split("|")]
        # Skip header row and separator row
        if (
            cells
            and cells[0] in ("#", "---", "")
            and (
                len(cells) < 2 or cells[1].startswith("---") or cells[1] == "Assumption"
            )
        ):
            continue
        if all(c.startswith("---") or c == "" for c in cells):
            continue
        data_rows.append(cells)

    for row in data_rows:
        # Cells: [#, Assumption, Justification, Status, Resolves]
        # (may have leading empty string from split)
        # Filter out empty strings from leading/trailing pipes
        cells = [c for c in row if c != ""]
        if len(cells) < 4:
            continue

        status = cells[3].strip().lower()
        resolves = cells[4].strip() if len(cells) > 4 else "n/a"

        if status in ("confirmed", "decided"):
            continue

        if status == "guess":
            # Resolves must reference an answered question. Any Q<N> in the
            # cell counts ("Q8 (partially)", "Q2 (related)" reference one;
            # elonchesd wf_251cf8a3-363 lost 20 minutes of planning to an
            # exact-match rule); 'n/a' with prose is the real violation.
            referenced = re.findall(r"\bQ\d+\b", resolves)
            if not referenced:
                errors.append(
                    f"Assumption {cells[0]}: status is 'guess' but Resolves "
                    f"is '{resolves}' — a guess must reference an answered "
                    f"Q<N>; fix the Assumption Audit table in SPEC.md"
                )
            else:
                unanswered = [q for q in referenced if q not in answered_questions]
                if unanswered:
                    errors.append(
                        f"Assumption {cells[0]}: status is 'guess', Resolves "
                        f"references {', '.join(unanswered)} but that question "
                        f"is unanswered (QUESTIONS.md)"
                    )

    # Check for zero Refine-section questions (warning, not error)
    if questions_content:
        has_refine_section = bool(
            re.search(r"^## Refine\b", questions_content, re.MULTILINE)
        )
        if has_refine_section:
            # Count questions under the Refine section
            refine_match = re.search(r"^## Refine\b.*", questions_content, re.MULTILINE)
            if refine_match:
                refine_start = refine_match.end()
                # Find next ## section
                next_sec = re.search(
                    r"^## (?!Refine)", questions_content[refine_start:], re.MULTILINE
                )
                refine_text = (
                    questions_content[refine_start : refine_start + next_sec.start()]
                    if next_sec
                    else questions_content[refine_start:]
                )
                refine_q_count = len(
                    re.findall(r"^### Q\d+:", refine_text, re.MULTILINE)
                )
                if refine_q_count == 0:
                    warnings.append("Zero clarifying questions in Refine section")
        else:
            warnings.append(
                "QUESTIONS.md has no Refine section (zero Refine questions)"
            )

    return errors, warnings


# ── Deterministic artifact scoring (issue #92) ──────────────────────────────


def _project_entries(root: Path) -> list[str]:
    """Top-level project dirs/files (non-hidden) for the grounding check."""
    try:
        return sorted(p.name for p in root.iterdir() if not p.name.startswith("."))
    except OSError:
        return []


def _git_commits_since(path: str) -> int | None:
    """rev-list count of commits since `path` was last touched; None if unknowable."""
    try:
        last = subprocess.run(
            ["git", "log", "-1", "--format=%H", "--", path],
            capture_output=True,
            text=True,
            timeout=10,
        )
        sha = last.stdout.strip()
        if last.returncode != 0 or not sha:
            return None
        count = subprocess.run(
            ["git", "rev-list", "--count", f"{sha}..HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if count.returncode != 0:
            return None
        return int(count.stdout.strip())
    except (subprocess.TimeoutExpired, FileNotFoundError, ValueError, OSError):
        return None


def score_context_quality(artifact: str = "SPEC.md") -> dict:
    """Score an artifact with the deterministic rubric (issue #92).

    Thin boundary wrapper: resolves the artifact, plugs real filesystem/git
    lookups into the pure datum.artifact_score module, returns the
    structured payload (per-check sub-scores + reasons) for the #79
    evaluator's structural half.
    """
    from datum.artifact_score import SCHEMA_VERSION, score_artifact

    path = resolve_artifact(artifact)
    if not path.exists():
        return {
            "schema_version": SCHEMA_VERSION,
            "artifact": str(path),
            "overall_score": 0.0,
            "verdict": "fail",
            "checks": [],
            "error": f"{artifact} not found",
        }

    result = score_artifact(
        path.read_text(),
        artifact_path=str(path),
        path_exists=lambda ref: Path(ref).exists(),
        project_entries=_project_entries(Path(".")),
        commits_since=_git_commits_since,
    )
    return result.to_dict()


def gate_score_context(config: dict, artifact: str) -> None:
    payload = score_context_quality(artifact)
    passed = "error" not in payload and payload["verdict"] in ("pass", "warn")
    print(
        json.dumps(
            {
                "passed": passed,
                "message": payload.get(
                    "error",
                    f"{artifact} context quality: {payload['verdict']} "
                    f"(score {payload['overall_score']:.2f})",
                ),
                "score": payload,
            }
        )
    )
    sys.exit(0 if passed else 1)


# ── Phase gate implementations ──────────────────────────────────────────────


def gate_refine(yolo: bool, config: dict) -> None:
    spec = resolve_artifact("SPEC.md")
    if not spec.exists():
        fail("SPEC.md not found")

    content = spec.read_text()

    required_sections = [
        "Summary",
        "Requirements",
        "Failure modes",
        "Non-functional",
        "Out of scope",
    ]
    missing = [s for s in required_sections if not _has_section(content, s)]
    if missing:
        fail(f"SPEC.md missing sections: {missing}")

    # Check for unresolved open questions (scoped to the section body, #57)
    oq_errors = check_open_questions(content)
    if oq_errors:
        fail(oq_errors[0])

    # spec-write integration: reject unreviewable vague/subjective terms in
    # acceptance criteria (e.g. "handles errors appropriately" can't be
    # checked against a diff; "responds within 200ms" can).
    term_errors = check_banned_terms(content)
    if term_errors:
        fail(term_errors[0])

    # Check QUESTIONS.md for unanswered entries
    questions_path = resolve_artifact("QUESTIONS.md")
    if questions_path.exists():
        q_errors = check_questions_answered(questions_path.read_text())
        if q_errors:
            fail(f"QUESTIONS.md has unanswered questions: {q_errors}")

    # Overconfidence: the Assumption Audit table is refine's own output, so
    # it is checked here, where a fix costs seconds. The plan gate re-checks
    # it, but a failure there arrives after every planning agent has run
    # (elonchesd wf_251cf8a3-363: 15 agents, 20 minutes, then this).
    overconfidence_enabled = config.get("gates", {}).get("overconfidence_check", True)
    audit_errors, audit_warnings = check_assumption_audit(
        content,
        questions_path.read_text() if questions_path.exists() else None,
        overconfidence_enabled,
    )
    for w in audit_warnings:
        print(f"⚠️ Warning: {w}", file=sys.stderr)
    if audit_errors:
        fail(f"Overconfidence gate failed: {audit_errors}")

    policy = gate_policy(config, "refine_human_review")
    if policy == "required" and not yolo:
        print(
            json.dumps(
                {
                    "passed": False,
                    "needs_human": True,
                    "message": "SPEC.md ready for human review. Re-run with --approve to continue.",
                    "artifact": "SPEC.md",
                }
            )
        )
        sys.exit(1)

    pass_gate("Refine gate passed")


_INT_LANE_PREFIX = "task-INT-"


def check_zero_lanes(lane_plan: dict) -> list[str]:
    """A lane-plan.json with zero lanes must fail the gate explicitly.

    Without this, set(topological_order) != lane_ids is False when both are
    empty, so the lane-validation loop in gate_plan() never runs and a
    trivial/no-op decomposition proceeds silently into Act with nothing to do.
    """
    if not lane_plan.get("lanes"):
        return ["lane-plan.json has zero lanes"]
    return []


def gate_plan(yolo: bool, config: dict) -> None:
    tasks_path = resolve_artifact("TASKS.md")
    lane_plan_path = resolve_artifact("lane-plan.json")

    if not tasks_path.exists():
        fail("TASKS.md not found")
    if not lane_plan_path.exists():
        fail("Missing lane-plan.json. Run datum lane-plan first.")

    # Validate lane-plan.json structure
    with lane_plan_path.open() as f:
        lane_plan = json.load(f)

    validate_payload, _validate_value = _contracts()
    schema_errors = validate_payload("lane-plan.schema.json", lane_plan_path)
    if schema_errors:
        fail(f"lane-plan.json schema validation failed: {schema_errors}", hard=True)

    zero_lane_errors = check_zero_lanes(lane_plan)
    if zero_lane_errors:
        fail(zero_lane_errors[0])

    lanes = lane_plan.get("lanes", {})
    lane_ids = set(lanes)
    topological_order = lane_plan.get("topological_order", [])
    if len(topological_order) != len(lane_ids) or set(topological_order) != lane_ids:
        fail("lane-plan.json topological_order does not match lanes")

    file_to_lanes: dict[str, list[str]] = {}
    for lid, lane in lanes.items():
        if "files" not in lane:
            fail(f"Lane {lid} missing 'files' field in lane-plan.json")
        if "red_note" not in lane:
            fail(f"Lane {lid} missing 'red_note' in lane-plan.json")
        if "task_complexity" not in lane:
            print(
                f"⚠️ Warning: Lane {lid} lacks explicit task_complexity. Defaulting to 'behavioral'.",
                file=sys.stderr,
            )
        if "acceptance_criteria" not in lane or not lane["acceptance_criteria"]:
            fail(f"Lane {lid} missing acceptance_criteria")
        for dep in lane.get("depends_on", []):
            if dep not in lane_ids:
                fail(f"Lane {lid} depends on unknown lane {dep}")
        for f in lane.get("files", []):
            file_to_lanes.setdefault(f, []).append(lid)

    units = lane_plan.get("units", {})
    task_to_unit = {}
    unit_deps = {}
    if units:
        for uid, u in units.items():
            if not isinstance(u, dict):
                fail(f"Lane-plan.json unit {uid} must be an object")
            for tid in u.get("tasks", []):
                task_to_unit[tid] = uid
            unit_deps[uid] = set(u.get("depends_on", []))

        _transitive_closure(unit_deps)

    # Transitive task-level dependencies (#524 dogfooding): a chain like
    # task-009 -> task-007 -> task-006 has no direct edge between task-009
    # and task-006, but task-009 is still guaranteed to run after task-006
    # in any correct topological schedule.
    task_deps = {lid: set(lane.get("depends_on", [])) for lid, lane in lanes.items()}
    _transitive_closure(task_deps)

    # Integration-invariant lane checks (task-006): tasks.json and
    # PROPERTIES.md are each read at most once here to satisfy the
    # gate-performance NFR.
    tasks_json_path = resolve_artifact("tasks.json")
    if tasks_json_path.exists():
        with tasks_json_path.open() as f:
            tasks_data = json.load(f)
        tasks_by_id = {
            t["id"]: t for t in tasks_data if isinstance(t, dict) and "id" in t
        }
    else:
        tasks_by_id = {}

    properties_path = resolve_artifact("PROPERTIES.md")
    invariant_rows: list[dict] = []
    if properties_path.exists():
        with properties_path.open() as f:
            properties_content = f.read()
        if has_integration_invariants_section(properties_content):
            try:
                invariant_rows = parse_integration_invariants(properties_content)
            except IntegrationInvariantError:
                invariant_rows = []

    unknown_pairs = unknown_covered_tasks(invariant_rows, tasks_by_id)
    if unknown_pairs:
        fail(
            "; ".join(
                f"invariant_covers_unknown_task: {inv_id} -> {task_id}"
                for inv_id, task_id in unknown_pairs
            )
        )

    int_lane_ids = [lid for lid in lanes if lid.startswith(_INT_LANE_PREFIX)]

    if invariant_rows:
        test_command = config.get("test_command", "pytest")
        derived_lanes = {
            derived["id"]: derived
            for derived in derive_integration_lanes(
                invariant_rows, tasks_by_id, test_command
            )
        }
        depends_on_errors = []
        for lid in int_lane_ids:
            lane = lanes[lid]
            actual = set(lane.get("depends_on", []))
            derived = derived_lanes.get(lid)
            expected = set(derived["depends_on"]) if derived else set()
            if actual != expected:
                depends_on_errors.append(
                    f"{lid} depends_on {sorted(actual)} does not match invariant "
                    f"Covers union {sorted(expected)}"
                )
        if depends_on_errors:
            fail("; ".join(depends_on_errors))

    direction_errors = []
    for lid, lane in lanes.items():
        if lane.get("kind") == "integration":
            continue
        for dep in lane.get("depends_on", []):
            if dep.startswith(_INT_LANE_PREFIX):
                direction_errors.append(
                    f"{lid} (kind={lane.get('kind', 'task')}) depends on "
                    f"integration lane {dep}"
                )
    if direction_errors:
        fail("; ".join(direction_errors))

    if not int_lane_ids and not invariant_rows:
        print("no_integration_invariants", file=sys.stderr)

    for f, owners in file_to_lanes.items():
        if len(owners) < 2:
            continue

        owners_list = list(owners)
        for i in range(len(owners_list)):
            for j in range(i + 1, len(owners_list)):
                t1 = owners_list[i]
                t2 = owners_list[j]

                # Check task-level dependency (direct or transitive)
                if t2 in task_deps.get(t1, set()) or t1 in task_deps.get(t2, set()):
                    continue

                # Check unit-level dependency
                if units:
                    u1 = task_to_unit.get(t1)
                    u2 = task_to_unit.get(t2)
                    if u1 and u2:
                        if u1 == u2:
                            continue  # Same unit, executes sequentially
                        if u2 in unit_deps.get(u1, set()) or u1 in unit_deps.get(
                            u2, set()
                        ):
                            continue  # Sequential at unit level

                fail(
                    f"File overlap {f} across parallel tasks {t1} and {t2} (no dependency edge)"
                )

    # Overconfidence gate: check Assumption Audit in SPEC.md
    spec_path = resolve_artifact("SPEC.md")
    questions_path = resolve_artifact("QUESTIONS.md")

    if spec_path.exists():
        spec_content = spec_path.read_text()
        questions_content = (
            questions_path.read_text() if questions_path.exists() else None
        )
        overconfidence_enabled = config.get("gates", {}).get(
            "overconfidence_check", True
        )
        audit_errors, audit_warnings = check_assumption_audit(
            spec_content, questions_content, overconfidence_enabled
        )
        for w in audit_warnings:
            print(f"⚠️ Warning: {w}", file=sys.stderr)
        if audit_errors:
            fail(f"Overconfidence gate failed: {audit_errors}")

    policy = gate_policy(config, "plan_human_approval")
    if policy != "skipped" and not yolo:
        print(
            json.dumps(
                {
                    "passed": False,
                    "needs_human": True,
                    "message": "TASKS.md and lane-plan.json ready for human approval. Re-run with --approve to approve.",
                    "artifacts": [str(tasks_path), str(lane_plan_path)],
                }
            )
        )
        sys.exit(1)

    pass_gate("Plan gate passed")


def gate_prior_art(yolo: bool, config: dict) -> None:
    prior_art_path = resolve_artifact("PRIOR_ART.md")
    if not prior_art_path.exists():
        fail("PRIOR_ART.md not found in epic directory")

    content = prior_art_path.read_text()

    tasks_path = resolve_artifact("tasks.json")
    if tasks_path.exists():
        tasks = json.loads(tasks_path.read_text())
        task_list = tasks if isinstance(tasks, list) else tasks.get("tasks", [])
        task_ids = {t["id"] for t in task_list if "id" in t}
        for tid in task_ids:
            if tid not in content:
                fail(f"PRIOR_ART.md missing entry for {tid}")

    tasks_md = resolve_artifact("TASKS.md")
    if tasks_md.exists():
        md_content = tasks_md.read_text()
        if "## Prior Art" not in md_content:
            fail("TASKS.md missing '## Prior Art' section")

    if re.search(r"\buse\b.*\b(GPL|AGPL)\b", content, re.IGNORECASE):
        fail("Prior art finding with 'use' verdict has GPL/AGPL license — incompatible")

    has_imports = bool(re.search(r"\b(use|wrap|vendor)\b", content, re.IGNORECASE))

    if has_imports:
        if "## Security Audit" not in content:
            fail(
                "PRIOR_ART.md has use/wrap/vendor verdicts but no '## Security Audit' section"
            )
        if re.search(r"⛔\s*REJECTED", content):
            rejected = re.findall(r"⛔\s*REJECTED[^\n]*", content)
            print(
                json.dumps(
                    {
                        "passed": False,
                        "hard_stop": False,
                        "message": f"Security audit rejected {len(rejected)} dependency(s). "
                        "Verdicts downgraded to 'reference'. Review PRIOR_ART.md.",
                    }
                ),
                file=sys.stderr,
            )
        if "accept_risk" in content.lower():
            print(
                json.dumps(
                    {
                        "passed": False,
                        "needs_human": True,
                        "message": "Security audit has accept_risk verdicts requiring human sign-off. Re-run with --approve after review.",
                    }
                )
            )
            sys.exit(1)
        if re.search(r"vendor.*\bwithout\b.*\battribution\b", content, re.IGNORECASE):
            fail(
                "Vendored code missing license attribution — hard gate requirement",
                hard=True,
            )

    policy = gate_policy(config, "prior_art_human_review")
    if policy == "required" and not yolo:
        print(
            json.dumps(
                {
                    "passed": False,
                    "needs_human": True,
                    "message": "PRIOR_ART.md ready for human review. Re-run with --approve to continue.",
                }
            )
        )
        sys.exit(1)

    pass_gate("Prior Art gate passed")


def gate_triage(yolo: bool, config: dict) -> None:
    routing_path = Path(".datum/routing.json")
    if not routing_path.exists():
        fail(
            "routing.json not found. Triage subagent must write decision to .datum/routing.json"
        )

    with routing_path.open() as f:
        routing = json.load(f)

    if routing.get("decision") not in ("deepen", "properties"):
        fail("Invalid routing decision. Must be 'deepen' or 'properties'.")

    pass_gate("Triage gate passed")


def gate_deepen(yolo: bool, config: dict) -> None:
    tasks_path = resolve_artifact("TASKS.md")
    if not tasks_path.exists():
        fail("TASKS.md not found")

    content = tasks_path.read_text()
    if "## Research Findings" not in content and "## Research" not in content:
        fail(
            "TASKS.md missing '## Research Findings' section. Deepen phase must append evidence."
        )

    pass_gate("Deepen gate passed")


def gate_properties(yolo: bool, config: dict) -> None:
    props_path = resolve_artifact("PROPERTIES.md")
    if not props_path.exists():
        fail("PROPERTIES.md not found")

    content = props_path.read_text()

    required_categories = [
        "SAFETY",
        "LIVENESS",
        "INVARIANT",
        "BOUNDARY",
        "IDEMPOTENT",
        "ORDERING",
        "ISOLATION",
        "PERFORMANCE",
        "SECURITY",
        "OBSERVABILITY",
        "COMPATIBILITY",
    ]
    missing = [c for c in required_categories if c not in content.upper()]
    if missing:
        fail(f"PROPERTIES.md missing categories: {missing}")

    # Check traceability table exists
    if "task-" not in content.lower() and "task_" not in content.lower():
        fail("PROPERTIES.md missing traceability table (no task references found)")

    if not has_integration_invariants_section(content):
        fail("missing_integration_invariants_section")

    try:
        invariant_rows = parse_integration_invariants(content)
    except IntegrationInvariantError as exc:
        fail(str(exc))

    for row in invariant_rows:
        if row["source"].startswith("spec:") and len(row["covers"]) < 2:
            fail(f"invariant_covers_insufficient: {row['id']}")

    questions_path = resolve_artifact("QUESTIONS.md")
    questions_content = questions_path.read_text() if questions_path.exists() else ""
    answered_ids = answered_question_ids(questions_content)

    coverage_errors: list[str] = []
    for qid in answered_ids:
        source = f"question:{qid}"
        matches = [row for row in invariant_rows if row["source"] == source]
        if not matches:
            coverage_errors.append(f"invariant_missing_for_question: {qid}")
        elif len(matches) > 1:
            coverage_errors.append(f"invariant_duplicate_for_question: {qid}")
    if coverage_errors:
        fail("; ".join(coverage_errors))

    policy = gate_policy(config, "properties_human_review")
    if policy == "required" and not yolo:
        print(
            json.dumps(
                {
                    "passed": False,
                    "needs_human": True,
                    "message": "PROPERTIES.md ready for human review. Re-run with --approve to continue.",
                    "artifact": "PROPERTIES.md",
                }
            )
        )
        sys.exit(1)

    pass_gate("Properties gate passed")


def gate_validate(yolo: bool, config: dict) -> None:
    # The test signal is PRODUCED by the Validate phase's independent test
    # run (skills/src/shared/validate-steps.ts write-signal step). It used to
    # be read-if-present and the gate passed silently when it was absent —
    # a consumer with no producer. Absent or unreadable is now a failure.
    signal_path = Path(".datum/last-test-signal.json")
    if not signal_path.exists():
        fail(
            f"{signal_path} not found — no independent test run recorded a signal; "
            "run the Validate phase (datum validate) before this gate"
        )
    try:
        signal = json.loads(signal_path.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        fail(f"{signal_path} is unreadable: {exc}")
    if not isinstance(signal, dict) or signal.get("status") != "pass":
        status = signal.get("status") if isinstance(signal, dict) else "malformed"
        exit_code = signal.get("exit_code") if isinstance(signal, dict) else None
        fail(f"Test suite not green: status={status} exit_code={exit_code}")

    policy = gate_policy(config, "validate_human_review")
    if policy == "required" and not yolo:
        print(
            json.dumps(
                {
                    "passed": False,
                    "needs_human": True,
                    "message": "Validation results ready for review. Re-run with --approve to continue.",
                }
            )
        )
        sys.exit(1)

    pass_gate("Validate gate passed")


def gate_review(yolo: bool, config: dict) -> None:
    # #368 producer/consumer fix: review-packets/unified.json (and its
    # unified.schema.json validation) is dropped from this gate. No phase in
    # the pipeline ever produces it — datum-review.ts writes
    # docs/epics/<branch>/REVIEW-REPORT.md directly, and the script that would
    # have built review-packets/unified.json (datum/dedupe.py) was deleted as a
    # dead producer (#394). A gate requiring an artifact nothing
    # produces can never pass, so the check below is against the report
    # content only. REVIEW-REPORT.md is resolved the same epic-scoped way
    # every other gate resolves its artifact (resolve_artifact), so it finds
    # docs/epics/<branch>/REVIEW-REPORT.md instead of a repo-root copy that
    # datum-review.ts never writes.
    report_path = resolve_artifact("REVIEW-REPORT.md")

    if not report_path.exists():
        fail("REVIEW-REPORT.md not found")

    content = report_path.read_text()
    # Operator-accepted findings (docs/epics/<branch>/REVIEW-RESPONSE.md,
    # written by `datum review-accept <ID> --reason ...`) do not block: an
    # LLM lens's severity calibration must never be a hard stop with no
    # reasoned, recorded way past it (elonchesd epic-1: five "high" findings
    # were per-frame scans over forty items).
    response_path = report_path.parent / "REVIEW-RESPONSE.md"
    accepted = accepted_review_findings(response_path)
    blocking, ignored, matched = _blocking_review_findings(
        content, accepted, review_decisions(response_path)
    )
    if blocking:
        # Satisfaction loop: an iteration is a DISTINCT blocked report, kept
        # per epic. The old counter lived under a run id read from the wrong
        # key (so every epic shared ".datum/runs/default") and grew on every
        # gate call, so an operator's own `datum gate review` probes escalated
        # the epic (elonchesd, iteration 2). Accepting or fixing every
        # blocking finding clears the escalation: the hard stop only exists
        # while something blocks.
        seen = _blocked_reports_seen(report_path)
        report_sha = _report_sha(content)
        iteration = len(seen | {report_sha})

        # Configurable: review_max_iterations in .datum/config.json (default
        # 3). Some iterations are datum-driven, not the operator's (caliper:
        # the BUG R key drift consumed one), and the operator decides how
        # many passes a review loop is worth.
        max_iterations = _review_max_iterations(config)
        if iteration >= max_iterations:
            fail(
                f"REVIEW-REPORT.md contains HIGH/CRITICAL findings after {max_iterations} iterations. "
                "ESCALATION TO CHIEF OF STAFF: Architectural review required before proceeding "
                "(raise review_max_iterations in .datum/config.json to allow another pass).",
                hard=True,
            )
        else:
            # Nothing produces a remediation package in a consumer repo (the
            # old message claimed one was generated). Say what blocks, by id
            # and key, and how to record an accept.
            _record_blocked_report(report_path, seen | {report_sha})
            ids = ", ".join(blocking) if blocking != ["(unlabelled)"] else "unlabelled"
            ignored_note = (
                " Ignored (ids are renumbered every review; accept by the Key column): "
                + ", ".join(f"ACCEPT {t} ignored" for t in ignored)
                + "."
                if ignored
                else ""
            )
            fail(
                f"REVIEW-REPORT.md contains high-severity findings (iteration {iteration}/{max_iterations}): {ids}. "
                "Fix them and re-run review, or record a reasoned accept per finding with "
                '`datum review-accept <ID-or-key> --reason "..."` (writes REVIEW-RESPONSE.md next to the report).'
                + ignored_note
            )

    policy = gate_policy(config, "review_human_approval")
    if policy != "skipped" and not yolo:
        print(
            json.dumps(
                {
                    "passed": False,
                    "needs_human": True,
                    "message": "REVIEW-REPORT.md ready for human approval. Re-run with --approve to approve.",
                    "artifact": str(report_path),
                }
            )
        )
        sys.exit(1)

    if accepted or matched:
        named = ", ".join(
            sorted(t.lower() if _KEY_RE.match(t) else t for t in accepted)
        )

        def _describe(key: str, value: str) -> str:
            token, _, rule = value.partition("|")
            shown = token.lower() if _KEY_RE.match(token) else token
            return f"{key} matched prior decision {shown} ({rule})"

        by_place = "; ".join(_describe(k, v) for k, v in matched.items())
        pass_gate(
            f"Review gate passed ({len(accepted)} accepted by REVIEW-RESPONSE.md: {named}"
            + (f"; {by_place}" if by_place else "")
            + ")"
        )
    pass_gate("Review gate passed")


def gate_pr_comments(yolo: bool, config: dict) -> None:
    triage_path = Path(".datum/triage.json")
    if not triage_path.exists():
        fail("triage.json not found")

    with triage_path.open() as f:
        triage = json.load(f)

    unresolved = [
        item
        for item in triage.get("items", [])
        if item.get("verdict") == "discuss" and not item.get("replied")
    ]
    if unresolved:
        fail(f"{len(unresolved)} PR comment threads still pending discussion")

    policy = gate_policy(config, "triage_human_approval")
    if policy == "required" and not yolo:
        print(
            json.dumps(
                {
                    "passed": False,
                    "needs_human": True,
                    "message": "Triage results ready for human approval. Re-run with --approve to continue.",
                    "artifact": ".datum/triage.json",
                }
            )
        )
        sys.exit(1)

    pass_gate("PR Comments gate passed")


def gate_validate_packets(config: dict) -> None:
    packets_dir = existing_review_packets_dir()
    if not packets_dir.exists():
        fail(f"review-packets/ not found: {packets_dir}")

    errors = []
    validate_payload, validate_value = _contracts()
    for packet_path in packets_dir.glob("*.json"):
        if packet_path.name == "unified.json":
            continue
        packet_errors = validate_payload("packet.schema.json", packet_path)
        errors.extend(f"{packet_path.name}: {err}" for err in packet_errors)

    if errors:
        fail(f"Packet validation errors: {errors}")

    pass_gate("Packets valid")


def _load_yaml_profile(path: Path) -> dict:
    try:
        import yaml  # type: ignore[import-not-found]
    except ImportError:
        fail("PyYAML is required for validate-profiles")

    with path.open() as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        fail(f"{path} is not a YAML object")
    return data


def _profile_path(name: str) -> Path:
    repo_path = Path(".datum/profiles") / name
    if repo_path.exists():
        return repo_path
    return templates_dir() / name


def gate_validate_profiles(config: dict) -> None:
    profile_pairs = [
        ("quality.yaml", assets_dir() / "schemas/quality.schema.json"),
        ("environment.yaml", assets_dir() / "schemas/environment.schema.json"),
    ]

    errors = []
    for profile_name, schema_path in profile_pairs:
        profile_path = _profile_path(profile_name)
        if not profile_path.exists():
            errors.append(f"{profile_name}: missing profile and template")
            continue
        data = _load_yaml_profile(profile_path)
        validate_payload, validate_value = _contracts()
        profile_errors = validate_value(schema_path, data)
        errors.extend(f"{profile_path}: {err}" for err in profile_errors)

    if errors:
        fail(f"Profile validation errors: {errors}", hard=True)

    pass_gate("Profiles valid")


# ── Dispatch ─────────────────────────────────────────────────────────────────


GATES = {
    "refine": gate_refine,
    "plan": gate_plan,
    "prior_art": gate_prior_art,
    "triage": gate_triage,
    "deepen": gate_deepen,
    "properties": gate_properties,
    "validate": gate_validate,
    "review": gate_review,
    "pr-comments": gate_pr_comments,
}


def main() -> None:
    # Gates are READ-ONLY validators: they must never create or checkout
    # branches, or otherwise mutate git state (issue #69). Branch setup is
    # an explicit operation owned by `datum init` / `datum state init`.
    parser = argparse.ArgumentParser(description="DATUM gate validator")
    parser.add_argument("phase")
    parser.add_argument("--yolo", action="store_true")
    parser.add_argument("--skip-human", "--approve", action="store_true")
    parser.add_argument(
        "--artifact",
        default="SPEC.md",
        help="Artifact to score (score-context phase only)",
    )
    args = parser.parse_args()

    config = load_config()

    if args.phase == "score-context":
        gate_score_context(config, args.artifact)
        return
    if args.phase == "validate-packets":
        gate_validate_packets(config)
        return
    if args.phase == "validate-profiles":
        gate_validate_profiles(config)
        return

    if args.phase not in GATES:
        print(json.dumps({"error": f"unknown gate: {args.phase}"}))
        sys.exit(1)

    try:
        GATES[args.phase](args.yolo or args.skip_human, config)
    except Exception as e:
        import traceback

        from datum.report_bug import _sanitize, report_bug

        trace_str = _sanitize(traceback.format_exc())

        issue_url = report_bug(
            module="datum.gate",
            error=f"{type(e).__name__} in gate_{args.phase}",
            context={"traceback": trace_str},
        )

        msg = f"DATUM encountered an unexpected error: {e}\n{trace_str}"
        if issue_url:
            msg += f"\n\n[Auto-Healing] Filed bug report: {issue_url}"

        print(json.dumps({"passed": False, "hard_stop": True, "message": msg}))
        sys.exit(2)


if __name__ == "__main__":
    main()
