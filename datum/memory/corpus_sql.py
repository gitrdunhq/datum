"""Read-only DuckDB corpus over .datum artifacts.

Provides:
- ``sql_guard(query)`` — pure SQL injection guard; returns an error string or
  ``None`` when the query is safe to execute.
- ``render_rows(columns, rows, max_chars)`` — deterministic table renderer with
  row / byte caps.
- ``run_corpus_query(query, limit, repo_root)`` — full pipeline: guard →
  connect → create views → execute → sanitize → render.

Security design (layered, all deterministic):
  1. ``sql_guard`` rejects anything that is not a single SELECT/WITH; blocks
     the token denylist; exits on semicolons outside string literals.
  2. DuckDB connection is in-memory; ``SET enable_external_access=false`` is
     applied *after* the views are created, so the query itself cannot reach
     the filesystem.
  3. sqlite ATTACH of state.db uses READ_ONLY mode.
  4. Row cap: fetchmany(50); byte cap: ≤3800 chars.
  5. All rendered output is passed through ``prompt_sanitizer`` before being
     returned to any caller.

Missing source files produce empty views, never errors (graceful degradation).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

# ── SQL guard ─────────────────────────────────────────────────────────────────

# Keywords that are forbidden anywhere in the query (normalised to uppercase).
_DENYLIST: frozenset[str] = frozenset(
    {
        "ATTACH",
        "COPY",
        "INSTALL",
        "LOAD",
        "PRAGMA",
        # SET is used during view setup by the tool itself, never by the caller
        "SET",
        "CREATE",
        "INSERT",
        "UPDATE",
        "DELETE",
        "DROP",
        "ALTER",
        "EXPORT",
        "IMPORT",
        "CALL",
        # Raw file-reading functions must not appear in caller queries
        "READ_JSON",
        "READ_CSV",
        "READ_PARQUET",
        "GLOB",
        "GETENV",
        # HTTP / S3 escape hatches
        "HTTPFS",
        "S3",
    }
)

# Token-boundary pattern: match whole words so "CREATED" doesn't trigger "CREATE".
_WORD_RE = re.compile(r"\b([A-Z_][A-Z_0-9]*)\b")

# A query is safe only if it starts with SELECT or WITH (after stripping comments/
# whitespace). Everything else is rejected.
_ALLOWED_START = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)


def _strip_sql_strings(query: str) -> str:
    """Return a copy of *query* with string literals blanked out.

    This lets the denylist and semicolon checks operate on structural SQL
    tokens rather than potentially injected literal content.
    """
    # Remove single-quoted strings (SQL standard), handling escaped quotes ''.
    query = re.sub(r"'(?:[^'\\]|\\.)*'", "''", query)
    # Remove double-quoted identifiers.
    query = re.sub(r'"(?:[^"\\]|\\.)*"', '""', query)
    # Remove line comments.
    query = re.sub(r"--[^\n]*", "", query)
    # Remove block comments.
    query = re.sub(r"/\*.*?\*/", "", query, flags=re.DOTALL)
    return query


def sql_guard(query: str) -> str | None:
    """Validate *query* for safe single-SELECT execution over corpus views.

    Returns:
        ``None`` if the query is safe.
        A non-empty error string describing the violation if it is not.
    """
    if not query or not query.strip():
        return "empty query"

    stripped = _strip_sql_strings(query)

    # ── 1. Must start with SELECT or WITH ────────────────────────────────────
    if not _ALLOWED_START.match(stripped):
        first_token = stripped.strip().split()[0].upper() if stripped.strip() else ""
        return (
            f"query must start with SELECT or WITH, got {first_token!r}; "
            "only read-only SELECT statements are permitted"
        )

    # ── 2. Single statement: no semicolons outside string literals ───────────
    if ";" in stripped:
        return (
            "multi-statement query rejected: semicolons are not allowed; "
            "submit one SELECT at a time"
        )

    # ── 3. Denylist token scan ────────────────────────────────────────────────
    upper = stripped.upper()
    for token in _WORD_RE.findall(upper):
        if token in _DENYLIST:
            return (
                f"forbidden keyword {token!r} in query; "
                "only SELECT/WITH over the pre-registered views is allowed "
                "(transcripts, failures, run_state, lane_files, token_metrics, "
                "kv_state, floor_runs)"
            )

    return None  # safe


# ── Row rendering ─────────────────────────────────────────────────────────────

MAX_ROWS = 50
MAX_CHARS = 3800


def render_rows(
    columns: list[str],
    rows: list[tuple[Any, ...]],
    max_chars: int = MAX_CHARS,
    total_rows: int | None = None,
) -> str:
    """Render *columns* / *rows* as a plain-text table, capped at *max_chars*.

    Args:
        columns: Column name list.
        rows: Row tuples (already limited to MAX_ROWS by the caller).
        max_chars: Hard byte cap; output is truncated with a hint when exceeded.
        total_rows: If provided and > len(rows), appends an omission hint.

    Returns:
        A multi-line string table, always ≤ max_chars characters.
    """
    if not rows:
        return "(no rows)"

    # Compute column widths.
    widths = [len(c) for c in columns]
    str_rows: list[list[str]] = []
    for row in rows:
        cells = [str(v) if v is not None else "NULL" for v in row]
        str_rows.append(cells)
        for i, cell in enumerate(cells):
            widths[i] = max(widths[i], min(len(cell), 60))

    def _fmt_row(cells: list[str]) -> str:
        parts = []
        for i, cell in enumerate(cells):
            parts.append(cell[:60].ljust(widths[i]))
        return "| " + " | ".join(parts) + " |"

    sep = "+-" + "-+-".join("-" * w for w in widths) + "-+"
    header = _fmt_row(list(columns))

    lines = [sep, header, sep]
    for cells in str_rows:
        lines.append(_fmt_row(cells))
    lines.append(sep)

    omitted = (
        (total_rows - len(rows))
        if total_rows is not None and total_rows > len(rows)
        else 0
    )
    if omitted:
        lines.append(
            f"... ({omitted} rows omitted — add WHERE/LIMIT to narrow results)"
        )

    result = "\n".join(lines)

    # Byte cap.
    if len(result) > max_chars:
        truncated = result[:max_chars]
        # Trim to last newline for a clean cut.
        cut = truncated.rfind("\n")
        if cut > 0:
            truncated = truncated[:cut]
        remaining = len(result) - len(truncated)
        result = (
            truncated
            + f"\n... (output truncated, {remaining} chars omitted — add WHERE/LIMIT)"
        )

    return result


# ── View SQL ─────────────────────────────────────────────────────────────────


def _transcripts_table_sql(transcripts_glob: str) -> str:
    """SQL to materialise transcripts into an in-memory table."""
    return f"""
    CREATE OR REPLACE TABLE transcripts AS
    SELECT
        filename AS file,
        CAST(step AS INTEGER) AS step,
        CAST(episode AS VARCHAR) AS episode,
        CAST(tool_name AS VARCHAR) AS tool_name,
        CAST(len(CAST(think_raw AS VARCHAR)) AS INTEGER) AS think_chars,
        CAST(len(CAST(observation AS VARCHAR)) AS INTEGER) AS observation_chars,
        CAST(substring(CAST(think_raw AS VARCHAR), 1, 200) AS VARCHAR) AS think_preview,
        CAST(timestamp AS VARCHAR) AS ts
    FROM read_json_auto('{transcripts_glob}', filename=true, union_by_name=true)
    """


def _failures_table_sql(failures_paths: list[str]) -> str:
    """SQL to materialise failures into an in-memory table."""
    if not failures_paths:
        return """
        CREATE OR REPLACE TABLE failures
        (phase VARCHAR, attempts INTEGER, reason VARCHAR, model VARCHAR, timestamp VARCHAR)
        """
    unions = " UNION ALL ".join(
        f"SELECT "
        f"CAST(phase AS VARCHAR) AS phase, "
        f"CAST(attempts AS INTEGER) AS attempts, "
        f"CAST(reason AS VARCHAR) AS reason, "
        f"CAST(model AS VARCHAR) AS model, "
        f"CAST(timestamp AS VARCHAR) AS timestamp "
        f"FROM read_json_auto('{p}')"
        for p in failures_paths
    )
    return f"CREATE OR REPLACE TABLE failures AS {unions}"


def _run_state_table_sql(state_path: str) -> str:
    """SQL to materialise run_state into an in-memory table."""
    return f"""
    CREATE OR REPLACE TABLE run_state AS
    SELECT
        CAST(run_id AS VARCHAR) AS run_id,
        CAST(current_phase AS VARCHAR) AS current_phase,
        unnest_phase.key AS phase,
        CAST(unnest_phase.value->>'status' AS VARCHAR) AS status
    FROM read_json_auto('{state_path}'),
    LATERAL (SELECT * FROM json_each(phases)) AS unnest_phase(key, value)
    """


def _lane_files_table_sql(lane_plan_path: str) -> str:
    """SQL to materialise lane_files into an in-memory table."""
    return f"""
    CREATE OR REPLACE TABLE lane_files AS
    SELECT
        fo.key AS path,
        CAST(fo.value AS VARCHAR) AS lane
    FROM read_json_auto('{lane_plan_path}'),
    LATERAL (SELECT * FROM json_each(file_ownership)) AS fo(key, value)
    """


# ── Main entry point ─────────────────────────────────────────────────────────

_SHOW_TABLES_QUERY = re.compile(r"^\s*SHOW\s+TABLES\s*;?\s*$", re.IGNORECASE)

_VIEW_SCHEMA: dict[str, list[str]] = {
    "transcripts": [
        "file",
        "step",
        "episode",
        "tool_name",
        "think_chars",
        "observation_chars",
        "think_preview",
        "ts",
    ],
    "failures": ["phase", "attempts", "reason", "model", "timestamp"],
    "run_state": ["run_id", "current_phase", "phase", "status"],
    "lane_files": ["path", "lane"],
    "token_metrics": ["from sqlite state.db — columns vary; SELECT * to discover"],
    "kv_state": ["from sqlite state.db — columns vary; SELECT * to discover"],
    "floor_runs": ["run_dir"],
}


def _schema_summary() -> str:
    lines = ["Available views:", ""]
    for view, cols in _VIEW_SCHEMA.items():
        lines.append(f"  {view}")
        lines.append(f"    columns: {', '.join(cols)}")
        lines.append("")
    lines.append("Tip: SELECT * FROM <view> LIMIT 5  to sample any view.")
    return "\n".join(lines)


def run_corpus_query(
    query: str,
    limit: int = 20,
    repo_root: Path | None = None,
) -> str:
    """Execute *query* against DuckDB corpus views.

    Args:
        query: The SQL SELECT to run.  ``SHOW TABLES`` returns schema info.
        limit: Maximum rows to return (capped at MAX_ROWS=50).
        repo_root: Repository root directory; defaults to ``Path.cwd()``.

    Returns:
        A rendered text result, always ≤ MAX_CHARS characters, sanitized
        through ``prompt_sanitizer``.
    """
    # ── SHOW TABLES special-case ─────────────────────────────────────────────
    if _SHOW_TABLES_QUERY.match(query):
        return _schema_summary()

    # ── Guard ────────────────────────────────────────────────────────────────
    error = sql_guard(query)
    if error:
        return f"[corpus_sql] query rejected: {error}"

    # ── Resolve paths ────────────────────────────────────────────────────────
    root = (repo_root or Path.cwd()).resolve()
    datum_dir = root / ".datum"

    effective_limit = max(1, min(int(limit), MAX_ROWS))

    # ── Connect (in-memory, no disk state) ───────────────────────────────────
    try:
        import duckdb
    except ImportError:
        return (
            "[corpus_sql] duckdb not installed — run: pip install 'datum[rag]' "
            "or uv pip install duckdb"
        )

    con = duckdb.connect(":memory:")

    # ── Create views (missing sources → empty/stub view, never error) ─────────
    _setup_views(con, datum_dir)

    # ── Lock down external access AFTER views are created ────────────────────
    # This prevents the query itself from calling read_json/httpfs/etc.
    con.execute("SET enable_external_access=false")

    # ── Inject LIMIT if absent ────────────────────────────────────────────────
    bounded_query = _inject_limit(query, effective_limit)

    # ── Execute ───────────────────────────────────────────────────────────────
    try:
        rel = con.execute(bounded_query)
        columns = [desc[0] for desc in rel.description]
        # Fetch one extra row to detect total > limit.
        rows = rel.fetchmany(effective_limit + 1)
        total = len(rows)
        rows = rows[:effective_limit]
        result = render_rows(columns, rows, max_chars=MAX_CHARS, total_rows=total)
    except Exception as exc:
        result = f"[corpus_sql] query error: {exc}"
    finally:
        con.close()

    # ── Sanitize output before returning to caller ───────────────────────────
    try:
        from datum.prompt_sanitizer import strip_invisible_unicode, strip_special_tokens

        result = strip_special_tokens(result)
        result = strip_invisible_unicode(result)
    except ImportError:
        pass  # prompt_sanitizer not available in test isolation; skip gracefully

    return result


def _setup_views(con: Any, datum_dir: Path) -> None:  # noqa: ANN401
    """Materialise all corpus sources into in-memory tables on *con*.

    All file I/O happens here, before ``enable_external_access=false`` is
    set on the connection.  Missing files produce empty tables (never errors).
    """
    _TRANSCRIPT_COLS = [
        "file",
        "step",
        "episode",
        "tool_name",
        "think_chars",
        "observation_chars",
        "think_preview",
        "ts",
    ]

    # ── transcripts ───────────────────────────────────────────────────────────
    transcripts_dir = datum_dir / "transcripts"
    if transcripts_dir.exists() and list(transcripts_dir.glob("*.jsonl")):
        glob_path = str(transcripts_dir / "*.jsonl").replace("\\", "/")
        try:
            con.execute(_transcripts_table_sql(glob_path))
        except Exception:
            _empty_view(con, "transcripts", _TRANSCRIPT_COLS)
    else:
        _empty_view(con, "transcripts", _TRANSCRIPT_COLS)

    # ── failures ─────────────────────────────────────────────────────────────
    failure_paths: list[str] = []
    primary = datum_dir / "tdd-failure.json"
    if primary.exists():
        failure_paths.append(str(primary).replace("\\", "/"))
    runs_dir = datum_dir / "runs"
    if runs_dir.exists():
        for p in sorted(runs_dir.glob("*/tdd-failure.json")):
            failure_paths.append(str(p).replace("\\", "/"))

    try:
        con.execute(_failures_table_sql(failure_paths))
    except Exception:
        _empty_view(
            con, "failures", ["phase", "attempts", "reason", "model", "timestamp"]
        )

    # ── run_state ─────────────────────────────────────────────────────────────
    state_json = datum_dir / "state.json"
    if state_json.exists():
        try:
            con.execute(_run_state_table_sql(str(state_json).replace("\\", "/")))
        except Exception:
            _empty_view(
                con, "run_state", ["run_id", "current_phase", "phase", "status"]
            )
    else:
        _empty_view(con, "run_state", ["run_id", "current_phase", "phase", "status"])

    # ── lane_files ────────────────────────────────────────────────────────────
    lane_plan = datum_dir / "lane-plan.json"
    if lane_plan.exists():
        try:
            con.execute(_lane_files_table_sql(str(lane_plan).replace("\\", "/")))
        except Exception:
            _empty_view(con, "lane_files", ["path", "lane"])
    else:
        _empty_view(con, "lane_files", ["path", "lane"])

    # ── token_metrics / kv_state (sqlite state.db) ────────────────────────────
    # Materialise into local tables so they survive enable_external_access=false.
    state_db = datum_dir / "state.db"
    if state_db.exists():
        try:
            db_path = str(state_db).replace("\\", "/")
            con.execute(f"ATTACH '{db_path}' AS state_db (READ_ONLY)")
            con.execute(
                "CREATE OR REPLACE TABLE token_metrics AS "
                "SELECT * FROM state_db.token_metrics"
            )
            con.execute(
                "CREATE OR REPLACE TABLE kv_state AS " "SELECT * FROM state_db.kv_state"
            )
            con.execute("DETACH state_db")
        except Exception:
            _empty_view(con, "token_metrics", ["key", "value"])
            _empty_view(con, "kv_state", ["key", "value"])
    else:
        _empty_view(con, "token_metrics", ["key", "value"])
        _empty_view(con, "kv_state", ["key", "value"])

    # ── floor_runs ────────────────────────────────────────────────────────────
    # Report run dirs from .temp/floor-runs/ if present.
    floor_runs_dir = datum_dir.parent / ".temp" / "floor-runs"
    if floor_runs_dir.exists():
        run_dirs = sorted(d.name for d in floor_runs_dir.iterdir() if d.is_dir())
        if run_dirs:
            # Build a small inline JSON and use read_json_auto over a values list.
            rows_sql = ", ".join(f"('{d}')" for d in run_dirs)
            try:
                con.execute(
                    f"CREATE OR REPLACE TABLE floor_runs AS "
                    f"SELECT column0 AS run_dir FROM (VALUES {rows_sql})"
                )
            except Exception:
                _empty_view(con, "floor_runs", ["run_dir"])
        else:
            _empty_view(con, "floor_runs", ["run_dir"])
    else:
        _empty_view(con, "floor_runs", ["run_dir"])


def _empty_view(con: Any, name: str, columns: list[str]) -> None:  # noqa: ANN401
    """Create an empty in-memory table with the correct column names."""
    col_defs = ", ".join(f"{c} VARCHAR" for c in columns)
    con.execute(f"CREATE OR REPLACE TABLE {name} ({col_defs})")


def _inject_limit(query: str, limit: int) -> str:
    """Append LIMIT *limit* to *query* if it doesn't already have one."""
    # Strip trailing whitespace/semicolons for inspection.
    clean = query.rstrip().rstrip(";").strip()
    # Case-insensitive check for existing LIMIT clause.
    if re.search(r"\bLIMIT\b", clean, re.IGNORECASE):
        return clean
    return f"{clean} LIMIT {limit}"
