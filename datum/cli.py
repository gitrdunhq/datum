import typer
from rich.console import Console

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

product_app = typer.Typer(
    name="product",
    help="DATUM V3 - Product (Pre-Dev) Orchestrator",
)
app.add_typer(product_app, name="product")

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
    from datum.bootstrap import seed_state_docs
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

@app.command()
def migrate(dry_run: bool = typer.Option(False, "--dry-run", help="Simulate migration without making changes")):
    """Migrate legacy .wfc repositories to .datum and upgrade schemas."""
    import sys
    from datum.migrate import migrate_wfc_directory, load_state, migrate_state, current_skill_version, save_state, STATE_SCHEMA
    
    console.print("[bold blue]Starting DATUM Migration...[/bold blue]")
    dir_changes = migrate_wfc_directory(dry_run)
    for c in dir_changes:
        console.print(f"[yellow]• {c}[/yellow]")
        
    state = load_state()
    if not state and not dir_changes:
        console.print("[green]No legacy .wfc/ directory or .datum/state.json found. Nothing to do.[/green]")
        return
        
    migrated, changes = migrate_state(state, current_skill_version())
    for c in changes:
        console.print(f"[yellow]• {c}[/yellow]")
        
    if not dry_run and state:
        save_state(migrated)
        
    try:
        from datum.contracts import validate_value
        errors = validate_value(STATE_SCHEMA, migrated) if migrated else []
    except Exception as exc:
        errors = [str(exc)]
        
    if errors:
        console.print("[bold red]Migration completed with validation errors:[/bold red]")
        for e in errors:
            console.print(f"  - {e}")
        sys.exit(1)
        
    if dry_run:
        console.print("[bold green]Dry run complete. No changes made.[/bold green]")
    else:
        console.print("[bold green]✓ Migration successful.[/bold green]")

@app.command()
def install(dry_run: bool = typer.Option(False, "--dry-run", help="Simulate installation without making changes")):
    """Install a stable snapshot of the DATUM skill globally for AI Agents."""
    import sys
    from datum.bootstrap.install_skill import install_skill_snapshot
    
    console.print("[bold blue]Installing DATUM Agent Skill globally...[/bold blue]")
    try:
        actions = install_skill_snapshot(dry_run)
        for action in actions:
            console.print(f"[yellow]• {action}[/yellow]")
            
        if dry_run:
            console.print("[bold green]Dry run complete. No changes made.[/bold green]")
        else:
            console.print("[bold green]✓ DATUM skill successfully installed and linked across all agents![/bold green]")
            console.print("\n[dim]Your agents will use the self-contained 'uv run scripts/datum.py' execution wrapper. No global installation needed![/dim]")
    except Exception as e:
        console.print(f"[bold red]Installation failed: {e}[/bold red]")
        sys.exit(1)

@product_app.command("status")
def product_status(json_output: bool = typer.Option(False, "--json", help="Output raw JSON")):
    """Show the live pipeline status for the active product run."""
    from datum.product_state import load_state
    state = load_state()
    if json_output:
        console.print(json.dumps(state, indent=2))
    else:
        if not state:
            console.print("No active product run. Run 'datum product go' to start.")
            return
        console.print(f"Product Run ID: [bold]{state.get('run_id')}[/bold]")
        console.print(f"Current Phase: [blue]{state.get('current_phase')}[/blue]")
        console.print("Phases:")
        for phase, data in state.get("phases", {}).items():
            status = data.get("status", "pending")
            color = "green" if status == "completed" else "yellow" if status == "in_progress" else "dim"
            console.print(f"  - {phase}: [{color}]{status}[/{color}]")

def main():
    """Main entrypoint for the uv-managed script."""
    app()

if __name__ == "__main__":
    main()
