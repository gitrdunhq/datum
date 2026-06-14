// datum-tdd-act-docs.js — Docs phase: sync documentation with code changes.

export const meta = {
  name: 'datum-tdd-act-docs',
  description: 'Haiku pre-check + conditional sonnet docs sync with git commit',
  phases: [{ title: 'Docs' }],
}

const WRITE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    files_written: { type: 'array', items: { type: 'string' } },
    success: { type: 'boolean' },
    failure_reason: { type: 'string' },
  },
  required: ['success'],
}

const COMMIT_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    committed: { type: 'boolean' },
    commit_sha: { type: 'string' },
    files_staged: { type: 'array', items: { type: 'string' } },
    violations: { type: 'array', items: { type: 'string' } },
    failure_reason: { type: 'string' },
  },
  required: ['committed'],
}

const REFACTOR_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    should_refactor: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['should_refactor'],
}

async function commitDocs(wt, commitPrefix, allowedFiles) {
  const allowedList = allowedFiles.join(', ')
  const basePrompt =
    `You are a GIT COMMIT agent. You ONLY handle git operations — never edit source files.\n` +
    `Working directory: "${wt}" — cd into it FIRST.\n\n` +
    `TASK:\n` +
    `1. Run: git -C "${wt}" status --porcelain\n` +
    `2. Verify ONLY these files were modified: ${allowedList}\n` +
    `3. If files outside that list were changed, report them as violations and do NOT commit\n` +
    `4. Stage the allowed files: git -C "${wt}" add <files>\n` +
    `5. Commit: git -C "${wt}" commit -m "${commitPrefix}: DOCS complete"\n` +
    `6. Return the commit SHA from: git -C "${wt}" rev-parse --short HEAD\n\n` +
    `RULES:\n` +
    `- NEVER edit, create, or delete source files — only git operations\n` +
    `- If there are no changes to commit, return committed=false\n` +
    `- Use git -C "${wt}" for ALL git commands to enforce directory`

  let result = await agent(basePrompt,
    { label: 'git-docs', phase: 'Docs', model: 'haiku', schema: COMMIT_RESULT_SCHEMA }
  )

  if (!result || (!result.committed && result.failure_reason)) {
    log(`[docs] GIT: haiku failed (${(result && result.failure_reason) || 'null'}), escalating to sonnet`)
    result = await agent(
      basePrompt + `\n\nRETRY CONTEXT: Previous commit attempt failed: ${(result && result.failure_reason) || 'null result'}.\n` +
      `Diagnose the git state and fix any issues, then commit.`,
      { label: 'git-docs-fix', phase: 'Docs', model: 'sonnet', schema: COMMIT_RESULT_SCHEMA }
    )
  }

  if (result && result.committed) {
    log(`[docs] GIT committed: ${result.commit_sha || '(no sha)'}`)
  } else {
    log(`[docs] GIT FAILED: ${(result && result.failure_reason) || 'no commit after escalation'}`)
  }
  return result
}

const a = args
phase('Docs')

if (a.completedLanes.length === 0) {
  log('No completed lanes — skipping docs')
  return { synced: false }
}

const changedFiles = [...new Set(a.completedLanes.flatMap(id => a.lanePlan.lanes[id].files || []))]

const docsCheck = await agent(
  `You are a DOCS RELEVANCE checker. Evaluate only — do NOT write or modify files.\n` +
  `Grep for references to these symbols/files in doc files (*.md, not CHANGELOG): ${changedFiles.join(', ')}\n` +
  `Also check if any new public functions/classes were added that have zero docs.\n` +
  `Return should_refactor (boolean) and reason (string).`,
  { label: 'docs-check', phase: 'Docs', model: 'haiku', schema: REFACTOR_CHECK_SCHEMA }
)

if (!docsCheck || !docsCheck.should_refactor) {
  log('Docs: no stale references found, skipping')
  return { synced: false }
}

const docsPacket = JSON.stringify({
  schema_version: '1.0',
  changed_files: changedFiles,
  new_symbols: a.completedLanes.map(id => ({
    task_id: id,
    title: a.lanePlan.lanes[id].title,
    files: a.lanePlan.lanes[id].files,
  })),
  working_directory: '.',
})

const docs = await agent(
  `You are a documentation sync agent. Write updated doc files — do NOT run any git commands.\n` +
  `1. UPDATE: fix any existing docs that reference changed code incorrectly\n` +
  `2. NEW: if new public APIs were added that have zero documentation, add a section in the appropriate existing doc file\n\n` +
  `TASK PACKET: ${docsPacket}\n\n` +
  `RULES: CLI refs say "datum <cmd>" not "uv run". Do NOT create new doc files. Do NOT touch CHANGELOG. Keep it concise.`,
  { label: 'docs-sync', phase: 'Docs', model: 'sonnet', schema: WRITE_RESULT_SCHEMA }
)

if (docs && docs.success) {
  const docFiles = changedFiles.filter(f => f.endsWith('.md'))
  const docsWritten = docs.files_written || docFiles
  await commitDocs('.', `docs(${a.runId})`, docsWritten)
  log(`Docs synced: ${docsWritten.join(', ')}`)
  return { synced: true, files: docsWritten }
}

log(`Docs: ${(docs && docs.failure_reason) || 'nothing to update'}`)
return { synced: false }
