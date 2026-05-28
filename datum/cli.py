from pathlib import Path

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


@app.command()
def floor():
    """Render the live Manager Factory Floor dashboard."""
    render_floor()


@app.command()
def doctor(
    phase: str = typer.Option("act", help="The current DATUM phase"),
    role: str = typer.Option("general", help="The agent's role"),
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
    from datum.state import ensure_feature_branch
    from datum.bootstrap import seed_state_docs
    import sys

    branch = ensure_feature_branch()
    console.print(f"[dim]Branch: {branch}[/dim]")
    console.print("[bold green]Bootstrapping DATUM...[/bold green]")
    try:
        seed_state_docs.main()
        console.print("[bold green]✓ Repo seeded.[/bold green]")
    except Exception as e:
        console.print(f"[bold red]Bootstrap failed: {e}[/bold red]")
        sys.exit(1)


@app.command()
def migrate(
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Simulate migration without making changes"
    )
):
    """Migrate legacy .wfc repositories to .datum and upgrade schemas."""
    import sys
    from datum.migrate import (
        migrate_wfc_directory,
        load_state,
        migrate_state,
        current_skill_version,
        save_state,
    )

    console.print("[bold blue]Starting DATUM Migration...[/bold blue]")
    dir_changes = migrate_wfc_directory(dry_run)
    for c in dir_changes:
        console.print(f"[yellow]• {c}[/yellow]")

    state = load_state()
    if not state and not dir_changes:
        console.print(
            "[green]No legacy .wfc/ directory or .datum/state.json found. Nothing to do.[/green]"
        )
        return

    migrated, changes = migrate_state(state, current_skill_version())
    for c in changes:
        console.print(f"[yellow]• {c}[/yellow]")

    if not dry_run and state:
        save_state(migrated)

    try:
        from datum.contracts import validate_value

        errors = validate_value("state.schema.json", migrated) if migrated else []
    except Exception as exc:
        errors = [str(exc)]

    if errors:
        console.print(
            "[bold red]Migration completed with validation errors:[/bold red]"
        )
        for e in errors:
            console.print(f"  - {e}")
        sys.exit(1)

    if dry_run:
        console.print("[bold green]Dry run complete. No changes made.[/bold green]")
    else:
        console.print("[bold green]✓ Migration successful.[/bold green]")


@app.command()
def install(
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Simulate installation without making changes"
    )
):
    """Register DATUM with all detected AI coding tools via symlinks."""
    import sys
    from datum.bootstrap.install_skill import install_skill_snapshot

    console.print("[bold blue]Registering DATUM with AI tools...[/bold blue]")
    try:
        actions = install_skill_snapshot(dry_run)
        for action in actions:
            console.print(f"[yellow]• {action}[/yellow]")

        if dry_run:
            console.print("[bold green]Dry run complete. No changes made.[/bold green]")
        else:
            console.print(
                "[bold green]✓ DATUM registered across all detected AI tools.[/bold green]"
            )
    except Exception as e:
        console.print(f"[bold red]Registration failed: {e}[/bold red]")
        sys.exit(1)


@app.command()
def classify(
    spec_path: str = typer.Option("SPEC.md", help="Path to SPEC.md"),
):
    """Classify epic complexity and determine pipeline shape."""
    import subprocess

    from datum.classify import classify as do_classify
    from datum.classify import parse_classification_metadata

    def _resolve_epic_dir():
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        return Path(f"docs/epics/{branch}")

    epic_dir = _resolve_epic_dir()
    epic_spec = epic_dir / spec_path
    if epic_spec.exists():
        spec_text = epic_spec.read_text()
    elif Path(spec_path).exists():
        spec_text = Path(spec_path).read_text()
    else:
        console.print(
            f"[bold red]SPEC.md not found at {epic_spec} or {spec_path}[/bold red]"
        )
        raise typer.Exit(1)

    metadata = parse_classification_metadata(spec_text)
    config = {}  # TODO: load [classification] from config.toml
    result = do_classify(metadata, config)
    console.print(json.dumps(result, indent=2))


@app.command()
def landscape(
    force: bool = typer.Option(False, "--force", help="Regenerate even if cached"),
):
    """Generate docs/LANDSCAPE.md from filesystem analysis."""
    from datum.landscape import generate_scaffold

    result = generate_scaffold(Path("."), force=force)

    out_path = Path("docs/LANDSCAPE.md")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(result["markdown"])

    status = "cache hit" if result["cache_hit"] else "generated"
    console.print(f"[bold green]✓ docs/LANDSCAPE.md ({status})[/bold green]")


@app.command()
def bugfile(
    module: str = typer.Argument(
        ..., help="Module that hit the bug (e.g. gate, lane_plan)"
    ),
    message: str = typer.Argument(..., help="One-line error description"),
    trace: str = typer.Option("", help="Full traceback or error output"),
):
    """File a GitHub issue for a DATUM pipeline bug (self-healing)."""
    from datum.report_bug import report_bug

    url = report_bug(module, message, {"trace": trace} if trace else None)
    if url:
        console.print(f"[bold green]✓ Filed: {url}[/bold green]")
    else:
        console.print("[yellow]Skipped — duplicate issue already open[/yellow]")


def main():
    """Main entrypoint for the uv-managed script."""
    app()


if __name__ == "__main__":
    main()
