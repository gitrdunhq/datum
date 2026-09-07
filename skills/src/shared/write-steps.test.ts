// write-steps.ts — write content the SCRIPT already holds to a file through a
// datum-cli batch, byte-verified.
//
// Several phases used to hand their own content to an LLM runner ("Write
// this content to <path> ... Commit: ...") — the review report, the triage
// routing.json, the tasks.json plan. A runner that trimmed, re-wrapped or
// "tidied" the content wrote something else with no trace. The write is a
// quoted heredoc inside a batch step and the on-disk blob sha is compared
// with the sha of the bytes the script intended (write_mismatch).

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSteps, writeFileFromSteps, writeFileBlobSha, HEREDOC_TERMINATOR } from './write-steps'
import { batchScript, parseBatchResult } from './batch'

const names = (steps: { name: string }[]) => steps.map((s) => s.name)

describe('writeFileSteps', () => {
  it('is mkdir (parent dir) → heredoc write → blob sha, sha tolerant, default names', () => {
    const steps = writeFileSteps({ path: 'docs/epics/x/REVIEW-REPORT.md', content: '# Review\n\n| a | b |\n' })
    expect(names(steps)).toEqual(['mkdir', 'write', 'sha'])
    expect(steps[0].command).toBe('mkdir -p "docs/epics/x"')
    expect(steps[1].command).toBe(`cat > "docs/epics/x/REVIEW-REPORT.md" <<'${HEREDOC_TERMINATOR}'\n# Review\n\n| a | b |\n${HEREDOC_TERMINATOR}`)
    expect(steps[2].command).toBe('git hash-object "docs/epics/x/REVIEW-REPORT.md"')
    expect(steps.map((s) => !!s.tolerant)).toEqual([false, false, true])
  })

  it('accepts custom step names so several writes can share one batch', () => {
    const steps = writeFileSteps({ path: 'x/tasks.json', content: '[]', names: { mkdir: 'mkdir', write: 'write-tasks', sha: 'tasks-sha' } })
    expect(names(steps)).toEqual(['mkdir', 'write-tasks', 'tasks-sha'])
  })

  it('a path without a directory part still gets a (no-op) mkdir of "."', () => {
    expect(writeFileSteps({ path: 'CHANGELOG.md', content: 'x' })[0].command).toBe('mkdir -p "."')
  })

  it('refuses content that contains the heredoc terminator on its own line', () => {
    expect(() => writeFileSteps({ path: 'x', content: `a\n${HEREDOC_TERMINATOR}\nb` })).toThrow(/heredoc terminator/)
  })
})

describe('writeFileBlobSha + real bash round trip', () => {
  it('matches git hash-object for multi-line, non-ASCII content with $ and backticks, adding one trailing newline only when missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-write-'))
    try {
      for (const content of ['# Title\n\nline with $var and `cmd`\n日本語 😀\n', 'no trailing newline', '']) {
        const path = join(dir, 'sub', 'f.md')
        const steps = writeFileSteps({ path, content })
        const out = execFileSync('bash', ['-c', batchScript(steps)], { encoding: 'utf8', cwd: dir })
        const result = parseBatchResult(out, steps)
        const onDisk = result.steps.find((s) => s.name === 'sha')!.stdout.trim()
        expect(onDisk).toBe(writeFileBlobSha(content))
        expect(readFileSync(path, 'utf8')).toBe(content.endsWith('\n') || content === '' ? content : content + '\n')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('writeFileFromSteps', () => {
  const steps = writeFileSteps({ path: 'docs/epics/x/R.md', content: 'hello\n' })
  const sha = writeFileBlobSha('hello\n')
  const res = (arr: Array<{ name: string; exit_code: number; stdout?: string; stderr?: string }>) =>
    parseBatchResult(JSON.stringify(arr.map((s) => ({ stdout: '', stderr: '', ...s }))), steps)

  const verdict = { path: 'docs/epics/x/R.md', expectedSha: sha, prefix: 'review_report' }

  it('is ok when the sha on disk equals the intended sha', () => {
    expect(writeFileFromSteps(res([{ name: 'mkdir', exit_code: 0 }, { name: 'write', exit_code: 0 }, { name: 'sha', exit_code: 0, stdout: sha + '\n' }]), verdict)).toEqual({ ok: true, error: '' })
  })

  it('names a mismatch with the path and both hashes under the caller prefix', () => {
    const r = writeFileFromSteps(res([{ name: 'mkdir', exit_code: 0 }, { name: 'write', exit_code: 0 }, { name: 'sha', exit_code: 0, stdout: 'abc' }]), verdict)
    expect(r.ok).toBe(false)
    expect(r.error).toBe(`review_report_write_mismatch: docs/epics/x/R.md on disk is blob abc, the script wrote ${sha} — the runner did not copy the heredoc verbatim`)
  })

  it('a failed write step, a failed mkdir, or a missing batch is <prefix>_write_failed', () => {
    const routing = { ...verdict, prefix: 'routing' }
    expect(writeFileFromSteps(res([{ name: 'mkdir', exit_code: 0 }, { name: 'write', exit_code: 1, stderr: 'Permission denied' }]), routing).error)
      .toMatch(/^routing_write_failed: write exited 1.*Permission denied/)
    expect(writeFileFromSteps(res([{ name: 'mkdir', exit_code: 1, stderr: 'nope' }]), routing).error).toMatch(/^routing_write_failed: mkdir exited 1/)
    expect(writeFileFromSteps(parseBatchResult(null, steps), routing).error).toMatch(/^routing_write_failed: /)
  })

  it('honours custom step names', () => {
    const names = { mkdir: 'mkdir', write: 'write-tasks', sha: 'tasks-sha' }
    const custom = writeFileSteps({ path: 'x/t.json', content: '[]', names })
    const r = parseBatchResult(JSON.stringify([
      { name: 'mkdir', exit_code: 0, stdout: '', stderr: '' }, { name: 'write-tasks', exit_code: 0, stdout: '', stderr: '' },
      { name: 'tasks-sha', exit_code: 0, stdout: writeFileBlobSha('[]'), stderr: '' },
    ]), custom)
    expect(writeFileFromSteps(r, { path: 'x/t.json', expectedSha: writeFileBlobSha('[]'), prefix: 'plan', names }).ok).toBe(true)
  })
})
