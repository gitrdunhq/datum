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

export type TrackerStage = 'queued' | 'red' | 'green' | 'done' | 'failed' | 'skipped'

export interface PublishResult {
  epicId: string
  taskIds: Record<string, string>
}

export async function publishLanePlan(
  lanePlanPath: string,
  epicTitle: string,
): Promise<PublishResult | null> {
  const result: string | null = await agent(
    `Run: datum plan-issues --lane-plan "${lanePlanPath}" --title "${epicTitle}"
Return the JSON output. If the command fails, return {"error": "<message>"}.
Output raw JSON only.`,
    stageOpts('cli', { label: 'publish-issues', model: model('fast') }),
  )
  if (!result) {
    log('[tracker] publish failed: agent returned no result')
    return null
  }
  const parsed = typeof result === 'string'
    ? parseAgentJson<{ error?: string; epic_number?: unknown; task_issues?: Record<string, unknown> } | null>(result, null)
    : (result as { error?: string; epic_number?: unknown; task_issues?: Record<string, unknown> })
  if (!parsed) {
    log(`[tracker] publish failed: unparseable output — ${String(result).slice(0, 200)}`)
    return null
  }
  if (parsed.error) {
    log(`[tracker] publish failed: ${parsed.error}`)
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
  const shaFlag = commitSha ? ` --commit ${commitSha}` : ''
  const result: string | null = await agent(
    `Run: datum issue-stage --issue ${issueId} --stage ${stage}${shaFlag}
Return ONLY the command's JSON output. If it fails, return {"ok": false, "error": "<last lines of output>"}.
Output raw JSON only.`,
    stageOpts('cli', { label: `tracker:${issueId}:${stage}`, model: model('fast') }),
  )
  const parsed = result
    ? parseAgentJson<{ ok?: boolean; error?: string } | null>(String(result), null)
    : null
  if (!parsed || parsed.ok === false) {
    log(`[tracker] issue-stage failed for #${issueId} → ${stage}: ${parsed?.error || (result ? String(result).slice(0, 200) : 'agent returned no result')}`)
    return false
  }
  return true
}

export function getIssueId(lanePlan: { lanes: Record<string, { github_issue?: number }> }, taskId: string): string {
  const issue = lanePlan.lanes[taskId]?.github_issue
  return issue ? String(issue) : ''
}
