"""Write one lane's full spec to a file in its worktree; print only short fields.

Why a file and not an echo: every attempt to move the lane's acceptance
criteria through a datum-cli runner turn corrupted them — "§4" became
"§ 4" (wf_6bfbd9f2-510), base64 past ~2.7 KB was generated rather than
copied (wf_5791e11f-693), and backticks came back as \\` (wf_47c507cf-1e5).
No LLM turn is trusted to relay content any more. This CLI writes
`<wt>/.datum/lane-spec.json` itself, checks the lane against the digest's
spec_hash, and prints `{task_id, path, bytes, sha, spec_hash, ac_count}` —
a line short enough for the runner to return intact and for the script to
sanity-check. The stage agents read the file by path and evidence the read
with its git blob sha (contextWitnessInstruction / assertReadWitness).

The file also carries `contract_summary`, the function-signature sketch
GREEN's packet used to compute in TypeScript from the criteria text
(`extractContractSummary`, retired with this module).
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from datum.lane_hash import lane_spec_hash

SCHEMA_VERSION = 1


class LaneSpecExportError(ValueError):
    """The lane could not be exported; `payload` is safe to print as JSON."""

    def __init__(self, message: str, **extra: object) -> None:
        super().__init__(message)
        self.payload: dict = {"error": message, **extra}


_BUILTIN_SKIP = frozenset(
    {
        # Python
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
        "range",
        "enumerate",
        "zip",
        "open",
        "input",
        "format",
        "repr",
        "hash",
        "id",
        "dir",
        "vars",
        "super",
        "property",
        "staticmethod",
        "classmethod",
        # Swift
        "fatalError",
        "precondition",
        "debugPrint",
        "String",
        "Int",
        "Array",
        "Dictionary",
        "Bool",
        "Optional",
        # Go
        "fmt",
        "Println",
        "Printf",
        "Sprintf",
        "make",
        "append",
        "delete",
        "panic",
        "recover",
        # TypeScript / JavaScript
        "console",
        "log",
        "parseInt",
        "parseFloat",
        "Number",
        "Object",
        "Boolean",
        "Promise",
        "setTimeout",
        "JSON",
    }
)
_FUNC_RE = re.compile(r"(?<!['\"-])(\w+)\s*\(([^)]*)\)")
_RET_RE = re.compile(r"returns?\s+(?:a\s+)?(\w+)", re.IGNORECASE)
_RAISE_RE = re.compile(r"[Rr]aises?\s+(\w+Error|\w+Exception)")


def contract_summary(acceptance_criteria: list[str] | None) -> list[dict]:
    """Port of the retired TS extractContractSummary: one entry per AC that
    names a non-builtin call, with args / returns / raises sketched out."""
    out: list[dict] = []
    for ac in acceptance_criteria or []:
        func = _FUNC_RE.search(ac)
        if not func or func.group(1) in _BUILTIN_SKIP:
            continue
        ret = _RET_RE.search(ac)
        raise_ = _RAISE_RE.search(ac)
        args = (
            [a.strip() for a in func.group(2).split(",") if a.strip()]
            if func.group(2)
            else []
        )
        out.append(
            {
                "function": func.group(1),
                "args": args,
                "returns": ret.group(1) if ret else None,
                "raises": raise_.group(1) if raise_ else None,
                "ac": ac[:120],
            }
        )
    return out


def git_blob_sha(data: bytes) -> str:
    """`git hash-object --stdin` without git: sha1 over "blob <len>\\0<data>"."""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def export_lane_spec(
    plan: dict, task_id: str, out: Path, expect_hash: str | None
) -> dict:
    """Pure-ish: write the lane file (only after every check passes) and
    return the short summary dict the CLI prints."""
    lanes = plan.get("lanes")
    if not isinstance(lanes, dict):
        raise LaneSpecExportError("lane plan has no lanes object")
    lane = lanes.get(task_id)
    if not isinstance(lane, dict):
        raise LaneSpecExportError(
            f"lane_spec_missing: {task_id} is not in the lane plan"
        )
    spec_hash = lane_spec_hash(lane)
    if expect_hash and spec_hash != expect_hash:
        raise LaneSpecExportError(
            f"lane_spec_hash_mismatch: {task_id} hashes to {spec_hash} but the digest says {expect_hash}; the plan changed between digest and intake",
            spec_hash=spec_hash,
            expected=expect_hash,
        )
    criteria = lane.get("acceptance_criteria") or []
    body = {
        "schema_version": SCHEMA_VERSION,
        **lane,
        # After the spread: the caller's id and hash win over any stray keys.
        "task_id": task_id,
        "spec_hash": spec_hash,
        "contract_summary": contract_summary(criteria),
    }
    data = (json.dumps(body, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    return {
        "task_id": task_id,
        "path": str(out),
        "bytes": len(data),
        "sha": git_blob_sha(data),
        "spec_hash": spec_hash,
        "ac_count": len(criteria),
    }


def export_lane_spec_file(
    plan_path: Path, task_id: str, out: Path, expect_hash: str | None
) -> dict:
    if not plan_path.is_file():
        raise LaneSpecExportError(f"lane plan not found: {plan_path}")
    try:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise LaneSpecExportError(
            f"lane plan is not valid JSON: {plan_path}: {exc}"
        ) from exc
    if not isinstance(plan, dict):
        raise LaneSpecExportError(f"lane plan is not a JSON object: {plan_path}")
    return export_lane_spec(plan, task_id, out, expect_hash)
