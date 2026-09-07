// datum-go boot seam: skill-path resolution + the boot (config/state) prompt.
// Pure functions — no sandbox globals — so vitest covers them directly.
// tested-by: skills/src/shared/boot.test.ts

import { skillPath, mergeConfig } from './models'
import { type BatchStep, type BatchResult, stepResult, stepStdout, describeFailure } from './batch'
import { parseAgentJson } from './utils'

/** Repo-local, gitignored copy of skills/*.js written by `datum init` (#353). */
export const LOCAL_SKILLS_DIR = '.datum/skills'

export interface SkillResolution {
  path: string
  /** True when `path` is absolute and not under `repoRoot` — the Workflow
   *  harness will refuse it ("scriptPath must be a script path this tool
   *  returned, or a file you can already read"). */
  outsideRepo: boolean
}

function isUnder(path: string, root: string): boolean {
  const r = root.replace(/\/+$/, '')
  return path === r || path.startsWith(r + '/')
}

/**
 * Resolve the scriptPath for a sub-workflow (#353).
 *
 * Preference order: the repo-local `.datum/skills/<name>.js` copy when the
 * boot agent reported it exists, else `skills_dir` from config (absolute
 * path kept as-is so the datum repo itself keeps working).
 */
export function resolveSkillPath(opts: {
  name: string
  skillsDir: string
  localSkills: string[]
  repoRoot: string
}): SkillResolution {
  const file = `${opts.name}.js`
  if ((opts.localSkills || []).includes(file)) {
    return { path: `${LOCAL_SKILLS_DIR}/${file}`, outsideRepo: false }
  }
  const path = skillPath(opts.skillsDir || '', opts.name)
  const outsideRepo = path.startsWith('/') && !!opts.repoRoot && !isUnder(path, opts.repoRoot)
  return { path, outsideRepo }
}

/** One-line hint logged when an out-of-repo skills_dir is about to be used. */
export function skillsDirHint(skillsDir: string): string {
  return (
    `skills_dir "${skillsDir}" is outside this repo and the Workflow harness will refuse it — ` +
    `run \`datum init --refresh-skills\` to copy the skills into ${LOCAL_SKILLS_DIR}/, ` +
    `or run \`/add-dir ${skillsDir}\` before launching.`
  )
}

/**
 * Deterministic replacement for the old boot-agent relay (bootPrompt, #353/
 * #354/#355/#524): an LLM was asked to read two config files, pipeline
 * state, list a directory, and report the repo root and current branch —
 * six deterministic facts that drive test_command/language/models,
 * auto-resume, the stale-state guard, and which workflow bundles run.
 * Every one of those is now a plain shell command run in one datum-cli
 * batch (see shared/batch.ts) and parsed by bootFromSteps below, matching
 * the datum-plan.ts config-batch conversion (commit a7093d2).
 *
 * `repo-config` is the only non-tolerant step: its absence is fatal (no
 * `.datum/config.json` means `datum init` was never run) and must stop the
 * batch rather than silently proceeding on a half-read state. Every other
 * step degrades to an empty/null value on failure and is validated by
 * bootFromSteps instead.
 */
export function bootSteps(): BatchStep[] {
  return [
    { name: 'global-config', command: "cat ~/.datum/config.json 2>/dev/null || echo '{}'", tolerant: true },
    { name: 'repo-config', command: 'cat .datum/config.json' },
    { name: 'state', command: 'cat .datum/pipeline-state.json 2>/dev/null || echo null', tolerant: true },
    {
      name: 'local-skills',
      command: `for f in ${LOCAL_SKILLS_DIR}/*.js; do [ -e "$f" ] && basename "$f" .js; done`,
      tolerant: true,
    },
    { name: 'repo-root', command: 'git rev-parse --show-toplevel', tolerant: true },
    { name: 'branch', command: 'git rev-parse --abbrev-ref HEAD', tolerant: true },
  ]
}

export interface BootResult {
  config: Record<string, unknown>
  state: unknown
  localSkills: string[]
  repoRoot: string
  currentBranch: string
}

/**
 * Pure reduction of a bootSteps() BatchResult into the shape datum-go.ts
 * already consumes (`boot.config`, `boot.state`, `boot.localSkills`,
 * `boot.repoRoot`, `boot.currentBranch`).
 *
 * Throws (never returns a half-valid result) when:
 *  - the repo-config step is missing/failed, or its stdout isn't valid
 *    JSON — "missing .datum/config.json — run datum init first"
 *  - the state step's stdout is present but not valid JSON — a corrupt
 *    pipeline-state.json must never be silently treated as "no state"
 *    (mirrors datum/pipeline_state.py's PipelineStateCorruptError)
 *  - repoRoot or currentBranch come back empty (not a git repo / detached
 *    HEAD) — every caller of these needs a real value, not ""
 */
export function bootFromSteps(result: BatchResult): BootResult {
  const repoConfigStep = stepResult(result, 'repo-config')
  if (!repoConfigStep || repoConfigStep.exit_code !== 0) {
    throw new Error('missing .datum/config.json — run datum init first')
  }
  let repoCfgParsed: Record<string, unknown>
  try {
    repoCfgParsed = JSON.parse(repoConfigStep.stdout || '')
  } catch {
    throw new Error('missing .datum/config.json — run datum init first')
  }
  let globalCfgParsed: Record<string, unknown> = {}
  try {
    globalCfgParsed = JSON.parse(stepStdout(result, 'global-config') || '{}')
  } catch {
    globalCfgParsed = {}
  }
  const config = mergeConfig(globalCfgParsed, repoCfgParsed)

  const stateRaw = (stepStdout(result, 'state') || 'null').trim()
  let state: unknown = null
  if (stateRaw && stateRaw !== 'null') {
    try {
      state = JSON.parse(stateRaw)
    } catch (exc) {
      throw new Error(
        `pipeline_state_corrupt: .datum/pipeline-state.json exists but could not be parsed as JSON: ${(exc as Error).message}`,
      )
    }
  }

  const localSkills = (stepStdout(result, 'local-skills') || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith('.js') ? s : `${s}.js`))

  const repoRoot = (stepStdout(result, 'repo-root') || '').trim()
  const currentBranch = (stepStdout(result, 'branch') || '').trim()
  if (!repoRoot) {
    throw new Error('boot: could not determine repo root (`git rev-parse --show-toplevel` failed — not a git repo?)')
  }
  if (!currentBranch) {
    throw new Error('boot: could not determine current branch (`git rev-parse --abbrev-ref HEAD` failed)')
  }

  return { config, state, localSkills, repoRoot, currentBranch }
}

/**
 * Wrap a shell one-liner so the agent runs it instead of asking "what is my
 * task?" (#355). The sandbox has no non-LLM shell primitive, so every
 * shell-out goes through an agent; the instruction has to be explicit.
 */
export function runCommandPrompt(command: string): string {
  return (
    'Run exactly this command with the Bash tool and return only its stdout, nothing else. ' +
    'Do not ask for clarification, do not message anyone, do not summarise or explain — ' +
    'this prompt is the whole task.\n\n' +
    command
  )
}

// ── New-epic bootstrap: `datum init --name <slug> --json` as a batch ──
//
// The new-epic-check agent decides SAME vs DIFFERENT and returns a slug; the
// bootstrap itself runs here so the script parses `datum init`'s own JSON.
// The agent used to run init and echo the JSON — an echoed epicBranch
// became resolvedBranch with nothing verifying the init actually ran.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function newEpicBootstrapSteps(slug: string): BatchStep[] {
  if (!SLUG_RE.test(slug)) throw new Error(`newEpicBootstrapSteps: invalid slug ${JSON.stringify(slug)} — expected kebab-case [a-z0-9-]`)
  return [{ name: 'init', command: `datum init --name ${slug} --json` }]
}

export function newEpicBootstrapFromSteps(result: BatchResult, slug: string): { ok: boolean; epicBranch: string; error: string } {
  const none = { ok: false, epicBranch: '' }
  if (result.missing) return { ...none, error: describeFailure(result, 'init') }
  const step = stepResult(result, 'init')
  if (!step) return { ...none, error: 'init step did not run' }
  if (step.exit_code !== 0) {
    const tail = (step.stderr || step.stdout || '').trim().split('\n').slice(-3).join(' | ')
    return { ...none, error: `datum init --name ${slug} --json exited ${step.exit_code} — ${tail}` }
  }
  const parsed = parseAgentJson<{ epicBranch?: unknown } | null>(step.stdout || '', null)
  const epicBranch = parsed && typeof parsed.epicBranch === 'string' ? parsed.epicBranch.trim() : ''
  if (!epicBranch) return { ...none, error: `datum init printed no epicBranch — ${(step.stdout || '').trim().slice(0, 200)}` }
  return { ok: true, epicBranch, error: '' }
}

/** Logged once when the launcher did not pass args.configFingerprint. */
export const NO_FINGERPRINT_WARNING =
  'args.configFingerprint not set — on Workflow resume the cached config read is replayed and a config ' +
  'edit is NOT picked up (#354). Launch with args: { ..., configFingerprint: "<output of `datum config-fingerprint`>" }.'

