// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-lane.ts
export const meta = {
  name: "datum-tdd-act-lane",
  description: "DAG-scheduled TDD execution: RED->GREEN->REFACTOR per lane",
  phases: [{ title: "Act" }]
};

// skills/src/shared/schemas.ts
var STAGE_RESULT_SCHEMA = {
  type: "object",
  properties: {
    files_written: { type: "array", items: { type: "string" } },
    success: { type: "boolean" },
    tests_pass: { type: "boolean" },
    test_exit_code: { type: "number" },
    test_errors: { type: "array", items: { type: "string" } },
    test_output: { type: "string" },
    committed: { type: "boolean" },
    commit_sha: { type: "string" },
    failure_reason: { type: "string" }
  },
  required: ["success", "tests_pass", "committed"]
};
var REFLECT_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    gaps: { type: "array", items: { type: "string" } },
    score: { type: "number" }
  },
  required: ["reasoning", "score"]
};
var SKEPTIC_SCHEMA = {
  type: "object",
  properties: {
    bugs_found: { type: "array", items: {
      type: "object",
      properties: {
        description: { type: "string" },
        evidence: { type: "string" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] }
      },
      required: ["description", "evidence", "severity"]
    } },
    confidence: { type: "number" },
    verdict: { type: "string", enum: ["PASS", "FRAGILE", "BROKEN"] }
  },
  required: ["bugs_found", "confidence", "verdict"]
};
var REFACTOR_CHECK_SCHEMA = {
  type: "object",
  properties: {
    should_refactor: { type: "boolean" },
    reason: { type: "string" }
  },
  required: ["should_refactor"]
};

// skills/src/shared/utils.ts
function classifyFiles(files) {
  const isTest = (f) => {
    const base = f.split("/").pop() || "";
    return base.startsWith("test_") || base.endsWith("_test.py") || base.endsWith(".test.ts") || base.endsWith(".test.js") || base.endsWith(".spec.ts") || base.endsWith(".spec.js") || base.endsWith("_test.go") || base.endsWith("Tests.swift") || f.includes("/tests/") || f.includes("/Tests/") || base === "conftest.py";
  };
  const testFiles = (files || []).filter(isTest);
  const implFiles = (files || []).filter((f) => !isTest(f));
  return { testFiles, implFiles };
}
function parseAgentJson(text, fallback) {
  if (!text || typeof text !== "string") return fallback;
  const cleaned = text.replace(/```[a-z]*\n?/g, "").trim();
  const start = cleaned.search(/[{[]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (start === -1 || end === -1) return fallback;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return fallback;
  }
}
function laneCtxCmd(packet, wt) {
  const ctx = JSON.stringify({
    task_id: packet.task_id,
    stage: packet.stage,
    allowed_write_files: packet.allowed_write_files,
    forbidden_write_files: packet.forbidden_write_files,
    commit_prefix: packet.commit_prefix,
    test_count_floor: 0
  });
  return `mkdir -p "${wt}/.datum" && printf '%s' '${ctx.replace(/'/g, "'\\''")}' > "${wt}/.datum/lane-context.json"`;
}
var BUILTIN_SKIP = /* @__PURE__ */ new Set([
  "print",
  "len",
  "str",
  "int",
  "dict",
  "list",
  "set",
  "isinstance",
  "type",
  "exit",
  "round",
  "sorted",
  "filter",
  "map",
  "any",
  "all",
  "range",
  "enumerate",
  "zip",
  "open",
  "input",
  "format",
  "repr",
  "hash",
  "id",
  "dir",
  "vars",
  "super",
  "property",
  "staticmethod",
  "classmethod"
]);
function extractContractSummary(acceptanceCriteria) {
  return (acceptanceCriteria || []).map((ac) => {
    const funcMatch = ac.match(/(?<!['"-])(\w+)\(([^)]*)\)/);
    const retMatch = ac.match(/returns?\s+(?:a\s+)?(\w+)/i);
    const raiseMatch = ac.match(/[Rr]aises?\s+(\w+Error|\w+Exception)/);
    if (!funcMatch || BUILTIN_SKIP.has(funcMatch[1])) return null;
    return {
      function: funcMatch[1],
      args: funcMatch[2] ? funcMatch[2].split(",").map((a2) => a2.trim()).filter(Boolean) : [],
      returns: retMatch ? retMatch[1] : null,
      raises: raiseMatch ? raiseMatch[1] : null,
      ac: ac.slice(0, 120)
    };
  }).filter((entry) => entry !== null);
}
function crossValidateBugs(skepticResults, lenses) {
  const allBugs = [];
  let brokenCount = 0;
  for (let i = 0; i < lenses.length; i++) {
    const s = skepticResults[i];
    if (!s) continue;
    if (s.verdict === "BROKEN") brokenCount++;
    for (const bug of s.bugs_found || []) {
      allBugs.push({ ...bug, lens: lenses[i].key });
    }
  }
  const bugDescs = allBugs.map((b) => b.description.toLowerCase().slice(0, 60));
  const crossValidated = allBugs.filter((_bug, idx) => {
    const myDesc = bugDescs[idx];
    return bugDescs.some((d, j) => j !== idx && d === myDesc);
  });
  return { allBugs, brokenCount, crossValidated };
}
function buildPacket(taskId, testFiles, implFiles, lane, wt, cfg2, stage, extras = {}) {
  return {
    schema_version: "1.0",
    task_id: taskId,
    stage,
    title: lane.title,
    working_directory: wt,
    test_command: cfg2.testCommand,
    acceptance_criteria: lane.acceptance_criteria || [],
    red_note: lane.red_note || "",
    allowed_write_files: stage === "RED" ? testFiles : stage === "GREEN" ? implFiles : [...testFiles, ...implFiles],
    forbidden_write_files: stage === "RED" ? implFiles : stage === "GREEN" ? testFiles : [],
    commit_prefix: stage === "RED" ? `red(${taskId})` : stage === "GREEN" ? `green(${taskId})` : `refactor(${taskId})`,
    ...extras
  };
}
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
}

// skills/src/prompts/red.md
var red_default = 'RED TDD agent. Write failing tests that prove the acceptance criteria are not yet implemented.\n\nSETUP:\n1. cd into {{wt}}\n2. Run: {{skeletonCmd}}\n3. Run: {{redCtxCmd}}\n\nTASK PACKET: {{redPacketStr}}\n\nGOAL: Write one test function per acceptance criterion. Each test must FAIL when you run it.\n\nAPPROACH:\n1. Read the acceptance_criteria from the task packet\n2. For each AC, write a test that calls the method described in the AC\n3. Assert specific expected values \u2014 not just "doesn\'t crash"\n4. Call methods that don\'t exist yet (e.g., result.to_dict()) \u2014 AttributeError is the correct RED failure\n\nAFTER WRITING:\n5. Run {{testCommand}} and capture the FULL output. Report it in test_output (last 50 lines max).\n6. Your new tests MUST fail. Report tests_pass=false and the exit code.\n7. Commit test files: git -C "{{wt}}" add {{testFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: RED complete"\n8. Report the commit SHA in commit_sha.\n\nCONSTRAINTS:\n- Append new test functions to existing test files \u2014 keep all existing tests intact\n- Only write and commit test files: {{testFilesList}}\n\nBANNED PATTERNS (any of these = pipeline rejection, no exceptions):\n- `assert True`, `assert 1`, `assert not False` \u2014 always passes\n- `pass` as the only statement in a test body\n- Empty test functions with no assertions\n- `raise NotImplementedError` \u2014 conftest xfail catches it and tests pass\n- `assert x is not None` as the ONLY assertion \u2014 smoke test, not a real check\nEach test MUST assert a specific expected value or exception type.\n';

// skills/src/prompts/red-retry.md
var red_retry_default = 'RED TDD agent \u2014 RETRY. Previous attempt failed: {{failureReason}}.\n\nFirst reset: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/\n\nSETUP: {{redCtxCmd}}\nTASK PACKET: {{redPacketStr}}\n\nWrite simple, concrete tests. One test per acceptance criterion. Assert specific values.\nCall methods that don\'t exist yet \u2014 AttributeError is your RED signal.\nNEVER use `raise NotImplementedError` \u2014 conftest will xfail it.\n\nAFTER WRITING:\n1. Run {{testCommand}} \u2014 tests must fail. Report tests_pass=false.\n2. Commit: git -C "{{wt}}" add {{testFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: RED complete"\n3. Report commit_sha.\n\nOnly write and commit test files: {{testFilesList}}\n';

// skills/src/prompts/green.md
var green_default = 'GREEN TDD agent. Make the failing tests pass with minimum implementation code.\n\nSETUP (run first): {{greenCtxCmd}}\nTASK PACKET: {{greenPacketStr}}\n\nAPPROACH:\n1. Read test_signal carefully \u2014 each error tells you exactly what to implement\n2. Read impl_stubs \u2014 fill in function bodies, do not create new files\n3. Check existing_api \u2014 extend it, do not replace it\n4. Implement only what the errors require\n\nAFTER WRITING:\n5. Run {{testCommand}} \u2014 ALL tests must pass. Report tests_pass=true and the exit code.\n6. Commit: git -C "{{wt}}" add {{implFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: GREEN complete"\n7. Report commit_sha.\n\nPACKET FIELDS:\n- test_signal: error messages from failing tests \u2014 your implementation spec\n- contract_summary: function signatures extracted from acceptance criteria\n- impl_stubs: skeleton files \u2014 fill these in\n- existing_api: current module code shape\n\nCONSTRAINTS:\n- Only write and commit implementation files: {{implFilesList}}\n';

// skills/src/prompts/green-retry.md
var green_retry_default = 'GREEN TDD agent \u2014 RETRY. Previous attempt failed: {{failureReason}}.\n\nFirst reset: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/\n\nSETUP: {{greenCtxCmd}}\nTASK PACKET: {{greenRetryPacketStr}}\n\nRead test_signal errors carefully. Read existing implementation files first. Fix specific failures.\n\nAFTER WRITING:\n1. Run {{testCommand}} \u2014 all tests must pass. Report tests_pass=true.\n2. Commit: git -C "{{wt}}" add {{implFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: GREEN complete"\n3. Report commit_sha.\n\nOnly write and commit implementation files: {{implFilesList}}\n';

// skills/src/prompts/refactor.md
var refactor_default = 'REFACTOR agent. Clean up the implementation without changing behavior.\n\nSETUP (run first): {{refactorCtxCmd}}\nTASK PACKET: {{refactorPacketStr}}\n\nSCOPE:\n- Improve naming, reduce duplication, simplify logic, remove dead code\n- Write to allowed files only\n\nAFTER WRITING:\n1. Run {{testCommand}} \u2014 every test must still pass. Report tests_pass=true.\n2. If tests pass: git -C "{{wt}}" add {{allFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: REFACTOR complete"\n3. If tests FAIL: report tests_pass=false, do NOT commit. Report failure_reason.\n\nCONSTRAINTS:\n- Tests are a one-way ratchet: do not remove, skip, weaken, or disable any test\n- Do not add new features \u2014 only improve existing code\n';

// skills/src/prompts/reflect.md
var reflect_default = 'TEST QUALITY evaluator. Read the test files and assess coverage of the acceptance criteria.\nRead-only \u2014 do NOT write or modify any files.\n\nRead these test files in "{{wt}}": {{testFiles}}\n\nACCEPTANCE CRITERIA to cover:\n{{acStr}}\n\nEVALUATE:\n1. For each AC, identify which test function covers it (cite the function name)\n2. Check assertion strength: does each test assert specific values, not just "no error"?\n3. Identify gaps: ACs with no test, tests with weak assertions, missing negative/edge cases\n4. List each gap found\n\nSCORING RUBRIC:\n- 9-10: Every AC has a strong test with specific assertions\n- 7-8: All ACs covered but some assertions could be stronger\n- 5-6: Most ACs covered, 1-2 gaps\n- 3-4: Significant gaps \u2014 multiple ACs untested or only smoke-tested\n- 1-2: Tests exist but barely cover the ACs\n- 0: No meaningful test coverage\n\nReturn reasoning FIRST (with evidence), then gaps, then score.\n';

// skills/src/prompts/skeptic-base.md
var skeptic_base_default = 'Adversarial code reviewer. Find bugs the test suite misses.\n\nWorking directory: "{{wt}}"\nImplementation files: {{implFiles}}\nTest files: {{testFiles}}\nTest command: {{testCommand}}\nAcceptance criteria:\n{{acStr}}\n\nFor each bug found, provide:\n- description: what is wrong\n- evidence: the specific input, file, or line that demonstrates the bug\n- severity: critical / high / medium / low\n\nRead the implementation and tests. Run the test command to understand current coverage.\nOnly report bugs you can demonstrate with evidence. "This might be a problem" is not a bug.\n';

// skills/src/prompts/skeptic-edge.md
var skeptic_edge_default = "LENS: Edge cases.\nTest these inputs against the implementation:\n- Empty inputs, None/null values, single-element collections\n- Boundary values (0, -1, max int, empty string)\n- Off-by-one errors in loops and ranges\nFor each finding: describe the input, what happens, what should happen.\n";

// skills/src/prompts/skeptic-error.md
var skeptic_error_default = "LENS: Error paths.\nCheck these failure modes against the implementation:\n- What happens when preconditions are violated?\n- Are exceptions caught and handled, or do they propagate silently?\n- Are there state transitions that can reach invalid states?\nFor each finding: name the error condition and trace what happens.\n";

// skills/src/prompts/skeptic-contract.md
var skeptic_contract_default = "LENS: Behavioral contracts.\nCompare implementation behavior against the acceptance criteria:\n- Does the implementation satisfy the AC intent, not just the specific test inputs?\n- Are there inputs that satisfy the AC literally but produce wrong results?\n- Do the tests only cover the happy path while the AC implies broader coverage?\nFor each finding: cite the AC, the gap, and a concrete input that exposes it.\n";

// skills/src/prompts/refactor-check.md
var refactor_check_default = 'CODE QUALITY gate. Decide if the implementation needs refactoring \u2014 be conservative.\nRead-only \u2014 do NOT write or modify any files.\n\nRead these files in "{{wt}}": {{allFiles}}\n\nReturn should_refactor=true ONLY if you find one of these concrete problems:\n- Duplicated logic (same code block copy-pasted in 2+ places)\n- Function longer than 50 lines that could be split at a clear seam\n- Dead code introduced by this task (unused imports, unreachable branches)\n- Misleading names that contradict what the code does\n\nMinor style issues (single variable name, one extra blank line) are NOT worth refactoring.\nIf the code works and reads clearly, return should_refactor=false.\n\nIf should_refactor=true, the reason must name the specific file and problem.\n';

// skills/src/shared/prompts.ts
function redPrompt(vars) {
  return renderPrompt(red_default, vars);
}
function redRetryPrompt(vars) {
  return renderPrompt(red_retry_default, vars);
}
function greenPrompt(vars) {
  return renderPrompt(green_default, vars);
}
function greenRetryPrompt(vars) {
  return renderPrompt(green_retry_default, vars);
}
function refactorPrompt(vars) {
  return renderPrompt(refactor_default, vars);
}
function reflectPrompt(vars) {
  return renderPrompt(reflect_default, vars);
}
function skepticBasePrompt(vars) {
  return renderPrompt(skeptic_base_default, vars);
}
function skepticLenses() {
  return [
    { key: "edge", model: "haiku", prompt: skeptic_edge_default },
    { key: "error", model: "haiku", prompt: skeptic_error_default },
    { key: "contract", model: "sonnet", prompt: skeptic_contract_default }
  ];
}
function refactorCheckPrompt(vars) {
  return renderPrompt(refactor_check_default, vars);
}

// skills/src/datum-tdd-act-lane.ts
async function verifyFileOwnership(taskId, wt, stage, allowedFiles, forbiddenFiles) {
  const result = await agent(
    `Run: git -C "${wt}" diff --name-only HEAD~1 HEAD
Return ONLY a JSON object: {"files_changed": ["path1", "path2"]}
No markdown fences, no explanation.`,
    { label: `ownership-check:${taskId}:${stage}`, phase: "Act", model: "haiku" }
  );
  if (!result) return { ok: true, violations: [] };
  const parsed = typeof result === "string" ? parseAgentJson(result, {}) : result;
  const changed = parsed.files_changed || [];
  const violations = [];
  for (const f of changed) {
    if (forbiddenFiles.some((fb) => f.endsWith(fb) || fb.endsWith(f))) {
      violations.push(`${f} is owned by another lane`);
    }
    if (allowedFiles.length > 0 && !allowedFiles.some((a2) => f.endsWith(a2) || a2.endsWith(f))) {
      violations.push(`${f} is not in allowed files list`);
    }
  }
  return { ok: violations.length === 0, violations };
}
async function runLane(taskId, lanePlan2, worktreePaths2, cfg2) {
  const lane = lanePlan2.lanes[taskId];
  const wt = worktreePaths2[taskId];
  const isStructural = lane.stage === "structural";
  const { testFiles, implFiles } = classifyFiles(lane.files);
  const acStr = (lane.acceptance_criteria || []).join("\n");
  const laneTestCmd = testFiles.length > 0 ? `uv run pytest ${testFiles.join(" ")} -x -q` : cfg2.testCommand;
  const laneCfg = { ...cfg2, testCommand: laneTestCmd };
  log(`[${taskId}] Starting: ${lane.title} (${isStructural ? "structural" : "behavioral"}, ${testFiles.length} test, ${implFiles.length} impl)`);
  if (isStructural) {
    const r = await runRefactor(taskId, lane, testFiles, implFiles, wt, laneCfg);
    if (!r) return { task_id: taskId, status: "failed", stage: "REFACTOR", error: "refactor failed" };
    return { task_id: taskId, status: "completed" };
  }
  log(`[${taskId}] RED: writing failing tests`);
  const redPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, "RED", {});
  const redCtxCmd = laneCtxCmd(redPacket, wt);
  const skeletonCmd = `datum skeleton --task-id ${taskId} --language ${cfg2.language} --tasks ${cfg2.lanePlanPath} --output .datum/runs/${cfg2.runId}/preflight-${taskId}.json`;
  const promptVars = {
    wt,
    skeletonCmd,
    redCtxCmd,
    redPacketStr: JSON.stringify(redPacket),
    testCommand: laneTestCmd,
    testFilesList: testFiles.join(" "),
    commitPrefix: redPacket.commit_prefix
  };
  let red = await agent(
    redPrompt(promptVars),
    { label: `red:${taskId}`, phase: "Act", model: "sonnet", schema: STAGE_RESULT_SCHEMA }
  );
  if (red?.success) {
    log(`[${taskId}] RED wrote: ${(red.files_written || []).join(", ")}`);
  }
  if (!red || !red.success) {
    log(`[${taskId}] RED attempt 1 failed: ${red?.failure_reason || "unknown"}, retrying`);
    red = await agent(
      redRetryPrompt({ ...promptVars, failureReason: red?.failure_reason || "unknown" }),
      { label: `red-retry:${taskId}`, phase: "Act", model: "sonnet", schema: STAGE_RESULT_SCHEMA }
    );
  }
  if (!red || !red.success) {
    log(`[${taskId}] RED FAILED: ${red?.failure_reason || "no files written after 2 attempts"}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: red?.failure_reason || "RED failed" };
  }
  const assertionCheck = await agent(
    `Scan the test files in "${wt}" for placeholder assertions that would never fail.
Read these files: ${testFiles.join(", ")}

Search for these patterns in NEW test functions (ignore pre-existing tests):
- \`assert True\` or \`assert 1\`
- \`pass\` as the only statement in a test function body
- Empty test functions (just \`def test_...(...):\` with no body or only docstring)
- \`assert x is not None\` as the ONLY assertion (smoke test, not a real check)
- \`raise NotImplementedError\` in test bodies

Return JSON: {"has_placeholders": true/false, "detail": "which functions and what pattern"}
Output raw JSON only. No markdown fences.`,
    { label: `assert-check:${taskId}`, phase: "Act", model: "haiku" }
  );
  let placeholderWarning = "";
  if (assertionCheck) {
    const parsed = typeof assertionCheck === "string" ? parseAgentJson(assertionCheck, {}) : assertionCheck;
    if (parsed.has_placeholders) {
      placeholderWarning = parsed.detail || "placeholder assertions detected";
      log(`[${taskId}] RED: placeholder assertions found \u2014 ${placeholderWarning}`);
      return { task_id: taskId, status: "failed", stage: "RED", error: `placeholder_assertions: ${placeholderWarning}` };
    }
  }
  if (red.tests_pass) {
    const diag = red.test_output || red.test_errors?.join("; ") || "no test output captured";
    log(`[${taskId}] RED VERIFY FAILED: tests passed (green blindness). Output: ${diag}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: `green_blindness_violation: tests passed after RED. Test output: ${diag}` };
  }
  log(`[${taskId}] RED verified \u2014 tests fail as expected (committed: ${red.commit_sha || "n/a"})`);
  if (!red.committed) {
    log(`[${taskId}] RED: agent did not commit \u2014 failing`);
    return { task_id: taskId, status: "failed", stage: "RED", error: "RED agent did not commit" };
  }
  const redOwnership = await verifyFileOwnership(taskId, wt, "RED", testFiles, implFiles);
  if (!redOwnership.ok) {
    log(`[${taskId}] RED FILE OWNERSHIP VIOLATION: ${redOwnership.violations.join(", ")}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: `file_ownership_violation: ${redOwnership.violations.join(", ")}` };
  }
  const reflectResult = await agent(
    reflectPrompt({ wt, testFiles: testFiles.join(", "), acStr }),
    { label: `reflect:${taskId}`, phase: "Act", model: "haiku", schema: REFLECT_SCHEMA }
  );
  const reflectScore = reflectResult?.score || 0;
  log(`[${taskId}] Test quality: ${reflectScore}/10 \u2014 ${reflectResult?.reasoning || "no reasoning"}`);
  if (reflectResult?.gaps?.length) {
    log(`[${taskId}]   gaps: ${reflectResult.gaps.join("; ")}`);
  }
  if (reflectScore < 4) {
    log(`[${taskId}] RED FAILED: test quality too low (${reflectScore}/10)`);
    return { task_id: taskId, status: "failed", stage: "RED", error: `test quality ${reflectScore}/10` };
  }
  const greenModel = lane.green_model || "sonnet";
  const contractSummary = extractContractSummary(lane.acceptance_criteria || []);
  log(`[${taskId}] GREEN: making tests pass (model: ${greenModel})`);
  const greenPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, "GREEN", {
    test_signal: { exit_code: red.test_exit_code || 1, errors: red.test_errors || [] },
    contract_summary: contractSummary
  });
  const greenCtxCmd = laneCtxCmd(greenPacket, wt);
  const greenVars = {
    wt,
    greenCtxCmd,
    greenPacketStr: JSON.stringify(greenPacket),
    testCommand: laneTestCmd,
    implFilesList: implFiles.join(" "),
    commitPrefix: greenPacket.commit_prefix
  };
  let green = await agent(
    greenPrompt(greenVars),
    { label: `green:${taskId}`, phase: "Act", model: greenModel, schema: STAGE_RESULT_SCHEMA }
  );
  if (green?.success) {
    log(`[${taskId}] GREEN wrote: ${(green.files_written || []).join(", ")}`);
  }
  if (!green || !green.success || !green.tests_pass) {
    log(`[${taskId}] GREEN attempt 1 failed (${greenModel}): ${green?.failure_reason || "unknown"}, escalating to opus`);
    green = await agent(
      greenRetryPrompt({
        ...greenVars,
        failureReason: green?.failure_reason || "unknown",
        greenRetryPacketStr: JSON.stringify({ ...greenPacket, retry_hint: green?.failure_reason })
      }),
      { label: `green-retry:${taskId}`, phase: "Act", model: "opus", schema: STAGE_RESULT_SCHEMA }
    );
  }
  if (!green || !green.success || !green.tests_pass) {
    log(`[${taskId}] GREEN FAILED: ${green?.failure_reason || "tests still failing after 2 attempts"}`);
    return { task_id: taskId, status: "failed", stage: "GREEN", error: green?.failure_reason || "GREEN failed" };
  }
  if (!green.committed) {
    log(`[${taskId}] GREEN: agent did not commit \u2014 failing`);
    return { task_id: taskId, status: "failed", stage: "GREEN", error: "GREEN agent did not commit" };
  }
  const greenOwnership = await verifyFileOwnership(taskId, wt, "GREEN", implFiles, testFiles);
  if (!greenOwnership.ok) {
    log(`[${taskId}] GREEN FILE OWNERSHIP VIOLATION: ${greenOwnership.violations.join(", ")}`);
    return { task_id: taskId, status: "failed", stage: "GREEN", error: `file_ownership_violation: ${greenOwnership.violations.join(", ")}` };
  }
  log(`[${taskId}] GREEN verified \u2014 all tests pass (committed: ${green.commit_sha || "n/a"})`);
  const base = skepticBasePrompt({
    wt,
    implFiles: implFiles.join(", "),
    testFiles: testFiles.join(", "),
    testCommand: laneTestCmd,
    acStr
  });
  const lenses = skepticLenses();
  const skepticResults = await parallel(
    lenses.map(
      (lens) => () => agent(base + lens.prompt, { label: `skeptic-${lens.key}:${taskId}`, phase: "Act", model: lens.model, schema: SKEPTIC_SCHEMA })
    )
  );
  const { allBugs, brokenCount, crossValidated } = crossValidateBugs(skepticResults, lenses);
  for (let i = 0; i < lenses.length; i++) {
    const s = skepticResults[i];
    if (!s) {
      log(`[${taskId}] SKEPTIC ${lenses[i].key}: (null)`);
      continue;
    }
    log(`[${taskId}] SKEPTIC ${lenses[i].key}: ${s.verdict} (${(s.bugs_found || []).length} bugs)`);
    for (const bug of s.bugs_found || []) {
      log(`[${taskId}]   - [${bug.severity}] ${bug.description}`);
    }
  }
  if (brokenCount >= 2) {
    log(`[${taskId}] SKEPTIC VERDICT: ${brokenCount}/3 BROKEN`);
  } else {
    log(`[${taskId}] SKEPTIC VERDICT: PASS (${crossValidated.length} cross-validated)`);
  }
  const refResult = await runRefactor(taskId, lane, testFiles, implFiles, wt, laneCfg);
  if (!refResult) {
    return { task_id: taskId, status: "failed", stage: "REFACTOR", error: "refactor failed" };
  }
  log(`[${taskId}] === LANE COMPLETE ===`);
  return { task_id: taskId, status: "completed" };
}
async function runRefactor(taskId, lane, testFiles, implFiles, wt, cfg2) {
  log(`[${taskId}] REFACTOR: checking if needed`);
  const preCheck = await agent(
    refactorCheckPrompt({ wt, allFiles: [...implFiles, ...testFiles].join(", ") }),
    { label: `refactor-check:${taskId}`, phase: "Act", model: "haiku", schema: REFACTOR_CHECK_SCHEMA }
  );
  if (!preCheck?.should_refactor) {
    log(`[${taskId}] REFACTOR: skipped (${preCheck?.reason || "nothing to improve"})`);
    return { verified: true };
  }
  log(`[${taskId}] REFACTOR: proceeding (${preCheck.reason})`);
  const refactorPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, cfg2, "REFACTOR", {});
  const refactorCtxCmd = laneCtxCmd(refactorPacket, wt);
  const refactor = await agent(
    refactorPrompt({
      wt,
      refactorCtxCmd,
      refactorPacketStr: JSON.stringify(refactorPacket),
      testCommand: cfg2.testCommand,
      allFilesList: [...testFiles, ...implFiles].join(" "),
      commitPrefix: refactorPacket.commit_prefix
    }),
    { label: `refactor:${taskId}`, phase: "Act", model: "sonnet", schema: STAGE_RESULT_SCHEMA }
  );
  if (!refactor?.success) {
    if (refactor?.failure_reason?.toLowerCase().includes("nothing to")) {
      log(`[${taskId}] REFACTOR: nothing to change`);
      return { verified: true };
    }
    log(`[${taskId}] REFACTOR FAILED: ${refactor?.failure_reason || "null"}`);
    return null;
  }
  if (!refactor.tests_pass) {
    log(`[${taskId}] REFACTOR broke tests \u2014 agent should not have committed`);
    if (refactor.committed) {
      await agent(
        `git -C "${wt}" revert --no-edit HEAD`,
        { label: `revert-refactor:${taskId}`, phase: "Act", model: "haiku" }
      );
    }
    return { verified: true };
  }
  log(`[${taskId}] REFACTOR: clean (committed: ${refactor.commit_sha || "n/a"})`);
  return { verified: true };
}
var a = args;
phase("Act");
var { batchLaneIds, lanePlan, worktreePaths, cfg, priorFailures, batchTag } = a;
var lanes = lanePlan.lanes;
var depResolvers = {};
var depPromises = {};
for (const id of batchLaneIds) {
  depPromises[id] = new Promise((resolve) => {
    depResolvers[id] = resolve;
  });
}
log(`DAG scheduler${batchTag}: ${batchLaneIds.length} tasks`);
var dagResults = await parallel(
  batchLaneIds.map((taskId) => async () => {
    const allDeps = lanes[taskId].depends_on || [];
    const crossBatchFailed = allDeps.filter((d) => !batchLaneIds.includes(d) && priorFailures.includes(d));
    if (crossBatchFailed.length > 0) {
      const err = `skipped: cross-batch dep(s) failed [${crossBatchFailed.join(", ")}]`;
      log(`[${taskId}] ${err}`);
      const skipResult = { task_id: taskId, status: "failed", stage: "SKIPPED", error: err };
      depResolvers[taskId](skipResult);
      return skipResult;
    }
    const inBatchDeps = allDeps.filter((d) => batchLaneIds.includes(d));
    if (inBatchDeps.length > 0) {
      log(`[${taskId}] waiting on deps: [${inBatchDeps.join(", ")}]`);
      const depResults = await Promise.all(inBatchDeps.map((d) => depPromises[d]));
      const failedDeps = depResults.filter((r) => r.status !== "completed");
      if (failedDeps.length > 0) {
        const err = `skipped: dep(s) failed [${failedDeps.map((r) => r.task_id).join(", ")}]`;
        log(`[${taskId}] ${err}`);
        const skipResult = { task_id: taskId, status: "failed", stage: "SKIPPED", error: err };
        depResolvers[taskId](skipResult);
        return skipResult;
      }
    }
    log(`[${taskId}] deps satisfied \u2014 launching`);
    let result;
    try {
      const r = await runLane(taskId, lanePlan, worktreePaths, cfg);
      result = r || { task_id: taskId, status: "failed", stage: "UNKNOWN", error: "null result" };
    } catch (e) {
      result = { task_id: taskId, status: "failed", stage: "CRASH", error: String(e) };
    }
    depResolvers[taskId](result);
    return result;
  })
);
var results = {};
for (let i = 0; i < batchLaneIds.length; i++) {
  results[batchLaneIds[i]] = dagResults[i];
}
return { results };
