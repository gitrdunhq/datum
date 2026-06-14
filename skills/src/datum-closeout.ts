import { renderPrompt } from './shared/utils'
import closeoutSynthTemplate from './prompts/closeout-synthesize.md'
import readContextTemplate from './prompts/util-read-context.md'

export const meta = {
  name: 'datum-closeout',
  description: 'Post-merge closeout — collect data, synthesize artifacts, archive',
  phases: [
    { title: 'Collect', detail: 'run datum closeout collectors (scripts, no LLM)' },
    { title: 'Synthesize', detail: 'produce CURRENT_STATE, CHANGELOG, RETRO, follow-ups' },
    { title: 'Archive', detail: 'commit, tag, reindex, archive state' },
  ],
}

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = (typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})
const runId: string = a.runId || ''

// ── Collect ──

phase('Collect')

const context = await agent(
  renderPrompt(readContextTemplate, {
    extraFields: `3. "merge_sha": output of \`git rev-parse HEAD\`
4. "base_sha": output of \`git merge-base HEAD origin/main\`
5. "run_id": "${runId}" if non-empty, else generate from \`date +%Y%m%d-%H%M%S\`
6. "closeout_data_exists": whether .datum/runs/<run_id>/closeout-data.json exists`,
  }),
  { label: 'read-context', model: 'haiku' },
)

const ctx = typeof context === 'string'
  ? JSON.parse(context.replace(/```[a-z]*\n?/g, '').trim())
  : context

const rid: string = ctx.run_id || runId
log(`Branch: ${ctx.branch}, run: ${rid}`)

if (!ctx.closeout_data_exists) {
  await agent(
    `Run these commands (scripts, not LLM work). Skip any that fail with "command not found":
mkdir -p .datum/runs/${rid}
datum closeout-collect-git --run-id ${rid} --base-sha ${ctx.base_sha} --merge-sha ${ctx.merge_sha} 2>/dev/null || echo "skip: closeout-collect-git"
datum closeout-collect-tasks --run-id ${rid} 2>/dev/null || echo "skip: closeout-collect-tasks"
datum closeout-collect-token-metrics --run-id ${rid} 2>/dev/null || echo "skip: closeout-collect-token-metrics"
datum closeout-collate --run-id ${rid} --merge-sha ${ctx.merge_sha} 2>/dev/null || echo "skip: closeout-collate"
Return JSON: {"collected": true}
Output raw JSON only.`,
    { label: 'run-collectors', model: 'haiku' },
  )
  log('Collectors complete')
} else {
  log('closeout-data.json already exists — skipping collectors')
}

// ── Synthesize ──

phase('Synthesize')

const synthResult = await agent(
  renderPrompt(closeoutSynthTemplate, {
    closeoutDataPath: `.datum/runs/${rid}/closeout-data.json`,
    branch: ctx.branch,
    runId: rid,
  }),
  { label: 'synthesize', model: 'sonnet' },
)

const synth = typeof synthResult === 'string'
  ? JSON.parse(synthResult.replace(/```[a-z]*\n?/g, '').trim())
  : synthResult

log(`Synthesis: ${(synth?.artifacts_written || []).join(', ')}`)

// ── Archive ──

phase('Archive')

await agent(
  `Run these commands. Skip any that fail:
datum closeout-tag 2>/dev/null || git tag "epic/${ctx.branch}/${rid}" HEAD 2>/dev/null || echo "skip: tag"
datum closeout-archive --run-id ${rid} 2>/dev/null || echo "skip: archive"
Return JSON: {"archived": true}
Output raw JSON only.`,
  { label: 'archive', model: 'haiku' },
)

log('Closeout complete')

export const __workflowResult = {
  branch: ctx.branch,
  runId: rid,
  artifacts: synth?.artifacts_written || [],
  followUps: synth?.follow_up_count || 0,
}
