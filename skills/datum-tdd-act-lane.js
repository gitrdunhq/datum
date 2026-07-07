// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-lane.ts
export const meta = {
  name: "datum-tdd-act-lane",
  description: "DAG-scheduled TDD execution: RED->GREEN->REFACTOR per lane",
  phases: [{ title: "Act" }]
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

// skills/src/shared/agents.ts
var RATE_LIMIT_MAX_RETRIES = 4;
var RATE_LIMIT_BASE_DELAY_MS = 5e3;
var RATE_LIMIT_JITTER_MS = 2e3;
function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function verifyCommitIndependently(taskId, wt, files, commitPrefix, stage) {
  const raw = await agent(
    `Run these two commands in order in "${wt}" and return their raw combined output, nothing else:
git -C "${wt}" log --format="%H %s"
git -C "${wt}" status --porcelain -- ${files.map((f) => `"${f}"`).join(" ")}
Return ONLY the raw output, no explanation, no markdown fences.`,
    { label: `verify-commit:${taskId}:${stage}`, model: "haiku" }
  );
  if (!raw) return { committed: false, detail: "independent check returned no result" };
  const lines = String(raw).trim().split("\n").filter(Boolean);
  const shaLine = /^[0-9a-f]{40} /;
  const logLines = lines.filter((l) => shaLine.test(l));
  const statusLines = lines.filter((l) => !shaLine.test(l));
  const target = `${commitPrefix}: ${stage} complete`;
  const match = logLines.find((l) => l.includes(target));
  const clean = statusLines.length === 0;
  return {
    committed: Boolean(match) && clean,
    commitSha: match ? match.split(" ")[0] : "",
    clean,
    detail: match ? `found_commit="${match}" uncommitted_files=${statusLines.length}` : `no commit matching "${target}" found in history; uncommitted_files=${statusLines.length}`
  };
}
async function resilientAgent(prompt, opts, deps) {
  const agentFn = deps?.agentFn ?? agent;
  const logFn = deps?.logFn ?? log;
  const maxRetries = opts?.maxRetries ?? RATE_LIMIT_MAX_RETRIES;
  let lastResult = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let threw = false;
    let caughtMessage = "";
    try {
      lastResult = await agentFn(prompt, opts);
    } catch (err) {
      threw = true;
      caughtMessage = err instanceof Error ? err.message : String(err);
      lastResult = null;
    }
    if (!threw && lastResult !== null) return lastResult;
    if (threw) {
      logFn(`[resilientAgent] attempt ${attempt + 1} threw: ${caughtMessage} \u2014 treating as retryable`);
    }
    if (attempt < maxRetries && opts?.worktree) {
      const dirty = await agentFn(
        `Run: git -C "${opts.worktree}" status --porcelain
Return ONLY the raw output, no explanation.`,
        { label: "retry-guard", model: "haiku" }
      );
      if (dirty && dirty.trim().length > 0) {
        logFn(`[resilientAgent] attempt ${attempt + 1} ${threw ? `threw: ${caughtMessage}` : "returned null"} but worktree is dirty \u2014 aborting retry to prevent duplicate writes`);
        return lastResult;
      }
    }
    if (attempt < maxRetries) {
      const delay = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt) + Math.floor(Math.random() * RATE_LIMIT_JITTER_MS);
      const reason = threw ? `threw: ${caughtMessage}` : "returned null";
      logFn(`[resilientAgent] attempt ${attempt + 1} ${reason}, backing off ${Math.round(delay / 1e3)}s before retry ${attempt + 2}/${maxRetries + 1}`);
      await sleepMs(delay);
    }
  }
  return lastResult;
}

// skills/src/shared/tracker.ts
async function updateStage(issueId, stage, commitSha) {
  if (!issueId) return;
  const shaFlag = commitSha ? ` --commit ${commitSha}` : "";
  await agent(
    `Run: datum issue-stage --issue ${issueId} --stage ${stage}${shaFlag}
If the command doesn't exist or fails, silently continue.
Output nothing.`,
    { label: `tracker:${issueId}:${stage}`, model: "haiku" }
  );
}
function getIssueId(lanePlan2, taskId) {
  const issue = lanePlan2.lanes[taskId]?.github_issue;
  return issue ? String(issue) : "";
}

// skills/src/shared/utils.ts
function pathBoundaryMatch(a2, b) {
  return a2 === b || a2.endsWith("/" + b) || b.endsWith("/" + a2) || a2.startsWith(b + "/");
}
function verifyFileOwnership(changed, allowedFiles, forbiddenFiles = []) {
  const violations = [];
  for (const f of changed) {
    if (forbiddenFiles.some((fb) => pathBoundaryMatch(f, fb))) {
      violations.push(`${f} is owned by another lane`);
    }
    if (allowedFiles.length > 0 && !allowedFiles.some((a2) => pathBoundaryMatch(f, a2))) {
      violations.push(`${f} is not in allowed files list [${allowedFiles.join(", ")}]`);
    }
  }
  return { ok: violations.length === 0, violations };
}
function classifyFiles(files) {
  const isImplAdjacent = (f) => {
    return f.includes("/Mocks/") || f.includes("/mocks/") || f.includes("/Fakes/") || f.includes("/fakes/") || f.includes("/Stubs/") || f.includes("/stubs/") || f.includes("/Fixtures/") || f.includes("/fixtures/") || f.includes("/Helpers/") || f.includes("/helpers/");
  };
  const isTest = (f) => {
    if (isImplAdjacent(f)) return false;
    const base = f.split("/").pop() || "";
    return base.startsWith("test_") || base.endsWith("_test.py") || base.endsWith(".test.ts") || base.endsWith(".test.js") || base.endsWith(".spec.ts") || base.endsWith(".spec.js") || base.endsWith("_test.go") || base.endsWith("Tests.swift") || f.includes("/tests/") || f.includes("/Tests/") || base === "conftest.py";
  };
  const testFiles = (files || []).filter(isTest);
  const implFiles = (files || []).filter((f) => !isTest(f));
  return { testFiles, implFiles };
}
var FIRST_PARTY_PY_PACKAGES = ["datum", "scripts", "tests"];
function joinPosix(baseDir, rel) {
  const baseParts = baseDir.split("/").filter((p) => p !== "" && p !== ".");
  const relParts = rel.split("/");
  for (const part of relParts) {
    if (part === "" || part === ".") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join("/");
}
function dirnamePosix(p) {
  const parts = p.split("/");
  parts.pop();
  return parts.join("/");
}
function ensureTsExtension(p) {
  return /\.(ts|tsx|js|jsx|json)$/.test(p) ? p : `${p}.ts`;
}
function extractRequiredScopeFiles(content, testFilePath, language) {
  const required = /* @__PURE__ */ new Set();
  const dir = dirnamePosix(testFilePath);
  if (language === "typescript" || language === "javascript") {
    const importRe = /(?:import\s+(?:type\s+)?(?:\*\s+as\s+\w+|\{[^}]*\}|\w+)\s+from\s+|require\(\s*)['"](\.\.?\/[^'"]+)['"]\)?/g;
    let m;
    while (m = importRe.exec(content)) {
      required.add(ensureTsExtension(joinPosix(dir, m[1])));
    }
    const readFileRe = /readFileSync\(\s*join\(\s*__dirname\s*,\s*([^)]+)\)/g;
    let rm;
    while (rm = readFileRe.exec(content)) {
      const argsStr = rm[1];
      const segRe = /['"]([^'"]+)['"]/g;
      const segs = [];
      let sm;
      while (sm = segRe.exec(argsStr)) segs.push(sm[1]);
      if (segs.length > 0) {
        required.add(joinPosix(dir, segs.join("/")));
      }
    }
  } else if (language === "python") {
    const fromRe = /(?:^|\n)[ \t]*from\s+([\w]+(?:\.[\w]+)*)\s+import\s+/g;
    const importRe = /(?:^|\n)[ \t]*import\s+([\w]+(?:\.[\w]+)*)/g;
    const modules = [];
    let m;
    while (m = fromRe.exec(content)) modules.push(m[1]);
    while (m = importRe.exec(content)) modules.push(m[1]);
    for (const mod of modules) {
      const top = mod.split(".")[0];
      if (!FIRST_PARTY_PY_PACKAGES.includes(top)) continue;
      required.add(`${mod.split(".").join("/")}.py`);
    }
  }
  return [...required];
}
function findScopeGaps(requiredFiles, allowedFiles) {
  return requiredFiles.filter((rf) => !allowedFiles.some((af) => pathBoundaryMatch(rf, af)));
}
function parseAgentJson(text, fallback) {
  if (!text || typeof text !== "string") return fallback;
  const fenced = text.trim().match(/^```[a-z]*\n([\s\S]*)\n```$/);
  const cleaned = (fenced ? fenced[1] : text).trim();
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
  // Python
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
  "classmethod",
  // Swift
  "fatalError",
  "precondition",
  "debugPrint",
  "String",
  "Int",
  "Array",
  "Dictionary",
  "Bool",
  "Optional",
  // Go
  "fmt",
  "Println",
  "Printf",
  "Sprintf",
  "make",
  "append",
  "delete",
  "panic",
  "recover",
  // TypeScript / JavaScript
  "console",
  "log",
  "parseInt",
  "parseFloat",
  "Number",
  "Object",
  "Boolean",
  "Promise",
  "setTimeout",
  "JSON"
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
function detectExistingLaneCommits(logOutput, taskId) {
  const redTarget = `red(${taskId}): RED complete`;
  const greenTarget = `green(${taskId}): GREEN complete`;
  const lines = (logOutput || "").split("\n");
  return {
    hasRed: lines.some((l) => l.includes(redTarget)),
    hasGreen: lines.some((l) => l.includes(greenTarget))
  };
}
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
}

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = "# datum\n\n> Agentic software delivery pipeline \u2014 language-agnostic, config-driven.\n\n## CLI Rule\n- All commands use `datum <command>` \u2014 never `uv run`, `python3 scripts/`, or bare tool invocations\n- Test command comes from `.datum/config.json` `test_command` field \u2014 read it, don't guess\n\n## Coding Rules\n- Functional core / imperative shell \u2014 business logic is pure, side effects at edges\n- Boundary validation \u2014 validate external input immediately (Pydantic/Zod)\n- 500-line file cap \u2014 split via functional seams\n- Structured errors \u2014 never silently swallow, return {code, message}\n- No silent fallbacks \u2014 fail fast, don't mask missing data\n- Idempotent mutations \u2014 upserts, dedup before side effects\n- Timeouts on all external calls \u2014 explicit timeout + capped retries\n\n## Test Conventions\n- Always RED before GREEN \u2014 write failing test first, confirm failure\n- Strong assertions \u2014 verify specific values, not just \"no error\"\n- Negative paths required \u2014 test invalid inputs, timeouts, state violations\n- Run tests with the configured test command (from `.datum/config.json`)\n\n## File Conventions\n- Follow the repo's existing style (detected by datum-awake)\n- No `eval()`, `os.system()`, `shell=True`\n\n## Full Context\n- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and patterns\n";

// skills/src/prompts/red.md
var red_default = 'RED TDD agent. Write failing tests that prove the acceptance criteria are not yet implemented.\n\nSETUP:\n1. cd into {{wt}}\n2. Run: {{skeletonCmd}}\n3. Run: {{redCtxCmd}}\n\nTARGET CONTEXT (import guard):\nIf the preflight output at .datum/runs/*/preflight-{{taskId}}.json contains a target_context\nfield, read it. It lists which modules each target depends on. Only import modules listed as\ndependencies of the target your test file belongs to. DO NOT import modules from other targets.\n\nTASK PACKET: {{redPacketStr}}\n\nFRAMEWORK DETECTION:\nBefore writing any test code, read ONE existing test file from the same directory as your target test files. Match its:\n- Import style (e.g. import XCTest vs import Testing, import pytest vs import unittest)\n- Test class/struct pattern (XCTestCase subclass vs @Test macro, etc.)\n- Assertion style (XCTAssertEqual vs #expect, assert vs self.assertEqual)\nIf no existing test files exist, fall back to the test_framework field in the task packet.\n\nGOAL: Write one test function per acceptance criterion. Each test must FAIL when you run it.\n\nAPPROACH:\n1. Read the acceptance_criteria from the task packet\n2. For each AC, write a test that calls the method described in the AC\n3. Assert specific expected values \u2014 not just "doesn\'t crash"\n4. Call methods that don\'t exist yet \u2014 the resulting error (AttributeError in Python, compilation error in Swift/Go, TypeError in TS) is the correct RED failure\n\nVERIFY BEFORE RUNNING TESTS:\n4b. Grep your test file(s) for new test functions: grep -c \'{{testFuncPattern}}\' {{testFilesList}}\n    Confirm you have at least one new test function per AC. If any AC lacks a test, go back and write it before proceeding.\n\nSELF-CHECK (mandatory before running tests):\n- Count how many `{{testFuncPattern}}` functions exist in each test file BEFORE your edits\n- Count how many `{{testFuncPattern}}` functions exist AFTER your edits\n- The count MUST increase by at least len(acceptance_criteria) new functions\n- If count did not increase, you FAILED \u2014 do not proceed, report success=false with failure_reason="no_new_tests_written"\n- Include both counts in test_output: "Before: N tests, After: M tests, New: M-N"\n\nAFTER WRITING:\n5. Run {{testCommand}} and capture the FULL output. Report it in test_output (last 50 lines max).\n6. Your new tests MUST fail. Report tests_pass=false and the exit code.\n7. Commit test files: git -C "{{wt}}" add {{testFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: RED complete"\n8. Report the commit SHA in commit_sha.\n\nCONSTRAINTS:\n- Append new test functions to existing test files \u2014 keep all existing tests intact\n- Only write and commit test files: {{testFilesList}}\n- OFF-LIMITS: Do NOT write any files not listed in {{testFilesList}}. Production implementation files, skeleton stubs, and non-test code are prohibited. Example of a prohibited write: NoOpPermissionService.swift \u2014 this is a production implementation file, not a test file. If it is not a test file, do not write it.\n\nBANNED PATTERNS (any of these = pipeline rejection, no exceptions):\n- Python: `assert True`, `assert 1`, `assert not False`, `pass` as only body, `raise NotImplementedError`\n- Swift: `XCTFail()` as only assertion, empty test body, `fatalError()`\n- Go: `t.Fatal("not implemented")`, `panic("not implemented")`, empty test body\n- TS/JS: `expect(true).toBe(false)`, `throw new Error("not implemented")`, empty test body\n- `assert x is not None` / trivial nil-checks as the ONLY assertion\nEach test MUST assert a specific expected value or exception type.\n';

// skills/src/prompts/red-retry.md
var red_retry_default = `RED TDD agent \u2014 RETRY. Previous attempt failed: {{failureReason}}.

First reset: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/

SETUP: {{redCtxCmd}}
TASK PACKET: {{redPacketStr}}

Write simple, concrete tests. One test per acceptance criterion. Assert specific values.
Call methods that don't exist yet \u2014 the language's missing-method error (AttributeError, TypeError, compilation error, etc.) is your RED signal.
NEVER use hardcoded failure stubs (raise NotImplementedError, fatalError, panic) \u2014 test fixtures may auto-skip them.

AFTER WRITING:
1. Run {{testCommand}} \u2014 tests must fail. Report tests_pass=false.
2. Commit: git -C "{{wt}}" add {{testFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: RED complete"
3. Report commit_sha.

Only write and commit test files: {{testFilesList}}. OFF-LIMITS: Do NOT write any files not listed in {{testFilesList}}. Production implementation files, skeleton stubs, and non-test code are strictly prohibited (e.g., NoOpPermissionService.swift is a production impl file \u2014 do not write it).
`;

// skills/src/prompts/green.md
var green_default = `GREEN TDD agent. Make the failing tests pass with minimum implementation code.

SETUP (run first): {{greenCtxCmd}}
TASK PACKET: {{greenPacketStr}}

CONTEXT MANAGEMENT:
Before reading implementation files, use headroom_compress on any file longer than 100 lines.
This saves context for reasoning. Use headroom_retrieve with a targeted query when you need
specific sections back (e.g. query="function signature" or query="class definition").

TARGET CONTEXT (import guard):
If target_context is present in the task packet, only use imports that are valid for the target.
Check the dependency list before adding any import statement. DO NOT import modules that are
not listed as dependencies of the target you are implementing in.

APPROACH:
1. Read test_signal carefully \u2014 each error tells you exactly what to implement
2. Read impl_stubs \u2014 fill in function bodies, do not create new files
3. Check existing_api \u2014 extend it, do not replace it
4. Implement only what the errors require

AFTER WRITING:
5. Run {{testCommand}} \u2014 ALL tests must pass. Report tests_pass=true and the exit code.
6. If test output exceeds 50 lines, compress it with headroom_compress and include the hash in test_output.
7. Commit: git -C "{{wt}}" add {{implFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: GREEN complete"
8. Report commit_sha.

PACKET FIELDS:
- test_signal: error messages from failing tests \u2014 your implementation spec
- contract_summary: function signatures extracted from acceptance criteria
- impl_stubs: skeleton files \u2014 fill these in
- existing_api: current module code shape

CONSTRAINTS:
- Only write and commit implementation files: {{implFilesList}}
- If making tests pass requires modifying files outside {{implFilesList}}, report success=false with failure_reason='scope_exceeded: <list-of-files>'. Do NOT write files outside allowed scope.
- Package.swift changes are FORBIDDEN in behavioral lanes. If a new dependency is needed, report scope_exceeded with 'Package.swift' and a description of the required dependency.
- For Swift: target-scoped test command (with --filter) is already provided. Do NOT run a broader test command that compiles unrelated targets.
`;

// skills/src/prompts/green-retry.md
var green_retry_default = 'GREEN TDD agent \u2014 RETRY. Previous attempt failed: {{failureReason}}.\n\nFirst reset: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/\n\nSETUP: {{greenCtxCmd}}\nTASK PACKET: {{greenRetryPacketStr}}\n\nCONTEXT MANAGEMENT:\nUse headroom_compress on any file or test output longer than 100 lines.\nUse headroom_retrieve with a targeted query to pull back only what you need.\n\nRead test_signal errors carefully. Read existing implementation files first. Fix specific failures.\n\nAFTER WRITING:\n1. Run {{testCommand}} \u2014 all tests must pass. Report tests_pass=true.\n2. If test output exceeds 50 lines, compress it with headroom_compress and include the hash in test_output.\n3. Commit: git -C "{{wt}}" add {{implFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: GREEN complete"\n4. Report commit_sha.\n\nOnly write and commit implementation files: {{implFilesList}}\n';

// skills/src/prompts/refactor.md
var refactor_default = 'REFACTOR agent. Clean up the implementation without changing behavior.\n\nSETUP (run first): {{refactorCtxCmd}}\nTASK PACKET: {{refactorPacketStr}}\n\nSCOPE:\n- Improve naming, reduce duplication, simplify logic, remove dead code\n- Write to allowed files only\n\nAFTER WRITING:\n1. Run {{testCommand}} \u2014 every test must still pass. Report tests_pass=true.\n2. If tests pass: git -C "{{wt}}" add {{allFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: REFACTOR complete"\n3. If tests FAIL: report tests_pass=false, do NOT commit. Report failure_reason.\n\nCONSTRAINTS:\n- Tests are a one-way ratchet: do not remove, skip, weaken, or disable any test\n- Do not add new features \u2014 only improve existing code\n';

// skills/src/prompts/reflect.md
var reflect_default = 'TEST QUALITY evaluator. Read the test files and assess coverage of the acceptance criteria.\nRead-only \u2014 do NOT write or modify any files.\n\nRead these test files in "{{wt}}": {{testFiles}}\n\nIMPORTANT: If the test file contains tests from prior lanes (i.e., test functions that do NOT relate to any of the acceptance criteria below), IGNORE those tests entirely. Only evaluate test functions whose names and assertions directly relate to the acceptance criteria listed below. Tests for unrelated functionality should neither count for nor against the score.\n\nACCEPTANCE CRITERIA to cover:\n{{acStr}}\n\nEVALUATE:\n1. For each AC, identify which test function covers it (cite the function name)\n2. Check assertion strength: does each test assert specific values, not just "no error"?\n3. Identify gaps: ACs with no test, tests with weak assertions, missing negative/edge cases\n4. List each gap found\n\nSCORING RUBRIC:\n- 9-10: Every AC has a strong test with specific assertions\n- 7-8: All ACs covered but some assertions could be stronger\n- 5-6: Most ACs covered, 1-2 gaps\n- 3-4: Significant gaps \u2014 multiple ACs untested or only smoke-tested\n- 1-2: Tests exist but barely cover the ACs\n- 0: No meaningful test coverage\n\nReturn reasoning FIRST (with evidence), then gaps, then score.\n';

// skills/src/prompts/skeptic-base.md
var skeptic_base_default = "Adversarial code reviewer. Find bugs the test suite misses.\n\nWorking directory: \"{{wt}}\"\nImplementation files: {{implFiles}}\nTest files: {{testFiles}}\nTest command: {{testCommand}}\nAcceptance criteria:\n{{acStr}}\n\nTOOLS (use before manual reading):\n1. `ast-grep --pattern '<pattern>' {{implFiles}}` \u2014 find structural anti-patterns:\n   - Unchecked return values: `ast-grep --pattern '$_ = $F($$$)' <file>` then check if result is used\n   - Bare exception handlers that swallow errors (Python: `except: pass`, Swift: empty `catch {}`, Go: ignoring `err`, TS: empty `catch {}`):\n     `ast-grep --pattern 'except: pass' <file>` (Python), `ast-grep --pattern 'catch { }' <file>` (Swift/TS)\n2. headroom_compress on each file after reading, then query-retrieve for specific sections\n\nCONTEXT MANAGEMENT:\nAfter reading each file, compress it with headroom_compress. This frees context for\ndeeper analysis. Use headroom_retrieve with a query (e.g. query=\"error handling\" or\nquery=\"return value\") to pull back specific sections when investigating a potential bug.\n\nFor each bug found, provide:\n- description: what is wrong\n- evidence: the specific input, file, or line that demonstrates the bug\n- severity: critical / high / medium / low\n\nRead the implementation and tests. Run the test command to understand current coverage.\nOnly report bugs you can demonstrate with evidence. \"This might be a problem\" is not a bug.\n";

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
async function verifyFileOwnership2(taskId, wt, stage, allowedFiles, forbiddenFiles) {
  const result = await agent(
    `Run: git -C "${wt}" diff --name-only HEAD~1 HEAD
Return ONLY a JSON object: {"files_changed": ["path1", "path2"]}
No markdown fences, no explanation.`,
    { label: `ownership-check:${taskId}:${stage}`, phase: "Act", model: model("fast") }
  );
  if (!result) return { ok: true, violations: [] };
  const parsed = typeof result === "string" ? parseAgentJson(result, {}) : result;
  const changed = parsed.files_changed || [];
  return verifyFileOwnership(changed, allowedFiles, forbiddenFiles);
}
async function runLane(taskId, lanePlan2, worktreePaths2, cfg2) {
  const lane = lanePlan2.lanes[taskId];
  const wt = worktreePaths2[taskId];
  if (!wt || typeof wt !== "string" || !wt.startsWith("/")) {
    return {
      task_id: taskId,
      status: "failed",
      stage: "CRASH",
      error: `no worktree path for ${taskId} (setup returned ${JSON.stringify(wt)}) \u2014 refusing to run outside an isolated worktree`
    };
  }
  const issueId = getIssueId(lanePlan2, taskId);
  const runId = cfg2.runId;
  const isStructural = lane.stage === "structural";
  const { testFiles, implFiles } = classifyFiles(lane.files);
  const acStr = (lane.acceptance_criteria || []).join("\n");
  const laneTestCmd = cfg2.testCommand;
  const laneCfg = { ...cfg2, testCommand: laneTestCmd };
  const laneFiles = [...testFiles, ...implFiles];
  const laneLanguage = laneFiles.some((f) => /\.(ts|tsx)$/.test(f)) ? "typescript" : laneFiles.some((f) => /\.(js|jsx|mjs)$/.test(f)) ? "javascript" : laneFiles.some((f) => /\.go$/.test(f)) ? "go" : laneFiles.some((f) => /\.swift$/.test(f)) ? "swift" : laneFiles.some((f) => /\.py$/.test(f)) ? "python" : cfg2.language;
  const swiftTargetFilter = laneLanguage === "swift" ? (() => {
    const swft = implFiles[0];
    if (swft) {
      const parts = swft.split("/");
      const sourcesIdx = parts.indexOf("Sources");
      if (sourcesIdx >= 0 && parts[sourcesIdx + 1]) {
        return `--filter ${parts[sourcesIdx + 1]}`;
      }
    }
    return null;
  })() : null;
  const scopedTestCmd = typeof lane.test_command === "string" && lane.test_command.trim() ? lane.test_command.trim() : swiftTargetFilter ? `${cfg2.testCommand} ${swiftTargetFilter}` : cfg2.testCommand;
  const scopedLaneCfg = { ...cfg2, testCommand: scopedTestCmd };
  const testFuncDiffRegex = laneLanguage === "swift" ? "[+][[:space:]]*(@Test|func test)" : laneLanguage === "go" ? "[+][[:space:]]*func Test" : laneLanguage === "typescript" || laneLanguage === "javascript" ? "[+][[:space:]]*(it\\(|test\\(|describe\\()" : "[+][[:space:]]*def test_";
  const testFuncGrepRegex = laneLanguage === "swift" ? "@Test|func test" : laneLanguage === "go" ? "func Test" : laneLanguage === "typescript" || laneLanguage === "javascript" ? "it\\(|test\\(|describe\\(" : "def test_|async def test_";
  const testFuncBodyRegex = laneLanguage === "swift" ? "func test" : laneLanguage === "go" ? "func Test" : "def test_";
  const completionPath = runId ? `.datum/runs/${runId}/lane-state/${taskId}.json` : null;
  if (completionPath) {
    const completionExist = await agent(
      `Read the file: cat "${completionPath}" 2>/dev/null || echo ""
If the file exists, return ONLY its raw contents (valid JSON).
If the file does not exist or is empty, return exactly: MISSING
No markdown fences, no explanation.`,
      { label: `completion-check:${taskId}`, phase: "Act", model: model("fast") }
    );
    if (completionExist && completionExist.trim() !== "MISSING") {
      const compData = parseAgentJson(completionExist, {});
      if (compData.task_id === taskId) {
        log(`[${taskId}] lane already completed in a prior run \u2014 skipping`);
        return { task_id: taskId, status: "skipped", stage: "SKIPPED", error: "cross-run completion: lane was completed in a previous run" };
      }
    }
  }
  log(`[${taskId}] Starting: ${lane.title} (${isStructural ? "structural" : "behavioral"}, ${testFiles.length} test, ${implFiles.length} impl)`);
  const laneHistoryRaw = await agent(
    `Run: git -C "${wt}" log --format="%H %s"
Return ONLY the raw output, no explanation, no markdown fences.`,
    { label: `lane-history-check:${taskId}`, phase: "Act", model: "haiku" }
  );
  const { hasRed: redAlreadyCommitted, hasGreen: greenAlreadyCommitted } = detectExistingLaneCommits(laneHistoryRaw || "", taskId);
  async function writeCompletion() {
    if (!runId) return;
    const cp = `.datum/runs/${runId}/lane-state/${taskId}.json`;
    const dir = cp.split("/").slice(0, -1).join("/");
    await agent(
      `Run: mkdir -p ./${dir}
Write to file: ./${cp}
Write: {"task_id": "${taskId}", "status": "completed"}
List the files changed.`,
      { label: `completion-write:${taskId}`, phase: "Act", model: model("fast") }
    );
  }
  if (isStructural) {
    const r = await runRefactor(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg);
    if (!r) return { task_id: taskId, status: "failed", stage: "REFACTOR", error: "refactor failed" };
    await updateStage(issueId, "done");
    await writeCompletion();
    return { task_id: taskId, status: "completed", stage: "REFACTOR" };
  }
  if (redAlreadyCommitted && greenAlreadyCommitted) {
    log(`[${taskId}] RED and GREEN commits already exist on lane branch \u2014 lane already satisfied, resuming from REFACTOR (#331)`);
    const r = await runRefactor(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg);
    if (!r) return { task_id: taskId, status: "failed", stage: "REFACTOR", error: "refactor failed" };
    await updateStage(issueId, "done");
    await writeCompletion();
    return { task_id: taskId, status: "completed", stage: "REFACTOR" };
  }
  const scriptTestPattern = /\.(test|spec)\.(ts|js|tsx|jsx)$|(^|\/)test_.*\.py$/;
  if (testFiles.some((f) => scriptTestPattern.test(f))) {
    const allowedArgs = testFiles.map((f) => `--allowed "${f.replace(/"/g, '\\"')}"`).join(" ");
    const cleanupCmd = `datum lane-cleanup "${wt}" ${allowedArgs}`;
    await agent(`Run: ${cleanupCmd}`, {
      label: `pre-red-cleanup:${taskId}`,
      phase: "Act",
      model: model("fast")
    });
    log(`[${taskId}] Pre-RED cleanup completed`);
  } else {
    log(`[${taskId}] Pre-RED cleanup skipped (lane has no JS/TS/Py test files)`);
  }
  log(`[${taskId}] RED: writing failing tests`);
  const skeletonCmd = `datum skeleton --task-id ${taskId} --language ${laneLanguage} --tasks ${cfg2.lanePlanPath} --output .datum/runs/${cfg2.runId}/preflight-${taskId}.json`;
  const preflightPath = `.datum/runs/${cfg2.runId}/preflight-${taskId}.json`;
  const planSkeletonPath = cfg2.skeletonDir ? `${cfg2.skeletonDir}/preflight-${taskId}.json` : "";
  let targetContext;
  let preflightRaw = null;
  if (planSkeletonPath) {
    preflightRaw = await agent(
      `Read the file: cat "${planSkeletonPath}" 2>/dev/null || echo ""
If the file exists, return ONLY its raw JSON contents.
If the file does not exist or is empty, return exactly: MISSING
No markdown fences, no explanation.`,
      { label: `skeleton-read:${taskId}`, phase: "Act", model: model("fast") }
    );
    if (preflightRaw && preflightRaw.trim() !== "MISSING") {
      log(`[${taskId}] using pre-generated skeleton from Plan phase`);
    } else {
      preflightRaw = null;
    }
  }
  if (!preflightRaw) {
    preflightRaw = await agent(
      `Run: ${skeletonCmd}
Then read the output file: cat "${wt}/${preflightPath}" 2>/dev/null || echo "{}"
Return ONLY the raw JSON contents of the file. No markdown fences, no explanation.`,
      { label: `preflight:${taskId}`, phase: "Act", model: model("fast") }
    );
  }
  let preflightFramework;
  let preflightTestPaths = [];
  if (preflightRaw) {
    const preflightData = parseAgentJson(preflightRaw, {});
    if (preflightData.target_context) {
      targetContext = preflightData.target_context;
      log(`[${taskId}] target_context extracted: ${Object.keys(targetContext).join(", ")}`);
    }
    preflightFramework = preflightData.framework;
    if (preflightData.outputs && preflightData.outputs.length > 0) {
      for (const output of preflightData.outputs) {
        if (output.path && !testFiles.includes(output.path)) {
          testFiles.push(output.path);
          preflightTestPaths.push(output.path);
        }
      }
      if (preflightTestPaths.length > 0) {
        log(`[${taskId}] preflight registered ${preflightTestPaths.length} test file(s): ${preflightTestPaths.join(", ")}`);
      }
      if (testFiles.length === 0) {
        return { task_id: taskId, status: "failed", stage: "RED", error: "no_test_files: classifyFiles produced empty testFiles and preflight has no registered test paths" };
      }
    }
  }
  if (testFiles.length === 0) {
    log(`[${taskId}] ERROR: classifyFiles produced empty testFiles \u2014 lane cannot proceed without a test file to write tests against`);
    return { task_id: taskId, status: "failed", stage: "RED", error: "no_test_files: classifyFiles returned empty testFiles for lane" };
  }
  const redExtras = targetContext ? { target_context: targetContext } : {};
  const redPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, laneCfg, "RED", redExtras);
  const redCtxCmd = laneCtxCmd(redPacket, wt);
  const testFuncLabel = laneLanguage === "swift" ? "@Test or func test" : laneLanguage === "go" ? "func Test" : laneLanguage === "typescript" || laneLanguage === "javascript" ? "it( or test( or describe(" : "def test_";
  const promptVars = {
    wt,
    skeletonCmd,
    redCtxCmd,
    redPacketStr: JSON.stringify(redPacket),
    testCommand: scopedTestCmd,
    testFilesList: testFiles.join(" "),
    commitPrefix: redPacket.commit_prefix,
    taskId,
    testFuncPattern: testFuncLabel
  };
  let red = null;
  if (redAlreadyCommitted) {
    log(`[${taskId}] RED commit already exists on lane branch \u2014 skipping RED dispatch, resuming from GREEN (#331)`);
    const existingRedCheck = await verifyCommitIndependently(taskId, wt, testFiles, redPacket.commit_prefix, "RED");
    red = {
      success: true,
      tests_pass: false,
      committed: true,
      commit_sha: existingRedCheck.commitSha,
      files_written: testFiles
    };
  } else {
    red = await resilientAgent(
      redPrompt(promptVars),
      { label: `red:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA, worktree: wt }
    );
    if (red?.success) {
      log(`[${taskId}] RED wrote: ${(red.files_written || []).join(", ")}`);
    }
    if (!red || !red.committed) {
      const check = await verifyCommitIndependently(taskId, wt, testFiles, redPacket.commit_prefix, "RED");
      if (check.committed) {
        log(`[${taskId}] RED: agent reported committed=false but independent check confirms a commit exists (${check.detail}) \u2014 treating as committed (#274)`);
        red = {
          success: true,
          tests_pass: false,
          committed: true,
          commit_sha: check.commitSha,
          files_written: red?.files_written || testFiles,
          failure_reason: red?.failure_reason
        };
      } else {
        log(`[${taskId}] RED: agent did not commit on first attempt \u2014 retrying (independent check: ${check.detail})`);
        red = await resilientAgent(
          redRetryPrompt({ ...promptVars, failureReason: "agent did not commit test files" }),
          { label: `red-retry:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA, worktree: wt }
        );
        if (!red || !red.committed) {
          const retryCheck = await verifyCommitIndependently(taskId, wt, testFiles, redPacket.commit_prefix, "RED");
          if (retryCheck.committed) {
            log(`[${taskId}] RED retry: agent reported committed=false but independent check confirms a commit exists (${retryCheck.detail}) \u2014 treating as committed (#274)`);
            red = {
              success: true,
              tests_pass: false,
              committed: true,
              commit_sha: retryCheck.commitSha,
              files_written: red?.files_written || testFiles,
              failure_reason: red?.failure_reason
            };
          } else {
            log(`[${taskId}] RED: agent did not commit after retry \u2014 failing (independent check: ${retryCheck.detail})`);
            return { task_id: taskId, status: "failed", stage: "RED", error: `RED agent did not commit after retry (independent check: ${retryCheck.detail})` };
          }
        }
      }
    }
    if (!red || !red.success) {
      log(`[${taskId}] RED attempt 1 failed: ${red?.failure_reason || "unknown"}, retrying`);
      red = await resilientAgent(
        redRetryPrompt({ ...promptVars, failureReason: red?.failure_reason || "unknown" }),
        { label: `red-retry:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA, worktree: wt }
      );
    }
  }
  if (!red || !red.success) {
    log(`[${taskId}] RED FAILED: ${red?.failure_reason || "no files written after 2 attempts"}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: red?.failure_reason || "RED failed" };
  }
  const acCount = (lane.acceptance_criteria || []).length;
  if (acCount > 0) {
    let newTestCount2 = 0;
    let gatePassed = false;
    const countRaw = await agent(
      `Run this EXACT sequence of two commands verbatim:
1. Write the pattern to a temp file (the quoted heredoc delimiter means the shell does no interpretation of its contents \u2014 copy the line between the markers exactly as-is):
PATFILE=$(mktemp)
cat > "$PATFILE" <<'PATTERN_EOF'
${testFuncDiffRegex}
PATTERN_EOF
2. Run the gate script against that file:
bash scripts/test-count-gate --repo "${wt}" --files ${testFiles.map((f) => `"${f}"`).join(" ")} --pattern-file "$PATFILE" --required ${acCount}
Return ONLY the raw stdout of the second command. Do not reformat, summarize, or add any text. No markdown fences, no explanation.`,
      {
        label: `test-count-check:${taskId}`,
        phase: "Act",
        model: model("fast")
      }
    );
    if (countRaw === null || countRaw === void 0) {
      log(`[${taskId}] RED FAILED: test-count-check agent returned null \u2014 cannot verify ${acCount} new test functions were committed`);
      return {
        task_id: taskId,
        status: "failed",
        stage: "RED",
        error: `count_gate_no_output: test-count-check agent returned null \u2014 cannot verify ${acCount} new test functions were committed`
      };
    } else if (typeof countRaw === "object") {
      const obj = countRaw;
      newTestCount2 = obj.new_test_count || 0;
      gatePassed = obj.passed !== void 0 ? Boolean(obj.passed) : newTestCount2 >= acCount;
    } else {
      const text = countRaw.trim();
      const match = text.match(/\{"new_test_count":\s*(\d+)/);
      if (match) {
        newTestCount2 = parseInt(match[1], 10);
        const passedMatch = text.match(/"passed":\s*(true|false)/);
        gatePassed = passedMatch ? passedMatch[1] === "true" : newTestCount2 >= acCount;
      } else {
        const digits = text.replace(/[^0-9]/g, "");
        newTestCount2 = digits ? parseInt(digits, 10) : 0;
        gatePassed = newTestCount2 >= acCount;
      }
    }
    if (!gatePassed) {
      log(`[${taskId}] RED FAILED: only ${newTestCount2} new test functions found, need >= ${acCount} (one per AC)`);
      return { task_id: taskId, status: "failed", stage: "RED", error: `no_new_test_functions_committed: found ${newTestCount2}, need >= ${acCount}` };
    }
    log(`[${taskId}] RED: ${newTestCount2} new test functions confirmed (>= ${acCount} ACs)`);
  }
  const sgPatterns = laneLanguage === "swift" ? [
    { pattern: "XCTFail", name: "XCTFail" },
    { pattern: "fatalError", name: "fatalError" }
  ] : laneLanguage === "go" ? [
    { pattern: 't.Fatal("not implemented")', name: "t.Fatal placeholder" },
    { pattern: 'panic("not implemented")', name: "panic placeholder" }
  ] : laneLanguage === "typescript" || laneLanguage === "javascript" ? [
    { pattern: "throw new Error", name: "throw placeholder" },
    { pattern: "expect(true).toBe(false)", name: "forced failure" }
  ] : [
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

Also check for pass-only test bodies. First write the pattern to a temp file (quoted heredoc delimiter means the shell does no interpretation \u2014 copy the line between the markers exactly as-is):
BODYPATFILE=$(mktemp)
cat > "$BODYPATFILE" <<'PATTERN_EOF'
${testFuncBodyRegex}
PATTERN_EOF
Then run:
${testFiles.map(
      (f) => `grep -A1 -f "$BODYPATFILE" "${wt}/${f}" 2>/dev/null | grep -B1 '^\\s*pass$' 2>/dev/null`
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
  await updateStage(issueId, "red", red.commit_sha);
  const redOwnership = await verifyFileOwnership2(taskId, wt, "RED", testFiles, implFiles);
  if (!redOwnership.ok) {
    log(`[${taskId}] RED FILE OWNERSHIP VIOLATION: ${redOwnership.violations.join(", ")}`);
    return { task_id: taskId, status: "failed", stage: "RED", error: `file_ownership_violation: ${redOwnership.violations.join(", ")}` };
  }
  const scopeTestContentsRaw = await agent(
    `Read the contents of these RED test file(s) in the worktree:
${testFiles.map((f) => `echo "===FILE:${f}==="; cat "${wt}/${f}" 2>/dev/null`).join("\n")}
Return ONLY a JSON object mapping each path (as given after "===FILE:") to its full text content, e.g. {"${testFiles[0] || "path"}": "contents..."}. No markdown fences, no explanation.`,
    { label: `scope-repair-read:${taskId}`, phase: "Act", model: model("fast") }
  );
  const scopeTestContents = parseAgentJson(scopeTestContentsRaw, {});
  const requiredScopeFiles = /* @__PURE__ */ new Set();
  for (const tf of testFiles) {
    const tContent = scopeTestContents[tf] || "";
    if (!tContent) continue;
    for (const rf of extractRequiredScopeFiles(tContent, tf, laneLanguage)) {
      requiredScopeFiles.add(rf);
    }
  }
  const scopeGaps = findScopeGaps([...requiredScopeFiles], [...testFiles, ...implFiles]);
  if (scopeGaps.length > 0) {
    const scopeExistsRaw = await agent(
      `For each of these paths, report whether it exists as a file in the repo at "${wt}":
${scopeGaps.map((f) => `test -f "${wt}/${f}" && echo "EXISTS ${f}" || echo "MISSING ${f}"`).join("\n")}
Return ONLY a JSON object: {"existing": ["path1", ...], "missing": ["path2", ...]}. No markdown fences, no explanation.`,
      { label: `scope-repair-check:${taskId}`, phase: "Act", model: model("fast") }
    );
    const scopeExistsParsed = parseAgentJson(scopeExistsRaw, {});
    const existingGaps = scopeExistsParsed.existing || [];
    const missingGaps = scopeExistsParsed.missing || [];
    for (const f of existingGaps) {
      if (!implFiles.includes(f)) {
        implFiles.push(f);
        log(`[${taskId}] scope-repair: auto-adding '${f}' to allowed_write_files \u2014 required by RED test import/assertion, was missing from lane.files`);
      }
    }
    if (missingGaps.length > 0) {
      const msg = `lane ${taskId}: RED test requires ${missingGaps.join(", ")} but allowed_write_files does not include it (and the file does not exist in the repo, so it cannot be safely auto-added)`;
      log(`[${taskId}] SCOPE GAP (fail-loud): ${msg}`);
      return { task_id: taskId, status: "failed", stage: "RED", error: `scope_gap: ${msg}` };
    }
  }
  const rawCounts = await agent(
    `Count test functions in these files. First write the pattern to a temp file (quoted heredoc delimiter means the shell does no interpretation \u2014 copy the line between the markers exactly as-is):
GREPPATFILE=$(mktemp)
cat > "$GREPPATFILE" <<'PATTERN_EOF'
${testFuncGrepRegex}
PATTERN_EOF
Then run:
After-counts (current worktree):
${testFiles.map((f) => `grep -c -E -f "$GREPPATFILE" "${wt}/${f}" 2>/dev/null || echo 0`).join("\n")}
Before-counts (parent commit \u2014 0 for first commit):
${testFiles.map((f) => `git -C "${wt}" rev-parse HEAD~1 >/dev/null 2>&1 && git -C "${wt}" show HEAD~1:"${f}" 2>/dev/null | grep -c -E -f "$GREPPATFILE" || echo 0`).join("\n")}
Output ONLY raw numbers, one per line: after-counts first, then before-counts. No other text.`,
    {
      label: `test-count:${taskId}`,
      phase: "Act",
      model: model("fast")
    }
  );
  let afterCount = 0;
  let beforeCount = 0;
  const numbers = String(rawCounts).replace(/[^0-9\n]/g, "").trim().split("\n").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  if (numbers.length >= 2) {
    afterCount = numbers.slice(0, numbers.length / 2).reduce((a2, b) => a2 + b, 0);
    beforeCount = numbers.slice(numbers.length / 2).reduce((a2, b) => a2 + b, 0);
  }
  const newTestCount = afterCount - beforeCount;
  if (newTestCount <= 0) {
    log(`[${taskId}] RED FAILED: no new test functions written (before=${beforeCount}, after=${afterCount})`);
    return { task_id: taskId, status: "failed", stage: "RED", error: "no_new_tests_written: RED agent did not append any test functions" };
  }
  log(`[${taskId}] RED: ${newTestCount} new test functions verified (${beforeCount} \u2192 ${afterCount})`);
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
  const greenPacket = buildPacket(taskId, testFiles, implFiles, lane, wt, scopedLaneCfg, "GREEN", greenExtras);
  const greenCtxCmd = laneCtxCmd(greenPacket, wt);
  const greenVars = {
    wt,
    greenCtxCmd,
    greenPacketStr: JSON.stringify(greenPacket),
    testCommand: scopedTestCmd,
    implFilesList: implFiles.join(" "),
    commitPrefix: greenPacket.commit_prefix
  };
  let green = await resilientAgent(
    greenPrompt(greenVars),
    { label: `green:${taskId}`, phase: "Act", model: greenModel, schema: STAGE_RESULT_SCHEMA, worktree: wt }
  );
  if (green?.success) {
    log(`[${taskId}] GREEN wrote: ${(green.files_written || []).join(", ")}`);
  }
  if (!green || !green.success || !green.tests_pass) {
    log(`[${taskId}] GREEN attempt 1 failed (${greenModel}): ${green?.failure_reason || "unknown"}, escalating to opus`);
    green = await resilientAgent(
      greenRetryPrompt({
        ...greenVars,
        failureReason: green?.failure_reason || "unknown",
        greenRetryPacketStr: JSON.stringify({ ...greenPacket, retry_hint: green?.failure_reason })
      }),
      { label: `green-retry:${taskId}`, phase: "Act", model: model("deep"), schema: STAGE_RESULT_SCHEMA, worktree: wt }
    );
  }
  if (!green || !green.success || !green.tests_pass) {
    const reason = !green ? "GREEN agent call returned no result after retries (subagent crashed, was skipped, or exhausted rate-limit backoff) \u2014 check the subagent transcript for this run to recover the actual failure cause" : green.failure_reason || `GREEN failed with no failure_reason reported (success=${green.success}, tests_pass=${green.tests_pass}, exit_code=${green.test_exit_code ?? "n/a"})`;
    log(`[${taskId}] GREEN FAILED: ${reason}`);
    return { task_id: taskId, status: "failed", stage: "GREEN", error: reason };
  }
  if (!green.committed) {
    const check = await verifyCommitIndependently(taskId, wt, implFiles, greenPacket.commit_prefix, "GREEN");
    if (check.committed) {
      log(`[${taskId}] GREEN: agent reported committed=false but independent check confirms a commit exists (${check.detail}) \u2014 treating as committed (#274)`);
      green = { ...green, committed: true, commit_sha: check.commitSha || green.commit_sha };
    } else if (green.tests_pass && check.clean === true) {
      log(`[${taskId}] GREEN: no implementation change needed \u2014 tests pass and worktree is clean (${check.detail}); accepting no-op GREEN with RED commit as deliverable`);
      green = { ...green, committed: true, commit_sha: red.commit_sha };
    } else {
      log(`[${taskId}] GREEN: agent did not commit \u2014 failing (independent check: ${check.detail})`);
      return { task_id: taskId, status: "failed", stage: "GREEN", error: `GREEN agent did not commit (independent check: ${check.detail})` };
    }
  }
  const greenOwnership = await verifyFileOwnership2(taskId, wt, "GREEN", implFiles, testFiles);
  if (!greenOwnership.ok) {
    log(`[${taskId}] GREEN FILE OWNERSHIP VIOLATION: ${greenOwnership.violations.join(", ")}`);
    return { task_id: taskId, status: "failed", stage: "GREEN", error: `file_ownership_violation: ${greenOwnership.violations.join(", ")}` };
  }
  log(`[${taskId}] GREEN verified \u2014 all tests pass (committed: ${green.commit_sha || "n/a"})`);
  await updateStage(issueId, "green", green.commit_sha);
  const base = skepticBasePrompt({
    wt,
    implFiles: implFiles.join(", "),
    testFiles: testFiles.join(", "),
    testCommand: scopedTestCmd,
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
  const refResult = await runRefactor(taskId, lane, testFiles, implFiles, wt, scopedLaneCfg);
  if (!refResult) {
    return { task_id: taskId, status: "failed", stage: "REFACTOR", error: "refactor failed" };
  }
  log(`[${taskId}] === LANE COMPLETE ===`);
  await updateStage(issueId, "done");
  await writeCompletion();
  return { task_id: taskId, status: "completed", stage: "REFACTOR" };
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
  const refactor = await resilientAgent(
    refactorPrompt({
      wt,
      refactorCtxCmd,
      refactorPacketStr: JSON.stringify(refactorPacket),
      testCommand: cfg2.testCommand,
      allFilesList: [...testFiles, ...implFiles].join(" "),
      commitPrefix: refactorPacket.commit_prefix
    }),
    { label: `refactor:${taskId}`, phase: "Act", model: model("balanced"), schema: STAGE_RESULT_SCHEMA, worktree: wt }
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
var { batchLaneIds, lanePlan, worktreePaths, cfg, priorFailures, priorCompleted, batchTag } = a;
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
    const crossBatchDeps = allDeps.filter((d) => !batchLaneIds.includes(d));
    const crossBatchFailed = crossBatchDeps.filter((d) => priorFailures.includes(d));
    const crossBatchMissing = crossBatchDeps.filter(
      (d) => !priorFailures.includes(d) && !(priorCompleted || []).includes(d)
    );
    if (crossBatchFailed.length > 0 || crossBatchMissing.length > 0) {
      const failedPart = crossBatchFailed.length > 0 ? `failed [${crossBatchFailed.join(", ")}]` : "";
      const missingPart = crossBatchMissing.length > 0 ? `never executed [${crossBatchMissing.join(", ")}]` : "";
      const err = `blocked: cross-batch dep(s) ${[failedPart, missingPart].filter(Boolean).join(", ")}`;
      log(`[${taskId}] ${err}`);
      const skipResult = { task_id: taskId, status: "blocked", stage: "SKIPPED", error: err };
      depResolvers[taskId](skipResult);
      return skipResult;
    }
    const inBatchDeps = allDeps.filter((d) => batchLaneIds.includes(d));
    if (inBatchDeps.length > 0) {
      log(`[${taskId}] waiting on deps: [${inBatchDeps.join(", ")}]`);
      const depResults = await Promise.all(inBatchDeps.map((d) => depPromises[d]));
      const failedDeps = depResults.filter((r) => r.status !== "completed");
      if (failedDeps.length > 0) {
        const err = `blocked: dep(s) failed [${failedDeps.map((r) => r.task_id).join(", ")}]`;
        log(`[${taskId}] ${err}`);
        const skipResult = { task_id: taskId, status: "blocked", stage: "SKIPPED", error: err };
        depResolvers[taskId](skipResult);
        return skipResult;
      }
      const wt = worktreePaths[taskId];
      if (typeof wt === "string" && wt.startsWith("/")) {
        const depBranches = inBatchDeps.map((d) => `${cfg.epicBranch}--${d}`);
        const mergeOut = await resilientAgent(
          `Run these commands in order in "${wt}". If any command fails, stop and return its full output including stderr. Otherwise return ONLY the raw combined output, no explanation, no markdown fences.
` + depBranches.map((b) => `git -C "${wt}" merge --no-edit "${b}"`).join("\n"),
          { label: `dep-merge:${taskId}`, model: "haiku" }
        );
        if (mergeOut === null || /CONFLICT|Automatic merge failed|error:|fatal:/i.test(String(mergeOut))) {
          const err = `dep_merge_failed: could not merge [${depBranches.join(", ")}] into ${taskId} worktree \u2014 ${String(mergeOut).slice(0, 300)}`;
          log(`[${taskId}] ${err}`);
          const failResult = { task_id: taskId, status: "failed", stage: "CRASH", error: err };
          depResolvers[taskId](failResult);
          return failResult;
        }
        log(`[${taskId}] merged in-batch dep branches: [${depBranches.join(", ")}]`);
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
