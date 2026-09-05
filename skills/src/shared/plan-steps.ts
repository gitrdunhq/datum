// plan-steps.ts — the Plan phase's build and skeleton batches.
//
// datum-plan used to hand an LLM runner the whole tasks.json text inside a
// prompt ("Write this JSON to <path>") and trust its {"exit_code": 0}. A
// runner that abridged, re-serialised or "fixed" a task wrote a different
// plan than the one the decompose agent produced, with no trace — the
// schema gate still passed. The write is now a quoted heredoc inside a
// batch step, and the on-disk blob sha is compared against the sha of the
// exact bytes the script intended to write (plan_write_mismatch).
// tested-by: skills/src/shared/plan-steps.test.ts

import { stepResult, describeFailure, type BatchResult, type BatchStep } from './batch'
import { writeFileSteps, writeFileBlobSha, writeFileFromSteps, HEREDOC_TERMINATOR } from './write-steps'

const q = (s: string): string => `"${s.replace(/(["\\`$])/g, '\\$1')}"`

function tail(step: { stdout: string; stderr: string }): string {
  return (step.stderr || step.stdout || '').trim().split('\n').slice(-3).join(' | ')
}

export interface PlanBuildOpts {
  epicDir: string
  /** JSON.stringify(tasks) — one line. */
  tasksJson: string
}

export function lanePlanCommand(epicDir: string): string {
  return `datum lane-plan --input ${q(`${epicDir}/tasks.json`)} --output ${q(`${epicDir}/lane-plan.json`)} --md-output ${q(`${epicDir}/TASKS.md`)}`
}

const TASKS_WRITE_NAMES = { mkdir: 'mkdir', write: 'write-tasks', sha: 'tasks-sha' }

export function planBuildSteps(o: PlanBuildOpts): BatchStep[] {
  if (o.tasksJson.includes('\n')) throw new Error('planBuildSteps: tasksJson must be a single line (JSON.stringify without indentation)')
  if (o.tasksJson.includes(HEREDOC_TERMINATOR)) throw new Error(`planBuildSteps: tasksJson contains the heredoc terminator ${HEREDOC_TERMINATOR}`)
  return [
    ...writeFileSteps({ path: `${o.epicDir}/tasks.json`, content: o.tasksJson, names: TASKS_WRITE_NAMES }),
    { name: 'lane-plan', command: lanePlanCommand(o.epicDir) },
  ]
}

/** The git blob sha of what the heredoc writes: the JSON bytes plus a trailing newline. */
export function tasksJsonBlobSha(tasksJson: string): string {
  return writeFileBlobSha(tasksJson)
}

export function planBuildFromSteps(result: BatchResult, expectedSha: string): { ok: boolean; error: string } {
  if (result.missing) return { ok: false, error: `plan_build_failed: ${describeFailure(result, 'lane-plan')}` }
  const written = writeFileFromSteps(result, { path: 'tasks.json', expectedSha, prefix: 'plan', names: TASKS_WRITE_NAMES })
  if (!written.ok) return { ok: false, error: written.error.replace(/^plan_write_failed: /, 'plan_build_failed: ') }
  const lanePlan = stepResult(result, 'lane-plan')
  if (!lanePlan) return { ok: false, error: 'plan_build_failed: lane-plan step did not run' }
  if (lanePlan.exit_code !== 0) return { ok: false, error: `plan_build_failed: datum lane-plan exited ${lanePlan.exit_code} — ${tail(lanePlan)}` }
  return { ok: true, error: '' }
}

export interface SkeletonBatchOpts {
  epicDir: string
  language: string
}

export function skeletonBatchSteps(o: SkeletonBatchOpts): BatchStep[] {
  const skeletonDir = `${o.epicDir}/skeletons`
  return [
    { name: 'mkdir', command: `mkdir -p ${q(skeletonDir)}` },
    { name: 'skeleton', command: `datum skeleton --batch --language ${o.language} --tasks ${q(`${o.epicDir}/lane-plan.json`)} --output-dir ${q(skeletonDir)}` },
  ]
}

export function skeletonBatchFromSteps(result: BatchResult): { ok: boolean; error: string } {
  if (result.missing) return { ok: false, error: `skeleton_batch_failed: ${describeFailure(result, 'skeleton')}` }
  const step = stepResult(result, 'skeleton')
  if (!step) {
    const mk = stepResult(result, 'mkdir')
    return { ok: false, error: `skeleton_batch_failed: skeleton step did not run${mk && mk.exit_code !== 0 ? ` (mkdir exited ${mk.exit_code} — ${tail(mk)})` : ''}` }
  }
  if (step.exit_code !== 0) return { ok: false, error: `skeleton_batch_failed: datum skeleton exited ${step.exit_code} — ${tail(step)}` }
  return { ok: true, error: '' }
}
