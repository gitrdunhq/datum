# tested-by: tests/skills/datum-coding-steering/test_miner.py
"""
Deterministic evidence mining for coding steering.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

SUPPORTED_SOURCES = {
    "reviews",
    "logs",
    "rules",
    "docs",
    "tests",
    "ci",
    "adrs",
    "incidents",
    "code",
    "claude_sessions",
}


@dataclass(frozen=True)
class EvidenceFile:
    """A mined evidence file."""

    source: str
    path: str
    size_bytes: int


@dataclass(frozen=True)
class EvidenceManifest:
    """Bounded evidence manifest for downstream reasoning."""

    target: str
    sources: tuple[str, ...]
    files: tuple[EvidenceFile, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class SourceRule:
    """Path-matching rule for a logical evidence source."""

    dir_names: tuple[str, ...] = ()
    file_prefixes: tuple[str, ...] = ()
    path_fragments: tuple[str, ...] = ()


class EvidenceMiner:
    """Find high-signal evidence files in a target tree."""

    _SOURCE_RULES: dict[str, SourceRule] = {
        "reviews": SourceRule(
            dir_names=("review", "reviews", "audit", "audits", "retro", "retros"),
        ),
        "logs": SourceRule(
            dir_names=("logs", "log", "artifacts", "runs"),
            path_fragments=("/logs/", "/artifacts/", "/runs/"),
        ),
        "rules": SourceRule(
            dir_names=("rules",),
            path_fragments=("/.wfc/rules/", "/rules/"),
        ),
        "docs": SourceRule(
            dir_names=("docs",),
            path_fragments=("/contributing/", "/contributors/", "/architecture/"),
        ),
        "tests": SourceRule(
            dir_names=("tests", "test"),
            file_prefixes=("test_",),
            path_fragments=("/tests/", "/test/"),
        ),
        "ci": SourceRule(
            dir_names=("ci", ".circleci"),
            path_fragments=("/.github/workflows/", "/.gitlab-ci/", "/.circleci/"),
        ),
        "adrs": SourceRule(
            dir_names=("adr", "adrs"),
            file_prefixes=("adr-",),
        ),
        "incidents": SourceRule(
            dir_names=("incident", "incidents", "postmortem", "postmortems"),
            file_prefixes=("incident-", "postmortem-"),
        ),
        "code": SourceRule(
            dir_names=("src", "app", "lib", "internal"),
        ),
    }
    _UUID_JSONL_RE = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$",
        re.IGNORECASE,
    )

    _IGNORED_DIRS = {
        ".git",
        ".hg",
        ".svn",
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        ".mypy_cache",
        ".pytest_cache",
        "dist",
        "build",
        "target",
        ".claude",
    }

    _TEXT_SUFFIXES = {
        ".md",
        ".txt",
        ".json",
        ".yaml",
        ".yml",
        ".toml",
        ".ini",
        ".cfg",
        ".jsonl",
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".go",
        ".rs",
        ".java",
        ".sh",
    }

    def mine(
        self,
        target: Path,
        sources: Iterable[str] | None = None,
        max_files_per_source: int | None = None,
    ) -> EvidenceManifest:
        """Return a bounded manifest of likely evidence files."""
        source_list = self._normalize_sources(sources)
        files: list[EvidenceFile] = []
        for source in source_list:
            files.extend(self._collect_for_source(target, source, max_files_per_source))
        files.sort(key=lambda item: (item.source, item.path))
        return EvidenceManifest(
            target=str(target.resolve()),
            sources=tuple(source_list),
            files=tuple(files),
        )

    def _normalize_sources(self, sources: Iterable[str] | None) -> list[str]:
        if sources is None:
            return [
                "reviews",
                "rules",
                "docs",
                "tests",
                "ci",
                "logs",
                "adrs",
                "incidents",
            ]
        normalized: list[str] = []
        for source in sources:
            item = source.strip().lower()
            if not item:
                continue
            if item not in SUPPORTED_SOURCES:
                raise ValueError(f"Unsupported evidence source: {item}")
            if item not in normalized:
                normalized.append(item)
        return normalized

    def _collect_for_source(
        self, target: Path, source: str, max_files: int | None
    ) -> list[EvidenceFile]:
        if source == "claude_sessions":
            return self._collect_claude_sessions(target, max_files)
        matches: list[EvidenceFile] = []
        rule = self._SOURCE_RULES[source]
        for path in self._walk_files(target):
            rel = path.relative_to(target).as_posix()
            if not self._matches_source(rel, rule):
                continue
            matches.append(EvidenceFile(source=source, path=rel, size_bytes=path.stat().st_size))
            if max_files is not None and len(matches) >= max_files:
                break
        return matches

    def _matches_source(self, rel_path: str, rule: SourceRule) -> bool:
        rel_lower = rel_path.lower()
        rel_with_guards = f"/{rel_lower}/"
        parts = tuple(part.lower() for part in Path(rel_path).parts)
        parent_parts = parts[:-1]
        filename = parts[-1] if parts else ""

        if any(part in rule.dir_names for part in parent_parts):
            return True
        if any(filename.startswith(prefix) for prefix in rule.file_prefixes):
            return True
        if any(fragment in rel_with_guards for fragment in rule.path_fragments):
            return True
        return False

    def _collect_claude_sessions(self, target: Path, max_files: int | None) -> list[EvidenceFile]:
        root = self._claude_projects_root()
        if not root.is_dir():
            return []

        matches: list[EvidenceFile] = []
        resolved_root = root.resolve()
        exact_slug = self._claude_project_slug_for_path(target)
        project_names = self._target_project_names(target)

        for project_dir in sorted(root.iterdir()):
            if not project_dir.is_dir() or project_dir.is_symlink():
                continue
            if not project_dir.resolve().is_relative_to(resolved_root):
                continue
            if not self._claude_project_matches(project_dir.name, exact_slug, project_names):
                continue

            for session_file in sorted(project_dir.iterdir()):
                if not session_file.is_file() or session_file.is_symlink():
                    continue
                if not self._UUID_JSONL_RE.match(session_file.name):
                    continue
                matches.append(
                    EvidenceFile(
                        source="claude_sessions",
                        path=str(session_file),
                        size_bytes=session_file.stat().st_size,
                    )
                )
                if max_files is not None and len(matches) >= max_files:
                    return matches
        return matches

    def _claude_projects_root(self) -> Path:
        return Path.home() / ".claude" / "projects"

    def _claude_project_slug_for_path(self, target: Path) -> str | None:
        try:
            resolved = target.resolve().as_posix()
        except OSError:
            return None
        return resolved.replace("/", "-") if resolved else None

    def _target_project_names(self, target: Path) -> set[str]:
        if target.name == "projects" and target.parent.name == ".wfc":
            names = {
                child.name
                for child in target.iterdir()
                if child.is_dir() and not child.name.startswith(".") and not child.is_symlink()
            }
            return names
        return {target.name}

    def _claude_project_matches(
        self, project_dir_name: str, exact_slug: str | None, project_names: set[str]
    ) -> bool:
        if exact_slug and project_dir_name == exact_slug:
            return True
        return False

    def _is_evidence_candidate(self, path: Path) -> bool:
        return path.suffix.lower() in self._TEXT_SUFFIXES

    def _walk_files(self, target: Path) -> Iterable[Path]:
        for dirpath, dirnames, filenames in os.walk(target):
            dirnames[:] = [d for d in dirnames if d not in self._IGNORED_DIRS]
            for fname in filenames:
                path = Path(dirpath) / fname
                if path.is_symlink():
                    continue
                if not self._is_evidence_candidate(path):
                    continue
                yield path
