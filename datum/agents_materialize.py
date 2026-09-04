"""Materialise agent types + their hooks into a consumer repo (#368).

``agents/datum-*.md`` are Claude Code sub-agent definitions. Their hook
blocks point at ``$CLAUDE_PROJECT_DIR/assets/hooks/<name>.sh``, a path that
only resolves inside the datum repo itself, and ``install.sh`` only links
them into the *datum* checkout's ``.claude/agents``. A consumer repo thus
has no agent types at all and, even if it did, none of the hooks could fire.

``datum init`` (and ``datum init --refresh``) calls :func:`install_agent_types`
which:

- copies ``agents/datum-*.md`` into ``<repo>/.claude/agents/`` with every
  ``$CLAUDE_PROJECT_DIR/assets/hooks/`` reference rewritten to the absolute
  path of the materialised hook, so a hook runs even when
  ``CLAUDE_PROJECT_DIR`` is unset (worktree subagents, other runtimes);
- copies only the ``pre-tool-use-*`` / ``post-tool-use-*`` hooks those agents
  reference into ``<repo>/.datum/hooks/`` (executable bit preserved).

**Committing the agent files.** ``<repo>/.claude/agents/datum-*.md`` are safe
to commit: they contain no secrets and no state, only the definition plus a
marker comment. The rewritten hook path is absolute, so a checkout at a
different location needs ``datum init --refresh`` to re-point it (the copy
is content-compared, so re-running is cheap and idempotent). ``.datum/``
stays gitignored (``.datum/*``) — the hooks are re-materialised per checkout.

Every materialised agent file carries :data:`MATERIALISED_MARKER`; a file in
``.claude/agents/`` that has the same name but lacks the marker is treated as
a hand-written agent and is never overwritten (it is reported as skipped).

Pure filesystem logic — ``datum init`` is the caller.
"""

# tested-by: tests/test_agents_materialize.py

from __future__ import annotations

import os
import re
import shutil
import stat
from dataclasses import dataclass, field
from pathlib import Path

AGENTS_SUBDIR = Path(".claude") / "agents"
LOCAL_HOOKS_SUBDIR = Path(".datum") / "hooks"
AGENT_GLOB = "datum-*.md"
HOOK_REF_PREFIX = "$CLAUDE_PROJECT_DIR/assets/hooks/"
MANAGED_HOOK_PREFIXES = ("pre-tool-use-", "post-tool-use-")
MATERIALISED_MARKER = "<!-- materialised by `datum init` from datum's"

_HOOK_REF_RE = re.compile(re.escape(HOOK_REF_PREFIX) + r"([A-Za-z0-9._-]+)")
_FRONTMATTER_END_RE = re.compile(
    r"^---[ \t]*\n.*?^---[ \t]*\n", re.DOTALL | re.MULTILINE
)


def _is_managed_hook(name: str) -> bool:
    return name.startswith(MANAGED_HOOK_PREFIXES) and not name.startswith("test_")


def referenced_hooks(agents_source: Path) -> list[str]:
    """Sorted hook file names that ``agents/datum-*.md`` reference.

    Only ``pre-tool-use-*`` / ``post-tool-use-*`` names count; a reference
    to any other hook is ignored (those are git hooks, not agent hooks).
    """
    agents_source = Path(agents_source)
    if not agents_source.is_dir():
        return []
    names: set[str] = set()
    for md in agents_source.glob(AGENT_GLOB):
        for m in _HOOK_REF_RE.finditer(md.read_text()):
            if _is_managed_hook(m.group(1)):
                names.add(m.group(1))
    return sorted(names)


def render_agent(text: str, hooks_dir: Path, *, source_name: str) -> str:
    """Rewrite hook references to ``hooks_dir`` and stamp the marker.

    The marker is an HTML comment placed right after the frontmatter so the
    frontmatter stays the first thing in the file (Claude Code requires it).
    """
    hooks_dir = Path(hooks_dir)
    rewritten = _HOOK_REF_RE.sub(lambda m: str(hooks_dir / m.group(1)), text)
    marker = f"{MATERIALISED_MARKER} agents/{source_name}; edits are overwritten -->\n"
    m = _FRONTMATTER_END_RE.match(rewritten)
    if m is None:
        return marker + rewritten
    end = m.end()
    return rewritten[:end] + marker + rewritten[end:]


def materialize_hooks(
    source_hooks: Path,
    dest: Path,
    names: list[str] | tuple[str, ...],
    *,
    force: bool = False,
) -> list[str]:
    """Copy the named hook scripts from ``source_hooks`` into ``dest``.

    Returns the names (re)written. Names that are not managed agent hooks
    or do not exist in ``source_hooks`` are silently ignored — the caller
    (:func:`install_agent_types`) reports missing ones. Mode bits are
    copied and the executable bit is forced on so the hook can run.
    """
    source_hooks = Path(source_hooks)
    dest = Path(dest)
    written: list[str] = []
    wanted = sorted(n for n in names if _is_managed_hook(n))
    if not wanted:
        return written
    dest.mkdir(parents=True, exist_ok=True)
    for name in wanted:
        src = source_hooks / name
        if not src.is_file():
            continue
        target = dest / name
        if not force and target.is_file() and not target.is_symlink():
            if (
                target.read_bytes() == src.read_bytes()
                and target.stat().st_mode & stat.S_IXUSR
            ):
                continue
        if target.is_symlink() or target.exists():
            target.unlink()
        shutil.copy(src, target)  # copies mode bits too
        mode = target.stat().st_mode
        target.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        written.append(name)
    return written


def materialize_agents(
    source_agents: Path, dest: Path, hooks_dir: Path, *, force: bool = False
) -> tuple[list[str], list[str]]:
    """Copy ``datum-*.md`` into ``dest`` rendered against ``hooks_dir``.

    Returns ``(written, skipped)``. A target is rewritten when it is missing,
    when its rendered content differs (source changed *or* ``hooks_dir``
    moved), or always with ``force``. A same-named target that lacks the
    materialised marker — or is a symlink — is a non-datum file and is
    skipped, never overwritten, regardless of ``force``.
    """
    source_agents = Path(source_agents)
    dest = Path(dest)
    hooks_dir = Path(hooks_dir)
    written: list[str] = []
    skipped: list[str] = []
    sources = sorted(source_agents.glob(AGENT_GLOB)) if source_agents.is_dir() else []
    if not sources:
        return written, skipped
    dest.mkdir(parents=True, exist_ok=True)
    for src in sources:
        rendered = render_agent(src.read_text(), hooks_dir, source_name=src.name)
        target = dest / src.name
        if target.is_symlink() or (target.exists() and not target.is_file()):
            skipped.append(src.name)
            continue
        if target.exists():
            current = target.read_text()
            if MATERIALISED_MARKER not in current:
                skipped.append(src.name)
                continue
            if not force and current == rendered:
                continue
        target.write_text(rendered)
        written.append(src.name)
    return written, skipped


@dataclass
class AgentInstallResult:
    """Outcome of :func:`install_agent_types`; feeds ``.datum/config.json``."""

    agents_dir: Path
    hooks_dir: Path
    agents_written: list[str] = field(default_factory=list)
    hooks_written: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    _agents_expected: list[str] = field(default_factory=list, repr=False)
    _hooks_expected: list[str] = field(default_factory=list, repr=False)

    @property
    def hooks_installed(self) -> bool:
        """Every hook the agents reference exists, executable, in ``hooks_dir``."""
        if self.errors:
            return False
        return all(
            (self.hooks_dir / n).is_file()
            and (self.hooks_dir / n).stat().st_mode & stat.S_IXUSR
            for n in self._hooks_expected
        )

    @property
    def agent_types(self) -> bool:
        """Every ``datum-*.md`` is present in ``agents_dir`` as *our* copy."""
        if self.errors or self.skipped:
            return False
        return all((self.agents_dir / n).is_file() for n in self._agents_expected)

    def as_config(self) -> dict[str, bool]:
        return {
            "hooks_installed": self.hooks_installed,
            "agent_types": self.agent_types,
        }


def install_agent_types(
    repo_root: Path, package_root: Path, *, force: bool = False
) -> AgentInstallResult:
    """Materialise agents + hooks for ``repo_root`` from ``package_root``.

    Inside the datum repo itself (``package_root`` is ``repo_root`` or a
    descendant) nothing is copied: ``$CLAUDE_PROJECT_DIR/assets/hooks``
    resolves natively and ``install.sh`` already links ``.claude/agents``.

    Never raises: any exception lands in ``errors`` so ``datum init`` can
    record ``hooks_installed: false`` / ``agent_types: false`` and carry on.
    """
    repo_root = Path(repo_root).resolve()
    package_root = Path(package_root).resolve()
    source_agents = package_root / "agents"
    source_hooks = package_root / "assets" / "hooks"

    agent_names = (
        sorted(p.name for p in source_agents.glob(AGENT_GLOB))
        if source_agents.is_dir()
        else []
    )
    hook_names = referenced_hooks(source_agents)

    if package_root == repo_root or repo_root in package_root.parents:
        agents_dest = (repo_root / AGENTS_SUBDIR).resolve()
        result = AgentInstallResult(
            agents_dir=agents_dest,
            hooks_dir=source_hooks,
            _agents_expected=agent_names,
            _hooks_expected=hook_names,
        )
        # Claude Code resolves agent types from <repo>/.claude/agents, not
        # from <repo>/agents — without this symlink `agent_types: true`
        # would be a lie and every agentType lookup would fail at runtime.
        # install.sh creates it too, but a checkout may never have run
        # install.sh, so datum init must not assume it already exists.
        if source_agents.is_dir() and not agents_dest.exists():
            try:
                agents_dest.parent.mkdir(parents=True, exist_ok=True)
                agents_dest.symlink_to(
                    os.path.relpath(source_agents, agents_dest.parent),
                    target_is_directory=True,
                )
            except OSError as exc:
                result.errors.append(f"agents symlink: {exc}")
        return result

    result = AgentInstallResult(
        agents_dir=(repo_root / AGENTS_SUBDIR).resolve(),
        hooks_dir=(repo_root / LOCAL_HOOKS_SUBDIR).resolve(),
        _agents_expected=agent_names,
        _hooks_expected=hook_names,
    )
    if not source_agents.is_dir():
        result.errors.append(f"agents source missing: {source_agents}")
        return result

    try:
        result.hooks_written = materialize_hooks(
            source_hooks, result.hooks_dir, hook_names, force=force
        )
    except Exception as exc:  # noqa: BLE001 — recorded, never propagated
        result.errors.append(f"hooks: {exc}")
    for name in hook_names:
        if not (source_hooks / name).is_file():
            result.errors.append(f"referenced hook missing from package: {name}")

    try:
        result.agents_written, result.skipped = materialize_agents(
            source_agents, result.agents_dir, result.hooks_dir, force=force
        )
    except Exception as exc:  # noqa: BLE001
        result.errors.append(f"agents: {exc}")
    return result
