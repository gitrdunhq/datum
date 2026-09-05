import { model } from './shared/models'
import type { DocsArgs, WriteResult } from './shared/types'
import { WRITE_RESULT_SCHEMA, COMMIT_RESULT_SCHEMA, REFACTOR_CHECK_SCHEMA } from './shared/schemas'
import { commitStage } from './shared/agents'
import { docsCheckPrompt, docsSyncPrompt } from './shared/prompts'
import { stageOpts, configureAgentTypes } from './shared/agent-types'

export const meta = {
  name: 'datum-tdd-act-docs',
  description: 'Haiku pre-check + conditional sonnet docs sync with git commit',
  phases: [{ title: 'Docs' }],
}

const a = args as DocsArgs
configureAgentTypes(a.agentTypes || {})
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
        // Root checkout: commit only the docs files, ignore the operator's
        // unrelated WIP (allowed-only scope). The outcome is surfaced, not
        // assumed — a refused commit used to be reported as "synced".
        const commit = await commitStage('docs', '.', `docs(${a.runId})`, docsWritten, 'DOCS', { scope: 'allowed-only' })
        committed = !!commit?.committed
        commitSha = commit?.commit_sha
        if (committed) {
          log(`Docs synced and committed (${commitSha || 'no sha'}): ${docsWritten.join(', ')}`)
          synced = true
          syncedFiles = docsWritten
        } else {
          failureReason = commit?.failure_reason || (commit?.violations?.length ? `violations: ${commit.violations.join(', ')}` : 'commit agent returned no result')
          log(`Docs written but NOT committed — ${failureReason}. Files left modified in the checkout: ${docsWritten.join(', ')}`)
          syncedFiles = docsWritten
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
