// @generated — DO NOT EDIT. Source: skills/src/datum-go.ts
export const meta = {
  name: "datum-go",
  description: "Full pipeline: TICKET \u2192 SPEC \u2192 Plan \u2192 Properties \u2192 Act \u2192 Validate \u2192 Review \u2192 Closeout",
  phases: []
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
  log("\u2500\u2500 Refine \u2500\u2500");
  lastResult = await workflow({ scriptPath: "skills/datum-refine.js" }, yolo ? "yolo" : {});
  if (!yolo && !lastResult.gatePassed) {
    haltedAt = "refine";
    log(`Refine gate held: ${lastResult.gateMessage || "needs review"}. Address QUESTIONS.md, then: datum go --start-from plan`);
  } else {
    log("Refine complete");
  }
}
if (!haltedAt && startIdx <= 1) {
  log("\u2500\u2500 Plan \u2500\u2500");
  lastResult = await workflow({ scriptPath: "skills/datum-plan.js" }, yolo ? "yolo" : {});
  if (!lastResult.gatePassed) {
    haltedAt = "plan";
    log(`Plan gate held: ${lastResult.gateMessage || "needs approval"}. Review TASKS.md, then: datum go --start-from properties`);
  } else {
    log(`Plan complete \u2014 ${lastResult.taskCount || "?"} tasks`);
  }
}
if (!haltedAt && startIdx <= 2) {
  log("\u2500\u2500 Properties \u2500\u2500");
  lastResult = await workflow({ scriptPath: "skills/datum-properties.js" }, yolo ? "yolo" : {});
  log("Properties complete");
}
if (!haltedAt && startIdx <= 3) {
  log("\u2500\u2500 Act \u2500\u2500");
  lastResult = await workflow({ scriptPath: "skills/datum-tdd-act.js" }, yolo ? "yolo" : {});
  log(`Act complete \u2014 ${lastResult.completed || 0} succeeded, ${lastResult.failed || 0} failed`);
  if ((lastResult.failed || 0) > 0) {
    log(`Failed lanes: ${(lastResult.failedLanes || []).join(", ")}`);
  }
}
if (!haltedAt && startIdx <= 4) {
  log("\u2500\u2500 Validate \u2500\u2500");
  lastResult = await workflow({ scriptPath: "skills/datum-validate.js" }, yolo ? "yolo" : {});
  if (!lastResult.testsPassed) {
    haltedAt = "validate";
    log("Validate FAILED \u2014 tests are red. Pipeline halted.");
  } else {
    log("Validate complete");
  }
}
if (!haltedAt && startIdx <= 5) {
  log("\u2500\u2500 Review \u2500\u2500");
  lastResult = await workflow({ scriptPath: "skills/datum-review.js" }, yolo ? "yolo" : {});
  if (!lastResult.canMerge) {
    haltedAt = "review";
    log(`Review: ${lastResult.criticalFindings || "?"} critical issues. Fix, then: datum go --start-from validate`);
  } else {
    log("Review complete \u2014 clear to merge");
  }
}
if (!haltedAt && startIdx <= 6) {
  log("\u2500\u2500 Closeout \u2500\u2500");
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
