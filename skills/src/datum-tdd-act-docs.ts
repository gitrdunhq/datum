import { model } from './shared/models'
import type { DocsArgs, WriteResult } from './shared/types'
import { WRITE_RESULT_SCHEMA, REFACTOR_CHECK_SCHEMA } from './shared/schemas'
import { batchCommandPrompt, setBatchCacheKey, parseBatchResult } from './shared/batch'
import { commitFilesSteps, commitFilesFromSteps } from './shared/commit-steps'
import { docsCheckPrompt, docsSyncPrompt } from './shared/prompts'
import { stageOpts, configureAgentTypes } from './shared/agent-types'

export const meta = {
  name: 'datum-tdd-act-docs',
  description: 'Haiku pre-check + conditional sonnet docs sync with git commit',
  phases: [{ title: 'Docs' }],
}

const a = args as DocsArgs
configureAgentTypes(a.agentTypes || {})
setBatchCacheKey(a.configFingerprint || '')
phase('Docs')

let synced = false
let syncedFiles: string[] | undefined
let committed: boolean | undefined
let commitSha: string | undefined
let failureReason: string | undefined

if (a.completedLanes.length === 0) {
  log('No completed lanes — skipping docs')
} else {
  const changedFiles = [...new Set(a.completedLanes.flatMap(id => a.lanePlan.lanes[id].files || []))]

  const docsCheck = await agent(
    docsCheckPrompt({ changedFiles: changedFiles.join(', ') }),
    { label: 'docs-check', phase: 'Docs', model: model('fast'), schema: REFACTOR_CHECK_SCHEMA }
  )

  if (docsCheck?.should_refactor) {
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
      docsSyncPrompt({ docsPacket }),
      stageOpts('docs', { label: 'docs-sync', phase: 'Docs', model: model('balanced'), schema: WRITE_RESULT_SCHEMA })
    ) as WriteResult | null

    if (docs?.success) {
      const docsWritten = docs.files_written || []
      if (docsWritten.length === 0) {
        log('Docs: agent reported success but no files_written — skipping commit')
        failureReason = 'docs agent reported success but wrote no files'
      } else {
        // Root checkout: stage and commit ONLY the docs files (the operator's
        // unrelated WIP stays untouched), as one deterministic batch with the
        // exact message — no commit agent, no trailers, and the outcome is the
        // exit code. "Nothing to commit" is a rerun after a landed commit.
        const commitStepList = commitFilesSteps({ wt: '.', files: docsWritten, message: `docs(${a.runId}): sync docs for merged lanes` })
        const commit = commitFilesFromSteps(parseBatchResult(
          await agent(batchCommandPrompt(commitStepList), stageOpts('cli', { label: 'docs-commit', phase: 'Docs', model: model('fast') })),
          commitStepList,
        ))
        committed = commit.committed || commit.nothingToCommit
        commitSha = commit.sha || ''
        syncedFiles = docsWritten
        if (committed) {
          log(commit.nothingToCommit
            ? `Docs already committed (nothing to commit): ${docsWritten.join(', ')}`
            : `Docs synced and committed (${commitSha}): ${docsWritten.join(', ')}`)
          synced = true
        } else {
          failureReason = commit.error || 'commit_failed: unknown'
          log(`Docs written but NOT committed — ${failureReason}. Files left modified in the checkout: ${docsWritten.join(', ')}`)
        }
      }
    } else {
      log(`Docs: ${docs?.failure_reason || 'nothing to update'}`)
    }
  } else {
    log('Docs: no stale references found, skipping')
  }
}

export const __workflowResult = { synced, files: syncedFiles, committed, commit_sha: commitSha, failure_reason: failureReason }
