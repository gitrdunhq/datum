/**
 * tracker.ts — Issue tracker integration boundary.
 *
 * Swappable module: replace the implementation to switch from
 * GitHub Issues to Jira, Linear, or any other tracker.
 * The pipeline calls these functions; it never imports gh/jira/linear directly.
 */

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
    { label: 'publish-issues', model: 'haiku' },
  )
  if (!result) return null
  const parsed = typeof result === 'string'
    ? JSON.parse(result.replace(/```[a-z]*\n?/g, '').trim())
    : result
  if (parsed?.error) {
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

export async function updateStage(
  issueId: string,
  stage: TrackerStage,
  commitSha?: string,
): Promise<void> {
  if (!issueId) return
  const shaFlag = commitSha ? ` --commit ${commitSha}` : ''
  await agent(
    `Run: datum issue-stage --issue ${issueId} --stage ${stage}${shaFlag}
If the command doesn't exist or fails, silently continue.
Output nothing.`,
    { label: `tracker:${issueId}:${stage}`, model: 'haiku' },
  )
}

export function getIssueId(lanePlan: { lanes: Record<string, { github_issue?: number }> }, taskId: string): string {
  const issue = lanePlan.lanes[taskId]?.github_issue
  return issue ? String(issue) : ''
}
