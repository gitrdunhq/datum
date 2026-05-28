# DATUM — Agentic Production Line

DATUM automates the full software delivery cycle — from ticket to merged PR to closeout. It runs inside AI coding tools (Claude Code, Codex, Gemini CLI, Kiro, opencode) as a skill that orchestrates TDD pipelines, manages state deterministically, and enforces quality gates.

## Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/gitrdunhq/datum/main/install.sh)
```

This clones the repo, installs a `datum` CLI wrapper, and registers with all detected AI tools.

**Prerequisites:** git, [uv](https://docs.astral.sh/uv/), Python >= 3.12

After install, enable shell autocompletion:

```bash
datum --install-completion    # autodetects bash/zsh/fish/powershell
```

## Quick Start

```bash
datum status          # pipeline status
datum doctor          # self-check contracts
datum classify        # auto-classify epic complexity
datum landscape       # generate codebase architecture scaffold
datum floor           # launch the TUI factory floor dashboard
datum local-llm       # local LLM status + multi-turn config
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

## Local LLM

Route pipeline phases to a local MLX model (Gemma 4 26B on Apple Silicon) for cost-free inference. The retry ladder escalates to Claude on failure.

```bash
datum local-llm                          # status + config
datum local-llm what does this code do   # no quotes needed
datum local-llm --stats                  # tokens, throughput, savings
datum local-llm -m --phase triage "triage this change..."  # multi-turn mode
```

Multi-turn orchestration (opt-in via `config.toml`):
- **Two-pass DCCD** — freeform draft then grammar-constrained extraction
- **Self-consistency voting** — N-sample majority vote replaces self-reported confidence
- **Few-shot prompting** — example JSON injected for format compliance
- **Grammar-tight schemas** — Literal enums force decisions, 80-char field caps prevent degeneration
- **Quality gates** — char flood, n-gram repetition, lexical diversity checks
- **ACI tool execution** — local model can read files, grep, list dirs, run commands (write tools gated separately)
- **Temperature scheduling** — fixed, rising, falling, u_curve modes across turns

All parameters configurable per-phase in `config.toml` under `[multi_turn]`.

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
- [CHANGELOG.md](CHANGELOG.md) — release history
- [ROADMAP.md](ROADMAP.md) — what's next
