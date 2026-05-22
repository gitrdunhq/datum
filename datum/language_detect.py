#!/usr/bin/env python3
"""
Detect the primary language of the current repo.

Usage:
  python3 scripts/language_detect.py
  python3 scripts/language_detect.py --path /some/repo

Output: JSON with {"language": "swift", "confidence": "high", "evidence": [...]}
"""

import argparse
import json
from collections import Counter
from pathlib import Path

LANGUAGE_SIGNALS: list[tuple[str, str, str]] = [
    # (indicator, language, strength: high/medium)
    ("Package.swift", "swift", "high"),
    ("*.xcodeproj", "swift", "high"),
    ("*.xcworkspace", "swift", "high"),
    ("Cargo.toml", "rust", "high"),
    ("go.mod", "go", "high"),
    ("pyproject.toml", "python", "high"),
    ("setup.py", "python", "medium"),
    ("package.json", "typescript", "medium"),
    ("tsconfig.json", "typescript", "high"),
    ("pom.xml", "java", "high"),
    ("build.gradle", "kotlin", "medium"),
    ("build.gradle.kts", "kotlin", "high"),
    ("Gemfile", "ruby", "high"),
    ("mix.exs", "elixir", "high"),
]

FILE_EXTENSION_MAP: dict[str, str] = {
    ".swift": "swift",
    ".rs": "rust",
    ".go": "go",
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".java": "java",
    ".kt": "kotlin",
    ".rb": "ruby",
    ".ex": "elixir",
    ".exs": "elixir",
    ".cs": "csharp",
    ".cpp": "cpp",
    ".c": "c",
}

EXCLUDED_DIRS = {
    ".git",
    "node_modules",
    ".build",
    "build",
    "dist",
    ".datum",
    "DerivedData",
    "__pycache__",
    ".venv",
    "venv",
}


def detect(root: Path) -> dict:
    evidence: list[str] = []
    language_votes: Counter = Counter()

    # Check manifest signals first (high confidence)
    for indicator, language, strength in LANGUAGE_SIGNALS:
        if "*" in indicator:
            pattern = indicator.replace("*", "")
            matches = list(root.rglob(f"*{pattern}"))
            matches = [
                m for m in matches if not any(ex in m.parts for ex in EXCLUDED_DIRS)
            ]
            if matches:
                weight = 3 if strength == "high" else 1
                language_votes[language] += weight
                evidence.append(f"{indicator} found ({language})")
        else:
            if (root / indicator).exists():
                weight = 3 if strength == "high" else 1
                language_votes[language] += weight
                evidence.append(f"{indicator} found ({language})")

    # Count source file extensions
    ext_counts: Counter = Counter()
    for path in root.rglob("*"):
        if any(ex in path.parts for ex in EXCLUDED_DIRS):
            continue
        if path.is_file():
            ext = path.suffix.lower()
            if ext in FILE_EXTENSION_MAP:
                ext_counts[FILE_EXTENSION_MAP[ext]] += 1

    if ext_counts:
        top_lang, top_count = ext_counts.most_common(1)[0]
        language_votes[top_lang] += min(top_count // 10, 5)
        evidence.append(f"{top_count} {top_lang} source files")

    if not language_votes:
        return {"language": "unknown", "confidence": "low", "evidence": evidence}

    top_language, top_votes = language_votes.most_common(1)[0]
    total_votes = sum(language_votes.values())
    dominance = top_votes / total_votes if total_votes > 0 else 0

    confidence = "high" if dominance > 0.7 else "medium" if dominance > 0.4 else "low"

    return {
        "language": top_language,
        "confidence": confidence,
        "votes": dict(language_votes),
        "evidence": evidence,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Detect primary repo language")
    parser.add_argument("--path", default=".")
    args = parser.parse_args()

    root = Path(args.path).resolve()
    result = detect(root)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
