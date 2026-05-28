# DATUM — Agentic Production Line

DATUM automates the full software delivery cycle — from ticket to merged PR to closeout. It runs inside AI coding tools (Claude Code, Codex, Gemini CLI, Kiro, opencode) as a skill that orchestrates TDD pipelines, manages state deterministically, and enforces quality gates.

## Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/gitrdunhq/datum/main/install.sh)
```

This clones the repo, installs a `datum` CLI wrapper, and registers with all detected AI tools.

**Prerequisites:** git, [uv](https://docs.astral.sh/uv/), Python >= 3.12

## Quick Start

```bash
datum status          # pipeline status
datum doctor          # self-check contracts
datum classify        # auto-classify epic complexity
datum landscape       # generate codebase architecture scaffold
datum bugfile gate "something broke"  # self-healing: auto-file a bug
```

Inside your AI coding tool, say `datum go` to run the full pipeline, or `datum <phase>` for a single phase:

```
/datum go          Full pipeline: Refine → Plan → Act → Validate → Review → Merge → Closeout
/datum yolo        Same but skip optional gates
/datum init        Bootstrap a new repo for DATUM
/datum mermaid     Generate Mermaid diagrams
```

## Pipeline

```
Ticket → Refine → Classify → Plan → Triage → [Deepen] → Properties → Act → Validate → Review → PR → Closeout
```

Three pipeline shapes based on complexity:
- **Patch** (< 50 LOC): Express pipeline — skip Properties, single-lane Act
- **Feature** (standard): Full pipeline
- **System** (cross-cutting): Extended pipeline with units of work for parallel dev teams

## Managing Your Install

```bash
datum install              # re-register with all AI tools (from repo)
bash install.sh --status   # check what's installed
bash install.sh --update   # pull latest
bash install.sh --dev      # dev mode (symlink to local repo)
bash install.sh --uninstall
```

## Documentation

- [Full Skill Reference](docs/DATUM.md) — phases, gates, config, reference docs
- [Workflow Diagram](docs/datum-workflow.md) — mermaid flowcharts of the pipeline
- [CURRENT_STATE.md](CURRENT_STATE.md) — what shipped last
- [ROADMAP.md](ROADMAP.md) — what's next
