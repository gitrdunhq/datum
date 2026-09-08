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
    db_error = None
    if db_path.exists():
        with sqlite3.connect(db_path) as conn:
            # Handle backward compatibility if token_metrics doesn't exist in older DBs
            try:
                cur = conn.execute(
                    "SELECT phase, model, input_tokens, output_tokens FROM token_metrics"
                )
                for row in cur.fetchall():
                    model_log.append(
                        {
                            "phase": row[0],
                            "model": row[1],
                            "input_tokens": row[2],
                            "output_tokens": row[3],
                        }
                    )
            except sqlite3.OperationalError as e:
                db_error = f"token_metrics table not found or database error: {e}"

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

    # No source is NOT zero: nothing in the pipeline writes the token_metrics
    # table this collector reads (elonchesd epic-2: every closeout said 0
    # tokens while the Workflow tool had reported ~9.6M). Say so by name so
    # collate carries it as a collector warning; the real producer is #459.
    if not model_log:
        if not db_path.exists():
            reason = f"no state.db at .datum/runs/{args.run_id}/state.db or .datum/state.db (no producer writes one)"
        elif db_error:
            reason = db_error
        else:
            reason = "state.db has a token_metrics table with no rows"
        data = {
            "status": "no_state_available",
            "collected": False,
            "reason": reason,
            "total_input": None,
            "total_output": None,
            "total": None,
            "per_phase": {},
            "per_model": {},
        }
    else:
        data = {
            "collected": True,
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
    result: dict = {
        "ok": True,
        "collected": data["collected"],
        "total_tokens": data["total"],
    }
    if not data["collected"]:
        result["skipped"] = True
        result["reason"] = data["reason"]
    print(json.dumps(result))


if __name__ == "__main__":
    main()
