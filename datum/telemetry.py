#!/usr/bin/env python3
"""
telemetry.py — Idempotent JSONL event logger.
All agent actions and stage transitions are appended to a JSONL log.
"""

import json
import time
from pathlib import Path
from typing import Any

TELEMETRY_LOG = Path(".datum/telemetry.jsonl")

def init_telemetry() -> None:
    TELEMETRY_LOG.parent.mkdir(parents=True, exist_ok=True)
    if not TELEMETRY_LOG.exists():
        TELEMETRY_LOG.touch()

def log_event(event_type: str, source: str, payload: dict[str, Any]) -> None:
    init_telemetry()
    entry = {
        "timestamp": time.time(),
        "type": event_type,
        "source": source,
        "payload": payload
    }
    with TELEMETRY_LOG.open("a") as f:
        f.write(json.dumps(entry) + "\n")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--type", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--payload", default="{}")
    args = parser.parse_args()
    
    log_event(args.type, args.source, json.loads(args.payload))
