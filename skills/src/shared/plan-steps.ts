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
import { utf8Encode } from './utf8'
import { gitBlobSha } from './sha1'

const q = (s: string): string => `"${s.replace(/(["\\`$])/g, '\\$1')}"`
const HEREDOC_EOF = 'DATUM_TASKS_EOF'

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

export function planBuildSteps(o: PlanBuildOpts): BatchStep[] {
  if (o.tasksJson.includes('\n')) throw new Error('planBuildSteps: tasksJson must be a single line (JSON.stringify without indentation)')
  if (o.tasksJson.includes(HEREDOC_EOF)) throw new Error(`planBuildSteps: tasksJson contains the heredoc terminator ${HEREDOC_EOF}`)
  const tasksPath = `${o.epicDir}/tasks.json`
  return [
    { name: 'mkdir', command: `mkdir -p ${q(o.epicDir)}` },
    { name: 'write-tasks', command: `cat > ${q(tasksPath)} <<'${HEREDOC_EOF}'\n${o.tasksJson}\n${HEREDOC_EOF}` },
    { name: 'tasks-sha', command: `git hash-object ${q(tasksPath)}`, tolerant: true },
    { name: 'lane-plan', command: lanePlanCommand(o.epicDir) },
  ]
}

/** The git blob sha of what the heredoc writes: the JSON bytes plus a trailing newline. */
export function tasksJsonBlobSha(tasksJson: string): string {
  return gitBlobSha(utf8Encode(tasksJson + '\n'))
}

export function planBuildFromSteps(result: BatchResult, expectedSha: string): { ok: boolean; error: string } {
  if (result.missing) return { ok: false, error: `plan_build_failed: ${describeFailure(result, 'lane-plan')}` }
  for (const name of ['mkdir', 'write-tasks']) {
    const step = stepResult(result, name)
    if (!step) return { ok: false, error: `plan_build_failed: ${name} step did not run` }
    if (step.exit_code !== 0) return { ok: false, error: `plan_build_failed: ${name} exited ${step.exit_code} — ${tail(step)}` }
  }
  const sha = (stepResult(result, 'tasks-sha')?.stdout || '').trim()
  if (sha !== expectedSha) {
    return { ok: false, error: `plan_write_mismatch: tasks.json on disk is blob ${sha || '(none)'}, the script wrote ${expectedSha} — the runner did not copy the heredoc verbatim` }
  }
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
