// questions-steps.ts — answered questions are operator decisions.
//
// A refine re-run rewrote QUESTIONS.md with different questions and
// discarded the answered ones (elonchesd wf_230050d5-e9e). The script now
// extracts every answered question before the writer runs, hands the
// existing file to the writer with a carry-forward rule, and — because a
// prompt rule is a proposal, not a gate — verifies in bash that each answer
// line survives in the rewritten file before committing. A dropped answer
// is `refine_answers_dropped`, naming the question.
// tested-by: skills/src/shared/questions-steps.test.ts

import type { BatchStep, BatchResult } from './batch'
import { stepResult, describeFailure } from './batch'

export interface AnsweredQuestion {
  /** The `### Qn: ...` heading line. */
  question: string
  /** The `[Answer]: ...` line, non-empty after the marker. */
  answer: string
}

const QUESTION_RE = /^###\s+Q\d+\s*:/
const ANSWER_RE = /^\[Answer\]:\s*(.*)$/

export function answeredQuestions(content: string): AnsweredQuestion[] {
  const out: AnsweredQuestion[] = []
  let current: string | null = null
  for (const raw of (content || '').split('\n')) {
    const line = raw.trimEnd()
    if (QUESTION_RE.test(line)) { current = line; continue }
    const m = ANSWER_RE.exec(line)
    if (m && current && m[1].trim()) {
      out.push({ question: current, answer: line })
      current = null
    }
  }
  return out
}

function q(p: string): string {
  return `"${p.replace(/(["\\`$])/g, '\\$1')}"`
}

/** One exact-line grep per answered question against the rewritten file. */
export function answersKeptSteps(questionsPath: string, answered: AnsweredQuestion[]): BatchStep[] {
  return answered.map((a, i) => ({
    name: `answer-kept-${i}`,
    command: `ANSWER=$(mktemp)\ncat > "$ANSWER" <<'ANSWER_EOF'\n${a.answer}\nANSWER_EOF\ngrep -c -F -x -f "$ANSWER" ${q(questionsPath)} 2>/dev/null || echo 0`,
    tolerant: true,
  }))
}

export function answersKeptFromSteps(
  result: BatchResult,
  answered: AnsweredQuestion[],
): { ok: boolean; error: string; dropped: string[] } {
  if (answered.length === 0) return { ok: true, error: '', dropped: [] }
  if (result.missing) {
    return { ok: false, error: `refine_answers_dropped: ${describeFailure(result, 'answers-kept batch')} — cannot confirm the ${answered.length} answered question(s) survived the rewrite`, dropped: answered.map((a) => a.question) }
  }
  const dropped: string[] = []
  answered.forEach((a, i) => {
    const rec = stepResult(result, `answer-kept-${i}`)
    const count = rec ? parseInt(rec.stdout.trim(), 10) : NaN
    if (!Number.isFinite(count) || count < 1) dropped.push(a.question)
  })
  if (dropped.length === 0) return { ok: true, error: '', dropped: [] }
  return {
    ok: false,
    error: `refine_answers_dropped: ${dropped.length} of ${answered.length} answered questions missing from the rewritten QUESTIONS.md: ${dropped.join(' | ')}`,
    dropped,
  }
}
