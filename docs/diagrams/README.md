# FLOW diagrams

Rendered from the Mermaid blocks in [docs/FLOW.md](../FLOW.md) (`mmdc`, 2× scale). Teal double-bordered or hexagonal nodes and the teal participant box are deterministic steps (a `datum` CLI, a bash batch, or the script reading an exit code); purple nodes and the purple box are LLM agents, which propose and never decide.

| File | Section |
|---|---|
| `flow-propose-verify.png` | The propose/verify shape every gate takes |
| `flow-pipeline.png` | §1 The pipeline — phases, gates, halts |
| `flow-lane-sequence.png` | §3 One lane — intake, RED, GREEN, skeptic, REFACTOR |
| `flow-lane-states.png` | §3 Lane states |

Re-render after editing FLOW.md: extract each ```mermaid block to a `.mmd` file and run `mmdc -i <block>.mmd -o docs/diagrams/<name>.png -w 2000 -s 2 -b white`.
