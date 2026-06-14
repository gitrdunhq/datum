"""Auto-detect language, test framework, and test command for a repo."""

import os
from pathlib import Path


def detect_repo(root: str = ".") -> dict:
    """Scan repo and return detected configuration."""
    root = Path(root).resolve()

    lang = _detect_language(root)
    framework = _detect_test_framework(root, lang)
    test_cmd = _detect_test_command(root, lang, framework)

    skills_dir = str((Path(__file__).resolve().parent.parent / "skills").resolve())

    return {
        "language": lang,
        "test_framework": framework,
        "test_command": test_cmd,
        "epic_dir_pattern": "docs/epics/{branch}",
        "skills_dir": skills_dir,
    }


def _detect_language(root: Path) -> str:
    markers = {
        "python": [
            "pyproject.toml",
            "setup.py",
            "setup.cfg",
            "Pipfile",
            "requirements.txt",
        ],
        "typescript": ["tsconfig.json"],
        "javascript": ["package.json"],
        "go": ["go.mod"],
        "rust": ["Cargo.toml"],
        "swift": ["Package.swift"],
        "java": ["pom.xml", "build.gradle", "build.gradle.kts"],
        "kotlin": ["build.gradle.kts"],
        "ruby": ["Gemfile"],
    }

    # Check for language-specific config files
    for lang, files in markers.items():
        for f in files:
            if (root / f).exists():
                # typescript takes priority over javascript if both exist
                if lang == "javascript" and (root / "tsconfig.json").exists():
                    continue
                return lang

    # Fallback: count file extensions
    ext_count: dict[str, int] = {}
    ext_to_lang = {
        ".py": "python",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript",
        ".go": "go",
        ".rs": "rust",
        ".swift": "swift",
        ".java": "java",
        ".kt": "kotlin",
        ".rb": "ruby",
    }
    for dirpath, _, filenames in os.walk(root):
        if any(skip in dirpath for skip in [".git", "node_modules", "vendor", "dist"]):
            continue
        for f in filenames:
            ext = Path(f).suffix.lower()
            if ext in ext_to_lang:
                lang = ext_to_lang[ext]
                ext_count[lang] = ext_count.get(lang, 0) + 1

    if ext_count:
        return max(ext_count, key=ext_count.get)
    return "unknown"


def _detect_test_framework(root: Path, lang: str) -> str:
    detectors = {
        "python": _detect_python_test_framework,
        "typescript": _detect_ts_test_framework,
        "javascript": _detect_ts_test_framework,
        "go": lambda _: "go-test",
        "rust": lambda _: "cargo-test",
        "swift": _detect_swift_test_framework,
        "java": lambda _: "junit",
        "kotlin": lambda _: "junit",
        "ruby": lambda _: "rspec" if (root / ".rspec").exists() else "minitest",
    }
    detector = detectors.get(lang)
    return detector(root) if detector else "unknown"


def _detect_python_test_framework(root: Path) -> str:
    pyproject = root / "pyproject.toml"
    if pyproject.exists():
        content = pyproject.read_text(errors="ignore")
        if "[tool.pytest" in content or "pytest" in content:
            return "pytest"
    if (root / "pytest.ini").exists() or (root / "conftest.py").exists():
        return "pytest"
    if (root / "tox.ini").exists():
        return "pytest"
    return "pytest"


def _detect_ts_test_framework(root: Path) -> str:
    pkg = root / "package.json"
    if pkg.exists():
        content = pkg.read_text(errors="ignore")
        if "vitest" in content:
            return "vitest"
        if "jest" in content:
            return "jest"
        if "mocha" in content:
            return "mocha"
    return "jest"


def _detect_swift_test_framework(root: Path) -> str:
    for dirpath, _, filenames in os.walk(root / "Tests"):
        for f in filenames:
            if f.endswith(".swift"):
                content = (Path(dirpath) / f).read_text(errors="ignore")
                if "import Testing" in content:
                    return "swift-testing"
                if "import XCTest" in content:
                    return "xctest"
    return "xctest"


def _detect_test_command(root: Path, lang: str, framework: str) -> str:
    commands = {
        ("python", "pytest"): "uv run pytest -x -q",
        ("typescript", "vitest"): "npx vitest run",
        ("typescript", "jest"): "npx jest",
        ("javascript", "vitest"): "npx vitest run",
        ("javascript", "jest"): "npx jest",
        ("javascript", "mocha"): "npx mocha",
        ("go", "go-test"): "go test ./...",
        ("rust", "cargo-test"): "cargo test",
        ("swift", "xctest"): "swift test",
        ("swift", "swift-testing"): "swift test",
        ("java", "junit"): "gradle test",
        ("kotlin", "junit"): "gradle test",
        ("ruby", "rspec"): "bundle exec rspec",
        ("ruby", "minitest"): "bundle exec rake test",
    }

    # Check for uv vs pip for python
    if lang == "python" and framework == "pytest":
        if not (root / "uv.lock").exists() and not (root / "pyproject.toml").exists():
            return "python -m pytest -x -q"

    return commands.get(
        (lang, framework), f"echo 'no test command for {lang}/{framework}'"
    )
