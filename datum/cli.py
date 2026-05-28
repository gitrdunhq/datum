from pathlib import Path

import typer
from rich.console import Console

from datum.floor import render_floor
from datum.rules_doctor import do_preflight
from datum.status_render import load_state, render
import json

__version__ = "2.0.0"


def _version_callback(value: bool):
    if value:
        print(f"datum {__version__}")
        raise typer.Exit()


app = typer.Typer(
    name="datum",
    help="DATUM V2 - Agentic Production Line Orchestrator",
    add_completion=False,
)


@app.callback(invoke_without_command=True)
def main_callback(
    version: bool = typer.Option(
        False,
        "--version",
        "-v",
        callback=_version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
):
    pass


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


@app.command(name="local-llm")
def local_llm_cmd(
    prompt: str = typer.Argument("", help="Prompt to send (empty = show status)"),
    stats: bool = typer.Option(False, "--stats", help="Show inference metrics"),
):
    """Test local LLM inference via MLX (beta)."""
    from datum.local_llm import is_available, load_config, chat

    config = load_config()

    if stats:
        from datum.local_llm import get_metrics_summary

        m = get_metrics_summary()
        console.print("[bold]Local LLM metrics:[/bold]")
        console.print(f"  Total calls: {m['total_calls']}")
        console.print(f"  Escalated to Claude: {m.get('escalated', 0)}")
        console.print(f"  Success rate: {m.get('success_rate_pct', 0)}%")
        console.print(f"  Total tokens: {m['total_tokens']}")
        console.print(f"  Total time: {m['total_time_s']}s")
        console.print(f"  Avg tokens/sec: {m.get('avg_tokens_per_sec', 0)}")
        console.print(
            f"  [bold green]Estimated savings: ${m.get('estimated_savings_usd', 0)}[/bold green]"
        )
        return

    if not prompt:
        import platform

        console.print("[bold]Local LLM status:[/bold]")
        console.print(f"  Platform: {platform.system()} {platform.machine()}")
        console.print(f"  MLX available: {is_available()}")
        if not is_available():
            if platform.system() != "Darwin" or platform.machine() != "arm64":
                console.print(
                    "  [yellow]Local LLM requires Apple Silicon (macOS arm64)[/yellow]"
                )
            else:
                console.print(
                    "  [yellow]Install MLX: pip install datum[memory][/yellow]"
                )
        console.print(f"  Enabled: {config.get('enabled', False)}")
        console.print(f"  Model: {config.get('model', 'not set')}")
        console.print(f"  Max tokens: {config.get('max_tokens')}")
        console.print(f"  Phases: {config.get('phases', [])}")
        return

    if not is_available():
        import platform

        if platform.system() != "Darwin" or platform.machine() != "arm64":
            console.print("[red]Local LLM requires Apple Silicon (macOS arm64)[/red]")
        else:
            console.print(
                "[red]MLX not available. Install: pip install datum[memory][/red]"
            )
        raise typer.Exit(1)

    console.print(f"[dim]Loading {config['model']}...[/dim]")
    messages = [{"role": "user", "content": prompt}]
    result = chat(
        messages,
        model_id=config["model"],
        max_tokens=config.get("max_tokens", 8192),
        temperature=config.get("temperature", 0.3),
    )
    console.print(f"\n{result['text']}")
    console.print(
        f"\n[dim]{result['tokens']} tokens, {result['time_s']}s, {result['model']}[/dim]"
    )


@app.command()
def dream(
    memory_dir: str = typer.Option("", help="Override memory directory path"),
    audit_only: bool = typer.Option(
        False, "--audit-only", help="Only run staleness audit"
    ),
    extract_only: bool = typer.Option(
        False, "--extract-only", help="Only run transcript extraction"
    ),
    semantic: bool = typer.Option(
        True,
        "--semantic/--regex",
        help="Use MLX semantic search (default) or regex fallback",
    ),
):
    """Run memory consolidation — staleness audit + semantic transcript extraction."""

    if not memory_dir:
        cwd = Path.cwd()
        project_hash = str(cwd).replace("/", "-")
        memory_dir = str(Path.home() / ".claude" / "projects" / project_hash / "memory")

    mem_path = Path(memory_dir)
    if not mem_path.is_dir():
        console.print(
            f"[yellow]No memory directory at {memory_dir} — nothing to consolidate.[/yellow]"
        )
        return

    from datum.memory_audit import audit_directory

    console.print("[bold blue]Phase 0: Staleness audit...[/bold blue]")
    stale = audit_directory(mem_path)
    if stale:
        console.print(f"[yellow]Found {len(stale)} stale memories:[/yellow]")
        for s in stale:
            console.print(
                f"  {s['name']} ({s['type']}, {s['age_days']}d old) → [bold]{s['action']}[/bold]"
            )
    else:
        console.print("  ✓ No stale memories")

    if audit_only:
        console.print(json.dumps(stale, indent=2))
        return

    transcripts_dir = mem_path.parent
    transcripts = sorted(
        transcripts_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True
    )[:2]

    if not transcripts:
        console.print("[yellow]No transcripts found — skipping extraction.[/yellow]")
        return

    console.print(
        f"\n[bold blue]Phase 2: Extracting from {len(transcripts)} transcript(s)...[/bold blue]"
    )

    if semantic:
        from datum.memory_semantic import extract_semantic

        console.print("  Using MLX semantic search (Jina v5)")
        results = {
            "high_confidence": [],
            "medium_confidence": [],
            "total": 0,
            "method": "semantic",
        }
        for t in transcripts:
            r = extract_semantic(t)
            results["high_confidence"].extend(r.get("high_confidence", []))
            results["medium_confidence"].extend(r.get("medium_confidence", []))
            results["total"] += r.get("total", 0)
            if r.get("method") == "regex_fallback":
                console.print(
                    "  [yellow]MLX not available — fell back to regex[/yellow]"
                )
                results["method"] = "regex_fallback"
        high = results["high_confidence"]
        medium = results["medium_confidence"]
    else:
        from datum.memory_extract import _extract_from_transcript

        console.print("  Using regex extraction")
        all_candidates = []
        for t in transcripts:
            all_candidates.extend(_extract_from_transcript(t))
        high = [c for c in all_candidates if c["confidence"] == "high"]
        medium = [c for c in all_candidates if c["confidence"] == "medium"]

    console.print(
        f"  {len(high)} high-confidence, {len(medium)} medium-confidence candidates"
    )

    if extract_only:
        console.print(
            json.dumps({"high_confidence": high, "medium_confidence": medium}, indent=2)
        )
        return

    if high:
        console.print("\n[bold green]High-confidence (auto-write):[/bold green]")
        for c in high[:10]:
            score = f" ({c['score']})" if "score" in c else ""
            console.print(
                f"  [{c.get('suggested_type', 'feedback')}]{score} {c['source_quote'][:100]}..."
            )

    if medium:
        console.print("\n[yellow]Medium-confidence (review):[/yellow]")
        for c in medium[:10]:
            score = f" ({c['score']})" if "score" in c else ""
            console.print(
                f"  [{c.get('suggested_type', 'feedback')}]{score} {c['source_quote'][:100]}..."
            )

    console.print(
        f"\n[bold green]✓ Dream complete. "
        f"{len(stale)} stale, {len(high)} high, {len(medium)} medium candidates.[/bold green]"
    )


def main():
    """Main entrypoint for the uv-managed script."""
    app()


if __name__ == "__main__":
    main()
