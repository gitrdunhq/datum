#!/usr/bin/env python3
import sys
import json
import subprocess


def main():
    if len(sys.argv) < 2:
        print("Usage: run_command.py <json_args>")
        sys.exit(1)

    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError:
        print("Error: Arguments must be a JSON object.")
        sys.exit(1)

    command = args.get("command")
    if not command:
        print("Error: 'command' argument is required.")
        sys.exit(1)

    try:
        proc = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=55,
        )
        if proc.stdout:
            print(proc.stdout, end="")
        if proc.stderr:
            print(proc.stderr, end="", file=sys.stderr)
        sys.exit(proc.returncode)
    except subprocess.TimeoutExpired:
        print("Error: Command timed out.")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
