import json
from pathlib import Path

import typer
from rich.console import Console

from datum.rules_doctor import do_preflight
from datum.status_render import load_state, render

__version__ = "2.0.0"


def _version_callback(value: bool):
    if value:
        print(f"datum {__version__}")
        raise typer.Exit()


app = typer.Typer(
    name="datum",
    help="DATUM V2 - Agentic Production Line Orchestrator",
    add_completion=True,
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
    import os

    project_dir = os.environ.get("DATUM_PROJECT_DIR")
    if project_dir:
        os.chdir(project_dir)


console = Console()
console_err = Console(stderr=True)


@app.command()
def floor():
    """Launch the Factory Floor TUI dashboard."""
    import subprocess
    import sys

    from datum.path_utils import skill_root

    tui_app = skill_root() / "datum-tui" / "app.py"
    if not tui_app.exists():
        console.print(f"[red]TUI not found at {tui_app}[/red]")
        raise typer.Exit(1)
    sys.exit(subprocess.call([sys.executable, str(tui_app)]))


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


@app.command(name="language-detect")
def language_detect_cmd(path: str = typer.Option(".", help="Path to the repository")):
    """Detect primary repo language."""
    import json
    from pathlib import Path

    from datum.language_detect import detect

    root = Path(path).resolve()
    result = detect(root)
    console.print(json.dumps(result))


@app.command(name="lane-plan")
def lane_plan_cmd(
    validate: bool = typer.Option(False, "--validate", help="Validate tasks.json only"),
    input_file: str = typer.Option("tasks.json", "--input", help="Input tasks JSON"),
    output_file: str = typer.Option(
        ".datum/lane-plan.json", "--output", help="Output lane plan JSON"
    ),
    md_output: str = typer.Option("TASKS.md", "--md-output", help="Output tasks MD"),
):
    """Builds lane-plan.json and TASKS.md from tasks.json."""
    import sys
    from unittest.mock import patch

    from datum.lane_plan import main as lane_plan_main

    args = ["lane_plan.py"]
    if validate:
        args.append("--validate")
    args.extend(
        ["--input", input_file, "--output", output_file, "--md-output", md_output]
    )

    with patch.object(sys, "argv", args):
        lane_plan_main()


def _install_workflows():
    """Symlink datum workflow JS files to ~/.claude/workflows/."""
    import os

    package_dir = Path(__file__).resolve().parent.parent
    skills_dir = package_dir / "skills"
    target_dir = Path.home() / ".claude" / "workflows"
    target_dir.mkdir(parents=True, exist_ok=True)

    js_files = sorted(skills_dir.glob("datum-*.js"))
    if not js_files:
        console.print(
            "[yellow]No workflow JS files found in package — skipping[/yellow]"
        )
        return

    installed = 0
    for js in js_files:
        link = target_dir / js.name
        if link.is_symlink() or link.exists():
            if link.is_symlink() and os.readlink(str(link)) == str(js):
                continue
            link.unlink()
        link.symlink_to(js)
        installed += 1

    total = len(js_files)
    if installed > 0:
        console.print(
            f"[dim]Workflows: {installed} installed, {total - installed} already current → ~/.claude/workflows/[/dim]"
        )
    else:
        console.print(f"[dim]Workflows: {total} already current[/dim]")


@app.command()
def init(
    name: str = typer.Option(
        None,
        "--name",
        help="Epic title; slugified into a descriptive datum/<slug> branch (#55).",
    ),
):
    """Bootstrap the repository for DATUM execution."""
    import subprocess
    import sys

    from datum.bootstrap import seed_state_docs
    from datum.detect import detect_repo
    from datum.state import ensure_feature_branch

    res = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True)
    if res.returncode != 0:
        console.print(
            "[bold red]Cannot init — repo has no commits. Run `git commit` first.[/bold red]"
        )
        raise typer.Exit(1)

    # Auto-detect repo configuration
    config = detect_repo(".")
    config_path = Path(".datum/config.json")
    config_path.parent.mkdir(parents=True, exist_ok=True)

    if config_path.exists():
        existing = json.loads(config_path.read_text())
        console.print(
            "[dim]Existing config found — merging (existing values preserved)[/dim]"
        )
        for k, v in config.items():
            existing.setdefault(k, v)
        config = existing

    config_path.write_text(json.dumps(config, indent=2) + "\n")
    console.print(
        f"[bold]Detected:[/bold] {config['language']}/{config['test_framework']}"
    )
    console.print(f"[bold]Test cmd:[/bold] {config['test_command']}")
    console.print(f"[dim]Config written to {config_path}[/dim]")

    branch = ensure_feature_branch(name)
    console.print(f"[dim]Branch: {branch}[/dim]")

    # Create epic dir and TICKET.md
    epic_dir = Path(
        config.get("epic_dir_pattern", "docs/epics/{branch}").format(branch=branch)
    )
    epic_dir.mkdir(parents=True, exist_ok=True)
    ticket_path = epic_dir / "TICKET.md"
    if not ticket_path.exists():
        ticket_path.write_text(
            "# [Epic Title]\n\n## What\n\n## Requirements\n\n## Not This\n\n"
        )
        console.print(f"[dim]TICKET.md created at {ticket_path} — fill it in[/dim]")

    # Install workflows to ~/.claude/workflows/
    _install_workflows()

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
        current_skill_version,
        load_state,
        migrate_state,
        migrate_wfc_directory,
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

    from datum.classify import classify as do_classify, parse_classification_metadata

    def _resolve_epic_dir():
        root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        return Path(root) / "docs" / "epics" / branch

    epic_dir = _resolve_epic_dir()
    epic_spec = epic_dir / spec_path
    # Also try the relative epic path (works when git toplevel resolves differently, e.g. /Volumes)
    rel_epic_spec = (
        Path("docs")
        / "epics"
        / subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        / spec_path
    )

    if epic_spec.exists():
        spec_text = epic_spec.read_text()
    elif rel_epic_spec.exists():
        spec_text = rel_epic_spec.read_text()
    elif Path(spec_path).exists():
        spec_text = Path(spec_path).read_text()
    else:
        console.print(
            f"[bold red]SPEC.md not found at {epic_spec}, {rel_epic_spec}, or {spec_path}[/bold red]"
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

    if not out_path.exists() or out_path.stat().st_size == 0:
        console.print(f"[bold red]Failed to write {out_path}[/bold red]")
        raise typer.Exit(1)

    status = "cache hit" if result["cache_hit"] else "generated"
    console.print(f"[bold green]✓ docs/LANDSCAPE.md ({status})[/bold green]")


@app.command(
    context_settings={"allow_extra_args": True, "ignore_unknown_options": True}
)
def gate(ctx: typer.Context):
    """Run DATUM gate validator (internal)."""
    import subprocess
    import sys

    res = subprocess.run([sys.executable, "-m", "datum.gate"] + ctx.args)
    raise typer.Exit(res.returncode)


@app.command(
    context_settings={"allow_extra_args": True, "ignore_unknown_options": True},
    name="test-signal",
)
def test_signal(ctx: typer.Context):
    """Run DATUM test signal extractor (internal)."""
    import subprocess
    import sys

    res = subprocess.run([sys.executable, "-m", "datum.test_signal"] + ctx.args)
    raise typer.Exit(res.returncode)


@app.command(
    context_settings={"allow_extra_args": True, "ignore_unknown_options": True}
)
def skeleton(ctx: typer.Context):
    """Run DATUM skeleton creator (internal)."""
    import subprocess
    import sys

    res = subprocess.run([sys.executable, "-m", "datum.skeleton_creator"] + ctx.args)
    raise typer.Exit(res.returncode)


@app.command(
    context_settings={"allow_extra_args": True, "ignore_unknown_options": True},
    name="commit-queue",
)
def commit_queue(ctx: typer.Context):
    """Run DATUM commit queue manager (internal)."""
    import subprocess
    import sys

    res = subprocess.run([sys.executable, "-m", "datum.commit_queue"] + ctx.args)
    raise typer.Exit(res.returncode)


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


def _strip_thinking(text: str) -> str:
    if "<channel|>" in text:
        return text.split("<channel|>", 1)[1].strip()
    if "<|channel>" in text:
        return ""
    return text


@app.command(
    name="local-llm",
    context_settings={"allow_extra_args": True, "allow_interspersed_args": False},
)
def local_llm_cmd(
    ctx: typer.Context,
    prompt: str = typer.Argument("", help="Prompt to send (empty = show status)"),
    stats: bool = typer.Option(False, "--stats", help="Show inference metrics"),
    system: str = typer.Option(
        "", "--system", "-s", help="System prompt prepended to messages"
    ),
    max_tokens: int = typer.Option(
        0, "--max-tokens", "-n", help="Override max output tokens (0 = use config)"
    ),
    temperature: float = typer.Option(
        -1.0, "--temperature", "-t", help="Override temperature (-1 = use config)"
    ),
    output_json: bool = typer.Option(
        False, "--json", help="Output full result as JSON (for pipelines)"
    ),
    strip_thinking: bool = typer.Option(
        True,
        "--strip-thinking/--no-strip-thinking",
        help="Strip model thinking channel from output",
    ),
    multi_turn: bool = typer.Option(
        False, "--multi-turn", "-m", help="Force multi-turn mode for this prompt"
    ),
    phase: str = typer.Option(
        "", "--phase", "-p", help="Simulate a pipeline phase (for multi-turn testing)"
    ),
    mt_max_turns: int = typer.Option(
        0, "--mt-turns", help="Override multi-turn max turns (0 = use config)"
    ),
    mt_confidence: float = typer.Option(
        -1.0, "--mt-confidence", help="Override confidence threshold (-1 = use config)"
    ),
    mt_schedule: str = typer.Option(
        "",
        "--mt-schedule",
        help="Override temperature schedule (fixed/rising/falling/u_curve)",
    ),
    mt_timeout: int = typer.Option(
        0, "--mt-timeout", help="Override total timeout seconds (0 = use config)"
    ),
):
    """Local LLM inference via MLX. Use --json for pipeline integration."""
    from datum.local_llm import generate, is_available, load_config

    if ctx.args:
        prompt = (
            (prompt + " " + " ".join(ctx.args)).strip()
            if prompt
            else " ".join(ctx.args)
        )

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

        from datum.local_llm import _load_multi_turn_config

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

        mt_config = _load_multi_turn_config("_global")
        console.print("\n[bold]Multi-turn orchestration:[/bold]")
        console.print(f"  Enabled: {mt_config.get('enabled', False)}")
        console.print(f"  Max turns: {mt_config.get('max_turns', 5)}")
        console.print(f"  Timeout: {mt_config.get('timeout_s', 300)}s")
        console.print(f"  Turn timeout: {mt_config.get('turn_timeout_s', 90)}s")
        console.print(
            f"  Confidence threshold: {mt_config.get('confidence_threshold', 0.8)}"
        )
        console.print(
            f"  Temperature schedule: {mt_config.get('temperature_schedule', 'fixed')}"
        )
        console.print(f"  Planning turn: {mt_config.get('planning_turn', True)}")
        console.print(
            f"  Verification turn: {mt_config.get('verification_turn', True)}"
        )
        console.print(
            f"  Retry on low confidence: {mt_config.get('retry_on_low_confidence', True)}"
        )
        console.print(f"  Context reserve: {mt_config.get('context_reserve_pct', 20)}%")
        mt_phases = mt_config.get("phases", [])
        console.print(
            f"  Multi-turn phases: {mt_phases if mt_phases else '[dim]none[/dim]'}"
        )
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

    resolved_max_tokens = (
        max_tokens if max_tokens > 0 else config.get("max_tokens", 8192)
    )
    resolved_temperature = (
        temperature if temperature >= 0 else config.get("temperature", 0.3)
    )

    if multi_turn or phase:
        from datum.local_llm import multi_turn_phase

        resolved_phase = phase or "triage"
        mt_overrides: dict = {"enabled": True}
        if mt_max_turns > 0:
            mt_overrides["max_turns"] = mt_max_turns
        if mt_confidence >= 0:
            mt_overrides["confidence_threshold"] = mt_confidence
        if mt_schedule:
            mt_overrides["temperature_schedule"] = mt_schedule
        if mt_timeout > 0:
            mt_overrides["timeout_s"] = mt_timeout
        if resolved_phase not in config.get("phases", []):
            mt_overrides.setdefault("phases", [resolved_phase])

        if not output_json:
            console_err.print(
                f"[dim]Multi-turn mode · phase={resolved_phase} · "
                f"loading {config['model']}...[/dim]"
            )

        result = multi_turn_phase(
            resolved_phase,
            prompt,
            max_tokens=resolved_max_tokens,
            mt_overrides=mt_overrides,
        )

        if output_json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            turns = result.get("turns", [])
            for t in turns:
                turn_type = t.get("type", "?")
                turn_num = t.get("turn", "?")
                if turn_type == "plan":
                    console.print(f"\n[bold cyan]Turn {turn_num} (plan):[/bold cyan]")
                    console.print(json.dumps(t.get("data", {}), indent=2))
                elif turn_type == "step":
                    data = t.get("data", {})
                    agreement = t.get("agreement", data.get("confidence", 0))
                    color = (
                        "green"
                        if agreement >= 0.8
                        else "yellow" if agreement >= 0.5 else "red"
                    )
                    samples_info = (
                        f" samples={t['samples']}" if t.get("samples") else ""
                    )
                    console.print(
                        f"\n[bold]Turn {turn_num} "
                        f"({data.get('action', '?')}):[/bold] "
                        f"[{color}]agreement={agreement}[/{color}]"
                        f"[dim]{samples_info}[/dim]"
                    )
                    if data.get("finding"):
                        console.print(f"  Finding: {data['finding']}")
                    if data.get("evidence"):
                        console.print(f"  Evidence: {data['evidence']}")
                    if data.get("recommendation"):
                        console.print(
                            f"  Recommendation: [bold]{data['recommendation']}[/bold]"
                        )
                elif turn_type == "synthesis":
                    console.print("\n[bold magenta]Synthesis turn:[/bold magenta]")

            if result.get("escalated"):
                console.print(f"\n[red]Escalated: {result.get('reason', '?')}[/red]")
            else:
                console.print("\n[green]Completed locally[/green]")

            console.print(
                f"\n[dim]{len(turns)} turns, "
                f"{result.get('total_tokens', 0)} tokens, "
                f"{result.get('total_time_s', 0)}s[/dim]"
            )
        return

    if not output_json:
        console_err.print(f"[dim]Loading {config['model']}...[/dim]")

    result = generate(
        prompt=prompt,
        system=system,
        model_id=config["model"],
        max_tokens=resolved_max_tokens,
        temperature=resolved_temperature,
    )

    if strip_thinking:
        result["text"] = _strip_thinking(result["text"])

    if output_json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        console.print(f"\n{result['text']}")
        console.print(
            f"\n[dim]{result['tokens']} tokens, "
            f"{result['time_s']}s, {result['model']}[/dim]"
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


@app.command()
def walkthrough():
    """Generate a walkthrough document for the current epic."""
    import subprocess

    from datum.walkthrough import generate_walkthrough

    try:
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if branch.returncode != 0 or not branch.stdout.strip():
            console.print("[bold red]Could not resolve git branch.[/bold red]")
            raise typer.Exit(1)
        epic_dir = Path(f"docs/epics/{branch.stdout.strip()}")
    except (subprocess.TimeoutExpired, FileNotFoundError):
        console.print(
            "[bold red]git not available — cannot resolve epic directory.[/bold red]"
        )
        raise typer.Exit(1) from None

    if not epic_dir.exists():
        console.print(f"[bold red]Epic directory not found: {epic_dir}[/bold red]")
        raise typer.Exit(1)

    output_path = generate_walkthrough(epic_dir)
    console.print(f"[bold green]✓ Walkthrough generated: {output_path}[/bold green]")


@app.command()
def closeout(
    run_id: str = typer.Option(None, help="Run ID (default: YYYYMMDD-HHMMSS)"),
    base_sha: str = typer.Option(None, help="Base SHA (default: merge-base with main)"),
    merge_sha: str = typer.Option(None, help="Merge SHA (default: git HEAD)"),
    epic_number: int = typer.Option(
        None, help="Epic number (default: parsed from branch)"
    ),
    synthesize: bool = typer.Option(
        False, "--synthesize", help="Generate RETRO.md synthesis"
    ),
    skip_archive: bool = typer.Option(
        False, "--skip-archive", help="Skip run archiving"
    ),
):
    """Run DATUM closeout: collect metrics, collate, archive run."""
    from datum.closeout_cmd import (
        detect_context,
        run_archive,
        run_collate,
        run_stage1,
        sweep_project_memories,
    )

    try:
        ctx = detect_context(run_id, base_sha, merge_sha, epic_number)
    except Exception as e:
        console.print(f"[bold red]Closeout failed: {e}[/bold red]")
        raise typer.Exit(1) from e

    console.print(
        f"[bold blue]Closeout run {ctx['run_id']} — epic {ctx['epic_number']}[/bold blue]"
    )
    console.print(
        f"[dim]base: {ctx['base_sha'][:8]}  merge: {ctx['merge_sha'][:8]}[/dim]"
    )

    console.print("[dim]Stage 1: collecting metrics...[/dim]")
    results = run_stage1(ctx["run_id"], ctx["base_sha"], ctx["merge_sha"])
    ok = sum(1 for r in results.values() if r.get("ok"))
    console.print(f"[dim]  {ok}/{len(results)} collectors succeeded[/dim]")

    console.print("[dim]Collating...[/dim]")
    try:
        closeout_data = run_collate(ctx["run_id"], ctx["merge_sha"], ctx["epic_number"])
        console.print(
            f"[bold green]✓ closeout-data.json → {closeout_data}[/bold green]"
        )
    except Exception as e:
        console.print(f"[bold red]Collate failed: {e}[/bold red]")
        raise typer.Exit(1) from e

    if synthesize:
        console.print("[dim]Synthesizing RETRO.md...[/dim]")
        try:
            from datum.render import render_closeout_retro

            retro_path = Path(f"docs/epics/{ctx['branch']}/RETRO.md")
            render_closeout_retro(closeout_data, retro_path)
            console.print(
                f"[bold green]✓ RETRO.md generated → {retro_path}[/bold green]"
            )
        except Exception as e:
            console.print(f"[bold yellow]Synthesis failed: {e}[/bold yellow]")

    console.print("[dim]Generating walkthrough...[/dim]")
    from datum.walkthrough import generate_walkthrough

    epic_dir = Path(f"docs/epics/{ctx['branch']}")
    if epic_dir.exists():
        try:
            wt_path = generate_walkthrough(epic_dir)
            console.print(
                f"[bold green]✓ Walkthrough generated → {wt_path}[/bold green]"
            )
        except Exception as e:
            console.print(
                f"[bold yellow]Walkthrough generation failed: {e}[/bold yellow]"
            )
    else:
        console.print(f"[dim]Skipping walkthrough: {epic_dir} not found[/dim]")

    console.print("[dim]Running /dream memory consolidation...[/dim]")
    try:
        # Pass semantic=False to keep closeout fast, or True if MLX is desired. Let's use False for fast Regex fallback
        dream(memory_dir="", audit_only=False, extract_only=False, semantic=False)
    except Exception as e:
        console.print(f"[bold yellow]Memory consolidation failed: {e}[/bold yellow]")

    if not skip_archive:
        run_archive(ctx["run_id"])
        console.print("[dim]✓ Run archived[/dim]")

    try:
        cwd = Path.cwd()
        project_hash = str(cwd).replace("/", "-")
        memory_dir = Path.home() / ".claude" / "projects" / project_hash / "memory"
        count = sweep_project_memories(memory_dir, ctx["branch"])
        if count > 0:
            console.print(f"[dim]✓ Swept {count} project-state memories[/dim]")
    except Exception as e:
        console.print(f"[yellow]Failed to sweep memories: {e}[/yellow]")

    console.print(
        "[bold green]✓ Closeout complete. Run `datum dream` for memory consolidation.[/bold green]"
    )


@app.command()
def gc(
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Scan and report without deleting anything"
    ),
    transcript_days: int = typer.Option(
        7, "--transcript-days", help="Retain transcripts for this many days"
    ),
    checkpoint_days: int = typer.Option(
        3, "--checkpoint-days", help="Retain agent checkpoints for this many days"
    ),
    failure_days: int = typer.Option(
        30, "--failure-days", help="Retain failure records for this many days"
    ),
    context_days: int = typer.Option(
        1, "--context-days", help="Retain context/step-*.txt files for this many days"
    ),
    run_days: int = typer.Option(
        90, "--run-days", help="Retain completed run directories for this many days"
    ),
):
    """Garbage-collect stale .datum/ artifacts past their retention windows.

    Cleans transcripts, agent checkpoints, failure records, and context
    offload files. Use --dry-run to preview without deleting.
    """
    from datum.gc import GcConfig, format_gc_report, run_gc
    from datum.path_utils import datum_dir

    cfg = GcConfig(
        transcript_retention_days=transcript_days,
        checkpoint_retention_days=checkpoint_days,
        failure_retention_days=failure_days,
        context_retention_days=context_days,
        run_retention_days=run_days,
        dry_run=dry_run,
    )

    target = datum_dir()
    if not target.exists():
        console.print("[dim].datum/ directory not found — nothing to collect.[/dim]")
        return

    result = run_gc(target, cfg)
    report = format_gc_report(result)

    if dry_run:
        console.print(f"[yellow]{report}[/yellow]")
    elif result.deleted_count == 0:
        console.print(f"[dim]{report}[/dim]")
    else:
        console.print(f"[bold green]{report}[/bold green]")

    if not dry_run:
        import subprocess
        import sys

        console.print("\n[bold]Running scheduled entropy pass...[/bold]")

        console.print("\n[dim]--- Knowledge Drift ---[/dim]")
        subprocess.run([sys.executable, "-m", "datum.knowledge_drift"])

        console.print("\n[dim]--- Rules Doctor ---[/dim]")
        subprocess.run([sys.executable, "-m", "datum.rules_doctor", "preflight"])

        console.print("\n[dim]--- Memory Audit ---[/dim]")
        project_hash = str(target.parent.resolve()).replace("/", "-")
        memory_dir = Path.home() / ".claude" / "projects" / project_hash / "memory"
        if memory_dir.exists():
            subprocess.run(
                [sys.executable, "-m", "datum.memory_audit", str(memory_dir)]
            )
        else:
            console.print("[dim]No memory dir found; skipping memory audit.[/dim]")


@app.command()
def corpus(
    query: str = typer.Argument(
        ..., help="SQL SELECT query, or 'SHOW TABLES' to list views"
    ),
    limit: int = typer.Option(
        20, "--limit", "-n", help="Max rows (default 20, max 50)"
    ),
    repo: str = typer.Option(
        ".", "--repo", help="Path to the repository root (default: cwd)"
    ),
):
    """Query .datum artifacts via DuckDB SQL views.

    Available views: transcripts, failures, run_state, lane_files,
    token_metrics, kv_state, floor_runs.

    Examples:

      datum corpus "SHOW TABLES"

      datum corpus "SELECT phase, reason FROM failures LIMIT 5"

      datum corpus "SELECT lane, count(*) AS n FROM lane_files GROUP BY lane ORDER BY n DESC"
    """
    from pathlib import Path as _Path

    try:
        from datum.memory.corpus_sql import run_corpus_query
    except ImportError:
        console.print(
            "[bold red]duckdb not installed — run: uv pip install 'datum[rag]'[/bold red]"
        )
        raise typer.Exit(1) from None

    repo_root = _Path(repo).resolve()
    result = run_corpus_query(query, limit=limit, repo_root=repo_root)
    console.print(result)


memory_app = typer.Typer(name="memory", help="Corpus ingestion and semantic search.")
app.add_typer(memory_app)


@memory_app.command("ingest")
def memory_ingest(
    collection: str = typer.Option(
        "docs",
        "--collection",
        "-c",
        help="Collection name to ingest into (default: docs)",
    ),
    paths: list[str] | None = None,
    force: bool = typer.Option(
        False, "--force", "-f", help="Re-ingest even if unchanged."
    ),
    repo: str = typer.Option(".", "--repo", help="Repo root (default: cwd)"),
):
    """Ingest corpus files into the vector index.

    Walks the given paths (or sensible defaults), chunks each file, embeds
    with the available provider (TF-IDF or sentence-transformers), and writes
    into .datum/index/<collection>.npz.  Files unchanged since last ingest
    are skipped automatically (ledger dedup).

    Examples:

      datum memory ingest

      datum memory ingest --collection specs docs/

      datum memory ingest --force --collection docs docs/

    """
    import hashlib as _hashlib
    from pathlib import Path as _Path

    repo_root = _Path(repo).resolve()
    index_dir = repo_root / ".datum" / "index"

    try:
        from datum.memory.embeddings import get_embedding_provider
        from datum.memory.generic_chunker import GenericChunker
        from datum.memory.ledger import IngestionLedger
        from datum.memory.vector_store import NumpyVectorStore
    except ImportError as exc:
        console.print(f"[bold red]Import error: {exc}[/bold red]")
        raise typer.Exit(1) from None

    # Resolve ingestion targets.
    target_paths: list[_Path] = []
    if paths:
        for p in paths:
            resolved = _Path(p).resolve()
            if resolved.exists():
                target_paths.append(resolved)
            else:
                console.print(f"[yellow]Warning: path not found — {p}[/yellow]")
    else:
        # Sensible defaults: docs/ and datum/ prose.
        for candidate in [
            "docs",
            "AGENTS.md",
            "PROPERTIES.md",
            "CURRENT_STATE.md",
            "CHANGELOG.md",
        ]:
            p = repo_root / candidate
            if p.exists():
                target_paths.append(p)

    if not target_paths:
        console.print(
            "[yellow]No paths to ingest. Pass paths as arguments or add a docs/ directory.[/yellow]"
        )
        raise typer.Exit(0)

    ledger = IngestionLedger(index_dir / "ledger.db")
    store = NumpyVectorStore(index_dir)

    try:
        provider = get_embedding_provider(persist_dir=index_dir)
    except ImportError as exc:
        console.print(f"[bold red]No embedding backend: {exc}[/bold red]")
        ledger.close()
        raise typer.Exit(1) from None

    chunker = GenericChunker()

    # Collect all files to process.
    def _iter_files(p: _Path):
        if p.is_file():
            yield p
        elif p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file() and not any(part.startswith(".") for part in f.parts):
                    yield f

    total_files = 0
    skipped = 0
    ingested = 0
    total_chunks = 0

    for target in target_paths:
        for file_path in _iter_files(target):
            # Compute file sha256 for ledger dedup.
            try:
                content = file_path.read_bytes()
            except OSError:
                continue
            sha256 = _hashlib.sha256(content).hexdigest()
            path_str = str(file_path)

            total_files += 1

            if not force and ledger.is_ingested(path_str, sha256):
                skipped += 1
                continue

            # Chunk the file.
            chunks = chunker.chunk_file(
                file_path, source_label=str(file_path.relative_to(repo_root))
            )
            if not chunks:
                ledger.record_ingestion(path_str, sha256, "doc", 0)
                ingested += 1
                continue

            texts = [c.text for c in chunks]
            metas = [
                {
                    "text": c.text,
                    "source": c.source,
                    "section": c.section,
                    "chunk_id": c.chunk_id,
                }
                for c in chunks
            ]
            ids = [c.chunk_id for c in chunks]

            try:
                embeddings = provider.embed(texts)
                store.upsert(
                    collection=collection,
                    ids=ids,
                    embeddings=embeddings,
                    metadatas=metas,
                )
                ledger.record_ingestion(path_str, sha256, "doc", len(chunks))
                ingested += 1
                total_chunks += len(chunks)
            except Exception as exc:  # noqa: BLE001
                console.print(
                    f"[yellow]Warning: failed to embed {file_path.name}: {exc}[/yellow]"
                )
                continue

    ledger.close()

    console.print(
        f"[bold green]Ingestion complete:[/bold green] "
        f"{ingested} ingested, {skipped} skipped (unchanged), "
        f"{total_chunks} chunks → collection [cyan]{collection}[/cyan]"
    )


@memory_app.command("search")
def memory_search(
    query: str = typer.Argument(..., help="Natural-language search query"),
    collection: str = typer.Option(
        "docs", "--collection", "-c", help="Collection to search (default: docs)"
    ),
    top_k: int = typer.Option(
        5, "--top-k", "-k", help="Number of results (default: 5)"
    ),
    repo: str = typer.Option(".", "--repo", help="Repo root (default: cwd)"),
):
    """Semantic search over an ingested corpus collection.

    The corpus must be ingested first with `datum memory ingest`.

    Examples:

      datum memory search "cosine similarity implementation"

      datum memory search "spec TOML format" --collection specs --top-k 3

    """
    from pathlib import Path as _Path

    repo_root = _Path(repo).resolve()
    index_dir = repo_root / ".datum" / "index"

    if not (index_dir / f"{collection}.npz").exists():
        console.print(
            f"[yellow]Collection [cyan]{collection}[/cyan] not indexed — "
            f"run: datum memory ingest --collection {collection}[/yellow]"
        )
        raise typer.Exit(1)

    try:
        from datum.memory.embeddings import get_embedding_provider
        from datum.memory.rag_engine import RAGEngine
    except ImportError as exc:
        console.print(f"[bold red]Import error: {exc}[/bold red]")
        raise typer.Exit(1) from None

    try:
        provider = get_embedding_provider(persist_dir=index_dir)
    except ImportError as exc:
        console.print(f"[bold red]No embedding backend: {exc}[/bold red]")
        raise typer.Exit(1) from None

    engine = RAGEngine(store_dir=index_dir, embedding_provider=provider)

    try:
        results = engine.search(query_text=query, collection=collection, top_k=top_k)
    except Exception as exc:  # noqa: BLE001
        console.print(f"[bold red]Search error: {exc}[/bold red]")
        raise typer.Exit(1) from None

    if not results:
        console.print("[dim]No results found.[/dim]")
        raise typer.Exit(0)

    for i, r in enumerate(results, 1):
        source = r.chunk.source or collection
        section = r.chunk.section or ""
        header = f"[cyan]{source}[/cyan]" + (
            f"[dim]#{section}[/dim]" if section else ""
        )
        console.print(
            f"\n[bold]{i}.[/bold] {header}  [dim](score: {r.score:.3f})[/dim]"
        )
        preview = r.chunk.text[:400].replace("\n", " ")
        console.print(f"  {preview}")


@app.command()
def retrospect(
    run_id: str = typer.Option(
        None, "--run-id", help="Analyse a single run ID (default: last N runs)"
    ),
    last_n: int = typer.Option(10, "--last-n", help="Number of recent runs to analyse"),
    json_output: bool = typer.Option(False, "--json", help="Output raw JSON"),
    datum_dir_opt: str = typer.Option(
        ".datum", "--datum-dir", help="Path to .datum directory"
    ),
):
    """Analyse completed runs — failure patterns, slow phases, improvement suggestions.

    Reads .datum/runs/*/events.jsonl, groups failures by FailureLayer, and
    emits structured insights with suggested harness patch locations.
    """
    from datum.retrospect import RetrospectConfig, run_retrospect

    cfg = RetrospectConfig(
        datum_dir=Path(datum_dir_opt),
        last_n_runs=last_n,
        run_id=run_id or None,
    )
    result = run_retrospect(cfg)

    if json_output:
        console.print(json.dumps(result.to_dict(), indent=2))
        return

    console.print(
        f"\n[bold blue]Retrospect — {result.runs_analysed} run(s) analysed[/bold blue]"
    )

    if result.runs_analysed == 0:
        console.print("[dim]No runs found. Run some epics first.[/dim]")
        return

    console.print(f"\n[bold]Failures by layer[/bold] (total: {result.total_failures})")
    if result.failures_by_layer:
        for layer, count in sorted(
            result.failures_by_layer.items(), key=lambda x: -x[1]
        ):
            bar = "█" * min(count, 20)
            console.print(f"  {layer:<16} {count:>3}  {bar}")
    else:
        console.print("  [dim]No failures recorded.[/dim]")

    if result.slow_phases:
        console.print("\n[bold]Slow phases[/bold]")
        for sp in result.slow_phases:
            console.print(
                f"  {sp['phase']:<14} {sp['total_s']:>7.1f}s  ({sp['event_count']} events)"
            )

    if result.tool_usage:
        console.print("\n[bold]Tool usage[/bold]")
        for tool, count in sorted(result.tool_usage.items(), key=lambda x: -x[1])[:10]:
            console.print(f"  {tool:<20} {count:>4}")

    if result.recurring_patterns:
        console.print("\n[bold yellow]Recurring failure patterns[/bold yellow]")
        for p in result.recurring_patterns:
            console.print(
                f"  [{p['layer']}] {p['reason']}  "
                f"({p['run_count']} runs, {p['total_occurrences']} occurrences)"
            )

    if result.suggestions:
        console.print("\n[bold green]Suggested harness patches[/bold green]")
        for s in result.suggestions:
            console.print(f"  • {s}")

    console.print()


# ── Worktree lifecycle management (#133) ─────────────────────────────────────

worktrees_app = typer.Typer(
    name="worktrees", help="Pipeline worktree lifecycle management."
)
app.add_typer(worktrees_app)


@worktrees_app.command("setup")
def worktrees_setup(
    run_id: str = typer.Option(..., "--run-id", help="Unique pipeline run identifier"),
    epic_branch: str = typer.Option(..., "--epic-branch", help="Epic branch name"),
    lane_ids: str = typer.Option(..., "--lane-ids", help="Comma-separated lane IDs"),
):
    """Create one worktree per lane for parallel ACT execution."""
    from datum.worktree_manager import setup_pipeline_worktrees

    ids = [lid.strip() for lid in lane_ids.split(",") if lid.strip()]
    mapping = setup_pipeline_worktrees(run_id, epic_branch, ids)
    result = {k: str(v) for k, v in mapping.items()}
    typer.echo(json.dumps(result, indent=2))


@worktrees_app.command("merge")
def worktrees_merge(
    epic_branch: str = typer.Option(..., "--epic-branch", help="Epic branch name"),
    lane_order: str = typer.Option(
        ..., "--lane-order", help="Comma-separated lane IDs in dependency order"
    ),
    commit_message: str = typer.Option(
        ..., "--commit-message", help="Merge commit message"
    ),
):
    """Squash-merge completed lane branches into the epic branch."""
    from datum.worktree_manager import merge_lane_branches

    order = [lid.strip() for lid in lane_order.split(",") if lid.strip()]
    sha = merge_lane_branches(epic_branch, order, commit_message)
    typer.echo(json.dumps({"sha": sha, "merged": order}))


@worktrees_app.command("cleanup")
def worktrees_cleanup(
    run_id: str = typer.Option(..., "--run-id", help="Run ID to clean up"),
    epic_branch: str = typer.Option(..., "--epic-branch", help="Epic branch name"),
):
    """Remove all lane worktrees for a given run."""
    from datum.worktree_manager import cleanup_run_worktrees

    cleaned = cleanup_run_worktrees(run_id, epic_branch)
    typer.echo(json.dumps({"cleaned": cleaned}))


# ── TDD stage verification (#133) ────────────────────────────────────────────


@app.command(name="verify-stage")
def verify_stage_cmd(
    stage: str = typer.Argument(
        ..., help="Stage to verify: 'red', 'green', or 'baseline'"
    ),
    repo_path: str = typer.Option(".", "--repo", help="Repository root path"),
    test_command: str = typer.Option(
        "pytest -q", "--test-command", help="Test runner command"
    ),
):
    """Verify TDD stage gate: RED tests must fail, GREEN tests must pass."""
    import shlex

    from datum.tdd_driver import (
        DirtyBaselineError,
        GreenBlindnessError,
        verify_green_baseline,
        verify_red_stage,
    )

    cmd = shlex.split(test_command)
    path = Path(repo_path).resolve()

    try:
        if stage == "red":
            signal = verify_red_stage(path, test_command=cmd)
            typer.echo(
                json.dumps({"verified": True, "stage": "red", "test_signal": signal})
            )
        elif stage in ("green", "baseline"):
            verify_green_baseline(path, test_command=cmd)
            typer.echo(json.dumps({"verified": True, "stage": stage}))
        else:
            typer.echo(
                json.dumps({"verified": False, "error": f"Unknown stage: {stage}"})
            )
            raise typer.Exit(1)
    except GreenBlindnessError as e:
        typer.echo(json.dumps({"verified": False, "stage": "red", "error": str(e)}))
        raise typer.Exit(1) from None
    except DirtyBaselineError as e:
        typer.echo(json.dumps({"verified": False, "stage": stage, "error": str(e)}))
        raise typer.Exit(1) from None


@app.command(name="tdd-args")
def tdd_args_cmd(
    feature: str = typer.Option(
        "",
        "--feature",
        help="Feature name to use as the epic branch base. Defaults to current git branch.",
    ),
    lane_plan: str = typer.Option(
        ".datum/lane-plan.json",
        "--lane-plan",
        help="Path to lane-plan.json",
    ),
    repo: str = typer.Option(".", "--repo", help="Repository root (default: cwd)"),
):
    """Emit structured TDD workflow arguments as JSON.

    Outputs a JSON object with epicBranch, runId, lanePlanPath, testCommand,
    and language — ready for consumption by the TDD driver loop.

    Examples:

      datum tdd-args --feature "BETA / GA"

      datum tdd-args

    """
    import re
    from datetime import datetime

    # Resolve feature name: --feature is required.
    if not feature:
        typer.echo(
            "Error: --feature is required. Provide the feature name, e.g.:\n"
            '  datum tdd-args --feature "My Feature"',
            err=False,
        )
        raise typer.Exit(code=1)

    # Sanitize feature name into a git branch slug.
    slug = feature.lower()
    slug = slug.replace(" ", "-")
    slug = re.sub(r"[^a-zA-Z0-9\-_]", "", slug)
    slug = re.sub(r"-{2,}", "-", slug)
    slug = slug.strip("-")
    slug = slug[:64]

    epic_branch = f"feat/{slug}"

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")

    # Detect test command.
    repo_root = Path(repo).resolve()
    pyproject_path = repo_root / "pyproject.toml"
    test_command = "uv run pytest -x -q"
    if pyproject_path.exists():
        try:
            content = pyproject_path.read_text(encoding="utf-8")
            if "[tool.pytest" in content:
                test_command = "uv run pytest -x -q"
        except OSError:
            pass

    # Detect language.
    language = "python"

    output = {
        "epicBranch": epic_branch,
        "runId": run_id,
        "lanePlanPath": lane_plan,
        "testCommand": test_command,
        "language": language,
    }
    print(json.dumps(output, indent=2))


def main():
    """Main entrypoint for the uv-managed script."""
    try:
        app()
    except Exception as e:
        import sys
        import traceback

        import click
        import typer

        if isinstance(
            e, (click.exceptions.Exit, click.exceptions.ClickException, typer.Exit)
        ):
            raise

        from datum.report_bug import _sanitize

        trace_str = _sanitize(traceback.format_exc())

        console.print(
            f"[bold red]DATUM encountered an unexpected error: {e}[/bold red]"
        )
        console.print(f"[dim]{trace_str}[/dim]")
        console.print(
            "\n[yellow][Agent Hint] If you are an AI, file a bug report for this using:\n"
            'datum bugfile <module> "<one-line description>" --trace "<traceback>"[/yellow]'
        )

        if sys.stdout.isatty() and sys.stdin.isatty():
            try:
                if typer.confirm(
                    "\nWould you like to auto-file this bug to GitHub?", default=False
                ):
                    from datum.report_bug import report_bug

                    url = report_bug("datum.cli", str(e), {"trace": trace_str})
                    if url:
                        console.print(f"[bold green]✓ Bug filed: {url}[/bold green]")
                    else:
                        console.print(
                            "[yellow]Skipped — duplicate issue already open or failed to file.[/yellow]"
                        )
            except Exception:
                pass

        sys.exit(1)


if __name__ == "__main__":
    main()
