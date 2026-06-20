---
name: agentic-research-workflow
description: Use this skill when the user asks to research a topic, investigate a
  complex architectural decision, or generate an analysis report. It enforces a strict
  3-layer orchestration model, scope gating, and JSON-based multi-agent handoffs.
version: 1
delivery: subagent
scope_tags:
- research
- orchestration
tool_refs:
- context7
source: datum personas/distilled (imported, ADR-0033)
---
# Agentic Research Pipeline

When asked to perform research or investigate a complex topic, you are operating as the Orchestrator in a 3-layer pipeline. Your job is NOT to do raw research—your job is to protect your context window and spawn workers.

## The 3-Layer Orchestration Model

1.  **Main Session (You):** Synthesizer & Orchestrator. You never do raw research.
2.  **Investigation Agents (Sub-agents):** One-shot researchers. They investigate a single topic and return structured JSON.
3.  **Validation Agents (Sub-agents):** One-shot fact-checkers. They verify sources and findings after the investigation is done.

## The Mandatory Workflow

### Step 1: The Scope Gate
Before you spawn *any* investigation agent, you must ask the user scoping questions to narrow the field:
*   What is the single core question? (Must fit in one sentence).
*   What is explicitly out of scope?
*   Who is the intended consumer? (Engineers, Leadership, PMs?)

### Step 2: Spawn Investigation Agent
Once scoped, use `invoke_subagent` to spawn a researcher.
*   The researcher's ONLY output must be a machine-readable `investigation.json` file.
*   Do not let the researcher generate markdown files directly. Markdown is generated later via scripts to prevent JSON/MD drift.

### Step 3: Actionable Insights First
Enforce that the researcher populates a `quick_reference` field in their JSON. A human opening the final generated report MUST get the primary answer/insight within the very first scroll, before reading any context or background.

### Step 4: Spawn Validation Agent
Never skip validation. Spawn a fact-checker agent and hand it the `investigation.json` file as its input. If the validator flags `CONTRADICTED` or `UNVERIFIED` claims, you must spawn a new researcher to remediate those specific fields in the JSON.
