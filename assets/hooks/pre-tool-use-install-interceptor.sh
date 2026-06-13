#!/usr/bin/env bash
# pre-tool-use-install-interceptor.sh
# Intercepts package install commands and surfaces them to the user via gate.
# Installed as a PreToolUse hook by: python3 scripts/bootstrap/install_hooks.py

if [ "${DATUM_SUBPROCESS:-0}" = "1" ]; then
  exit 0
fi

COMMAND="$1"

INSTALL_PATTERNS=(
  "pip install"
  "pip3 install"
  "npm install"
  "npm i "
  "pnpm add"
  "yarn add"
  "apt-get install"
  "brew install"
  "cargo add"
  "go get"
  "gem install"
  "conda install"
  "poetry add"
  "uv add"
  "gh extension install"
)

for pattern in "${INSTALL_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qF "$pattern"; then
    echo "DATUM HARD STOP: external_dependency_install_proposed"
    echo ""
    echo "The agent attempted to run: $COMMAND"
    echo ""
    echo "External dependency installation requires human approval."
    echo "The orchestrator will surface this request to the user."
    echo "Once approved, the install will run outside the hook context."
    exit 2
  fi
done

exit 0
