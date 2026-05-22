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
import sys
from pathlib import Path

# Fix relative imports
sys.path.insert(0, str(Path(__file__).parent))
from datum.contracts import validate_payload, validate_value
from datum.models.lane_plan_schema import DatumLanePlan
from datum.models.packet_schema import ReviewPacket
from datum.path_utils import assets_dir, templates_dir, existing_review_packets_dir


def load_config() -> dict:
    config_path = Path(".datum/config.toml")
    default_path = assets_dir() / "config.toml.default"

    for path in (config_path, default_path):
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


# ── Phase gate implementations ──────────────────────────────────────────────


def gate_refine(yolo: bool, config: dict) -> None:
    spec = Path("SPEC.md")
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

    # Check for open questions
    if re.search(r"open question", content, re.IGNORECASE):
        if "[ ]" in content or "TBD" in content or "TODO" in content:
            fail("SPEC.md has unresolved open questions or TODOs")

    policy = gate_policy(config, "refine_human_review")
    if policy == "required" and not yolo:
        print(
            json.dumps(
                {
                    "passed": False,
                    "needs_human": True,
                    "message": "SPEC.md ready for human review. Approve to continue.",
                    "artifact": "SPEC.md",
                }
            )
        )
        sys.exit(1)

    pass_gate("Refine gate passed")


def gate_plan(yolo: bool, config: dict) -> None:
    tasks_path = Path("TASKS.md")
    lane_plan_path = Path(".datum/lane-plan.json")

    if not tasks_path.exists():
        fail("TASKS.md not found")
    if not lane_plan_path.exists():
        fail("Missing .datum/lane-plan.json. Run lane_plan.py first.")

    # Validate lane-plan.json structure
    with lane_plan_path.open() as f:
        lane_plan = json.load(f)

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
            print(f"⚠️ Warning: Lane {lid} lacks explicit task_complexity. Defaulting to 'behavioral'.", file=sys.stderr)
        if "acceptance_criteria" not in lane or not lane["acceptance_criteria"]:
            fail(f"Lane {lid} missing acceptance_criteria")
        for dep in lane.get("depends_on", []):
            if dep not in lane_ids:
                fail(f"Lane {lid} depends on unknown lane {dep}")
        for f in lane.get("files", []):
            file_to_lanes.setdefault(f, []).append(lid)

    for f, owners in file_to_lanes.items():
        if len(owners) < 2:
            continue
        for owner in owners:
            deps = set(lanes[owner].get("depends_on", []))
            others = set(owners) - {owner}
            if not (deps & others):
                fail(
                    f"File overlap {f} across {sorted(owners)} has no dependency edge for {owner}"
                )

    # Plan approval is always required (never skippable)
    policy = gate_policy(config, "plan_human_approval")
    if policy != "skipped":
        print(
            json.dumps(
                {
                    "passed": False,
                    "needs_human": True,
                    "message": "TASKS.md and lane-plan.json ready for human approval.",
                    "artifacts": ["TASKS.md", ".datum/lane-plan.json"],
                }
            )
        )
        sys.exit(1)

    pass_gate("Plan gate passed")

def gate_triage(yolo: bool, config: dict) -> None:
    routing_path = Path(".datum/routing.json")
    if not routing_path.exists():
        fail("routing.json not found. Triage subagent must write decision to .datum/routing.json")
        
    with routing_path.open() as f:
        routing = json.load(f)
        
    if routing.get("decision") not in ("deepen", "properties"):
        fail("Invalid routing decision. Must be 'deepen' or 'properties'.")
        
    pass_gate("Triage gate passed")

def gate_deepen(yolo: bool, config: dict) -> None:
    tasks_path = Path("TASKS.md")
    if not tasks_path.exists():
        fail("TASKS.md not found")
        
    content = tasks_path.read_text()
    if "## Research Findings" not in content and "## Research" not in content:
        fail("TASKS.md missing '## Research Findings' section. Deepen phase must append evidence.")
        
    pass_gate("Deepen gate passed")


def gate_properties(yolo: bool, config: dict) -> None:
    props_path = Path("PROPERTIES.md")
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
    missing = [c for c in required_categories if c not in content]
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
                    "message": "PROPERTIES.md ready for human review.",
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
                    "message": "Validation results ready for review.",
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

    # Check for high-severity findings
    content = report_path.read_text() if report_path.exists() else ""
    if "severity: high" in content.lower() or "**high**" in content.lower() or "severity: critical" in content.lower() or "**critical**" in content.lower():
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
                hard=True
            )
        else:
            import subprocess
            print(f"Gate review failed (Iteration {iteration}/3). Generating Remediation Package...")
            subprocess.run([
                "python3", "scripts/remediate.py", 
                "--run-id", run_id, 
                "--findings", f".datum/runs/{run_id}/review-packets/unified.json"
            ])
            iter_file.parent.mkdir(parents=True, exist_ok=True)
            iter_file.write_text(str(iteration + 1))
            fail(f"REVIEW-REPORT.md contains high-severity findings — Remediation Package generated for Iteration {iteration}. Fix and retry.")

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
                    "message": "Triage results ready for human approval.",
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
    for packet_path in packets_dir.glob("*.json"):
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
        profile_errors = validate_value(schema_path, data)
        errors.extend(f"{profile_path}: {err}" for err in profile_errors)

    if errors:
        fail(f"Profile validation errors: {errors}", hard=True)

    pass_gate("Profiles valid")


# ── Dispatch ─────────────────────────────────────────────────────────────────


GATES = {
    "refine": gate_refine,
    "plan": gate_plan,
    "triage": gate_triage,
    "deepen": gate_deepen,
    "properties": gate_properties,
    "validate": gate_validate,
    "review": gate_review,
    "pr-comments": gate_pr_comments,
}


def main() -> None:
    parser = argparse.ArgumentParser(description="DATUM gate validator")
    parser.add_argument("phase")
    parser.add_argument("--yolo", action="store_true")
    parser.add_argument("--skip-human", action="store_true")
    args = parser.parse_args()

    config = load_config()

    if args.phase == "validate-packets":
        gate_validate_packets(config)
        return
    if args.phase == "validate-profiles":
        gate_validate_profiles(config)
        return

    if args.phase not in GATES:
        print(json.dumps({"error": f"unknown gate: {args.phase}"}))
        sys.exit(1)

    GATES[args.phase](args.yolo or args.skip_human, config)


if __name__ == "__main__":
    main()
