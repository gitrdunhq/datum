// Answered questions are operator decisions. A refine re-run (elonchesd
// wf_230050d5-e9e: the previous run's gate batch was classifier-refused, so
// the phase re-ran from scratch) rewrote QUESTIONS.md with five different
// questions and discarded the five answered ones. The script now extracts
// every answered question before the write and verifies, in bash, that each
// answer line survives in the rewritten file before committing.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { batchScript, parseBatchResult } from './batch'
import { answeredQuestions, answersKeptSteps, answersKeptFromSteps } from './questions-steps'

const QUESTIONS = `## Refine — 2026-09-05

### Q1: [Scope] Is the shell single-player only?
> Determines whether a lobby is in scope.

[Answer]: Yes, single player against the engine for this epic.

### Q2: [Behavior] Should fog persist across turns?
> The renderer needs to know.

[Answer]:

### Q3: [NFR] Frame budget?
> Affects the render loop.

[Answer]: 16 ms at 60 fps on the reference laptop.
`

describe('answeredQuestions', () => {
  it('returns the question heading and the non-empty answer line for each answered question, in order', () => {
    expect(answeredQuestions(QUESTIONS)).toEqual([
      { question: '### Q1: [Scope] Is the shell single-player only?', answer: '[Answer]: Yes, single player against the engine for this epic.' },
      { question: '### Q3: [NFR] Frame budget?', answer: '[Answer]: 16 ms at 60 fps on the reference laptop.' },
    ])
    expect(answeredQuestions('No clarifying questions needed — intent is clear.\n')).toEqual([])
    expect(answeredQuestions('')).toEqual([])
  })
})

describe('answersKeptSteps / answersKeptFromSteps', () => {
  it('is one tolerant step per answered question, each an exact-line grep of the answer', () => {
    const steps = answersKeptSteps('docs/epics/e/QUESTIONS.md', answeredQuestions(QUESTIONS))
    expect(steps.map((s) => s.name)).toEqual(['answer-kept-0', 'answer-kept-1'])
    expect(steps.every((s) => s.tolerant)).toBe(true)
    expect(steps[0].command).toContain('grep -c -F -x')
    expect(steps[0].command).toContain("<<'ANSWER_EOF'")
    expect(answersKeptSteps('x', [])).toEqual([])
  })

  it('under real bash, a rewrite that keeps the answers passes and one that drops an answer is refine_answers_dropped naming the question', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-answers-'))
    try {
      mkdirSync(join(dir, 'docs/epics/e'), { recursive: true })
      const answered = answeredQuestions(QUESTIONS)
      const steps = answersKeptSteps('docs/epics/e/QUESTIONS.md', answered)

      writeFileSync(join(dir, 'docs/epics/e/QUESTIONS.md'), QUESTIONS + '\n## Refine — 2026-09-06\n\n### Q4: [Scope] New?\n> ctx\n\n[Answer]:\n')
      const kept = answersKeptFromSteps(parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps), answered)
      expect(kept).toEqual({ ok: true, error: '', dropped: [] })

      writeFileSync(join(dir, 'docs/epics/e/QUESTIONS.md'), '## Refine — 2026-09-06\n\n### Q1: [Scope] Different question?\n> ctx\n\n[Answer]:\n\n### Q3: [NFR] Frame budget?\n> ctx\n\n[Answer]: 16 ms at 60 fps on the reference laptop.\n')
      const dropped = answersKeptFromSteps(parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps), answered)
      expect(dropped.ok).toBe(false)
      expect(dropped.dropped).toEqual(['### Q1: [Scope] Is the shell single-player only?'])
      expect(dropped.error).toMatch(/^refine_answers_dropped: 1 of 2 answered questions missing from the rewritten QUESTIONS\.md: ### Q1/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a batch that did not run is a named failure, never "all kept"', () => {
    const answered = answeredQuestions(QUESTIONS)
    const r = answersKeptFromSteps(parseBatchResult(null, answersKeptSteps('q', answered)), answered)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^refine_answers_dropped: /)
  })
})
