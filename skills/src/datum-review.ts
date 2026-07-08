import { model, type ReviewDomain, type Severity, type ModelName } from './shared/models'
import { renderPrompt, parseAgentJson } from './shared/utils'
import reviewDomainTemplate from './prompts/review-domain.md'
import readContextTemplate from './prompts/util-read-context.md'
import commitArtifactTemplate from './prompts/util-commit-artifact.md'

export const meta = {
  name: 'datum-review',
  description: 'Parallel review swarm — 4 domain agents fan out, synthesize findings',
  phases: [
    { title: 'Review', detail: '4 parallel domain reviewers' },
    { title: 'Synthesize', detail: 'dedup findings, render + commit REVIEW-REPORT.md' },
  ],
}

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = (typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})
const yolo: boolean = !!a.yolo

const DOMAINS = [
  { domain: 'Security', prefix: 'SEC', focus: 'OWASP top 10, injection, auth bypass, secrets exposure, unsafe deserialization', model: model('balanced') },
  { domain: 'Performance', prefix: 'PERF', focus: 'Hot paths, N+1 queries, unbounded loops, missing pagination, excessive allocations', model: model('fast') },
  { domain: 'Architecture', prefix: 'ARCH', focus: 'Layer violations, tight coupling, dependency direction, abstraction leaks', model: model('fast') },
  { domain: 'Correctness', prefix: 'CORR', focus: 'Does implementation match SPEC and ACs? Off-by-one, null handling, edge cases', model: model('balanced') },
]

// ── Review (parallel swarm — each domain agent also reads context itself) ──

phase('Review')

interface Finding { id: string; severity: Severity | 'info'; file: string; line: number; description: string; suggestion: string }
interface DomainResult { domain: string; findings: Finding[] }

const reviewResults = await parallel<DomainResult>(
  DOMAINS.map((d) => () =>
    agent(
      renderPrompt(reviewDomainTemplate, { domain: d.domain, domainPrefix: d.prefix, domainFocus: d.focus }),
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

const reportLines = [
  '# Review Report\n',
  `**Findings:** ${deduped.length} unique (${critical.length} high/critical)\n`,
  '## Findings\n',
  '| ID | Severity | File | Line | Description | Suggestion |',
  '|---|---|---|---|---|---|',
  ...deduped.map((f) => `| ${f.id} | ${f.severity} | ${f.file} | ${f.line} | ${f.description} | ${f.suggestion} |`),
  '',
]

// Commit agent (one remaining mechanical agent — needs to know the branch for path)
await agent(
  `Write this content to "docs/epics/$(git rev-parse --abbrev-ref HEAD)/REVIEW-REPORT.md" (create dirs if needed).
Commit: git add "docs/epics/$(git rev-parse --abbrev-ref HEAD)/REVIEW-REPORT.md" && git commit -m "review: REVIEW-REPORT.md (${deduped.length} findings)"

CONTENT:
${reportLines.join('\n')}`,
  { label: 'commit-report', model: model('fast') },
)

if (critical.length > 0) log(`${critical.length} high/critical — remediation needed`)

export const __workflowResult = {
  totalFindings: deduped.length, criticalFindings: critical.length, canMerge: critical.length === 0,
}
