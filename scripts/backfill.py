#!/usr/bin/env python3
"""
backfill.py — Local analytics using DuckDB on JSONL telemetry.
"""

import argparse
import sys
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("duckdb not installed. Please install it via `uv pip install duckdb` or `pip install duckdb`.", file=sys.stderr)
    sys.exit(1)

TELEMETRY_LOG = Path(".datum/telemetry.jsonl")

def query_telemetry(sql: str) -> None:
    if not TELEMETRY_LOG.exists():
        print("No telemetry.jsonl found.", file=sys.stderr)
        sys.exit(1)
        
    con = duckdb.connect(database=':memory:')
    
    # Read the JSONL into a view
    # DuckDB handles JSON automatically:
    con.execute(f"CREATE VIEW telemetry AS SELECT * FROM read_json_auto('{TELEMETRY_LOG}')")
    
    try:
        result = con.execute(sql).df()
        print(result)
    except Exception as e:
        print(f"Query error: {e}", file=sys.stderr)
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Query telemetry via DuckDB")
    parser.add_argument("--query", help="SQL query to run against 'telemetry' view", default="SELECT * FROM telemetry LIMIT 10")
    args = parser.parse_args()
    
    query_telemetry(args.query)

if __name__ == "__main__":
    main()
