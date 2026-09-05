import { renderPrompt, parseAgentJsonStrict } from './shared/utils'
import { model } from './shared/models'
import { batchCommandPrompt, setBatchCacheKey, parseBatchResult } from './shared/batch'
import { writeFileSteps, writeFileFromSteps, writeFileBlobSha } from './shared/write-steps'
import { commitFilesSteps, commitFilesFromSteps } from './shared/commit-steps'
import awakeScanTemplate from './prompts/awake-scan.md'
import awakeDistillTemplate from './prompts/awake-distill.md'

export const meta = {
  name: 'datum-awake',
  description: 'Scan repo rules and conventions, distill into cached agent preamble (llms.txt pattern)',
  phases: [
    { title: 'Scan', detail: 'read CLAUDE.md, AGENTS.md, configs, test files, code patterns' },
    { title: 'Distill', detail: 'compress into agent-preamble.md + agent-preamble-full.md' },
    { title: 'Commit', detail: 'write preamble files and commit' },
  ],
}

// Resume cache key (#354): stamped into the write/commit batches below so an
// edited repo between runs is a cache miss. Standalone launches may pass none.
const awakeArgs = (typeof args === 'object' && args) ? (args as { configFingerprint?: string }) : {}
setBatchCacheKey(awakeArgs.configFingerprint || '')

// ── Scan ──

phase('Scan')

const scanRaw = await agent(
  renderPrompt(awakeScanTemplate, { wt: '.' }),
  { label: 'scan-repo', model: model('balanced') },
)

// Strict: a silent {language:'unknown', rules:[], ...} fallback would feed
// straight into Distill and get committed to agent-preamble.md as though it
// were a real scan — every future agent call would then load a bogus/empty
// preamble with no trace the scan itself ever failed to parse.
interface ScanResult {
  language: string
  rules: unknown[]
  test_conventions: Record<string, unknown>
  code_patterns: Record<string, unknown>
  file_conventions: Record<string, unknown>
}
const scan = parseAgentJsonStrict<ScanResult>(scanRaw as string, 'scan-repo')
log(`Scanned: ${scan.language} project, ${scan.rules?.length || 0} rule sources`)

// ── Distill ──

phase('Distill')

const distillRaw = await agent(
  renderPrompt(awakeDistillTemplate, { scanResults: JSON.stringify(scan) }),
  { label: 'distill-preamble', model: model('balanced') },
)

interface DistillResult {
  preamble: string
  preamble_full: string
  token_estimate: { preamble: number; full: number }
}

// Strict: same reasoning as `scan` above — a placeholder "No rules
// extracted." preamble would be written to disk and committed as though it
// were the real distilled result, silently degrading every subsequent
// agent's preamble with no trace of the failure.
const distill: DistillResult = parseAgentJsonStrict<DistillResult>(distillRaw as string, 'distill-preamble')

log(`Preamble: ~${distill.token_estimate.preamble} tokens, Full: ~${distill.token_estimate.full} tokens`)

// ── Commit ──

phase('Commit')

const preamblePath = 'skills/src/prompts/agent-preamble.md'
const fullPath = 'skills/src/prompts/agent-preamble-full.md'

// Script-held content: written through byte-verified heredoc batches and
// committed by a commitFilesSteps batch (shared/write-steps.ts,
// shared/commit-steps.ts) — never handed to a runner as "write these two
// files, then commit both", whose reply was discarded.
const PREAMBLE_NAMES = { mkdir: 'mkdir-preamble', write: 'write-preamble', sha: 'sha-preamble' }
const FULL_NAMES = { mkdir: 'mkdir-full', write: 'write-full', sha: 'sha-full' }
const writeSteps = [
  ...writeFileSteps({ path: preamblePath, content: distill.preamble, names: PREAMBLE_NAMES }),
  ...writeFileSteps({ path: fullPath, content: distill.preamble_full, names: FULL_NAMES }),
]
const writeResult = parseBatchResult(
  await agent(batchCommandPrompt(writeSteps), { label: 'write-preambles', model: model('fast') }),
  writeSteps,
)
for (const verdict of [
  writeFileFromSteps(writeResult, { path: preamblePath, expectedSha: writeFileBlobSha(distill.preamble), prefix: 'preamble', names: PREAMBLE_NAMES }),
  writeFileFromSteps(writeResult, { path: fullPath, expectedSha: writeFileBlobSha(distill.preamble_full), prefix: 'preamble_full', names: FULL_NAMES }),
]) {
  if (!verdict.ok) throw new Error(verdict.error)
}

const commitStepList = commitFilesSteps({ wt: '.', files: [preamblePath, fullPath], message: 'awake: regenerate agent preamble from repo scan' })
const commit = commitFilesFromSteps(parseBatchResult(
  await agent(batchCommandPrompt(commitStepList), { label: 'commit-preambles', model: model('fast') }),
  commitStepList,
))
if (commit.error) throw new Error(`awake_commit_failed: ${commit.error}`)
if (commit.nothingToCommit) log('Preambles unchanged since the last awake — nothing to commit')
else log(`Written and committed: ${preamblePath} + ${fullPath} (${commit.sha})`)
log('Run "bash scripts/build-workflows.sh" to rebuild with new preamble')

export const __workflowResult = {
  language: scan.language,
  ruleSources: scan.rules?.length || 0,
  preambleTokens: distill.token_estimate.preamble,
  fullTokens: distill.token_estimate.full,
}
