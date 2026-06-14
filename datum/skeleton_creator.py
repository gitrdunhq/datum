#!/usr/bin/env python3
"""
skeleton_creator.py — Acceptance skeleton preflight for ACT lanes.

Reads a task entry and its acceptance criteria, then produces test file
scaffolding with named test functions (one per AC) before RED dispatches.

RED fills in the assertion bodies. The file structure and function names
are fixed so AC→test traceability is machine-verifiable.

Usage:
  python3 scripts/skeleton_creator.py --task-id task-001 --language swift
  python3 scripts/skeleton_creator.py --tasks TASKS.md --task-id task-001 --output .datum/preflight-task-001.json
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def _extract_swift_target_context(task_files: list[str]) -> str | None:
    try:
        out = subprocess.check_output(
            ["swift", "package", "dump-package"], text=True, stderr=subprocess.DEVNULL
        )
        data = json.loads(out)
    except Exception:
        return None

    targets = data.get("targets", [])
    if not targets:
        return None

    found_targets = set()
    for f in task_files:
        path = Path(f)
        parts = path.parts
        if len(parts) >= 2 and parts[0] in ("Sources", "Tests"):
            target_name = parts[1]
            found_targets.add(target_name)

    if not found_targets:
        return None

    context_lines = []
    for t in targets:
        name = t.get("name")
        if name in found_targets:
            deps = []
            for d in t.get("dependencies", []):
                if isinstance(d, dict):
                    if "byName" in d:
                        deps.append(d["byName"][0])
                    elif "target" in d:
                        deps.append(d["target"][0])
                    elif "product" in d:
                        deps.append(d["product"][0])
            dep_str = ", ".join(deps) if deps else "None"
            context_lines.append(f"Target: {name}, Depends on: [{dep_str}]")

    if context_lines:
        return "Swift Package Context:\n" + "\n".join(context_lines)
    return None


def _detect_swift_framework(test_file: str) -> str:
    path = Path(test_file)
    test_dir = path.parent
    # Check current dir and parents up to Tests/
    while not test_dir.exists() and test_dir.name and test_dir.name != "Tests":
        test_dir = test_dir.parent
    if test_dir.exists():
        for f in test_dir.rglob("*.swift"):
            content = f.read_text()
            if "import XCTest" in content:
                return "xctest"
            if "import Testing" in content:
                return "swift-testing"
    return "swift-testing"


SUPPORTED = {"swift", "typescript", "javascript", "go", "python"}

SKELETON_TEMPLATES = {
    "swift": """\
// Skeleton: {task_id} {ac_id} — {property_id}
// RED agent: fill in the assertion body. Do not rename this function or move this file.
// Traceability: {ac_id} → {function_name} → {path}

import Testing
@testable import {module}

@Suite("{suite_name}")
struct {struct_name} {{
    @Test(.tags(.{tag}))
    func {function_name}() async throws {{
        // Arrange

        // Act

        // Assert — prove {property_id}: {predicate_short}
        fatalError("RED agent: implement this assertion")
    }}
}}
""",
    "xctest": """\
// Skeleton: {task_id} {ac_id} — {property_id}
// RED agent: fill in the assertion body. Do not rename this function or move this file.
// Traceability: {ac_id} → {function_name} → {path}

import XCTest
@testable import {module}

final class {struct_name}: XCTestCase {{
    func {function_name}() async throws {{
        // Arrange

        // Act

        // Assert — prove {property_id}: {predicate_short}
        XCTFail("RED agent: implement this assertion")
    }}
}}
""",
    "typescript": """\
// Skeleton: {task_id} {ac_id} — {property_id}
// RED agent: fill in the assertion body. Do not rename this test or move this file.
// Traceability: {ac_id} → {function_name} → {path}

import {{ describe, it, expect }} from 'vitest';

// {property_id}: {predicate_short}
describe('{suite_name}', () => {{
    it('{function_name}', async () => {{
        // Arrange

        // Act

        // Assert — prove {property_id}
        throw new Error('RED agent: implement this assertion');
    }});
}});
""",
    "go": """\
// Skeleton: {task_id} {ac_id} — {property_id}
// RED agent: fill in the assertion body. Do not rename this function or move this file.
// Traceability: {ac_id} → {function_name} → {path}

package {package}_test

import "testing"

// {property_id}: {predicate_short}
func {function_name}(t *testing.T) {{
    // Arrange

    // Act

    // Assert — prove {property_id}
    t.Fatal("RED agent: implement this assertion")
}}
""",
    "python": """\
# Skeleton: {task_id} {ac_id} — {property_id}
# RED agent: fill in the assertion body. Do not rename this function or move this file.
# Traceability: {ac_id} → {function_name} → {path}

import pytest


class Test{struct_name}:
    def {function_name}(self):
        \"\"\"
        {property_id}: {predicate_short}
        \"\"\"
        # Arrange

        # Act

        # Assert — prove {property_id}
        assert False, "RED agent: implement this assertion"
""",
}

KIND_MAP = {
    "swift": "swift-testing",
    "typescript": "vitest",
    "javascript": "vitest",
    "go": "go-test",
    "python": "pytest",
}


def _extract_signatures_from_acs(acs: list[str]) -> list[dict]:
    """Parse AC text to extract function/class signatures for implementation stubs."""
    sigs = []
    seen_names: set[str] = set()
    skip = {
        "print",
        "len",
        "str",
        "int",
        "dict",
        "list",
        "set",
        "isinstance",
        "type",
        "exit",
        "round",
        "sorted",
        "filter",
        "map",
        "any",
        "all",
    }

    for i, ac in enumerate(acs):
        for m in re.finditer(r"(?<!['\"\-])(\w+)\(([^)]*)\)", ac):
            name = m.group(1)
            if name in skip or name in seen_names:
                continue
            if name.startswith("test_") or name.startswith("Test"):
                continue
            seen_names.add(name)

            args_raw = m.group(2).strip()
            args = []
            if args_raw:
                for a in args_raw.split(","):
                    a = a.strip().split(":")[0].strip().split("=")[0].strip()
                    if a and a not in ("self", "cls"):
                        args.append(a)

            ret_match = re.search(r"returns?\s+(?:a\s+)?(\w+)", ac, re.IGNORECASE)
            sigs.append(
                {
                    "name": name,
                    "args": args,
                    "returns": ret_match.group(1) if ret_match else None,
                    "ac_index": i,
                }
            )

    return sigs


def build_impl_stubs(
    task_id: str,
    acs: list[str],
    impl_files: list[str],
    language: str,
) -> list[dict]:
    """Generate implementation stub files so GREEN fills in bodies instead of writing from scratch."""
    if language != "python":
        return []

    sigs = _extract_signatures_from_acs(acs)
    if not sigs:
        return []

    stubs = []
    for impl_path in impl_files:
        path = Path(impl_path)
        if path.exists():
            continue

        lines = []
        seen: set[str] = set()
        for sig in sigs:
            if sig["name"] in seen:
                continue
            seen.add(sig["name"])
            args_str = ", ".join(sig["args"]) if sig["args"] else ""
            lines.append(f"def {sig['name']}({args_str}):")
            lines.append("    ...")
            lines.append("")

        if not lines:
            continue

        content = "\n".join(lines)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

        stubs.append(
            {
                "path": impl_path,
                "functions": list(seen),
                "stub_written": True,
            }
        )

    return stubs


def slugify(text: str) -> str:
    """Convert AC text to a valid identifier fragment."""
    from datum.slug import slugify as _slugify

    return _slugify(text, max_len=60)


def infer_test_path(task_files: list[str], language: str, ac_id: str) -> str:
    """Derive a test file path from the task's source files."""
    for f in task_files:
        if any(t in f for t in ["Test", "test", "Spec", "spec", "_test.", "_spec."]):
            return f
    # Derive from source file
    if task_files:
        src = task_files[0]
        if language == "swift":
            name = Path(src).stem
            return f"Tests/Unit/{Path(src).parent.name}/{name}Tests.swift"
        if language in ("typescript", "javascript"):
            name = Path(src).stem
            return f"src/{Path(src).parent.name}/{name}.test.ts"
        if language == "go":
            return src.replace(".go", "_test.go")
        if language == "python":
            name = Path(src).stem
            return f"tests/test_{name}.py"
    return f"tests/test_{ac_id.lower()}.py"


def infer_module(task_files: list[str], language: str) -> str:
    if language == "swift" and task_files:
        parts = Path(task_files[0]).parts
        return parts[1] if len(parts) > 1 else "AppModule"
    if language == "go" and task_files:
        return Path(task_files[0]).parent.name
    return "Module"


def make_function_name(ac_id: str, ac_text: str, language: str) -> str:
    slug = slugify(ac_text)
    if language == "swift":
        return f"test_{ac_id.lower()}_{slug}"
    if language in ("typescript", "javascript"):
        return f"{ac_id.lower()}_{slug}"
    if language == "go":
        parts = [p.capitalize() for p in f"{ac_id}_{slug}".split("_")]
        return "Test" + "".join(parts)
    return f"test_{ac_id.lower()}_{slug}"


def make_struct_name(task_id: str, ac_id: str) -> str:
    return f"{task_id.replace('-', '_').replace('task', 'Task')}_{ac_id}"


def build_skeleton(
    task_id: str,
    ac_id: str,
    ac_text: str,
    property_id: str,
    predicate_short: str,
    task_files: list[str],
    language: str,
    framework: str | None = None,
) -> dict:
    function_name = make_function_name(ac_id, ac_text, language)
    path = infer_test_path(task_files, language, ac_id)
    struct_name = make_struct_name(task_id, ac_id)
    module = infer_module(task_files, language)
    suite_name = f"{task_id} — {property_id}"
    tag = property_id.lower().replace("-", "")

    actual_framework = framework or language
    template = SKELETON_TEMPLATES.get(
        actual_framework, SKELETON_TEMPLATES.get(language, SKELETON_TEMPLATES["python"])
    )
    content = template.format(
        task_id=task_id,
        ac_id=ac_id,
        property_id=property_id,
        predicate_short=predicate_short[:80],
        function_name=function_name,
        path=path,
        module=module,
        suite_name=suite_name,
        struct_name=struct_name,
        tag=tag,
        package=module,
    )

    return {
        "ac_id": ac_id,
        "path": path,
        "kind": framework or KIND_MAP.get(language, "xctest"),
        "purpose": f"Verify {ac_text[:60]}",
        "property_id": property_id,
        "function_name": function_name,
        "skeleton_written": False,
        "content": content,
        "implementation_required": True,
    }


def run_preflight(
    task_id: str, language: str, tasks_path: Path, output_path: Path | None
) -> dict:
    if language not in SUPPORTED:
        return {
            "task_id": task_id,
            "language": language,
            "framework": KIND_MAP.get(language, "unknown"),
            "outputs": [],
            "no_skeletons_reason": f"Language '{language}' not supported by skeleton_creator v1",
        }

    if not tasks_path.exists():
        return {"error": f"{tasks_path} not found"}

    if tasks_path.suffix == ".json":
        try:
            tasks_data = json.loads(tasks_path.read_text())
        except json.JSONDecodeError:
            return {"error": f"{tasks_path} is invalid JSON"}

        if isinstance(tasks_data, dict) and "lanes" in tasks_data:
            # Handle lane-plan.json format
            task_data = tasks_data["lanes"].get(task_id)
            if task_data:
                task_data["id"] = task_id
        else:
            # Handle tasks.json array format
            task_data = next((t for t in tasks_data if t.get("id") == task_id), None)

        if not task_data:
            return {
                "task_id": task_id,
                "language": language,
                "framework": KIND_MAP.get(language, ""),
                "outputs": [],
                "no_skeletons_reason": f"Task {task_id} not found in {tasks_path.name}",
            }

        acs_text = task_data.get("acceptance_criteria", [])
        files = task_data.get("files", [])

        outputs = []
        for i, ac_text in enumerate(acs_text):
            ac_id = f"AC{i + 1}"
            props = re.findall(
                r"\b(SAFE|LIVE|INV|BOUND|IDEM|ORD|ISOL|PERF|SEC|OBS|COMPAT)-\d+\b",
                ac_text,
            )
            prop_id = props[0] if props else f"PROP-{i + 1:03d}"
            skeleton = build_skeleton(
                task_id=task_id,
                ac_id=ac_id,
                ac_text=ac_text.strip(),
                property_id=prop_id,
                predicate_short=ac_text.strip(),
                task_files=files,
                language=language,
                framework=(
                    _detect_swift_framework(files[0])
                    if language == "swift" and files
                    else None
                ),
            )
            dest = Path(skeleton["path"])
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(skeleton.pop("content"))
            skeleton["skeleton_written"] = True
            outputs.append(skeleton)

        target_context = (
            _extract_swift_target_context(files) if language == "swift" else None
        )
        impl_files = [f for f in files if "test" not in f.lower()]
        impl_stubs = build_impl_stubs(task_id, acs_text, impl_files, language)
        existing_api = {}
        if language == "python":
            from datum.skeleton import extract_skeleton_from_file

            for f in impl_files:
                p = Path(f)
                if p.exists():
                    existing_api[f] = extract_skeleton_from_file(p)
        result = {
            "task_id": task_id,
            "language": language,
            "framework": KIND_MAP.get(language, ""),
            "outputs": outputs,
            "impl_stubs": impl_stubs,
            "existing_api": existing_api,
            "target_context": target_context,
            "no_skeletons_reason": (
                None if outputs else "No acceptance criteria found in JSON"
            ),
        }
        if output_path:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(json.dumps(result, indent=2))
        return result

    content = tasks_path.read_text()
    task_block_pattern = (
        rf"(?:^|\n)#{1,3}\s+{re.escape(task_id)}[:\s].*?(?=\n#{1,3}\s+task-|\Z)"
    )
    match = re.search(task_block_pattern, content, re.DOTALL | re.IGNORECASE)
    if not match:
        return {
            "task_id": task_id,
            "language": language,
            "framework": KIND_MAP.get(language, ""),
            "outputs": [],
            "target_context": None,
            "no_skeletons_reason": f"Task {task_id} not found in TASKS.md",
        }

    block = match.group(0)

    # Extract ACs
    acs = re.findall(
        r"[-*]\s+(?:AC\d+[:\s]+|Acceptance criteria?\s*\d*[:\s]+)(.+)",
        block,
        re.IGNORECASE,
    )
    # Also try numbered ACs: - AC1: ...
    numbered = re.findall(r"[-*]\s+(AC\d+):\s+(.+)", block, re.IGNORECASE)

    # Extract files
    files = re.findall(r"[-*]\s+`?([^\s`]+(?:\.swift|\.ts|\.go|\.py|\.js))`?", block)

    # Extract property IDs
    properties = re.findall(
        r"\b(SAFE|LIVE|INV|BOUND|IDEM|ORD|ISOL|PERF|SEC|OBS|COMPAT)-\d+\b", block
    )

    outputs = []
    if numbered:
        for i, (ac_id, ac_text) in enumerate(numbered):
            prop_id = properties[i] if i < len(properties) else f"PROP-{i + 1:03d}"
            skeleton = build_skeleton(
                task_id=task_id,
                ac_id=ac_id,
                ac_text=ac_text.strip(),
                property_id=prop_id,
                predicate_short=ac_text.strip(),
                task_files=files,
                language=language,
                framework=(
                    _detect_swift_framework(files[0])
                    if language == "swift" and files
                    else None
                ),
            )
            # Write the file
            dest = Path(skeleton["path"])
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(skeleton.pop("content"))
            skeleton["skeleton_written"] = True
            outputs.append(skeleton)
    elif acs:
        for i, ac_text in enumerate(acs):
            ac_id = f"AC{i + 1}"
            prop_id = properties[i] if i < len(properties) else f"PROP-{i + 1:03d}"
            skeleton = build_skeleton(
                task_id=task_id,
                ac_id=ac_id,
                ac_text=ac_text.strip(),
                property_id=prop_id,
                predicate_short=ac_text.strip(),
                task_files=files,
                language=language,
                framework=(
                    _detect_swift_framework(files[0])
                    if language == "swift" and files
                    else None
                ),
            )
            dest = Path(skeleton["path"])
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(skeleton.pop("content"))
            skeleton["skeleton_written"] = True
            outputs.append(skeleton)
    else:
        target_context = (
            _extract_swift_target_context(files) if language == "swift" else None
        )
        return {
            "task_id": task_id,
            "language": language,
            "framework": KIND_MAP.get(language, ""),
            "outputs": [],
            "target_context": target_context,
            "no_skeletons_reason": "No acceptance criteria found in task block",
        }

    target_context = (
        _extract_swift_target_context(files) if language == "swift" else None
    )

    result = {
        "task_id": task_id,
        "language": language,
        "framework": KIND_MAP.get(language, ""),
        "outputs": outputs,
        "target_context": target_context,
        "no_skeletons_reason": None,
    }

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(result, indent=2))

    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Acceptance skeleton preflight for ACT lanes"
    )
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--tasks", default="TASKS.md")
    parser.add_argument("--output", help="Path for preflight-result.json")
    args = parser.parse_args()

    output_path = Path(args.output) if args.output else None
    result = run_preflight(
        task_id=args.task_id,
        language=args.language,
        tasks_path=Path(args.tasks),
        output_path=output_path,
    )
    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("outputs") or result.get("no_skeletons_reason") else 1)


if __name__ == "__main__":
    main()
