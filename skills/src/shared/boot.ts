// datum-go boot seam: skill-path resolution + the boot (config/state) prompt.
// Pure functions — no sandbox globals — so vitest covers them directly.
// tested-by: skills/src/shared/boot.test.ts

import { skillPath } from './models'

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
 * Prompt for the single boot agent that reads config + pipeline state.
 *
 * `configFingerprint` (#354) is the output of `datum config-fingerprint`,
 * passed by the launcher via args. Workflow resume replays any agent()
 * call whose (prompt, opts) is unchanged, so embedding the fingerprint is
 * what makes an edited config invalidate the cached read — scripts have no
 * filesystem access and Date.now() is unavailable, so it cannot be derived
 * in here.
 */
export function bootPrompt(configFingerprint: string = ''): string {
  const stamp = configFingerprint ? `\n(config fingerprint: ${configFingerprint})` : ''
  return `Return a JSON object with four fields:
1. "config": contents of .datum/config.json (or {} if missing)
2. "state": contents of .datum/pipeline-state.json (or null if missing)
3. "localSkills": the file names (basename only, e.g. "datum-plan.js") inside ${LOCAL_SKILLS_DIR}/ (or [] if that directory is missing)
4. "repoRoot": the absolute path printed by \`git rev-parse --show-toplevel\` (or "" if not a git repo)
Output raw JSON only.${stamp}`
}

/** Logged once when the launcher did not pass args.configFingerprint. */
export const NO_FINGERPRINT_WARNING =
  'args.configFingerprint not set — on Workflow resume the cached config read is replayed and a config ' +
  'edit is NOT picked up (#354). Launch with args: { ..., configFingerprint: "<output of `datum config-fingerprint`>" }.'

