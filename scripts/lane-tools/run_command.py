#!/usr/bin/env python3
import json
import shlex
import subprocess
import sys

TIMEOUT_S = 55


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

    # SEC-001 (#97): never hand model-supplied strings to a shell.
    # Split into argv and run with shell=False — metacharacters
    # ($(...), ;, &&, |, >) are passed through as literal arguments.
    try:
        argv = shlex.split(command)
    except ValueError as e:
        print(f"Error: could not parse command: {e}")
        sys.exit(1)
    if not argv:
        print("Error: 'command' argument is empty.")
        sys.exit(1)

    try:
        proc = subprocess.run(
            argv,
            shell=False,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_S,
        )
        if proc.stdout:
            print(proc.stdout, end="")
        if proc.stderr:
            print(proc.stderr, end="", file=sys.stderr)
        sys.exit(proc.returncode)
    except subprocess.TimeoutExpired:
        print("Error: Command timed out.")
        sys.exit(1)
    except FileNotFoundError:
        print(f"Error: command not found: {argv[0]}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
