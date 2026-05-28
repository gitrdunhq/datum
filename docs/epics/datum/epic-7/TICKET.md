# TICKET: Rock-Solid Installer for Team Distribution

## Summary

Harden install.sh for Linux + macOS team distribution. Add uv/Python prerequisite checks, consolidate the two install paths (install.sh vs datum install), add a proper onboarding README, and ensure first-run experience is zero-friction for a dev who's never seen datum.

## Requirements

1. install.sh checks for uv and Python >=3.12 before cloning, with clear install instructions if missing
2. install.sh runs `uv run datum doctor` after clone to verify the install works end-to-end
3. Consolidate: `datum install` becomes a wrapper that calls the same registration logic as install.sh (not a separate copy-based flow)
4. Root README.md with install instructions, quick start, and what datum is (currently docs/DATUM.md is the skill doc, not an install guide)
5. Post-install smoke test: `uv run datum status` must work from any directory after install
