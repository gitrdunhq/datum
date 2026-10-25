// RED tests for LLM-363: the pi StageExecutor. One agent() call becomes one
// `bash <stage_script> <worktree> <stage.json>` run; the reply file the script
// writes becomes the StageReply. The only stand-in is a fixture stage script
// written to a temp dir: it records its argv and env, then replays an exit
// code, stderr and reply file scripted by the test. No container, model or
// network.
//
// Assumed construction seam (the item does not name one): the executor needs
// the repo root and run id, which StageRequest does not carry, so these tests
// call selectExecutor(runtime, { repoRoot, runId }).

import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectExecutor } from './executors'
import { runBundle } from './runner'
import { nodeShell } from './shell'
import { readRuntimeConfig, setModelTiers } from '../shared/models'
import runtimeKinds from '../../../assets/runtime-kinds.json'

const tmp = mkdtempSync(join(tmpdir(), 'llm363-pi-'))
afterAll(() => {
  setModelTiers({})
  rmSync(tmp, { recursive: true, force: true })
})

const MODELS = { fast: 'm-fast', balanced: 'm-bal', deep: 'm-deep' }
const RUN_ID = 'run-1'

const SCRIPT = `#!/usr/bin/env bash
dir="$(dirname "$0")"
printf 'argc=%s\\n' "$#" >> "$dir/calls.log"
printf 'arg0=%s\\n' "$1" >> "$dir/calls.log"
printf 'arg1=%s\\n' "$2" >> "$dir/calls.log"
env > "$dir/env.txt"
printf 'start\\n' >> "$dir/trace.log"
if [ -f "$dir/sleep" ]; then sleep "$(cat "$dir/sleep")"; fi
printf 'end\\n' >> "$dir/trace.log"
if [ -f "$dir/stderr" ]; then cat "$dir/stderr" >&2; fi
if [ -f "$dir/reply" ]; then cp "$dir/reply" "$(dirname "$2")/reply.json"; fi
if [ -f "$dir/exit" ]; then exit "$(cat "$dir/exit")"; fi
exit 0
`

interface Fixture {
  repoRoot: string
  worktree: string
  scriptDir: string
  script: string
  executorFor: (extra?: Record<string, unknown>) => ReturnType<typeof selectExecutor>
  runtime: (extra?: Record<string, unknown>) => ReturnType<typeof readRuntimeConfig>
  stageDirs: () => string[]
  calls: () => string[]
}

interface Script {
  exit?: number
  reply?: unknown
  rawReply?: string
  stderr?: string
  sleep?: string
}

let n = 0
function fixture(script: Script = {}): Fixture {
  const base = join(tmp, `case-${n++}`)
  const repoRoot = join(base, 'repo')
  const worktree = join(base, 'wt')
  const scriptDir = join(base, 'script')
  for (const d of [repoRoot, worktree, scriptDir]) mkdirSync(d, { recursive: true })
  const scriptPath = join(scriptDir, 'stage.sh')
  writeFileSync(scriptPath, SCRIPT)
  if (script.exit !== undefined) writeFileSync(join(scriptDir, 'exit'), String(script.exit))
  if (script.reply !== undefined) writeFileSync(join(scriptDir, 'reply'), JSON.stringify(script.reply))
  if (script.rawReply !== undefined) writeFileSync(join(scriptDir, 'reply'), script.rawReply)
  if (script.stderr !== undefined) writeFileSync(join(scriptDir, 'stderr'), script.stderr)
  if (script.sleep !== undefined) writeFileSync(join(scriptDir, 'sleep'), script.sleep)
  const runtime = (extra: Record<string, unknown> = {}) =>
    readRuntimeConfig({ runtime: { kind: 'pi', models: MODELS, stage_script: scriptPath, ...extra } })
  return {
    repoRoot,
    worktree,
    scriptDir,
    script: scriptPath,
    runtime,
    executorFor: (extra) => selectExecutor(runtime(extra), { repoRoot, runId: RUN_ID } as never),
    stageDirs: () => {
      const root = join(repoRoot, '.datum', 'runs', RUN_ID, 'stages')
      return existsSync(root) ? readdirSync(root).sort().map((d) => join(root, d)) : []
    },
    calls: () => {
      const f = join(scriptDir, 'calls.log')
      return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []
    },
  }
}

const OK_REPLY = { text: '{"done":true}' }

function req(f: Fixture, over: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) {
  return {
    prompt: 'do the thing',
    model: 'm-bal',
    headers: { 'X-Client': 'datum', 'X-Priority': 'batch' },
    opts: { label: 'lane-1-red', agentType: 'datum-red', worktree: f.worktree, ...opts },
    ...over,
  }
}

function readStageJson(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'stage.json'), 'utf8')) as Record<string, unknown>
}

describe('runtime config', () => {
  it('rejects kind pi without stage_script', () => {
    // Catches: pi accepted with no stage script, failing later at spawn time instead of at config read
    expect(() => readRuntimeConfig({ runtime: { kind: 'pi', models: MODELS } })).toThrow('runtime_stage_script_missing')
  })

  it('rejects a stage_timeout_s that is not a positive integer', () => {
    // Catches: zero, negative, fractional or non-number timeouts accepted and passed on to the script
    for (const bad of [0, -5, 1.5, '900']) {
      expect(() => readRuntimeConfig({ runtime: { kind: 'pi', models: MODELS, stage_script: '/x/stage.sh', stage_timeout_s: bad } })).toThrow(
        'runtime_stage_timeout_invalid',
      )
    }
  })

  it('no longer lists pi as an unavailable runtime kind', () => {
    // Catches: runtime-kinds.json still marks pi unavailable so datum workflow run keeps refusing it
    expect(runtimeKinds.unavailable).toEqual([])
    expect(runtimeKinds.kinds).toEqual(['fake', 'pi'])
  })
})

describe('stage directory and stage.json', () => {
  it('creates <repo>/.datum/runs/<run>/stages/<n>-<label> with mode 0700 holding prompt.md, stage.json and reply.json', async () => {
    // Catches: stage files written elsewhere, world-readable, or missing one of the three files
    const f = fixture({ reply: OK_REPLY })
    await f.executorFor().execute(req(f))
    const dirs = f.stageDirs()
    expect(dirs).toHaveLength(1)
    expect(dirs[0]).toMatch(/\/stages\/[0-9]+-lane-1-red$/)
    expect(statSync(dirs[0]).mode & 0o777).toBe(0o700)
    expect(readdirSync(dirs[0]).sort()).toEqual(['prompt.md', 'reply.json', 'stage.json'])
  })

  it('reduces the label to [A-Za-z0-9._-] in the directory name', () => {
    // Catches: a label with slashes or spaces escapes the stages directory or breaks the path
    const f = fixture({ reply: OK_REPLY })
    return f
      .executorFor()
      .execute(req(f, {}, { label: '../evil lane/1: red' }))
      .then(() => {
        const dirs = f.stageDirs()
        expect(dirs).toHaveLength(1)
        expect(dirs[0].slice(dirs[0].lastIndexOf('/stages/') + '/stages/'.length)).toMatch(/^[0-9]+-[A-Za-z0-9._-]+$/)
      })
  })

  it('gives each call its own directory from a per-run counter', async () => {
    // Catches: a second call with the same label reuses or overwrites the first call's stage directory
    const f = fixture({ reply: OK_REPLY })
    const ex = f.executorFor()
    await ex.execute(req(f))
    await ex.execute(req(f))
    const dirs = f.stageDirs()
    expect(dirs).toHaveLength(2)
    const counters = dirs.map((d) => d.slice(d.lastIndexOf('/') + 1).split('-')[0])
    expect(new Set(counters).size).toBe(2)
  })

  it('writes stage.json with model, role, read_only, files, timeout, headers, label and worktree', async () => {
    // Catches: stage.json missing a field, or role keeping the datum- prefix, or headers altered
    const f = fixture({ reply: OK_REPLY })
    await f.executorFor().execute(req(f))
    const [dir] = f.stageDirs()
    expect(readStageJson(dir)).toEqual({
      model: 'm-bal',
      role: 'red',
      read_only: false,
      prompt_file: join(dir, 'prompt.md'),
      reply_file: join(dir, 'reply.json'),
      timeout_s: 900,
      headers: { 'X-Client': 'datum', 'X-Priority': 'batch' },
      label: 'lane-1-red',
      worktree: f.worktree,
    })
  })

  it('marks a judge agent type read_only and strips the prefix from role', async () => {
    // Catches: read_only hard-coded false so judges get write access in the sandbox
    const f = fixture({ reply: OK_REPLY })
    await f.executorFor().execute(req(f, {}, { agentType: 'datum-skeptic', label: 'panel-1' }))
    const stage = readStageJson(f.stageDirs()[0])
    expect(stage.role).toBe('skeptic')
    expect(stage.read_only).toBe(true)
  })

  it('takes timeout_s from stage_timeout_s in the runtime config', async () => {
    // Catches: stage_timeout_s ignored and the 900 default always written
    const f = fixture({ reply: OK_REPLY })
    await f.executorFor({ stage_timeout_s: 120 }).execute(req(f))
    expect(readStageJson(f.stageDirs()[0]).timeout_s).toBe(120)
  })
})

describe('prompt', () => {
  it('writes the prompt to prompt.md with only the host worktree path rewritten to /work', async () => {
    // Catches: prompt altered beyond the worktree path, or the worktree path left in for the container
    const f = fixture({ reply: OK_REPLY })
    const prompt = `Edit ${f.worktree}/src/a.ts then read ${f.worktree}\n\tKeep /other/place and ${f.repoRoot}/x as is.\n`
    await f.executorFor().execute(req(f, { prompt }))
    const written = readFileSync(join(f.stageDirs()[0], 'prompt.md'), 'utf8')
    expect(written).toBe(`Edit /work/src/a.ts then read /work\n\tKeep /other/place and ${f.repoRoot}/x as is.\n`)
  })

  it('passes the prompt neither on argv nor in the environment', async () => {
    // Catches: prompt text leaked through argv or env where ps and /proc can read it
    const f = fixture({ reply: OK_REPLY })
    await f.executorFor().execute(req(f, { prompt: 'SECRET-PROMPT-MARKER-4471' }))
    const everything = f.calls().join('\n') + readFileSync(join(f.scriptDir, 'env.txt'), 'utf8')
    expect(everything).not.toContain('SECRET-PROMPT-MARKER-4471')
    expect(readFileSync(join(f.stageDirs()[0], 'prompt.md'), 'utf8')).toBe('SECRET-PROMPT-MARKER-4471')
  })
})

describe('spawn', () => {
  it('runs bash <stage_script> <worktree> <stage.json> as separate argv entries', async () => {
    // Catches: script invoked through a shell string or with the wrong argument order
    const f = fixture({ reply: OK_REPLY })
    await f.executorFor().execute(req(f))
    const [dir] = f.stageDirs()
    expect(f.calls()).toEqual(['argc=2', `arg0=${f.worktree}`, `arg1=${join(dir, 'stage.json')}`])
  })

  it('uses the repo root as the worktree when the call names none', async () => {
    // Catches: missing opts.worktree breaks the call instead of defaulting to the runner repo root
    const f = fixture({ reply: OK_REPLY })
    await f.executorFor().execute(req(f, {}, { worktree: undefined }))
    expect(f.calls()[1]).toBe(`arg0=${f.repoRoot}`)
    expect(readStageJson(f.stageDirs()[0]).worktree).toBe(f.repoRoot)
  })

  it('throws stage_worktree_missing for a worktree that does not exist, without spawning', async () => {
    // Catches: a missing worktree directory reaches the script instead of failing before the spawn
    const f = fixture({ reply: OK_REPLY })
    await expect(f.executorFor().execute(req(f, {}, { worktree: join(f.worktree, 'nope') }))).rejects.toThrow('stage_worktree_missing')
    expect(f.calls()).toEqual([])
  })

  it('throws stage_worktree_missing for a relative worktree path, without spawning', async () => {
    // Catches: a relative worktree path accepted and resolved against whatever the cwd happens to be
    const f = fixture({ reply: OK_REPLY })
    await expect(f.executorFor().execute(req(f, {}, { worktree: 'wt' }))).rejects.toThrow('stage_worktree_missing')
    expect(f.calls()).toEqual([])
  })

  it('throws stage_role_missing before writing anything when there is no agentType', async () => {
    // Catches: a call with no agentType runs with an empty role, or leaves a half-written stage directory
    const f = fixture({ reply: OK_REPLY })
    await expect(f.executorFor().execute(req(f, {}, { agentType: undefined }))).rejects.toThrow('stage_role_missing')
    expect(f.stageDirs()).toEqual([])
    expect(f.calls()).toEqual([])
  })
})

describe('reply and exit codes', () => {
  it('returns text, usage and timings from reply.json unchanged', async () => {
    // Catches: usage or timings dropped or reshaped on the way to the runner's metrics
    const reply = {
      text: '{"verdict":"PASS"}',
      usage: { prompt_tokens: 120, completion_tokens: 34, cached_tokens: 100 },
      timings: { prefill_ms: 410, decode_ms: 2200 },
    }
    const f = fixture({ reply })
    await expect(f.executorFor().execute(req(f))).resolves.toEqual(reply)
  })

  it('returns just the text when reply.json has no usage or timings', async () => {
    // Catches: usage and timings treated as required, or invented as zeros, when the script omits them
    const f = fixture({ reply: { text: 'plain' } })
    await expect(f.executorFor().execute(req(f))).resolves.toEqual({ text: 'plain' })
  })

  it('throws stage_reply_invalid when exit 0 leaves a reply without a string text', async () => {
    // Catches: a reply with a non-string text accepted as success
    const f = fixture({ reply: { text: 42 } })
    await expect(f.executorFor().execute(req(f))).rejects.toThrow(/stage_reply_invalid: .+/)
  })

  it('throws stage_reply_invalid when exit 0 writes no reply.json', async () => {
    // Catches: a missing reply file treated as an empty successful reply
    const f = fixture({})
    await expect(f.executorFor().execute(req(f))).rejects.toThrow(/stage_reply_invalid: .+/)
  })

  it('throws stage_reply_invalid when reply.json is not JSON', async () => {
    // Catches: a JSON parse error escaping as a raw SyntaxError instead of the named failure
    const f = fixture({ rawReply: 'not { json' })
    await expect(f.executorFor().execute(req(f))).rejects.toThrow(/stage_reply_invalid: .+/)
  })

  it('maps exit 2 to stage_usage_error', async () => {
    // Catches: a usage error from the script reported as a generic failure
    const f = fixture({ exit: 2 })
    await expect(f.executorFor().execute(req(f))).rejects.toThrow('stage_usage_error')
  })

  it('maps exit 3 to stage_guard_blocked', async () => {
    // Catches: a guard stop reported as a generic failure the caller may retry on another model
    const f = fixture({ exit: 3 })
    await expect(f.executorFor().execute(req(f))).rejects.toThrow('stage_guard_blocked')
  })

  it('maps exit 4 to stage_timeout', async () => {
    // Catches: the script's own timeout exit reported as a generic failure
    const f = fixture({ exit: 4 })
    await expect(f.executorFor().execute(req(f))).rejects.toThrow('stage_timeout')
  })

  it('maps any other exit to stage_failed with the code and the last 2 KB of stderr', async () => {
    // Catches: stderr truncated from the wrong end, uncapped, or the exit code left out
    const stderr = `HEADMARK${'x'.repeat(3000)}TAILMARK`
    const f = fixture({ exit: 7, stderr })
    const err = await f.executorFor().execute(req(f)).then(
      () => new Error('resolved'),
      (e: unknown) => e as Error,
    )
    expect(err.message).toContain('stage_failed: exit 7')
    expect(err.message).toContain('TAILMARK')
    expect(err.message).not.toContain('HEADMARK')
    expect(err.message.length).toBeLessThan(2048 + 500)
  })

  it('names the label and the stage directory in every thrown error', async () => {
    // Catches: an error that cannot be traced back to the stage that produced it
    const f = fixture({ exit: 3 })
    const err = await f.executorFor().execute(req(f)).then(
      () => new Error('resolved'),
      (e: unknown) => e as Error,
    )
    const [dir] = f.stageDirs()
    expect(err.message).toContain('lane-1-red')
    expect(err.message).toContain(dir)
  })
})

describe('through the runner', () => {
  const bundleFor = (body: string): string => {
    const p = join(tmp, `bundle-${n++}.js`)
    writeFileSync(p, `export const meta = { name: 'llm363' }\n${body}\n`)
    return p
  }
  const run = (f: Fixture, body: string, concurrency: Record<string, number> = {}) => {
    const runtime = f.runtime({ concurrency })
    return runBundle({
      bundlePath: bundleFor(body),
      args: { runId: RUN_ID },
      executor: selectExecutor(runtime, { repoRoot: f.repoRoot, runId: RUN_ID } as never),
      shell: nodeShell,
      skillsDirs: [],
      log: () => {},
      runtime,
      repoRoot: f.repoRoot,
    })
  }
  const metrics = (f: Fixture): Array<Record<string, unknown>> =>
    readFileSync(join(f.repoRoot, '.datum', 'runs', RUN_ID, 'metrics.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)

  it('does not overlap two parallel calls on a model with concurrency 1', async () => {
    // Catches: the executor bypassing the per-model semaphore so two stages run at once on one model
    const f = fixture({ reply: OK_REPLY, sleep: '0.3' })
    await run(
      f,
      `return await parallel([
        () => agent('a', { label: 'one', agentType: 'datum-red', model: 'm-bal', worktree: ${JSON.stringify(f.worktree)} }),
        () => agent('b', { label: 'two', agentType: 'datum-red', model: 'm-bal', worktree: ${JSON.stringify(f.worktree)} }),
      ])`,
      { 'm-bal': 1 },
    )
    const trace = readFileSync(join(f.scriptDir, 'trace.log'), 'utf8').split('\n').filter(Boolean)
    expect(trace).toEqual(['start', 'end', 'start', 'end'])
  })

  it('writes a metrics line carrying the reply usage and timings', async () => {
    // Catches: usage and timings from reply.json lost before they reach metrics.jsonl
    const f = fixture({
      reply: {
        text: '{"a":1}',
        usage: { prompt_tokens: 11, completion_tokens: 22, cached_tokens: 3 },
        timings: { prefill_ms: 44, decode_ms: 55 },
      },
    })
    const result = await run(f, `return await agent('p', { label: 'red-1', agentType: 'datum-red', worktree: ${JSON.stringify(f.worktree)} })`)
    expect(result).toEqual({ a: 1 })
    const [line] = metrics(f)
    expect(line).toMatchObject({
      label: 'red-1',
      agent_type: 'datum-red',
      model: 'm-bal',
      prompt_tokens: 11,
      completion_tokens: 22,
      cached_tokens: 3,
      prefill_ms: 44,
      decode_ms: 55,
      outcome: 'ok',
    })
  })

  it('writes an error metrics line when the stage fails', async () => {
    // Catches: a failed stage leaving no trace in metrics.jsonl
    const f = fixture({ exit: 7, stderr: 'boom' })
    await expect(
      run(f, `return await agent('p', { label: 'red-2', agentType: 'datum-red', worktree: ${JSON.stringify(f.worktree)} })`),
    ).rejects.toThrow('stage_failed: exit 7')
    const [line] = metrics(f)
    expect(line).toMatchObject({ label: 'red-2', model: 'm-bal', outcome: 'error' })
  })

  it('never retries a guard-blocked stage', async () => {
    // Catches: stage_guard_blocked retried on the same or a higher tier, re-running a stage the guard stopped
    const f = fixture({ exit: 3 })
    await expect(
      run(
        f,
        `return await agent('p', { label: 'red-3', agentType: 'datum-red', worktree: ${JSON.stringify(f.worktree)}, schema: { type: 'object' } })`,
      ),
    ).rejects.toThrow('stage_guard_blocked')
    expect(f.calls().filter((l) => l.startsWith('argc='))).toHaveLength(1)
  })
})
