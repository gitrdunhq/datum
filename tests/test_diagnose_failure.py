"""Tests for datum/diagnose_failure.py.

log_unknown() is called from parallel lane agents (multiple lanes can hit an
UNKNOWN classification around the same time and append to the same
.datum/runs/<run_id>/unknown-failures.json). The old implementation did a
plain read-modify-write with no locking, which under real concurrency both
lost entries (lost-update race) AND crashed with JSONDecodeError (a reader
catching another writer's torn/partial write) — confirmed empirically with
8 threads x 10 calls each losing ~86% of entries and throwing repeatedly.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from datum.diagnose_failure import classify, log_unknown


def test_classify_empty_log_returns_unknown_not_a_crash():
    result = classify("")
    assert result["classification"] == "UNKNOWN"


def test_classify_unrecognized_text_returns_unknown():
    result = classify("some completely unrelated log line with no known pattern")
    assert result["classification"] == "UNKNOWN"


def test_log_unknown_survives_concurrent_writes_from_parallel_lanes(
    tmp_path, monkeypatch
):
    """Regression: concurrent log_unknown() calls (simulating parallel lanes
    each hitting an UNKNOWN failure) must not lose entries or crash."""
    monkeypatch.chdir(tmp_path)
    run_id = "race-test"
    n_threads = 8
    n_per_thread = 10
    errors: list[Exception] = []

    def worker():
        try:
            for i in range(n_per_thread):
                log_unknown(f"failure {i}", run_id)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == [], f"log_unknown raised under concurrency: {errors}"

    out = Path(f".datum/runs/{run_id}/unknown-failures.json")
    entries = json.loads(out.read_text())
    assert len(entries) == n_threads * n_per_thread


def test_append_errors_md_survives_concurrent_writes_from_parallel_lanes(
    tmp_path, monkeypatch
):
    """Same race as log_unknown(): parallel lanes can each classify a
    REASONING/UNKNOWN failure around the same time and both append to the
    shared .datum/ERRORS.md — a lost-update race must not drop entries."""
    from datum.diagnose_failure import append_errors_md

    monkeypatch.chdir(tmp_path)
    n_threads = 8
    n_per_thread = 10
    errors: list[Exception] = []

    def worker(idx: int):
        try:
            for i in range(n_per_thread):
                result = {
                    "classification": "UNKNOWN",
                    "cause": "unrecognized_pattern",
                    "message": "Unknown failure.",
                }
                append_errors_md(result, f"log {idx}-{i}", f"run-{idx}")
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == [], f"append_errors_md raised under concurrency: {errors}"

    content = Path(".datum/ERRORS.md").read_text()
    assert content.count("## [") == n_threads * n_per_thread
