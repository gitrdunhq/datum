// write-steps.ts — write content the SCRIPT already holds to a file through
// a datum-cli batch, byte-verified.
//
// Several phases used to hand their own content to an LLM runner ("Write
// this content to <path> ... Commit: ...") — the review report, the triage
// routing.json, the tasks.json plan. A runner that trimmed, re-wrapped or
// "tidied" the content wrote something else with no trace. The write is a
// quoted heredoc inside a batch step (no expansion, multi-line safe) and the
// on-disk blob sha is compared with the sha of the bytes the script
// intended (<prefix>_write_mismatch).
// tested-by: skills/src/shared/write-steps.test.ts

import { stepResult, describeFailure, type BatchResult, type BatchStep } from './batch'
import { utf8Encode } from './utf8'
import { gitBlobSha } from './sha1'

export const HEREDOC_TERMINATOR = 'DATUM_WRITE_EOF'

const q = (s: string): string => `"${s.replace(/(["\\`$])/g, '\\$1')}"`

export interface WriteFileNames {
  mkdir: string
  write: string
  sha: string
}

export interface WriteFileOpts {
  path: string
  content: string
  /** Step names; override when several writes share one batch. */
  names?: WriteFileNames
}

const DEFAULT_NAMES: WriteFileNames = { mkdir: 'mkdir', write: 'write', sha: 'sha' }

/** What lands on disk: the content, with exactly one trailing newline appended when missing (empty stays empty). */
export function heredocBytes(content: string): string {
  return content === '' || content.endsWith('\n') ? content : content + '\n'
}

export function writeFileSteps(o: WriteFileOpts): BatchStep[] {
  if (o.content.split('\n').some((line) => line === HEREDOC_TERMINATOR)) {
    throw new Error(`writeFileSteps: content contains the heredoc terminator ${HEREDOC_TERMINATOR} on its own line`)
  }
  const names = o.names ?? DEFAULT_NAMES
  const slash = o.path.lastIndexOf('/')
  const dir = slash > 0 ? o.path.slice(0, slash) : '.'
  const body = heredocBytes(o.content)
  // `cat <<'EOF'` emits every body line followed by a newline, so the body
  // is written without its final newline and the heredoc supplies it. An
  // empty file cannot be expressed as a heredoc (it would write "\n"), so it
  // is truncated instead.
  const write = body === ''
    ? `: > ${q(o.path)}`
    : `cat > ${q(o.path)} <<'${HEREDOC_TERMINATOR}'\n${body.slice(0, -1)}\n${HEREDOC_TERMINATOR}`
  return [
    { name: names.mkdir, command: `mkdir -p ${q(dir)}` },
    { name: names.write, command: write },
    { name: names.sha, command: `git hash-object ${q(o.path)}`, tolerant: true },
  ]
}

/** The git blob sha of the bytes writeFileSteps() puts on disk for `content`. */
export function writeFileBlobSha(content: string): string {
  return gitBlobSha(utf8Encode(heredocBytes(content)))
}

function tail(step: { stdout: string; stderr: string }): string {
  return (step.stderr || step.stdout || '').trim().split('\n').slice(-3).join(' | ')
}

export interface WriteVerdictOpts {
  /** The path the write targeted — named in the mismatch message. */
  path: string
  expectedSha: string
  /** Failure family: `<prefix>_write_failed`, `<prefix>_write_mismatch`. */
  prefix: string
  names?: WriteFileNames
}

/** Verdict for one writeFileSteps() write inside `result`. */
export function writeFileFromSteps(result: BatchResult, o: WriteVerdictOpts): { ok: boolean; error: string } {
  const names = o.names ?? DEFAULT_NAMES
  if (result.missing) return { ok: false, error: `${o.prefix}_write_failed: ${describeFailure(result, names.write)}` }
  for (const name of [names.mkdir, names.write]) {
    const step = stepResult(result, name)
    if (!step) return { ok: false, error: `${o.prefix}_write_failed: ${name} step did not run` }
    if (step.exit_code !== 0) return { ok: false, error: `${o.prefix}_write_failed: ${name} exited ${step.exit_code} — ${tail(step)}` }
  }
  const sha = (stepResult(result, names.sha)?.stdout || '').trim()
  if (sha !== o.expectedSha) {
    return { ok: false, error: `${o.prefix}_write_mismatch: ${o.path} on disk is blob ${sha || '(none)'}, the script wrote ${o.expectedSha} — the runner did not copy the heredoc verbatim` }
  }
  return { ok: true, error: '' }
}
