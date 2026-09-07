# Review Report

**Findings:** 2 unique (1 high/critical)

## Findings

| ID | Severity | File | Line | Description | Suggestion | Key |
|---|---|---|---|---|---|---|
| SEC-001 | **low** | datum/code_tells.py | 66 | added_lines() joins the caller-supplied --files entries directly onto repo (path = repo / f) with no check that the resolved path stays under repo; a file argument like '../../etc/passwd' (or an absolute path, which Path./ treats as a full replacement) is read and its contents echoed back in the scan output when --base is omitted. | Resolve path and repo with .resolve() and reject/skip entries where the resolved path is not relative to repo, before reading. | 8386429e |
| CORR-001 | **high** | skills/src/datum-properties.ts | 47 | R2/AC2.1,AC2.3,AC2.4: FAIL — the properties-derive step only fetches SPEC.md and TASKS.md (probeSteps files: [SPEC_REL, TASKS_REL] at datum-properties.ts:47-91) and renders the prompt with only {specContent, tasksContent} (line 111). QUESTIONS.md is never read or passed to the derive agent anywhere in this file or in skills/src/prompts/properties-derive.md. The prompt text only says Source 'question:Q<n>' is 'for an invariant that answers a specific QUESTIONS.md id' (properties-derive.md:32) — it never instructs the agent to emit one invariant per answered question, and even if it did, the agent has no QUESTIONS.md content to work from, so it cannot know which questions exist or what was answered. AC2.1 (exactly one row per answered question) and AC2.3 (empty-answer questions yield zero rows) are structurally unfulfillable without that content, and AC2.4's required explicit instruction is absent from the template. | Add QUESTIONS.md to the probeSteps/relay files list, pass questionsContent into renderPrompt, and update properties-derive.md to explicitly state: 'emit one Integration Invariant per answered question in QUESTIONS.md, with Source question:Q<N>' as AC2.4 requires. | f938cc7a |
