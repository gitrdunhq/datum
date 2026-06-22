import json
from collections import defaultdict
from pathlib import Path

from rich.console import Console
from rich.table import Table

console = Console()

def run_retrospect(n_transcripts: int = 5):
    """
    Read last N transcripts, group failures by FailureLayer,
    and emit a summary.
    """
    transcripts_dir = Path(".datum/transcripts")
    if not transcripts_dir.exists():
        console.print("[yellow]No transcripts directory found.[/yellow]")
        return

    # Find the N most recent jsonl files
    files = list(transcripts_dir.glob("*.jsonl"))
    if not files:
        console.print("[yellow]No transcripts found.[/yellow]")
        return
        
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    target_files = files[:n_transcripts]

    failures_by_layer = defaultdict(list)

    for fpath in target_files:
        try:
            with fpath.open("r", encoding="utf-8") as f:
                for line in f:
                    if not line.strip():
                        continue
                    try:
                        record = json.loads(line)
                        if record.get("event") == "error" or record.get("action") == "escalate":
                            layer = record.get("layer")
                            if layer:
                                failures_by_layer[layer].append(record)
                    except json.JSONDecodeError:
                        continue
        except OSError:
            pass

    if not failures_by_layer:
        console.print(f"[green]No failures found in the last {len(target_files)} transcripts.[/green]")
        return

    console.print(f"\n[bold]Retrospective Summary (Last {len(target_files)} transcripts)[/bold]")
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Layer")
    table.add_column("Count")
    table.add_column("Sample Reason")

    for layer, records in failures_by_layer.items():
        sample_reason = records[-1].get("observation", records[-1].get("reason", "Unknown"))
        if len(sample_reason) > 60:
            sample_reason = sample_reason[:57] + "..."
        table.add_row(layer.upper(), str(len(records)), sample_reason)

    console.print(table)
    
    console.print("\n[bold]Suggested Harness Patch Locations:[/bold]")
    if "context" in failures_by_layer:
        console.print("- [blue]CONTEXT[/blue]: Improve context retrieval in 'datum.observability' or RAG prompts.")
    if "constraint" in failures_by_layer:
        console.print("- [blue]CONSTRAINT[/blue]: Update 'datum.command_guard' or sandbox enforcement.")
    if "verification" in failures_by_layer:
        console.print("- [blue]VERIFICATION[/blue]: Enhance 'tdd_driver' or 'caliper_blast_radius' post-check logic.")
    if "planning" in failures_by_layer:
        console.print("- [blue]PLANNING[/blue]: Refine orchestration in 'agent_loop.py' (loop breakers, timeouts).")
    
    console.print("\n")
