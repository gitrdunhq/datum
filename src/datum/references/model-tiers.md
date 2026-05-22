# Model Tiers

The skill uses three model tiers. Actual model IDs are configured in `.datum/config.toml` or `assets/config.toml.default`.

## Tier Definitions

| Tier | Config key | Default model | Use for |
|---|---|---|---|
| Reasoning | `models.reasoning` | `claude-opus-4-7` | Ambiguity resolution, multi-step planning, synthesis, triage, closeout |
| Standard | `models.standard` | `claude-sonnet-4-6` | Coding tasks (RED, GREEN, REFACTOR), review, validation |
| Fast | `models.fast` | `claude-haiku-4-5-20251001` | Source inspection, schema validation, simple lookups |

## Per-Phase Assignments

| Phase / Stage | Default tier |
|---|---|
| Refine | Reasoning |
| Plan | Reasoning |
| Properties | Reasoning |
| ACT — RED | Standard |
| ACT — GREEN | Standard |
| ACT — REFACTOR | Standard |
| ACT — REFACTOR (integration tasks, config) | May escalate to Reasoning |
| Validate | Standard |
| Review | Standard |
| PR Comments triage | Reasoning |
| PR Comments fix | Standard |
| Closeout synthesis | Reasoning |
| Source inspection helpers | Fast |

## Retry Escalation

Within the ACT retry ladder, model tier escalates on attempt 2:
```
Attempt 1: Standard tier (same brief, new agent)
Attempt 2: Reasoning tier (rewritten brief + diagnostics)
Attempt 3: Reasoning tier (verbose mode + explicit failure context)
```

Environmental failures are never escalated — fixing the environment doesn't require a smarter model.

## Override

Per-phase overrides in `config.toml`:
```toml
[models.phases]
act_refactor = "reasoning"  # override for this repo
```

The override applies to all lanes in that phase for this run.
