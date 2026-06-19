// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-docs.ts
export const meta = {
  name: "datum-tdd-act-docs",
  description: "Haiku pre-check + conditional sonnet docs sync with git commit",
  phases: [{ title: "Docs" }]
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
var REFACTOR_CHECK_SCHEMA = {
  type: "object",
  properties: {
    should_refactor: { type: "boolean" },
    reason: { type: "string" }
  },
  required: ["should_refactor"]
};

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
    model: model("fast"),
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
        model: model("balanced"),
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

// skills/src/prompts/agent-preamble.md
var agent_preamble_default = '# The Record Suite\n\n> Local-first macOS meeting recorder \u2014 Swift 6.2 strict concurrency, 4-layer Clean Architecture, TDD mandatory\n\n## Architecture\n- Layer order (import direction only): Domain \u2192 Business \u2192 Infrastructure \u2192 Presentation\n- Domain: Foundation only, 100 lines max\n- Business: Domain + Foundation + OSLog, 300 lines max \u2014 pure transformations, no side effects\n- Infrastructure: Domain + any framework, 300 lines max \u2014 all side effects live here\n- Presentation: Domain + Business + SwiftUI, ViewModels 200 lines, Views 150 lines\n- Presentation NEVER imports Infrastructure; Business NEVER imports Infrastructure\n- All shared mutable state in actors; @MainActor on all Presentation types\n- Protocol seams between every layer\n\n## Coding Rules\n- No invented APIs: confirm every symbol exists before calling it\n- Minimal diffs: only change what the current task requires\n- No @unchecked Sendable except Infrastructure/Audio/ and Domain/Audio/AudioBuffer.swift\n- No nonisolated(unsafe) static let for DateFormatter \u2014 use stateless FormatStyle\n- No inline non-Swift content: extract SQL \u2192 *SQL.swift, prompts \u2192 *Prompts.swift, regex \u2192 *Patterns.swift, etc.\n- Trivial single-value strings under 80 chars non-reusable may stay inline\n- Never setenv() \u2014 inject configuration instead\n- Never try? on Task.sleep in Task loop bodies \u2014 let CancellationError propagate\n- After fixing any try? that swallows errors, grep the file and fix all siblings in same commit\n- SpeakerID sentinel strings must be public static let on SpeakerID.swift, never inline\n- C library init must guard the optional and log error; never silently proceed with nil\n- Never hardcode canonical values \u2014 reference UITheme.default, PrivacyMode.default, etc.\n- DuckDB writes use INSERT OR IGNORE; buffers cleared only on success\n- No network egress \u2014 local-first only\n- OSLog with explicit privacy labels on every interpolation; never log user content at .public\n- Typed error enums per domain; never raw Error at domain boundaries; never swallowed silently\n- State represented as enums; transitions guarded and explicit\n- Every external call needs explicit timeout + capped-backoff retry\n- All mutations idempotent\n- Open a GitHub issue for any out-of-scope bug >= severity 4\n- Keep at least one task active in TaskList during a coding session\n\n## TDD Rules\n- Write failing test first (RED), confirm failure, then implement (GREEN) \u2014 no post-hoc tests\n- Tests must verify specific business outcomes; deleting the function body must break the test\n- No hardcoded return values to pass tests\n- Always test negative paths: invalid input, retry exhaustion, timeouts, state violations\n\n## Test Conventions\n- Framework: Swift Testing (import Testing)\n- Suite naming: @Suite("TypeName") struct TypeNameTests\n- Test naming: @Test("verb scenario in plain English") func verbScenario()\n- Assertions: #expect(value == expected); #require for non-optional unwrapping\n- Mock types live in TestMocks shared library (MockSpeakerProfileStore, MockVoiceEmbeddingEngine, etc.)\n- Inline helper funcs at top of test file for data fabrication\n- Test locations: Record-App/Tests/Unit/{Domain,Business,Infrastructure,Presentation}/\n- Sub-packages: cd into Record-Audio or Record-ML to run their tests (swift test --filter from root only reaches Record-App targets)\n\n## File Conventions\n- PascalCase types and files; camelCase properties/methods\n- Test files: TypeNameTests.swift\n- 500 lines absolute ceiling; layer-specific limits are stricter\n- Git commit format: Epic {N}: [{Layer}] {Description} \u2014 no AI attribution\n- Squash before first push; additive commits only after PR opens; never force-push main\n\n## Full Context\n- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and anti-patterns\n';

// skills/src/prompts/docs-check.md
var docs_check_default = "DOCS RELEVANCE checker. Evaluate whether documentation needs updating \u2014 do NOT write or modify files.\n\nSearch for references to these symbols in doc files (*.md, excluding CHANGELOG.md):\n{{changedFiles}}\n\nAlso check: did this task add new public functions or classes with zero documentation?\n\nReturn should_refactor=true only if:\n- An existing doc references a symbol that changed (stale doc)\n- A new public API has zero documentation anywhere\n\nReturn should_refactor=false if all docs are current or no docs reference the changed code.\n";

// skills/src/prompts/docs-sync.md
var docs_sync_default = 'Documentation sync agent. Update existing doc files to reflect code changes.\nWrite updated files \u2014 do NOT run any git commands.\n\nRULES (non-negotiable):\n- Do NOT create new doc files \u2014 only edit existing ones\n- Do NOT touch CHANGELOG.md\n- CLI references use "datum <cmd>", never "uv run" or "python3 scripts/"\n\nTASK PACKET: {{docsPacket}}\n\nACTIONS:\n1. Fix any existing docs that reference changed code incorrectly\n2. If new public APIs were added with zero docs, add a section in the nearest relevant existing doc file\n3. Keep additions concise \u2014 one paragraph per new API, with a usage example\n';

// skills/src/shared/utils.ts
function renderPrompt(template, vars) {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
}

// skills/src/shared/prompts.ts
var PREAMBLE = agent_preamble_default + "\n\n---\n\n";
function docsCheckPrompt(vars) {
  return PREAMBLE + renderPrompt(docs_check_default, vars);
}
function docsSyncPrompt(vars) {
  return PREAMBLE + renderPrompt(docs_sync_default, vars);
}

// skills/src/datum-tdd-act-docs.ts
var a = args;
phase("Docs");
var synced = false;
var syncedFiles;
if (a.completedLanes.length === 0) {
  log("No completed lanes \u2014 skipping docs");
} else {
  const changedFiles = [...new Set(a.completedLanes.flatMap((id) => a.lanePlan.lanes[id].files || []))];
  const docsCheck = await agent(
    docsCheckPrompt({ changedFiles: changedFiles.join(", ") }),
    { label: "docs-check", phase: "Docs", model: model("fast"), schema: REFACTOR_CHECK_SCHEMA }
  );
  if (docsCheck?.should_refactor) {
    const docsPacket = JSON.stringify({
      schema_version: "1.0",
      changed_files: changedFiles,
      new_symbols: a.completedLanes.map((id) => ({
        task_id: id,
        title: a.lanePlan.lanes[id].title,
        files: a.lanePlan.lanes[id].files
      })),
      working_directory: "."
    });
    const docs = await agent(
      docsSyncPrompt({ docsPacket }),
      { label: "docs-sync", phase: "Docs", model: model("balanced"), schema: WRITE_RESULT_SCHEMA }
    );
    if (docs?.success) {
      const docsWritten = docs.files_written || [];
      if (docsWritten.length === 0) {
        log("Docs: agent reported success but no files_written \u2014 skipping commit");
      } else {
        await commitStage("docs", ".", `docs(${a.runId})`, docsWritten, "DOCS");
      }
      log(`Docs synced: ${docsWritten.join(", ")}`);
      synced = true;
      syncedFiles = docsWritten;
    } else {
      log(`Docs: ${docs?.failure_reason || "nothing to update"}`);
    }
  } else {
    log("Docs: no stale references found, skipping");
  }
}
return { synced, files: syncedFiles };
