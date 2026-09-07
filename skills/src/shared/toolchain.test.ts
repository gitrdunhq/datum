// #481 — TypeScript 7 removed the classic compiler API. `import ts from
// "typescript"` resolves to lib/version.cjs, which exports only `version`;
// the scanner/AST API moved to `typescript/unstable/ast`. Agents trained on
// TS 5 write `ts.createSourceFile` and burn GREEN retries on a module that
// has no such export. The awake scan reads the pin out of package.json
// deterministically and states the fact once, in the preamble every phase
// prompt carries.

import { describe, it, expect } from 'vitest'
import { pinsTypeScript7, toolchainConventionLines, TS7_CONVENTION_LINE } from './toolchain'

describe('pinsTypeScript7 — the lower bound of the range decides', () => {
  for (const range of ['7', '^7', '~7.0', '>=7', '7.x', '7.0.2', '^7.0.0-beta.1', '>=7.0 <8', '  ^7.1.3  ', '^8.0.0']) {
    it(`${JSON.stringify(range)} pins TypeScript 7 or later`, () => {
      expect(pinsTypeScript7(range)).toBe(true)
    })
  }

  for (const range of ['^5', '~5.4', '5.x', '5.9.2', '>=5 <8', '^6.0.0', '4.9.5']) {
    it(`${JSON.stringify(range)} does not`, () => {
      expect(pinsTypeScript7(range)).toBe(false)
    })
  }

  it('an absent, empty or non-numeric pin is not a TS7 pin (no line invented from nothing)', () => {
    expect(pinsTypeScript7('')).toBe(false)
    expect(pinsTypeScript7('   ')).toBe(false)
    expect(pinsTypeScript7(null)).toBe(false)
    expect(pinsTypeScript7(undefined)).toBe(false)
    expect(pinsTypeScript7('*')).toBe(false)
    expect(pinsTypeScript7('latest')).toBe(false)
    expect(pinsTypeScript7('workspace:*')).toBe(false)
  })

  it('an upper-bound-only range has no lower bound of 7 (<8 is not a TS7 pin)', () => {
    expect(pinsTypeScript7('<8')).toBe(false)
    expect(pinsTypeScript7('<=8.0.0')).toBe(false)
  })
})

describe('toolchainConventionLines', () => {
  it('emits the TS7 convention line for a 7+ pin', () => {
    expect(toolchainConventionLines('^7.0.0')).toEqual([TS7_CONVENTION_LINE])
  })

  it('emits nothing for a TS5 pin or no pin at all (a Python repo has no package.json)', () => {
    expect(toolchainConventionLines('^5.9.2')).toEqual([])
    expect(toolchainConventionLines('')).toEqual([])
  })

  it('the line names the removed API and the replacement entry point', () => {
    expect(TS7_CONVENTION_LINE).toMatch(/typescript >= 7/)
    expect(TS7_CONVENTION_LINE).toMatch(/ts\.createSourceFile/)
    expect(TS7_CONVENTION_LINE).toMatch(/typescript\/unstable\/ast/)
  })
})
