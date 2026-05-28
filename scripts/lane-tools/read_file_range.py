#!/usr/bin/env python3
import sys
import json
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Usage: read_file_range.py <json_args>")
        sys.exit(1)
        
    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError:
        print("Error: Arguments must be a JSON object.")
        sys.exit(1)
        
    path_str = args.get("path")
    if not path_str:
        print("Error: 'path' argument is required.")
        sys.exit(1)
        
    start_line = args.get("start_line", 1)
    end_line = args.get("end_line")
    
    try:
        start_line = max(1, int(start_line))
        if end_line is not None:
            end_line = max(start_line, int(end_line))
    except ValueError:
        print("Error: start_line and end_line must be integers.")
        sys.exit(1)
        
    target = Path(path_str).resolve()
    if not target.is_file():
        print(f"Error: File '{target}' does not exist or is not a file.")
        sys.exit(1)
        
    try:
        with open(target, "r", encoding="utf-8") as f:
            for i, line in enumerate(f, start=1):
                if i >= start_line:
                    if end_line and i > end_line:
                        break
                    print(line, end="")
    except Exception as e:
        print(f"Error reading file '{target}': {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
