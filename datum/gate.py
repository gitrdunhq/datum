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


def check_open_questions(spec_content: str) -> list[str]:
    """Scan the Open Questions section body for unresolved markers (#57).

    The '[ ]'/TBD/TODO scan is scoped to the Open Questions section only, so
    checkbox-style acceptance criteria elsewhere in the SPEC don't trip the
    refine gate. Returns a list of error strings.
    """
    heading = re.search(
        r"^(#{2,6})\s+(?:\d+\.\s+)?Open Questions\b.*$",
        spec_content,
        re.MULTILINE | re.IGNORECASE,
    )
    if not heading:
        return []

    level = len(heading.group(1))
    body_start = heading.end()
    # Section ends at the next heading of the same or higher level
    next_heading = re.search(
        rf"^#{{2,{level}}}\s", spec_content[body_start:], re.MULTILINE
    )
    body = (
        spec_content[body_start : body_start + next_heading.start()]
        if next_heading
        else spec_content[body_start:]
    )

    if "[ ]" in body or "TBD" in body or "TODO" in body:
        return ["SPEC.md Open Questions section has unresolved items ([ ]/TBD/TODO)"]
    return []


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

        if status == "guess":
            # Check if Resolves points to an answered question
            resolves_match = re.match(r"^(Q\d+)$", resolves.strip())
            if not resolves_match:
                errors.append(
                    f"Assumption {cells[0]}: status is 'guess' but Resolves "
                    f"is '{resolves}' (must reference Q<N>)"
                )
            elif resolves_match.group(1) not in answered_questions:
                errors.append(
                    f"Assumption {cells[0]}: status is 'guess', Resolves "
                    f"references {resolves_match.group(1)} but that question "
                    f"is unanswered"
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
    missing = [s for s in required_sections if s.lower() not in content.lower()]
    if missing:
        fail(f"SPEC.md missing sections: {missing}")

    # Check for unresolved open questions (scoped to the section body, #57)
    oq_errors = check_open_questions(content)
    if oq_errors:
        fail(oq_errors[0])

    # Check QUESTIONS.md for unanswered entries
    questions_path = resolve_artifact("QUESTIONS.md")
    if questions_path.exists():
        q_errors = check_questions_answered(questions_path.read_text())
        if q_errors:
            fail(f"QUESTIONS.md has unanswered questions: {q_errors}")

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


def gate_plan(yolo: bool, config: dict) -> None:
    tasks_path = resolve_artifact("TASKS.md")
    lane_plan_path = Path(".datum/lane-plan.json")

    if not tasks_path.exists():
        fail("TASKS.md not found")
    if not lane_plan_path.exists():
        fail("Missing .datum/lane-plan.json. Run lane_plan.py first.")

    # Validate lane-plan.json structure
    with lane_plan_path.open() as f:
        lane_plan = json.load(f)

    validate_payload, validate_value = _contracts()
    schema_errors = validate_payload("lane-plan.schema.json", lane_plan_path)
    if schema_errors:
        fail(f"lane-plan.json schema validation failed: {schema_errors}", hard=True)

    lanes = lane_plan.get("lanes", {})
    lane_ids = set(lanes)
    topological_order = lane_plan.get("topological_order", [])
    if set(topological_order) != lane_ids:
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
            for tid in u.get("tasks", []):
                task_to_unit[tid] = uid
            unit_deps[uid] = set(u.get("depends_on", []))

        # compute transitive dependencies for units
        changed = True
        while changed:
            changed = False
            for _uid, deps in unit_deps.items():
                old_len = len(deps)
                for dep in list(deps):
                    if dep in unit_deps:
                        deps.update(unit_deps[dep])
                if len(deps) > old_len:
                    changed = True

    for f, owners in file_to_lanes.items():
        if len(owners) < 2:
            continue

        owners_list = list(owners)
        for i in range(len(owners_list)):
            for j in range(i + 1, len(owners_list)):
                t1 = owners_list[i]
                t2 = owners_list[j]

                # Check task-level dependency
                if t2 in lanes[t1].get("depends_on", []) or t1 in lanes[t2].get(
                    "depends_on", []
                ):
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
                    "artifacts": ["TASKS.md", ".datum/lane-plan.json"],
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

    tasks_path = Path("tasks.json")
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
    # Check test signal from most recent run
    signal_path = Path(".datum/last-test-signal.json")
    if signal_path.exists():
        with signal_path.open() as f:
            signal = json.load(f)
        if signal.get("status") not in ("pass",):
            fail(f"Test suite not green: {signal.get('status')}")

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
    report_path = Path("REVIEW-REPORT.md")
    packets_dir = existing_review_packets_dir()

    if not report_path.exists():
        fail("REVIEW-REPORT.md not found")
    if not packets_dir.exists():
        fail(f"review-packets/ directory not found: {packets_dir}")

    unified_json = packets_dir / "unified.json"
    if not unified_json.exists():
        fail(f"review-packets/unified.json not found in {packets_dir}")

    validate_payload, _ = _contracts()
    unified_errors = validate_payload("unified.schema.json", unified_json)
    if unified_errors:
        fail(
            "unified.json is malformed according to unified.schema.json:\n"
            + "\n".join(unified_errors)
        )

    # Check for high-severity findings
    content = report_path.read_text() if report_path.exists() else ""
    if (
        "severity: high" in content.lower()
        or "**high**" in content.lower()
        or "severity: critical" in content.lower()
        or "**critical**" in content.lower()
    ):
        # Satisfaction Loop Logic
        state_path = Path(".datum/state.json")
        run_id = "default"
        if state_path.exists():
            import json

            run_id = json.loads(state_path.read_text()).get("run_id", "default")

        iter_file = Path(f".datum/runs/{run_id}/.review-iteration")
        iteration = 1
        if iter_file.exists():
            iteration = int(iter_file.read_text().strip())

        if iteration >= 3:
            fail(
                "REVIEW-REPORT.md contains HIGH/CRITICAL findings after 3 iterations. "
                "ESCALATION TO CHIEF OF STAFF: Architectural review required before proceeding.",
                hard=True,
            )
        else:
            import subprocess

            print(
                f"Gate review failed (Iteration {iteration}/3). Generating Remediation Package..."
            )
            subprocess.run(
                [
                    "python3",
                    "scripts/remediate.py",
                    "--run-id",
                    run_id,
                    "--findings",
                    f".datum/runs/{run_id}/review-packets/unified.json",
                ]
            )
            iter_file.parent.mkdir(parents=True, exist_ok=True)
            iter_file.write_text(str(iteration + 1))
            fail(
                f"REVIEW-REPORT.md contains high-severity findings — Remediation Package generated for Iteration {iteration}. Fix and retry."
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


def gate_red(yolo: bool, config: dict) -> None:
    from datum.tdd_driver import GreenBlindnessError, verify_red_stage

    print("--- [GATE] RED Test Verification ---")

    if not config.get("green_blindness_strict", True):
        print("green_blindness_strict is false, skipping verification.")
        pass_gate("RED test verification skipped")
        return

    test_cmd = config.get("tests", {}).get("command", ["pytest", "-q"])
    if isinstance(test_cmd, str):
        import shlex

        test_cmd = shlex.split(test_cmd)

    try:
        verify_red_stage(Path("."), test_command=test_cmd)
        pass_gate("RED tests are failing as expected")
    except GreenBlindnessError as e:
        fail(str(e), hard=True)


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
    "red": gate_red,
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
