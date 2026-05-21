#!/usr/bin/env python3
"""
floor.py — Manager Factory Floor Dashboard

Reads `.datum/events.jsonl` and renders a live CLI view of what agents are doing.
"""

import json
from pathlib import Path
import datetime

EVENTS_FILE = Path(".datum/events.jsonl")

def load_events():
    events = []
    if EVENTS_FILE.exists():
        with EVENTS_FILE.open("r") as f:
            for line in f:
                if line.strip():
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    return events

def render_floor():
    events = load_events()
    
    # State projection
    agents = {}
    for e in events:
        agent_id = e.get("agent_id", "unknown")
        agents[agent_id] = e

    print("+" + "-" * 88 + "+")
    print(f"| MANAGER FACTORY FLOOR{' ' * 66}|")
    print("+" + "-" * 15 + "+" + "-" * 15 + "+" + "-" * 15 + "+" + "-" * 12 + "+" + "-" * 26 + "+")
    print(f"| {'Agent':<13} | {'Role':<13} | {'Task':<13} | {'Status':<10} | {'Last Event':<24} |")
    print("+" + "-" * 15 + "+" + "-" * 15 + "+" + "-" * 15 + "+" + "-" * 12 + "+" + "-" * 26 + "+")
    
    if not agents:
        print(f"| {'(No activity)':<13} | {'':<13} | {'':<13} | {'':<10} | {'':<24} |")
    else:
        for a_id, e in agents.items():
            role = e.get("role", "")[:13]
            task = e.get("task_id", "")[:13]
            status = e.get("status", "")[:10]
            msg = e.get("message", "")[:24]
            a_name = a_id[:13]
            print(f"| {a_name:<13} | {role:<13} | {task:<13} | {status:<10} | {msg:<24} |")
            
    print("+" + "-" * 15 + "+" + "-" * 15 + "+" + "-" * 15 + "+" + "-" * 12 + "+" + "-" * 26 + "+")

if __name__ == "__main__":
    render_floor()
