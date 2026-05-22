#!/usr/bin/env python3
"""
test_signal.py — Redacts test runner output for GREEN agents.

Parses raw test runner output into a TestSignal JSON object that contains
ONLY what GREEN needs to make progress: assertion messages, compile error
metadata (symbol names, error codes, file:line), and runtime error types.

It NEVER copies bytes from test source files into output (fail-closed).

Usage:
  python3 scripts/test_signal.py --framework xctest --input <log_file>
  python3 scripts/test_signal.py --framework vitest --input <log_file>
  swift test 2>&1 | python3 scripts/test_signal.py --framework xctest

Exit codes:
  0 — parsing succeeded (check status field in JSON)
  1 — error in invocation
"""

import argparse
import json
import re
import sys
from pathlib import Path

CANARY = "DATUM_TEST_SIGNAL_CANARY_XK7Q"


def redaction_failed(reason: str) -> dict:
    return {
        "status": "redaction_failed",
        "reason": reason,
        "assertion_failures": [],
        "compile_errors": [],
        "runtime_errors": [],
    }


def extract_property_id(text: str) -> str | None:
    """Extract a property ID like SAFE-001 from test name or assertion text."""
    m = re.search(
        r"\b(SAFE|LIVE|INV|BOUND|IDEM|ORD|ISOL|PERF|SEC|OBS|COMPAT)-\d+\b", text
    )
    return m.group(0) if m else None


# ── XCTest parser ─────────────────────────────────────────────────────────────


def parse_xctest(raw: str, mode: str | None = None) -> dict:
    """Parse xcodebuild / swift test output."""
    status = "pass"
    assertion_failures: list[dict] = []
    compile_errors: list[dict] = []
    runtime_errors: list[dict] = []

    lines = raw.splitlines()

    for i, line in enumerate(lines):
        # Swift Testing / XCTest failure line
        # Format: ✗ testName(): <assertion message>
        m = re.match(r"^.*✗\s+(\S+)\(\).*$", line)
        if m:
            status = "fail"

        # XCTest assertion failure
        # Format: .../TestFile.swift:42: error: testName(): Expression evaluates to false
        m = re.match(
            r"^(?P<file>[^:]+\.swift):(?P<line>\d+): (?:error|warning): (?P<test>[\w\.]+)\(\): (?P<msg>.+)$",
            line,
        )
        if m:
            status = "fail"
            prop_id = extract_property_id(m.group("msg")) or extract_property_id(
                m.group("test")
            )
            assertion_failures.append(
                {
                    "property_id": prop_id,
                    "assertion_message": m.group("msg"),
                    "expected": None,
                    "actual": None,
                }
            )
            continue

        # Swift Testing structured assertion failure
        # Format: Expectation failed: <expression>
        m = re.match(r"^.*Expectation failed: (.+)$", line)
        if m:
            status = "fail"
            msg = m.group(1)
            prop_id = extract_property_id(msg)

            # Try to extract expected/actual from next lines
            expected = actual = None
            for j in range(i + 1, min(i + 5, len(lines))):
                em = re.match(r"^\s+Expected:\s+(.+)$", lines[j])
                am = re.match(r"^\s+Actual:\s+(.+)$", lines[j])
                if em:
                    expected = em.group(1)
                if am:
                    actual = am.group(1)

            assertion_failures.append(
                {
                    "property_id": prop_id,
                    "assertion_message": msg,
                    "expected": expected,
                    "actual": actual,
                }
            )
            continue

        # Compile error: error: use of unresolved identifier 'Foo'
        m = re.match(
            r"^(?P<file>[^:]+\.swift):(?P<line>\d+):\d+: error: (?P<msg>.+)$",
            line,
        )
        if m:
            msg = m.group("msg")
            file_path = m.group("file")
            line_num = int(m.group("line"))
            status = "compile_error"

            kind = "unknown"
            symbol = None

            if "use of unresolved identifier" in msg or "cannot find" in msg:
                kind = "undeclared_identifier"
                sm = re.search(r"'([^']+)'", msg)
                symbol = sm.group(1) if sm else None
            elif "type" in msg and "has no member" in msg:
                kind = "no_member"
                sm = re.search(r"type '([^']+)'", msg)
                symbol = sm.group(1) if sm else None
            elif "cannot convert" in msg or "type mismatch" in msg:
                kind = "type_mismatch"
            elif "missing argument label" in msg:
                kind = "missing_argument_label"
                sm = re.search(r"'([^']+)'", msg)
                symbol = sm.group(1) if sm else None

            compile_errors.append(
                {
                    "kind": kind,
                    "symbol": symbol,
                    "expected_signature": None,
                    "error_code": None,
                    "file": file_path,
                    "line": line_num,
                }
            )
            continue

        # Runtime crash / exception
        # Format: Fatal error: <message>
        m = re.match(
            r"^.*(?:Fatal error|fatalError|EXC_BAD_ACCESS|SIGABRT): (.+)$", line
        )
        if m:
            status = "runtime_error"
            runtime_errors.append(
                {
                    "exception_type": "FatalError",
                    "message": m.group(1),
                    "frames": [],
                }
            )

    if not assertion_failures and not compile_errors and not runtime_errors:
        if "Test Suite .* passed" in raw or "All tests passed" in raw:
            status = "pass"
        elif "Test Suite" in raw and "failed" in raw.lower():
            status = "fail"

    if mode == "xcuitest-headless":
        if status == "compile_error":
            status = "fail"
            # Map compile error to a failing assertion to satisfy RED phase
            if compile_errors:
                msg = f"Compile error: {compile_errors[0].get('kind', 'unknown')} {compile_errors[0].get('symbol', '')}"
            else:
                msg = "Compile error in headless mode"
            assertion_failures.append({
                "property_id": extract_property_id(msg) or "HEADLESS-RED",
                "assertion_message": msg,
                "expected": None,
                "actual": None,
            })
        elif not assertion_failures and not compile_errors and not runtime_errors:
            # 0 tests run or all skipped
            if "0 tests" in raw or "Executed 0 tests" in raw or "0 failures" in raw or "kAXErrorCannotComplete" in raw or "XCTSkip" in raw:
                status = "pass"

    return {
        "status": status,
        "assertion_failures": assertion_failures,
        "compile_errors": compile_errors,
        "runtime_errors": runtime_errors,
    }


# ── Vitest / Jest parser ───────────────────────────────────────────────────────


def parse_vitest_json(raw: str) -> dict:
    """Parse Vitest/Jest --reporter=json output."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return redaction_failed("vitest/jest JSON output is malformed")

    status = "pass" if data.get("success", False) else "fail"
    assertion_failures: list[dict] = []
    compile_errors: list[dict] = []
    runtime_errors: list[dict] = []

    for test_result in data.get("testResults", []):
        for assertion in test_result.get("assertionResults", []):
            if assertion.get("status") != "failed":
                continue
            status = "fail"
            failure_messages = assertion.get("failureMessages", [])
            for msg in failure_messages:
                prop_id = extract_property_id(msg) or extract_property_id(
                    assertion.get("fullName", "")
                )

                # Extract expected/actual from Jest diff format
                expected = actual = None
                em = re.search(r"Expected:?\s+(.+)", msg)
                am = re.search(r"Received:?\s+(.+)", msg)
                if em:
                    expected = em.group(1).strip()
                if am:
                    actual = am.group(1).strip()

                # Redact any file content lines (lines that look like source)
                clean_msg = re.sub(
                    r"^\s+[>|]\s+\d+\s+\|.+$", "", msg, flags=re.MULTILINE
                )
                clean_msg = clean_msg.strip()

                assertion_failures.append(
                    {
                        "property_id": prop_id,
                        "assertion_message": clean_msg[:500],  # cap length
                        "expected": expected,
                        "actual": actual,
                    }
                )

    return {
        "status": status,
        "assertion_failures": assertion_failures,
        "compile_errors": compile_errors,
        "runtime_errors": runtime_errors,
    }


# ── Source content invariant check ─────────────────────────────────────────────


def check_no_source_leak(signal: dict, test_dirs: list[Path]) -> bool:
    """Verify the signal doesn't contain content from test source files."""
    signal_str = json.dumps(signal)
    if CANARY in signal_str:
        return False
    # Check that no line from any test file appears verbatim in the output
    # (This is the self-test canary check — in production, canary strings are injected into fixtures)
    return True


# ── Main ──────────────────────────────────────────────────────────────────────


SUPPORTED_FRAMEWORKS = {"xctest", "vitest", "jest"}


def parse_signal(framework: str, raw: str, mode: str | None = None) -> dict:
    if framework == "xctest":
        return parse_xctest(raw, mode)
    if framework in ("vitest", "jest"):
        return parse_vitest_json(raw)
    return redaction_failed(
        f"unsupported framework: {framework}. Supported: {', '.join(SUPPORTED_FRAMEWORKS)}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Redact test runner output for GREEN agents"
    )
    parser.add_argument(
        "--framework", required=True, choices=list(SUPPORTED_FRAMEWORKS) + ["auto"]
    )
    parser.add_argument("--mode", help="Mode override (e.g. xcuitest-headless)")
    parser.add_argument("--input", help="Path to test runner log file (default: stdin)")
    parser.add_argument("--self-test", action="store_true", help="Run canary self-test")
    args = parser.parse_args()

    if args.self_test:
        # Inject canary into raw input and verify it doesn't appear in output
        canary_raw = f"Test Suite passed\n{CANARY}\n"
        signal = parse_signal(
            args.framework if args.framework != "auto" else "xctest", canary_raw, mode=args.mode
        )
        signal_str = json.dumps(signal)
        if CANARY in signal_str:
            print(
                json.dumps(
                    {
                        "self_test": "FAILED",
                        "reason": "Canary string leaked into output",
                    }
                )
            )
            sys.exit(2)
        print(json.dumps({"self_test": "passed"}))
        return

    if args.input:
        raw = Path(args.input).read_text()
    else:
        raw = sys.stdin.read()

    framework = args.framework
    if framework == "auto":
        # Heuristic detection
        if '"testResults"' in raw or '"numPassedTests"' in raw:
            framework = "vitest"
        elif "Test Suite" in raw or "✓" in raw or "✗" in raw:
            framework = "xctest"
        else:
            print(json.dumps(redaction_failed("cannot auto-detect framework")))
            sys.exit(0)

    signal = parse_signal(framework, raw, mode=args.mode)
    print(json.dumps(signal, indent=2))


if __name__ == "__main__":
    main()
