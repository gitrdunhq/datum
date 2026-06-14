#!/usr/bin/env python3
"""Seed CURRENT_STATE.md and ROADMAP.md if missing."""

import json
import subprocess
from pathlib import Path

from datum.path_utils import templates_dir


def _read_template(name: str) -> str:
    path = templates_dir() / name
    if path.exists():
        return path.read_text()
    raise FileNotFoundError(f"Template not found: {path}")


def seed_hooks() -> list[str]:
    """Copy all datum hooks to the target project's .datum/hooks/."""
    from datum.path_utils import assets_dir

    src_hooks = assets_dir() / "hooks"
    if not src_hooks.exists():
        return []

    dest_hooks = Path(".datum/hooks")
    dest_hooks.mkdir(parents=True, exist_ok=True)
    seeded = []
    for hook in src_hooks.glob("*.sh"):
        dest = dest_hooks / hook.name
        if not dest.exists() or dest.read_text() != hook.read_text():
            dest.write_text(hook.read_text())
            dest.chmod(0o755)
            seeded.append(str(dest))
    for hook in src_hooks.glob("*.py"):
        dest = dest_hooks / hook.name
        if not dest.exists() or dest.read_text() != hook.read_text():
            dest.write_text(hook.read_text())
            seeded.append(str(dest))
    return seeded


def seed_config() -> list[str]:
    """Seed .datum/config.toml from defaults if missing."""
    from datum.path_utils import assets_dir

    config_dest = Path(".datum/config.toml")
    if config_dest.exists():
        return []

    default_src = assets_dir() / "config.toml.default"
    if not default_src.exists():
        return []

    config_dest.parent.mkdir(parents=True, exist_ok=True)
    config_dest.write_text(default_src.read_text())
    return [str(config_dest)]


def seed_lane_tools() -> list[str]:
    """Create scripts/lane-tools/ directory with README."""
    from datum.path_utils import skill_root

    lt_dir = Path("scripts/lane-tools")
    lt_dir.mkdir(parents=True, exist_ok=True)
    seeded = []

    src_readme = skill_root() / "scripts" / "lane-tools" / "README.md"
    dest_readme = lt_dir / "README.md"
    if not dest_readme.exists() and src_readme.exists():
        dest_readme.write_text(src_readme.read_text())
        seeded.append(str(dest_readme))

    src_manifest = skill_root() / "scripts" / "lane-tools" / "manifest.toml"
    dest_manifest = lt_dir / "manifest.toml"
    if not dest_manifest.exists() and src_manifest.exists():
        dest_manifest.write_text(src_manifest.read_text())
        seeded.append(str(dest_manifest))

    return seeded


def _current_branch() -> str:
    res = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True,
        text=True,
    )
    return res.stdout.strip() if res.returncode == 0 else ""


TOOL_FILES = {
    "CLAUDE.md": "Claude Code",
    "GEMINI.md": "Gemini CLI",
    "CODEX.md": "Codex",
    "KIRO.md": "Kiro",
    "COPILOT.md": "Copilot",
}


def seed_agents_md() -> list[str]:
    seeded = []

    agents_template = _read_template("AGENTS.md")
    local_llm_template = _read_template("AGENTS_LOCAL_LLM.md")

    agents = Path("AGENTS.md")
    if not agents.exists():
        agents.write_text(agents_template + local_llm_template)
        seeded.append(str(agents))
    else:
        content = agents.read_text()
        if "Local LLM" not in content and "local_llm" not in content:
            agents.write_text(content.rstrip() + "\n" + local_llm_template)
            seeded.append(str(agents) + " (local-llm section added)")

    redirect_template = _read_template("TOOL_REDIRECT.md")
    for filename, tool_name in TOOL_FILES.items():
        path = Path(filename)
        content = path.read_text() if path.exists() else ""
        redirect_line = (
            "All agent instructions live in [AGENTS.md](AGENTS.md). Read that file."
        )
        if redirect_line not in content:
            redirect = redirect_template.replace("{tool_name}", tool_name)
            if content.strip():
                path.write_text(redirect + "\n" + content)
            else:
                path.write_text(redirect)
            seeded.append(str(path))

    return seeded


def main() -> None:
    seeded = []

    seeded.extend(seed_hooks())
    seeded.extend(seed_config())
    seeded.extend(seed_lane_tools())

    # Seed quality profiles
    profiles_dir = Path(".datum/profiles")
    profiles_dir.mkdir(parents=True, exist_ok=True)
    for profile in ("quality.yaml", "environment.yaml"):
        dest = profiles_dir / profile
        if not dest.exists():
            template = templates_dir() / profile
            if template.exists():
                dest.write_text(template.read_text())
                seeded.append(str(dest))

    cs = Path("CURRENT_STATE.md")
    if not cs.exists():
        cs.write_text(_read_template("CURRENT_STATE.md"))
        seeded.append(str(cs))

    rm = Path("ROADMAP.md")
    if not rm.exists():
        rm.write_text(_read_template("ROADMAP.md"))
        seeded.append(str(rm))

    # Seed TICKET.md in epic dir
    branch = _current_branch()
    if branch and branch not in ("main", "master"):
        epic_dir = Path("docs/epics") / branch
        epic_dir.mkdir(parents=True, exist_ok=True)
        ticket_path = epic_dir / "TICKET.md"
        if not ticket_path.exists():
            ticket_path.write_text(_read_template("TICKET.md"))
            seeded.append(str(ticket_path))

    adr_dir = Path("docs/adr")
    adr_dir.mkdir(parents=True, exist_ok=True)
    adr_template = adr_dir / "000-template.md"
    if not adr_template.exists():
        src_template = templates_dir() / "000-madr-template.md"
        if src_template.exists():
            adr_template.write_text(src_template.read_text())
            seeded.append(str(adr_template))

    practice_dir = Path("docs/practice")
    practice_dir.mkdir(parents=True, exist_ok=True)
    practice_readme = practice_dir / "README.md"
    if not practice_readme.exists():
        practice_readme.write_text(_read_template("PRACTICE_LEDGER.md"))
        seeded.append(str(practice_readme))

    seeded.extend(seed_agents_md())

    print(json.dumps({"ok": True, "seeded": seeded}))


if __name__ == "__main__":
    main()
