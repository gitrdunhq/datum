import { renderPrompt, parseAgentJson } from './shared/utils'
import { model } from './shared/models'
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

// ── Scan ──

phase('Scan')

const scanRaw = await agent(
  renderPrompt(awakeScanTemplate, { wt: '.' }),
  { label: 'scan-repo', model: model('balanced') },
)

const scan = parseAgentJson(scanRaw as string, { language: 'unknown', rules: [], test_conventions: {}, code_patterns: {}, file_conventions: {} })
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

const distill: DistillResult = parseAgentJson(distillRaw as string, {
  preamble: '# Project\n\n> No rules extracted.\n',
  preamble_full: '# Project — Full Context\n\n> No rules extracted.\n',
  token_estimate: { preamble: 0, full: 0 },
})

log(`Preamble: ~${distill.token_estimate.preamble} tokens, Full: ~${distill.token_estimate.full} tokens`)

// ── Commit ──

phase('Commit')

const preamblePath = 'skills/src/prompts/agent-preamble.md'
const fullPath = 'skills/src/prompts/agent-preamble-full.md'

await agent(
  `Write these two files:

FILE 1: "${preamblePath}"
${distill.preamble}

FILE 2: "${fullPath}"
${distill.preamble_full}

Then commit both:
git add "${preamblePath}" "${fullPath}" && git commit -m "awake: regenerate agent preamble from repo scan"`,
  { label: 'commit-preambles', model: model('fast') },
)

log(`Written: ${preamblePath} + ${fullPath}`)
log('Run "bash scripts/build-workflows.sh" to rebuild with new preamble')

export const __workflowResult = {
  language: scan.language,
  ruleSources: scan.rules?.length || 0,
  preambleTokens: distill.token_estimate.preamble,
  fullTokens: distill.token_estimate.full,
}
