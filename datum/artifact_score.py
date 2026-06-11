"""artifact_score.py — deterministic artifact scoring rubric (issue #92).

Ported from the caliber-ai/ai-setup scoring concept (MIT, src/scoring/).
Scores a pipeline artifact (SPEC.md, TASKS.md, ...) on four sub-checks,
each fully deterministic — no LLM calls anywhere:

  (a) concreteness ratio   — lines with backticks/paths/code refs vs abstract
                             prose; catches the THINK model emitting vague filler
  (b) grounding ratio      — % of real project dirs/files actually referenced
  (c) git drift            — rev-list count since the artifact was last updated
  (d) reference validation — extracted path-like refs must exist on disk

This module is the pure core: filesystem and git lookups are injected
callables (``path_exists``, ``project_entries``, ``commits_since``) so the
scoring logic is testable without touching disk. ``datum.gate`` supplies the
real boundaries via ``score_context_quality()``.

Output is structured (per-check sub-scores + reasons), not a bare number,
so the #79 skeptical evaluator can consume it alongside eedom.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

SCHEMA_VERSION = "1.0"

# ── Graduated thresholds (module constants, deterministic step functions) ──

# (a) concreteness: ratio of concrete prose lines -> score
CONCRETENESS_BANDS: tuple[tuple[float, float], ...] = (
    (0.30, 1.0),
    (0.15, 0.7),
    (0.05, 0.4),
)

# (b) grounding: ratio of real project entries referenced -> score
GROUNDING_BANDS: tuple[tuple[float, float], ...] = (
    (0.25, 1.0),
    (0.10, 0.7),
)
GROUNDING_PARTIAL_SCORE = 0.4  # any real entry referenced at all

# (c) git drift: commits since artifact last updated -> score
DRIFT_BANDS: tuple[tuple[int, float], ...] = (
    (3, 1.0),
    (10, 0.7),
    (25, 0.4),
)

# (d) reference validation: ratio of extracted refs that exist -> score
REFERENCE_BANDS: tuple[tuple[float, float], ...] = (
    (1.0, 1.0),
    (0.8, 0.7),
    (0.5, 0.4),
)

# overall verdict bands
VERDICT_PASS = 0.8
VERDICT_WARN = 0.6

# ── Line / reference classification ─────────────────────────────────────────

_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s")
_STRUCTURAL_RE = re.compile(r"^[\s|:\-=*_]+$")
_FENCE_RE = re.compile(r"^\s*(```|~~~)")

# Path-like reference: at least one slash-separated component.
_PATH_REF_RE = re.compile(r"(?<![\w/])((?:\.{1,2}/)?(?:[\w.\-]+/)+[\w.\-*{}<>$]+)")
# Bare filename with a code/doc extension (concreteness signal only).
_FILE_TOKEN_RE = re.compile(
    r"\b[\w.\-]+\.(?:py|md|json|toml|yaml|yml|sh|txt|js|ts|rs|go|swift)\b"
)
_CALL_RE = re.compile(r"\b\w+\(\)")
_BACKTICK_SPAN_RE = re.compile(r"`([^`]+)`")
_PLACEHOLDER_CHARS = set("*<>{}$")


@dataclass(frozen=True)
class CheckResult:
    """Sub-score for a single rubric check."""

    name: str
    score: float
    reasons: list[str]
    details: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "score": self.score,
            "reasons": list(self.reasons),
            "details": dict(self.details),
        }


@dataclass(frozen=True)
class ArtifactScore:
    """Aggregate rubric result for one artifact."""

    artifact: str
    overall_score: float
    verdict: str  # "pass" | "warn" | "fail"
    checks: list[CheckResult]

    def to_dict(self) -> dict:
        return {
            "schema_version": SCHEMA_VERSION,
            "artifact": self.artifact,
            "overall_score": self.overall_score,
            "verdict": self.verdict,
            "checks": [c.to_dict() for c in self.checks],
        }


def _band_score(ratio: float, bands: Sequence[tuple[float, float]]) -> float:
    for threshold, score in bands:
        if ratio >= threshold:
            return score
    return 0.0


def extract_path_refs(content: str) -> list[str]:
    """Extract checkable path-like references (must contain a slash).

    Skips URLs, globs, and placeholder paths (``<branch>``, ``{run_id}``,
    ``$VAR``, ``*``) — those are templates, not claims about real files.
    Returns deduplicated refs in first-seen order.
    """
    # Drop URLs before matching so 'example.com/a/b.json' never surfaces.
    cleaned = re.sub(r"\b\w+://\S+", " ", content)
    refs: list[str] = []
    seen: set[str] = set()
    for match in _PATH_REF_RE.finditer(cleaned):
        ref = match.group(1).rstrip(".,;:!?")
        if not ref or ref in seen:
            continue
        if _PLACEHOLDER_CHARS & set(ref):
            continue
        seen.add(ref)
        refs.append(ref)
    return refs


# ── (a) Concreteness ────────────────────────────────────────────────────────


def check_concreteness(content: str) -> CheckResult:
    """Ratio of concrete lines (backticks/paths/code refs) to prose lines.

    Headings, blank lines, and structural lines (table separators, rules)
    are excluded from the denominator. Lines inside code fences count as
    concrete.
    """
    prose_lines = 0
    concrete_lines = 0
    in_fence = False

    for line in content.splitlines():
        if _FENCE_RE.match(line):
            in_fence = not in_fence
            prose_lines += 1
            concrete_lines += 1
            continue
        if not line.strip() or _STRUCTURAL_RE.match(line):
            continue
        if not in_fence and _HEADING_RE.match(line):
            continue
        prose_lines += 1
        if (
            in_fence
            or "`" in line
            or _PATH_REF_RE.search(line)
            or _FILE_TOKEN_RE.search(line)
            or _CALL_RE.search(line)
        ):
            concrete_lines += 1

    if prose_lines == 0:
        return CheckResult(
            name="concreteness",
            score=0.0,
            reasons=["no prose lines found — empty or heading-only artifact"],
            details={"prose_lines": 0, "concrete_lines": 0, "ratio": 0.0},
        )

    ratio = concrete_lines / prose_lines
    score = _band_score(ratio, CONCRETENESS_BANDS)
    return CheckResult(
        name="concreteness",
        score=score,
        reasons=[
            f"{concrete_lines}/{prose_lines} prose lines contain "
            f"backticks/paths/code refs (ratio {ratio:.2f})"
        ],
        details={
            "prose_lines": prose_lines,
            "concrete_lines": concrete_lines,
            "ratio": round(ratio, 4),
        },
    )


# ── (b) Grounding ───────────────────────────────────────────────────────────


def check_grounding(content: str, project_entries: Sequence[str]) -> CheckResult:
    """Fraction of real top-level project dirs/files referenced by the artifact.

    A project entry counts as referenced when an extracted path ref or a
    backticked token equals the entry or lives under it (``datum/gate.py``
    references ``datum``). Prose mentions alone do not count — grounding
    measures structural references, not name-dropping.
    """
    if not project_entries:
        return CheckResult(
            name="grounding",
            score=0.0,
            reasons=["no project entries to ground against"],
            details={"referenced": [], "total_entries": 0, "ratio": 0.0},
        )

    tokens = set(extract_path_refs(content))
    for span in _BACKTICK_SPAN_RE.findall(content):
        tokens.add(span.strip().rstrip(".,;:!?"))

    referenced = sorted(
        entry
        for entry in set(project_entries)
        if any(tok == entry or tok.startswith(f"{entry}/") for tok in tokens)
    )
    ratio = len(referenced) / len(set(project_entries))

    if not referenced:
        return CheckResult(
            name="grounding",
            score=0.0,
            reasons=["no real project dirs/files referenced"],
            details={
                "referenced": [],
                "total_entries": len(set(project_entries)),
                "ratio": 0.0,
            },
        )

    score = _band_score(ratio, GROUNDING_BANDS) or GROUNDING_PARTIAL_SCORE
    return CheckResult(
        name="grounding",
        score=score,
        reasons=[
            f"references {len(referenced)}/{len(set(project_entries))} real "
            f"project entries: {', '.join(referenced)}"
        ],
        details={
            "referenced": referenced,
            "total_entries": len(set(project_entries)),
            "ratio": round(ratio, 4),
        },
    )


# ── (c) Git drift ───────────────────────────────────────────────────────────


def check_git_drift(
    artifact_path: str | None,
    commits_since: Callable[[str], int | None],
) -> CheckResult:
    """Commits landed since the artifact was last updated (rev-list count).

    ``commits_since`` returning ``None`` (no git repo, artifact never
    committed, git missing) skips the check rather than failing it — drift
    is unknowable, not bad.
    """
    commits = commits_since(artifact_path) if artifact_path else None
    if commits is None:
        return CheckResult(
            name="git_drift",
            score=1.0,
            reasons=["git history unavailable — drift not assessed"],
            details={"commits_since_update": None, "skipped": True},
        )

    score = 0.0
    for threshold, band_score in DRIFT_BANDS:
        if commits <= threshold:
            score = band_score
            break
    return CheckResult(
        name="git_drift",
        score=score,
        reasons=[f"{commits} commit(s) since artifact last updated"],
        details={"commits_since_update": commits, "skipped": False},
    )


# ── (d) Reference validation ────────────────────────────────────────────────


def check_references(content: str, path_exists: Callable[[str], bool]) -> CheckResult:
    """Every extracted path-like ref must exist on disk.

    Vacuously passes when the artifact has no checkable refs — vagueness is
    concreteness/grounding territory, not a hallucination signal.
    """
    refs = extract_path_refs(content)
    if not refs:
        return CheckResult(
            name="reference_validation",
            score=1.0,
            reasons=["no checkable path references found"],
            details={"checked": [], "missing": [], "skipped": True},
        )

    missing = [ref for ref in refs if not path_exists(ref)]
    ratio = (len(refs) - len(missing)) / len(refs)
    score = _band_score(ratio, REFERENCE_BANDS)
    reasons = [f"{len(refs) - len(missing)}/{len(refs)} referenced paths exist"]
    reasons.extend(f"missing reference: {ref}" for ref in missing)
    return CheckResult(
        name="reference_validation",
        score=score,
        reasons=reasons,
        details={"checked": refs, "missing": missing, "skipped": False},
    )


# ── Aggregate ───────────────────────────────────────────────────────────────


def score_artifact(
    content: str,
    *,
    artifact_path: str | None,
    path_exists: Callable[[str], bool],
    project_entries: Sequence[str],
    commits_since: Callable[[str], int | None],
) -> ArtifactScore:
    """Run all four rubric checks and aggregate into a verdict.

    Overall score is the unweighted mean of the four sub-scores; verdict is
    graduated: >= 0.8 pass, >= 0.6 warn, else fail.
    """
    checks = [
        check_concreteness(content),
        check_grounding(content, project_entries),
        check_git_drift(artifact_path, commits_since),
        check_references(content, path_exists),
    ]
    overall = sum(c.score for c in checks) / len(checks)
    if overall >= VERDICT_PASS:
        verdict = "pass"
    elif overall >= VERDICT_WARN:
        verdict = "warn"
    else:
        verdict = "fail"
    return ArtifactScore(
        artifact=artifact_path or "<unknown>",
        overall_score=overall,
        verdict=verdict,
        checks=checks,
    )
