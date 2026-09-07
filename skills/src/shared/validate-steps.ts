// validate-steps.ts — the Validate phase's independent test run, as one
// datum-cli batch. The second step PRODUCES .datum/last-test-signal.json from
// the same shell ($TEST_EXIT set by testRunCommand) so `datum gate validate`
// has a real, deterministic producer — it used to read a file nothing wrote
// and pass silently when it was absent (docs/FLOW.md gap 3).
// tested-by: skills/src/shared/validate-steps.test.ts

import type { BatchStep } from './batch'
import { testRunCommand } from './utils'

export const TEST_SIGNAL_PATH = '.datum/last-test-signal.json'

/**
 * #425/#424: buildCommand is optional — null/undefined/'' means no
 * `build-verify` step, and the signal file keeps its pre-existing shape
 * unchanged (no repo that never sets `.datum/config.json`'s build_command
 * sees any behaviour change here).
 */
export function validateVerifySteps(testCommand: string, cwd: string, buildCommand?: string | null): BatchStep[] {
  const signalPath = `${cwd.replace(/\/+$/, '')}/${TEST_SIGNAL_PATH}`
  const steps: BatchStep[] = [
    { name: 'test-verify', command: testRunCommand(testCommand, cwd, 'validate-verify'), tolerant: true },
    // The signal is written immediately after test-verify, from the SAME
    // shell's $TEST_EXIT, before build-verify (below) can overwrite that
    // variable with its own exit code — the signal is about test_command
    // only; build_command's independent exit code is read from its own
    // batch step by name, never through $TEST_EXIT.
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
  if (buildCommand) {
    steps.push({ name: 'build-verify', command: testRunCommand(buildCommand, cwd, 'validate-build-verify'), tolerant: true })
  }
  return steps
}
