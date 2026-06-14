// @generated — DO NOT EDIT. Source: skills/src/datum-go.ts
export const meta = {
  name: "datum-go",
  description: "Full pipeline: TICKET \u2192 SPEC \u2192 Plan \u2192 Properties \u2192 Act \u2192 Validate \u2192 Review \u2192 Closeout",
  phases: [
    { title: "Refine", detail: "TICKET.md \u2192 SPEC.md" },
    { title: "Plan", detail: "SPEC.md \u2192 tasks.json + lane-plan.json" },
    { title: "Properties", detail: "11-category invariants" },
    { title: "Act", detail: "TDD pipeline: RED \u2192 GREEN \u2192 REFACTOR per lane" },
    { title: "Validate", detail: "full test suite + lint + AC check" },
    { title: "Review", detail: "4-domain parallel review swarm" },
    { title: "Closeout", detail: "collect \u2192 synthesize \u2192 archive" }
  ]
};

// skills/src/datum-go.ts
var rawArgs = typeof args === "string" ? args.trim().replace(/^"|"$/g, "").trim() : "";
var a = typeof args === "string" ? rawArgs.toLowerCase() === "yolo" ? { yolo: true } : JSON.parse(args) : args || {};
var yolo = !!a.yolo;
var startFrom = (a.startFrom || "refine").toLowerCase();
var PHASE_ORDER = ["refine", "plan", "properties", "act", "validate", "review", "closeout"];
var startIdx = PHASE_ORDER.indexOf(startFrom);
if (startIdx === -1) {
  throw new Error(`Unknown phase: ${startFrom}. Valid: ${PHASE_ORDER.join(", ")}`);
}
log(`datum go \u2014 starting from ${startFrom}${yolo ? " (yolo mode)" : ""}`);
var lastResult = {};
var haltedAt = "";
if (!haltedAt && startIdx <= 0) {
  phase("Refine");
  lastResult = await workflow({ scriptPath: "skills/datum-refine.js" }, yolo ? "yolo" : {});
  if (!yolo && !lastResult.gatePassed) {
    haltedAt = "refine";
    log(`Refine gate held: ${lastResult.gateMessage || "needs review"}. Address QUESTIONS.md, then: datum go --start-from plan`);
  } else {
    log("Refine complete");
  }
}
if (!haltedAt && startIdx <= 1) {
  phase("Plan");
  lastResult = await workflow({ scriptPath: "skills/datum-plan.js" }, yolo ? "yolo" : {});
  if (!lastResult.gatePassed) {
    haltedAt = "plan";
    log(`Plan gate held: ${lastResult.gateMessage || "needs approval"}. Review TASKS.md, then: datum go --start-from properties`);
  } else {
    log(`Plan complete \u2014 ${lastResult.taskCount || "?"} tasks`);
  }
}
if (!haltedAt && startIdx <= 2) {
  phase("Properties");
  lastResult = await workflow({ scriptPath: "skills/datum-properties.js" }, yolo ? "yolo" : {});
  log("Properties complete");
}
if (!haltedAt && startIdx <= 3) {
  phase("Act");
  lastResult = await workflow({ scriptPath: "skills/datum-tdd-act.js" }, yolo ? "yolo" : {});
  log(`Act complete \u2014 ${lastResult.completed || 0} succeeded, ${lastResult.failed || 0} failed`);
  if ((lastResult.failed || 0) > 0) {
    log(`Failed lanes: ${(lastResult.failedLanes || []).join(", ")}`);
  }
}
if (!haltedAt && startIdx <= 4) {
  phase("Validate");
  lastResult = await workflow({ scriptPath: "skills/datum-validate.js" }, yolo ? "yolo" : {});
  if (!lastResult.testsPassed) {
    haltedAt = "validate";
    log("Validate FAILED \u2014 tests are red. Pipeline halted.");
  } else {
    log("Validate complete");
  }
}
if (!haltedAt && startIdx <= 5) {
  phase("Review");
  lastResult = await workflow({ scriptPath: "skills/datum-review.js" }, yolo ? "yolo" : {});
  if (!lastResult.canMerge) {
    haltedAt = "review";
    log(`Review: ${lastResult.criticalFindings || "?"} critical issues. Fix, then: datum go --start-from validate`);
  } else {
    log("Review complete \u2014 clear to merge");
  }
}
if (!haltedAt && startIdx <= 6) {
  phase("Closeout");
  lastResult = await workflow({ scriptPath: "skills/datum-closeout.js" }, yolo ? "yolo" : {});
  log("Closeout complete");
}
if (haltedAt) {
  log(`
Pipeline halted at ${haltedAt}. Resume with: datum go --start-from <next-phase>`);
} else {
  log("\n" + "=".repeat(60));
  log("DATUM GO COMPLETE");
  log("=".repeat(60));
}
return {
  phase: haltedAt || "complete",
  halted: !!haltedAt,
  ...lastResult
};
