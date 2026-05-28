# Spec: Rock-Solid Installer for Team Distribution

**Run ID:** epic-7-20260527
**Phase:** Refine
**Status:** Draft

---

## 1. Summary

Harden the installer for Linux + macOS team distribution so a new gitrdunhq dev can go from zero to working datum in one command with clear error messages if prerequisites are missing.

## 2. Context

install.sh exists and works on the author's machine but has no prerequisite checks. A teammate on Ubuntu without uv gets a silent failure. The dual install paths (install.sh for users, `datum install` for dev mode) create confusion. No README explains what datum is or how to install it.

## 3. Requirements

### R1: Prerequisite checks in install.sh

**Description:** Before cloning, verify git, uv, and Python >= 3.12 are available. Print actionable install instructions if missing.

**Acceptance criteria:**
- [ ] AC1: Checks `git --version`, `uv --version`, `python3 --version` (or `python --version`)
- [ ] AC2: Python version parsed and compared >= 3.12
- [ ] AC3: If uv missing: prints install command (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- [ ] AC4: If Python < 3.12: prints upgrade guidance per platform (brew on mac, deadsnakes on Ubuntu)
- [ ] AC5: Exits with clear error message before cloning if any prerequisite fails

### R2: Post-install verification

**Description:** After cloning and registering, run a smoke test to confirm datum works.

**Acceptance criteria:**
- [ ] AC1: install.sh runs `uv run --directory "$INSTALL_DIR" datum doctor` after clone
- [ ] AC2: If doctor fails, prints error and suggests `--dev` mode for debugging
- [ ] AC3: Prints version info on success: datum version, Python version, uv version

### R3: Consolidate install paths

**Description:** `datum install` should call the same registration logic as install.sh, not copy files.

**Acceptance criteria:**
- [ ] AC1: `datum install` creates symlinks from tool skill dirs to the current repo (same as install.sh --dev)
- [ ] AC2: Remove the file-copy approach from install_skill.py
- [ ] AC3: Both paths produce identical tool registrations

### R4: Root README.md

**Description:** A proper README.md at repo root with install instructions and quick start.

**Acceptance criteria:**
- [ ] AC1: README.md exists at repo root with: what datum is (1 paragraph), install command, quick start, link to docs/DATUM.md for full reference
- [ ] AC2: Install command is a single curl-pipe-bash one-liner
- [ ] AC3: Shows example usage: `datum go`, `datum status`, `datum classify`

### R5: Cross-platform smoke test

**Description:** Verify the install works from any directory, not just the repo root.

**Acceptance criteria:**
- [ ] AC1: After install, `cd /tmp && uv run --directory ~/.agents/skills/datum datum status` works
- [ ] AC2: install.sh prints this test command at the end so the user can verify

## 4. Failure Modes and Handling

| Failure | Handling |
|---|---|
| uv not installed | Print install command, exit 1 |
| Python < 3.12 | Print platform-specific upgrade guidance, exit 1 |
| git clone fails (private repo, no access) | Print "request access to gitrdunhq/datum", exit 1 |
| doctor fails after install | Print error, suggest --dev mode, exit 1 |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Install time (fresh) | < 30 seconds on broadband |
| install.sh size | < 300 lines |
| Zero additional dependencies | install.sh uses only bash, git, uv (no curl for anything except uv install suggestion) |

## 6. Out of Scope

- Windows support
- Docker-based install
- CI/CD integration
- Auto-updating (--update exists but no cron)

## 7. Open Questions

*(none)*

## 8. Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | Team members have GitHub access to gitrdunhq/datum | Repo is under the org they're all members of | confirmed | n/a |
| 2 | uv is the standard Python tool for the team | All gitrdunhq repos use uv | confirmed | n/a |
| 3 | symlink-based registration works on Linux | Standard POSIX, tested on macOS, `ln -sfn` is portable | confirmed | n/a |

## 9. Classification Metadata

```yaml
estimated_files: 4
estimated_loc: 150
clusters_touched: 2
new_public_api: false
dependency_additions: []
```
