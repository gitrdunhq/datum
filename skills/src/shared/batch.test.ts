// #368 — consecutive command-runner agent() calls collapse into ONE
// datum-cli call whose script lists the commands in order and returns one
// JSON array with per-step exit codes and stdout, failing fast on the first
// non-zero exit unless the step is tolerant.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  batchScript,
  batchCommandPrompt,
  setBatchCacheKey,
  setBatchRoot,
  parseBatchResult,
  stepStdout,
  stepResult,
  describeFailure,
  validateBatchSteps,
  type BatchStep,
} from './batch'

function runScript(script: string): string {
  return execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

describe('batchScript — step validation', () => {
  it('rejects empty batches, bad names, duplicates and empty commands', () => {
    expect(() => validateBatchSteps([])).toThrow(/no steps/)
    expect(() => validateBatchSteps([{ name: 'Bad Name', command: 'true' }])).toThrow(/invalid step name/)
    expect(() => validateBatchSteps([{ name: 'a', command: 'true' }, { name: 'a', command: 'true' }])).toThrow(/duplicate/)
    expect(() => validateBatchSteps([{ name: 'a', command: '  ' }])).toThrow(/empty command/)
  })

  it('lists every command in order and only fail-fasts after non-tolerant steps', () => {
    const script = batchScript([
      { name: 'one', command: 'echo 1' },
      { name: 'two', command: 'grep -c nothing /dev/null', tolerant: true },
      { name: 'three', command: 'echo 3' },
    ])
    const i1 = script.indexOf('echo 1')
    const i2 = script.indexOf('grep -c nothing')
    const i3 = script.indexOf('echo 3')
    expect(i1).toBeGreaterThan(-1)
    expect(i2).toBeGreaterThan(i1)
    expect(i3).toBeGreaterThan(i2)
    // exactly two fail-fast guards: after "one" and after "three", none after the tolerant "two"
    const guards = script.split('\n').filter((l) => l.includes('-ne 0 ]; then __end; exit 0; fi'))
    expect(guards).toHaveLength(2)
    const twoBlock = script.slice(i2, i3)
    expect(twoBlock).not.toContain('exit 0')
  })
})

describe('batchScript — executed under real bash', () => {
  it('returns one JSON array with per-step exit codes, stdout and stderr', () => {
    const steps: BatchStep[] = [
      { name: 'hello', command: 'printf "hi\\n"' },
      { name: 'nomatch', command: 'printf "x\\n" | grep -c zzz', tolerant: true },
      { name: 'warn', command: 'echo out; echo err >&2' },
    ]
    const out = runScript(batchScript(steps))
    const r = parseBatchResult(out, steps)
    expect(r.missing).toBe(false)
    expect(r.failed).toBeNull()
    expect(r.steps.map((s) => s.name)).toEqual(['hello', 'nomatch', 'warn'])
    expect(stepStdout(r, 'hello')).toBe('hi\n')
    expect(stepResult(r, 'nomatch')?.exit_code).toBe(1)
    expect(stepStdout(r, 'nomatch')).toBe('0\n')
    expect(stepStdout(r, 'warn')).toBe('out\n')
    expect(stepResult(r, 'warn')?.stderr).toBe('err\n')
  })

  it('stops at the first non-tolerant failure and never runs the later steps', () => {
    const steps: BatchStep[] = [
      { name: 'ok', command: 'echo first' },
      { name: 'boom', command: 'echo "bad thing" >&2; exit 3' },
      { name: 'never', command: 'echo should-not-run' },
    ]
    // `exit` inside a step group exits the whole script — use a subshell-free failure instead
    steps[1].command = 'echo "bad thing" >&2; false'
    const r = parseBatchResult(runScript(batchScript(steps)), steps)
    expect(r.steps.map((s) => s.name)).toEqual(['ok', 'boom'])
    expect(r.failed?.name).toBe('boom')
    expect(r.failed?.exit_code).toBe(1)
    expect(stepStdout(r, 'never')).toBeNull()
    expect(describeFailure(r, 'lane-intake:T1')).toContain('step "boom" exited 1')
    expect(describeFailure(r, 'lane-intake:T1')).toContain('bad thing')
  })

  it('lets a later step see a variable assigned by an earlier one', () => {
    const steps: BatchStep[] = [
      { name: 'set', command: '__root=$(printf "/some/where"); printf "%s" "$__root"' },
      { name: 'use', command: 'printf "%s/child" "$__root"' },
    ]
    const r = parseBatchResult(runScript(batchScript(steps)), steps)
    expect(stepStdout(r, 'use')).toBe('/some/where/child')
  })

  it('preserves heredoc-written patterns verbatim (the #288/#289 quoting path)', () => {
    const steps: BatchStep[] = [
      {
        name: 'pattern',
        command: 'PATFILE=$(mktemp)\ncat > "$PATFILE" <<\'PATTERN_EOF\'\n[+][[:space:]]*(it\\(|test\\(|describe\\()\nPATTERN_EOF\ncat "$PATFILE"',
      },
      { name: 'count', command: 'printf "+ it(\\n+  test(\\nfoo\\n" | grep -c -E -f "$PATFILE"', tolerant: true },
    ]
    const r = parseBatchResult(runScript(batchScript(steps)), steps)
    expect(stepStdout(r, 'pattern')).toBe('[+][[:space:]]*(it\\(|test\\(|describe\\()\n')
    expect(stepStdout(r, 'count')).toBe('2\n')
  })
})

describe('batchCommandPrompt', () => {
  it('tells the agent to run the script once and return stdout verbatim', () => {
    const p = batchCommandPrompt([{ name: 'a', command: 'echo a' }])
    expect(p).toMatch(/ONE invocation/)
    expect(p).toMatch(/return only its stdout/)
    expect(p).toMatch(/do not ask/i)
    expect(p).toMatch(/not a problem to solve/)
    expect(p).toContain('echo a')
  })

  // Workflow resume replays every agent() whose (prompt, opts) is unchanged.
  // A batch that reads a file the human edited between runs (QUESTIONS.md
  // answered, SPEC.md fixed) has a byte-identical prompt, so the stale result
  // replays — a dogfooding run could never get past the Refine gate. The
  // inputs fingerprint stamped into the prompt is what makes an edit a miss.
  it('stamps the inputs fingerprint into the prompt without changing the script', () => {
    const steps = [{ name: 'a', command: 'echo a' }]
    setBatchCacheKey('')
    const bare = batchCommandPrompt(steps)
    setBatchCacheKey('sha256:abc123')
    const keyed = batchCommandPrompt(steps)
    expect(keyed).toContain('sha256:abc123')
    expect(keyed).not.toBe(bare)
    expect(batchScript(steps)).toBe(batchScript(steps))
    expect(keyed).toContain(batchScript(steps))
    setBatchCacheKey('')
    expect(batchCommandPrompt(steps)).toBe(bare)
  })
})

describe('parseBatchResult', () => {
  const steps: BatchStep[] = [{ name: 'a', command: 'true' }, { name: 'b', command: 'true', tolerant: true }]

  it('accepts a fenced string, a bare string, or an already-parsed array', () => {
    const arr = [{ name: 'a', exit_code: 0, stdout: 'x', stderr: '' }]
    expect(parseBatchResult('```json\n' + JSON.stringify(arr) + '\n```', steps).steps).toHaveLength(1)
    expect(parseBatchResult(JSON.stringify(arr), steps).steps).toHaveLength(1)
    expect(parseBatchResult(arr, steps).steps).toHaveLength(1)
  })

  // datum integration-lanes wf_aec6a61b-94a task-007: the intake verify
  // runner replied "``` ```" — an empty fence. Stored as prose, it was
  // named runner_no_json and the empty-reply retry never fired.
  it('reads a reply that is only code fences and whitespace as an empty reply, not prose', () => {
    for (const raw of ['``` ```', '```\n```', '```json\n\n```', '  ```bash\n  ```  ']) {
      const r = parseBatchResult(raw, steps)
      expect(r.missing).toBe(true)
      expect(r.refusal).toBeUndefined()
      expect(describeFailure(r, 'lane-intake')).toMatch(/^lane-intake: runner_empty_result/)
    }
  })

  it('reports missing when the agent returned nothing usable', () => {
    for (const raw of [null, undefined, '', 'MISSING', '{"not":"an array"}']) {
      const r = parseBatchResult(raw, steps)
      expect(r.missing).toBe(true)
      expect(r.steps).toEqual([])
      expect(describeFailure(r, 'x')).toContain('no parseable result')
    }
  })

  // elonchesd wf_2bf3cc14-899: the datum-cli runner was refused by the host's
  // permission classifier (git reset --hard / clean -fd in a scratch worktree)
  // and replied in prose. That is not "no parseable result": it is a named,
  // actionable outcome the operator can fix with an allow-rule.
  it('a prose refusal from the runner is runner_permission_denied, with the reply excerpt', () => {
    const reply = 'I was unable to run this script: the Bash tool was blocked by the Claude Code auto-mode classifier due to permission restrictions. The script contains destructive git operations (git reset --hard and git clean -fd).'
    const r = parseBatchResult(reply, steps)
    expect(r.missing).toBe(true)
    expect(r.refusal).toBe(reply)
    const d = describeFailure(r, 'red-reset')
    expect(d).toMatch(/^red-reset: runner_permission_denied — the datum-cli runner was refused by the host permission classifier/)
    expect(d).toContain('git reset --hard and git clean -fd')
    expect(d.length).toBeLessThan(500)
  })

  it('"I cannot run / unable to execute" phrasings are refusals too', () => {
    for (const reply of ['I cannot run destructive git commands in this worktree.', "I'm unable to execute this script."]) {
      expect(describeFailure(parseBatchResult(reply, steps), 'x')).toMatch(/^x: runner_permission_denied/)
    }
  })

  it('other prose replies are runner_no_json, quoting the reply; null stays "no parseable result"', () => {
    const r = parseBatchResult('Here is a summary of what I did: everything went fine.', steps)
    expect(r.missing).toBe(true)
    expect(describeFailure(r, 'x')).toMatch(/^x: runner_no_json — batch agent returned no parseable result \(reply: "Here is a summary/)
    expect(describeFailure(parseBatchResult(null, steps), 'x')).toBe('x: runner_empty_result — batch agent returned no parseable result (empty reply)')
  })

  it('flags only non-tolerant non-zero exits as failed', () => {
    const r = parseBatchResult([
      { name: 'b', exit_code: 1, stdout: '', stderr: '' },
      { name: 'a', exit_code: 2, stdout: '', stderr: 'nope' },
    ], steps)
    expect(r.failed?.name).toBe('a')
    const ok = parseBatchResult([{ name: 'b', exit_code: 1, stdout: '', stderr: '' }], steps)
    expect(ok.failed).toBeNull()
  })

  it('drops malformed entries and coerces string exit codes', () => {
    const r = parseBatchResult([null, 'junk', { name: 'a', exit_code: '0', stdout: 'ok' }], steps)
    expect(r.steps).toEqual([{ name: 'a', exit_code: 0, stdout: 'ok', stderr: '' }])
  })
})

// caliper eedom wf_4f739141-c8c: the fast-model runner re-typed the 24-line
// setup batch into its Bash call and turned `printf '{"root": "%s"}'` into
// `printf '{"root": "%s'}'` — one dropped character, an unmatched quote, a
// halted run. A runner transcribes; it must never be trusted to transcribe
// exactly. The batch now delivers the script through a quoted heredoc into
// a file, hashes the file with `git hash-object` against the sha the
// workflow computed, runs it only on a match, and otherwise prints a single
// `__script` step naming batch_script_corrupt so the caller retries.
describe('batchScript integrity: the runner cannot silently mangle the script', () => {
  const steps = [{ name: 'root-wt', command: `__root=$(pwd) && printf '{"root": "%s"}' "$__root"`, tolerant: true }]

  it('wraps the inner script in a quoted heredoc, hashes it with git hash-object, and runs it only on a match', () => {
    const script = batchScript(steps)
    expect(script).toMatch(/cat > "\$__f" <<'DATUM_BATCH_EOF'\n/)
    expect(script).toMatch(/\nDATUM_BATCH_EOF\n/)
    expect(script).toMatch(/git hash-object "\$__f"/)
    expect(script).toMatch(/batch_script_corrupt/)
    expect(script).toMatch(/[0-9a-f]{40}/)
    // sourced, so a prelude (`__root=...`, a `cd`) stays visible to the steps
    expect(script).toMatch(/\. "\$__f"/)
    expect(script).not.toMatch(/bash "\$__f"/)
  })

  it('under real bash, the exact script runs and a one-character transcription error is a named corrupt result', () => {
    const script = batchScript(steps)
    const ok = parseBatchResult(execFileSync('bash', ['-c', script], { encoding: 'utf8' }), steps)
    expect(ok.missing).toBe(false)
    expect(stepStdout(ok, 'root-wt')).toMatch(/^\{"root": "/)

    const mangled = script.replace(`printf '{"root": "%s"}'`, `printf '{"root": "%s'}'`)
    expect(mangled).not.toBe(script)
    const bad = parseBatchResult(execFileSync('bash', ['-c', mangled], { encoding: 'utf8' }), steps)
    expect(bad.missing).toBe(true)
    expect(bad.corrupt).toMatch(/^batch_script_corrupt: expected [0-9a-f]{40}, got [0-9a-f]{40}/)
    expect(describeFailure(bad, 'setup')).toMatch(/^setup: batch_script_corrupt — the runner did not run the script it was given/)
  })
})

// elonchesd: a batch that assumed the runner's cwd was the repo root ran
// somewhere else and every relative `.datum/...` path missed. The orchestrator
// records the root once at boot; every batch of the run starts by cd-ing there.
describe('setBatchRoot — every batch starts at the recorded repo root', () => {
  it('prepends a guarded cd to the recorded root, quoted, before the script runs', () => {
    const steps = [{ name: 'a', command: 'echo a' }]
    setBatchRoot('/tmp/some dir/with "quotes"')
    try {
      const script = batchScript(steps)
      expect(script.startsWith('cd "/tmp/some dir/with \\"quotes\\"" 2>/dev/null || {')).toBe(true)
      expect(script).toContain('batch_root_missing')
      expect(script.indexOf('cd ')).toBeLessThan(script.indexOf('__f=$(mktemp)'))
    } finally {
      setBatchRoot('')
    }
  })

  it('an empty root leaves the script exactly as before', () => {
    const steps = [{ name: 'a', command: 'echo a' }]
    setBatchRoot('')
    const script = batchScript(steps)
    expect(script.startsWith('export PATH=')).toBe(true)
    expect(script).not.toContain('batch_root_missing')
  })

  it('under real bash: the steps run inside the root; a missing root is one named __script step', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-root-'))
    try {
      const steps = [{ name: 'where', command: 'pwd -P' }]
      setBatchRoot(dir)
      const out = execFileSync('bash', ['-c', batchScript(steps)], { cwd: tmpdir(), encoding: 'utf8' })
      const r = parseBatchResult(out, steps)
      expect(r.failed).toBeNull()
      expect(stepStdout(r, 'where')?.trim()).toBe(realpathSync(dir))

      setBatchRoot(join(dir, 'gone'))
      const missing = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: tmpdir(), encoding: 'utf8' }), steps)
      expect(missing.missing).toBe(true)
      expect(missing.corrupt).toBeUndefined()
      expect(missing.scriptError).toMatch(/^batch_root_missing: /)
      expect(describeFailure(missing, 'boot')).toMatch(/^boot: batch_root_missing: /)
    } finally {
      setBatchRoot('')
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// datum self-hosted wf_c296b6b0-721: the boot batch's runner shell had no
// /opt/homebrew/bin on its PATH, jq was not found, __rec produced nothing
// and the runner invented a `__script` row ("jq: command not found or exec
// error"). Caliper's ast-grep fallback (bceded3c) had the same cause. The
// wrapper extends PATH with the usual tool prefixes itself and names a
// missing jq before anything runs, never a fabricated row from the runner.
describe('batchScript — tool prefixes on PATH and a named missing jq', () => {
  it('extends PATH with the homebrew/local prefixes and guards jq before the heredoc', () => {
    const script = batchScript([{ name: 'a', command: 'echo a' }])
    const pathAt = script.indexOf('export PATH=')
    const guardAt = script.indexOf('batch_tool_missing: jq')
    expect(pathAt).toBeGreaterThan(-1)
    expect(script.slice(pathAt, pathAt + 120)).toMatch(/\/opt\/homebrew\/bin/)
    expect(script.slice(pathAt, pathAt + 120)).toMatch(/\/usr\/local\/bin/)
    expect(guardAt).toBeGreaterThan(pathAt)
    expect(guardAt).toBeLessThan(script.indexOf('__f=$(mktemp)'))
  })

  it('under real bash: a minimal PATH still finds jq through the prefixes; with none reachable, the row is batch_tool_missing', () => {
    const steps = [{ name: 'a', command: 'echo a' }]
    const found = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } }), steps)
    expect(found.missing).toBe(false)
    expect(stepStdout(found, 'a')).toBe('a\n')

    // Hide every jq by pointing the prefixes at empty dirs: PATH minimal and
    // the script's own prefixes shadowed via a bogus HOMEBREW/local layout is
    // not possible from outside, so simulate with a wrapper dir whose `jq`
    // refuses to execute (exit 127) placed FIRST on PATH.
    const dir = mkdtempSync(join(tmpdir(), 'datum-nojq-'))
    try {
      execFileSync('bash', ['-c', `mkdir -p "${dir}/bin" && printf '#!/bin/bash\\nexit 127\\n' > "${dir}/bin/jq" && chmod +x "${dir}/bin/jq"`])
      const out = execFileSync('bash', ['-c', batchScript(steps)], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:/usr/bin:/bin`, DATUM_BATCH_TOOL_PREFIXES: `${dir}/none` } })
      const r = parseBatchResult(out, steps)
      expect(r.missing).toBe(true)
      expect(r.scriptError).toMatch(/^batch_tool_missing: jq/)
      expect(describeFailure(r, 'boot')).toMatch(/^boot: batch_tool_missing: jq/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// datum integration-lanes wf_d913ace6-62c boot: the runner honestly returned
// [{"name":"__script","exit_code":126,"stdout":"","stderr":""}] — the host
// refused to execute the script before any step ran — and datum named it
// runner_empty_result, as if the runner had said nothing.
describe('a __script row that failed before any step is batch_script_failed, not an empty reply', () => {
  const steps = [{ name: 'cfg', command: 'cat .datum/config.json' }]
  it('names the exit code and that no step ran', () => {
    const r = parseBatchResult(JSON.stringify([{ name: '__script', exit_code: 126, stdout: '', stderr: '' }]), steps)
    expect(r.missing).toBe(true)
    expect(r.scriptError).toMatch(/^batch_script_failed: the batch script exited 126 before any step ran/)
    expect(describeFailure(r, 'boot')).toMatch(/^boot: batch_script_failed: the batch script exited 126/)
  })
  it('still names a hash mismatch as batch_script_corrupt', () => {
    const r = parseBatchResult(JSON.stringify([{ name: '__script', exit_code: 1, stdout: '', stderr: 'batch_script_corrupt: expected a, got b' }]), steps)
    expect(r.corrupt).toBeTruthy()
    expect(r.scriptError).not.toMatch(/batch_script_failed/)
  })
})

// wf_4cd23ab6-9f8 boot: the runner described the refusal in prose ("The bash
// command exited with code 126 ... failed to execute") instead of the
// __script row, and datum named it runner_no_json with no retry.
describe('a prose reply describing exit 126 is batch_script_failed too', () => {
  const steps = [{ name: 'cfg', command: 'cat .datum/config.json' }]
  it('names it and keeps the excerpt', () => {
    const r = parseBatchResult('The bash command exited with code 126. There is no stdout to return; the script failed to execute.', steps)
    expect(r.missing).toBe(true)
    expect(r.scriptError).toMatch(/^batch_script_failed: the batch script exited 126 before any step ran/)
    expect(describeFailure(r, 'boot')).toContain('exited 126')
  })
  it('leaves ordinary prose as runner_no_json', () => {
    const r = parseBatchResult('Here is a summary of what happened.', steps)
    expect(r.scriptError).toBeUndefined()
    expect(describeFailure(r, 'boot')).toMatch(/runner_no_json/)
  })
})

// wf_f79286ec-09d boot: the host refused the script (exit 126) and the
// runner filled stderr with its own words, "Command not found or permission
// denied". Only datum's guards name themselves on stderr; anything else on a
// silent-before-any-step exit is still the host refusing the script.
describe('a __script failure whose stderr is not a datum guard is batch_script_failed', () => {
  const steps = [{ name: 'cfg', command: 'cat .datum/config.json' }]
  it('keeps the runner text as detail and names the failure', () => {
    const r = parseBatchResult(JSON.stringify([{ name: '__script', exit_code: 126, stdout: '', stderr: 'Command not found or permission denied' }]), steps)
    expect(r.scriptError).toMatch(/^batch_script_failed: the batch script exited 126 before any step ran/)
    expect(r.scriptError).toContain('Command not found or permission denied')
  })
  it('still passes a datum guard message through by name', () => {
    for (const guard of ['batch_root_missing: /nowhere', 'batch_tool_missing: jq is not on the runner PATH']) {
      const r = parseBatchResult(JSON.stringify([{ name: '__script', exit_code: 1, stdout: '', stderr: guard }]), steps)
      expect(r.scriptError).toBe(guard)
    }
  })
})

// wf_d80acceb-e3e boot: the host refused the script (exit 126) and the
// runner replied "[]". An array with no step rows parsed as a batch that
// ran nothing, so boot read "no config step" instead of retrying.
describe('an empty array is an empty reply', () => {
  const steps = [{ name: 'cfg', command: 'cat .datum/config.json' }]
  it('is missing and named runner_empty_result, so runBatch retries it', () => {
    for (const raw of ['[]', '```json\n[]\n```', []]) {
      const r = parseBatchResult(raw, steps)
      expect(r.missing).toBe(true)
      expect(r.refusal).toBeUndefined()
      expect(describeFailure(r, 'boot')).toMatch(/^boot: runner_empty_result/)
    }
  })
})
