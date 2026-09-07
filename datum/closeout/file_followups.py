#!/usr/bin/env python3
"""File follow-up issues to the configured tracker. Idempotent via dedup_key.

#453 — staleness check: a retained finding is re-checked against the
current tree, every run, before it is filed or retained again. Findings
from an earlier closeout can already be fixed by the operator's review-
round commits by the time this collector next runs; filing (or re-
retaining) a fixed finding wastes tracker/operator attention.

The check is deliberately conservative and heuristic, since FollowUpIssue
carries no structured file/line/symbol field — only free-form title/body
text:

  * A "file citation" is the first `path/to/name.ext[:line]`-shaped token
    found in the finding's title or body, where `ext` is one of
    _SOURCE_EXTENSIONS (see _CITED_FILE_RE). An open `\w+` extension class
    also matches ordinary prose — "e.g." and version strings like
    "18.20.1" both look path-shaped — so the extension is allowlisted to
    real source/doc/config extensions instead. A finding with NO such
    token is never marked stale — there is nothing to check it against,
    so the conservative move is to leave it exactly as today.
  * A "symbol citation" is a backtick-quoted identifier found on the SAME
    LINE as the file citation (see _CITED_SYMBOL_RE) — optional even when
    a file is cited. Requiring the same line, rather than anywhere in the
    text, avoids pairing an unrelated backticked mention (e.g. "`gh` is
    not installed") with a file cited elsewhere in the body.
  * Staleness: the cited file no longer exists in the current working
    tree, OR a same-line symbol citation no longer appears (as a whole
    word) in that file's current contents. Anything else — including a
    finding whose file exists but carries no symbol citation — is left
    untouched.

A finding already filed (filed_url set) is never re-checked: the filing
decision was already made and acted on.
"""

import json
import re
import subprocess
from pathlib import Path

from pydantic import ValidationError

from datum.models.follow_up_schema import FollowUpIssue

# Extensions that plausibly name a real source/doc/config file — narrow on
# purpose so ordinary prose ("e.g.", "18.20.1") never matches (#453).
_SOURCE_EXTENSIONS = (
    r"py|tsx?|jsx?|go|rs|java|kt|rb|sh|sql|ya?ml|toml|json|md|css|s?css|html?"
)
# First `path/to/name.ext` (optionally `:line`) token in a finding's text.
_CITED_FILE_RE = re.compile(
    rf"\b([\w./-]+\.(?:{_SOURCE_EXTENSIONS}))(?::(\d+))?\b", re.IGNORECASE
)
# A backtick-quoted identifier-shaped token.
_CITED_SYMBOL_RE = re.compile(r"`([A-Za-z_][A-Za-z0-9_]*)`")


def _cited_file_and_symbol(item: dict) -> tuple[str | None, str | None]:
    """Best-effort (file, symbol) citation from a finding's title/body.
    Either or both may be None — see module docstring for the heuristic.
    The symbol is only paired with the file when both appear on the same
    line of the (title + "\\n" + body) text."""
    text = f"{item.get('title', '')}\n{item.get('body', '')}"
    file_path: str | None = None
    symbol: str | None = None
    for line in text.splitlines():
        file_match = _CITED_FILE_RE.search(line)
        if file_match is None:
            continue
        file_path = file_match.group(1)
        symbol_match = _CITED_SYMBOL_RE.search(line)
        symbol = symbol_match.group(1) if symbol_match else None
        break
    return file_path, symbol


def _is_stale(item: dict, repo_root: Path) -> bool:
    """True if this finding's file citation no longer resolves, or its
    (optional) symbol citation no longer appears in that file. A finding
    with no file citation is never stale."""
    file_path, symbol = _cited_file_and_symbol(item)
    if file_path is None:
        return False
    target = repo_root / file_path
    if not target.is_file():
        return True
    if symbol is not None:
        try:
            content = target.read_text(errors="ignore")
        except OSError:
            # Unreadable (permissions, binary decode edge case): conservative
            # — don't claim staleness on data we couldn't actually check.
            return False
        if not re.search(rf"\b{re.escape(symbol)}\b", content):
            return True
    return False


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--tracker", default="auto")
    # Only findings at or above this severity open tracker issues; the rest
    # stay in the run manifest (caliper: keep the tracker quiet, keep the data).
    parser.add_argument(
        "--min-severity",
        default="high",
        choices=["critical", "high", "medium", "low", "info"],
    )
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.file-followups.done")
    marker.parent.mkdir(parents=True, exist_ok=True)
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    # Sources, all under the run directory: the synthesis agent's manifest
    # (skills/src/prompts/closeout-synthesize.md) and one file per lane the
    # Act phase wrote for skeptic minority findings (datum-tdd-act-lane.ts).
    run_dir = marker.parent
    followups_path = run_dir / "follow-ups.json"
    followups: list = []
    if followups_path.exists():
        loaded = json.loads(followups_path.read_text())
        followups.extend(
            loaded if isinstance(loaded, list) else loaded.get("items", [])
        )
    lane_dir = run_dir / "follow-ups"
    if lane_dir.is_dir():
        for lane_file in sorted(lane_dir.glob("*.json")):
            loaded = json.loads(lane_file.read_text())
            followups.extend(
                loaded if isinstance(loaded, list) else loaded.get("items", [])
            )
    if not followups:
        marker.write_text("done")
        print(json.dumps({"ok": True, "filed": 0, "reason": "no follow-ups"}))
        return
    # dedup_key is the idempotency key across sources and re-runs.
    seen: set = set()
    unique: list = []
    for item in followups:
        key = item.get("dedup_key") if isinstance(item, dict) else None
        if key is not None:
            if key in seen:
                continue
            seen.add(key)
        unique.append(item)
    followups = unique

    invalid: list[dict] = []
    invalid_items: list[dict] = []
    valid_followups: list[dict] = []
    for item in followups:
        try:
            FollowUpIssue(**item)
        except ValidationError as exc:
            invalid.append({"item": item, "errors": exc.errors(include_url=False)})
            invalid_items.append(item)
        else:
            valid_followups.append(item)
    followups = valid_followups

    # Detect tracker
    tracker = args.tracker
    if tracker == "auto":
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
        )
        remote = result.stdout.strip()
        if "github.com" in remote:
            tracker = "github"
        else:
            tracker = "local"

    # #453 — re-check every unfiled finding against the current tree before
    # it can be filed or retained again: a finding fixed by the operator's
    # review-round commits since the manifest was last written must not be
    # filed (or kept looking active) as if it still applied. Already-filed
    # findings are exempt: the filing decision was already made and acted
    # on, and re-checking them here would be pointless (the issue exists
    # regardless of what the tree looks like now).
    repo_root = Path.cwd()
    head_result = subprocess.run(
        ["git", "rev-parse", "HEAD"], capture_output=True, text=True
    )
    head_sha = head_result.stdout.strip() if head_result.returncode == 0 else "unknown"
    stale: list[dict] = []
    still_active: list[dict] = []
    for item in followups:
        if item.get("filed_url") or not _is_stale(item, repo_root):
            still_active.append(item)
            continue
        item["stale_since"] = head_sha
        stale.append(item)
    followups = still_active

    filed = []
    retained = []
    retained_below_threshold = []
    rank = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    threshold = rank[args.min_severity]

    for item in followups:
        if item.get("filed_url"):
            filed.append(item)
            continue

        if rank.get(str(item.get("severity")), 99) > threshold:
            retained_below_threshold.append(item)
            continue

        if tracker == "github":
            title = item.get("title", "Follow-up")
            body = item.get("body", "")
            labels = ",".join(item.get("suggested_labels", ["datum-followup"]))
            result = subprocess.run(
                [
                    "gh",
                    "issue",
                    "create",
                    "--title",
                    title,
                    "--body",
                    body,
                    "--label",
                    labels,
                ],
                capture_output=True,
                text=True,
                env={
                    "PATH": "/usr/bin:/usr/local/bin",
                    "HOME": str(Path.home()),
                    **__import__("os").environ,
                },
            )
            if result.returncode == 0:
                item["filed_url"] = result.stdout.strip()
                filed.append(item)
            else:
                retained.append(item)
        else:
            retained.append(item)

    # Write back with filed URLs populated
    all_items = filed + retained + retained_below_threshold + invalid_items + stale
    followups_path.write_text(json.dumps(all_items, indent=2))

    marker.write_text("done")
    result_payload = {
        "ok": True,
        "filed": len(filed),
        "retained": len(retained),
        "retained_below_threshold": len(retained_below_threshold),
        "stale": len(stale),
        "min_severity": args.min_severity,
        "manifest": str(followups_path),
        "tracker": tracker,
    }
    if invalid:
        result_payload["invalid"] = len(invalid)
        result_payload["invalid_details"] = invalid
    print(json.dumps(result_payload))


if __name__ == "__main__":
    main()
