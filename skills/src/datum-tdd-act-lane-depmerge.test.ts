// DAT-3 RED: the lane's in-batch dependency merge goes through runBatch
// instead of the agent()-based resilientAgent(batchCommandPrompt(...)) prompt.
// Source-pin tests: the workflow script cannot be executed under vitest, so the
// call shape is read from the source text, with comments stripped so prose
// cannot satisfy or break a pin.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const laneSrc = stripComments(readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8'))

/** The dep-merge block: from the step-list construction to the failure check. */
function depMergeBlock(): string {
  const start = laneSrc.indexOf('const depMergeStepList')
  expect(start, 'depMergeStepList is built in datum-tdd-act-lane.ts').toBeGreaterThan(-1)
  const end = laneSrc.indexOf('if (!depMerge.ok)', start)
  expect(end, 'dep-merge failure check follows the call').toBeGreaterThan(start)
  return laneSrc.slice(start, end)
}

/** Every import statement that names the given module path. */
function importsFrom(module: string): string[] {
  const re = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+['"]${module.replace(/[./]/g, '\\$&')}['"]`, 'g')
  return [...laneSrc.matchAll(re)].map((m) => m[1]!)
}

describe('DAT-3 lane dep-merge goes through runBatch', () => {
  it('ac1: dep-merge calls runBatch(depMergeStepList and no batchCommandPrompt( call remains', () => {
    expect(laneSrc).toContain('runBatch(depMergeStepList')
    expect(laneSrc).not.toMatch(/\bbatchCommandPrompt\(/)
    expect(depMergeBlock()).not.toMatch(/resilientAgent\(/)
  })

  it('ac2: no longer imports batchCommandPrompt from ./shared/batch or runCommandPrompt from ./shared/boot', () => {
    const batchImports = importsFrom('./shared/batch').join(',')
    expect(batchImports).toMatch(/\bparseBatchResult\b/)
    expect(batchImports).not.toMatch(/\bbatchCommandPrompt\b/)
    expect(laneSrc).not.toMatch(/\brunCommandPrompt\b/)
    expect(laneSrc).not.toMatch(/from\s+['"]\.\/shared\/boot['"]/)
  })

  it('ac3: the dep-merge call keeps label dep-merge:${taskId} and model haiku', () => {
    const block = depMergeBlock()
    const call = block.slice(block.indexOf('runBatch(depMergeStepList'))
    expect(block).toContain('runBatch(depMergeStepList')
    expect(call).toContain('label: `dep-merge:${taskId}`')
    expect(call).toMatch(/model: 'haiku'/)
  })

  it('ac4: the dep-merge result is still read by depMergeFromSteps, and a failure still fails the lane at CRASH', () => {
    const block = depMergeBlock()
    expect(block).toMatch(/depMergeFromSteps\(await runBatch\(depMergeStepList/)
    expect(block).not.toMatch(/parseBatchResult\(/)
    const failStart = laneSrc.indexOf('if (!depMerge.ok)')
    const failBlock = laneSrc.slice(failStart, laneSrc.indexOf('merged in-batch dep branches', failStart))
    expect(failBlock).toMatch(/error: depMerge\.error/)
    expect(failBlock).toMatch(/stage: 'CRASH'/)
  })

  it('ac5: npx tsc -p skills/tsconfig.json exits 0', () => {
    const root = join(__dirname, '..', '..')
    const r = spawnSync('npx', ['tsc', '-p', 'skills/tsconfig.json'], { cwd: root, encoding: 'utf8', timeout: 240_000 })
    expect(r.stdout + r.stderr).toBe('')
    expect(r.status).toBe(0)
  }, 300_000)
})
