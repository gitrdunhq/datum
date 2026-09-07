import { model } from './shared/models'
import type { TriageArgs, TriageAnalysis } from './shared/types'
import { TRIAGE_SCHEMA } from './shared/schemas'
import { groupBlockedByRoot } from './shared/utils'
import { configureAgentTypes } from './shared/agent-types'
import { classifyLaneError, triageDestination, type TriageClassifyCategory } from './shared/triage-classify'

// classifyLaneError's underscore categories map onto the hyphenated
// TriageCategory label the rest of the pipeline (schema, GitHub labels) uses.
const CATEGORY_LABEL: Record<Exclude<TriageClassifyCategory, 'dependency' | 'unknown'>, string> = {
  infrastructure: 'infrastructure',
  workflow_bug: 'workflow-bug',
  lane_plan: 'lane-plan',
  agent_behavior: 'agent-behavior',
  test_quality: 'test-quality',
}

// Inverse of CATEGORY_LABEL, for when the LLM assigns the category (no
// deterministic classification exists for the lane) — still needed to decide
// `triageDestination` so an LLM-assigned 'agent-behavior'/'lane-plan'/etc.
// finding doesn't fall through to the 'datum' branch by default.
const LABEL_TO_CATEGORY: Record<string, TriageClassifyCategory> = {
  infrastructure: 'infrastructure',
  'workflow-bug': 'workflow_bug',
  'lane-plan': 'lane_plan',
  'agent-behavior': 'agent_behavior',
  'test-quality': 'test_quality',
}

export const meta = {
  name: 'datum-tdd-act-triage',
  description: 'Categorize TDD failures and auto-file GitHub issues',
  phases: [{ title: 'Triage' }],
}

const a = args as TriageArgs
configureAgentTypes(a.agentTypes || {})
phase('Triage')

let filed = 0
let consumer_findings = 0
let skipped = 0

if (a.failures.length === 0) {
  log('[triage] All lanes succeeded — no issues to file')
} else {
  const blockedIds = (a.blocked || []).map((r) => r.task_id)
  const groups = groupBlockedByRoot(a.lanePlan, a.failures, blockedIds)

  // Pre-classify every root failure deterministically from the pipeline's
  // own machine-readable error prefixes BEFORE any LLM sees it. `dependency`
  // failures are consequences already grouped under their root by
  // groupBlockedByRoot above — they never get filed as their own issue.
  const classifications: Record<string, ReturnType<typeof classifyLaneError>> = {}
  for (const fid of a.failures) {
    const r = a.results[fid]
    classifications[fid] = classifyLaneError(r?.error, r?.stage)
  }

  const dependencyFailures = a.failures.filter((fid) => classifications[fid].category === 'dependency')
  const triageableFailures = a.failures.filter((fid) => classifications[fid].category !== 'dependency')

  if (dependencyFailures.length > 0) {
    log(`[triage] Skipping ${dependencyFailures.length} dependency failure(s) (consequences of an upstream root, already grouped): [${dependencyFailures.join(', ')}]`)
  }

  if (triageableFailures.length === 0) {
    log('[triage] All failures were dependency consequences — no root causes to file')
  } else {
    const failureDetails = triageableFailures.map(fid => {
      const r = a.results[fid]
      const lane = a.lanePlan.lanes[fid]
      const descendants = groups[fid] || []
      const chainNote = descendants.length > 0
        ? ` — blocks ${descendants.length} dependent lane(s): [${descendants.join(', ')}] (do not diagnose these separately; they are consequences of this root failure)`
        : ''
      const cls = classifications[fid]
      // #368: LaneOutcome doesn't declare a worktree field today, but if a
      // future producer adds one, surface it here without requiring another
      // triage.ts change.
      const worktreePath = (r as unknown as { worktree_path?: string } | undefined)?.worktree_path
      const evidence = `[evidence: stage=${r?.stage || 'UNKNOWN'}${worktreePath ? `, worktree=${worktreePath}` : ''}]`
      const categoryNote = cls.confidence === 'deterministic'
        ? ` CATEGORY ALREADY DETERMINED: ${cls.category} (${cls.reason}) — do not reclassify this lane; explain the failure and propose a fix within that category.`
        : ''
      return `Lane ${fid} ("${lane?.title || 'unknown'}"): failed at ${r?.stage || 'UNKNOWN'} — ${r?.error || 'null result'}${chainNote} ${evidence}${categoryNote}`
    }).join('\n')

    const triage = await agent(
      `Analyze these TDD workflow failures and categorize each one.\n\n` +
      `Run ID: ${a.runId}\n` +
      `Epic branch: ${a.epicBranch}\n` +
      `IMPORTANT — each lane's work lives on its own branch (\`${a.epicBranch}--<task_id>\`) inside its own isolated git worktree, NEVER in the ROOT checkout. Never inspect the ROOT checkout to diagnose a lane's files or claim a lane's changes are missing/wrong — a prior issue (#387) confidently blamed the RED agent for skeleton stubs that were actually left in the ROOT checkout, not the lane's own worktree/branch.\n\n` +
      `Failed lanes (each root failure lists the dependent lanes it transitively blocked — treat each root + its blocked descendants as ONE group, not N independent failures). Some lanes already have a category the pipeline itself determined from a machine-readable error prefix it produced — for those, use exactly that category; your job is only to explain the failure and propose a fix within it, not to re-derive or second-guess the category:\n${failureDetails}\n\n` +
      `For any lane WITHOUT a predetermined category, determine:\n` +
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
          skipped++
          continue
        }
        // The filed label's category comes from the deterministic classifier
        // when we have one for this lane — never from the model's own answer.
        let cls: ReturnType<typeof classifyLaneError> | null = null
        if (issue.lane) cls = classifications[issue.lane]
        const category = (cls && cls.confidence === 'deterministic')
          ? CATEGORY_LABEL[cls.category as Exclude<TriageClassifyCategory, 'dependency' | 'unknown'>]
          : issue.category
        // #417: a skeptic-confirmed CONSUMER-repo code bug landed in datum's
        // own tracker because every failure used to file unconditionally.
        // destination decides where (if anywhere) this finding may go —
        // only 'datum' reaches the issue-filing call below.
        const effectiveClassification = (cls && cls.confidence === 'deterministic')
          ? cls
          : { category: LABEL_TO_CATEGORY[issue.category] || 'unknown', confidence: 'heuristic' as const, reason: 'derived from the LLM-assigned category label; no deterministic pipeline prefix matched this lane' }
        const destination = triageDestination(effectiveClassification, issue.body)

        if (destination === 'consumer') {
          log(`[triage] consumer-code finding for ${issue.lane || 'unknown'} (${category}): not filed to datum's tracker — ${issue.body.slice(0, 160)}`)
          consumer_findings++
          continue
        }
        if (destination === 'none') {
          log(`[triage] Skipping (dependency): ${issue.title}`)
          skipped++
          continue
        }

        const labels = `datum-bug,${category}`
        const safeTitle = issue.title.slice(0, 80).replace(/'/g, "'\\''")
        const safeSearch = issue.title.slice(0, 50).replace(/'/g, "'\\''")
        const safeBody = issue.body.replace(/'/g, "'\\''")
        const fileResult = await agent(
          `unset GITHUB_TOKEN && gh issue list --repo gitrdunhq/datum --state open --search '${safeSearch}' --json number,title --limit 3 | head -5\n` +
          `If no duplicate exists, create the issue:\n` +
          `unset GITHUB_TOKEN && gh issue create --repo gitrdunhq/datum ` +
          `--title '${safeTitle}' ` +
          `--label '${labels}' ` +
          `--body '${safeBody}'\n` +
          `If a duplicate exists, skip and say "duplicate found".`,
          { label: `file-issue:${issue.lane || 'global'}`, phase: 'Triage', model: model('fast') }
        ) as string | null
        if (!(fileResult || '').toLowerCase().includes('duplicate')) {
          log(`[triage] Filed: ${issue.title} [${category}/${issue.severity}]`)
          filed++
        } else {
          log(`[triage] Duplicate found, skipped: ${issue.title}`)
          skipped++
        }
      }
    } else {
      log('[triage] No actionable issues identified')
    }
  }
}

export const __workflowResult = { filed, consumer_findings, skipped }
