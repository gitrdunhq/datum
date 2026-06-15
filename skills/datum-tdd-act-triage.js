// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-triage.ts
export const meta = {
  name: "datum-tdd-act-triage",
  description: "Categorize TDD failures and auto-file GitHub issues",
  phases: [{ title: "Triage" }]
};

// skills/src/shared/models.ts
var DEFAULT_TIERS = {
  fast: "haiku",
  balanced: "sonnet",
  deep: "opus"
};
var activeTiers = { ...DEFAULT_TIERS };
function model(tier) {
  return activeTiers[tier];
}

// skills/src/shared/schemas.ts
var TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    issues: { type: "array", items: {
      type: "object",
      properties: {
        title: { type: "string" },
        category: { type: "string", enum: ["workflow-bug", "lane-plan", "agent-behavior", "infrastructure", "test-quality"] },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        body: { type: "string" },
        lane: { type: "string" },
        stage: { type: "string" }
      },
      required: ["title", "category", "body"]
    } }
  },
  required: ["issues"]
};

// skills/src/datum-tdd-act-triage.ts
var a = args;
phase("Triage");
var filed = 0;
if (a.failures.length === 0) {
  log("[triage] All lanes succeeded \u2014 no issues to file");
} else {
  const failureDetails = a.failures.map((fid) => {
    const r = a.results[fid];
    const lane = a.lanePlan.lanes[fid];
    return `Lane ${fid} ("${lane?.title || "unknown"}"): failed at ${r?.stage || "UNKNOWN"} \u2014 ${r?.error || "null result"}`;
  }).join("\n");
  const triage = await agent(
    `Analyze these TDD workflow failures and categorize each one.

Run ID: ${a.runId}
Epic branch: ${a.epicBranch}
Failed lanes:
${failureDetails}

For each failure, determine:
- Is this a WORKFLOW BUG (datum-tdd-act.js logic error)?
- Is this a LANE PLAN issue (bad ACs, wrong files, missing deps)?
- Is this an AGENT BEHAVIOR issue (agent didn't follow instructions)?
- Is this INFRASTRUCTURE (git, build tools, test runner, CWD issues)?
- Is this TEST QUALITY (tests too weak, wrong assertions)?

For each issue, write a GitHub issue title starting with [datum-bug] and a body with:
- What happened (the error)
- Why it happened (root cause analysis)
- Suggested fix
- The lane, stage, and run ID for traceability`,
    { label: "triage", phase: "Triage", model: model("balanced"), schema: TRIAGE_SCHEMA }
  );
  if (triage?.issues?.length) {
    for (const issue of triage.issues) {
      if (issue.severity === "low") {
        log(`[triage] Skipping low-severity: ${issue.title}`);
        continue;
      }
      const labels = `datum-bug,${issue.category}`;
      const safeTitle = issue.title.slice(0, 80).replace(/'/g, "'\\''");
      const safeSearch = issue.title.slice(0, 50).replace(/'/g, "'\\''");
      const safeBody = issue.body.replace(/'/g, "'\\''");
      await agent(
        `unset GITHUB_TOKEN && gh issue list --repo gitrdunhq/datum --state open --search '${safeSearch}' --json number,title --limit 3 | head -5
If no duplicate exists, create the issue:
unset GITHUB_TOKEN && gh issue create --repo gitrdunhq/datum --title '${safeTitle}' --label '${labels}' --body '${safeBody}'
If a duplicate exists, skip and say "duplicate found".`,
        { label: `file-issue:${issue.lane || "global"}`, phase: "Triage", model: model("fast") }
      );
      log(`[triage] Filed: ${issue.title} [${issue.category}/${issue.severity}]`);
      filed++;
    }
  } else {
    log("[triage] No actionable issues identified");
  }
}
return { filed };
