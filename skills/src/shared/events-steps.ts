// #520: the run event log `datum retrospect` reads. datum-go records one
// event per lane outcome after Act through `datum events lane`, one
// tolerant step per lane in a single batch; the CLI maps a batch run id
// (`<run>-b2`) to its base run and classifies the error's prefix.

import type { BatchStep } from './batch'

const q = (s: string): string => `"${s.replace(/(["\\`$])/g, '\\$1')}"`

/** The slice of a LaneOutcome the event needs; status is any lane status string. */
export interface LaneEventInput {
  task_id?: string
  status: string
  stage?: string | null
  error?: string | null
}

export interface LaneEventStepsOpts {
  runId: string
  results: Record<string, LaneEventInput>
}

export function laneEventSteps(o: LaneEventStepsOpts): BatchStep[] {
  return Object.keys(o.results).map((id) => {
    const r = o.results[id]
    const reason = r.error ? ` --reason ${q(r.error.replace(/\s+/g, ' ').slice(0, 500))}` : ''
    return {
      name: `event-${id.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`,
      command: `datum events lane --run-id ${q(o.runId)} --task-id ${q(id)} --status ${q(r.status)} --stage ${q(r.stage || 'UNKNOWN')}${reason}`,
      tolerant: true,
    }
  })
}
