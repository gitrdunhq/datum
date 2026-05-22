# Quality Profiles

Quality profiles are per-repo YAML files that define what "done" means for Review and
acceptance. They replace the implicit "6 review domains with generic criteria" with
repo-specific, weighted, policy-driven gates.

Inspired by Galley's `quality.yaml` and `environment.yaml` profile system.

Two files live in `.datum/profiles/`:
- `quality.yaml` — review dimensions, required checks, pass policy
- `environment.yaml` — local commands, executor defaults, constraints

---

## quality.yaml

```yaml
id: "default"

# Checks that must run after each ACT lane and pass before the lane is accepted.
# Preferred commands are tried in order; first passing command wins.
required_checks:
  - id: "tests"
    preferred_commands:
      - "swift test --parallel"
      - "xcodebuild test -scheme YourApp"
    required: true
  - id: "lint"
    preferred_commands:
      - "swiftlint --strict"
    required: true
  - id: "format"
    preferred_commands:
      - "swift-format lint --recursive Sources/"
    required: false

# Review dimensions for the Review phase.
# The renderer uses weights to compute a weighted score.
review_dimensions:
  - id: "acceptance"
    weight: 5
    required: true
    pass: "Every AC has implementation evidence or an explicit waived reason."
  - id: "properties"
    weight: 4
    required: true
    pass: "All PROPERTIES.md invariants are demonstrably held."
  - id: "security"
    weight: 3
    required: true
    pass: "No OWASP top-10 finding. No secrets exposed."
  - id: "performance"
    weight: 2
    required: false
    pass: "No N+1 queries or unbounded operations in hot paths."
  - id: "architecture"
    weight: 2
    required: false
    pass: "Tier boundaries respected. No new coupling across layers."
  - id: "observability"
    weight: 1
    required: false
    pass: "Key events logged with structured fields per OBS properties."
  - id: "dps"
    weight: 5
    required: true
    pass: "Dead Programmers Society rules are enforced. All code follows Fail-Open pattern where applicable."

# Evidence requirements for the Review agent.
evidence_requirements:
  file_line_references: true   # Review agent must cite file:line for findings
  command_outputs: true        # Required check outputs must appear in evidence

# Pass policy for Review gate.
pass_policy:
  required_dimensions_must_pass: true
  min_score: 75             # Weighted score 0-100 across all dimensions
  unresolved_high_findings_allowed: 0
  blocking_severities:
    - critical
    - high
```

## environment.yaml

```yaml
id: "local-dev"
cwd: "/path/to/repo"

# Named commands the skill and agents can reference by name.
commands:
  test_unit: "swift test --filter Unit"
  test_integration: "swift test --filter Integration"
  build: "swift build"
  lint: "swiftlint --strict"
  format: "swift-format lint --recursive Sources/"

# Default executor backend for new tasks.
executor:
  default_model: "standard"  # maps to config.toml [models] tiers

# Shell for required_checks execution.
required_checks:
  shell: "bash"

# Local constraints.
constraints:
  network: "approval_required"       # any network call in a lane tool requires approval
  secrets_policy: "never_read_env"   # lane tools cannot read .env files
  destructive_commands: "deny"       # rm -rf and equivalent blocked

# PR behavior defaults.
pr:
  base: "main"
  comments:
    enabled: true    # /datum <request> comments are polled
    reply: true      # post acknowledgement after handling

# Worktree cleanup after merge.
worktree:
  cleanup: true
```

---

## Where profiles are stored

`.datum/profiles/quality.yaml` and `.datum/profiles/environment.yaml`.

`datum init` seeds both from templates in `assets/templates/` (see below).
After seeding, the profiles are committed to the repo (not gitignored) so the team
can version-control their review expectations.

---

## How profiles are used

**Review phase:** `scripts/render.py` reads `quality.yaml` when rendering `REVIEW-REPORT.md`.
Instead of hard-coded 6 domains, it uses the `review_dimensions` from the profile.
The `pass_policy` determines whether the Review gate passes or fails.

**ACT phase:** `required_checks` from `quality.yaml` run after each REFACTOR commit.
Results are included in the executor result evidence. A required check that fails
downgrades a `done` verdict to `needs_review` (same as `completed_with_risks`).

**Config resolution:** `environment.yaml` commands are available to all agents via
the lane-tools README, replacing hard-coded command names in briefs.

---

## Validation

```
python3 scripts/gate.py validate-profiles
```

Validates both profiles against their schemas. Called during `datum init` and
before ACT starts. Invalid profiles fail pre-flight (not silently ignored).
