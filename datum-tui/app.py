#!/usr/bin/env python3
"""DATUM Factory Floor — TUI beta.

Run: datum floor
"""

import asyncio
import sys
from pathlib import Path

from textual.app import App, ComposeResult
from textual.widgets import Footer, Header, Static, DataTable, RichLog, Input

from data import load_state, load_metrics, load_lanes, load_config


class PipelinePanel(Static):
    def compose(self) -> ComposeResult:
        yield Static(id="pipeline-content")

    def refresh_data(self) -> None:
        state = load_state()
        config = load_config()
        local = config.get("local_llm", {})

        phase = state.get("current_phase", "idle")
        run_id = state.get("run_id", "—")
        branch = state.get("git", {}).get("work_branch", "main")
        in_flight = state.get("in_flight_count", 0)

        gemma_label = "[green]ON[/green]" if local.get("enabled") else "[dim]OFF[/dim]"
        model = local.get("model", "—").split("/")[-1]

        content = self.query_one("#pipeline-content", Static)
        content.update(
            f" [bold]Phase[/bold] {phase}"
            f"  [bold]Run[/bold] {run_id}"
            f"  [bold]Branch[/bold] {branch}"
            f"  [bold]In-flight[/bold] {in_flight}"
            f"  [bold]Gemma[/bold] {gemma_label} ({model})"
        )


class LanePanel(Static):
    def compose(self) -> ComposeResult:
        table = DataTable(id="lane-table")
        table.add_columns("Lane", "Stage", "Title")
        yield table

    def refresh_data(self) -> None:
        table = self.query_one("#lane-table", DataTable)
        table.clear()
        lanes = load_lanes()
        if not lanes:
            table.add_row("—", "[dim]no active lanes[/dim]", "")
            return
        for lane in lanes:
            stage = lane["stage"]
            if stage == "completed":
                stage = "[green]✓ done[/green]"
            elif "in_progress" in stage:
                stage = f"[yellow]⚙ {lane.get('status', '')}[/yellow]"
            elif stage == "queued":
                stage = "[dim]queued[/dim]"
            elif "failed" in stage:
                stage = "[red]✗ failed[/red]"
            table.add_row(lane["id"], stage, lane.get("title", "")[:40])


class GemmaPanel(Static):
    def compose(self) -> ComposeResult:
        yield Static(id="gemma-content")

    def refresh_data(self) -> None:
        m = load_metrics()
        content = self.query_one("#gemma-content", Static)

        if m["total_calls"] == 0:
            content.update(" [dim]No local inference yet[/dim]")
            return

        content.update(
            f" [bold]Calls[/bold] {m['total_calls']}"
            f"  [bold]Success[/bold] {m['success_rate_pct']}%"
            f"  [bold]Escalated[/bold] {m['escalated']}\n"
            f" [bold]Tokens[/bold] {m['total_tokens']:,}"
            f"  [bold]Speed[/bold] {m['avg_tokens_per_sec']} tok/s"
            f"  [bold green]Saved ${m['estimated_savings_usd']}[/bold green]"
        )


class ChatPanel(Static):
    """Chat output + input for talking to Gemma."""

    def compose(self) -> ComposeResult:
        yield RichLog(id="chat-log", highlight=True, markup=True, max_lines=500)
        yield Input(
            placeholder="Ask Gemma anything... (Enter to send)", id="chat-input"
        )


class DatumTUI(App):
    CSS = """
    Screen {
        layout: grid;
        grid-size: 2 3;
        grid-gutter: 1;
    }

    #pipeline {
        column-span: 2;
        height: 3;
        border: solid $primary;
    }

    #lanes {
        border: solid $secondary;
    }

    #gemma {
        height: 5;
        border: solid $success;
    }

    #chat {
        column-span: 2;
        border: solid $accent;
        height: 1fr;
    }

    #chat-log {
        height: 1fr;
    }

    #chat-input {
        dock: bottom;
        height: 3;
    }
    """

    TITLE = "DATUM Factory Floor"
    SUB_TITLE = "Gemma-first · Local inference · datum floor"

    BINDINGS = [
        ("q", "quit", "Quit"),
        ("r", "refresh", "Refresh"),
        ("d", "run_doctor", "Doctor"),
        ("s", "show_stats", "Stats"),
    ]

    def compose(self) -> ComposeResult:
        yield Header()
        yield PipelinePanel(id="pipeline")
        yield LanePanel(id="lanes")
        yield GemmaPanel(id="gemma")
        yield ChatPanel(id="chat")
        yield Footer()

    def on_mount(self) -> None:
        self.refresh_panels()
        self.set_interval(5, self.refresh_panels)
        self.query_one("#chat-input", Input).focus()

    def refresh_panels(self) -> None:
        self.query_one(PipelinePanel).refresh_data()
        self.query_one(LanePanel).refresh_data()
        self.query_one(GemmaPanel).refresh_data()

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        prompt = event.value.strip()
        if not prompt:
            return

        event.input.value = ""
        log = self.query_one("#chat-log", RichLog)

        log.write(f"\n[bold blue]You:[/bold blue] {prompt}")
        log.write("[dim]⠋ Generating...[/dim]")

        # Run inference in a thread so the TUI stays responsive
        result = await asyncio.to_thread(self._run_gemma, prompt)

        # Clear the spinner line
        log.write("")

        if result.get("escalated"):
            log.write(
                f"[red]↑ Escalated:[/red] {result.get('abort_reason', 'unknown')}"
            )
        elif result.get("error"):
            log.write(f"[red]Error:[/red] {result['error']}")
        else:
            text = result.get("text", "")
            # Strip Gemma thinking block if present
            if "<channel|>" in text:
                text = text.split("<channel|>", 1)[-1]
            log.write(f"[bold green]Gemma:[/bold green] {text}")

        tokens = result.get("tokens", 0)
        time_s = result.get("time_s", 0)
        log.write(f"[dim]{tokens} tokens · {time_s}s[/dim]")

        # Refresh stats after inference
        self.query_one(GemmaPanel).refresh_data()

    def _run_gemma(self, prompt: str) -> dict:
        """Run Gemma chat in a thread. Returns result dict."""
        try:
            # Add datum package to path
            skill_root = Path(__file__).resolve().parent.parent
            sys.path.insert(0, str(skill_root))

            from datum.local_llm import chat, is_available

            if not is_available():
                return {
                    "error": "MLX not available — need Apple Silicon + pip install datum[memory]"
                }

            messages = [{"role": "user", "content": prompt}]
            return chat(messages, max_tokens=4096)
        except Exception as e:
            return {"error": str(e)}

    def action_refresh(self) -> None:
        self.refresh_panels()

    def action_run_doctor(self) -> None:
        import subprocess

        result = subprocess.run(
            ["datum", "doctor"], capture_output=True, text=True, timeout=10
        )
        log = self.query_one("#chat-log", RichLog)
        log.write(f"[bold]doctor:[/bold] {result.stdout[:200]}")

    def action_show_stats(self) -> None:
        m = load_metrics()
        log = self.query_one("#chat-log", RichLog)
        log.write(
            f"[bold]stats:[/bold] calls={m['total_calls']} "
            f"tokens={m['total_tokens']:,} "
            f"saved=${m['estimated_savings_usd']} "
            f"success={m['success_rate_pct']}%"
        )


if __name__ == "__main__":
    app = DatumTUI()
    app.run()
