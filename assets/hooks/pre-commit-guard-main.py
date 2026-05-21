#!/usr/bin/env python3
import sys
import subprocess

def main():
    try:
        branch = subprocess.check_output(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], text=True).strip()
        if branch == 'main':
            print("DATUM guard-main-commit: Direct commits to 'main' are blocked.", file=sys.stderr)
            sys.exit(1)
        sys.exit(0)
    except Exception as e:
        print(f"WARNING: pre-commit-guard-main.py crashed ({e}). Failing open.", file=sys.stderr)
        sys.exit(0)

if __name__ == "__main__":
    main()
