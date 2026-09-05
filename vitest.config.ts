import { defineConfig } from 'vitest/config'

// Vitest owns skills/src/**. tests/ts/*.test.mjs is a `node --test` harness
// run by scripts/test-ts.sh; without this scoping vitest globs it too and
// reports "No test suite found" on every run, masking real failures.
export default defineConfig({
  test: {
    include: ['skills/src/**/*.test.ts'],
  },
})
