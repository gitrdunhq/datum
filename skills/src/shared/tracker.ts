/**
 * tracker.ts — Issue tracker integration boundary.
 *
 * Swappable module: replace the implementation to switch from
 * GitHub Issues to Jira, Linear, or any other tracker.
 * The pipeline calls these functions; it never imports gh/jira/linear directly.
 *
 * The tracker is best-effort — a failed label update must never fail a lane —
 * but it is never SILENT: every failure is logged with the command's output so
 * a broken `datum issue-stage` is visible in the run, not discovered weeks
 * later as issues that never moved.
 * tested-by: skills/src/shared/tracker.test.ts
 */

import { stageOpts } from './agent-types'
import { model } from './models'
import { parseAgentJson } from './utils'
import { batchCommandPrompt, parseBatchResult, stepResult, describeFailure, type BatchResult, type BatchStep } from './batch'

export type TrackerStage = 'queued' | 'red' | 'green' | 'done' | 'failed' | 'skipped'

export interface PublishResult {
  epicId: string
  taskIds: Record<string, string>
}

// Both tracker calls used to be a runner told to "Run: datum plan-issues /
// issue-stage" and return the JSON — or, on failure, to INVENT
// {"error": ...} / {"ok": false} itself. The CLI's exit code and stdout now
// come from a batch step; the runner never authors the verdict. The tracker
// stays non-critical (logged, never thrown).

const q = (s: string): string => `"${s.replace(/(["\\`$])/g, '\\$1')}"`

export function publishSteps(lanePlanPath: string, epicTitle: string): BatchStep[] {
  return [{ name: 'publish', command: `datum plan-issues --lane-plan ${q(lanePlanPath)} --title ${q(epicTitle)}`, tolerant: true }]
}

export interface PublisherJson {
  skipped?: string
  reason?: string
  epic_number?: unknown
  task_issues?: Record<string, unknown>
}

function tail(step: { stdout: string; stderr: string }): string {
  return (step.stderr || step.stdout || '').trim().split('\n').slice(-3).join(' | ')
}

export function publishFromSteps(result: BatchResult): { ok: boolean; parsed: PublisherJson | null; error: string } {
  if (result.missing) return { ok: false, parsed: null, error: `tracker_publish_failed: ${describeFailure(result, 'publish')}` }
  const step = stepResult(result, 'publish')
  if (!step) return { ok: false, parsed: null, error: 'tracker_publish_failed: publish step did not run' }
  if (step.exit_code !== 0) return { ok: false, parsed: null, error: `tracker_publish_failed: datum plan-issues exited ${step.exit_code} — ${tail(step)}` }
  const parsed = parseAgentJson<PublisherJson | null>(step.stdout || '', null)
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, parsed: null, error: `tracker_publish_failed: datum plan-issues printed no JSON — ${(step.stdout || '').trim().slice(0, 200)}` }
  }
  return { ok: true, parsed, error: '' }
}

export function stageSteps(issueId: string, stage: TrackerStage, commitSha?: string): BatchStep[] {
  // Interpolated raw into the command: refuse anything but an issue number
  // and a hex sha rather than quoting around them (review finding).
  if (!/^\d+$/.test(issueId)) throw new Error(`stageSteps: issue id must be numeric, got ${JSON.stringify(issueId)}`)
  if (commitSha && !/^[0-9a-f]{4,40}$/i.test(commitSha)) throw new Error(`stageSteps: commit sha must be hex, got ${JSON.stringify(commitSha)}`)
  const shaFlag = commitSha ? ` --commit ${commitSha}` : ''
  return [{ name: 'stage', command: `datum issue-stage --issue ${issueId} --stage ${stage}${shaFlag}`, tolerant: true }]
}

export function stageFromSteps(result: BatchResult): { ok: boolean; error: string } {
  if (result.missing) return { ok: false, error: `tracker_stage_failed: ${describeFailure(result, 'stage')}` }
  const step = stepResult(result, 'stage')
  if (!step) return { ok: false, error: 'tracker_stage_failed: stage step did not run' }
  if (step.exit_code !== 0) return { ok: false, error: `tracker_stage_failed: datum issue-stage exited ${step.exit_code} — ${tail(step)}` }
  const parsed = parseAgentJson<{ ok?: boolean } | null>(step.stdout || '', null)
  if (!parsed || parsed.ok !== true) return { ok: false, error: `tracker_stage_failed: datum issue-stage exited 0 without ok:true — ${(step.stdout || '').trim().slice(0, 200)}` }
  return { ok: true, error: '' }
}

export async function publishLanePlan(
  lanePlanPath: string,
  epicTitle: string,
): Promise<PublishResult | null> {
  const steps = publishSteps(lanePlanPath, epicTitle)
  const publish = publishFromSteps(parseBatchResult(
    await agent(batchCommandPrompt(steps), stageOpts('cli', { label: 'publish-issues', model: model('fast') })),
    steps,
  ))
  if (!publish.ok || !publish.parsed) {
    log(`[tracker] ${publish.error}`)
    return null
  }
  const parsed = publish.parsed
  if (parsed.skipped) {
    // The publisher refused (e.g. github_repo_unresolved: no remote in the
    // consumer repo) rather than file into a guessed tracker. Not a failure
    // of the plan — the lane plan simply carries no github_issue numbers.
    log(`[tracker] publish skipped: ${parsed.reason || parsed.skipped}`)
    return null
  }
  return {
    epicId: String(parsed.epic_number || ''),
    taskIds: Object.fromEntries(
      Object.entries(parsed.task_issues || {}).map(([k, v]) => [k, String(v)])
    ),
  }
}

/**
 * Move a task's tracker issue to `stage`. Returns true when the CLI reported
 * success. Failures are logged (never thrown) — callers treat the tracker as
 * non-critical, but the transcript must show what went wrong.
 */
export async function updateStage(
  issueId: string,
  stage: TrackerStage,
  commitSha?: string,
): Promise<boolean> {
  if (!issueId) return false
  const steps = stageSteps(issueId, stage, commitSha)
  const outcome = stageFromSteps(parseBatchResult(
    await agent(batchCommandPrompt(steps), stageOpts('cli', { label: `tracker:${issueId}:${stage}`, model: model('fast') })),
    steps,
  ))
  if (!outcome.ok) {
    log(`[tracker] ${outcome.error} (issue #${issueId} → ${stage})`)
    return false
  }
  return true
}

export function getIssueId(lanePlan: { lanes: Record<string, { github_issue?: number }> }, taskId: string): string {
  const issue = lanePlan.lanes[taskId]?.github_issue
  return issue ? String(issue) : ''
}
