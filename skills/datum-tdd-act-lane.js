// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-lane.ts
export const meta = {
  name: "datum-tdd-act-lane",
  description: "DAG-scheduled TDD execution: RED->verify->GREEN->verify->REFACTOR per lane",
  phases: [{ title: "Act" }]
};

// skills/src/shared/schemas.ts
var WRITE_RESULT_SCHEMA = {
  type: "object",
  properties: {
    files_written: { type: "array", items: { type: "string" } },
    success: { type: "boolean" },
    failure_reason: { type: "string" }
  },
  required: ["success"]
};
var COMMIT_RESULT_SCHEMA = {
  type: "object",
  properties: {
    committed: { type: "boolean" },
    commit_sha: { type: "string" },
    files_staged: { type: "array", items: { type: "string" } },
    violations: { type: "array", items: { type: "string" } },
    failure_reason: { type: "string" }
  },
  required: ["committed"]
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

// skills/src/shared/agents.ts
async function commitStage(taskId, wt, commitPrefix, allowedFiles, stage) {
  const allowedList = allowedFiles.join(", ");
  const basePrompt = `You are a GIT COMMIT agent. You ONLY handle git operations \u2014 never edit source files.

TASK:
1. Run: git -C "${wt}" status --porcelain
2. Verify ONLY these files were modified: ${allowedList}
3. If files outside that list were changed, report them as violations and do NOT commit
4. Stage the allowed files: git -C "${wt}" add <files>
5. Commit: git -C "${wt}" commit -m "${commitPrefix}: ${stage} complete"
6. Return the commit SHA from: git -C "${wt}" rev-parse --short HEAD

CONSTRAINTS:
- NEVER edit, create, or delete source files \u2014 only git operations
- If there are no changes to commit, return committed=false
- Use git -C "${wt}" for ALL git commands to enforce directory`;
  let result = await agent(basePrompt, {
    label: `git-${stage.toLowerCase()}:${taskId}`,
    phase: "Act",
    model: "haiku",
    schema: COMMIT_RESULT_SCHEMA
  });
  if (result && result.violations && result.violations.length > 0) {
    log(`[${taskId}] GIT ${stage}: file ownership violations: ${result.violations.join(", ")}`);
  }
  if (!result || !result.committed && result.failure_reason) {
    log(`[${taskId}] GIT ${stage}: haiku failed (${result && result.failure_reason || "null"}), escalating to sonnet`);
    result = await agent(
      basePrompt + `

RETRY CONTEXT: Previous commit attempt failed: ${result && result.failure_reason || "null result"}.
Diagnose the git state: run git -C "${wt}" status, git -C "${wt}" diff --stat, git -C "${wt}" log --oneline -3.
Fix any issues (merge conflicts, dirty index, detached HEAD) then commit.
If the worktree is in a broken state, report failure_reason with details.`,
      {
        label: `git-${stage.toLowerCase()}-fix:${taskId}`,
        phase: "Act",
        model: "sonnet",
        schema: COMMIT_RESULT_SCHEMA
      }
    );
  }
  if (result && result.committed) {
    log(`[${taskId}] GIT ${stage} committed: ${result.commit_sha || "(no sha)"}`);
    log(`[${taskId}]   staged: ${(result.files_staged || []).join(", ") || "(none reported)"}`);
  } else {
    log(`[${taskId}] GIT ${stage} FAILED: ${result && result.failure_reason || "no commit after escalation"}`);
  }
  return result;
}
async function resetWorktree(taskId, wt, stage) {
  await agent(
    `You are a GIT RESET agent. Reset the worktree to the last commit.
Run: git -C "${wt}" checkout -- . && git -C "${wt}" clean -fd --exclude=.datum/
Do NOT edit, create, or delete source files \u2014 only git operations.`,
    { label: `reset-${stage.toLowerCase()}:${taskId}`, phase: "Act", model: "haiku" }
  );
  log(`[${taskId}] GIT RESET ${stage}: worktree cleaned`);
}
async function revertLastCommit(taskId, wt, stage) {
  await agent(
    `You are a GIT REVERT agent. Revert the most recent commit.
Run: git -C "${wt}" revert --no-edit HEAD
Do NOT edit, create, or delete source files \u2014 only git operations.`,
    { label: `revert-${stage.toLowerCase()}:${taskId}`, phase: "Act", model: "haiku" }
  );
  log(`[${taskId}] GIT REVERT ${stage}: last commit reverted`);
}
async function verifyStage(taskId, wt, stage, testCommand) {
  const checkText = await agent(
    `Run: datum verify-stage ${stage} --repo "${wt}" --test-command "${testCommand}"
Return ONLY the JSON output, nothing else.`,
    { label: `verify-${stage}:${taskId}`, phase: "Act", model: "haiku" }
  );
  return parseAgentJson(checkText, { verified: false });
}
async function runSkeleton(taskId, wt, cfg2) {
  const text = await agent(
    `Run: datum skeleton --task-id ${taskId} --language ${cfg2.language} --tasks ${cfg2.lanePlanPath} --output .datum/runs/${cfg2.runId}/preflight-${taskId}.json 2>&1
Return ONLY the JSON output, nothing else.`,
    { label: `skeleton:${taskId}`, phase: "Act", model: "haiku" }
  );
  return parseAgentJson(text, {});
}

// skills/src/prompts/red.md
var red_default = "RED TDD agent. Write failing tests that prove the acceptance criteria are not yet implemented.\n\nSETUP (run first): {{redCtxCmd}}\nTASK PACKET: {{redPacketStr}}\n\nGOAL: Write one test function per acceptance criterion. Each test must FAIL when you run it.\n\nAPPROACH:\n1. Read the acceptance_criteria from the task packet\n2. For each AC, write a test that calls the method described in the AC\n3. Assert specific expected values \u2014 not just \"doesn't crash\"\n4. Call methods that don't exist yet (e.g., result.to_dict()) \u2014 AttributeError is the correct RED failure\n5. Run test_command and confirm every new test FAILS with AttributeError or AssertionError\n\nCONSTRAINTS:\n- cd into working_directory before any operation\n- Append new test functions to existing test files \u2014 keep all existing tests intact\n- NEVER use `raise NotImplementedError` in tests \u2014 conftest xfail catches it and tests pass (green blindness)\n- Git operations are handled by a separate agent \u2014 do not run git add, git commit, or any git command\n";

// skills/src/prompts/red-retry.md
var red_retry_default = "RED TDD agent \u2014 RETRY. Previous attempt failed: {{failureReason}}.\n\nSETUP (run first): {{redCtxCmd}}\nTASK PACKET: {{redPacketStr}}\n\nWrite simple, concrete tests. One test per acceptance criterion. Assert specific values.\nCall methods that don't exist yet \u2014 AttributeError is your RED signal.\nNEVER use `raise NotImplementedError` \u2014 conftest will xfail it.\nDo not run any git commands.\n";

// skills/src/prompts/green.md
var green_default = "GREEN TDD agent. Make the failing tests pass with minimum implementation code.\n\nSETUP (run first): {{greenCtxCmd}}\nTASK PACKET: {{greenPacketStr}}\n\nAPPROACH:\n1. Read test_signal carefully \u2014 each error tells you exactly what to implement\n2. Read impl_stubs \u2014 these files already have function signatures with `...` bodies. Fill them in.\n3. Check existing_api \u2014 understand the module shape before adding to it\n4. Implement only what the errors require \u2014 if a test expects foo() to return 42, make foo() return 42\n5. Run test_command to verify all tests pass\n\nPACKET FIELDS:\n- test_signal: error messages from failing tests \u2014 your implementation spec\n- contract_summary: function signatures extracted from acceptance criteria\n- impl_stubs: skeleton files with function signatures \u2014 fill these in, do not create new files\n- existing_api: current module code shape \u2014 extend it, do not replace it\n- red_note: what behaviors the tests check for\n\nCONSTRAINTS:\n- Write to allowed_write_files only\n- Fill in existing stubs rather than creating new files from scratch\n- Git operations are handled by a separate agent \u2014 do not run any git command\n";

// skills/src/prompts/green-retry.md
var green_retry_default = "GREEN TDD agent \u2014 RETRY. Previous attempt failed: {{failureReason}}.\n\nSETUP (run first): {{greenCtxCmd}}\nTASK PACKET: {{greenRetryPacketStr}}\n\nRead the test_signal errors carefully \u2014 they tell you exactly what is still wrong.\nRead existing implementation files first. Fix the specific failures. Do not start from scratch.\n\nPACKET FIELDS:\n- test_signal: current errors to fix \u2014 read every line\n- impl_stubs / existing_api: fill in bodies, extend existing code\n- contract_summary: function signatures to implement\n\nDo not run any git commands.\n";

// skills/src/prompts/refactor.md
var refactor_default = "REFACTOR agent. Clean up the implementation without changing behavior. All existing tests must still pass.\n\nSETUP (run first): {{refactorCtxCmd}}\nTASK PACKET: {{refactorPacketStr}}\n\nSCOPE:\n- Improve naming, reduce duplication, simplify logic, remove dead code from this task\n- Write to allowed_write_files only \u2014 do not touch files outside your lane\n- Run test_command after changes \u2014 every existing test must still pass\n\nCONSTRAINTS:\n- Tests are a one-way ratchet: do not remove, skip, weaken, or disable any test\n- Do not add new features or tests \u2014 only improve existing implementation code\n- Git operations are handled by a separate agent \u2014 do not run any git command\n";

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
async function runLane(taskId, lanePlan2, worktreePaths2, cfg2) {
  const lane = lanePlan2.lanes[taskId];
  const wt = worktreePaths2[taskId];
  const isStructural = lane.stage === "structural";
  const { testFiles, implFiles } = classifyFiles(lane.files);
  const acStr = (lane.acceptance_criteria || []).join("\n");
  const laneTestCmd = testFiles.length > 0 ? `uv run pytest ${testFiles.join(" ")} -x -q` : cfg2.testCommand;
  const laneCfg = { ...cfg2, testCommand: laneTestCmd };
  log(`[${taskId}] Starting: ${lane.title} (${isStructural ? "structural" : "behavioral"}, ${testFiles.length} test files, ${implFiles.length} impl files)`);
  log(`[${taskId}]   tests: ${testFiles.join(", ") || "(none)"}`);
  log(`[${taskId}]   impl:  ${implFiles.join(", ") || "(none)"}`);
  log(`[${taskId}]   test cmd: ${laneTestCmd}`);
  if (isStructural) {
    const r = await runRefactor(taskId, lane, testFiles, implFiles, wt, laneCfg);
    if (!r) return { task_id: taskId, status: "failed", stage: "REFACTOR", error: "refactor failed" };
    log(`[${taskId}] STRUCTURAL lane complete`);
    return { task_id: taskId, status: "completed" };
  }
  const preflight = await runSkeleton(taskId, wt, cfg2);
  await commitStage(taskId, wt, `skeleton(${taskId})`, [...testFiles, ...implFiles], "SKELETON");
  log(`[${taskId}] RED: writing failing tests`);
  const redPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, "RED", {});
  const redPacketStr = JSON.stringify(redPacket);
  const redCtxCmd = laneCtxCmd(redPacket, wt);
  let red = await agent(
    redPrompt({ redCtxCmd, redPacketStr }),
    { label: `red:${taskId}`, phase: "Act", model: "sonnet", schema: WRITE_RESULT_SCHEMA }
  );
  if (red && red.success) {
    log(`[${taskId}] RED wrote: ${(red.files_written || []).join(", ") || "(none reported)"}`);
  }
  if (!red || !red.success) {
    log(`[${taskId}] RED attempt 1 failed: ${red && red.failure_reason || "no files written"}, retrying with hint`);
    await resetWorktree(taskId, wt, "RED");
    red = await agent(
      redRetryPrompt({
        failureReason: red && red.failure_reason || "unknown",
        redCtxCmd,
        redPacketStr
      }),
      { label: `red-retry:${taskId}`, phase: "Act", model: "sonnet", schema: WRITE_RESULT_SCHEMA }
    );
  }
  if (!red || !red.success) {
    const err = red && red.failure_reason || "RED agent did not write files after 2 attempts";
    log(`[${taskId}] RED FAILED after 2 attempts: ${err}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: err };
  }
  const redCommit = await commitStage(taskId, wt, redPacket.commit_prefix, testFiles, "RED");
  if (!redCommit || !redCommit.committed) {
    return { task_id: taskId, status: "failed", stage: "RED", error: `git commit failed: ${redCommit && redCommit.failure_reason || "unknown"}` };
  }
  const [redCheck, reflect] = await parallel([
    () => verifyStage(taskId, wt, "red", laneCfg.testCommand),
    () => agent(
      reflectPrompt({ wt, testFiles: testFiles.join(", "), acStr }),
      { label: `reflect:${taskId}`, phase: "Act", model: "haiku", schema: REFLECT_SCHEMA }
    )
  ]);
  const redVerify = redCheck;
  const reflectResult = reflect;
  if (!redVerify || !redVerify.verified) {
    const err = redVerify && redVerify.error || "green_blindness_violation: tests passed after RED";
    log(`[${taskId}] RED VERIFY FAILED: ${err}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: err };
  }
  log(`[${taskId}] RED verified \u2014 tests fail as expected`);
  const reflectScore = reflectResult && reflectResult.score || 0;
  log(`[${taskId}] Test quality: ${reflectScore}/10 \u2014 ${reflectResult && reflectResult.reasoning || "no reasoning"}`);
  if (reflectResult && reflectResult.gaps && reflectResult.gaps.length > 0) {
    log(`[${taskId}]   gaps: ${reflectResult.gaps.join("; ")}`);
  }
  if (reflectScore < 4) {
    log(`[${taskId}] RED FAILED: test quality too low (${reflectScore}/10)`);
    return { task_id: taskId, status: "failed", stage: "RED", error: `test quality ${reflectScore}/10` };
  }
  const signal = redVerify && redVerify.test_signal || { exit_code: 1, errors: [], assertion_messages: [] };
  const contractSummary = extractContractSummary(lane.acceptance_criteria || []);
  const greenModel = lane.green_model || "sonnet";
  log(`[${taskId}] GREEN: making tests pass (model: ${greenModel}, contracts: ${contractSummary.length})`);
  const greenPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, "GREEN", {
    test_signal: signal,
    preflight,
    contract_summary: contractSummary,
    impl_stubs: preflight.impl_stubs || [],
    existing_api: preflight.existing_api || {}
  });
  const greenCtxCmd = laneCtxCmd(greenPacket, wt);
  let green = await agent(
    greenPrompt({ greenCtxCmd, greenPacketStr: JSON.stringify(greenPacket) }),
    { label: `green:${taskId}`, phase: "Act", model: greenModel, schema: WRITE_RESULT_SCHEMA }
  );
  if (green && green.success) {
    log(`[${taskId}] GREEN wrote: ${(green.files_written || []).join(", ") || "(none reported)"}`);
  }
  if (!green || !green.success) {
    const escalatedModel = "opus";
    log(`[${taskId}] GREEN attempt 1 failed (${greenModel}): ${green && green.failure_reason || "no files written"}, escalating to ${escalatedModel}`);
    await resetWorktree(taskId, wt, "GREEN");
    const retryCheck = await verifyStage(taskId, wt, "red", laneCfg.testCommand);
    const retrySignal = retryCheck && retryCheck.test_signal || signal;
    const retryPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, "GREEN", {
      test_signal: retrySignal,
      preflight,
      contract_summary: contractSummary,
      impl_stubs: preflight.impl_stubs || [],
      existing_api: preflight.existing_api || {},
      retry_hint: `Previous attempt failed: ${green && green.failure_reason || "unknown"}. Read the FULL error output carefully. Fix the implementation.`
    });
    green = await agent(
      greenRetryPrompt({
        failureReason: green && green.failure_reason || "unknown",
        greenCtxCmd,
        greenRetryPacketStr: JSON.stringify(retryPacket)
      }),
      { label: `green-retry:${taskId}`, phase: "Act", model: escalatedModel, schema: WRITE_RESULT_SCHEMA }
    );
  }
  if (!green || !green.success) {
    const err = green && green.failure_reason || "GREEN agent did not write files after 2 attempts";
    log(`[${taskId}] GREEN FAILED after 2 attempts: ${err}`);
    return { task_id: taskId, status: "failed", stage: "GREEN", error: err };
  }
  const greenCommit = await commitStage(taskId, wt, greenPacket.commit_prefix, implFiles, "GREEN");
  if (!greenCommit || !greenCommit.committed) {
    return { task_id: taskId, status: "failed", stage: "GREEN", error: `git commit failed: ${greenCommit && greenCommit.failure_reason || "unknown"}` };
  }
  const greenCheck = await verifyStage(taskId, wt, "green", laneCfg.testCommand);
  if (!greenCheck || !greenCheck.verified) {
    const err = greenCheck && greenCheck.error || "tests still failing after GREEN";
    log(`[${taskId}] GREEN VERIFY FAILED: ${err}`);
    return { task_id: taskId, status: "failed", stage: "GREEN", error: err };
  }
  log(`[${taskId}] GREEN verified \u2014 all tests pass`);
  const base = skepticBasePrompt({
    wt,
    implFiles: implFiles.join(", "),
    testFiles: testFiles.join(", "),
    testCommand: laneCfg.testCommand,
    acStr
  });
  const lenses = skepticLenses();
  const skepticResults = await parallel(
    lenses.map(
      (lens) => () => agent(
        base + lens.prompt,
        { label: `skeptic-${lens.key}:${taskId}`, phase: "Act", model: lens.model, schema: SKEPTIC_SCHEMA }
      )
    )
  );
  const { allBugs, brokenCount, crossValidated } = crossValidateBugs(skepticResults, lenses);
  for (let i = 0; i < lenses.length; i++) {
    const s = skepticResults[i];
    if (!s) {
      log(`[${taskId}] SKEPTIC ${lenses[i].key}: (null \u2014 agent failed)`);
      continue;
    }
    const bugCount = (s.bugs_found || []).length;
    log(`[${taskId}] SKEPTIC ${lenses[i].key}: ${s.verdict} (${bugCount} bugs, confidence: ${s.confidence || "N/A"})`);
    for (const bug of s.bugs_found || []) {
      log(`[${taskId}]   - [${bug.severity || "?"}] ${bug.description}`);
    }
  }
  if (brokenCount >= 2) {
    const bugList = crossValidated.map((b) => `[${b.lens}] ${b.description}`).join("; ");
    log(`[${taskId}] SKEPTIC VERDICT: ${brokenCount}/3 BROKEN \u2014 ${crossValidated.length} cross-validated: ${bugList || "none"}`);
  } else if (brokenCount === 1) {
    log(`[${taskId}] SKEPTIC VERDICT: 1/3 BROKEN (no consensus) \u2014 proceeding`);
  } else {
    log(`[${taskId}] SKEPTIC VERDICT: PASS (${allBugs.length} total findings, ${crossValidated.length} cross-validated)`);
  }
  const allAllowed = /* @__PURE__ */ new Set([...testFiles, ...implFiles]);
  const writtenFiles = [...red.files_written || [], ...green.files_written || []];
  const violations = writtenFiles.filter((f) => !allAllowed.has(f));
  if (violations.length > 0) {
    log(`[${taskId}] FILE OWNERSHIP VIOLATION: ${violations.join(", ")}`);
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
  if (!preCheck || !preCheck.should_refactor) {
    log(`[${taskId}] REFACTOR: skipped (${preCheck && preCheck.reason || "nothing to improve"})`);
    return { verified: true };
  }
  log(`[${taskId}] REFACTOR: proceeding (${preCheck.reason})`);
  const refactorPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, cfg2, "REFACTOR", {});
  const refactorCtxCmd = laneCtxCmd(refactorPacket, wt);
  const refactor = await agent(
    refactorPrompt({ refactorCtxCmd, refactorPacketStr: JSON.stringify(refactorPacket) }),
    { label: `refactor:${taskId}`, phase: "Act", model: "sonnet", schema: WRITE_RESULT_SCHEMA }
  );
  if (!refactor) {
    log(`[${taskId}] REFACTOR FAILED: agent returned null`);
    return null;
  }
  if (!refactor.success && refactor.failure_reason && !refactor.failure_reason.toLowerCase().includes("nothing to")) {
    log(`[${taskId}] REFACTOR FAILED: ${refactor.failure_reason}`);
    return null;
  }
  if (!refactor.success) {
    log(`[${taskId}] REFACTOR: nothing to change`);
    return { verified: true };
  }
  log(`[${taskId}] REFACTOR wrote: ${(refactor.files_written || []).join(", ") || "(none reported)"}`);
  const refCommit = await commitStage(taskId, wt, refactorPacket.commit_prefix, [...testFiles, ...implFiles], "REFACTOR");
  if (!refCommit || !refCommit.committed) {
    log(`[${taskId}] REFACTOR commit failed \u2014 reverting`);
    await resetWorktree(taskId, wt, "REFACTOR");
    return { verified: true };
  }
  const check = await verifyStage(taskId, wt, "green", cfg2.testCommand);
  if (!check || !check.verified) {
    log(`[${taskId}] REFACTOR verification FAILED: ${check && check.error || "tests broke"} \u2014 reverting`);
    await revertLastCommit(taskId, wt, "REFACTOR");
    return { verified: true };
  }
  return check;
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
log(`DAG scheduler${batchTag}: ${batchLaneIds.length} tasks, starting as deps resolve`);
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
