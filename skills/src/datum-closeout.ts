import { renderPrompt, parseAgentJson } from './shared/utils'
import { model } from './shared/models'
import closeoutSynthTemplate from './prompts/closeout-synthesize.md'
import readContextTemplate from './prompts/util-read-context.md'

export const meta = {
  name: 'datum-closeout',
  description: 'Post-merge closeout — collect data, synthesize artifacts, archive',
  phases: [
    { title: 'Collect', detail: 'run collectors + read context' },
    { title: 'Synthesize', detail: 'CURRENT_STATE, CHANGELOG, RETRO, follow-ups, tag, archive' },
  ],
}

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = (typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})
const runId: string = a.runId || ''

// ── Collect (collapsed: read-context + run-collectors into one agent) ──

phase('Collect')

const collectResult = await agent(
  renderPrompt(readContextTemplate, {
    extraFields: `3. "merge_sha": output of \`git rev-parse HEAD\`
4. "base_sha": output of \`git merge-base HEAD origin/main\`
5. "run_id": "${runId}" if non-empty, else generate from \`date +%Y%m%d-%H%M%S\`
6. "closeout_data_exists": whether .datum/runs/<run_id>/closeout-data.json exists

ADDITIONAL: If closeout_data_exists is false, also run these collectors (skip failures):
mkdir -p .datum/runs/<run_id>
datum closeout-collect-git --run-id <run_id> --base-sha <base_sha> --merge-sha <merge_sha> 2>/dev/null || true
datum closeout-collect-tasks --run-id <run_id> 2>/dev/null || true
datum closeout-collect-token-metrics --run-id <run_id> 2>/dev/null || true
datum closeout-collate --run-id <run_id> --merge-sha <merge_sha> 2>/dev/null || true
Include "collected": true in the response if you ran collectors.`,
  }),
  { label: 'collect', model: model('fast') },
)

const ctx = typeof collectResult === 'string'
  ? parseAgentJson(collectResult as string, {} as Record<string, unknown>)
  : collectResult

const rid: string = ctx.run_id || runId
log(`Branch: ${ctx.branch}, run: ${rid}`)

// ── Synthesize + archive (collapsed into one agent) ──

phase('Synthesize')

const synthResult = await agent(
  renderPrompt(closeoutSynthTemplate, { closeoutDataPath: `.datum/runs/${rid}/closeout-data.json`, branch: ctx.branch, runId: rid })
  + `\n\nAFTER writing artifacts, also:
1. Tag: git tag "epic/${ctx.branch}/${rid}" HEAD 2>/dev/null || true
2. Archive: datum closeout-archive --run-id ${rid} 2>/dev/null || true
3. Clean up root pipeline artifacts — move them to the epic archive dir:
   EPIC_DIR="docs/epics/${ctx.branch}"
   mkdir -p "$EPIC_DIR"
   for f in SPEC.md TASKS.md QUESTIONS.md PROPERTIES.md TICKET.md tasks.json; do
     [ -f "$f" ] && mv "$f" "$EPIC_DIR/" && echo "archived $f → $EPIC_DIR/"
   done
   [ -f .datum/lane-plan.json ] && mv .datum/lane-plan.json "$EPIC_DIR/" && echo "archived lane-plan.json → $EPIC_DIR/"
4. Commit the cleanup: git add -A && git commit -m "closeout(${rid}): archive pipeline artifacts to $EPIC_DIR"`,
  { label: 'synthesize-and-archive', model: model('balanced') },
)

const synth = typeof synthResult === 'string'
  ? parseAgentJson(synthResult as string, { artifacts_written: [], follow_up_count: 0 })
  : synthResult

log(`Closeout complete: ${(synth?.artifacts_written || []).join(', ')}`)

// Housekeep: delete merged lane/worktree branches and pipeline-state
await agent(
  `Clean up after the epic:
1. Delete pipeline state: rm -f .datum/pipeline-state.json
2. Delete merged lane branches for THIS epic only (exact prefix match, no other epics/runs):
   git branch --merged | grep -E '^[* ]+${ctx.branch}--' | xargs -r git branch -d 2>/dev/null
3. Prune worktree refs: git worktree prune 2>/dev/null
4. Report what was deleted.
Output a short summary only.`,
  { label: 'housekeep', model: model('fast') },
)

export const __workflowResult = {
  branch: ctx.branch, runId: rid,
  artifacts: synth?.artifacts_written || [],
  followUps: synth?.follow_up_count || 0,
}
