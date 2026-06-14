// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-lane.ts
export const meta = {
  name: "datum-tdd-act-lane",
  description: "DAG-scheduled TDD execution: RED->GREEN->REFACTOR per lane",
  phases: [{ title: "Act" }]
};

// skills/src/shared/models.ts
var TIER_MAP = {
  fast: "haiku",
  balanced: "sonnet",
  deep: "opus"
};
function model(tier) {
  return TIER_MAP[tier];
}

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
    ...cfg2.test_framework ? { test_framework: cfg2.test_framework } : {},
    ...extras
  };
}
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
}

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = '# datum\n\n> Agentic software delivery pipeline. Python 3.12+, uv, ruff, pytest.\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500-line file cap \u2014 split via functional seams\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don\'t mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just "no error"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Use `uv run pytest` \u2014 never bare `pytest`\n- Test naming: `test_<function>_<scenario>`\n\n## File Conventions\n- Python: snake_case, type hints, ruff-formatted\n- Imports: absolute from package root\n- No `eval()`, `os.system()`, `shell=True`\n- No bare `python` \u2014 always `uv run python`\n\n## Full Context\n- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and patterns\n';

// skills/src/prompts/red.md
var red_default = 'RED TDD agent. Write failing tests that prove the acceptance criteria are not yet implemented.\n\nSETUP:\n1. cd into {{wt}}\n2. Run: {{skeletonCmd}}\n3. Run: {{redCtxCmd}}\n\nTARGET CONTEXT (import guard):\nIf the preflight output at .datum/runs/*/preflight-{{taskId}}.json contains a target_context\nfield, read it. It lists which modules each target depends on. Only import modules listed as\ndependencies of the target your test file belongs to. DO NOT import modules from other targets.\n\nTASK PACKET: {{redPacketStr}}\n\nFRAMEWORK DETECTION:\nBefore writing any test code, read ONE existing test file from the same directory as your target test files. Match its:\n- Import style (e.g. import XCTest vs import Testing, import pytest vs import unittest)\n- Test class/struct pattern (XCTestCase subclass vs @Test macro, etc.)\n- Assertion style (XCTAssertEqual vs #expect, assert vs self.assertEqual)\nIf no existing test files exist, fall back to the test_framework field in the task packet.\n\nGOAL: Write one test function per acceptance criterion. Each test must FAIL when you run it.\n\nAPPROACH:\n1. Read the acceptance_criteria from the task packet\n2. For each AC, write a test that calls the method described in the AC\n3. Assert specific expected values \u2014 not just "doesn\'t crash"\n4. Call methods that don\'t exist yet (e.g., result.to_dict()) \u2014 AttributeError is the correct RED failure\n\nVERIFY BEFORE RUNNING TESTS:\n4b. Grep your test file(s) for new test functions: grep -c \'def test_\' {{testFilesList}}\n    Confirm you have at least one new test function per AC. If any AC lacks a test, go back and write it before proceeding.\n\nSELF-CHECK (mandatory before running tests):\n- Count how many `def test_` functions exist in each test file BEFORE your edits\n- Count how many `def test_` functions exist AFTER your edits\n- The count MUST increase by at least len(acceptance_criteria) new functions\n- If count did not increase, you FAILED \u2014 do not proceed, report success=false with failure_reason="no_new_tests_written"\n- Include both counts in test_output: "Before: N tests, After: M tests, New: M-N"\n\nAFTER WRITING:\n5. Run {{testCommand}} and capture the FULL output. Report it in test_output (last 50 lines max).\n6. Your new tests MUST fail. Report tests_pass=false and the exit code.\n7. Commit test files: git -C "{{wt}}" add {{testFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: RED complete"\n8. Report the commit SHA in commit_sha.\n\nCONSTRAINTS:\n- Append new test functions to existing test files \u2014 keep all existing tests intact\n- Only write and commit test files: {{testFilesList}}\n\nBANNED PATTERNS (any of these = pipeline rejection, no exceptions):\n- `assert True`, `assert 1`, `assert not False` \u2014 always passes\n- `pass` as the only statement in a test body\n- Empty test functions with no assertions\n- `raise NotImplementedError` \u2014 conftest xfail catches it and tests pass\n- `assert x is not None` as the ONLY assertion \u2014 smoke test, not a real check\nEach test MUST assert a specific expected value or exception type.\n';

// skills/src/prompts/red-retry.md
var red_retry_default = 'RED TDD agent \u2014 RETRY. Previous attempt failed: {{failureReason}}.\n\nFirst reset: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/\n\nSETUP: {{redCtxCmd}}\nTASK PACKET: {{redPacketStr}}\n\nWrite simple, concrete tests. One test per acceptance criterion. Assert specific values.\nCall methods that don\'t exist yet \u2014 AttributeError is your RED signal.\nNEVER use `raise NotImplementedError` \u2014 conftest will xfail it.\n\nAFTER WRITING:\n1. Run {{testCommand}} \u2014 tests must fail. Report tests_pass=false.\n2. Commit: git -C "{{wt}}" add {{testFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: RED complete"\n3. Report commit_sha.\n\nOnly write and commit test files: {{testFilesList}}\n';

// skills/src/prompts/green.md
var green_default = 'GREEN TDD agent. Make the failing tests pass with minimum implementation code.\n\nSETUP (run first): {{greenCtxCmd}}\nTASK PACKET: {{greenPacketStr}}\n\nCONTEXT MANAGEMENT:\nBefore reading implementation files, use headroom_compress on any file longer than 100 lines.\nThis saves context for reasoning. Use headroom_retrieve with a targeted query when you need\nspecific sections back (e.g. query="function signature" or query="class definition").\n\nTARGET CONTEXT (import guard):\nIf target_context is present in the task packet, only use imports that are valid for the target.\nCheck the dependency list before adding any import statement. DO NOT import modules that are\nnot listed as dependencies of the target you are implementing in.\n\nAPPROACH:\n1. Read test_signal carefully \u2014 each error tells you exactly what to implement\n2. Read impl_stubs \u2014 fill in function bodies, do not create new files\n3. Check existing_api \u2014 extend it, do not replace it\n4. Implement only what the errors require\n\nAFTER WRITING:\n5. Run {{testCommand}} \u2014 ALL tests must pass. Report tests_pass=true and the exit code.\n6. If test output exceeds 50 lines, compress it with headroom_compress and include the hash in test_output.\n7. Commit: git -C "{{wt}}" add {{implFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: GREEN complete"\n8. Report commit_sha.\n\nPACKET FIELDS:\n- test_signal: error messages from failing tests \u2014 your implementation spec\n- contract_summary: function signatures extracted from acceptance criteria\n- impl_stubs: skeleton files \u2014 fill these in\n- existing_api: current module code shape\n\nCONSTRAINTS:\n- Only write and commit implementation files: {{implFilesList}}\n';

// skills/src/prompts/green-retry.md
var green_retry_default = 'GREEN TDD agent \u2014 RETRY. Previous attempt failed: {{failureReason}}.\n\nFirst reset: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/\n\nSETUP: {{greenCtxCmd}}\nTASK PACKET: {{greenRetryPacketStr}}\n\nCONTEXT MANAGEMENT:\nUse headroom_compress on any file or test output longer than 100 lines.\nUse headroom_retrieve with a targeted query to pull back only what you need.\n\nRead test_signal errors carefully. Read existing implementation files first. Fix specific failures.\n\nAFTER WRITING:\n1. Run {{testCommand}} \u2014 all tests must pass. Report tests_pass=true.\n2. If test output exceeds 50 lines, compress it with headroom_compress and include the hash in test_output.\n3. Commit: git -C "{{wt}}" add {{implFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: GREEN complete"\n4. Report commit_sha.\n\nOnly write and commit implementation files: {{implFilesList}}\n';

// skills/src/prompts/refactor.md
var refactor_default = 'REFACTOR agent. Clean up the implementation without changing behavior.\n\nSETUP (run first): {{refactorCtxCmd}}\nTASK PACKET: {{refactorPacketStr}}\n\nSCOPE:\n- Improve naming, reduce duplication, simplify logic, remove dead code\n- Write to allowed files only\n\nAFTER WRITING:\n1. Run {{testCommand}} \u2014 every test must still pass. Report tests_pass=true.\n2. If tests pass: git -C "{{wt}}" add {{allFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: REFACTOR complete"\n3. If tests FAIL: report tests_pass=false, do NOT commit. Report failure_reason.\n\nCONSTRAINTS:\n- Tests are a one-way ratchet: do not remove, skip, weaken, or disable any test\n- Do not add new features \u2014 only improve existing code\n';

// skills/src/prompts/reflect.md
var reflect_default = 'TEST QUALITY evaluator. Read the test files and assess coverage of the acceptance criteria.\nRead-only \u2014 do NOT write or modify any files.\n\nRead these test files in "{{wt}}": {{testFiles}}\n\nIMPORTANT: If the test file contains tests from prior lanes (i.e., test functions that do NOT relate to any of the acceptance criteria below), IGNORE those tests entirely. Only evaluate test functions whose names and assertions directly relate to the acceptance criteria listed below. Tests for unrelated functionality should neither count for nor against the score.\n\nACCEPTANCE CRITERIA to cover:\n{{acStr}}\n\nEVALUATE:\n1. For each AC, identify which test function covers it (cite the function name)\n2. Check assertion strength: does each test assert specific values, not just "no error"?\n3. Identify gaps: ACs with no test, tests with weak assertions, missing negative/edge cases\n4. List each gap found\n\nSCORING RUBRIC:\n- 9-10: Every AC has a strong test with specific assertions\n- 7-8: All ACs covered but some assertions could be stronger\n- 5-6: Most ACs covered, 1-2 gaps\n- 3-4: Significant gaps \u2014 multiple ACs untested or only smoke-tested\n- 1-2: Tests exist but barely cover the ACs\n- 0: No meaningful test coverage\n\nReturn reasoning FIRST (with evidence), then gaps, then score.\n';

// skills/src/prompts/skeptic-base.md
var skeptic_base_default = "Adversarial code reviewer. Find bugs the test suite misses.\n\nWorking directory: \"{{wt}}\"\nImplementation files: {{implFiles}}\nTest files: {{testFiles}}\nTest command: {{testCommand}}\nAcceptance criteria:\n{{acStr}}\n\nTOOLS (use before manual reading):\n1. `ast-grep --pattern '<pattern>' {{implFiles}}` \u2014 find structural anti-patterns:\n   - Unchecked return values: `ast-grep --pattern '$_ = $F($$$)' <file>` then check if result is used\n   - Missing error handling: `ast-grep --pattern 'except: pass' <file>` or `except Exception: pass`\n   - Bare except: `ast-grep --pattern 'except:' <file>`\n2. headroom_compress on each file after reading, then query-retrieve for specific sections\n\nCONTEXT MANAGEMENT:\nAfter reading each file, compress it with headroom_compress. This frees context for\ndeeper analysis. Use headroom_retrieve with a query (e.g. query=\"error handling\" or\nquery=\"return value\") to pull back specific sections when investigating a potential bug.\n\nFor each bug found, provide:\n- description: what is wrong\n- evidence: the specific input, file, or line that demonstrates the bug\n- severity: critical / high / medium / low\n\nRead the implementation and tests. Run the test command to understand current coverage.\nOnly report bugs you can demonstrate with evidence. \"This might be a problem\" is not a bug.\n";

// skills/src/prompts/skeptic-edge.md
var skeptic_edge_default = "LENS: Edge cases.\nTest these inputs against the implementation:\n- Empty inputs, None/null values, single-element collections\n- Boundary values (0, -1, max int, empty string)\n- Off-by-one errors in loops and ranges\nFor each finding: describe the input, what happens, what should happen.\n";

// skills/src/prompts/skeptic-error.md
var skeptic_error_default = "LENS: Error paths.\nCheck these failure modes against the implementation:\n- What happens when preconditions are violated?\n- Are exceptions caught and handled, or do they propagate silently?\n- Are there state transitions that can reach invalid states?\nFor each finding: name the error condition and trace what happens.\n";

// skills/src/prompts/skeptic-contract.md
var skeptic_contract_default = "LENS: Behavioral contracts.\nCompare implementation behavior against the acceptance criteria:\n- Does the implementation satisfy the AC intent, not just the specific test inputs?\n- Are there inputs that satisfy the AC literally but produce wrong results?\n- Do the tests only cover the happy path while the AC implies broader coverage?\nFor each finding: cite the AC, the gap, and a concrete input that exposes it.\n";

// skills/src/prompts/refactor-check.md
var refactor_check_default = 'CODE QUALITY gate. Decide if the implementation needs refactoring \u2014 be conservative.\nRead-only \u2014 do NOT write or modify any files.\n\nRead these files in "{{wt}}": {{allFiles}}\n\nReturn should_refactor=true ONLY if you find one of these concrete problems:\n- Duplicated logic (same code block copy-pasted in 2+ places)\n- Function longer than 50 lines that could be split at a clear seam\n- Dead code introduced by this task (unused imports, unreachable branches)\n- Misleading names that contradict what the code does\n\nMinor style issues (single variable name, one extra blank line) are NOT worth refactoring.\nIf the code works and reads clearly, return should_refactor=false.\n\nIf should_refactor=true, the reason must name the specific file and problem.\n';

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function redPrompt(vars) {
  return PREAMBLE + renderPrompt(red_default, vars);
}
function redRetryPrompt(vars) {
  return PREAMBLE + renderPrompt(red_retry_default, vars);
}
function greenPrompt(vars) {
  return PREAMBLE + renderPrompt(green_default, vars);
}
function greenRetryPrompt(vars) {
  return PREAMBLE + renderPrompt(green_retry_default, vars);
}
function refactorPrompt(vars) {
  return PREAMBLE + renderPrompt(refactor_default, vars);
}
function reflectPrompt(vars) {
  return PREAMBLE + renderPrompt(reflect_default, vars);
}
function skepticBasePrompt(vars) {
  return PREAMBLE + renderPrompt(skeptic_base_default, vars);
}
function skepticLenses() {
  return [
    { key: "edge", model: model("fast"), prompt: skeptic_edge_default },
    { key: "error", model: model("fast"), prompt: skeptic_error_default },
    { key: "contract", model: model("balanced"), prompt: skeptic_contract_default }
  ];
}
function refactorCheckPrompt(vars) {
  return PREAMBLE + renderPrompt(refactor_check_default, vars);
}

// skills/src/datum-tdd-act-lane.ts
async function verifyFileOwnership(taskId, wt, stage, allowedFiles, forbiddenFiles) {
  const result = await agent(
    `Run: git -C "${wt}" diff --name-only HEAD~1 HEAD
Return ONLY a JSON object: {"files_changed": ["path1", "path2"]}
No markdown fences, no explanation.`,
    { label: `ownership-check:${taskId}:${stage}`, phase: "Act", model: model("fast") }
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
      violations.push(`${f} is not in allowed files list [${allowedFiles.join(", ")}]`);
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
  const skeletonCmd = `datum skeleton --task-id ${taskId} --language ${cfg2.language} --tasks ${cfg2.lanePlanPath} --output .datum/runs/${cfg2.runId}/preflight-${taskId}.json`;
  const preflightPath = `.datum/runs/${cfg2.runId}/preflight-${taskId}.json`;
  let targetContext;
  const preflightRaw = await agent(
    `Run: ${skeletonCmd}
Then read the output file: cat "${wt}/${preflightPath}" 2>/dev/null || echo "{}"
Return ONLY the raw JSON contents of the file. No markdown fences, no explanation.`,
    { label: `preflight:${taskId}`, phase: "Act", model: model("fast") }
  );
  if (preflightRaw) {
    const preflightData = parseAgentJson(preflightRaw, {});
    if (preflightData.target_context) {
      targetContext = preflightData.target_context;
      log(`[${taskId}] target_context extracted: ${Object.keys(targetContext).join(", ")}`);
    }
  }
  const redExtras = targetContext ? { target_context: targetContext } : {};
  const redPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, "RED", redExtras);
  const redCtxCmd = laneCtxCmd(redPacket, wt);
  const promptVars = {
    wt,
    skeletonCmd,
    redCtxCmd,
    redPacketStr: JSON.stringify(redPacket),
    testCommand: laneTestCmd,
    testFilesList: testFiles.join(" "),
    commitPrefix: redPacket.commit_prefix,
    taskId
  };
  let red = await agent(
    redPrompt(promptVars),
    { label: `red:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA }
  );
  if (red?.success) {
    log(`[${taskId}] RED wrote: ${(red.files_written || []).join(", ")}`);
  }
  if (!red || !red.success) {
    log(`[${taskId}] RED attempt 1 failed: ${red?.failure_reason || "unknown"}, retrying`);
    red = await agent(
      redRetryPrompt({ ...promptVars, failureReason: red?.failure_reason || "unknown" }),
      { label: `red-retry:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA }
    );
  }
  if (!red || !red.success) {
    log(`[${taskId}] RED FAILED: ${red?.failure_reason || "no files written after 2 attempts"}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: red?.failure_reason || "RED failed" };
  }
  const acCount = (lane.acceptance_criteria || []).length;
  if (acCount > 0) {
    const countResult = await agent(
      `Run: git -C "${wt}" diff HEAD~1 HEAD -- ${testFiles.join(" ")} | grep -c '^+def test_' || echo 0
Return ONLY the number. No explanation.`,
      { label: `test-count-check:${taskId}`, phase: "Act", model: model("fast") }
    );
    const newTestCount = parseInt(String(countResult).trim(), 10) || 0;
    if (newTestCount < acCount) {
      log(`[${taskId}] RED FAILED: only ${newTestCount} new test functions found, need >= ${acCount} (one per AC)`);
      return { task_id: taskId, status: "failed", stage: "RED", error: `no_new_test_functions_committed: found ${newTestCount}, need >= ${acCount}` };
    }
    log(`[${taskId}] RED: ${newTestCount} new test functions confirmed (>= ${acCount} ACs)`);
  }
  const sgPatterns = [
    { pattern: "assert True", name: "assert True" },
    { pattern: "assert 1", name: "assert 1" },
    { pattern: "raise NotImplementedError", name: "raise NotImplementedError" }
  ];
  const sgResult = await agent(
    `Run these ast-grep commands on the test files and report what was found.
For each command, capture the output. If ast-grep is not available, fall back to grep.

${testFiles.map((f) => sgPatterns.map(
      (p) => `ast-grep --pattern '${p.pattern}' "${wt}/${f}" 2>/dev/null || grep -n '${p.pattern}' "${wt}/${f}" 2>/dev/null`
    ).join("\n")).join("\n")}

Also check for pass-only test bodies:
${testFiles.map(
      (f) => `grep -A1 'def test_' "${wt}/${f}" 2>/dev/null | grep -B1 '^\\s*pass$' 2>/dev/null`
    ).join("\n")}

Return JSON: {"has_placeholders": true/false, "detail": "which files:lines and what pattern, or empty if clean"}
Output raw JSON only.`,
    { label: `assert-check:${taskId}`, phase: "Act", model: model("fast") }
  );
  const assertParsed = parseAgentJson(sgResult, {});
  if (assertParsed.has_placeholders) {
    log(`[${taskId}] RED: placeholder assertions found \u2014 ${assertParsed.detail}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: `placeholder_assertions: ${assertParsed.detail}` };
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
  const testCountResult = await agent(
    `Count test functions in these files:
${testFiles.map((f) => `grep -c "def test_\\\\|async def test_" "${wt}/${f}" 2>/dev/null || echo 0`).join("\n")}
Also check the parent commit:
${testFiles.map((f) => `git -C "${wt}" show HEAD~1:"${f}" 2>/dev/null | grep -c "def test_\\\\|async def test_" || echo 0`).join("\n")}
Return JSON: {"before": <total_before>, "after": <total_after>, "new_count": <after - before>}
Output raw JSON only.`,
    { label: `test-count:${taskId}`, phase: "Act", model: model("fast") }
  );
  const counts = parseAgentJson(testCountResult, {});
  if ((counts.new_count || 0) === 0) {
    log(`[${taskId}] RED FAILED: no new test functions written (before=${counts.before}, after=${counts.after})`);
    return { task_id: taskId, status: "failed", stage: "RED", error: "no_new_tests_written: RED agent did not append any test functions" };
  }
  log(`[${taskId}] RED: ${counts.new_count} new test functions verified (${counts.before} \u2192 ${counts.after})`);
  const reflectResult = await agent(
    reflectPrompt({ wt, testFiles: testFiles.join(", "), acStr }),
    { label: `reflect:${taskId}`, phase: "Act", model: model("fast"), schema: REFLECT_SCHEMA }
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
  const greenModel = lane.green_model || model("balanced");
  const contractSummary = extractContractSummary(lane.acceptance_criteria || []);
  log(`[${taskId}] GREEN: making tests pass (model: ${greenModel})`);
  const greenExtras = {
    test_signal: { exit_code: red.test_exit_code || 1, errors: red.test_errors || [] },
    contract_summary: contractSummary,
    ...targetContext ? { target_context: targetContext } : {}
  };
  const greenPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, "GREEN", greenExtras);
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
      { label: `green-retry:${taskId}`, phase: "Act", model: model("deep"), schema: STAGE_RESULT_SCHEMA }
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
    { label: `refactor-check:${taskId}`, phase: "Act", model: model("fast"), schema: REFACTOR_CHECK_SCHEMA }
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
    { label: `refactor:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA }
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
        { label: `revert-refactor:${taskId}`, phase: "Act", model: model("fast") }
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
