// @generated — DO NOT EDIT. Source: skills/src/datum-tdd-act-docs.ts
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

// skills/src/shared/utils.ts
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

// skills/src/prompts/docs-check.md
var docs_check_default = "DOCS RELEVANCE checker. Evaluate whether documentation needs updating \u2014 do NOT write or modify files.\n\nSearch for references to these symbols in doc files (*.md, excluding CHANGELOG.md):\n{{changedFiles}}\n\nAlso check: did this task add new public functions or classes with zero documentation?\n\nReturn should_refactor=true only if:\n- An existing doc references a symbol that changed (stale doc)\n- A new public API has zero documentation anywhere\n\nReturn should_refactor=false if all docs are current or no docs reference the changed code.\n";

// skills/src/prompts/docs-sync.md
var docs_sync_default = 'Documentation sync agent. Update existing doc files to reflect code changes.\nWrite updated files \u2014 do NOT run any git commands.\n\nRULES (non-negotiable):\n- Do NOT create new doc files \u2014 only edit existing ones\n- Do NOT touch CHANGELOG.md\n- CLI references use "datum <cmd>", never "uv run" or "python3 scripts/"\n\nTASK PACKET: {{docsPacket}}\n\nACTIONS:\n1. Fix any existing docs that reference changed code incorrectly\n2. If new public APIs were added with zero docs, add a section in the nearest relevant existing doc file\n3. Keep additions concise \u2014 one paragraph per new API, with a usage example\n';

// skills/src/shared/prompts.ts
function docsCheckPrompt(vars) {
  return renderPrompt(docs_check_default, vars);
}
function docsSyncPrompt(vars) {
  return renderPrompt(docs_sync_default, vars);
}

// skills/src/datum-tdd-act-docs.ts
export const meta = {
  name: "datum-tdd-act-docs",
  description: "Haiku pre-check + conditional sonnet docs sync with git commit",
  phases: [{ title: "Docs" }]
};
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
    { label: "docs-check", phase: "Docs", model: "haiku", schema: REFACTOR_CHECK_SCHEMA }
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
      { label: "docs-sync", phase: "Docs", model: "sonnet", schema: WRITE_RESULT_SCHEMA }
    );
    if (docs?.success) {
      const docFiles = changedFiles.filter((f) => f.endsWith(".md"));
      const docsWritten = docs.files_written || docFiles;
      await commitStage("docs", ".", `docs(${a.runId})`, docsWritten, "DOCS");
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
