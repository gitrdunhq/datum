// validate-steps.ts — the Validate phase's independent test run, as one
// datum-cli batch. The second step PRODUCES .datum/last-test-signal.json from
// the same shell ($TEST_EXIT set by testRunCommand) so `datum gate validate`
// has a real, deterministic producer — it used to read a file nothing wrote
// and pass silently when it was absent (docs/FLOW.md gap 3).
// tested-by: skills/src/shared/validate-steps.test.ts

import type { BatchStep } from './batch'
import { testRunCommand } from './utils'

export const TEST_SIGNAL_PATH = '.datum/last-test-signal.json'

export function validateVerifySteps(testCommand: string, cwd: string): BatchStep[] {
  const signalPath = `${cwd.replace(/\/+$/, '')}/${TEST_SIGNAL_PATH}`
  // JSON-quote the command for the signal file (jq is already a hard
  // dependency of the lane-state steps).
  return [
    { name: 'test-verify', command: testRunCommand(testCommand, cwd, 'validate-verify'), tolerant: true },
    {
      name: 'write-signal',
      command:
        `mkdir -p "$(dirname "${signalPath}")" && ` +
        `jq -n --arg status "$([ "\${TEST_EXIT:-1}" -eq 0 ] && echo pass || echo fail)" ` +
        `--argjson exit_code "\${TEST_EXIT:-1}" --arg command ${JSON.stringify(testCommand)} ` +
        `--arg recorded_at "$(date +%Y-%m-%dT%H:%M:%S)" ` +
        `'{status: $status, exit_code: $exit_code, command: $command, recorded_at: $recorded_at}' > "${signalPath}" && ` +
        `cat "${signalPath}"`,
      tolerant: true,
    },
  ]
}
