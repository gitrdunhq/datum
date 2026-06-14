import { renderPrompt, parseAgentJson } from './shared/utils'
import reviewDomainTemplate from './prompts/review-domain.md'
import readContextTemplate from './prompts/util-read-context.md'
import commitArtifactTemplate from './prompts/util-commit-artifact.md'

export const meta = {
  name: 'datum-review',
  description: 'Parallel review swarm — 4 domain agents fan out, synthesize findings',
  phases: [
    { title: 'Prepare', detail: 'generate diff, set up review context' },
    { title: 'Review', detail: '4 parallel domain reviewers' },
    { title: 'Synthesize', detail: 'dedup findings, render REVIEW-REPORT.md' },
  ],
}

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = (typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})
const yolo: boolean = !!a.yolo

const DOMAINS = [
  { domain: 'Security', prefix: 'SEC', focus: 'OWASP top 10, injection, auth bypass, secrets exposure, unsafe deserialization', model: 'sonnet' as const },
  { domain: 'Performance', prefix: 'PERF', focus: 'Hot paths, N+1 queries, unbounded loops, missing pagination, excessive allocations', model: 'haiku' as const },
  { domain: 'Architecture', prefix: 'ARCH', focus: 'Layer violations, tight coupling, dependency direction, abstraction leaks', model: 'haiku' as const },
  { domain: 'Correctness', prefix: 'CORR', focus: 'Does implementation match SPEC and ACs? Off-by-one, null handling, edge cases', model: 'sonnet' as const },
]

// ── Prepare ──

phase('Prepare')

const context = await agent(
  renderPrompt(readContextTemplate, {
    extraFields: '3. "diff_lines": line count of `git diff main...HEAD`',
  }),
  { label: 'prepare-context', model: 'haiku' },
)

const ctx = typeof context === 'string'
  ? parseAgentJson(context as string, {} as Record<string, unknown>)
  : context

log(`Branch: ${ctx.branch}, diff: ${ctx.diff_lines || '?'} lines`)

// ── Review (parallel swarm) ──

phase('Review')

interface Finding {
  id: string
  severity: string
  file: string
  line: number
  description: string
  suggestion: string
}

interface DomainResult {
  domain: string
  findings: Finding[]
}

const reviewResults = await parallel<DomainResult>(
  DOMAINS.map((d) => () =>
    agent(
      renderPrompt(reviewDomainTemplate, {
        domain: d.domain,
        domainPrefix: d.prefix,
        domainFocus: d.focus,
      }),
      { label: `review-${d.domain.toLowerCase()}`, phase: 'Review', model: d.model },
    ),
  ),
)

const allFindings: Finding[] = []
for (let i = 0; i < DOMAINS.length; i++) {
  const result = reviewResults[i]
  if (!result) { log(`${DOMAINS[i].domain}: (null)`); continue }
  const parsed: DomainResult = typeof result === 'string'
    ? parseAgentJson(result as string, { domain: DOMAINS[i].domain, findings: [] } as DomainResult)
    : result as DomainResult
  log(`${parsed.domain}: ${parsed.findings.length} findings`)
  for (const f of parsed.findings) {
    log(`  [${f.severity}] ${f.id}: ${f.description.slice(0, 80)}`)
    allFindings.push(f)
  }
}

// ── Synthesize ──

phase('Synthesize')

const seen = new Set<string>()
const deduped: Finding[] = []
for (const f of allFindings) {
  const key = `${f.file}:${f.line}:${f.description.slice(0, 40)}`
  if (!seen.has(key)) {
    seen.add(key)
    deduped.push(f)
  }
}

const critical = deduped.filter((f) => f.severity === 'critical' || f.severity === 'high')
log(`Findings: ${deduped.length} unique (${critical.length} high/critical)`)

const reportLines = [
  '# Review Report\n',
  `**Branch:** ${ctx.branch}`,
  `**Findings:** ${deduped.length} unique (${critical.length} high/critical)\n`,
  '## Findings\n',
  '| ID | Severity | File | Line | Description | Suggestion |',
  '|---|---|---|---|---|---|',
  ...deduped.map((f) => `| ${f.id} | ${f.severity} | ${f.file} | ${f.line} | ${f.description} | ${f.suggestion} |`),
  '',
]

const reportContent = reportLines.join('\n')
const epicDir = ctx.epic_dir || `docs/epics/${ctx.branch}`

await agent(
  renderPrompt(commitArtifactTemplate, {
    artifactPath: `${epicDir}/REVIEW-REPORT.md`,
    extraCommands: '',
    gitAddPaths: `"${epicDir}/REVIEW-REPORT.md"`,
    commitMessage: `review: write REVIEW-REPORT.md (${deduped.length} findings)`,
    content: reportContent,
  }),
  { label: 'commit-report', model: 'haiku' },
)

log('REVIEW-REPORT.md written')

if (critical.length > 0) {
  log(`${critical.length} high/critical findings — remediation needed before merge`)
}

export const __workflowResult = {
  branch: ctx.branch,
  totalFindings: deduped.length,
  criticalFindings: critical.length,
  canMerge: critical.length === 0,
}
