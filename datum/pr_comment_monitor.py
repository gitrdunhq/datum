#!/usr/bin/env python3
"""
pr_comment_monitor.py — Polls a PR for /datum commands and validates trust boundary.

Accepts only comments whose trimmed body starts with '/datum' AND whose author
login matches the PR author recorded at PR creation time (pr_author_login in state).

Comments from other authors are silently marked processed. This prevents
unauthorized requeueing from PR reviewers or bots.

Usage:
  python3 scripts/pr_comment_monitor.py --run-id <id> [--once]
  python3 scripts/pr_comment_monitor.py --run-id <id> --interval 60
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

STATE_FILE = Path(".datum/state.json")
PROCESSED_FILE_TEMPLATE = ".datum/runs/{run_id}/pr-comments-processed.json"


def load_state() -> dict:
    return json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}


def save_state(state: dict) -> None:
    tmp = STATE_FILE.with_suffix(".tmp")
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(STATE_FILE)


def gh(*args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "GITHUB_TOKEN": ""}
    return subprocess.run(["gh", *args], capture_output=True, text=True, env=env)


def fetch_pr_comments(pr_url: str) -> list[dict]:
    """Fetch all comments on the PR including review comments."""
    result = gh("pr", "view", pr_url, "--json", "comments,reviews,author", "--jq", ".")
    if result.returncode != 0:
        return []
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []

    comments = []
    for c in data.get("comments", []):
        comments.append(
            {
                "id": c.get("id", ""),
                "author": c.get("author", {}).get("login", ""),
                "body": c.get("body", "").strip(),
                "created_at": c.get("createdAt", ""),
            }
        )
    return comments


def post_reply(pr_url: str, comment_id: str, body: str) -> None:
    """Post an acknowledgement reply to a PR comment."""
    gh("pr", "comment", pr_url, "--body", body)


def load_processed(run_id: str) -> set[str]:
    p = Path(PROCESSED_FILE_TEMPLATE.format(run_id=run_id))
    if p.exists():
        return set(json.loads(p.read_text()))
    return set()


def save_processed(run_id: str, processed: set[str]) -> None:
    p = Path(PROCESSED_FILE_TEMPLATE.format(run_id=run_id))
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(sorted(processed), indent=2))


def parse_datum_command(body: str) -> str | None:
    """Extract the /datum command from a comment body. Returns None if not an datum command."""
    stripped = body.strip()
    if not stripped.lower().startswith("/datum"):
        return None
    # Extract the request after /datum
    after = stripped[4:].strip()
    return after if after else "go"


def handle_command(command: str, run_id: str, pr_url: str, state: dict) -> dict:
    """Process a validated /datum command. Returns an action dict."""
    command_lower = command.lower()

    if command_lower in ("go", "resume", ""):
        return {
            "action": "resume",
            "message": "Resuming DATUM pipeline from current state.",
        }

    if command_lower.startswith("update "):
        request = command[7:].strip()
        return {
            "action": "requeue_with_request",
            "request": request,
            "message": f"Requeueing with revision request: {request}",
        }

    if command_lower in ("status", ""):
        phase = state.get("current_phase", "unknown")
        run = state.get("run_id", "unknown")
        return {"action": "status", "message": f"Run: {run} | Phase: {phase}"}

    if command_lower == "rollback":
        return {"action": "rollback", "message": "Initiating rollback protocol."}

    return {"action": "unknown", "message": f"Unknown /datum command: {command}"}


def poll_once(run_id: str, reply_enabled: bool) -> list[dict]:
    state = load_state()
    pr_url = state.get("git", {}).get("pr_url", "")
    pr_author = state.get("git", {}).get("pr_author_login", "")

    if not pr_url:
        return []

    comments = fetch_pr_comments(pr_url)
    processed = load_processed(run_id)
    actions = []

    for comment in comments:
        comment_id = str(comment["id"])
        if comment_id in processed:
            continue

        body = comment["body"]
        author = comment["author"]
        command = parse_datum_command(body)

        if command is None:
            processed.add(comment_id)
            continue

        # Trust boundary: only PR author's commands are accepted
        if pr_author and author != pr_author:
            processed.add(comment_id)
            if reply_enabled:
                post_reply(
                    pr_url,
                    comment_id,
                    f"@{author} /datum commands are accepted only from the PR author (@{pr_author}).",
                )
            print(
                json.dumps(
                    {
                        "rejected": True,
                        "author": author,
                        "pr_author": pr_author,
                        "reason": "trust_boundary_violation",
                    }
                )
            )
            continue

        action = handle_command(command, run_id, pr_url, state)
        action["comment_id"] = comment_id
        action["author"] = author
        action["command"] = command
        actions.append(action)
        processed.add(comment_id)

        if reply_enabled:
            post_reply(pr_url, comment_id, f"✓ {action['message']}")

        print(json.dumps(action))

    save_processed(run_id, processed)
    return actions


def main() -> None:
    parser = argparse.ArgumentParser(description="PR comment monitor for /datum commands")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--once", action="store_true", help="Check once and exit")
    parser.add_argument(
        "--interval", type=int, default=60, help="Poll interval in seconds"
    )
    parser.add_argument(
        "--no-reply", action="store_true", help="Disable acknowledgement replies"
    )
    args = parser.parse_args()

    reply_enabled = not args.no_reply

    if args.once:
        actions = poll_once(args.run_id, reply_enabled)
        sys.exit(0 if not actions else 0)

    print(json.dumps({"status": "watching", "interval_s": args.interval}), flush=True)
    while True:
        try:
            poll_once(args.run_id, reply_enabled)
        except Exception as exc:
            print(json.dumps({"error": str(exc)}), flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
