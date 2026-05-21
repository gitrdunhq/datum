#!/usr/bin/env python3
"""
events.py — Structured Event Ledger for the Manager Factory Floor

Handles appending structured events to `.datum/events.jsonl`.
Used by orchestrator, sidecars, and agents to record handoffs, blockers, and proof.
"""

import json
import time
import uuid
from pathlib import Path
from typing import Any, Optional

EVENTS_FILE = Path(".datum/events.jsonl")

def emit_event(
    event_type: str,
    run_id: str,
    task_id: str,
    agent_id: str,
    role: str,
    phase: str,
    status: str,
    message: str,
    severity: str = "info",
    payload: Optional[dict[str, Any]] = None
) -> dict:
    EVENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    
    event = {
        "event_id": str(uuid.uuid4()),
        "timestamp": time.time(),
        "run_id": run_id,
        "task_id": task_id,
        "agent_id": agent_id,
        "role": role,
        "phase": phase,
        "event_type": event_type,
        "status": status,
        "severity": severity,
        "message": message,
        "payload": payload or {}
    }
    
    with EVENTS_FILE.open("a") as f:
        f.write(json.dumps(event) + "\n")
        
    return event

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        print(json.dumps(emit_event("TEST", "test-run", "test-task", "test-agent", "tester", "research", "running", "Test event"), indent=2))
