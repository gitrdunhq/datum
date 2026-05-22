#!/usr/bin/env python3
"""Collect token usage metrics from state.json model log."""

import json
from pathlib import Path


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.collect-token-metrics.done")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    import sqlite3

    db_path = Path(f".datum/runs/{args.run_id}/state.db")
    if not db_path.exists():
        db_path = Path(".datum/state.db")
        
    model_log = []
    if db_path.exists():
        with sqlite3.connect(db_path) as conn:
            # Handle backward compatibility if token_metrics doesn't exist in older DBs
            try:
                cur = conn.execute("SELECT phase, model, input_tokens, output_tokens FROM token_metrics")
                for row in cur.fetchall():
                    model_log.append({
                        "phase": row[0],
                        "model": row[1],
                        "input_tokens": row[2],
                        "output_tokens": row[3]
                    })
            except sqlite3.OperationalError:
                pass

    per_phase: dict[str, dict] = {}
    per_model: dict[str, dict] = {}
    total_input = total_output = 0

    for entry in model_log:
        phase = entry.get("phase", "unknown")
        model = entry.get("model", "unknown")
        inp = entry.get("input_tokens", 0)
        out = entry.get("output_tokens", 0)
        
        total_input += inp
        total_output += out
        
        if phase not in per_phase:
            per_phase[phase] = {"input": 0, "output": 0, "models": {}}
        per_phase[phase]["input"] += inp
        per_phase[phase]["output"] += out
        
        if model not in per_phase[phase]["models"]:
            per_phase[phase]["models"][model] = {"input": 0, "output": 0}
        per_phase[phase]["models"][model]["input"] += inp
        per_phase[phase]["models"][model]["output"] += out

        if model not in per_model:
            per_model[model] = {"input": 0, "output": 0}
        per_model[model]["input"] += inp
        per_model[model]["output"] += out

    data = {
        "total_input": total_input,
        "total_output": total_output,
        "total": total_input + total_output,
        "per_phase": per_phase,
        "per_model": per_model,
    }

    out_path = Path(f".datum/runs/{args.run_id}/closeout-raw/token_metrics.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, indent=2))
    marker.write_text("done")
    print(json.dumps({"ok": True, "total_tokens": data["total"]}))


if __name__ == "__main__":
    main()
