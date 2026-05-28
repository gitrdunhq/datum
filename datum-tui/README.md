# datum-tui

Beta TUI for the DATUM factory floor. Loosely coupled — reads `.datum/` state files, never imports from `datum` package directly.

## Run

```bash
datum floor
```

## Architecture

The TUI reads data from the filesystem only — no tight coupling to the datum package:

| Source | What it shows |
|--------|--------------|
| `.datum/state.json` | Pipeline phase, lanes, run ID |
| `.datum/local-llm-metrics.jsonl` | Gemma stats, savings |
| `.datum/events.jsonl` | Live event stream |
| `.datum/config.toml` | Config status |
| `docs/epics/` | Epic history |
| `CURRENT_STATE.md` | Last shipped |
| `ROADMAP.md` | What's next |
