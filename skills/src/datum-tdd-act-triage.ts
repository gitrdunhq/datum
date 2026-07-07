import { model } from './shared/models'
import type { TriageArgs, TriageAnalysis } from './shared/types'
import { TRIAGE_SCHEMA } from './shared/schemas'
import { groupBlockedByRoot } from './shared/utils'

export const meta = {
  name: 'datum-tdd-act-triage',
  description: 'Categorize TDD failures and auto-file GitHub issues',
  phases: [{ title: 'Triage' }],
}

const a = args as TriageArgs
phase('Triage')

let filed = 0

if (a.failures.length === 0) {
  log('[triage] All lanes succeeded — no issues to file')
} else {
  const blockedIds = (a.blocked || []).map((r) => r.task_id)
  const groups = groupBlockedByRoot(a.lanePlan, a.failures, blockedIds)

  const failureDetails = a.failures.map(fid => {
    const r = a.results[fid]
    const lane = a.lanePlan.lanes[fid]
    const descendants = groups[fid] || []
    const chainNote = descendants.length > 0
      ? ` — blocks ${descendants.length} dependent lane(s): [${descendants.join(', ')}] (do not diagnose these separately; they are consequences of this root failure)`
      : ''
    return `Lane ${fid} ("${lane?.title || 'unknown'}"): failed at ${r?.stage || 'UNKNOWN'} — ${r?.error || 'null result'}${chainNote}`
  }).join('\n')

  const triage = await agent(
    `Analyze these TDD workflow failures and categorize each one.\n\n` +
    `Run ID: ${a.runId}\n` +
    `Epic branch: ${a.epicBranch}\n` +
    `Failed lanes (each root failure lists the dependent lanes it transitively blocked — treat each root + its blocked descendants as ONE group, not N independent failures):\n${failureDetails}\n\n` +
    `For each failure, determine:\n` +
    `- Is this a WORKFLOW BUG (datum-tdd-act.js logic error)?\n` +
    `- Is this a LANE PLAN issue (bad ACs, wrong files, missing deps)?\n` +
    `- Is this an AGENT BEHAVIOR issue (agent didn't follow instructions)?\n` +
    `- Is this INFRASTRUCTURE (git, build tools, test runner, CWD issues)?\n` +
    `- Is this TEST QUALITY (tests too weak, wrong assertions)?\n\n` +
    `For each issue, write a GitHub issue title starting with [datum-bug] and a body with:\n` +
    `- What happened (the error)\n` +
    `- Why it happened (root cause analysis)\n` +
    `- Suggested fix\n` +
    `- The lane, stage, and run ID for traceability`,
    { label: 'triage', phase: 'Triage', model: model('balanced'), schema: TRIAGE_SCHEMA }
  ) as TriageAnalysis | null

  if (triage?.issues?.length) {
    for (const issue of triage.issues) {
      if (issue.severity === 'low') {
        log(`[triage] Skipping low-severity: ${issue.title}`)
        continue
      }
      const labels = `datum-bug,${issue.category}`
      const safeTitle = issue.title.slice(0, 80).replace(/'/g, "'\\''")
      const safeSearch = issue.title.slice(0, 50).replace(/'/g, "'\\''")
      const safeBody = issue.body.replace(/'/g, "'\\''")
      await agent(
        `unset GITHUB_TOKEN && gh issue list --repo gitrdunhq/datum --state open --search '${safeSearch}' --json number,title --limit 3 | head -5\n` +
        `If no duplicate exists, create the issue:\n` +
        `unset GITHUB_TOKEN && gh issue create --repo gitrdunhq/datum ` +
        `--title '${safeTitle}' ` +
        `--label '${labels}' ` +
        `--body '${safeBody}'\n` +
        `If a duplicate exists, skip and say "duplicate found".`,
        { label: `file-issue:${issue.lane || 'global'}`, phase: 'Triage', model: model('fast') }
      )
      log(`[triage] Filed: ${issue.title} [${issue.category}/${issue.severity}]`)
      filed++
    }
  } else {
    log('[triage] No actionable issues identified')
  }
}

export const __workflowResult = { filed }
