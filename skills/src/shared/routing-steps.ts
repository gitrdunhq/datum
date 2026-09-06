// routing-steps.ts — leave a consumer's tree clean after the triage gate.
//
// Plan writes `.datum/routing.json` for `datum gate triage` and no longer
// commits it (run state; 946c725a). A consumer repo that committed the file
// under an earlier datum version is therefore left with a modified tracked
// file after every plan run (caliper eedom wf_4f739141-c8c). Once the gate
// has read the fresh decision, a TRACKED routing.json is restored to its
// committed content and the condition is named so the operator can untrack
// it; an untracked one is left exactly as written.
// tested-by: skills/src/shared/routing-steps.test.ts

import { stepStdout, type BatchResult, type BatchStep } from './batch'

export const ROUTING_PATH = '.datum/routing.json'

export function routingRestoreSteps(): BatchStep[] {
  return [
    {
      name: 'routing-restore',
      command:
        `if git ls-files --error-unmatch ${ROUTING_PATH} >/dev/null 2>&1; then ` +
        `git checkout -- ${ROUTING_PATH} && printf 'tracked\\n'; ` +
        `else printf 'untracked\\n'; fi`,
    },
  ]
}

export interface RoutingRestoreOutcome {
  /** null when the step did not run — a named absence, never "untracked". */
  tracked: boolean | null
  note: 'routing_json_tracked' | 'routing_json_untracked' | 'routing_restore_unchecked'
}

export function routingRestoreFromSteps(result: BatchResult): RoutingRestoreOutcome {
  const out = stepStdout(result, 'routing-restore')
  if (out === null) return { tracked: null, note: 'routing_restore_unchecked' }
  if (out.trim() === 'tracked') return { tracked: true, note: 'routing_json_tracked' }
  if (out.trim() === 'untracked') return { tracked: false, note: 'routing_json_untracked' }
  return { tracked: null, note: 'routing_restore_unchecked' }
}
