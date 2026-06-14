// @generated — DO NOT EDIT. Source: skills/src/datum-route.ts
export const meta = {
  name: "datum-route",
  description: "Smart router: classify input \u2192 pick the right pipeline composition",
  phases: [
    { title: "Classify", detail: "sonnet reads input + artifacts, determines route and startFrom" }
  ]
};

// skills/src/shared/utils.ts
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
}

// skills/src/shared/models.ts
var TIER_MAP = {
  fast: "haiku",
  balanced: "sonnet",
  deep: "opus"
};
function model(tier) {
  return TIER_MAP[tier];
}
var ROUTE_PHASES = {
  feature: ["refine", "plan", "properties", "act", "validate", "review", "closeout"],
  hotfix: ["act", "validate", "review"],
  spike: ["refine", "plan"],
  audit: ["properties", "validate", "review"],
  resume: [],
  "refine-only": ["refine"]
};
var DEFAULT_CONFIG = {
  language: "python",
  test_framework: "pytest",
  test_command: "uv run pytest -x -q"
};
var READ_CONFIG_PROMPT = `Read .datum/config.json if it exists and return the raw JSON. If not found, return: ${JSON.stringify(DEFAULT_CONFIG)}. Output raw JSON only.`;

// skills/src/prompts/route-classify.md
var route_classify_default = `You are the datum router. Classify the input and determine which pipeline to run.

## Input

{{input}}

## Existing Artifacts

{{artifacts}}

## Git State

{{gitState}}

## Routes

Pick exactly ONE route based on the signals:

### feature
Full epic pipeline. Use when:
- New feature request or substantial enhancement
- No existing SPEC.md or TASKS.md (or they're stale)
- Input describes new capabilities, not fixes

### hotfix
Fast bug fix: act \u2192 validate \u2192 review. Use when:
- Input describes a bug, error, or regression
- Fix scope is narrow (1-3 files)
- Existing tests cover the area (or simple to add)
- TASKS.md or lane-plan.json already exists with the fix planned

### spike
Exploration only: refine \u2192 plan. Use when:
- Input is a question ("should we...", "how would we...", "what if...")
- Research or feasibility study
- No code changes expected yet

### audit
Check existing code: properties \u2192 validate \u2192 review. Use when:
- Input asks to review, audit, or check quality
- No new code to write, just evaluate what's there
- Security review, performance audit, compliance check

### resume
Continue a paused pipeline. Use when:
- Existing artifacts show a pipeline was interrupted
- SPEC.md exists but no TASKS.md \u2192 resume from plan
- TASKS.md exists but no lane-plan.json \u2192 resume from plan
- lane-plan.json exists but lanes not executed \u2192 resume from act
- Input says "continue", "resume", "pick up where we left off"

### refine-only
Flesh out an idea: refine only. Use when:
- Input is raw, unstructured, stream-of-consciousness
- User wants structure from chaos, not code yet
- "I have this idea..." with no clear action

## Determining startFrom for resume

Check artifacts in order:
1. SPEC.md exists? If no \u2192 startFrom: refine
2. TASKS.md exists? If no \u2192 startFrom: plan
3. lane-plan.json exists? If no \u2192 startFrom: plan
4. PROPERTIES.md exists? If no \u2192 startFrom: properties
5. Lanes executed (check .datum/runs/)? If no \u2192 startFrom: act
6. Tests passing? If unknown \u2192 startFrom: validate
7. Review done? If no \u2192 startFrom: review
8. Otherwise \u2192 startFrom: closeout

## Output

Return JSON:
{
  "route": "feature|hotfix|spike|audit|resume|refine-only",
  "startFrom": "refine|plan|properties|act|validate|review|closeout",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence explaining why this route",
  "signals": {
    "intent": "what the user wants (verb + object)",
    "scope": "narrow|moderate|broad",
    "has_spec": true/false,
    "has_tasks": true/false,
    "has_lane_plan": true/false,
    "has_properties": true/false,
    "branch_type": "main|feature|hotfix",
    "input_type": "ticket|bug|question|audit|continuation|raw-idea"
  }
}

Output raw JSON only. No markdown fences.
`;

// skills/src/datum-route.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var input = rawArgs || "No input provided \u2014 check for TICKET.md";
phase("Classify");
var [artifactCheck, gitCheck] = await parallel([
  () => agent(
    'Check which pipeline artifacts exist. Run:\necho "TICKET: $(test -f TICKET.md && echo YES || echo NO)"\necho "SPEC: $(test -f SPEC.md && echo YES || echo NO)"\necho "TASKS: $(test -f TASKS.md && echo YES || echo NO)"\necho "LANE_PLAN: $(test -f .datum/lane-plan.json && echo YES || echo NO)"\necho "PROPERTIES: $(test -f PROPERTIES.md && echo YES || echo NO)"\necho "RUNS: $(ls .datum/runs/ 2>/dev/null | tail -3 || echo NONE)"\nReturn the raw output only.',
    { label: "check-artifacts", model: model("fast") }
  ),
  () => agent(
    "Run these commands and return the raw output:\ngit rev-parse --abbrev-ref HEAD\ngit log --oneline -5\ngit status --short | head -10",
    { label: "check-git", model: model("fast") }
  )
]);
var ROUTE_SCHEMA = {
  type: "object",
  properties: {
    route: { type: "string", enum: ["feature", "hotfix", "spike", "audit", "resume", "refine-only"] },
    startFrom: { type: "string", enum: ["refine", "plan", "properties", "act", "validate", "review", "closeout"] },
    confidence: { type: "number" },
    reasoning: { type: "string" },
    signals: {
      type: "object",
      properties: {
        intent: { type: "string" },
        scope: { type: "string", enum: ["narrow", "moderate", "broad"] },
        has_spec: { type: "boolean" },
        has_tasks: { type: "boolean" },
        has_lane_plan: { type: "boolean" },
        has_properties: { type: "boolean" },
        branch_type: { type: "string", enum: ["main", "feature", "hotfix"] },
        input_type: { type: "string", enum: ["ticket", "bug", "question", "audit", "continuation", "raw-idea"] }
      },
      required: ["intent", "scope", "has_spec", "has_tasks", "has_lane_plan", "has_properties", "branch_type", "input_type"]
    }
  },
  required: ["route", "startFrom", "confidence", "reasoning", "signals"]
};
var classifyPrompt = renderPrompt(route_classify_default, {
  input,
  artifacts: String(artifactCheck || "could not check"),
  gitState: String(gitCheck || "could not check")
});
var decision = await agent(classifyPrompt, {
  label: "classify",
  model: model("balanced"),
  schema: ROUTE_SCHEMA
});
if (!decision) throw new Error("Router classification failed \u2014 no decision returned");
var confident = decision.confidence >= 0.7;
log(`Route: ${decision.route} \u2192 start from: ${decision.startFrom} (${Math.round(decision.confidence * 100)}% confidence${confident ? "" : " \u2014 LOW, gates enabled"})`);
log(`Reason: ${decision.reasoning}`);
var logEntry = JSON.stringify({
  route: decision.route,
  startFrom: decision.startFrom,
  confidence: decision.confidence,
  reasoning: decision.reasoning,
  signals: decision.signals,
  input_length: input.length
});
await agent(
  `Create directory .datum if it doesn't exist, then APPEND exactly this line to .datum/routing.jsonl:
${logEntry}
Do not modify the line. Do not add markdown. Just append it.`,
  { label: "log-decision", model: model("fast") }
);
var routeKey = decision.route;
var invoke = {
  workflow: "datum-go",
  args: {
    yolo: confident,
    startFrom: decision.startFrom,
    route: decision.route,
    phases: ROUTE_PHASES[routeKey] ? [...ROUTE_PHASES[routeKey]] : []
  }
};
log(`
Next: Workflow({ name: "${invoke.workflow}" }, ${JSON.stringify(invoke.args)})`);
return {
  route: decision.route,
  startFrom: decision.startFrom,
  confidence: decision.confidence,
  reasoning: decision.reasoning,
  signals: decision.signals,
  invoke
};
