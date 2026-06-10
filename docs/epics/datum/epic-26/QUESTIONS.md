# Questions Log: datum-local M0+M1

**Run ID:** <!-- filled by datum -->

---

## Refine — 2026-06-10

No clarifying questions needed — intent is clear. The ticket is specific and concrete with well-defined scope (M0+M1), explicit acceptance criteria, and a detailed architecture plan as backing context.

All potential ambiguities have been resolved as assumptions in the SPEC's Assumption Audit (A1-A11) under yolo mode. Key assumptions:
- A1: Sibling repo materialized via bootstrap scripts (cross-repo sandbox approach)
- A3: Write-tool lane scripts must be created (verified gap in current implementation)
- A6: commit_queue usable from sibling repo with cwd set to fixture
- A10: Nested fixture git repo gitignored to avoid submodule confusion
- A11: Model stack capable of write-tool calls at 80% success rate

## Plan — 2026-06-10

### Architecture choice (pre-approved)

Architecture was pre-chosen in an approved plan-mode session (plan file: `~/.claude/plans/i-would-like-to-cozy-eclipse.md`). Approach: editable path dependency on `../datum`, bootstrap/materialize script for cross-repo sandbox constraint, bare M1 driver (no orchestrator).

Rejected alternatives:
1. **Vendoring** — rejected for drift risk and maintenance burden (must re-vendor on every datum change)
2. **Git submodule** — rejected for worse ergonomics, CI complexity, and friction with editable installs

### ASSUMED questions

1. **[impl]** How should the write-tool scripts read arguments — stdin JSON or sys.argv?
   > Context: Existing read-tool scripts (`read_file.py`, `grep_search.py`) read JSON from stdin via `json.load(sys.stdin)`.
   > [Answer]: Same pattern — JSON from stdin. Consistent with all existing lane-tool scripts. (assumed, yolo)

2. **[impl]** Should `materialize.sh` run `uv sync` as a final step, or leave that to the user?
   > Context: SPEC AC1.4 says "uv sync in ../datum-local succeeds". The bootstrap script is the natural place to run it.
   > [Answer]: Yes, `materialize.sh` runs `uv sync` as the final step. Exit non-zero if sync fails. (assumed, yolo)

3. **[impl]** What branch name should the M1 driver create in the fixture repo?
   > Context: SPEC AC7.4 says "commits to a branch". No naming convention specified.
   > [Answer]: `m1/red-green-<timestamp>` pattern. Avoids collision across runs. (assumed, yolo)

4. **[impl]** Should the contract test file run inside the datum-local venv (where datum is importable) or inside the datum repo venv?
   > Context: Contract tests validate that datum's API is importable from datum-local. They must run in the datum-local venv where the editable dep is installed.
   > [Answer]: Runs in datum-local venv only. Template authored here, executed there. (assumed, yolo)
