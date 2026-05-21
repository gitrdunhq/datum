import typer
from rich.console import Console
from rich.panel import Panel

from datum.floor import render_floor
from datum.rules_doctor import do_preflight
from datum.status_render import load_state, render
import json

app = typer.Typer(
    name="datum",
    help="DATUM V2 - Agentic Production Line Orchestrator",
    add_completion=False,
)
console = Console()

@app.command()
def floor():
    """Render the live Manager Factory Floor dashboard."""
    render_floor()

@app.command()
def doctor(
    phase: str = typer.Option("act", help="The current DATUM phase"),
    role: str = typer.Option("general", help="The agent's role")
):
    """Run the Rules Doctor preflight evaluation."""
    do_preflight(phase, role)

@app.command()
def status(json_output: bool = typer.Option(False, "--json", help="Output raw JSON")):
    """Show the live pipeline status for the active run."""
    state = load_state()
    if json_output:
        console.print(json.dumps(state, indent=2))
    else:
        console.print(render(state))

@app.command()
def init():
    """Bootstrap the repository for DATUM execution."""
    # We will import the bootstrap scripts dynamically so they don't load immediately
    # unless init is called.
    from datum.bootstrap import setup_symlinks, install_hooks, install_linter_rules, seed_state_docs
    import sys
    
    console.print("[bold green]Bootstrapping DATUM...[/bold green]")
    try:
        # Simplistic wrapper for the moment; full bootstrap usually runs as subprocesses in old install
        # For now, just call seed_state_docs as an example of working execution.
        seed_state_docs.main()
        console.print("[bold green]✓ Repo seeded.[/bold green]")
    except Exception as e:
        console.print(f"[bold red]Bootstrap failed: {e}[/bold red]")
        sys.exit(1)

def main():
    """Main entrypoint for the uv-managed script."""
    app()

if __name__ == "__main__":
    main()
