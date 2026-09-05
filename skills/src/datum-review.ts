import { model, type ReviewDomain, type Severity, type ModelName } from './shared/models'
import { renderPrompt, parseAgentJsonStrict } from './shared/utils'
import reviewDomainTemplate from './prompts/review-domain.md'
import reviewCorrectnessSpecVerifyTemplate from './prompts/review-correctness-spec-verify.md'
import { configureAgentTypes, stageOpts } from './shared/agent-types'
import { batchCommandPrompt, setBatchCacheKey, parseBatchResult, stepStdout } from './shared/batch'
import { gateSteps, parseGateResult } from './shared/gate'
import { findingKey } from './shared/review-keys'
import { runBatch } from './shared/agents'
import { writeFileSteps, writeFileFromSteps, writeFileBlobSha } from './shared/write-steps'
import { commitFilesSteps, commitFilesFromSteps } from './shared/commit-steps'
import type { PhaseArgs } from './shared/types'

export const meta = {
  name: 'datum-review',
  description: 'Parallel review swarm — 4 domain agents fan out, synthesize findings',
  phases: [
    { title: 'Review', detail: '4 parallel domain reviewers' },
    { title: 'Synthesize', detail: 'dedup findings, render + commit REVIEW-REPORT.md' },
  ],
}

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = ((typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})) as PhaseArgs
const yolo: boolean = !!a.yolo
// #368: review-domain agents and the report writer stay on the runtime default —
// no datum-* definition fits them — but honour the switch for parity with the
// other phases (a later mapping only has to add stageOpts at the call site).
if (a.agentTypes && typeof a.agentTypes === 'object') configureAgentTypes(a.agentTypes)
else configureAgentTypes({})
// Resume cache key (#354): the review gate re-runs after a human edit.
setBatchCacheKey(a.configFingerprint || '')

const DOMAINS = [
  { domain: 'Security', prefix: 'SEC', focus: 'OWASP top 10, injection, auth bypass, secrets exposure, unsafe deserialization', model: model('balanced') },
  { domain: 'Performance', prefix: 'PERF', focus: 'Hot paths, N+1 queries, unbounded loops, missing pagination, excessive allocations', model: model('fast') },
  { domain: 'Architecture', prefix: 'ARCH', focus: 'Layer violations, tight coupling, dependency direction, abstraction leaks', model: model('fast') },
  { domain: 'Correctness', prefix: 'CORR', focus: 'Does implementation match SPEC and ACs? Off-by-one, null handling, edge cases', model: model('balanced') },
]

// ── Review (parallel swarm — each domain agent also reads context itself) ──

phase('Review')

// `key` is the content key (shared/review-keys.ts): ids are renumbered every
// review run, so operator accepts in REVIEW-RESPONSE.md bind to the key.
interface Finding { id: string; severity: Severity | 'info'; file: string; line: number; description: string; suggestion: string; key: string }
interface DomainResult { domain: string; findings: Finding[] }

/**
 * The merge gate compares severity to the enum; the LLM writes free text
 * ("High", "HIGH", "blocker", "sev1"). Normalise, and count anything
 * unrecognised as high — fail closed — with a named log line.
 */
function normaliseSeverity(raw: unknown, where: string): Finding['severity'] {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low' || v === 'info') return v
  if (/\b(crit|blocker|sev ?0|sev ?1|p0|p1)\b/.test(v)) return 'critical'
  log(`review_severity_unknown: ${where} reported severity ${JSON.stringify(raw)} — counted as high (fail closed)`)
  return 'high'
}

const reviewResults = await parallel<DomainResult>(
  DOMAINS.map((d) => () =>
    agent(
      d.domain === 'Correctness'
        ? reviewCorrectnessSpecVerifyTemplate
        : renderPrompt(reviewDomainTemplate, { domain: d.domain, domainPrefix: d.prefix, domainFocus: d.focus }),
      { label: `review-${d.domain.toLowerCase()}`, phase: 'Review', model: d.model },
    ),
  ),
)

const allFindings: Finding[] = []
for (let i = 0; i < DOMAINS.length; i++) {
  const result = reviewResults[i]
  // Strict: a null result or unparseable JSON here used to silently become
  // `findings: []` — exactly the "[] means no findings, phase completes"
  // silent fallback FLOW.md's design principle 2 warns about. A domain
  // reviewer that crashed or returned garbage must not be indistinguishable
  // from one that genuinely found nothing; committing a falsely-clean
  // REVIEW-REPORT.md would let `datum gate review` pass on missing coverage.
  if (!result) {
    throw new Error(`agent_output_unparseable: review-${DOMAINS[i].domain.toLowerCase()} — (no result)`)
  }
  const parsed: DomainResult = typeof result === 'string'
    ? parseAgentJsonStrict<DomainResult>(result as string, `review-${DOMAINS[i].domain.toLowerCase()}`)
    : result as DomainResult
  if (!Array.isArray(parsed.findings)) {
    throw new Error(`agent_output_unparseable: review-${DOMAINS[i].domain.toLowerCase()} — reply has no findings array`)
  }
  log(`${parsed.domain}: ${parsed.findings.length} findings`)
  for (const raw of parsed.findings) {
    const description = String(raw.description ?? '')
    const f: Finding = {
      ...raw,
      severity: normaliseSeverity(raw.severity, `review-${DOMAINS[i].domain.toLowerCase()} ${raw.id || ''}`),
      description,
      key: findingKey(DOMAINS[i].domain, String(raw.file ?? ''), description),
    }
    log(`  [${f.severity}] ${f.id}: ${f.description.slice(0, 80)}`)
    allFindings.push(f)
  }
}

// ── Synthesize (collapsed: dedup + render + commit-report into one code block + one agent) ──

phase('Synthesize')

const seen = new Set<string>()
const deduped: Finding[] = []
for (const f of allFindings) {
  const key = `${f.file}:${f.line}:${f.description.slice(0, 40)}`
  if (!seen.has(key)) { seen.add(key); deduped.push(f) }
}

const critical = deduped.filter((f) => f.severity === 'critical' || f.severity === 'high')
log(`Findings: ${deduped.length} unique (${critical.length} high/critical)`)

// `datum gate review` (datum/gate.py) detects high/critical findings by
// scanning the report content for "severity: high"/"**high**" (or
// critical). Bolding the severity cell here — rather than a bare word —
// keeps that detection deterministic and in lockstep with `critical` above,
// which already treats 'high' and 'critical' as the same bar for canMerge.
const reportLines = [
  '# Review Report\n',
  `**Findings:** ${deduped.length} unique (${critical.length} high/critical)\n`,
  '## Findings\n',
  '| ID | Severity | File | Line | Description | Suggestion | Key |',
  '|---|---|---|---|---|---|---|',
  ...deduped.map((f) => `| ${f.id} | **${f.severity}** | ${f.file} | ${f.line} | ${f.description} | ${f.suggestion} | ${f.key} |`),
  '',
]

// The report is written and committed by batches (shared/write-steps.ts,
// shared/commit-steps.ts), never handed to an LLM runner as "Write this
// content ... Commit: ..." — a runner that re-wrapped a table row or
// dropped the bold severity broke the gate's detection, and its reply was
// discarded. The branch comes from a batch step because this script has
// no read-context relay of its own.
const branchSteps = [{ name: 'branch', command: 'git rev-parse --abbrev-ref HEAD', tolerant: true }]
const branchResult = parseBatchResult(
  await agent(batchCommandPrompt(branchSteps), stageOpts('cli', { label: 'read-branch', model: model('fast') })),
  branchSteps,
)
const branch = (stepStdout(branchResult, 'branch') || '').trim()
if (!branch) throw new Error(`review_branch_unresolved: git rev-parse printed nothing (${branchResult.missing ? 'batch returned no result' : 'empty stdout'})`)
const epicDir = `docs/epics/${branch}`
const reportPath = `${epicDir}/REVIEW-REPORT.md`
const reportContent = reportLines.join('\n')

const writeSteps = writeFileSteps({ path: reportPath, content: reportContent })
const written = writeFileFromSteps(parseBatchResult(
  await agent(batchCommandPrompt(writeSteps), stageOpts('cli', { label: 'write-report', model: model('fast') })),
  writeSteps,
), { path: reportPath, expectedSha: writeFileBlobSha(reportContent), prefix: 'review_report' })
if (!written.ok) throw new Error(written.error)

const commitStepList = commitFilesSteps({ wt: '.', files: [reportPath], message: `review: REVIEW-REPORT.md (${deduped.length} findings)` })
const commit = commitFilesFromSteps(parseBatchResult(
  await agent(batchCommandPrompt(commitStepList), stageOpts('cli', { label: 'commit-report', model: model('fast') })),
  commitStepList,
))
if (commit.error) throw new Error(`review_commit_failed: ${commit.error}`)
if (commit.nothingToCommit) log('REVIEW-REPORT.md unchanged since the last review — nothing to commit')
else log(`REVIEW-REPORT.md committed (${commit.sha})`)

if (critical.length > 0) log(`${critical.length} high/critical — remediation needed`)

// Deterministic: the verdict is `datum gate review`'s exit code read from a
// batch step (shared/gate.ts), not an LLM's echo of its JSON — same pattern
// as Refine/Plan/Properties/Validate (#368). Runs after the report is
// committed so the gate can resolve docs/epics/<branch>/REVIEW-REPORT.md.
const gateStepList = gateSteps('review', yolo ? ' --approve' : '')
const gate = parseGateResult(await runBatch(gateStepList, stageOpts('cli', { label: 'gate', model: model('fast') })))
if (gate.passed) log('Review gate PASSED')
else log(`Review gate: ${gate.message || 'needs review'}${gate.needsHuman ? ' (needs human approval)' : ''}${gate.hardStop ? ' (hard stop)' : ''}`)

export const __workflowResult = {
  totalFindings: deduped.length, criticalFindings: critical.length, canMerge: critical.length === 0,
  gatePassed: gate.passed, gateMessage: gate.message, gateNeedsHuman: gate.needsHuman,
}
