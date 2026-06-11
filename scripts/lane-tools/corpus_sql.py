#!/usr/bin/env python3
"""Lane tool: corpus_sql — read-only DuckDB queries over .datum artifacts.

Args (JSON via argv[1]):
    query  (str, required): A SELECT or WITH statement, or "SHOW TABLES".
    limit  (int, optional): Max rows to return (default 20, max 50).

Output: plain-text table to stdout.
"""

import json
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) < 2:
        print(
            "Usage: corpus_sql.py <json_args>\n"
            'Example: corpus_sql.py \'{"query": "SELECT * FROM failures LIMIT 5"}\''
        )
        sys.exit(1)

    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        print(f"Error: arguments must be a JSON object: {exc}")
        sys.exit(1)

    query = args.get("query", "")
    if not query:
        print("Error: 'query' argument is required.")
        sys.exit(1)

    limit = int(args.get("limit", 20))

    # Resolve repo root from cwd (the runner sets cwd to the target repo).
    repo_root = Path.cwd()

    try:
        from datum.memory.corpus_sql import run_corpus_query
    except ImportError as exc:
        print(
            f"Error: datum.memory.corpus_sql not available: {exc}\n"
            "Install with: pip install 'datum[rag]'"
        )
        sys.exit(1)

    result = run_corpus_query(query, limit=limit, repo_root=repo_root)
    print(result)


if __name__ == "__main__":
    main()
