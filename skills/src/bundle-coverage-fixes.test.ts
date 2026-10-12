// Follow-up review of the bundle call sites the runner-core epic review did
// not reach (REVIEW-REPORT PERF-005). Each finding pinned before its fix.
//   COV-1 the act-start digest retry lost its corrective suffix when it moved
//         to runBatch: attempt 2 sent attempt 1's prompt again.
//   COV-2 its label 'act-start:retry' equals runBatch's own internal retry
//         label for the first act-start call.
//   COV-3 dep-merge lost resilientAgent's retry of a throw or null reply.
//   COV-5 lintFixPaths dropped real paths with [ ] @ + in them.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runBatch } from './shared/agents'
import { batchCommandPrompt } from './shared/batch'
import { DIGEST_RETRY_MARKER, digestRetryPrompt } from './shared/lane-steps'
import { lintFixPaths } from './shared/validate-steps'

const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const src = (f: string): string => strip(readFileSync(join(__dirname, f), 'utf8'))

describe('COV-1/COV-2: the act-start digest retry', () => {
  it('sends attempt 1 plus the digest-retry marker, the text the pre-runBatch code sent', async () => {
    const steps = [{ name: 'digest-cat', command: 'cat x' }]
    const prompts: string[] = []
    await runBatch(steps, { label: 'act-start:digest-retry', retryMarker: DIGEST_RETRY_MARKER, retry: false }, {
      agentFn: async (p: string) => {
        prompts.push(p)
        return '[{"name":"digest-cat","exit_code":0,"stdout":"","stderr":""}]'
      },
      logFn: () => {},
    })
    expect(prompts).toEqual([digestRetryPrompt(batchCommandPrompt(steps))])
  })

  for (const bundle of ['datum-go.ts', 'datum-tdd-act.ts']) {
    it(`${bundle}: the explicit retry passes the marker under a label runBatch never derives`, () => {
      const text = src(bundle)
      const retries = text.split('\n').filter((l) => l.includes('actStartResult = await runBatch(actStart') && !l.includes("label: 'act-start',"))
      expect(retries).toHaveLength(1)
      const line = retries[0]
      expect(line).toContain('retryMarker: DIGEST_RETRY_MARKER')
      expect(line).toContain("label: 'act-start:digest-retry'")
      expect(text).not.toContain("'act-start:retry'")
    })
  }
})

describe('COV-3: dep-merge keeps resilientAgent behind runBatch', () => {
  it('passes resilientAgent as the runner so a throw or null reply is retried before the lane fails', () => {
    const text = src('datum-tdd-act-lane.ts')
    const start = text.indexOf('const depMergeStepList')
    const block = text.slice(start, text.indexOf('if (!depMerge.ok)', start))
    expect(block).toMatch(/runBatch\(depMergeStepList, stageOpts\('cli', \{ label: `dep-merge:\$\{taskId\}`, model: 'haiku' \}\), \{ agentFn: resilientAgent \}\)/)
  })
})

describe('COV-5: lintFixPaths keeps every repo-relative path', () => {
  it('keeps paths with brackets, @ and +, and drops notes, absolute and parent paths', () => {
    const dropped: string[] = []
    const out = lintFixPaths(
      [
        'app/[id]/page.tsx',
        'src/@types/x.d.ts: removed an unused import (eslint --fix)',
        'lib/a+b.ts',
        'Left alone on purpose: three findings',
        '/etc/passwd',
        'a/../../b.py',
        '-rf',
      ],
      (entry) => dropped.push(entry),
    )
    expect(out).toEqual(['app/[id]/page.tsx', 'src/@types/x.d.ts', 'lib/a+b.ts'])
    expect(dropped).toEqual(['Left alone on purpose: three findings', '/etc/passwd', 'a/../../b.py', '-rf'])
  })
})
