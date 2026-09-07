// toolchain.ts — deterministic conventions read off the repo's dependency
// pins rather than inferred by the scanning model (#481).
//
// TypeScript 7 removed the classic compiler API: `import ts from "typescript"`
// resolves to lib/version.cjs, a module whose only export is `version`, and
// the scanner/AST surface moved to `typescript/unstable/ast`. Every agent
// trained on TypeScript 5 reaches for `ts.createSourceFile`, gets a runtime
// TypeError or a type error, and spends its GREEN retries on it. package.json
// states the pin as a fact, so awake states the consequence once in the
// preamble instead of asking the model to notice.
//
// tested-by: skills/src/shared/toolchain.test.ts

export const TS7_CONVENTION_LINE =
  'typescript >= 7: the classic compiler API is gone; `ts.createSourceFile` and friends do not exist ' +
  '(`import ts from "typescript"` resolves to a module exporting only `version`); ' +
  'use `typescript/unstable/ast` or avoid the TS API.'

/**
 * True when a package.json range's LOWER bound is TypeScript 7 or later.
 *
 * The first number in the range is its lower bound for every form npm
 * accepts as a pin — `^7`, `~7.0`, `>=7`, `7.x`, `7.0.2`, `>=7.0 <8` — and
 * for `>=5 <8` that lower bound is 5, which is correctly not a TS7 pin. A
 * range with no number (`*`, `latest`, `workspace:*`) or none at all is not
 * a pin, and an upper-bound-only range (`<8`) states no lower bound at all.
 */
export function pinsTypeScript7(range: string | null | undefined): boolean {
  const raw = (range || '').trim()
  if (!raw || raw.startsWith('<')) return false
  const m = raw.match(/\d+/)
  if (!m) return false
  return Number(m[0]) >= 7
}

/** Convention lines the toolchain pins imply; empty when they imply none. */
export function toolchainConventionLines(typescriptRange: string | null | undefined): string[] {
  return pinsTypeScript7(typescriptRange) ? [TS7_CONVENTION_LINE] : []
}
