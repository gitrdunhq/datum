import { runBatch } from './shared/agents'
import { renderPrompt, parseAgentJsonStrict } from './shared/utils'
import { model } from './shared/models'
import { batchCommandPrompt, setBatchCacheKey, setBatchRoot, parseBatchResult } from './shared/batch'
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
const awakeArgs = (typeof args === 'object' && args) ? (args as { configFingerprint?: string; repoRoot?: string }) : {}
setBatchCacheKey(awakeArgs.configFingerprint || '')
setBatchRoot(awakeArgs.repoRoot || '')

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
  token_estimate: { preamble: number }
}

// Strict: same reasoning as `scan` above — a placeholder "No rules
// extracted." preamble would be written to disk and committed as though it
// were the real distilled result, silently degrading every subsequent
// agent's preamble with no trace of the failure.
const distill: DistillResult = parseAgentJsonStrict<DistillResult>(distillRaw as string, 'distill-preamble')

log(`Preamble: ~${distill.token_estimate.preamble} tokens`)

// ── Commit ──

phase('Commit')

const preamblePath = 'skills/src/prompts/agent-preamble.md'

// Script-held content: written through a byte-verified heredoc batch and
// committed by a commitFilesSteps batch (shared/write-steps.ts,
// shared/commit-steps.ts) — never handed to a runner as "write this file,
// then commit it", whose reply was discarded.
const PREAMBLE_NAMES = { mkdir: 'mkdir-preamble', write: 'write-preamble', sha: 'sha-preamble' }
const writeSteps = writeFileSteps({ path: preamblePath, content: distill.preamble, names: PREAMBLE_NAMES })
const writeResult = await runBatch(writeSteps, { label: 'write-preamble', model: model('fast') })
const verdict = writeFileFromSteps(writeResult, { path: preamblePath, expectedSha: writeFileBlobSha(distill.preamble), prefix: 'preamble', names: PREAMBLE_NAMES })
if (!verdict.ok) throw new Error(verdict.error)

const commitStepList = commitFilesSteps({ wt: '.', files: [preamblePath], message: 'awake: regenerate agent preamble from repo scan' })
const commit = commitFilesFromSteps(await runBatch(commitStepList, { label: 'commit-preamble', model: model('fast') }))
if (commit.error) throw new Error(`awake_commit_failed: ${commit.error}`)
if (commit.nothingToCommit) log('Preamble unchanged since the last awake — nothing to commit')
else log(`Written and committed: ${preamblePath} (${commit.sha})`)
log('Run "bash scripts/build-workflows.sh" to rebuild with new preamble')

export const __workflowResult = {
  language: scan.language,
  ruleSources: scan.rules?.length || 0,
  preambleTokens: distill.token_estimate.preamble,
}
