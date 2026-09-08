// test-bundle.ts — build a workflow bundle from its TypeScript source, in
// process, for tests that execute the bundle (#540).
//
// The lane runner tests used to read the COMMITTED skills/*.js. Inside a lane
// worktree that bundle is stale by definition — the lane just changed the
// source and does not own the generated files — so a sound GREEN could never
// pass its own in-lane verify, and `bash scripts/build-workflows.sh` inside a
// test rewrote thirteen bundles the lane could not commit. Building the
// entry point here mirrors the script's esbuild flags and post-processing and
// leaves the tree untouched.
import { buildSync } from 'esbuild'
import { join } from 'node:path'

const SRC_DIR = join(__dirname, '..')

/** The bundle text scripts/build-workflows.sh would write for `datum-<name>.ts`. */
export function buildWorkflowBundle(name: string): string {
  const entry = join(SRC_DIR, `${name}.ts`)
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    write: false,
    loader: { '.md': 'text' },
    logLevel: 'warning',
  })
  const raw = result.outputFiles[0].text
  // Same post-processing as scripts/build-workflows.sh: meta exported, the
  // workflow result returned, the ESM export block dropped.
  return raw
    .replace(/^var meta = /m, 'export const meta = ')
    .replace(/^var __workflowResult = /m, 'return ')
    .replace(/^export \{\n[\s\S]*?\n\};\n?/m, '')
}
